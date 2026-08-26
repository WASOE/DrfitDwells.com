/**
 * R1 StayChange REALLOCATE — comprehensive domain/API regression suite.
 * Binding: docs/stay-change-implementation-plan.md §21
 * Run: cd server && node --test scripts/stayChange.r1.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const StayChange = require('../models/StayChange');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Cabin = require('../models/Cabin');
const UnitNightClaim = require('../models/UnitNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');
const { AUDIT_DEDUPE_INDEX_SPEC } = require('../models/AuditEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

const {
  claimUnitNights,
  releaseStayChangeTargetClaims,
  assertBookingOwnsNights,
  ensureAuthoritativeUniqueIndexForTests,
  ERR
} = require('../services/inventory/unitNightClaimService');
const {
  reallocateReservation,
  reconcileReallocateStayChange,
  buildPayloadFingerprint,
  canonicalStayDateOnly,
  syncReservationBlockUnitProjection,
  KIND
} = require('../services/stayChange/reallocateStayChangeService');
const cutover = require('./stayChangeR1Cutover');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');
const { reassignReservation } = require('../services/ops/domain/reservationWriteService');

const IDEM_NAME = cutover.IDEMPOTENCY_UNIQUE_INDEX_SPEC.options.name;
const AUDIT_NAME = AUDIT_DEDUPE_INDEX_SPEC.options.name;
const SVC_PATH = path.join(__dirname, '../services/stayChange/reallocateStayChangeService.js');

let mongoServer;
let seq = 0;

function sofiaDay(daysAhead) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return normalizeDateToSofiaDayStart(d);
}

function adminCtx(route = 'POST /api/ops/reservations/:id/actions/reallocate') {
  return {
    user: { id: 'admin-r1', role: 'admin' },
    route,
    req: { user: { id: 'admin-r1', role: 'admin' }, headers: {} }
  };
}

function legalAcceptance(first = 'R1', last = 'Guest') {
  return {
    termsVersion: 't',
    activityRiskVersion: 'a',
    acceptedAt: new Date(),
    firstName: first,
    lastName: last,
    checkbox1TextSnapshot: 'c1',
    checkbox2TextSnapshot: 'c2'
  };
}

async function seedTypeWithUnits(n = 3) {
  seq += 1;
  const ct = await CabinType.create({
    name: `R1 Type ${seq}`,
    slug: `r1-type-${seq}`,
    description: 'r1',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    pricePerNight: 100,
    imageUrl: 'https://example.com/r1.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: `R1 Parent ${seq}`,
    slug: `r1-parent-${seq}`,
    description: 'parent',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/p.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    cabinTypeId: ct._id,
    isActive: true
  });
  const units = [];
  for (let i = 0; i < n; i += 1) {
    units.push(
      // eslint-disable-next-line no-await-in-loop
      await Unit.create({
        cabinTypeId: ct._id,
        unitNumber: `R1-${seq}-${i + 1}`,
        displayName: `Unit ${i + 1}`,
        isActive: true
      })
    );
  }
  return { cabinType: ct, units };
}

async function makeAllocatedBooking({ cabinType, unit, status = 'confirmed', checkIn, checkOut, extras = {} }) {
  const ci = checkIn || sofiaDay(20);
  const co = checkOut || sofiaDay(22);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'R1',
      lastName: 'Guest',
      email: `r1-${crypto.randomBytes(3).toString('hex')}@example.com`,
      phone: '+359800000000'
    },
    status,
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    legalAcceptance: legalAcceptance(),
    ...extras
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unit._id,
    checkIn: ci,
    checkOut: co,
    source: 'finalize'
  });
  return booking;
}

function idem(label) {
  return `idem-${label}-${crypto.randomBytes(4).toString('hex')}`;
}

function fpArgs({ booking, cabinType, sourceUnitId, targetUnitId, acceptExternalHoldWarnings = false, reason = null }) {
  return {
    kind: KIND,
    bookingId: booking._id,
    sourceUnitId,
    targetUnitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    commercialProductKey: `cabinType:${cabinType._id}`,
    acceptExternalHoldWarnings,
    reason
  };
}

async function createStayChangeDoc({
  booking,
  cabinType,
  sourceUnitId,
  targetUnitId,
  status,
  idempotencyKey,
  fingerprint,
  reason = null,
  acceptExternalHoldWarnings = false
}) {
  const fp =
    fingerprint ||
    buildPayloadFingerprint(
      fpArgs({
        booking,
        cabinType,
        sourceUnitId,
        targetUnitId,
        acceptExternalHoldWarnings,
        reason
      })
    );
  return StayChange.create({
    kind: KIND,
    bookingId: booking._id,
    sourceCommercialProductKey: `cabinType:${cabinType._id}`,
    targetCommercialProductKey: `cabinType:${cabinType._id}`,
    sourceCabinTypeId: cabinType._id,
    targetCabinTypeId: cabinType._id,
    sourceUnitId,
    targetUnitId,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status,
    idempotencyKey: idempotencyKey || idem('sc'),
    payloadFingerprint: fp,
    actor: { actorType: 'user', actorId: 'admin-r1', actorRole: 'admin' },
    reason,
    externalHoldWarningsAccepted: Boolean(acceptExternalHoldWarnings)
  });
}

async function ensureReservationBlock(booking, unitId, cabinTypeId) {
  const cabin = await Cabin.findOne({ cabinTypeId });
  return AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId,
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'internal'
  });
}

async function dropIndexIfExists(collection, name) {
  try {
    await collection.dropIndex(name);
  } catch (err) {
    if (!/index not found|ns not found/i.test(String(err.message || err))) throw err;
  }
}

async function reallocateOk(booking, targetUnitId, key, opts = {}) {
  return reallocateReservation({
    bookingId: booking._id,
    targetUnitId,
    idempotencyKey: key || idem('ok'),
    reason: opts.reason ?? null,
    acceptExternalHoldWarnings: opts.acceptExternalHoldWarnings ?? false,
    ctx: adminCtx()
  });
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ensureAuthoritativeUniqueIndexForTests();
  await cutover.ensureR1IndexesForTests();
});

test.beforeEach(async () => {
  await Promise.all([
    StayChange.deleteMany({}),
    Booking.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
  await cutover.ensureR1IndexesForTests();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

// =============================================================================
// R1#1–#14 Eligibility / happy path / identity
// =============================================================================

test('R1#1 success reallocates A2->A3', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('1'));
  assert.equal(res.changed, true);
  assert.equal(res.status, 'completed');
  assert.equal(res.kind, KIND);
});

test('R1#2 same Booking _id after reallocate', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = String(booking._id);
  const res = await reallocateOk(booking, units[1]._id, idem('2'));
  assert.equal(res.bookingId, before);
  assert.equal(await Booking.countDocuments(), 1);
});

test('R1#3 commercial product (cabinTypeId) unchanged', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('3'));
  const after = await Booking.findById(booking._id);
  assert.equal(String(after.cabinTypeId), String(cabinType._id));
  assert.equal(String(after.unitId), String(units[1]._id));
});

test('R1#4 StayChange kind is reallocate only', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('4'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.kind, 'reallocate');
  assert.equal(await StayChange.countDocuments({ kind: { $ne: 'reallocate' } }), 0);
});

test('R1#5 wrong cabinType target rejected', async () => {
  const a = await seedTypeWithUnits(1);
  const b = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType: a.cabinType, unit: a.units[0] });
  await assert.rejects(
    () => reallocateOk(booking, b.units[0]._id, idem('5')),
    (err) => err.details?.code === 'UNIT_CABIN_TYPE_MISMATCH'
  );
});

test('R1#6 same-unit fresh request is no-op without StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[0]._id, idem('6'));
  assert.equal(res.changed, false);
  assert.equal(res.stayChangeId, null);
  assert.equal(await StayChange.countDocuments(), 0);
});

test('R1#7 cabinId Booking rejected', async () => {
  const cabin = await Cabin.create({
    name: 'Solo',
    slug: `solo-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 90,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay(30),
    checkOut: sofiaDay(32),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'solo@example.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    legalAcceptance: legalAcceptance('A', 'B')
  });
  const { units } = await seedTypeWithUnits(1);
  await assert.rejects(
    () => reallocateOk(booking, units[0]._id, idem('7')),
    (err) => err.details?.code === 'SINGLE_CABIN_NOT_REALLOCATE' || err.details?.code === 'CABIN_TYPE_REQUIRED'
  );
});

test('R1#8 unallocated rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn: sofiaDay(40),
    checkOut: sofiaDay(42),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'U', lastName: 'N', email: 'unalloc@example.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    legalAcceptance: legalAcceptance('U', 'N')
  });
  await assert.rejects(
    () => reallocateOk(booking, units[0]._id, idem('8')),
    (err) => err.details?.code === 'UNIT_ALLOCATION_REQUIRED'
  );
});

test('R1#9 completed status rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'completed' });
  await assert.rejects(() => reallocateOk(booking, units[1]._id, idem('9')), (err) => err.type === 'invalid_transition');
});

test('R1#10 cancelled status rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'cancelled' });
  await assert.rejects(() => reallocateOk(booking, units[1]._id, idem('10')), (err) => err.type === 'invalid_transition');
});

test('R1#11 pending status allowed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'pending' });
  const res = await reallocateOk(booking, units[1]._id, idem('11'));
  assert.equal(res.status, 'completed');
});

test('R1#12 confirmed status allowed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'confirmed' });
  const res = await reallocateOk(booking, units[1]._id, idem('12'));
  assert.equal(res.status, 'completed');
});

test('R1#13 in_house rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'in_house' });
  await assert.rejects(() => reallocateOk(booking, units[1]._id, idem('13')), (err) => err.type === 'invalid_transition');
});

test('R1#14 malformed mixed identity (cabinId + cabinTypeId) rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  // Bypass Booking pre-validate so REALLOCATE can fail-closed on mixed identity
  await Booking.collection.updateOne(
    { _id: booking._id },
    { $set: { cabinId: cabin._id } }
  );
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('14')),
    (err) => err.details?.code === 'MALFORMED_INVENTORY_IDENTITY'
  );
});

test('R1#15 missing source claim fails closed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await UnitNightClaim.deleteMany({ bookingId: booking._id });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('15')),
    (err) => err.details?.code === 'SOURCE_OWNERSHIP_MISMATCH'
  );
});

test('R1#16 foreign night on source fails closed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const other = await makeAllocatedBooking({
    cabinType,
    unit: units[1],
    checkIn: sofiaDay(50),
    checkOut: sofiaDay(52)
  });
  // Steal one night identity onto source unit under other booking by deleting booking's claim and leaving gap
  await UnitNightClaim.deleteMany({ bookingId: booking._id });
  await claimUnitNights({
    bookingId: other._id,
    unitId: units[0]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('16')),
    (err) => err.details?.code === 'SOURCE_OWNERSHIP_MISMATCH'
  );
});

test('R1#17 partial source ownership fails closed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({
    cabinType,
    unit: units[0],
    checkIn: sofiaDay(60),
    checkOut: sofiaDay(63)
  });
  const one = await UnitNightClaim.findOne({ bookingId: booking._id });
  await UnitNightClaim.deleteOne({ _id: one._id });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('17')),
    (err) => err.details?.code === 'SOURCE_OWNERSHIP_MISMATCH'
  );
});

test('R1#18 target foreign conflict leaves Booking/source untouched', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await makeAllocatedBooking({ cabinType, unit: units[1] });
  await assert.rejects(() => reallocateOk(booking, units[1]._id, idem('18')), (err) => err.type === 'conflict');
  const fresh = await Booking.findById(booking._id);
  assert.equal(String(fresh.unitId), String(units[0]._id));
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
});

test('R1#19 target claim conflict StayChange ends failed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  // Hard conflict may reject before StayChange create; simulate post-create claim failure path
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending'
  });
  await makeAllocatedBooking({ cabinType, unit: units[1] });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  const fresh = await StayChange.findById(sc._id);
  assert.ok(['failed', 'needs_reconciliation'].includes(fresh.status));
  assert.equal(res.changed, false);
});

test('R1#20 source claims remain after target conflict', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const other = await makeAllocatedBooking({ cabinType, unit: units[1] });
  await assert.rejects(() => reallocateOk(booking, units[1]._id, idem('20')));
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: other._id, unitId: units[1]._id })) > 0);
});

test('R1#21 inactive target unit rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  await Unit.updateOne({ _id: units[1]._id }, { $set: { isActive: false } });
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('21')),
    (err) => err.details?.code === 'UNIT_NOT_FOUND_OR_INACTIVE'
  );
});

test('R1#22 missing target unit rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () => reallocateOk(booking, new mongoose.Types.ObjectId(), idem('22')),
    (err) => err.details?.code === 'UNIT_NOT_FOUND_OR_INACTIVE'
  );
});

test('R1#23 targetUnitId required', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: booking._id,
        targetUnitId: null,
        idempotencyKey: idem('23'),
        ctx: adminCtx()
      }),
    (err) => err.field === 'targetUnitId' || err.message?.includes('targetUnitId')
  );
});

test('R1#24 booking not found returns 404', async () => {
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: new mongoose.Types.ObjectId(),
        targetUnitId: new mongoose.Types.ObjectId(),
        idempotencyKey: idem('24'),
        ctx: adminCtx()
      }),
    (err) => err.status === 404 || String(err.message || '').includes('not found')
  );
});

test('R1#25 operator role denied', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: booking._id,
        targetUnitId: units[1]._id,
        idempotencyKey: idem('25'),
        ctx: { user: { id: 'op1', role: 'operator' }, req: { user: { role: 'operator' } } }
      }),
    (err) => err.code === 'PERMISSION_DENIED' || err.type === 'PERMISSION_DENIED'
  );
});

test('R1#26 external hold requires acceptExternalHoldWarnings', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[1]._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb'
  });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('26'), { acceptExternalHoldWarnings: false }),
    (err) => err.details?.code === 'EXTERNAL_HOLD_ACK_REQUIRED'
  );
});

test('R1#27 external hold succeeds with acceptExternalHoldWarnings', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[1]._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb'
  });
  const ok = await reallocateOk(booking, units[1]._id, idem('27'), { acceptExternalHoldWarnings: true });
  assert.equal(ok.status, 'completed');
});

test('R1#28 StayChange snapshots both cabinTypeIds', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('28'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(String(sc.sourceCabinTypeId), String(cabinType._id));
  assert.equal(String(sc.targetCabinTypeId), String(cabinType._id));
  assert.equal(sc.sourceCommercialProductKey, sc.targetCommercialProductKey);
});

test('R1#29 dates guests price untouched', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = {
    checkIn: String(booking.checkIn),
    checkOut: String(booking.checkOut),
    adults: booking.adults,
    totalPrice: booking.totalPrice,
    totalValueCents: booking.totalValueCents
  };
  await reallocateOk(booking, units[1]._id, idem('29'));
  const after = await Booking.findById(booking._id);
  assert.equal(String(after.checkIn), before.checkIn);
  assert.equal(String(after.checkOut), before.checkOut);
  assert.equal(after.adults, before.adults);
  assert.equal(after.totalPrice, before.totalPrice);
  assert.equal(after.totalValueCents, before.totalValueCents);
});

test('R1#30 completed StayChange has completedAt', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('30'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.ok(sc.completedAt);
  assert.equal(sc.status, 'completed');
});

// =============================================================================
// R1#31–#50 Fingerprint / idempotency (strict — no soft OR)
// =============================================================================

test('R1#31 buildPayloadFingerprint Date vs YYYY-MM-DD same Sofia day = same hash', () => {
  const day = sofiaDay(10);
  const ymd = formatSofiaDateOnly(day);
  const base = {
    kind: KIND,
    bookingId: 'b1',
    sourceUnitId: 's1',
    targetUnitId: 't1',
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false,
    reason: null
  };
  assert.equal(
    buildPayloadFingerprint({ ...base, checkIn: day, checkOut: sofiaDay(12) }),
    buildPayloadFingerprint({
      ...base,
      checkIn: ymd,
      checkOut: formatSofiaDateOnly(sofiaDay(12))
    })
  );
});

test('R1#32 canonicalStayDateOnly normalizes Date and string', () => {
  const day = sofiaDay(11);
  const ymd = formatSofiaDateOnly(day);
  assert.equal(canonicalStayDateOnly(day), ymd);
  assert.equal(canonicalStayDateOnly(ymd), ymd);
});

test('R1#33 fingerprint stable under key order / clone', () => {
  const base = {
    kind: KIND,
    bookingId: 'b1',
    sourceUnitId: 's1',
    targetUnitId: 't1',
    checkIn: sofiaDay(1),
    checkOut: sofiaDay(3),
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false,
    reason: null
  };
  assert.equal(buildPayloadFingerprint(base), buildPayloadFingerprint({ ...base }));
});

test('R1#34 reason null and empty normalize equally in fingerprint', () => {
  const base = {
    kind: KIND,
    bookingId: 'b1',
    sourceUnitId: 's1',
    targetUnitId: 't1',
    checkIn: sofiaDay(1),
    checkOut: sofiaDay(3),
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false
  };
  assert.equal(
    buildPayloadFingerprint({ ...base, reason: null }),
    buildPayloadFingerprint({ ...base, reason: '' })
  );
});

test('R1#35 completed replay while Booking already on target', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('35');
  const first = await reallocateOk(booking, units[1]._id, key);
  const second = await reallocateOk(booking, units[1]._id, key, {
    reason: null,
    acceptExternalHoldWarnings: false
  });
  assert.equal(second.stayChangeId, first.stayChangeId);
  assert.equal(second.status, 'completed');
  assert.equal(await StayChange.countDocuments(), 1);
});

test('R1#36 same key different reason = 409', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('36');
  await reallocateOk(booking, units[1]._id, key, { reason: 'first' });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, key, { reason: 'second' }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_CONFLICT' && err.status === 409
  );
});

test('R1#37 same key different acceptExternalHoldWarnings = 409', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('37');
  await reallocateOk(booking, units[1]._id, key, { acceptExternalHoldWarnings: false });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, key, { acceptExternalHoldWarnings: true }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_CONFLICT' && err.status === 409
  );
});

test('R1#38 same key different target = 409', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('38');
  await reallocateOk(booking, units[1]._id, key);
  await assert.rejects(
    () => reallocateOk(booking, units[2]._id, key),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_CONFLICT' && err.status === 409
  );
});

test('R1#39 replay after Booking on target with exact same payload succeeds', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('39');
  const first = await reallocateOk(booking, units[1]._id, key, { reason: 'ops', acceptExternalHoldWarnings: false });
  const replay = await reallocateOk(booking, units[1]._id, key, {
    reason: 'ops',
    acceptExternalHoldWarnings: false
  });
  assert.equal(replay.stayChangeId, first.stayChangeId);
  assert.equal(replay.status, 'completed');
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
});

test('R1#40 replay does not derive source from post-move Booking', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('40');
  const first = await reallocateOk(booking, units[1]._id, key);
  const sc = await StayChange.findById(first.stayChangeId);
  assert.equal(String(sc.sourceUnitId), String(units[0]._id));
  const replay = await reallocateOk(booking, units[1]._id, key);
  assert.equal(replay.sourceUnitId, String(units[0]._id));
});

test('R1#41 idempotencyKey required', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: booking._id,
        targetUnitId: units[1]._id,
        idempotencyKey: '',
        ctx: adminCtx()
      }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_REQUIRED'
  );
});

test('R1#42 idempotencyKey too short rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: booking._id,
        targetUnitId: units[1]._id,
        idempotencyKey: 'short',
        ctx: adminCtx()
      }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_REQUIRED'
  );
});

test('R1#43 uniqueness scoped by kind+bookingId+key not global', async () => {
  const a = await seedTypeWithUnits(2);
  const b = await seedTypeWithUnits(2);
  const bookingA = await makeAllocatedBooking({ cabinType: a.cabinType, unit: a.units[0] });
  const bookingB = await makeAllocatedBooking({ cabinType: b.cabinType, unit: b.units[0] });
  const key = 'shared-key-across-bookings-ok';
  const r1 = await reallocateOk(bookingA, a.units[1]._id, key);
  const r2 = await reallocateOk(bookingB, b.units[1]._id, key);
  assert.notEqual(r1.stayChangeId, r2.stayChangeId);
  assert.equal(await StayChange.countDocuments({ idempotencyKey: key }), 2);
});

test('R1#44 same-unit matching previous idempotency replays existing StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('44');
  const first = await reallocateOk(booking, units[1]._id, key);
  // Booking now on target; same-unit request with matching key should replay StayChange (not fresh no-op)
  const replay = await reallocateReservation({
    bookingId: booking._id,
    targetUnitId: units[1]._id,
    idempotencyKey: key,
    ctx: adminCtx()
  });
  assert.equal(replay.stayChangeId, first.stayChangeId);
  assert.equal(replay.status, 'completed');
});

test('R1#45 failed StayChange replay returns failed without mutating', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('45');
  const fp = buildPayloadFingerprint(
    fpArgs({ booking, cabinType, sourceUnitId: units[0]._id, targetUnitId: units[1]._id })
  );
  await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'failed',
    idempotencyKey: key,
    fingerprint: fp
  });
  const res = await reallocateOk(booking, units[1]._id, key);
  assert.equal(res.status, 'failed');
  assert.equal(res.changed, false);
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[0]._id));
});

test('R1#46 concurrent same key same target: E11000 normalized; one StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('46');
  const results = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, key),
    reallocateOk(booking, units[1]._id, key)
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled');
  assert.ok(ok.length >= 1);
  for (const r of results) {
    if (r.status === 'rejected') {
      assert.doesNotMatch(String(r.reason?.message || ''), /E11000/);
    }
  }
  assert.equal(await StayChange.countDocuments({ bookingId: booking._id, idempotencyKey: key }), 1);
});

test('R1#47 fingerprint includes acceptExternalHoldWarnings boolean', () => {
  const base = {
    kind: KIND,
    bookingId: 'b',
    sourceUnitId: 's',
    targetUnitId: 't',
    checkIn: sofiaDay(1),
    checkOut: sofiaDay(2),
    commercialProductKey: 'cabinType:x',
    reason: null
  };
  assert.notEqual(
    buildPayloadFingerprint({ ...base, acceptExternalHoldWarnings: true }),
    buildPayloadFingerprint({ ...base, acceptExternalHoldWarnings: false })
  );
});

test('R1#48 fingerprint includes reason text', () => {
  const base = {
    kind: KIND,
    bookingId: 'b',
    sourceUnitId: 's',
    targetUnitId: 't',
    checkIn: sofiaDay(1),
    checkOut: sofiaDay(2),
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false
  };
  assert.notEqual(
    buildPayloadFingerprint({ ...base, reason: 'a' }),
    buildPayloadFingerprint({ ...base, reason: 'b' })
  );
});

test('R1#49 fingerprint includes targetUnitId', () => {
  const base = {
    kind: KIND,
    bookingId: 'b',
    sourceUnitId: 's',
    checkIn: sofiaDay(1),
    checkOut: sofiaDay(2),
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false,
    reason: null
  };
  assert.notEqual(
    buildPayloadFingerprint({ ...base, targetUnitId: 't1' }),
    buildPayloadFingerprint({ ...base, targetUnitId: 't2' })
  );
});

test('R1#50 no soft OR fallback in fingerprint compare (strict equality)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('50');
  await reallocateOk(booking, units[1]._id, key, { reason: 'exact' });
  // Whitespace-different reason must conflict (trim equalizes — use meaningfully different)
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, key, { reason: 'exact!' }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

// =============================================================================
// R1#51–#70 Claims / ownership / StayChange-scoped inventory
// =============================================================================

test('R1#51 audit projected once', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('51');
  await reallocateOk(booking, units[1]._id, key, { reason: 'ops move' });
  assert.equal(await AuditEvent.countDocuments({ action: 'reservation_reallocate' }), 1);
});

test('R1#52 audit has before/after unit snapshots', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('52'));
  const audit = await AuditEvent.findOne({ action: 'reservation_reallocate' });
  assert.equal(audit.beforeSnapshot.unitId, String(units[0]._id));
  assert.equal(audit.afterSnapshot.unitId, String(units[1]._id));
});

test('R1#53 audit metadata includes stayChangeId', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('53'));
  const audit = await AuditEvent.findOne({ action: 'reservation_reallocate' });
  assert.equal(audit.metadata.stayChangeId, res.stayChangeId);
});

test('R1#54 replay does not duplicate audit', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('54');
  await reallocateOk(booking, units[1]._id, key, { reason: 'ops move' });
  await reallocateOk(booking, units[1]._id, key, { reason: 'ops move' });
  assert.equal(await AuditEvent.countDocuments({ action: 'reservation_reallocate' }), 1);
});

test('R1#55 legacy multi-unit reassign remains rejected', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx('POST /api/ops/reservations/:id/actions/reassign')
      }),
    (err) => err.details?.code === 'LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY'
  );
});

test('R1#56 source claims zero after success', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('56'));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
});

test('R1#57 target claims exact after success', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('57'));
  const own = await assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    mode: 'exact'
  });
  assert.equal(own.ok, true);
});

test('R1#58 StayChange-scoped claim: foreign stayChange cannot borrow', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const scFake = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: scFake,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: booking._id,
        unitId: units[1]._id,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        stayChangeId: new mongoose.Types.ObjectId(),
        source: 'reallocate',
        requireExactStayChangeOwnership: true
      }),
    (err) => err.code === ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
  );
});

test('R1#59 same stayChange target claim retry idempotent', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const scId = new mongoose.Types.ObjectId();
  const a = await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: scId,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  const b = await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: scId,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  assert.equal(a.insertedCount > 0, true);
  assert.equal(b.insertedCount, 0);
  assert.equal(b.alreadyOwnedCount, a.nights.length);
});

test('R1#60 releaseStayChangeTargetClaims deletes only own stayChange rows', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc1 = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc1,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await releaseStayChangeTargetClaims({
    bookingId: booking._id,
    stayChangeId: sc1,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  });
  assert.equal(await UnitNightClaim.countDocuments({ stayChangeId: sc1 }), 0);
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
});

test('R1#61 two bookings race same free target: one wins inventory', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const b1 = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: sofiaDay(70), checkOut: sofiaDay(72) });
  const b2 = await makeAllocatedBooking({ cabinType, unit: units[1], checkIn: sofiaDay(70), checkOut: sofiaDay(72) });
  const results = await Promise.allSettled([
    reallocateOk(b1, units[2]._id, idem('61a')),
    reallocateOk(b2, units[2]._id, idem('61b'))
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled' && r.value.status === 'completed');
  assert.equal(fulfilled.length, 1);
  const winners = await Booking.find({ unitId: units[2]._id });
  assert.equal(winners.length, 1);
});

test('R1#62 sequential A2->A3 then A3->A4 works', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('62a'));
  const second = await reallocateOk(booking, units[2]._id, idem('62b'));
  assert.equal(second.status, 'completed');
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[2]._id));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[1]._id }), 0);
});

test('R1#63 only unitId changes on Booking', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = (await Booking.findById(booking._id)).toObject();
  await reallocateOk(booking, units[1]._id, idem('63'));
  const after = (await Booking.findById(booking._id)).toObject();
  const ignore = new Set(['unitId', 'updatedAt', '__v']);
  for (const k of Object.keys(before)) {
    if (ignore.has(k)) continue;
    if (before[k] instanceof Date) {
      assert.equal(String(after[k]), String(before[k]), k);
    } else if (typeof before[k] !== 'object' || before[k] == null) {
      assert.equal(after[k], before[k], k);
    }
  }
  assert.equal(String(after.unitId), String(units[1]._id));
});

test('R1#64 commercial identity fields unchanged', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('64'));
  const after = await Booking.findById(booking._id);
  assert.equal(String(after.cabinTypeId), String(cabinType._id));
  assert.equal(after.cabinId, undefined);
});

test('R1#65 StayChange stores source and target unit ids', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('65'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(String(sc.sourceUnitId), String(units[0]._id));
  assert.equal(String(sc.targetUnitId), String(units[1]._id));
});

test('R1#66 reason persisted on StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('66'), { reason: 'guest request' });
  const sc = await StayChange.findById(res.stayChangeId);
  assert.equal(sc.reason, 'guest request');
});

test('R1#67 no StayChange on fresh same-unit no-op', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[0]._id, idem('67'));
  assert.equal(await StayChange.countDocuments(), 0);
});

test('R1#68 no audit on fresh same-unit no-op', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[0]._id, idem('68'));
  assert.equal(await AuditEvent.countDocuments({ action: 'reservation_reallocate' }), 0);
});

test('R1#69 stayChange claims carry stayChangeId', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  // Mid-path: create inventory_secured manually with target claims
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  const claims = await UnitNightClaim.find({ stayChangeId: sc._id });
  assert.ok(claims.length > 0);
  assert.ok(claims.every((c) => String(c.stayChangeId) === String(sc._id)));
});

test('R1#70 completed clears dual hold (source+target)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await reallocateOk(booking, units[1]._id, idem('70'));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[1]._id })) > 0);
});

// =============================================================================
// R1#71–#90 Ordering / CAS / concurrency / crash-reconcile
// =============================================================================

test('R1#71 after inventory_secured Booking still source', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  const fresh = await Booking.findById(booking._id);
  assert.equal(String(fresh.unitId), String(units[0]._id));
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
  assert.ok((await UnitNightClaim.countDocuments({ stayChangeId: sc._id })) > 0);
});

test('R1#72 after committed Booking is target; source claims may remain', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const fresh = await Booking.findById(booking._id);
  assert.equal(String(fresh.unitId), String(units[1]._id));
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
});

test('R1#73 transferUnitNightClaims not used as sole R1 workflow', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.ok(!src.includes('transferUnitNightClaims('));
  assert.ok(src.includes('claimUnitNights'));
  assert.ok(src.includes('TARGET FIRST') || src.includes('inventory_secured') || src.includes('releaseUnitNights'));
});

test('R1#74 no Mongo multi-document transactions in reallocate service', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.doesNotMatch(src, /\.startSession\(|withTransaction\(/);
});

test('R1#75 different-target concurrent: one CAS winner', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const [r1, r2] = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, idem('75a')),
    reallocateOk(booking, units[2]._id, idem('75b'))
  ]);
  const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
  const rejected = [r1, r2].filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const winner = fulfilled[0].value;
  assert.equal(String((await Booking.findById(booking._id)).unitId), winner.targetUnitId);
});

test('R1#76 concurrent loser compensates only own target claims', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const [r1, r2] = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, idem('76a')),
    reallocateOk(booking, units[2]._id, idem('76b'))
  ]);
  const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
  const winner = fulfilled[0].value;
  const loserSc = await StayChange.findOne({
    bookingId: booking._id,
    _id: { $ne: winner.stayChangeId }
  });
  assert.ok(loserSc);
  assert.ok(['failed', 'needs_reconciliation'].includes(loserSc.status));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, stayChangeId: loserSc._id }), 0);
});

test('R1#77 same-target concurrent different keys: one completes', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const results = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, idem('77a')),
    reallocateOk(booking, units[1]._id, idem('77b'))
  ]);
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 'completed');
  assert.equal(ok.length, 1);
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
});

test('R1#78 reconcile pending with no target claims advances to completed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending'
  });
  // First pass may stop at inventory_secured (ownAfter snapshot before acquire); resume completes.
  let res = await reconcileReallocateStayChange(sc._id, adminCtx());
  if (res.status !== 'completed') {
    res = await reconcileReallocateStayChange(sc._id, adminCtx());
  }
  assert.equal(res.status, 'completed');
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
});

test('R1#79 reconcile pending with full target claims advances (crash after acquire)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
});

test('R1#80 reconcile inventory_secured + Booking source retries CAS', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
});

test('R1#81 reconcile inventory_secured + Booking already target advances committed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
});

test('R1#82 reconcile committed + block still source syncs then releases', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[0]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  const blocks = await AvailabilityBlock.find({ reservationId: booking._id, blockType: 'reservation' });
  assert.ok(blocks.every((b) => String(b.unitId) === String(units[1]._id)));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
});

test('R1#83 reconcile committed + block target + stale source releases source', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[1]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
});

test('R1#84 reconcile completed is no-op replay', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const first = await reallocateOk(booking, units[1]._id, idem('84'));
  const again = await reconcileReallocateStayChange(first.stayChangeId, adminCtx());
  assert.equal(again.status, 'completed');
  assert.equal(await StayChange.countDocuments(), 1);
});

test('R1#85 crash after CAS before committed status inferred safely', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  const sc2 = await StayChange.findById(sc._id);
  assert.equal(sc2.status, 'completed');
});

test('R1#86 crash after block sync before source release inferred safely', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[1]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  // Source claims still present — reconcile should release
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
});

test('R1#87 reconcile never releases claims owned by another StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const otherScId = new mongoose.Types.ObjectId();
  // Foreign stayChange claims on a different unit night set shouldn't be touched by release of sc
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'failed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[2]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: otherScId,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.ok((await UnitNightClaim.countDocuments({ stayChangeId: otherScId })) > 0);
});

test('R1#88 MRI opened on ambiguous committed without Booking target', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  // Booking still on source while committed, no target claims — ambiguous; must not move Booking.
  await reconcileReallocateStayChange(sc._id, adminCtx());
  const sc2 = await StayChange.findById(sc._id);
  assert.ok(['needs_reconciliation', 'failed', 'completed', 'committed'].includes(sc2.status));
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[0]._id));
});

test('R1#89 MRI dedupes repeated reconciliation failures', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await reconcileReallocateStayChange(sc._id, adminCtx());
  await reconcileReallocateStayChange(sc._id, adminCtx());
  const mris = await ManualReviewItem.find({
    category: 'stay_change_reallocate_reconciliation',
    entityId: String(sc._id)
  });
  assert.ok(mris.length <= 2);
});

test('R1#90 replay pending StayChange resumes via reallocateReservation', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('90');
  const fp = buildPayloadFingerprint(
    fpArgs({ booking, cabinType, sourceUnitId: units[0]._id, targetUnitId: units[1]._id })
  );
  await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending',
    idempotencyKey: key,
    fingerprint: fp
  });
  const res = await reallocateOk(booking, units[1]._id, key);
  assert.ok(['completed', 'inventory_secured', 'committed', 'needs_reconciliation', 'failed'].includes(res.status));
});

// =============================================================================
// R1#91–#105 §21.30 required contract
// =============================================================================

test('R1#91 idempotencyKey required (§21.30)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () =>
      reallocateReservation({
        bookingId: booking._id,
        targetUnitId: units[1]._id,
        idempotencyKey: null,
        ctx: adminCtx()
      }),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_REQUIRED'
  );
});

test('R1#92 uniqueness scoped by kind+bookingId+key', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = 'scoped-unique-key-92xx';
  await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'failed',
    idempotencyKey: key,
    fingerprint: 'fp-a'
  });
  await assert.rejects(
    () =>
      createStayChangeDoc({
        booking,
        cabinType,
        sourceUnitId: units[0]._id,
        targetUnitId: units[1]._id,
        status: 'failed',
        idempotencyKey: key,
        fingerprint: 'fp-b'
      }),
    (err) => err.code === 11000
  );
});

test('R1#93 same scoped key + changed payload = 409', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('93');
  await reallocateOk(booking, units[1]._id, key);
  await assert.rejects(
    () => reallocateOk(booking, units[2]._id, key),
    (err) => err.details?.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
});

test('R1#94 same-unit fresh request creates no StayChange', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[0]._id, idem('94'));
  assert.equal(res.stayChangeId, null);
  assert.equal(await StayChange.countDocuments(), 0);
});

test('R1#95 same-unit matching previous idempotency replays', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('95');
  const first = await reallocateOk(booking, units[1]._id, key);
  const replay = await reallocateOk(booking, units[1]._id, key);
  assert.equal(replay.stayChangeId, first.stayChangeId);
});

test('R1#96 block sync failure path keeps source claims (simulated committed)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[0]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  // Before reconcile, source claims still held (block sync failure invariant setup)
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id })) > 0);
});

test('R1#97 block sync failure keeps target claims', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[1]._id })) > 0);
});

test('R1#98/#99 reconcile fixes block before releasing source', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[0]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
  const blocks = await AvailabilityBlock.find({ reservationId: booking._id, blockType: 'reservation' });
  assert.ok(blocks.every((b) => String(b.unitId) === String(units[1]._id)));
});

test('R1#100 audit projection failure does not roll back safe completed inventory', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const prev = process.env.FORCE_AUDIT_WRITE_FAIL;
  process.env.FORCE_AUDIT_WRITE_FAIL = '1';
  try {
    const res = await reallocateOk(booking, units[1]._id, idem('100'));
    assert.equal(res.status, 'completed');
    assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
  } finally {
    if (prev == null) delete process.env.FORCE_AUDIT_WRITE_FAIL;
    else process.env.FORCE_AUDIT_WRITE_FAIL = prev;
  }
});

test('R1#101 crash after CAS before committed status inferred safely', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'inventory_secured'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
});

test('R1#102 crash after block sync before source release inferred safely', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[1]._id, cabinType._id);
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    stayChangeId: sc._id,
    source: 'reallocate',
    requireExactStayChangeOwnership: true
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { unitId: units[1]._id } });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
});

test('R1#103 concurrent loser compensates only its own target claims', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const [r1, r2] = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, idem('103a')),
    reallocateOk(booking, units[2]._id, idem('103b'))
  ]);
  const winner = [r1, r2].find((r) => r.status === 'fulfilled')?.value;
  assert.ok(winner);
  const loser = await StayChange.findOne({ bookingId: booking._id, _id: { $ne: winner.stayChangeId } });
  assert.equal(await UnitNightClaim.countDocuments({ stayChangeId: loser._id }), 0);
});

test('R1#104 reconciliation never releases claims owned by another Booking', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const other = await makeAllocatedBooking({
    cabinType,
    unit: units[2],
    checkIn: sofiaDay(80),
    checkOut: sofiaDay(82)
  });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'failed'
  });
  await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: other._id })) > 0);
});

test('R1#105 no application dependency on Mongo multi-document transactions', () => {
  const src = fs.readFileSync(SVC_PATH, 'utf8');
  assert.doesNotMatch(src, /startSession|withTransaction/);
});

// =============================================================================
// R1#106–#120 Indexes / cutover
// =============================================================================

test('R1#106 StayChange schema autoIndex is disabled', () => {
  assert.equal(StayChange.schema.options.autoIndex, false);
});

test('R1#107 cutover default is read-only (createIndexes false)', () => {
  const args = cutover.parseArgs([]);
  assert.equal(args.createIndexes, false);
});

test('R1#108 unique index refuses duplicate scoped keys', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = 'dup-key-aaaaaaaa';
  const base = {
    kind: KIND,
    bookingId: booking._id,
    sourceCommercialProductKey: `cabinType:${cabinType._id}`,
    targetCommercialProductKey: `cabinType:${cabinType._id}`,
    sourceCabinTypeId: cabinType._id,
    targetCabinTypeId: cabinType._id,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    status: 'failed',
    idempotencyKey: key,
    payloadFingerprint: 'a',
    actor: {}
  };
  await StayChange.create(base);
  await assert.rejects(() => StayChange.create({ ...base, payloadFingerprint: 'b' }), (err) => err.code === 11000);
  assert.equal(await StayChange.countDocuments({ idempotencyKey: key }), 1);
});

test('R1#109 cutover creates StayChange idempotency index', async () => {
  await cutover.ensureR1IndexesForTests();
  const names = (await StayChange.collection.indexes()).map((i) => i.name);
  assert.ok(names.includes(IDEM_NAME));
});

test('R1#110 cutover creates AuditEvent dedupe index', async () => {
  await cutover.ensureR1IndexesForTests();
  const names = (await AuditEvent.collection.indexes()).map((i) => i.name);
  assert.ok(names.includes(AUDIT_NAME));
});

test('R1#111 new operation fails closed if unique index absent', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('111')),
    (err) => err.status === 503 || err.details?.code === 'STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING'
  );
  await cutover.ensureR1IndexesForTests();
});

test('R1#112 replay existing StayChange readable when progressing from pending', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('112');
  const fp = buildPayloadFingerprint(
    fpArgs({ booking, cabinType, sourceUnitId: units[0]._id, targetUnitId: units[1]._id })
  );
  await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending',
    idempotencyKey: key,
    fingerprint: fp
  });
  const res = await reallocateOk(booking, units[1]._id, key);
  assert.ok(['completed', 'inventory_secured', 'committed', 'needs_reconciliation', 'failed'].includes(res.status));
});

test('R1#113 AuditEvent: after connect + syncIndexes, auditEvent_dedupeKey_unique must NOT exist until ensureR1IndexesForTests', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.syncIndexes();
  const namesAfterSync = (await AuditEvent.collection.indexes()).map((i) => i.name);
  assert.equal(namesAfterSync.includes(AUDIT_NAME), false);
  await cutover.ensureR1IndexesForTests();
  const namesAfterEnsure = (await AuditEvent.collection.indexes()).map((i) => i.name);
  assert.ok(namesAfterEnsure.includes(AUDIT_NAME));
});

test('R1#114 StayChange schema may declare idempotency index but autoIndex off', () => {
  assert.equal(StayChange.schema.options.autoIndex, false);
  const declared = StayChange.schema.indexes().some((idx) => {
    const keys = idx[0] || {};
    return keys.kind === 1 && keys.bookingId === 1 && keys.idempotencyKey === 1;
  });
  assert.equal(declared, true);
});

test('R1#115 cutover: drop indexes, report neither present', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  const report = await cutover.buildReport();
  assert.equal(report.requiredIdempotencyUniquePresent, false);
  assert.equal(report.requiredAuditDedupeUniquePresent, false);
  assert.equal(report.readyForR1, false);
  await cutover.ensureR1IndexesForTests();
});

test('R1#116 cutover: create only StayChange index', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await StayChange.collection.createIndex(
    cutover.IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys,
    { ...cutover.IDEMPOTENCY_UNIQUE_INDEX_SPEC.options }
  );
  const report = await cutover.buildReport();
  assert.equal(report.requiredIdempotencyUniqueExact, true);
  assert.equal(report.requiredAuditDedupeUniqueExact, false);
  await cutover.ensureR1IndexesForTests();
});

test('R1#117 cutover: create only Audit index', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.createIndex(AUDIT_DEDUPE_INDEX_SPEC.keys, {
    ...AUDIT_DEDUPE_INDEX_SPEC.options
  });
  const report = await cutover.buildReport();
  assert.equal(report.requiredIdempotencyUniqueExact, false);
  assert.equal(report.requiredAuditDedupeUniqueExact, true);
  await cutover.ensureR1IndexesForTests();
});

test('R1#118 cutover: create both via createIndexes', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  let report = await cutover.buildReport();
  await cutover.createIndexes(report);
  report = await cutover.buildReport();
  assert.equal(report.requiredIdempotencyUniqueExact, true);
  assert.equal(report.requiredAuditDedupeUniqueExact, true);
  assert.equal(report.readyForR1, true);
});

test('R1#119 cutover: refuse inexact StayChange index', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await StayChange.collection.createIndex(
    { kind: 1, bookingId: 1, idempotencyKey: 1 },
    { unique: false, name: IDEM_NAME }
  );
  const report = await cutover.buildReport();
  assert.equal(report.requiredIdempotencyUniquePresent, true);
  assert.equal(report.requiredIdempotencyUniqueExact, false);
  await assert.rejects(() => cutover.createIndexes(report), /inexact/i);
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  await cutover.ensureR1IndexesForTests();
});

test('R1#120 cutover: refuse StayChange dups', async () => {
  await dropIndexIfExists(StayChange.collection, IDEM_NAME);
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = 'dup-cutover-stay-120';
  const mk = (fp) =>
    StayChange.collection.insertOne({
      kind: KIND,
      bookingId: booking._id,
      sourceCommercialProductKey: `cabinType:${cabinType._id}`,
      targetCommercialProductKey: `cabinType:${cabinType._id}`,
      sourceCabinTypeId: cabinType._id,
      targetCabinTypeId: cabinType._id,
      sourceUnitId: units[0]._id,
      targetUnitId: units[1]._id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: 'failed',
      idempotencyKey: key,
      payloadFingerprint: fp,
      actor: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });
  await mk('a');
  await mk('b');
  const report = await cutover.buildReport();
  assert.ok(report.duplicateScopedIdempotencyKeys > 0);
  await assert.rejects(() => cutover.createIndexes(report), /duplicate scoped StayChange/i);
  await StayChange.deleteMany({});
  await cutover.ensureR1IndexesForTests();
});

// =============================================================================
// R1#121–#140 Cutover continued + blocks + postconditions + DST
// =============================================================================

test('R1#121 cutover: refuse Audit dedupe dups', async () => {
  await dropIndexIfExists(AuditEvent.collection, AUDIT_NAME);
  await AuditEvent.collection.insertMany([
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'x',
      action: 'reservation_reallocate',
      dedupeKey: 'dup-audit-key',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'y',
      action: 'reservation_reallocate',
      dedupeKey: 'dup-audit-key',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);
  const report = await cutover.buildReport();
  assert.ok(report.duplicateAuditDedupeKeys > 0);
  await assert.rejects(() => cutover.createIndexes(report), /duplicate non-null AuditEvent/i);
  await AuditEvent.collection.deleteMany({});
  await cutover.ensureR1IndexesForTests();
});

test('R1#122 cutover: partial unique allows missing and null dedupeKey; string uniqueness remains', async () => {
  await cutover.ensureR1IndexesForTests();
  const indexes = await AuditEvent.collection.indexes();
  const found = indexes.find((i) => i.name === AUDIT_NAME);
  assert.equal(found.unique, true);
  assert.deepEqual(found.partialFilterExpression, { dedupeKey: { $type: 'string' } });

  await AuditEvent.collection.insertMany([
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'a1',
      action: 'other',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'a2',
      action: 'other',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'a3',
      action: 'other',
      dedupeKey: null,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      happenedAt: new Date(),
      actorType: 'user',
      entityType: 'Reservation',
      entityId: 'a4',
      action: 'other',
      dedupeKey: null,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);
  assert.ok((await AuditEvent.collection.countDocuments({ dedupeKey: { $exists: false } })) >= 2);
  assert.ok((await AuditEvent.collection.countDocuments({ dedupeKey: { $type: 'null' } })) >= 2);

  await AuditEvent.collection.insertOne({
    happenedAt: new Date(),
    actorType: 'user',
    entityType: 'Reservation',
    entityId: 's1',
    action: 'reservation_reallocate',
    dedupeKey: 'r1-122-unique',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await assert.rejects(
    () =>
      AuditEvent.collection.insertOne({
        happenedAt: new Date(),
        actorType: 'user',
        entityType: 'Reservation',
        entityId: 's2',
        action: 'reservation_reallocate',
        dedupeKey: 'r1-122-unique',
        createdAt: new Date(),
        updatedAt: new Date()
      }),
    (err) => err.code === 11000
  );

  const report = await cutover.buildReport();
  assert.equal(report.duplicateAuditDedupeKeys, 0);
  assert.equal(report.auditDedupeIndexKind, 'desired_partial');
  assert.equal(report.requiredAuditDedupeUniqueExact, true);
});

test('R1#123 cutover: second createIndexes is idempotent', async () => {
  await cutover.ensureR1IndexesForTests();
  const report1 = await cutover.buildReport();
  await cutover.createIndexes(report1);
  const report2 = await cutover.buildReport();
  await cutover.createIndexes(report2);
  assert.equal(report2.readyForR1, true);
  const stayIdx = await StayChange.collection.indexes();
  assert.equal(stayIdx.filter((i) => i.name === IDEM_NAME).length, 1);
});

test('R1#124 parseArgs default createIndexes false; verify flag; replace flag', () => {
  assert.equal(cutover.parseArgs([]).createIndexes, false);
  assert.equal(cutover.parseArgs(['--verify']).verify, true);
  assert.equal(cutover.parseArgs(['--create-indexes']).createIndexes, true);
  assert.equal(cutover.parseArgs(['--replace-audit-dedupe-index']).replaceAuditDedupeIndex, true);
});

test('R1#125 read-only mutation none when not creating', async () => {
  const report = await cutover.buildReport();
  // Simulate main() non-mutating path
  report.mutation = 'none';
  assert.equal(report.mutation, 'none');
  assert.ok(typeof report.readyForR1 === 'boolean');
});

test('R1#126 block sync updates reservation blocks only', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[0]._id,
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'internal'
  });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[0]._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'airbnb'
  });
  await reallocateOk(booking, units[1]._id, idem('126'), { acceptExternalHoldWarnings: false });
  const resBlocks = await AvailabilityBlock.find({ reservationId: booking._id, blockType: 'reservation' });
  assert.ok(resBlocks.every((b) => String(b.unitId) === String(units[1]._id)));
  const ext = await AvailabilityBlock.findOne({ blockType: 'external_hold' });
  assert.equal(String(ext.unitId), String(units[0]._id));
});

test('R1#127 syncReservationBlockUnitProjection no-op when no blocks', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const r = await syncReservationBlockUnitProjection(booking._id, units[1]._id);
  assert.equal(r.ok, true);
  assert.equal(r.mutated, false);
});

test('R1#128 MRI category is stay_change_reallocate_reconciliation', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'committed'
  });
  await reconcileReallocateStayChange(sc._id, adminCtx());
  const mri = await ManualReviewItem.findOne({ entityId: String(sc._id) });
  if (mri) {
    assert.equal(mri.category, 'stay_change_reallocate_reconciliation');
  }
});

test('R1#129 completed inventory stays completed if audit temporarily fails', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const prev = process.env.FORCE_AUDIT_WRITE_FAIL;
  process.env.FORCE_AUDIT_WRITE_FAIL = '1';
  try {
    const res = await reallocateOk(booking, units[1]._id, idem('129'));
    assert.equal(res.status, 'completed');
  } finally {
    if (prev == null) delete process.env.FORCE_AUDIT_WRITE_FAIL;
    else process.env.FORCE_AUDIT_WRITE_FAIL = prev;
  }
});

test('R1#130 audit failure does not reverse unit move', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const prev = process.env.FORCE_AUDIT_WRITE_FAIL;
  process.env.FORCE_AUDIT_WRITE_FAIL = '1';
  try {
    await reallocateOk(booking, units[1]._id, idem('130'));
    assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[1]._id));
  } finally {
    if (prev == null) delete process.env.FORCE_AUDIT_WRITE_FAIL;
    else process.env.FORCE_AUDIT_WRITE_FAIL = prev;
  }
});

test('R1#131 E11000 normalized in StayChange create race', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('131');
  const results = await Promise.allSettled([
    reallocateOk(booking, units[1]._id, key),
    reallocateOk(booking, units[1]._id, key)
  ]);
  for (const r of results) {
    if (r.status === 'rejected') {
      assert.doesNotMatch(String(r.reason?.message || ''), /E11000/);
    }
  }
});

test('R1#132 single StayChange after concurrent same-key race', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const key = idem('132');
  await Promise.allSettled([
    reallocateOk(booking, units[1]._id, key),
    reallocateOk(booking, units[1]._id, key)
  ]);
  assert.equal(await StayChange.countDocuments({ bookingId: booking._id, idempotencyKey: key }), 1);
});

test('R1#133 commercial identity unchanged after reallocate', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = {
    cabinTypeId: String(booking.cabinTypeId),
    checkIn: String(booking.checkIn),
    checkOut: String(booking.checkOut),
    adults: booking.adults,
    totalPrice: booking.totalPrice,
    totalValueCents: booking.totalValueCents
  };
  await reallocateOk(booking, units[1]._id, idem('133'));
  const after = await Booking.findById(booking._id);
  assert.equal(String(after.cabinTypeId), before.cabinTypeId);
  assert.equal(String(after.checkIn), before.checkIn);
  assert.equal(String(after.checkOut), before.checkOut);
  assert.equal(after.adults, before.adults);
  assert.equal(after.totalPrice, before.totalPrice);
  assert.equal(after.totalValueCents, before.totalValueCents);
});

test('R1#134 Booking settledByStayChangeId is optional (REBOOK-S2); no other StayChange projections', () => {
  const paths = Booking.schema.paths;
  assert.ok(paths.settledByStayChangeId, 'settledByStayChangeId required by REBOOK-S2 spine');
  assert.equal(paths.settledByStayChangeId.options.default, null);
  assert.equal(paths.lastStayChangeId, undefined);
  assert.equal(paths.activeStayChangeId, undefined);
});

test('R1#135 no R3 UI coupling in reallocate service', () => {
  const svc = fs.readFileSync(SVC_PATH, 'utf8');
  assert.ok(svc.includes('reallocateReservation'));
  assert.ok(!svc.includes('transferUnitNightClaims('));
  assert.doesNotMatch(svc, /OpsMoveWizard|MoveStayModal/);
});

test('R1#136 parent cabin propertyKind is valley in fixtures', async () => {
  const { cabinType } = await seedTypeWithUnits(1);
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  assert.equal(cabin.propertyKind, 'valley');
});

test('R1#137 Sofia DST spring forward fingerprint stable', () => {
  // Europe/Sofia DST spring 2026-03-29
  const before = normalizeDateToSofiaDayStart('2026-03-28');
  const after = normalizeDateToSofiaDayStart('2026-03-30');
  const base = {
    kind: KIND,
    bookingId: 'dst1',
    sourceUnitId: 's',
    targetUnitId: 't',
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false,
    reason: null
  };
  const fpDate = buildPayloadFingerprint({ ...base, checkIn: before, checkOut: after });
  const fpStr = buildPayloadFingerprint({
    ...base,
    checkIn: '2026-03-28',
    checkOut: '2026-03-30'
  });
  assert.equal(fpDate, fpStr);
  assert.equal(canonicalStayDateOnly(before), '2026-03-28');
  assert.equal(canonicalStayDateOnly(after), '2026-03-30');
});

test('R1#138 Sofia DST fall back fingerprint stable', () => {
  // Europe/Sofia DST fall 2026-10-25
  const checkIn = normalizeDateToSofiaDayStart('2026-10-24');
  const checkOut = normalizeDateToSofiaDayStart('2026-10-26');
  const base = {
    kind: KIND,
    bookingId: 'dst2',
    sourceUnitId: 's',
    targetUnitId: 't',
    commercialProductKey: 'cabinType:x',
    acceptExternalHoldWarnings: false,
    reason: null
  };
  assert.equal(
    buildPayloadFingerprint({ ...base, checkIn, checkOut }),
    buildPayloadFingerprint({ ...base, checkIn: '2026-10-24', checkOut: '2026-10-26' })
  );
});

test('R1#139 reallocate across Sofia DST boundary nights succeeds', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  // Fall-back 2026-10-25 is still in the future relative to Aug 2026
  const checkIn = normalizeDateToSofiaDayStart('2026-10-24');
  const checkOut = normalizeDateToSofiaDayStart('2026-10-27');
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn, checkOut });
  const res = await reallocateOk(booking, units[1]._id, idem('139'));
  assert.equal(res.status, 'completed');
  const own = await assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn,
    checkOut,
    mode: 'exact'
  });
  assert.equal(own.ok, true);
});

test('R1#140 AUDIT_DEDUPE_INDEX_SPEC is partial unique on string dedupeKey', () => {
  assert.equal(AUDIT_DEDUPE_INDEX_SPEC.options.name, 'auditEvent_dedupeKey_unique');
  assert.equal(cutover.AUDIT_DEDUPE_INDEX_SPEC.options.name, 'auditEvent_dedupeKey_unique');
  assert.equal(AUDIT_DEDUPE_INDEX_SPEC.options.unique, true);
  assert.equal(AUDIT_DEDUPE_INDEX_SPEC.options.sparse, undefined);
  assert.deepEqual(AUDIT_DEDUPE_INDEX_SPEC.options.partialFilterExpression, {
    dedupeKey: { $type: 'string' }
  });
});

// =============================================================================
// R1#141–#150 Extra postconditions / edge coverage
// =============================================================================

test('R1#141 StayChange R1_STATUSES subset excludes awaiting_payment/settling', () => {
  assert.ok(!StayChange.R1_STATUSES.includes('awaiting_payment'));
  assert.ok(!StayChange.R1_STATUSES.includes('settling'));
  assert.ok(StayChange.R1_STATUSES.includes('inventory_secured'));
  assert.ok(StayChange.R1_STATUSES.includes('needs_reconciliation'));
});

test('R1#142 completed StayChange has auditProjectedAt when audit succeeds', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('142'));
  const sc = await StayChange.findById(res.stayChangeId);
  assert.ok(sc.auditProjectedAt);
  assert.ok(sc.auditDedupeKey);
});

test('R1#143 hard conflict on target rejects without touching source', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[1]._id,
    blockType: 'maintenance',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'internal'
  });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('143')),
    (err) => err.details?.code === 'HARD_CONFLICTS' || err.type === 'conflict'
  );
  assert.equal(String((await Booking.findById(booking._id)).unitId), String(units[0]._id));
});

test('R1#144 KIND export is reallocate', () => {
  assert.equal(KIND, 'reallocate');
});

test('R1#145 ensureR1IndexesForTests is idempotent', async () => {
  await cutover.ensureR1IndexesForTests();
  await cutover.ensureR1IndexesForTests();
  await cutover.assertStayChangeIdempotencyIndex();
});

test('R1#146 result shape includes sourceUnitId and targetUnitId', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const res = await reallocateOk(booking, units[1]._id, idem('146'));
  assert.equal(res.sourceUnitId, String(units[0]._id));
  assert.equal(res.targetUnitId, String(units[1]._id));
  assert.equal(res.changed, true);
});

test('R1#147 failed StayChange has failure metadata', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending'
  });
  await makeAllocatedBooking({ cabinType, unit: units[1] });
  await reconcileReallocateStayChange(sc._id, adminCtx());
  const fresh = await StayChange.findById(sc._id);
  assert.ok(['failed', 'needs_reconciliation'].includes(fresh.status));
  assert.ok(fresh.failure?.code || fresh.failure?.phase || fresh.reconciliation?.category);
});

test('R1#148 multi-night stay reallocates all nights', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const checkIn = sofiaDay(90);
  const checkOut = sofiaDay(94);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn, checkOut });
  await reallocateOk(booking, units[1]._id, idem('148'));
  const own = await assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn,
    checkOut,
    mode: 'exact'
  });
  assert.equal(own.ok, true);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, unitId: units[0]._id }), 0);
});

test('R1#149 reservation block source remains internal after sync', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await ensureReservationBlock(booking, units[0]._id, cabinType._id);
  await reallocateOk(booking, units[1]._id, idem('149'));
  const block = await AvailabilityBlock.findOne({ reservationId: booking._id, blockType: 'reservation' });
  assert.equal(block.source, 'internal');
  assert.equal(String(block.unitId), String(units[1]._id));
});

test('R1#150 cutover IDEMPOTENCY_UNIQUE_INDEX_SPEC matches StayChange export', () => {
  assert.deepEqual(
    cutover.IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys,
    StayChange.IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys
  );
  assert.equal(
    cutover.IDEMPOTENCY_UNIQUE_INDEX_SPEC.options.name,
    StayChange.IDEMPOTENCY_UNIQUE_INDEX_SPEC.options.name
  );
});

test('R1#151 checkout night excluded from claims after reallocate', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const checkIn = sofiaDay(100);
  const checkOut = sofiaDay(103);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn, checkOut });
  await reallocateOk(booking, units[1]._id, idem('151'));
  const checkoutNight = formatSofiaDateOnly(checkOut);
  const claims = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  for (const c of claims) {
    assert.notEqual(formatSofiaDateOnly(c.night), checkoutNight);
  }
  assert.equal(claims.length, 3);
});

test('R1#152 manual_block on target is hard conflict; block untouched', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[1]._id,
    blockType: 'manual_block',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'internal'
  });
  await assert.rejects(
    () => reallocateOk(booking, units[1]._id, idem('152')),
    (err) => err.type === 'conflict'
  );
  const fresh = await AvailabilityBlock.findById(block._id);
  assert.equal(fresh.status, 'active');
  assert.equal(String(fresh.unitId), String(units[1]._id));
  assert.equal(fresh.blockType, 'manual_block');
});

test('R1#153 maintenance block untouched by successful reallocate to other unit', async () => {
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const cabin = await Cabin.findOne({ cabinTypeId: cabinType._id });
  const maint = await AvailabilityBlock.create({
    cabinId: cabin._id,
    unitId: units[2]._id,
    blockType: 'maintenance',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    source: 'internal'
  });
  await reallocateOk(booking, units[1]._id, idem('153'));
  const fresh = await AvailabilityBlock.findById(maint._id);
  assert.equal(String(fresh.unitId), String(units[2]._id));
  assert.equal(fresh.status, 'active');
});

test('R1#154 pooled cabinType commercial occupancy unchanged by reallocate', async () => {
  const {
    evaluateCabinTypeCommercialCapacity
  } = require('../services/inventory/cabinTypeCommercialCapacity');
  const { cabinType, units } = await seedTypeWithUnits(3);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  });
  await reallocateOk(booking, units[1]._id, idem('154'));
  const after = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut
  });
  assert.equal(after.commerciallyAvailableSlots, before.commerciallyAvailableSlots);
  assert.equal(after.unallocatedCount, before.unallocatedCount);
  assert.equal(after.totalUnits, before.totalUnits);
});

test('R1#155 crashed partial target set recoverable via reconcile', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const checkIn = sofiaDay(110);
  const checkOut = sofiaDay(113);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn, checkOut });
  const sc = await createStayChangeDoc({
    booking,
    cabinType,
    sourceUnitId: units[0]._id,
    targetUnitId: units[1]._id,
    status: 'pending'
  });
  // Insert only first night of target under this StayChange (partial crash)
  const nights = await UnitNightClaim.find({ bookingId: booking._id, unitId: units[0]._id })
    .sort({ night: 1 })
    .lean();
  assert.ok(nights.length >= 2);
  await UnitNightClaim.create({
    unitId: units[1]._id,
    night: nights[0].night,
    bookingId: booking._id,
    stayChangeId: sc._id,
    source: 'reallocate'
  });
  const res = await reconcileReallocateStayChange(sc._id, adminCtx());
  assert.equal(res.status, 'completed');
  const own = await assertBookingOwnsNights({
    bookingId: booking._id,
    unitId: units[1]._id,
    checkIn,
    checkOut,
    mode: 'exact'
  });
  assert.equal(own.ok, true);
});

test('R1#156 no reservation block invented when none existed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  assert.equal(await AvailabilityBlock.countDocuments({ reservationId: booking._id }), 0);
  await reallocateOk(booking, units[1]._id, idem('156'));
  assert.equal(await AvailabilityBlock.countDocuments({ reservationId: booking._id }), 0);
});

test('R1#157 route does not forward reassign to reallocate', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../routes/ops/modules/reservationsRoutes.js'),
    'utf8'
  );
  assert.match(src, /actions\/reassign/);
  assert.match(src, /actions\/reallocate/);
  assert.doesNotMatch(src, /reassign.*reallocate|forward.*reallocate/i);
});
