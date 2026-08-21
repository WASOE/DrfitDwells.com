/**
 * Inventory Integrity I4 — UnitNightClaim terminal / delete release.
 * Run: cd server && node --test scripts/unitNightClaim.i4.test.cjs
 *
 * Scenario map: comments tag #1–#37 from the I4 audit matrix.
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
  claimUnitNights,
  releaseUnitNights
} = require('../services/inventory/unitNightClaimService');
const {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES,
  RELEASE_OUTCOMES,
  MRI_CATEGORY,
  MRI_SOURCE
} = require('../services/inventory/ensureUnitNightClaimsReleasedShadow');
const {
  transitionReservation
} = require('../services/ops/domain/reservationWriteService');
const { clearAllRememberedResults } = require('../services/idempotencyService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  cleanupPartialLocationFinalize
} = require('../services/locationCheckout/locationCheckoutService');
const {
  deleteFixtureReservation
} = require('../services/maintenance/maintenanceOpsService');
const {
  createDefaultDependencies
} = require('../services/checkout/executeBookingFinalizeWork');

let mongoServer;
let actorSeq = 0;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function adminCtx(overrides = {}) {
  actorSeq += 1;
  return {
    user: { id: overrides.actorId || `i4-admin-${actorSeq}`, role: 'admin' },
    route: overrides.route || 'POST /api/ops/reservations/:id/actions/cancel',
    idempotencyKey: overrides.idempotencyKey || `i4-${actorSeq}-${Date.now()}`,
    ...overrides
  };
}

async function seedMultiUnit() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const cabinType = await CabinType.create({
    name: `I4 Test A-Frames ${suffix}`,
    slug: `i4-aframes-${suffix}`,
    description: 'UnitNightClaim I4 tests',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i4.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const parentCabin = await Cabin.create({
    name: `I4 Parent ${suffix}`,
    slug: `i4-parent-${suffix}`,
    description: 'parent',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i4-parent.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true,
    cabinTypeId: cabinType._id
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I4-01',
    displayName: 'I4 Unit 1',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I4-02',
    displayName: 'I4 Unit 2',
    isActive: true
  });
  return { cabinType, parentCabin, unitA, unitB };
}

async function createAllocatedBooking(overrides = {}) {
  const seed = overrides._seed || (await seedMultiUnit());
  const checkIn = overrides.checkIn || sofiaDay('2026-10-10');
  const checkOut = overrides.checkOut || sofiaDay('2026-10-12');
  const booking = await Booking.create({
    cabinTypeId: overrides.cabinTypeId === undefined ? seed.cabinType._id : overrides.cabinTypeId,
    unitId: overrides.unitId === undefined ? seed.unitA._id : overrides.unitId,
    cabinId: overrides.cabinId || null,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest === true,
    isProductionSafe: false,
    guestInfo: {
      firstName: 'I4',
      lastName: 'Guest',
      email: overrides.email || 'i4-guest@example.com',
      phone: '+359000000004'
    },
    totalPrice: overrides.totalPrice != null ? overrides.totalPrice : 200,
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

async function createExternalHold(parentCabin, unitId, checkIn, checkOut) {
  return AvailabilityBlock.create({
    cabinId: parentCabin._id,
    unitId: unitId || null,
    reservationId: null,
    blockType: 'external_hold',
    startDate: checkIn,
    endDate: checkOut,
    status: 'active',
    source: 'airbnb',
    confidence: 'high',
    externalRef: `i4-ext-${Date.now()}`
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

async function claimCount(bookingId) {
  return UnitNightClaim.countDocuments({ bookingId });
}

function readSource(relFromServer) {
  return fs.readFileSync(path.join(__dirname, '..', relFromServer), 'utf8');
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
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    AvailabilityBlock.deleteMany({})
  ]);
  // AuditEvent is append-only via model middleware — wipe via collection for test isolation.
  await AuditEvent.collection.deleteMany({});
});

// ---------------------------------------------------------------------------
// Helper unit tests
// ---------------------------------------------------------------------------

test('helper: release by bookingId removes all owned claims (#25,#26)', async () => {
  const { booking, unitA, unitB, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  // Stale row on another unit / older dates
  await claimNightsFor(
    booking,
    unitB._id,
    sofiaDay('2026-09-01'),
    sofiaDay('2026-09-03'),
    'legacy_create'
  );
  assert.equal(await claimCount(booking._id), 4);

  const first = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL
  });
  assert.equal(first.ok, true);
  assert.equal(first.outcome, RELEASE_OUTCOMES.RELEASED);
  assert.equal(first.deletedCount, 4);
  assert.equal(first.lifecycleSource, LIFECYCLE_SOURCES.CANCEL);
  assert.equal(await claimCount(booking._id), 0);

  const second = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL
  });
  assert.equal(second.ok, true);
  assert.equal(second.outcome, RELEASE_OUTCOMES.ALREADY_EMPTY);
  assert.equal(second.deletedCount, 0);
});

test('helper: missing bookingId invalid (#helper)', async () => {
  const r = await ensureUnitNightClaimsReleasedShadow({
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL
  });
  assert.equal(r.ok, false);
  assert.equal(r.outcome, RELEASE_OUTCOMES.INVALID_BOOKING_ID);
});

test('helper: release DB failure creates deduped MRI (#6,#7)', async () => {
  const { booking } = await createAllocatedBooking();
  const boom = Object.assign(new Error('simulated release failure'), {
    code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE'
  });
  const first = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.COMPLETE,
    releaseUnitNightsFn: async () => {
      throw boom;
    }
  });
  assert.equal(first.ok, false);
  assert.equal(first.outcome, RELEASE_OUTCOMES.WRITE_FAILURE);
  assert.ok(first.manualReviewItemId);

  const second = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.COMPLETE,
    releaseUnitNightsFn: async () => {
      throw boom;
    }
  });
  assert.equal(second.manualReviewItemId, first.manualReviewItemId);

  const mris = await ManualReviewItem.find({
    category: MRI_CATEGORY,
    entityId: String(booking._id)
  }).lean();
  assert.equal(mris.length, 1);
  assert.equal(mris[0].provenance.source, MRI_SOURCE);
  assert.equal(mris[0].evidence.operation, 'release');
  assert.equal(mris[0].evidence.lifecycleSource, LIFECYCLE_SOURCES.COMPLETE);
});

test('helper: never deletes foreign claims (#9,#22)', async () => {
  const seed = await seedMultiUnit();
  const a = await createAllocatedBooking({ _seed: seed });
  const b = await createAllocatedBooking({
    _seed: seed,
    unitId: seed.unitB._id,
    email: 'foreign@example.com',
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-03')
  });
  await claimNightsFor(a.booking, seed.unitA._id, a.checkIn, a.checkOut);
  await claimNightsFor(b.booking, seed.unitB._id, b.checkIn, b.checkOut);

  await ensureUnitNightClaimsReleasedShadow({
    bookingId: a.booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.BOOKING_DELETE
  });
  assert.equal(await claimCount(a.booking._id), 0);
  assert.equal(await claimCount(b.booking._id), 2);
});

test('helper: unallocated Booking still releases stale claims (#4,#36)', async () => {
  const seed = await seedMultiUnit();
  const { booking, checkIn, checkOut } = await createAllocatedBooking({ _seed: seed });
  await claimNightsFor(booking, seed.unitA._id, checkIn, checkOut);
  // Clear allocation shape — stale claims remain
  await Booking.updateOne(
    { _id: booking._id },
    { $unset: { unitId: 1, cabinTypeId: 1 } }
  );
  const refreshed = await Booking.findById(booking._id);
  assert.ok(!refreshed.unitId);
  assert.ok(!refreshed.cabinTypeId);
  assert.equal(await claimCount(booking._id), 2);

  const r = await ensureUnitNightClaimsReleasedShadow({
    booking: refreshed,
    bookingId: refreshed._id,
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL
  });
  assert.equal(r.ok, true);
  assert.equal(r.deletedCount, 2);
  assert.equal(await claimCount(booking._id), 0);
});

// ---------------------------------------------------------------------------
// CANCEL (#1–#10)
// ---------------------------------------------------------------------------

test('cancel: allocated multi-unit releases all claims; block tombstoned; external hold untouched (#1,#2,#3)', async () => {
  const { booking, parentCabin, unitA, unitB, checkIn, checkOut } =
    await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await claimNightsFor(
    booking,
    unitB._id,
    sofiaDay('2026-09-01'),
    sofiaDay('2026-09-02'),
    'finalize'
  );
  const resBlock = await createReservationBlock(booking, parentCabin, unitA._id);
  const ext = await createExternalHold(parentCabin, unitA._id, checkIn, checkOut);

  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Guest requested cancel',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx({ route: 'POST /api/ops/reservations/:id/actions/cancel' })
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(await claimCount(booking._id), 0);
  const block = await AvailabilityBlock.findById(resBlock._id).lean();
  assert.equal(block.status, 'tombstoned');
  assert.equal(block.tombstoneReason, 'reservation_cancelled');
  const hold = await AvailabilityBlock.findById(ext._id).lean();
  assert.equal(hold.status, 'active');
  assert.equal(hold.blockType, 'external_hold');
});

test('cancel: single-cabin shape still releases by bookingId (#4)', async () => {
  const seed = await seedMultiUnit();
  const singleCabin = await Cabin.create({
    name: `I4 Single ${Date.now()}`,
    slug: `i4-single-${Date.now()}`,
    description: 'single',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i4-s.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const booking = await Booking.create({
    cabinId: singleCabin._id,
    cabinTypeId: null,
    unitId: null,
    checkIn: sofiaDay('2026-10-20'),
    checkOut: sofiaDay('2026-10-22'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'I4',
      lastName: 'Single',
      email: 'i4-single@example.com',
      phone: '+359000000004'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false
  });
  // Stale multi-unit claims from prior allocation
  await claimNightsFor(booking, seed.unitA._id, booking.checkIn, booking.checkOut);

  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Cancel single cabin',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });
  assert.equal((await Booking.findById(booking._id)).status, 'cancelled');
  assert.equal(await claimCount(booking._id), 0);
});

test('cancel: release DB failure does not undo cancelled status; MRI created (#5,#6)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);

  const orig = UnitNightClaim.deleteMany.bind(UnitNightClaim);
  UnitNightClaim.deleteMany = async () => {
    throw Object.assign(new Error('deleteMany boom'), { code: 'WRITE_FAIL' });
  };
  try {
    const result = await transitionReservation({
      bookingId: booking._id,
      kind: 'cancel',
      reason: 'Cancel despite release fail',
      settlement: { outcome: 'payment_retained' },
      ctx: adminCtx()
    });
    assert.equal(result.status, 'cancelled');
    const refreshed = await Booking.findById(booking._id).lean();
    assert.equal(refreshed.status, 'cancelled');
    assert.equal(refreshed.cancellationSettlement.outcome, 'payment_retained');
    const mris = await ManualReviewItem.find({
      category: MRI_CATEGORY,
      entityId: String(booking._id),
      'evidence.operation': 'release'
    }).lean();
    assert.equal(mris.length, 1);
    assert.equal(mris[0].evidence.lifecycleSource, LIFECYCLE_SOURCES.CANCEL);
    // Claims remain (orphan) for I5
    assert.ok((await claimCount(booking._id)) > 0);
  } finally {
    UnitNightClaim.deleteMany = orig;
  }
});

test('cancel: remembered replay repairs stale claims (#8)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const ctx = adminCtx({ idempotencyKey: 'i4-remember-cancel' });

  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Remember cancel',
    settlement: { outcome: 'payment_retained' },
    ctx
  });
  assert.equal(await claimCount(booking._id), 0);

  // Simulate crash-after-terminal: re-seed stale claims, then replay
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  assert.equal(await claimCount(booking._id), 2);

  const remembered = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Remember cancel',
    settlement: { outcome: 'payment_retained' },
    ctx
  });
  assert.equal(remembered.status, 'cancelled');
  assert.equal(await claimCount(booking._id), 0);
});

test('cancel: foreign claims survive (#9)', async () => {
  const seed = await seedMultiUnit();
  const a = await createAllocatedBooking({ _seed: seed });
  const b = await createAllocatedBooking({
    _seed: seed,
    unitId: seed.unitB._id,
    email: 'other@example.com',
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimNightsFor(a.booking, seed.unitA._id, a.checkIn, a.checkOut);
  await claimNightsFor(b.booking, seed.unitB._id, b.checkIn, b.checkOut);

  await transitionReservation({
    bookingId: a.booking._id,
    kind: 'cancel',
    reason: 'Cancel A',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });
  assert.equal(await claimCount(a.booking._id), 0);
  assert.equal(await claimCount(b.booking._id), 2);
});

test('cancel: settlement outcome preserved (no payment mutation from release) (#10,#30)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking({
    totalPrice: 350
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'Retain payment cancel',
    settlement: { outcome: 'payment_retained' },
    ctx: adminCtx()
  });
  assert.equal(result.cancellationSettlement.outcome, 'payment_retained');
  const refreshed = await Booking.findById(booking._id).lean();
  assert.equal(refreshed.totalPrice, 350);
  assert.equal(refreshed.cancellationSettlement.outcome, 'payment_retained');
});

// ---------------------------------------------------------------------------
// COMPLETE (#11–#16)
// ---------------------------------------------------------------------------

test('complete: releases claims; block tombstoned (#11,#12)', async () => {
  const { booking, parentCabin, unitA, checkIn, checkOut } = await createAllocatedBooking({
    status: 'in_house'
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const resBlock = await createReservationBlock(booking, parentCabin, unitA._id);

  const result = await transitionReservation({
    bookingId: booking._id,
    kind: 'complete',
    ctx: adminCtx({ route: 'POST /api/ops/reservations/:id/actions/complete' })
  });
  assert.equal(result.status, 'completed');
  assert.equal(await claimCount(booking._id), 0);
  const block = await AvailabilityBlock.findById(resBlock._id).lean();
  assert.equal(block.status, 'tombstoned');
  assert.equal(block.tombstoneReason, 'reservation_completed');
});

test('complete: release failure does not undo completed; MRI (#13,#14)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking({
    status: 'in_house'
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const orig = UnitNightClaim.deleteMany.bind(UnitNightClaim);
  UnitNightClaim.deleteMany = async () => {
    throw new Error('complete release boom');
  };
  try {
    const result = await transitionReservation({
      bookingId: booking._id,
      kind: 'complete',
      ctx: adminCtx()
    });
    assert.equal(result.status, 'completed');
    assert.equal((await Booking.findById(booking._id)).status, 'completed');
    const mris = await ManualReviewItem.find({
      category: MRI_CATEGORY,
      'evidence.lifecycleSource': LIFECYCLE_SOURCES.COMPLETE
    }).lean();
    assert.equal(mris.length, 1);
  } finally {
    UnitNightClaim.deleteMany = orig;
  }
});

test('complete: remembered replay repairs (#15)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking({
    status: 'in_house'
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const ctx = adminCtx({ idempotencyKey: 'i4-remember-complete' });
  await transitionReservation({ bookingId: booking._id, kind: 'complete', ctx });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  assert.equal(await claimCount(booking._id), 2);
  await transitionReservation({ bookingId: booking._id, kind: 'complete', ctx });
  assert.equal(await claimCount(booking._id), 0);
});

test('complete: completed Booking receives no new claims from release helper (#16)', async () => {
  const { booking } = await createAllocatedBooking({ status: 'in_house' });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'complete',
    ctx: adminCtx()
  });
  const before = await claimCount(booking._id);
  await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.COMPLETE
  });
  assert.equal(await claimCount(booking._id), before);
  assert.equal(before, 0);
});

// ---------------------------------------------------------------------------
// DELETE / ROLLBACK (#17–#22)
// ---------------------------------------------------------------------------

test('finalize_cleanup / booking_delete helper leaves zero claims (#17,#18)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const r = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.FINALIZE_CLEANUP
  });
  assert.equal(r.lifecycleSource, LIFECYCLE_SOURCES.FINALIZE_CLEANUP);
  assert.equal(await claimCount(booking._id), 0);
});

test('location rollback child deletion releases claims (#19)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await cleanupPartialLocationFinalize({
    locationBookingId: null,
    childBookingIds: [booking._id],
    checkoutSessionId: null
  });
  assert.equal(await Booking.findById(booking._id), null);
  assert.equal(await claimCount(booking._id), 0);
});

test('legacy/finalize delete source wiring present (#20)', () => {
  const finalizeSrc = readSource('services/checkout/executeBookingFinalizeWork.js');
  const legacySrc = readSource('routes/bookingRoutes.js');
  assert.match(finalizeSrc, /shadowReleaseBeforeBookingDelete/);
  assert.match(finalizeSrc, /LIFECYCLE_SOURCES\.FINALIZE_CLEANUP/);
  assert.match(legacySrc, /shadowReleaseBeforeLegacyBookingDelete/);
  assert.match(legacySrc, /LIFECYCLE_SOURCES\.FINALIZE_CLEANUP/);
  // Release precedes deleteOne
  const finalizeIdx = finalizeSrc.indexOf('shadowReleaseBeforeBookingDelete');
  const deleteIdx = finalizeSrc.indexOf('await deps.Booking.deleteOne');
  assert.ok(finalizeIdx > 0 && deleteIdx > finalizeIdx);
});

test('release failure + Booking deletion leaves orphan + MRI (#21)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  const boom = new Error('release fail before delete');
  const r = await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.FINALIZE_CLEANUP,
    releaseUnitNightsFn: async () => {
      throw boom;
    }
  });
  assert.equal(r.ok, false);
  assert.ok(r.manualReviewItemId);
  await Booking.deleteOne({ _id: booking._id });
  assert.equal(await Booking.findById(booking._id), null);
  assert.ok((await claimCount(booking._id)) > 0);
});

test('location rollback: foreign Booking claims survive (#22)', async () => {
  const seed = await seedMultiUnit();
  const child = await createAllocatedBooking({ _seed: seed });
  const survivor = await createAllocatedBooking({
    _seed: seed,
    unitId: seed.unitB._id,
    email: 'survivor@example.com',
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  await claimNightsFor(child.booking, seed.unitA._id, child.checkIn, child.checkOut);
  await claimNightsFor(
    survivor.booking,
    seed.unitB._id,
    survivor.checkIn,
    survivor.checkOut
  );

  await cleanupPartialLocationFinalize({
    childBookingIds: [child.booking._id],
    locationBookingId: null,
    checkoutSessionId: null
  });
  assert.equal(await claimCount(child.booking._id), 0);
  assert.equal(await claimCount(survivor.booking._id), 2);
  assert.ok(await Booking.findById(survivor.booking._id));
});

// ---------------------------------------------------------------------------
// PAID RETAIN (#23,#24)
// ---------------------------------------------------------------------------

test('paid-retain path does not invoke claim release (#23,#24)', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  const fnStart = src.indexOf('async function retainPaidBookingOnOverlap');
  assert.ok(fnStart > 0);
  const nextFn = src.indexOf('\nfunction isPaidOverlapPath', fnStart + 1);
  const nextAsync = src.indexOf('\nasync function ', fnStart + 1);
  const fnEnd = Math.min(
    nextFn > 0 ? nextFn : src.length,
    nextAsync > 0 ? nextAsync : src.length
  );
  const body = src.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /ensureUnitNightClaimsReleasedShadow|shadowReleaseBeforeBookingDelete/);
  assert.match(body, /runShadowClaimsAfterCanonicalSurvival/);

  // Overlap delete path: paid retain returns before delete/release
  assert.match(
    src,
    /if \(paidPath\) \{\s*await retainPaidBookingOnOverlap[\s\S]*?\}\s*await shadowReleaseBeforeBookingDelete/
  );
});

// ---------------------------------------------------------------------------
// GENERAL / LOCKS (#25–#35) + #36 already covered + #37
// ---------------------------------------------------------------------------

test('lifecycleSource constants locked (#27)', () => {
  assert.deepEqual(
    { ...LIFECYCLE_SOURCES },
    {
      CANCEL: 'cancel',
      COMPLETE: 'complete',
      BOOKING_DELETE: 'booking_delete',
      LOCATION_ROLLBACK: 'location_rollback',
      FINALIZE_CLEANUP: 'finalize_cleanup',
      MAINTENANCE_DELETE: 'maintenance_delete',
      REPAIR: 'repair'
    }
  );
});

test('no authoritative unique unitId+night index; REALLOCATE disabled (#28,#29)', () => {
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.unique, true);
  const indexes = UnitNightClaim.schema.indexes();
  assert.ok(
    !indexes.some((entry) => entry?.[1]?.unique === true),
    'schema must not declare unique unitId+night index before I6'
  );
  const writeSvc = readSource('services/ops/domain/reservationWriteService.js');
  assert.doesNotMatch(writeSvc, /transferUnitNightClaims\(/);
  const plan = fs.readFileSync(
    path.join(__dirname, '../../docs/stay-change-implementation-plan.md'),
    'utf8'
  );
  assert.match(plan, /REALLOCATE remains disabled/);
});

test('release helper has no email/Meta/commission/payment side effects (#30)', () => {
  const src = readSource('services/inventory/ensureUnitNightClaimsReleasedShadow.js');
  assert.doesNotMatch(src, /sendEmail|Meta|commission|refund|stripe|GiftVoucher/i);
  assert.match(src, /releaseUnitNights/);
  assert.match(src, /openManualReviewItem/);
});

test('I1/I2/I3 suites exist as regression peers (#31–#33)', () => {
  for (const f of [
    'unitNightClaim.i1.test.cjs',
    'unitNightClaim.i2.test.cjs',
    'unitNightClaim.i3.test.cjs'
  ]) {
    assert.ok(fs.existsSync(path.join(__dirname, f)), f);
  }
});

test('cancel/complete/location/finalize wiring present (#34,#35)', () => {
  const writeSrc = readSource('services/ops/domain/reservationWriteService.js');
  assert.match(writeSrc, /ensureUnitNightClaimsReleasedShadow/);
  assert.match(writeSrc, /LIFECYCLE_SOURCES\.CANCEL/);
  assert.match(writeSrc, /LIFECYCLE_SOURCES\.COMPLETE/);
  assert.match(writeSrc, /getRememberedResult\(idemKey\)/);
  assert.match(writeSrc, /kind === 'cancel' \|\| kind === 'complete'/);

  const locSrc = readSource('services/locationCheckout/locationCheckoutService.js');
  assert.match(locSrc, /LIFECYCLE_SOURCES\.LOCATION_ROLLBACK/);

  const maintSrc = readSource('services/maintenance/maintenanceOpsService.js');
  assert.match(maintSrc, /LIFECYCLE_SOURCES\.MAINTENANCE_DELETE/);

  const deps = createDefaultDependencies();
  assert.equal(typeof deps.ensureUnitNightClaimsReleasedShadow, 'function');
});

test('maintenance fixture delete releases then deletes (#6 maint)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking({
    isTest: true,
    email: 'fixture-i4@example.com'
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await deleteFixtureReservation(String(booking._id), 'i4-fixture-delete-test', {
    user: { id: 'maint', role: 'admin' },
    req: {}
  });
  assert.equal(await Booking.findById(booking._id), null);
  assert.equal(await claimCount(booking._id), 0);
});

test('confirm / check-in do not release (#F)', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking({
    status: 'pending'
  });
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await transitionReservation({
    bookingId: booking._id,
    kind: 'confirm',
    ctx: adminCtx({ route: 'POST /api/ops/reservations/:id/actions/confirm' })
  });
  assert.equal(await claimCount(booking._id), 2);
  await transitionReservation({
    bookingId: booking._id,
    kind: 'checkIn',
    ctx: adminCtx({ route: 'POST /api/ops/reservations/:id/actions/check-in' })
  });
  assert.equal(await claimCount(booking._id), 2);
});

test('terminal durable + tombstone failure still releases claims (#37)', async () => {
  const { booking, parentCabin, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await createReservationBlock(booking, parentCabin, unitA._id);

  const orig = AvailabilityBlock.updateMany.bind(AvailabilityBlock);
  AvailabilityBlock.updateMany = async () => {
    throw new Error('tombstone simulated failure');
  };
  try {
    await assert.rejects(
      () =>
        transitionReservation({
          bookingId: booking._id,
          kind: 'cancel',
          reason: 'Tombstone fail path',
          settlement: { outcome: 'payment_retained' },
          ctx: adminCtx()
        }),
      /tombstone simulated failure/
    );
  } finally {
    AvailabilityBlock.updateMany = orig;
  }

  // Booking already durable terminal; claims must still be released
  const refreshed = await Booking.findById(booking._id).lean();
  assert.equal(refreshed.status, 'cancelled');
  assert.equal(await claimCount(booking._id), 0);
});

test('releaseUnitNights bookingId-only filter (no unit/date required)', async () => {
  const { booking, unitA, unitB, checkIn, checkOut } = await createAllocatedBooking();
  await claimNightsFor(booking, unitA._id, checkIn, checkOut);
  await claimNightsFor(
    booking,
    unitB._id,
    sofiaDay('2025-01-01'),
    sofiaDay('2025-01-02'),
    'finalize'
  );
  const r = await releaseUnitNights({ bookingId: booking._id });
  assert.equal(r.deletedCount, 3);
  assert.equal(await claimCount(booking._id), 0);
});
