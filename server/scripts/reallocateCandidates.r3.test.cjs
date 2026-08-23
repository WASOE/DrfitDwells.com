/**
 * R3 OPS Move Unit — candidates read model + detail inventory identity.
 * Spec: docs/stay-change-implementation-plan.md §22
 * Run: cd server && node --test scripts/reallocateCandidates.r3.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const StayChange = require('../models/StayChange');
const UnitNightClaim = require('../models/UnitNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

const { getReservationDetailReadModel } = require('../services/ops/readModels/reservationDetailReadModel');
const {
  getReallocateCandidatesReadModel,
  classifyCandidateState,
  safeConflictSummary
} = require('../services/ops/readModels/reallocateCandidatesReadModel');
const { evaluateTargetConflicts } = require('../services/ops/domain/conflictService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;
let seq = 0;

function sofiaDay(daysAhead) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return normalizeDateToSofiaDayStart(d);
}

function adminCtx() {
  return { user: { id: 'admin-r3', role: 'admin' } };
}

function operatorCtx() {
  return { user: { id: 'op-r3', role: 'operator' } };
}

function legalAcceptance(first = 'R3', last = 'Guest') {
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

async function seedTypeWithUnits(n = 3, { inactiveLast = false } = {}) {
  seq += 1;
  const ct = await CabinType.create({
    name: `R3 Type ${seq}`,
    slug: `r3-type-${seq}`,
    description: 'r3',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    pricePerNight: 100,
    imageUrl: 'https://example.com/r3.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: `R3 Parent ${seq}`,
    slug: `r3-parent-${seq}`,
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
    // eslint-disable-next-line no-await-in-loop
    units.push(
      await Unit.create({
        cabinTypeId: ct._id,
        unitNumber: `A${i + 1}`,
        displayName: `A-Frame A${i + 1}`,
        isActive: inactiveLast && i === n - 1 ? false : true
      })
    );
  }
  return { cabinType: ct, units };
}

async function makeAllocatedBooking({ cabinType, unit, status = 'confirmed', checkIn, checkOut }) {
  const ci = checkIn || sofiaDay(30);
  const co = checkOut || sofiaDay(32);
  return Booking.create({
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Secret',
      lastName: 'GuestPII',
      email: `secret-${crypto.randomBytes(3).toString('hex')}@example.com`,
      phone: '+359899999999'
    },
    status,
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    legalAcceptance: legalAcceptance()
  });
}

async function snapshotCounts() {
  return {
    booking: await Booking.countDocuments(),
    stayChange: await StayChange.countDocuments(),
    claims: await UnitNightClaim.countDocuments(),
    blocks: await AvailabilityBlock.countDocuments(),
    audit: await AuditEvent.countDocuments(),
    mri: await ManualReviewItem.countDocuments()
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    StayChange.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

// --- classify unit tests ---

test('R3#classify CURRENT precedence over activity', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u1', isActive: true },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: true, warnings: [{ kind: 'x' }] }
    }),
    'CURRENT'
  );
});

test('R3#classify INACTIVE before hard', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u2', isActive: false },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: true, warnings: [] }
    }),
    'INACTIVE'
  );
});

test('R3#classify HARD over EXTERNAL', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u2', isActive: true },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: true, warnings: [{ blockType: 'external_hold' }] }
    }),
    'HARD_BLOCKED'
  );
});

test('R3#classify EXTERNAL only', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u2', isActive: true },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: false, warnings: [{ blockType: 'external_hold' }] }
    }),
    'EXTERNAL_HOLD_WARNING'
  );
});

test('R3#classify AVAILABLE', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u2', isActive: true },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: false, warnings: [] }
    }),
    'AVAILABLE'
  );
});

test('R3#safeConflictSummary strips guestLabel PII', () => {
  const safe = safeConflictSummary({
    kind: 'reservation',
    reservationId: 'abc',
    guestLabel: 'Secret GuestPII',
    email: 'x@y.com',
    phone: '+1',
    startDate: sofiaDay(1),
    endDate: sofiaDay(2)
  });
  assert.equal(safe.guestLabel, undefined);
  assert.equal(safe.email, undefined);
  assert.equal(safe.phone, undefined);
  assert.equal(safe.kind, 'reservation');
  assert.equal(safe.reservationId, 'abc');
});

// --- detail inventory identity ---

test('R3#detail single-cabin cabinSummary compatible', async () => {
  const cabin = await Cabin.create({
    name: 'Solo Cabin',
    slug: `solo-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 90,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'cabin',
    isActive: true
  });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay(10),
    checkOut: sofiaDay(12),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'a@b.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    legalAcceptance: legalAcceptance()
  });
  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.ok(detail.cabinSummary);
  assert.equal(detail.cabinSummary.cabinId, String(cabin._id));
  assert.equal(detail.cabinSummary.cabinTypeId, null);
  assert.equal(detail.cabinSummary.unitId, null);
  assert.equal(detail.reservation.cabinTypeId, null);
  assert.equal(detail.reservation.unitId, null);
  assert.match(detail.cabinSummary.name || '', /Solo/);
});

test('R3#detail allocated multi exposes cabinTypeId unitId labels', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.equal(detail.cabinSummary.cabinTypeId, String(cabinType._id));
  assert.equal(detail.cabinSummary.unitId, String(units[0]._id));
  assert.equal(detail.reservation.cabinTypeId, String(cabinType._id));
  assert.equal(detail.reservation.unitId, String(units[0]._id));
  assert.ok(detail.cabinSummary.unitLabel);
  assert.ok(detail.cabinSummary.displayName.includes(detail.cabinSummary.unitLabel));
});

test('R3#detail unallocated multi has cabinTypeId without unitId', async () => {
  const { cabinType } = await seedTypeWithUnits(1);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn: sofiaDay(15),
    checkOut: sofiaDay(17),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'U', lastName: 'N', email: 'u@n.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    legalAcceptance: legalAcceptance()
  });
  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.equal(detail.cabinSummary.cabinTypeId, String(cabinType._id));
  assert.equal(detail.cabinSummary.unitId, null);
  assert.equal(detail.reservation.unitId, null);
});

// --- candidates endpoint service ---

test('R3#candidates permission denied for operator', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), operatorCtx()),
    (err) => err.code === 'PERMISSION_DENIED' || err.type === 'permission'
  );
});

test('R3#candidates same cabinType only + states', async () => {
  const a = await seedTypeWithUnits(3, { inactiveLast: true });
  const b = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType: a.cabinType, unit: a.units[0] });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.candidates.length, 3);
  assert.ok(data.candidates.every((c) => !b.units.some((u) => String(u._id) === c.unitId)));
  const byId = Object.fromEntries(data.candidates.map((c) => [c.unitId, c]));
  assert.equal(byId[String(a.units[0]._id)].state, 'CURRENT');
  assert.equal(byId[String(a.units[1]._id)].state, 'AVAILABLE');
  assert.equal(byId[String(a.units[2]._id)].state, 'INACTIVE');
});

test('R3#candidates HARD_BLOCKED on overlapping reservation', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(50);
  const co = sofiaDay(52);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  await makeAllocatedBooking({ cabinType, unit: units[1], checkIn: ci, checkOut: co });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const target = data.candidates.find((c) => c.unitId === String(units[1]._id));
  assert.equal(target.state, 'HARD_BLOCKED');
  assert.ok(target.hardConflicts.length >= 1);
  const json = JSON.stringify(target);
  assert.equal(json.includes('GuestPII'), false);
  assert.equal(json.includes('secret-'), false);
  assert.equal(json.includes('+359899999999'), false);
});

test('R3#candidates EXTERNAL_HOLD_WARNING', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(60);
  const co = sofiaDay(62);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[1]._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: ci,
    endDate: co,
    source: 'ical',
    sourceReference: `r3-ext-${Date.now()}`
  });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const target = data.candidates.find((c) => c.unitId === String(units[1]._id));
  assert.equal(target.state, 'EXTERNAL_HOLD_WARNING');
  assert.ok(target.warnings.length >= 1);
  assert.equal(target.warnings[0].blockType, 'external_hold');
});

test('R3#candidates hard + external => HARD_BLOCKED', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(70);
  const co = sofiaDay(72);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  await makeAllocatedBooking({ cabinType, unit: units[1], checkIn: ci, checkOut: co });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[1]._id,
    blockType: 'external_hold',
    status: 'active',
    startDate: ci,
    endDate: co,
    source: 'ical',
    sourceReference: `r3-both-${Date.now()}`
  });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const target = data.candidates.find((c) => c.unitId === String(units[1]._id));
  assert.equal(target.state, 'HARD_BLOCKED');
});

test('R3#candidates rejects single cabin', async () => {
  const cabin = await Cabin.create({
    name: 'Solo2',
    slug: `solo2-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 90,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'cabin',
    isActive: true
  });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay(10),
    checkOut: sofiaDay(12),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'a2@b.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    legalAcceptance: legalAcceptance()
  });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), adminCtx()),
    (err) => err.details?.code === 'SINGLE_CABIN_NOT_REALLOCATE'
  );
});

test('R3#candidates rejects unallocated', async () => {
  const { cabinType } = await seedTypeWithUnits(1);
  const booking = await Booking.create({
    cabinTypeId: cabinType._id,
    checkIn: sofiaDay(10),
    checkOut: sofiaDay(12),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'ua@b.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    legalAcceptance: legalAcceptance()
  });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), adminCtx()),
    (err) => err.details?.code === 'UNIT_ALLOCATION_REQUIRED'
  );
});

test('R3#candidates rejects ineligible status', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'in_house' });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), adminCtx()),
    (err) => err.details?.code === 'STATUS_NOT_ELIGIBLE'
  );
});

test('R3#candidates read-only — zero mutations', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const before = await snapshotCounts();
  const bookingBefore = await Booking.findById(booking._id).lean();
  await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const after = await snapshotCounts();
  assert.deepEqual(after, before);
  const bookingAfter = await Booking.findById(booking._id).lean();
  assert.equal(String(bookingAfter.unitId), String(bookingBefore.unitId));
  assert.equal(String(bookingAfter.updatedAt), String(bookingBefore.updatedAt));
  assert.equal(await StayChange.countDocuments(), 0);
});

test('R3#candidates reuses evaluateTargetConflicts (AVAILABLE matches engine)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  const engine = await evaluateTargetConflicts({
    cabinId: parent._id,
    unitId: units[1]._id,
    cabinTypeId: cabinType._id,
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    treatExternalHoldAsHard: false,
    excludeReservationId: booking._id
  });
  assert.equal(engine.hasHardConflicts, false);
  assert.equal(engine.warnings.length, 0);
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const target = data.candidates.find((c) => c.unitId === String(units[1]._id));
  assert.equal(target.state, 'AVAILABLE');
});

test('R3#candidates excludes source reservation from hard conflicts on current unit nights', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[0]._id,
    blockType: 'reservation',
    status: 'active',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    reservationId: booking._id
  });
  // Sibling remains available; current stays CURRENT without self hard-block classification path
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.candidates.find((c) => c.unitId === String(units[0]._id)).state, 'CURRENT');
  assert.equal(data.candidates.find((c) => c.unitId === String(units[1]._id)).state, 'AVAILABLE');
});

test('R3#candidates pending allocated works', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'pending' });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.candidates.length, 2);
});

test('R3#candidates rejects completed', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'completed' });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), adminCtx()),
    (err) => err.details?.code === 'STATUS_NOT_ELIGIBLE'
  );
});

test('R3#candidates rejects cancelled', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], status: 'cancelled' });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(booking._id), adminCtx()),
    (err) => err.details?.code === 'STATUS_NOT_ELIGIBLE'
  );
});

test('R3#candidates rejects malformed cabinId+cabinTypeId', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const cabin = await Cabin.create({
    name: 'Bad Solo',
    slug: `bad-solo-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 90,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'cabin',
    isActive: true
  });
  const ci = sofiaDay(10);
  const co = sofiaDay(12);
  const inserted = await Booking.collection.insertOne({
    cabinId: cabin._id,
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkIn: ci,
    checkOut: co,
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'mal@b.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await assert.rejects(
    () => getReallocateCandidatesReadModel(String(inserted.insertedId), adminCtx()),
    (err) => err.details?.code === 'MALFORMED_INVENTORY_IDENTITY'
  );
});

test('R3#detail malformed exposes both ids for UI discrimination', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const cabin = await Cabin.create({
    name: 'Bad2',
    slug: `bad2-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 90,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'cabin',
    isActive: true
  });
  const inserted = await Booking.collection.insertOne({
    cabinId: cabin._id,
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkIn: sofiaDay(10),
    checkOut: sofiaDay(12),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'mal2@b.com', phone: '+359' },
    status: 'confirmed',
    totalPrice: 180,
    subtotalPrice: 180,
    discountAmount: 0,
    totalValueCents: 18000,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const detail = await getReservationDetailReadModel(String(inserted.insertedId));
  assert.ok(detail.cabinSummary.cabinId);
  assert.ok(detail.cabinSummary.cabinTypeId);
});

test('R3#candidates DTO has required fields only', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  for (const c of data.candidates) {
    assert.ok(c.unitId);
    assert.ok(['CURRENT', 'AVAILABLE', 'HARD_BLOCKED', 'EXTERNAL_HOLD_WARNING', 'INACTIVE'].includes(c.state));
    assert.equal(typeof c.isActive, 'boolean');
    assert.ok(Array.isArray(c.hardConflicts));
    assert.ok(Array.isArray(c.warnings));
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'guestInfo'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(c, 'email'), false);
  }
});

test('R3#candidates maintenance block is HARD_BLOCKED', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(80);
  const co = sofiaDay(82);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[1]._id,
    blockType: 'maintenance',
    status: 'active',
    startDate: ci,
    endDate: co,
    source: 'ops'
  });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.candidates.find((c) => c.unitId === String(units[1]._id)).state, 'HARD_BLOCKED');
});

test('R3#candidates twice yields identical classification (idempotent read)', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const a = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const b = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.deepEqual(
    a.candidates.map((c) => ({ id: c.unitId, state: c.state })),
    b.candidates.map((c) => ({ id: c.unitId, state: c.state }))
  );
});

test('R3#safeConflictSummary null-safe', () => {
  assert.equal(safeConflictSummary(null), null);
  assert.equal(safeConflictSummary(undefined), null);
});

test('R3#classify inactive uses !== true (undefined active treated inactive)', () => {
  assert.equal(
    classifyCandidateState({
      unit: { _id: 'u2', isActive: undefined },
      bookingUnitId: 'u1',
      conflicts: { hasHardConflicts: false, warnings: [] }
    }),
    'INACTIVE'
  );
});

test('R3#candidates sourceUnitId and cabinTypeId on envelope', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.cabinTypeId, String(cabinType._id));
  assert.equal(data.sourceUnitId, String(units[0]._id));
  assert.equal(data.reservationId, String(booking._id));
  assert.ok(data.checkInDateOnly);
  assert.ok(data.checkOutDateOnly);
});

test('R3#candidates not found', async () => {
  await assert.rejects(
    () => getReallocateCandidatesReadModel(new mongoose.Types.ObjectId().toString(), adminCtx()),
    (err) => err.status === 404 || err.message.includes('not found')
  );
});

test('R3#detail missing booking returns null', async () => {
  const detail = await getReservationDetailReadModel(new mongoose.Types.ObjectId().toString());
  assert.equal(detail, null);
});

test('R3#safeConflictSummary maps availability_block', () => {
  const safe = safeConflictSummary({
    kind: 'availability_block',
    blockType: 'external_hold',
    blockId: 'b1',
    startDate: sofiaDay(1),
    endDate: sofiaDay(3),
    parentWide: false,
    guestLabel: 'Nope'
  });
  assert.equal(safe.blockType, 'external_hold');
  assert.equal(safe.guestLabel, undefined);
  assert.equal(safe.blockId, undefined);
});

test('R3#candidates CURRENT has empty conflict arrays', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const cur = data.candidates.find((c) => c.state === 'CURRENT');
  assert.deepEqual(cur.hardConflicts, []);
  assert.deepEqual(cur.warnings, []);
});

test('R3#candidates INACTIVE has empty conflict arrays', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2, { inactiveLast: true });
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  const inactive = data.candidates.find((c) => c.state === 'INACTIVE');
  assert.ok(inactive);
  assert.equal(inactive.isActive, false);
  assert.deepEqual(inactive.hardConflicts, []);
});

test('R3#candidates manual_block is HARD_BLOCKED', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(90);
  const co = sofiaDay(92);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  const parent = await Cabin.findOne({ cabinTypeId: cabinType._id });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[1]._id,
    blockType: 'manual_block',
    status: 'active',
    startDate: ci,
    endDate: co,
    source: 'ops'
  });
  const data = await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(data.candidates.find((c) => c.unitId === String(units[1]._id)).state, 'HARD_BLOCKED');
});

test('R3#read-only claim count unchanged when sibling has hard conflict', async () => {
  const { cabinType, units } = await seedTypeWithUnits(2);
  const ci = sofiaDay(100);
  const co = sofiaDay(102);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0], checkIn: ci, checkOut: co });
  await makeAllocatedBooking({ cabinType, unit: units[1], checkIn: ci, checkOut: co });
  const claimsBefore = await UnitNightClaim.countDocuments();
  await getReallocateCandidatesReadModel(String(booking._id), adminCtx());
  assert.equal(await UnitNightClaim.countDocuments(), claimsBefore);
  assert.equal(await StayChange.countDocuments(), 0);
  assert.equal(await AuditEvent.countDocuments(), 0);
  assert.equal(await ManualReviewItem.countDocuments(), 0);
});

test('R3#opsReservationDetailReadModel still returns cabinSummary with identity', async () => {
  const { cabinType, units } = await seedTypeWithUnits(1);
  const booking = await makeAllocatedBooking({ cabinType, unit: units[0] });
  const detail = await getReservationDetailReadModel(String(booking._id));
  assert.ok(detail.cabinSummary);
  assert.equal(detail.cabinSummary.cabinTypeId, String(cabinType._id));
  assert.equal(detail.cabinSummary.unitId, String(units[0]._id));
  assert.ok(detail.reservation);
});
