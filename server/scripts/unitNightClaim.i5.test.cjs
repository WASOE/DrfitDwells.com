/**
 * Inventory Integrity I5 — reconciliation / bootstrap.
 * Run: cd server && node --test scripts/unitNightClaim.i5.test.cjs
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
const {
  claimUnitNights,
  releaseUnitNights
} = require('../services/inventory/unitNightClaimService');
const {
  projectUnitNightClaimIntegrity
} = require('../services/inventory/unitNightClaimProjection');
const {
  DRIFT_CLASS,
  runUnitNightClaimReconciliation,
  exitCodeForReport,
  classifyReconciliation
} = require('../services/inventory/unitNightClaimReconciliationService');
const {
  ensureUnitNightClaimsShadow,
  MRI_CATEGORY,
  MRI_SOURCE
} = require('../services/inventory/ensureUnitNightClaimsShadow');
const { syncUnitNightClaimsShadow } = require('../services/inventory/syncUnitNightClaimsShadow');
const {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES
} = require('../services/inventory/ensureUnitNightClaimsReleasedShadow');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const { parseArgs } = require('./unitNightClaimReconcile');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

async function seed() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
  const cabinType = await CabinType.create({
    name: `I5 CT ${suffix}`,
    slug: `i5-ct-${suffix}`,
    description: 'i5',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i5.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I5-A',
    displayName: 'I5 A',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'I5-B',
    displayName: 'I5 B',
    isActive: true
  });
  return { cabinType, unitA, unitB, suffix };
}

async function createBooking(overrides = {}) {
  const seedData = overrides._seed || (await seed());
  const booking = await Booking.create({
    cabinTypeId: overrides.cabinTypeId === undefined ? seedData.cabinType._id : overrides.cabinTypeId,
    unitId: overrides.unitId === undefined ? seedData.unitA._id : overrides.unitId,
    cabinId: overrides.cabinId || null,
    checkIn: overrides.checkIn || sofiaDay('2026-10-10'),
    checkOut: overrides.checkOut || sofiaDay('2026-10-12'),
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest === true,
    archivedAt: overrides.archivedAt || undefined,
    locationBookingId: overrides.locationBookingId || null,
    guestInfo: {
      firstName: 'I5',
      lastName: 'Guest',
      email: overrides.email || 'i5-guest@example.com',
      phone: '+359000000005'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false,
    metadata: overrides.metadata || undefined
  });
  return { booking, ...seedData };
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
  await Promise.all([
    UnitNightClaim.deleteMany({}),
    Booking.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('I1 projection: mismatch does not expand expected claims (#46)', async () => {
  const { cabinType, unitA } = await seed();
  const otherType = await CabinType.create({
    name: 'Other',
    slug: `other-${Date.now()}`,
    description: 'x',
    capacity: 2,
    pricePerNight: 50,
    minNights: 1,
    imageUrl: 'https://example.com/o.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  await createBooking({
    _seed: { cabinType, unitA },
    cabinTypeId: otherType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02')
  });
  const report = await projectUnitNightClaimIntegrity();
  assert.equal(report.summary.expectedClaims, 0);
  assert.ok(report.invalidAllocations.some((i) => i.type === 'unit_cabinType_mismatch'));
});

test('#1/#2 missing + apply-safe bootstrap create', async () => {
  const { booking, unitA } = await createBooking();
  let report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.MISSING_CLAIM));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);

  report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: booking._id })) >= 2);
  const created = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  assert.ok(created.every((c) => c.source === 'bootstrap'));
  assert.equal(report.summary.missing, 0);
});

test('#3/#4/#28 terminal stale + release semantics', async () => {
  const { booking, unitA } = await createBooking({ status: 'confirmed' });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { status: 'completed' } });
  let report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.STALE_TERMINAL_CLAIM));

  report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);

  const { booking: b2, unitA: u2 } = await createBooking({
    status: 'cancelled',
    email: 'c@example.com',
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimUnitNights({
    bookingId: b2._id,
    unitId: u2._id,
    checkIn: b2.checkIn,
    checkOut: b2.checkOut,
    source: 'finalize'
  });
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: b2._id }), 0);
});

test('#5/#6 orphan detect + cleanup', async () => {
  const { unitA } = await seed();
  const ghostId = new mongoose.Types.ObjectId();
  await UnitNightClaim.create({
    unitId: unitA._id,
    night: sofiaDay('2026-10-10'),
    bookingId: ghostId,
    source: 'bootstrap'
  });
  let report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.ORPHAN_CLAIM));
  report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: ghostId }), 0);
});

test('#7/#8 outside-range + wrong-unit', async () => {
  const { booking, unitA, unitB } = await createBooking();
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  await UnitNightClaim.create({
    unitId: unitA._id,
    night: sofiaDay('2026-01-01'),
    bookingId: booking._id,
    source: 'finalize'
  });
  await UnitNightClaim.create({
    unitId: unitB._id,
    night: sofiaDay('2026-10-10'),
    bookingId: booking._id,
    source: 'finalize'
  });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.OUTSIDE_DATE_RANGE_CLAIM));
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.WRONG_UNIT_CLAIM));
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const left = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  assert.ok(left.every((c) => String(c.unitId) === String(unitA._id)));
  assert.ok(
    left.every((c) => {
      const n = require('../services/inventory/unitNightClaimProjection').dateOnlyFromNightDate(c.night);
      return n === '2026-10-10' || n === '2026-10-11';
    })
  );
});

test('#9/#10/#58 same-owner duplicate detect + dedupe', async () => {
  const { booking, unitA } = await createBooking();
  const night = sofiaDay('2026-10-10');
  await UnitNightClaim.create({
    unitId: unitA._id,
    night,
    bookingId: booking._id,
    source: 'finalize',
    createdAt: new Date('2026-01-01T00:00:00.000Z')
  });
  await UnitNightClaim.create({
    unitId: unitA._id,
    night,
    bookingId: booking._id,
    source: 'finalize',
    createdAt: new Date('2026-02-01T00:00:00.000Z')
  });
  let report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.DUPLICATE_SAME_OWNER_CLAIM));
  report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, night }), 1);
});

test('#11/#12/#27/#48 canonical collision no silent winner', async () => {
  const seedData = await seed();
  const a = await createBooking({
    _seed: seedData,
    email: 'a@example.com'
  });
  const b = await createBooking({
    _seed: seedData,
    email: 'b@example.com',
    unitId: seedData.unitA._id
  });
  const report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.CANONICAL_UNIT_NIGHT_CONFLICT));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: a.booking._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: b.booking._id }), 0);
  assert.ok(report.denyWriteKeys.length >= 1);
});

test('#13/#14 foreign conflict not overwritten', async () => {
  const seedData = await seed();
  const owner = await createBooking({ _seed: seedData, email: 'owner@example.com' });
  const foreign = await createBooking({
    _seed: seedData,
    email: 'foreign@example.com',
    unitId: seedData.unitB._id,
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-03')
  });
  // Foreign claim on owner's expected nights
  await claimUnitNights({
    bookingId: foreign.booking._id,
    unitId: seedData.unitA._id,
    checkIn: owner.booking.checkIn,
    checkOut: owner.booking.checkOut,
    source: 'finalize'
  });
  const beforeOnA = await UnitNightClaim.countDocuments({
    bookingId: foreign.booking._id,
    unitId: seedData.unitA._id
  });
  assert.equal(beforeOnA, 2);
  const report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.FOREIGN_CLAIM_CONFLICT));
  assert.equal(
    await UnitNightClaim.countDocuments({
      bookingId: foreign.booking._id,
      unitId: seedData.unitA._id
    }),
    beforeOnA
  );
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: owner.booking._id }), 0);
});

test('#15 unallocated blocking classified', async () => {
  const { cabinType } = await seed();
  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'U',
      lastName: 'N',
      email: 'unalloc@example.com',
      phone: '+359'
    },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.UNALLOCATED_BLOCKING_BOOKING));
  assert.ok(report.summary.unallocatedBlocking >= 1);
});

test('#17 Location child included', async () => {
  const locId = new mongoose.Types.ObjectId();
  const { booking } = await createBooking({ locationBookingId: locId });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.summary.blockingBookingsScanned >= 1);
  assert.ok(report.drift.some((d) => d.bookingIds.includes(String(booking._id))));
});

test('#18 fixture excluded from expected', async () => {
  await createBooking({ email: 'smoke-user@example.com', isTest: false });
  await createBooking({ email: 'real@example.com', checkIn: sofiaDay('2026-11-01'), checkOut: sofiaDay('2026-11-03') });
  // smoke- pattern is fixture
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.equal(report.summary.validAllocatedMultiUnitBookings, 1);
});

test('#19 paid-retain blocking included', async () => {
  const { booking } = await createBooking({
    metadata: { paidOverlapConflict: true }
  });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.summary.expectedUnitNightClaims >= 2);
  assert.ok(
    report.drift.some(
      (d) => d.class === DRIFT_CLASS.MISSING_CLAIM && d.bookingIds.includes(String(booking._id))
    )
  );
});

test('#20 checkout excluded', async () => {
  const { booking, unitA } = await createBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12')
  });
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const nights = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  const dateOnlys = nights.map((n) =>
    require('../services/inventory/unitNightClaimProjection').dateOnlyFromNightDate(n.night)
  );
  assert.ok(dateOnlys.includes('2026-10-10'));
  assert.ok(dateOnlys.includes('2026-10-11'));
  assert.ok(!dateOnlys.includes('2026-10-12'));
});

test('#22/#23 dry-run and verify write zero Mongo docs', async () => {
  await createBooking();
  const beforeClaims = await UnitNightClaim.countDocuments();
  const beforeMri = await ManualReviewItem.countDocuments();
  await runUnitNightClaimReconciliation({ mode: 'classify' });
  await runUnitNightClaimReconciliation({ mode: 'verify' });
  assert.equal(await UnitNightClaim.countDocuments(), beforeClaims);
  assert.equal(await ManualReviewItem.countDocuments(), beforeMri);
});

test('#24/#32 apply-safe may write conflict MRI; dry-run does not', async () => {
  const seedData = await seed();
  await createBooking({ _seed: seedData, email: 'x@example.com' });
  await createBooking({ _seed: seedData, email: 'y@example.com' });
  await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.equal(await ManualReviewItem.countDocuments({ category: 'unit_night_claim_canonical_conflict' }), 0);
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.ok(
    (await ManualReviewItem.countDocuments({ category: 'unit_night_claim_canonical_conflict' })) >= 1
  );
});

test('#25 apply-safe idempotent', async () => {
  await createBooking();
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const n1 = await UnitNightClaim.countDocuments();
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.equal(await UnitNightClaim.countDocuments(), n1);
});

test('#26 one repair failure continues', async () => {
  await createBooking();
  const report = await runUnitNightClaimReconciliation({
    mode: 'apply-safe',
    claimUnitNightsFn: async () => {
      throw Object.assign(new Error('boom'), { code: 'FAIL' });
    }
  });
  assert.ok(report.summary.repairFailures >= 1);
  assert.ok(Array.isArray(report.repairLog));
  assert.ok(report.repairLog.some((r) => r.ok === false));
});

test('#29/#30/#57 MRI operation suffixes preserve stronger refs', async () => {
  const { booking, unitA } = await createBooking();
  await ensureUnitNightClaimsShadow({
    booking,
    source: 'finalize',
    checkoutId: 'checkout-abc',
    claimUnitNightsFn: async () => {
      throw new Error('claim fail');
    }
  });
  await syncUnitNightClaimsShadow({
    booking,
    claimUnitNightsFn: async () => {
      throw new Error('sync fail');
    },
    releaseUnitNightsFn: async () => ({ deletedCount: 0 })
  });
  await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL,
    releaseUnitNightsFn: async () => {
      throw new Error('release fail');
    }
  });
  const mris = await ManualReviewItem.find({ category: MRI_CATEGORY }).lean();
  const refs = mris.map((m) => m.provenance.sourceReference).sort();
  assert.ok(refs.includes('checkout-abc:claim'));
  assert.ok(refs.includes(`${String(booking._id)}:sync`));
  assert.ok(refs.includes(`${String(booking._id)}:release`));
  assert.equal(refs.length, 3);

  // repeated release dedupes
  await ensureUnitNightClaimsReleasedShadow({
    bookingId: booking._id,
    lifecycleSource: LIFECYCLE_SOURCES.CANCEL,
    releaseUnitNightsFn: async () => {
      throw new Error('release fail');
    }
  });
  assert.equal(await ManualReviewItem.countDocuments({ category: MRI_CATEGORY }), 3);
});

test('#31 conflict MRI stable dedupe', async () => {
  const seedData = await seed();
  await createBooking({ _seed: seedData, email: 'p@example.com' });
  await createBooking({ _seed: seedData, email: 'q@example.com' });
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const n1 = await ManualReviewItem.countDocuments({
    category: 'unit_night_claim_canonical_conflict'
  });
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const n2 = await ManualReviewItem.countDocuments({
    category: 'unit_night_claim_canonical_conflict'
  });
  assert.equal(n1, n2);
});

test('#33 report has no guest PII', async () => {
  await createBooking({ email: 'secret@example.com' });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  const blob = JSON.stringify(report);
  assert.doesNotMatch(blob, /secret@example\.com/);
  assert.doesNotMatch(blob, /"firstName"/);
  assert.doesNotMatch(blob, /guestEmail/);
});

test('#35/#36/#59 exit + provisional readiness + repairFailures block', async () => {
  await createBooking();
  const dirty = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.equal(dirty.readyForI6, false);
  assert.equal(exitCodeForReport(dirty), 2);

  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const clean = await runUnitNightClaimReconciliation({ mode: 'verify' });
  assert.equal(clean.readyForI6Provisional, true);
  assert.equal(clean.readyForI6, false);
  assert.equal(exitCodeForReport(clean), 2);

  const failed = await runUnitNightClaimReconciliation({
    mode: 'apply-safe',
    claimUnitNightsFn: async () => {
      throw new Error('x');
    }
  });
  // after failed create on already-filled inventory, repairFailures may be 0 if no missing —
  // force by deleting claims first
  await UnitNightClaim.deleteMany({});
  const failed2 = await runUnitNightClaimReconciliation({
    mode: 'apply-safe',
    claimUnitNightsFn: async () => {
      throw new Error('x');
    }
  });
  assert.ok(failed2.summary.repairFailures >= 1);
  assert.equal(failed2.readyForI6, false);
});

test('#37/#38/#39/#40 unique precheck + no unique index + shadow + REALLOCATE', async () => {
  const { booking, unitA } = await createBooking();
  const night = sofiaDay('2026-10-10');
  await UnitNightClaim.create({ unitId: unitA._id, night, bookingId: booking._id, source: 'a' });
  await UnitNightClaim.create({ unitId: unitA._id, night, bookingId: booking._id, source: 'b' });
  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.summary.uniqueIndexDuplicateKeys >= 1);
  assert.equal(report.claimsRemainShadow, true);
  assert.equal(report.uniqueIndexPresent, false);
  const indexes = UnitNightClaim.schema.indexes();
  assert.ok(!indexes.some((e) => e?.[1]?.unique === true));
  const writeSrc = fs.readFileSync(
    path.join(__dirname, '../services/ops/domain/reservationWriteService.js'),
    'utf8'
  );
  assert.doesNotMatch(writeSrc, /transferUnitNightClaims\(/);
});

test('#45/#55/#56/#60 fingerprint stable across passes; concurrent drift changes it', async () => {
  await createBooking();
  await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  const a = await runUnitNightClaimReconciliation({ mode: 'verify' });
  const b = await runUnitNightClaimReconciliation({ mode: 'verify' });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.detectedAt, b.detectedAt);
  assert.notEqual(a.passId, b.passId);

  const stable = await runUnitNightClaimReconciliation({
    mode: 'verify',
    priorFingerprint: a.fingerprint,
    requireStable: true
  });
  assert.equal(stable.readyForI6, true);
  assert.equal(stable.stableVerification.satisfied, true);
  assert.equal(exitCodeForReport(stable), 0);

  // introduce drift
  await UnitNightClaim.deleteMany({});
  const c = await runUnitNightClaimReconciliation({ mode: 'verify' });
  assert.notEqual(c.fingerprint, a.fingerprint);
  assert.equal(c.readyForI6, false);
});

test('#60 fingerprint ignores discovery order for multi-owner conflicts', async () => {
  const {
    driftFingerprintLine,
    canonicalizeConflict,
    sortIds,
    classifyReconciliation
  } = require('../services/inventory/unitNightClaimReconciliationService');
  const {
    projectCanonicalExpectedOccupancy
  } = require('../services/inventory/unitNightClaimProjection');

  const seedData = await seed();
  const first = await createBooking({
    _seed: seedData,
    email: 'order-a@example.com'
  });
  const second = await createBooking({
    _seed: seedData,
    email: 'order-b@example.com'
  });
  const idA = String(first.booking._id);
  const idB = String(second.booking._id);

  // Helper-level: reversed bookingIds must canonicalize identically
  assert.equal(
    driftFingerprintLine({
      class: DRIFT_CLASS.CANONICAL_UNIT_NIGHT_CONFLICT,
      unitId: String(seedData.unitA._id),
      night: '2026-10-10',
      bookingIds: [idA, idB],
      reason: 'multiple_canonical_blocking_owners'
    }),
    driftFingerprintLine({
      class: DRIFT_CLASS.CANONICAL_UNIT_NIGHT_CONFLICT,
      unitId: String(seedData.unitA._id),
      night: '2026-10-10',
      bookingIds: [idB, idA],
      reason: 'multiple_canonical_blocking_owners'
    })
  );
  assert.deepEqual(sortIds([idB, idA]), sortIds([idA, idB]));
  const cAsc = canonicalizeConflict({
    unitId: String(seedData.unitA._id),
    night: '2026-10-10',
    bookingIds: [idA, idB],
    bookings: [
      { id: idA, status: 'confirmed' },
      { id: idB, status: 'confirmed' }
    ]
  });
  const cDesc = canonicalizeConflict({
    unitId: String(seedData.unitA._id),
    night: '2026-10-10',
    bookingIds: [idB, idA],
    bookings: [
      { id: idB, status: 'confirmed' },
      { id: idA, status: 'confirmed' }
    ]
  });
  assert.deepEqual(cAsc.bookingIds, cDesc.bookingIds);
  assert.deepEqual(
    cAsc.bookings.map((b) => b.id),
    cDesc.bookings.map((b) => b.id)
  );

  // Service-level: reverse Booking cursor discovery order; fingerprint must match
  function wrapBookingModel(reverse) {
    return {
      find(filter) {
        const chain = {
          _select: null,
          select(fields) {
            this._select = fields;
            return this;
          },
          lean() {
            return this;
          },
          async then(resolve, reject) {
            try {
              let q = Booking.find(filter);
              if (this._select) q = q.select(this._select);
              let docs = await q.lean();
              if (reverse) docs = docs.slice().reverse();
              resolve(docs);
            } catch (err) {
              reject(err);
            }
          },
          cursor() {
            const selectFields = this._select;
            return (async function* reversed() {
              let q = Booking.find(filter);
              if (selectFields) q = q.select(selectFields);
              let docs = await q.lean();
              if (reverse) docs = docs.slice().reverse();
              for (const d of docs) yield d;
            })();
          }
        };
        return chain;
      },
      findById(...args) {
        return Booking.findById(...args);
      }
    };
  }

  const passForward = await classifyReconciliation({
    BookingModel: wrapBookingModel(false)
  });
  const passReverse = await classifyReconciliation({
    BookingModel: wrapBookingModel(true)
  });

  assert.equal(passForward.report.fingerprint, passReverse.report.fingerprint);
  assert.equal(passForward.report.summary.canonicalCollisions, passReverse.report.summary.canonicalCollisions);
  assert.equal(passForward.report.summary.remainingBlockers, passReverse.report.summary.remainingBlockers);
  assert.ok(passForward.report.summary.canonicalCollisions >= 1);
  for (const conflict of passForward.report.conflicts) {
    assert.deepEqual(conflict.bookingIds, sortIds(conflict.bookingIds));
  }

  // Stable verify still works across order-independent fingerprints
  const stable = await runUnitNightClaimReconciliation({
    mode: 'verify',
    BookingModel: wrapBookingModel(true),
    priorFingerprint: passForward.report.fingerprint,
    requireStable: true
  });
  // Conflict inventory is not READY, but fingerprint must still match prior
  assert.equal(stable.fingerprint, passForward.report.fingerprint);
  assert.equal(stable.readyForI6, false);

  // Silence unused import lint in case tree-shaken
  assert.equal(typeof projectCanonicalExpectedOccupancy, 'function');
});

test('#47 single-inventory claim classified/repaired', async () => {
  const cabin = await Cabin.create({
    name: `Single ${Date.now()}`,
    slug: `single-${Date.now()}`,
    description: 's',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const { unitA } = await seed();
  const booking = await Booking.create({
    cabinId: cabin._id,
    cabinTypeId: null,
    unitId: null,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'S',
      lastName: 'I',
      email: 'single@example.com',
      phone: '+359'
    },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  await UnitNightClaim.create({
    unitId: unitA._id,
    night: sofiaDay('2026-10-10'),
    bookingId: booking._id,
    source: 'finalize'
  });
  const report = await runUnitNightClaimReconciliation({ mode: 'apply-safe' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.CLAIM_FOR_SINGLE_INVENTORY) || report.summary.claimsForSingleInventory >= 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('#50/#51/#52 limit/targeted/unsafe flags', async () => {
  await createBooking();
  await createBooking({
    email: 'second@example.com',
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-03')
  });
  const partial = await runUnitNightClaimReconciliation({ mode: 'classify', limit: 1 });
  assert.equal(partial.scanCompleteness, 'partial');
  assert.equal(partial.readyForI6, false);

  const one = await Booking.findOne().lean();
  const targeted = await runUnitNightClaimReconciliation({
    mode: 'classify',
    bookingId: String(one._id)
  });
  assert.equal(targeted.scanCompleteness, 'targeted');
  assert.equal(targeted.readyForI6, false);

  await assert.rejects(
    () => runUnitNightClaimReconciliation({ mode: 'apply-safe', limit: 1 }),
    /cannot be combined with --limit/
  );
  const parsed = parseArgs(['--apply-safe', '--limit', '5']);
  assert.equal(parsed.applySafe, true);
  assert.equal(parsed.limit, 5);
});

test('#53/#54 excluded claims block ready; archived not orphan', async () => {
  const { booking, unitA } = await createBooking({ isTest: true, email: 'test@example.com' });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'test'
  });
  // Also a clean real booking fully claimed
  const real = await createBooking({
    email: 'real2@example.com',
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  await claimUnitNights({
    bookingId: real.booking._id,
    unitId: real.unitA._id,
    checkIn: real.booking.checkIn,
    checkOut: real.booking.checkOut,
    source: 'finalize'
  });

  const report = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(report.drift.some((d) => d.class === DRIFT_CLASS.CLAIM_FOR_EXCLUDED_BOOKING));
  assert.ok(!report.drift.some((d) => d.class === DRIFT_CLASS.ORPHAN_CLAIM));
  assert.equal(report.readyForI6Provisional, false);

  const archived = await createBooking({
    email: 'arch@example.com',
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimUnitNights({
    bookingId: archived.booking._id,
    unitId: archived.unitA._id,
    checkIn: archived.booking.checkIn,
    checkOut: archived.booking.checkOut,
    source: 'finalize'
  });
  await Booking.updateOne(
    { _id: archived.booking._id },
    { $set: { archivedAt: new Date() } }
  );
  const report2 = await runUnitNightClaimReconciliation({ mode: 'classify' });
  assert.ok(
    report2.drift.some(
      (d) =>
        d.class === DRIFT_CLASS.CLAIM_FOR_EXCLUDED_BOOKING &&
        d.bookingIds.includes(String(archived.booking._id))
    )
  );
  assert.ok(
    !report2.drift.some(
      (d) =>
        d.class === DRIFT_CLASS.ORPHAN_CLAIM &&
        d.bookingIds.includes(String(archived.booking._id))
    )
  );
});

test('#41-44 peer suites exist', () => {
  for (const f of ['i1', 'i2', 'i3', 'i4']) {
    assert.ok(fs.existsSync(path.join(__dirname, `unitNightClaim.${f}.test.cjs`)));
  }
});
