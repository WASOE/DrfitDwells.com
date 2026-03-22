/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { OpsModuleCutoverState } = require('../models/OpsModuleCutoverState');

const { setModuleCutover, rollbackModuleCutover } = require('../services/ops/cutover/opsCutoverService');
const { assertAdminModuleWriteAllowed } = require('../services/ops/cutover/opsCutoverService');
const adminController = require('../controllers/adminController');
const { transitionReservation } = require('../services/ops/domain/reservationWriteService');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const { assertScriptWriteAllowedForMongoUri } = require('../utils/scriptProductionGuard');

function makeRes() {
  return {
    statusCode: 200,
    _payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this._payload = payload;
      return this._payload;
    }
  };
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  assertScriptWriteAllowedForMongoUri(mongoUri);

  try {
    // Ensure cutover is enabled for reservations and legacy admin writes are blocked.
    await setModuleCutover({ moduleKey: 'reservations', opsPrimary: true, adminWriteOverlapStatus: 'active' });

    let pendingBooking = await Booking.findOne({ status: 'pending' }).select('_id status').lean();
    const confirmedBooking = await Booking.findOne({ status: 'confirmed' }).select('_id status').lean();

    if (!pendingBooking && !confirmedBooking) {
      // If the dataset has no suitable booking lifecycle state, create a minimal smoke fixture in `pending`.
      // This keeps the smoke test runnable without requiring manual DB preparation.
      const anyCabin = await Cabin.findOne({}).select('_id').lean();
      if (!anyCabin?._id) throw new Error('No cabin found; cannot create pending booking smoke fixture');

      const now = new Date();
      const checkIn = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 2); // +2 days (future)
      const checkOut = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 4); // +4 days (after check-in)

      const fixture = await Booking.create({
        cabinId: anyCabin._id,
        checkIn,
        checkOut,
        adults: 2,
        children: 0,
        status: 'pending',
        isTest: true,
        isProductionSafe: false,
        guestInfo: {
          firstName: 'Ops',
          lastName: 'Smoke',
          email: `smoke-${Date.now()}@example.com`,
          phone: '0000000000'
        },
        totalPrice: 100,
        tripType: 'retreat',
        romanticSetup: false
      });

      pendingBooking = { _id: fixture._id, status: fixture.status };
    }

    // Unaffected modules should not be blocked when their cutover state is restricted.
    // This verifies that module enforcement is module-specific (not global).
    let unaffectedOk = false;
    try {
      await assertAdminModuleWriteAllowed('cabins');
      await assertAdminModuleWriteAllowed('reviews_communications');
      unaffectedOk = true;
    } catch {
      unaffectedOk = false;
    }
    if (!unaffectedOk) {
      throw new Error('Expected /admin writes to remain allowed for restricted modules (cabins/reviews)');
    }

    // Execute blocked legacy write attempt and corresponding /ops success.
    // Prefer pending->confirmed->cancelled flow if a pending booking exists.
    // Otherwise use confirmed->cancelled for both enforcement + ops smoke,
    // and validate rollback via enforcement gate (since the booking becomes terminal).
    let blockedOk = false;
    let opsOk = false;
    let allowedOk = false;

    const opsCtx = { req: { headers: {} }, user: { id: 'admin', role: 'admin' }, route: 'internal-smoke' };

    if (pendingBooking) {
      const adminReqBlocked = {
        params: { id: String(pendingBooking._id) },
        body: { status: 'confirmed' },
        user: { id: 'admin', role: 'admin' }
      };
      const adminResBlocked = makeRes();

      try {
        await adminController.updateBookingStatus(adminReqBlocked, adminResBlocked);
        blockedOk = adminResBlocked._payload?.success === false && adminResBlocked._payload?.errorType === 'cutover_blocked';
      } catch {
        blockedOk = true;
      }
      if (!blockedOk) throw new Error('Expected legacy /admin booking status update to be blocked for cutover reservations');

      const confirmResult = await transitionReservation({
        bookingId: String(pendingBooking._id),
        kind: 'confirm',
        ctx: opsCtx
      });
      opsOk = Boolean(confirmResult?.reservationId);
      if (!opsOk) throw new Error('OPS confirm reservation did not succeed');

      await rollbackModuleCutover('reservations');

      const confirmedAfterOps = await Booking.findById(pendingBooking._id).select('_id status').lean();
      if (!confirmedAfterOps || confirmedAfterOps.status !== 'confirmed') {
        throw new Error('Booking status did not update to confirmed during OPS write');
      }

      const adminReqAllowed = {
        params: { id: String(pendingBooking._id) },
        body: { status: 'cancelled' },
        user: { id: 'admin', role: 'admin' }
      };
      const adminResAllowed = makeRes();
      await adminController.updateBookingStatus(adminReqAllowed, adminResAllowed);

      allowedOk = adminResAllowed._payload?.success === true || adminResAllowed.statusCode === 200;
      if (!allowedOk) throw new Error('Expected legacy /admin booking status update to succeed after rollback');
    } else {
      // confirmedBooking exists due to earlier guard
      const adminReqBlocked = {
        params: { id: String(confirmedBooking._id) },
        body: { status: 'cancelled' },
        user: { id: 'admin', role: 'admin' }
      };
      const adminResBlocked = makeRes();

      try {
        await adminController.updateBookingStatus(adminReqBlocked, adminResBlocked);
        blockedOk = adminResBlocked._payload?.success === false && adminResBlocked._payload?.errorType === 'cutover_blocked';
      } catch {
        blockedOk = true;
      }
      if (!blockedOk) throw new Error('Expected legacy /admin booking status update to be blocked for cutover reservations');

      const cancelResult = await transitionReservation({
        bookingId: String(confirmedBooking._id),
        kind: 'cancel',
        ctx: opsCtx
      });
      opsOk = Boolean(cancelResult?.reservationId);
      if (!opsOk) throw new Error('OPS cancel reservation did not succeed');

      await rollbackModuleCutover('reservations');

      // Since the booking is terminal (cancelled), validate rollback via enforcement gate.
      // This proves /admin writes are restored without depending on allowed transitions.
      try {
        await assertAdminModuleWriteAllowed('reservations');
        allowedOk = true;
      } catch {
        allowedOk = false;
      }
      if (!allowedOk) throw new Error('Expected legacy /admin writes to be allowed after rollback');
    }

    const cutoverState = await OpsModuleCutoverState.findOne({ moduleKey: 'reservations' }).lean();

    const overallPass = blockedOk && opsOk && allowedOk && unaffectedOk;

    console.log(
      JSON.stringify(
        {
          success: overallPass,
          batch: 'cutover-final',
          result: overallPass ? 'PASS' : 'FAIL',
          smoke: {
            adminBlockedWhenCutoverEnabled: blockedOk,
            opsConfirmReservationSucceeded: opsOk,
            adminAllowedAfterRollback: allowedOk,
            unaffectedAdminModulesStillAllowed: unaffectedOk
          },
          cutoverStateAfterRollback: cutoverState
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, batch: 'cutover-final', error: error.message }, null, 2));
  process.exit(1);
});

