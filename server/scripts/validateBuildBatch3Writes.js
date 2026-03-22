/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ReservationNote = require('../models/ReservationNote');
const EmailEvent = require('../models/EmailEvent');
const { transitionReservation, reassignReservation, editReservationDates, editGuestContact, addReservationNote } = require('../services/ops/domain/reservationWriteService');
const { createBlock, editBlock, tombstoneBlock } = require('../services/ops/domain/availabilityWriteService');
const { sendArrivalInstructions } = require('../services/ops/domain/communicationWriteService');
const { getReservationDetailReadModel } = require('../services/ops/readModels/reservationDetailReadModel');
const { assertScriptWriteAllowedForMongoUri } = require('../utils/scriptProductionGuard');

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

async function ensureCabin(nameSuffix) {
  return Cabin.create({
    name: `Batch3 Cabin ${nameSuffix}`,
    description: 'Validation cabin',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/a.jpg',
    location: 'Bulgaria'
  });
}

async function ensureBooking({ cabinId, status = 'pending', checkIn, checkOut, email }) {
  return Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email,
      phone: '+359000000'
    },
    totalPrice: 300
  });
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  assertScriptWriteAllowedForMongoUri(mongoUri);
  const report = {
    transitionFlow: false,
    invalidTransitionRejected: false,
    adminOnlyEnforced: false,
    auditFailureBlocksCommit: false,
    availabilityFlow: false,
    guestEditFlow: false,
    noteFlow: false,
    arrivalFlow: false,
    detailIncludesNotes: false,
    auditFailureBlocksAvailabilityCommit: false,
    auditFailureBlocksCommunicationDbCommit: false
  };

  const ctxAdmin = { user: { id: 'admin', role: 'admin' }, req: { headers: {} }, route: 'validate' };
  const ctxOperator = { user: { id: 'op-1', role: 'operator' }, req: { headers: {} }, route: 'validate' };
  const ctxForceAuditFail = { user: { id: 'admin', role: 'admin' }, req: { headers: { 'x-force-audit-fail': '1' } }, route: 'validate' };

  try {
    const cabinA = await ensureCabin('A');
    const cabinB = await ensureCabin('B');
    const checkIn = plusDays(5);
    const checkOut = plusDays(7);
    const booking = await ensureBooking({
      cabinId: cabinA._id,
      status: 'pending',
      checkIn,
      checkOut,
      email: `batch3-${Date.now()}@example.com`
    });

    await transitionReservation({ bookingId: booking._id, kind: 'confirm', ctx: ctxAdmin });
    await transitionReservation({ bookingId: booking._id, kind: 'checkIn', ctx: ctxAdmin });
    await transitionReservation({ bookingId: booking._id, kind: 'complete', ctx: ctxAdmin });
    report.transitionFlow = true;

    try {
      await transitionReservation({ bookingId: booking._id, kind: 'confirm', ctx: ctxAdmin });
    } catch (e) {
      report.invalidTransitionRejected = e.type === 'invalid_transition';
    }

    const booking2 = await ensureBooking({
      cabinId: cabinA._id,
      status: 'confirmed',
      checkIn: plusDays(10),
      checkOut: plusDays(12),
      email: `batch3-admin-only-${Date.now()}@example.com`
    });
    try {
      await reassignReservation({
        bookingId: booking2._id,
        toCabinId: cabinB._id,
        reason: 'validation',
        ctx: ctxOperator
      });
    } catch (e) {
      report.adminOnlyEnforced = e.code === 'PERMISSION_DENIED';
    }

    const booking3 = await ensureBooking({
      cabinId: cabinA._id,
      status: 'pending',
      checkIn: plusDays(13),
      checkOut: plusDays(15),
      email: `batch3-audit-${Date.now()}@example.com`
    });
    try {
      await transitionReservation({ bookingId: booking3._id, kind: 'confirm', ctx: ctxForceAuditFail });
    } catch (e) {
      const reloaded = await Booking.findById(booking3._id).lean();
      report.auditFailureBlocksCommit = e.code === 'AUDIT_WRITE_FAILED' && reloaded.status === 'pending';
    }

    const block = await createBlock({
      blockType: 'manual_block',
      cabinId: cabinA._id,
      startDate: plusDays(20),
      endDate: plusDays(21),
      reason: 'validation',
      ctx: ctxAdmin
    });
    await editBlock({
      blockId: block.blockId,
      startDate: plusDays(20),
      endDate: plusDays(22),
      reason: 'validation-edit',
      ctx: ctxAdmin
    });
    await tombstoneBlock({
      blockId: block.blockId,
      reason: 'validation-remove',
      ctx: ctxAdmin
    });
    const tombstoned = await AvailabilityBlock.findById(block.blockId).lean();
    report.availabilityFlow = tombstoned && tombstoned.status === 'tombstoned';

    const blocksBeforeForcedAudit = await AvailabilityBlock.countDocuments({ cabinId: cabinA._id, blockType: 'manual_block' });
    try {
      await createBlock({
        blockType: 'manual_block',
        cabinId: cabinA._id,
        startDate: plusDays(24),
        endDate: plusDays(25),
        reason: 'forced-audit-fail',
        ctx: ctxForceAuditFail
      });
    } catch (e) {
      const blocksAfterForcedAudit = await AvailabilityBlock.countDocuments({ cabinId: cabinA._id, blockType: 'manual_block' });
      report.auditFailureBlocksAvailabilityCommit = e.code === 'AUDIT_WRITE_FAILED' && blocksAfterForcedAudit === blocksBeforeForcedAudit;
    }

    const guestEdited = await editGuestContact({
      bookingId: booking2._id,
      firstName: 'Edited',
      phone: '+359111111',
      ctx: ctxAdmin
    });
    report.guestEditFlow = guestEdited.guest.firstName === 'Edited';

    const noteResult = await addReservationNote({
      bookingId: booking2._id,
      content: 'Validation note',
      ctx: ctxAdmin
    });
    report.noteFlow = Boolean(noteResult.note?.noteId);

    await sendArrivalInstructions({ bookingId: booking2._id, kind: 'send', ctx: ctxAdmin });
    await sendArrivalInstructions({ bookingId: booking2._id, kind: 'resend', ctx: ctxAdmin });
    await sendArrivalInstructions({ bookingId: booking2._id, kind: 'complete', ctx: ctxAdmin });
    report.arrivalFlow = true;

    const emailEventsBeforeForcedAudit = await EmailEvent.countDocuments({ bookingId: booking2._id });
    try {
      await sendArrivalInstructions({ bookingId: booking2._id, kind: 'resend', ctx: ctxForceAuditFail });
    } catch (e) {
      const emailEventsAfterForcedAudit = await EmailEvent.countDocuments({ bookingId: booking2._id });
      report.auditFailureBlocksCommunicationDbCommit =
        e.code === 'AUDIT_WRITE_FAILED' && emailEventsAfterForcedAudit === emailEventsBeforeForcedAudit;
    }

    const detail = await getReservationDetailReadModel(booking2._id);
    report.detailIncludesNotes = Array.isArray(detail?.notes?.items) && detail.notes.items.length > 0;

    console.log(JSON.stringify({ success: true, report }, null, 2));
  } finally {
    await ReservationNote.deleteMany({ 'metadata.validation': true }).catch(() => {});
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
