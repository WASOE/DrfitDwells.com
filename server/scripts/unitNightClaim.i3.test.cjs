/**
 * Inventory Integrity I3 — Edit Dates hardening + shadow UnitNightClaim sync.
 * Run: cd server && node --test scripts/unitNightClaim.i3.test.cjs
 *
 * Scenario map: comments tag #1–#45 from the I3 audit matrix.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const UnitNightClaim = require('../models/UnitNightClaim');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Cabin = require('../models/Cabin');
const ManualReviewItem = require('../models/ManualReviewItem');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');
const {
  claimUnitNights
} = require('../services/inventory/unitNightClaimService');
const {
  syncUnitNightClaimsShadow,
  SYNC_OUTCOMES,
  DATE_EDIT_SOURCE,
  MRI_CATEGORY
} = require('../services/inventory/syncUnitNightClaimsShadow');
const {
  editReservationDates,
  DATE_EDIT_CANONICAL_MRI_CATEGORY
} = require('../services/ops/domain/reservationWriteService');
const { clearAllRememberedResults } = require('../services/idempotencyService');
const { evaluateTargetConflicts } = require('../services/ops/domain/conflictService');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');

let mongoServer;
let actorSeq = 0;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function adminCtx(overrides = {}) {
  actorSeq += 1;
  return {
    user: { id: overrides.actorId || `i3-admin-${actorSeq}`, role: 'admin' },
    route: 'POST /api/ops/reservations/:id/actions/edit-dates',
    ...overrides
  };
}

async function seedMultiUnit() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const cabinType = await CabinType.create({
    name: `I3 Test A-Frames ${suffix}`,
    slug: `i3-aframes-${suffix}`,
    description: 'UnitNightClaim I3 tests',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i3.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const parentCabin = await Cabin.create({
    name: `I3 Parent ${suffix}`,
    slug: `i3-parent-${suffix}`,
    description: 'parent',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i3-parent.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true,
    cabinTypeId: cabinType._id
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I3-01',
    displayName: 'I3 Unit 1',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I3-02',
    displayName: 'I3 Unit 2',
    isActive: true
  });
  return { cabinType, parentCabin, unitA, unitB };
}

async function createAllocatedBooking(overrides = {}) {
  const seed = overrides._seed || (await seedMultiUnit());
  const checkIn = overrides.checkIn || sofiaDay('2026-09-10');
  const checkOut = overrides.checkOut || sofiaDay('2026-09-12');
  const booking = await Booking.create({
    cabinTypeId: overrides.cabinTypeId || seed.cabinType._id,
    unitId: overrides.unitId === undefined ? seed.unitA._id : overrides.unitId,
    cabinId: overrides.cabinId || null,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    isTest: false,
    isProductionSafe: false,
    guestInfo: {
      firstName: 'I3',
      lastName: 'Guest',
      email: overrides.email || 'i3-guest@example.com',
      phone: '+359000000003'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false
  });
  return { booking, ...seed, checkIn, checkOut };
}

async function createReservationBlock(booking, parentCabin, unitId = null) {
  return AvailabilityBlock.create({
    cabinId: parentCabin._id,
    unitId: unitId || booking.unitId || null,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal_admin',
    confidence: 'high'
  });
}

async function claimNightsFor(booking, unitId, checkIn, checkOut, source = 'finalize') {
  return claimUnitNights({
    bookingId: booking._id,
    unitId,
    checkIn,
    checkOut,
    source
  });
}

async function nightsOwned(bookingId) {
  const rows = await UnitNightClaim.find({ bookingId }).sort({ night: 1 }).lean();
  return rows.map((r) => formatSofiaDateOnly(r.night));
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  clearAllRememberedResults();
  await Promise.all([
    UnitNightClaim.deleteMany({}),
    Booking.deleteMany({}),
    Unit.deleteMany({}),
    CabinType.deleteMany({}),
    Cabin.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    AvailabilityBlock.deleteMany({})
  ]);
});

// --- Helper / core sync ---

test('#2/#3/#26 sync helper: extend fills added nights; checkout excluded; source=date_edit', async () => {
  const { booking, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);
  booking.checkOut = sofiaDay('2026-09-14');
  await booking.save({ validateBeforeSave: false });

  const outcome = await syncUnitNightClaimsShadow({ booking, source: DATE_EDIT_SOURCE });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.outcome, SYNC_OUTCOMES.SYNCED);
  assert.equal(outcome.source, 'date_edit');
  assert.deepEqual(outcome.requiredNights, ['2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
  assert.deepEqual(await nightsOwned(booking._id), outcome.requiredNights);
  const rows = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  assert.ok(rows.some((r) => r.source === 'date_edit'));
});

test('#4 sync helper: shrink releases surplus', async () => {
  const { booking, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-14')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);
  booking.checkOut = sofiaDay('2026-09-12');
  await booking.save({ validateBeforeSave: false });

  const outcome = await syncUnitNightClaimsShadow({ booking });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.releasedCount, 2);
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-10', '2026-09-11']);
});

test('#5/#6 sync helper: moved range fills new + releases old; overlap idempotent', async () => {
  const { booking, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-13')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);
  booking.checkIn = sofiaDay('2026-09-12');
  booking.checkOut = sofiaDay('2026-09-15');
  await booking.save({ validateBeforeSave: false });

  const outcome = await syncUnitNightClaimsShadow({ booking });
  assert.equal(outcome.ok, true);
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-12', '2026-09-13', '2026-09-14']);
});

test('#8/#9/#41 sync helper skips single-cabin, unallocated, non-blocking', async () => {
  const cabin = await Cabin.create({
    name: `I3 Single ${Date.now()}`,
    slug: `i3-single-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const single = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'A', lastName: 'B', email: 's@example.com', phone: '+1' },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  assert.equal(
    (await syncUnitNightClaimsShadow({ booking: single })).outcome,
    SYNC_OUTCOMES.SKIPPED_NOT_MULTI_UNIT
  );

  const seed = await seedMultiUnit();
  const unalloc = await Booking.create({
    cabinTypeId: seed.cabinType._id,
    unitId: null,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'U', lastName: 'N', email: 'unalloc@example.com', phone: '+1' },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  assert.equal(
    (await syncUnitNightClaimsShadow({ booking: unalloc })).outcome,
    SYNC_OUTCOMES.SKIPPED_UNALLOCATED
  );

  const { booking: completed } = await createAllocatedBooking({
    _seed: seed,
    status: 'completed',
    email: 'completed@example.com'
  });
  assert.equal(
    (await syncUnitNightClaimsShadow({ booking: completed })).outcome,
    SYNC_OUTCOMES.SKIPPED_NON_BLOCKING
  );
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: completed._id }), 0);
});

test('#14/#15/#16/#17/#18 surplus release despite foreign fill; MRI dedupe', async () => {
  const seed = await seedMultiUnit();
  const { booking, unitA, unitB } = await createAllocatedBooking({
    _seed: seed,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  const other = await createAllocatedBooking({
    _seed: seed,
    unitId: unitB._id,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    email: 'other@example.com'
  });
  // Foreign claim on a NEW night the booking will need after the move
  await claimUnitNights({
    bookingId: other.booking._id,
    unitId: unitA._id,
    nights: ['2026-09-13'],
    source: 'test'
  });

  booking.checkIn = sofiaDay('2026-09-12');
  booking.checkOut = sofiaDay('2026-09-15');
  await booking.save({ validateBeforeSave: false });

  const first = await syncUnitNightClaimsShadow({ booking });
  assert.equal(first.ok, false);
  assert.equal(first.outcome, SYNC_OUTCOMES.PARTIAL_FOREIGN);
  assert.ok(first.manualReviewItemId);
  // Surplus Sep10-11 released even though fill failed on foreign Sep13
  const owned = await nightsOwned(booking._id);
  assert.ok(!owned.includes('2026-09-10'));
  assert.ok(!owned.includes('2026-09-11'));
  // Foreign not stolen
  const foreign = await UnitNightClaim.findOne({
    unitId: unitA._id,
    bookingId: other.booking._id
  }).lean();
  assert.ok(foreign);

  const second = await syncUnitNightClaimsShadow({ booking });
  assert.equal(second.ok, false);
  const mris = await ManualReviewItem.find({
    category: MRI_CATEGORY,
    entityId: String(booking._id),
    status: 'open'
  });
  assert.equal(mris.length, 1);
});

// --- editReservationDates integration ---

test('#1/#20 extend updates Booking + reservation block + claims', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  const entityId = String(booking._id);
  const auditsBefore = await AuditEvent.countDocuments({
    action: 'reservation_edit_dates',
    entityId
  });

  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });
  assert.equal(formatSofiaDateOnly(result.checkOutDate), '2026-09-14');

  const updated = await Booking.findById(booking._id);
  assert.equal(formatSofiaDateOnly(updated.checkOut), '2026-09-14');
  const block = await AvailabilityBlock.findOne({
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active'
  }).lean();
  assert.equal(formatSofiaDateOnly(block.endDate), '2026-09-14');
  assert.deepEqual(await nightsOwned(booking._id), [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13'
  ]);
  assert.equal(
    await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
    auditsBefore + 1
  );
});

test('#14 edit path: shadow foreign failure preserves canonical success + audit', async () => {
  const seed = await seedMultiUnit();
  const { booking, parentCabin, unitA, unitB } = await createAllocatedBooking({
    _seed: seed,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  const other = await createAllocatedBooking({
    _seed: seed,
    unitId: unitB._id,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    email: 'shadow-foreign@example.com'
  });
  // Foreign claim on a night the extension will need (Sep12).
  await claimUnitNights({
    bookingId: other.booking._id,
    unitId: unitA._id,
    nights: ['2026-09-12'],
    source: 'test'
  });

  const entityId = String(booking._id);
  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });

  assert.equal(formatSofiaDateOnly(result.checkOutDate), '2026-09-14');
  const live = await Booking.findById(booking._id);
  assert.equal(formatSofiaDateOnly(live.checkOut), '2026-09-14');
  const block = await AvailabilityBlock.findOne({
    reservationId: booking._id,
    blockType: 'reservation',
    status: 'active'
  }).lean();
  assert.equal(formatSofiaDateOnly(block.endDate), '2026-09-14');
  assert.equal(
    await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
    1
  );
  const foreign = await UnitNightClaim.findOne({
    unitId: unitA._id,
    bookingId: other.booking._id
  }).lean();
  assert.ok(foreign);
  const mri = await ManualReviewItem.findOne({
    category: MRI_CATEGORY,
    entityId,
    status: 'open'
  }).lean();
  assert.ok(mri);
});

test('#7/#19 same-date retry repairs missing claims without new audit', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  // Missing claims — crash before shadow
  const entityId = String(booking._id);
  const auditsBefore = await AuditEvent.countDocuments({
    action: 'reservation_edit_dates',
    entityId
  });
  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-12',
    ctx: adminCtx()
  });
  assert.equal(result.repaired, true);
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-10', '2026-09-11']);
  assert.equal(
    await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
    auditsBefore
  );
});

test('#10/#11 unit conflict rejects; claims unchanged', async () => {
  const seed = await seedMultiUnit();
  const { booking, unitA } = await createAllocatedBooking({
    _seed: seed,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);
  await createAllocatedBooking({
    _seed: seed,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-09-12'),
    checkOut: sofiaDay('2026-09-14'),
    email: 'blocker@example.com'
  });

  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: booking._id,
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-14',
        ctx: adminCtx()
      }),
    (err) => err.type === 'conflict' && err.status === 409
  );
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-10', '2026-09-11']);
  const still = await Booking.findById(booking._id);
  assert.equal(formatSofiaDateOnly(still.checkOut), '2026-09-12');
});

test('#12 self-exclusion: extend does not conflict with self', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  const conflict = await evaluateTargetConflicts({
    cabinId: parentCabin._id,
    unitId: unitA._id,
    cabinTypeId: booking.cabinTypeId,
    startDate: sofiaDay('2026-09-10'),
    endDate: sofiaDay('2026-09-14'),
    excludeReservationId: booking._id
  });
  assert.equal(conflict.hasHardConflicts, false);

  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });
  assert.equal(formatSofiaDateOnly((await Booking.findById(booking._id)).checkOut), '2026-09-14');
});

test('#13 external hold soft warning (not hard conflict)', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await AvailabilityBlock.create({
    cabinId: parentCabin._id,
    unitId: unitA._id,
    blockType: 'external_hold',
    startDate: sofiaDay('2026-09-12'),
    endDate: sofiaDay('2026-09-14'),
    status: 'active',
    source: 'external_ics',
    confidence: 'medium'
  });

  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });
  assert.ok(Array.isArray(result.warnings));
  assert.ok(result.warnings.some((w) => w.blockType === 'external_hold'));
  assert.equal(formatSofiaDateOnly(result.checkOutDate), '2026-09-14');
});

test('#21 no reservation block path still works', async () => {
  const { booking, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-13',
    ctx: adminCtx()
  });
  assert.equal(formatSofiaDateOnly((await Booking.findById(booking._id)).checkOut), '2026-09-13');
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-10', '2026-09-11', '2026-09-12']);
});

test('#22 external hold untouched when reservation block updates', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking();
  await createReservationBlock(booking, parentCabin, unitA._id);
  const hold = await AvailabilityBlock.create({
    cabinId: parentCabin._id,
    unitId: unitA._id,
    blockType: 'external_hold',
    startDate: sofiaDay('2026-10-01'),
    endDate: sofiaDay('2026-10-03'),
    status: 'active',
    source: 'external_ics',
    confidence: 'medium'
  });
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-13',
    ctx: adminCtx()
  });
  const holdAfter = await AvailabilityBlock.findById(hold._id).lean();
  assert.equal(formatSofiaDateOnly(holdAfter.startDate), '2026-10-01');
  assert.equal(holdAfter.status, 'active');
});

test('#32 different date edits within TTL both execute', async () => {
  const ctx = adminCtx({ actorId: 'same-actor-ttl' });
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);

  const first = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx
  });
  assert.equal(formatSofiaDateOnly(first.checkOutDate), '2026-09-14');

  const second = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-11',
    checkOutDate: '2026-09-15',
    ctx
  });
  assert.equal(formatSofiaDateOnly(second.checkInDate), '2026-09-11');
  assert.equal(formatSofiaDateOnly(second.checkOutDate), '2026-09-15');
  const live = await Booking.findById(booking._id);
  assert.equal(formatSofiaDateOnly(live.checkIn), '2026-09-11');
  assert.equal(formatSofiaDateOnly(live.checkOut), '2026-09-15');
});

test('#33/#34 same request replay idempotent; same client key + different dates never wrong mutation', async () => {
  const ctx = adminCtx({
    actorId: 'idem-actor',
    idempotencyKey: 'client-key-1'
  });
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);

  const first = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx
  });
  const replay = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx
  });
  assert.equal(String(replay.checkOutDate), String(first.checkOutDate));

  const other = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-15',
    ctx: { ...ctx, idempotencyKey: 'client-key-1' }
  });
  assert.equal(formatSofiaDateOnly(other.checkOutDate), '2026-09-15');
  assert.equal(formatSofiaDateOnly((await Booking.findById(booking._id)).checkOut), '2026-09-15');
});

test('#35/#36 completed and cancelled rejected', async () => {
  const completed = await createAllocatedBooking({ status: 'completed' });
  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: completed.booking._id,
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-14',
        ctx: adminCtx()
      }),
    (err) => err.type === 'invalid_transition' && err.status === 409
  );

  const cancelled = await createAllocatedBooking({
    status: 'cancelled',
    email: 'c@example.com'
  });
  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: cancelled.booking._id,
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-14',
        ctx: adminCtx()
      }),
    (err) => err.type === 'invalid_transition' && err.status === 409
  );
});

test('#37/#43 in_house checkout extension succeeds; checkIn preserved', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    status: 'in_house',
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });
  assert.equal(formatSofiaDateOnly(result.checkInDate), '2026-09-10');
  assert.equal(formatSofiaDateOnly(result.checkOutDate), '2026-09-14');
});

test('#42 in_house checkIn mutation rejected; state unchanged', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    status: 'in_house',
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);
  await claimNightsFor(booking, unitA._id, booking.checkIn, booking.checkOut);

  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: booking._id,
        checkInDate: '2026-09-11',
        checkOutDate: '2026-09-14',
        ctx: adminCtx()
      }),
    (err) =>
      err.type === 'invalid_transition' &&
      err.details?.code === 'IN_HOUSE_CHECKIN_IMMUTABLE' &&
      err.status === 409
  );
  const live = await Booking.findById(booking._id);
  assert.equal(formatSofiaDateOnly(live.checkIn), '2026-09-10');
  assert.equal(formatSofiaDateOnly(live.checkOut), '2026-09-12');
  assert.deepEqual(await nightsOwned(booking._id), ['2026-09-10', '2026-09-11']);
});

test('#40 unallocated cabinType rejected', async () => {
  const seed = await seedMultiUnit();
  const booking = await Booking.create({
    cabinTypeId: seed.cabinType._id,
    unitId: null,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'U', lastName: 'N', email: 'u@example.com', phone: '+1' },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: booking._id,
        checkInDate: '2026-09-10',
        checkOutDate: '2026-09-14',
        ctx: adminCtx()
      }),
    (err) => err.type === 'conflict' && err.details?.code === 'UNIT_ALLOCATION_REQUIRED'
  );
});

test('#38/#39 block update failure compensates Booking; no false success', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);

  const entityId = String(booking._id);
  const auditsBefore = await AuditEvent.countDocuments({
    action: 'reservation_edit_dates',
    entityId
  });

  let gmaCalls = 0;
  let pushCalls = 0;
  const msgPath = require.resolve('../services/messaging/messageOrchestrator');
  const pushPath = require.resolve('../services/ops/push/opsPushScheduleOrchestrator');
  const prevMsg = require.cache[msgPath];
  const prevPush = require.cache[pushPath];
  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: {
      notifyReservationDatesChanged: async () => {
        gmaCalls += 1;
      }
    }
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: {
      notifyOpsPushReservationDatesChanged: async () => {
        pushCalls += 1;
      }
    }
  };

  const original = AvailabilityBlock.updateMany.bind(AvailabilityBlock);
  AvailabilityBlock.updateMany = async () => {
    throw new Error('simulated block update failure');
  };
  try {
    await assert.rejects(
      () =>
        editReservationDates({
          bookingId: booking._id,
          checkInDate: '2026-09-10',
          checkOutDate: '2026-09-14',
          ctx: adminCtx()
        }),
      (err) => err.type === 'dependency_failure' && err.status === 500
    );
    const live = await Booking.findById(booking._id);
    assert.equal(formatSofiaDateOnly(live.checkIn), '2026-09-10');
    assert.equal(formatSofiaDateOnly(live.checkOut), '2026-09-12');
    assert.equal(
      await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
      auditsBefore
    );
    assert.equal(gmaCalls, 0);
    assert.equal(pushCalls, 0);
  } finally {
    AvailabilityBlock.updateMany = original;
    if (prevMsg) require.cache[msgPath] = prevMsg;
    else delete require.cache[msgPath];
    if (prevPush) require.cache[pushPath] = prevPush;
    else delete require.cache[pushPath];
  }
});

test('#45 compensation failure creates MRI and never reports success', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);

  const entityId = String(booking._id);
  const auditsBefore = await AuditEvent.countDocuments({
    action: 'reservation_edit_dates',
    entityId
  });

  let gmaCalls = 0;
  let pushCalls = 0;
  const msgPath = require.resolve('../services/messaging/messageOrchestrator');
  const pushPath = require.resolve('../services/ops/push/opsPushScheduleOrchestrator');
  const prevMsg = require.cache[msgPath];
  const prevPush = require.cache[pushPath];
  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: {
      notifyReservationDatesChanged: async () => {
        gmaCalls += 1;
      }
    }
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: {
      notifyOpsPushReservationDatesChanged: async () => {
        pushCalls += 1;
      }
    }
  };

  const originalUpdate = AvailabilityBlock.updateMany.bind(AvailabilityBlock);
  let saveCount = 0;
  const BookingModel = Booking;
  const protoSave = BookingModel.prototype.save;
  AvailabilityBlock.updateMany = async () => {
    throw new Error('block boom');
  };
  BookingModel.prototype.save = async function patchedSave(...args) {
    saveCount += 1;
    // First save (new dates) succeeds; compensation save fails.
    if (saveCount >= 2) {
      throw new Error('compensate boom');
    }
    return protoSave.apply(this, args);
  };
  try {
    await assert.rejects(
      () =>
        editReservationDates({
          bookingId: booking._id,
          checkInDate: '2026-09-10',
          checkOutDate: '2026-09-14',
          ctx: adminCtx()
        }),
      (err) =>
        err.type === 'dependency_failure' &&
        err.details?.failureStage === 'block_update_compensate_failed'
    );
    const mri = await ManualReviewItem.findOne({
      category: DATE_EDIT_CANONICAL_MRI_CATEGORY,
      entityId: String(booking._id)
    }).lean();
    assert.ok(mri);
    assert.equal(mri.evidence?.failureStage, 'block_update_compensate_failed');
    assert.ok(!mri.evidence?.guestEmail);
    assert.equal(
      await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
      auditsBefore
    );
    assert.equal(gmaCalls, 0);
    assert.equal(pushCalls, 0);
  } finally {
    AvailabilityBlock.updateMany = originalUpdate;
    BookingModel.prototype.save = protoSave;
    if (prevMsg) require.cache[msgPath] = prevMsg;
    else delete require.cache[msgPath];
    if (prevPush) require.cache[pushPath] = prevPush;
    else delete require.cache[pushPath];
  }
});

test('#39/#7 crash after Booking before blocks: same-date repair converges blocks', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  const block = await createReservationBlock(booking, parentCabin, unitA._id);
  // Simulate split-brain: Booking already NEW, block still OLD
  booking.checkOut = sofiaDay('2026-09-14');
  await booking.save({ validateBeforeSave: false });
  assert.equal(formatSofiaDateOnly(block.endDate), '2026-09-12');

  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx: adminCtx()
  });
  const fixed = await AvailabilityBlock.findById(block._id).lean();
  assert.equal(formatSofiaDateOnly(fixed.endDate), '2026-09-14');
  assert.deepEqual(await nightsOwned(booking._id), [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13'
  ]);
});

test('#44 same-date repair does not audit / GMA / ops push', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking();
  await createReservationBlock(booking, parentCabin, unitA._id);

  let gmaCalls = 0;
  let pushCalls = 0;
  const msgPath = require.resolve('../services/messaging/messageOrchestrator');
  const pushPath = require.resolve('../services/ops/push/opsPushScheduleOrchestrator');
  const prevMsg = require.cache[msgPath];
  const prevPush = require.cache[pushPath];
  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: {
      notifyReservationDatesChanged: async () => {
        gmaCalls += 1;
      }
    }
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: {
      notifyOpsPushReservationDatesChanged: async () => {
        pushCalls += 1;
      }
    }
  };

  try {
    const entityId = String(booking._id);
    const auditsBefore = await AuditEvent.countDocuments({
      action: 'reservation_edit_dates',
      entityId
    });
    await editReservationDates({
      bookingId: booking._id,
      checkInDate: '2026-09-10',
      checkOutDate: '2026-09-12',
      ctx: adminCtx()
    });
    assert.equal(
      await AuditEvent.countDocuments({ action: 'reservation_edit_dates', entityId }),
      auditsBefore
    );
    assert.equal(gmaCalls, 0);
    assert.equal(pushCalls, 0);
  } finally {
    if (prevMsg) require.cache[msgPath] = prevMsg;
    else delete require.cache[msgPath];
    if (prevPush) require.cache[pushPath] = prevPush;
    else delete require.cache[pushPath];
  }
});

test('#23/#24/#25 side effects only on real date change; claims do not invent extras', async () => {
  const { booking, parentCabin, unitA } = await createAllocatedBooking();
  await createReservationBlock(booking, parentCabin, unitA._id);
  let gmaCalls = 0;
  const msgPath = require.resolve('../services/messaging/messageOrchestrator');
  const prevMsg = require.cache[msgPath];
  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: {
      notifyReservationDatesChanged: async () => {
        gmaCalls += 1;
      }
    }
  };
  try {
    await editReservationDates({
      bookingId: booking._id,
      checkInDate: '2026-09-10',
      checkOutDate: '2026-09-13',
      ctx: adminCtx()
    });
    assert.equal(gmaCalls, 1);
    assert.equal(
      await AuditEvent.countDocuments({
        action: 'reservation_edit_dates',
        entityId: String(booking._id)
      }),
      1
    );
  } finally {
    if (prevMsg) require.cache[msgPath] = prevMsg;
    else delete require.cache[msgPath];
  }
});

test('#27/#28 no unique authoritative index; REALLOCATE still absent from writers', async () => {
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'I6');
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.unique, true);
  const indexes = UnitNightClaim.schema.indexes();
  assert.ok(
    !indexes.some((entry) => entry?.[1]?.unique === true),
    'schema must not declare unique unitId+night index before I6'
  );

  const writeSrc = fs.readFileSync(
    path.join(__dirname, '../services/ops/domain/reservationWriteService.js'),
    'utf8'
  );
  assert.ok(!writeSrc.includes('transferUnitNightClaims'));
  assert.ok(writeSrc.includes("source: 'date_edit'"));
});

test('#8 single cabin edit dates works without claims', async () => {
  const cabin = await Cabin.create({
    name: 'I3 Lux',
    slug: `i3-lux-${Date.now()}`,
    description: 'lux',
    capacity: 2,
    pricePerNight: 150,
    minNights: 1,
    imageUrl: 'https://example.com/lux.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'L', lastName: 'X', email: 'lux@example.com', phone: '+1' },
    totalPrice: 150,
    tripType: 'retreat',
    romanticSetup: false
  });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal_admin',
    confidence: 'high'
  });

  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-13',
    ctx: adminCtx()
  });
  assert.equal(await UnitNightClaim.countDocuments({}), 0);
  assert.equal(formatSofiaDateOnly((await Booking.findById(booking._id)).checkOut), '2026-09-13');
});

test('remembered replay still repairs missing shadow claims', async () => {
  const ctx = adminCtx({ actorId: 'remember-repair' });
  const { booking, parentCabin, unitA } = await createAllocatedBooking({
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12')
  });
  await createReservationBlock(booking, parentCabin, unitA._id);

  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx
  });
  await UnitNightClaim.deleteMany({ bookingId: booking._id });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);

  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2026-09-10',
    checkOutDate: '2026-09-14',
    ctx
  });
  assert.deepEqual(await nightsOwned(booking._id), [
    '2026-09-10',
    '2026-09-11',
    '2026-09-12',
    '2026-09-13'
  ]);
});
