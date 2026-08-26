/**
 * REBOOK-S1.8 — CabinNightClaim post-cutover reconciliation.
 * Run: cd server && node --test scripts/cabinNightClaim.s8.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinNightClaim = require('../models/CabinNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../models/CabinNightClaim');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  ACQUISITION_MODES,
  claimCabinNights,
  releaseCabinNights,
  ERR: CLAIM_ERR
} = require('../services/inventory/cabinNightClaimService');
const {
  REPAIR_KIND,
  MANUAL_REASONS,
  buildRepairPlanFromPreflight,
  runCabinNightClaimS1Reconciliation,
  exitCodeForReport,
  gateMutationPrecheck
} = require('../services/inventory/cabinNightClaimS1ReconciliationService');
const { runCabinNightClaimS1Preflight } = require('../services/inventory/cabinNightClaimS1PreflightService');
const { parseArgs, main: reconcileMain } = require('./cabinNightClaimS1Reconcile');

let mongoServer;
const ORIG_MODE = process.env.CABIN_NIGHT_CLAIM_MODE;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function ensureExactIndex() {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
}

async function dropExactIndex() {
  try {
    await CabinNightClaim.collection.dropIndex(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name);
  } catch {
    /* absent ok */
  }
}

async function makeCabin(name = 'S18-Cabin') {
  return Cabin.create({
    name: `${name}-${new mongoose.Types.ObjectId()}`,
    location: 'Valley',
    description: 'S1.8 test cabin',
    imageUrl: 'https://example.com/cabin.jpg',
    capacity: 2,
    pricePerNight: 100,
    isActive: true
  });
}

async function makeBooking(overrides = {}) {
  const cabin = overrides.cabin || (await makeCabin());
  const doc = {
    cabinId: overrides.cabinId !== undefined ? overrides.cabinId : cabin._id,
    cabinTypeId: overrides.cabinTypeId,
    unitId: overrides.unitId,
    checkIn: overrides.checkIn || sofiaDay('2026-12-10'),
    checkOut: overrides.checkOut || sofiaDay('2026-12-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: overrides.email || `s18-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+35900000000'
    },
    totalPrice: 200,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest ?? false,
    archivedAt: overrides.archivedAt ?? undefined
  };
  Object.keys(doc).forEach((k) => {
    if (doc[k] === undefined) delete doc[k];
  });
  return Booking.create(doc);
}

async function claimAuth({ cabinId, bookingId, nights, source = 'bootstrap' }) {
  return claimCabinNights({
    cabinId,
    bookingId,
    nights,
    source,
    acquisitionMode: ACQUISITION_MODES.AUTHORITATIVE
  });
}

async function clearDb() {
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinNightClaim.deleteMany({})
  ]);
}

test.before(async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = 'authoritative';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await ensureExactIndex();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (ORIG_MODE === undefined) delete process.env.CABIN_NIGHT_CLAIM_MODE;
  else process.env.CABIN_NIGHT_CLAIM_MODE = ORIG_MODE;
});

test.beforeEach(async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = 'authoritative';
  await clearDb();
  try {
    await CabinNightClaim.collection.dropIndexes();
  } catch {
    /* collection may not exist yet */
  }
  await ensureExactIndex();
});

// ---------------------------------------------------------------------------
// CLI flags / exit codes
// ---------------------------------------------------------------------------

test('CLI: default parse is verify-only (no mutation flags)', () => {
  const args = parseArgs([]);
  assert.equal(args.verify, false);
  assert.equal(args.repair, false);
  assert.equal(args.applySafeRepairs, false);
});

test('CLI: --verify sets verify', () => {
  assert.equal(parseArgs(['--verify']).verify, true);
});

test('CLI: --repair alone is parsed but main refuses without apply', async () => {
  const args = parseArgs(['--repair']);
  assert.equal(args.repair, true);
  assert.equal(args.applySafeRepairs, false);
});

test('CLI: dual flags required for mutation', () => {
  const args = parseArgs(['--repair', '--apply-safe-repairs']);
  assert.equal(args.repair, true);
  assert.equal(args.applySafeRepairs, true);
});

test('exitCode: clean report returns 0', () => {
  assert.equal(exitCodeForReport({ clean: true, scanCompleteness: 'full' }), 0);
});

test('exitCode: unclean returns 2 not 1', () => {
  assert.equal(exitCodeForReport({ clean: false, scanCompleteness: 'full' }), 2);
});

test('exitCode: failed scan returns 1', () => {
  assert.equal(exitCodeForReport({ clean: false, scanCompleteness: 'failed' }), 1);
});

test('exitCode: null report returns 1', () => {
  assert.equal(exitCodeForReport(null), 1);
});

test('service: repair without applySafeRepairs throws', async () => {
  await assert.rejects(
    () => runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: false }),
    (err) => err.code === 'S1_8_REPAIR_FLAGS_REQUIRED'
  );
});

// ---------------------------------------------------------------------------
// READ-ONLY verify
// ---------------------------------------------------------------------------

test('VERIFY: default mode mutates nothing on clean parity', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, checkIn: sofiaDay('2026-12-01'), checkOut: sofiaDay('2026-12-03') });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-01', '2026-12-02'] });
  const before = await CabinNightClaim.countDocuments();
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.equal(report.mode, 'verify');
  assert.equal(report.repair.attempted, false);
  assert.equal(await CabinNightClaim.countDocuments(), before);
  assert.equal(report.clean, true);
  assert.equal(exitCodeForReport(report), 0);
});

test('VERIFY: missing claim is planned as SAFE_INSERT without mutating', async () => {
  const cabin = await makeCabin();
  await makeBooking({ cabin, checkIn: sofiaDay('2026-12-01'), checkOut: sofiaDay('2026-12-03') });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.equal(report.plan.counts.safeInsertClaims, 2);
  assert.equal(report.repair.attempted, false);
  assert.equal(await CabinNightClaim.countDocuments(), 0);
  assert.equal(report.clean, false);
});

test('VERIFY: report has no guest PII keys', async () => {
  const cabin = await makeCabin();
  await makeBooking({ cabin, email: 'secret-guest@example.com' });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  const blob = JSON.stringify(report);
  assert.doesNotMatch(blob, /secret-guest/);
  assert.doesNotMatch(blob, /firstName|lastName|phone/i);
});

test('VERIFY: classification matrix exposes manual vs safe buckets', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'cancelled' });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  const orphanId = new mongoose.Types.ObjectId();
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: orphanId,
    night: sofiaDay('2026-12-20'),
    source: 'other'
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(report.plan.safeReleaseClaims.length >= 1);
  assert.ok(report.plan.manualRequired.some((m) => m.reason === MANUAL_REASONS.ORPHAN_AMBIGUOUS));
});

// ---------------------------------------------------------------------------
// SAFE INSERT
// ---------------------------------------------------------------------------

test('SAFE INSERT: one missing night is inserted', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(report.repair.attempted, true);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 1);
  assert.equal(report.postVerify.counts.missing, 0);
});

test('SAFE INSERT: multiple missing nights inserted', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-04')
  });
  await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('SAFE INSERT: same-owner idempotent on rerun', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  const mid = await CabinNightClaim.countDocuments({ bookingId: booking._id });
  const second = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), mid);
  assert.equal(second.plan.counts.safeInsertClaims, 0);
  assert.equal(second.clean, true);
});

test('SAFE INSERT: foreign conflict refuses and leaves incumbent', async () => {
  const cabin = await makeCabin();
  const incumbent = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabin._id, bookingId: incumbent._id, nights: ['2026-12-01'] });
  const challenger = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  const incumbentClaims = await CabinNightClaim.countDocuments({ bookingId: incumbent._id });
  const challengerClaims = await CabinNightClaim.countDocuments({ bookingId: challenger._id });
  assert.equal(incumbentClaims, 1);
  assert.equal(challengerClaims, 0);
  assert.ok(report.plan.manualRequired.length >= 1 || report.repair.failures >= 1);
});

test('SAFE INSERT: does not mutate Booking commercial fields', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03'),
    status: 'confirmed'
  });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  const refreshed = await Booking.findById(booking._id).lean();
  assert.equal(String(refreshed.status), 'confirmed');
  assert.equal(String(refreshed.cabinId), String(cabin._id));
  assert.equal(refreshed.totalPrice, 200);
});

// ---------------------------------------------------------------------------
// SAFE RELEASE
// ---------------------------------------------------------------------------

test('SAFE RELEASE: nonblocking Booking claims released', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'cancelled' });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
  assert.ok(report.repair.successes >= 1);
});

test('SAFE RELEASE: excluded/archived Booking claims released', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, archivedAt: new Date() });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('SAFE RELEASE: retry is idempotent', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'completed' });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  const second = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(second.plan.counts.safeReleaseClaims, 0);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('SAFE RELEASE: never releases foreign owner claims', async () => {
  const cabin = await makeCabin();
  const owner = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02'),
    status: 'confirmed'
  });
  await claimAuth({ cabinId: cabin._id, bookingId: owner._id, nights: ['2026-12-01'] });
  const cancelled = await makeBooking({
    cabin: await makeCabin('other'),
    status: 'cancelled',
    checkIn: sofiaDay('2026-12-05'),
    checkOut: sofiaDay('2026-12-06')
  });
  await claimAuth({
    cabinId: cancelled.cabinId,
    bookingId: cancelled._id,
    nights: ['2026-12-05']
  });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: owner._id }), 1);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: cancelled._id }), 0);
});

// ---------------------------------------------------------------------------
// TARGET FIRST
// ---------------------------------------------------------------------------

test('TARGET FIRST: outside-range surplus released after target secured', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimAuth({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2026-12-01', '2026-12-02']
  });
  // Surplus night outside the occupied range.
  await claimAuth({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2026-12-03']
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 3);

  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 2);
  assert.ok(report.repair.log.some((l) => l.kind === REPAIR_KIND.SAFE_TARGET_FIRST && l.ok));
});

test('TARGET FIRST: wrong-cabin claim moved to booking cabin', async () => {
  const cabinA = await makeCabin('A');
  const cabinB = await makeCabin('B');
  const booking = await makeBooking({
    cabin: cabinA,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabinB._id, bookingId: booking._id, nights: ['2026-12-01'] });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: cabinA._id, bookingId: booking._id }), 1);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: cabinB._id, bookingId: booking._id }), 0);
});

test('TARGET FIRST: target conflict retains source claims', async () => {
  const cabinA = await makeCabin('A');
  const cabinB = await makeCabin('B');
  const booking = await makeBooking({
    cabin: cabinA,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabinB._id, bookingId: booking._id, nights: ['2026-12-01'] });
  const incumbent = await makeBooking({
    cabin: cabinA,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabinA._id, bookingId: incumbent._id, nights: ['2026-12-01'] });

  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: cabinB._id, bookingId: booking._id }), 1);
  assert.ok(report.repair.log.some((l) => l.kind === REPAIR_KIND.SAFE_TARGET_FIRST && l.ok === false));
});

test('TARGET FIRST: source release failure retains conservative target+source', async () => {
  const cabinA = await makeCabin('A');
  const cabinB = await makeCabin('B');
  const booking = await makeBooking({
    cabin: cabinA,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabinB._id, bookingId: booking._id, nights: ['2026-12-01'] });

  let releaseCalls = 0;
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false,
    releaseCabinNightsFn: async (args) => {
      releaseCalls += 1;
      if (String(args.cabinId) === String(cabinB._id)) {
        throw new Error('injected surplus release failure');
      }
      return releaseCabinNights(args);
    }
  });

  assert.ok(releaseCalls >= 1);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: cabinA._id, bookingId: booking._id }), 1);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: cabinB._id, bookingId: booking._id }), 1);
  assert.ok(report.repair.sourceReleaseFailures >= 1);
  assert.equal(report.clean, false);
});

test('TARGET FIRST: plan orders target acquire semantics in service source', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  const claimIdx = src.indexOf('// 1) Secure canonical target first.');
  const releaseIdx = src.indexOf('// 2) Release surplus same-owner claims LAST');
  assert.ok(claimIdx > 0 && releaseIdx > claimIdx);
});

// ---------------------------------------------------------------------------
// MANUAL
// ---------------------------------------------------------------------------

test('MANUAL: orphan is never auto-deleted', async () => {
  const cabin = await makeCabin();
  const ghost = new mongoose.Types.ObjectId();
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: ghost,
    night: sofiaDay('2026-12-15'),
    source: 'other'
  });
  const before = await CabinNightClaim.countDocuments({ bookingId: ghost });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: ghost }), before);
  assert.ok(report.plan.manualRequired.some((m) => m.reason === MANUAL_REASONS.ORPHAN_AMBIGUOUS));
  assert.equal(report.clean, false);
});

test('MANUAL: canonical collision classified', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-02'),
    checkOut: sofiaDay('2026-12-04')
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(
    report.plan.manualRequired.some((m) => m.reason === MANUAL_REASONS.CANONICAL_COLLISION)
  );
});

test('MANUAL: malformed Booking classified', async () => {
  const cabin = await makeCabin();
  // Bypass mongoose validators to create a mixed-shape blocking Booking.
  await Booking.collection.insertOne({
    cabinId: cabin._id,
    cabinTypeId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-12-10'),
    checkOut: sofiaDay('2026-12-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: `s18-malformed-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+35900000000'
    },
    totalPrice: 200,
    status: 'confirmed',
    isTest: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(
    report.counts.malformedBookings >= 1 ||
      report.plan.manualRequired.some(
        (m) =>
          m.reason === MANUAL_REASONS.MALFORMED_BOOKING ||
          m.reason === MANUAL_REASONS.MULTI_INVENTORY_SHAPE ||
          m.reason === MANUAL_REASONS.MALFORMED_COMMERCIAL_SHAPE
      )
  );
});

test('MANUAL: invalid cabin reference classified', async () => {
  await makeBooking({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(
    report.plan.manualRequired.some((m) => m.reason === MANUAL_REASONS.INVALID_CABIN_REFERENCE)
  );
});

test('MANUAL: foreign claim conflict classified', async () => {
  const cabin = await makeCabin();
  const a = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  const b = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await claimAuth({ cabinId: cabin._id, bookingId: a._id, nights: ['2026-12-01'] });
  // b expected missing but claim owned by a => foreign / collision path
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(
    report.plan.manualRequired.some(
      (m) =>
        m.reason === MANUAL_REASONS.FOREIGN_CLAIM_CONFLICT ||
        m.reason === MANUAL_REASONS.CANONICAL_COLLISION
    ) || report.plan.counts.safeInsertClaims >= 1
  );
  void b;
});

// ---------------------------------------------------------------------------
// INDEX GATE
// ---------------------------------------------------------------------------

test('INDEX: missing exact index refuses repair', async () => {
  await dropExactIndex();
  const cabin = await makeCabin();
  await makeBooking({ cabin, checkIn: sofiaDay('2026-12-01'), checkOut: sofiaDay('2026-12-02') });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(report.refused, true);
  assert.ok(
    report.refuseCode === MANUAL_REASONS.INDEX_MISSING ||
      report.refuseCode === MANUAL_REASONS.INDEX_WRONG
  );
  assert.equal(report.repair.attempted, false);
  assert.equal(await CabinNightClaim.countDocuments(), 0);
  await ensureExactIndex();
});

test('INDEX: gateMutationPrecheck rejects non-exact state', () => {
  const gate = gateMutationPrecheck({
    toolFailure: false,
    scanCompleteness: 'full',
    authoritativeIndexState: 'MISSING',
    authoritativeUniquePresent: false,
    writerReadiness: { codeReady: true }
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, MANUAL_REASONS.INDEX_MISSING);
});

test('INDEX: S1.8 service never creates/drops/syncs indexes', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(src, /\.createIndex\s*\(/);
  assert.doesNotMatch(src, /\.dropIndex\s*\(/);
  assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
});

test('INDEX: CLI never creates/drops indexes', () => {
  const src = readSource('scripts/cabinNightClaimS1Reconcile.js');
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
});

// ---------------------------------------------------------------------------
// POST VERIFY / CLEAN
// ---------------------------------------------------------------------------

test('POST VERIFY: clean repair yields clean=true and exit 0', async () => {
  const cabin = await makeCabin();
  await makeBooking({ cabin, checkIn: sofiaDay('2026-12-01'), checkOut: sofiaDay('2026-12-03') });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(report.postVerify.readyForStableVerification, true);
  assert.equal(report.clean, true);
  assert.equal(exitCodeForReport(report), 0);
});

test('POST VERIFY: manual blockers remain => not clean', async () => {
  const cabin = await makeCabin();
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: new mongoose.Types.ObjectId(),
    night: sofiaDay('2026-12-18'),
    source: 'other'
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.ok(report.manualRequiredRemaining >= 1);
  assert.equal(report.clean, false);
  assert.equal(exitCodeForReport(report), 2);
});

test('POST VERIFY: does not claim CLEAN when only manual remains after safe work', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: new mongoose.Types.ObjectId(),
    night: sofiaDay('2026-12-25'),
    source: 'other'
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(report.postVerify.counts.missing, 0);
  assert.ok(report.manualRequiredRemaining >= 1);
  assert.equal(report.clean, false);
});

// ---------------------------------------------------------------------------
// NON-TOUCH / STATIC
// ---------------------------------------------------------------------------

test('STATIC: no REBOOK mutation implementation in S1.8 files', () => {
  const svc = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  const cli = readSource('scripts/cabinNightClaimS1Reconcile.js');
  assert.doesNotMatch(svc, /rebookStayChange|createRebook/i);
  assert.doesNotMatch(cli, /rebookStayChange|createRebook/i);
});

test('STATIC: no client/ Cleaning / payment paths touched', () => {
  const svc = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(svc, /client\//);
  assert.doesNotMatch(svc, /cleaningPricing|CleaningTask/);
  assert.doesNotMatch(svc, /stripe\.|PaymentIntent/);
});

test('STATIC: UnitNightClaim not mutated by S1.8', () => {
  const svc = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(svc, /UnitNightClaim|claimUnitNights|releaseUnitNights/);
});

test('STATIC: uses claimCabinNights / releaseCabinNights not raw broad deletes for repair', () => {
  const svc = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.match(svc, /claimCabinNights/);
  assert.match(svc, /releaseCabinNights/);
  assert.doesNotMatch(svc, /CabinNightClaim\.deleteMany\(\s*\{\s*\}\s*\)/);
  assert.doesNotMatch(svc, /CabinNightClaim\.insertMany/);
});

test('STATIC: docs lock §24.45 present', () => {
  const docs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'stay-change-implementation-plan.md'),
    'utf8'
  );
  assert.match(docs, /### 24\.45 S1\.8/);
  assert.match(docs, /ORPHAN_AMBIGUOUS/);
  assert.match(docs, /--apply-safe-repairs/);
});

test('STATIC: reader migration explicitly OUT of S1.8', () => {
  const docs = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'stay-change-implementation-plan.md'),
    'utf8'
  );
  const section = docs.slice(docs.indexOf('### 24.45'), docs.indexOf('#### 24.45.1'));
  assert.match(section, /reader migration/);
  assert.match(section, /\*\*OUT\*\*/);
});

test('buildRepairPlan: deterministic sort of safe inserts', () => {
  const plan = buildRepairPlanFromPreflight({
    missingOwnership: [],
    fullDriftLists: {
      missing: [
        { cabinId: 'c2', night: '2026-01-02', bookingId: 'b2' },
        { cabinId: 'c1', night: '2026-01-01', bookingId: 'b1' }
      ],
      stale: [],
      orphan: [],
      wrongCabin: [],
      outsideRange: [],
      sameOwnerDuplicates: [],
      foreignOwnerDuplicates: [],
      foreignClaimConflicts: [],
      canonicalCollisions: [],
      claimsForNonblockingBooking: [],
      claimsForExcludedBooking: [],
      claimsForMultiInventoryBooking: [],
      claimsForMalformedBooking: [],
      malformedBookings: [],
      malformedClaims: [],
      invalidCabinReferences: [],
      invalidDateRanges: []
    }
  });
  assert.equal(plan.safeInsertClaims[0].bookingId, 'b1');
  assert.equal(plan.safeInsertClaims[1].bookingId, 'b2');
});

test('preflight fullDriftLists: missing list is unbounded when requested', async () => {
  const c2 = await makeCabin();
  await makeBooking({
    cabin: c2,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-31')
  });
  const pf = await runCabinNightClaimS1Preflight({ fullDriftLists: true });
  assert.ok(pf.fullDriftLists);
  assert.equal(pf.fullDriftLists.missing.length, pf.counts.missing);
  assert.ok(pf.fullDriftLists.missing.length > 25);
  assert.ok(pf.samples.missing.length <= 25);
});

test('MRI: repair opens MRI for manual orphans when enabled', async () => {
  const cabin = await makeCabin();
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: new mongoose.Types.ObjectId(),
    night: sofiaDay('2026-12-22'),
    source: 'other'
  });
  const opened = [];
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: true,
    openManualReviewItemFn: async (payload) => {
      opened.push(payload);
      return { _id: new mongoose.Types.ObjectId() };
    }
  });
  assert.ok(opened.length >= 1);
  assert.equal(opened[0].category, 'cabin_night_claim_reconciliation');
  assert.doesNotMatch(JSON.stringify(opened), /@example\.com|firstName/);
  assert.ok(report.mriIds.length >= 1);
});

test('repo search: S1.8 does not add broad unscoped claim deletes', () => {
  const svc = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(svc, /deleteMany\(\s*\{\s*cabinId/);
  assert.match(svc, /releaseCabinNights/);
});

test('CLI main: --repair without --apply-safe-repairs exits 1', async () => {
  const prev = process.exitCode;
  process.exitCode = 0;
  const result = await reconcileMain(['--repair']);
  assert.equal(result, null);
  assert.equal(process.exitCode, 1);
  process.exitCode = prev || 0;
});

test('CLI main: --apply-safe-repairs without --repair exits 1', async () => {
  const prev = process.exitCode;
  process.exitCode = 0;
  const result = await reconcileMain(['--apply-safe-repairs']);
  assert.equal(result, null);
  assert.equal(process.exitCode, 1);
  process.exitCode = prev || 0;
});

test('CLI main: --verify and --repair together exits 1', async () => {
  const prev = process.exitCode;
  process.exitCode = 0;
  const result = await reconcileMain(['--verify', '--repair', '--apply-safe-repairs']);
  assert.equal(result, null);
  assert.equal(process.exitCode, 1);
  process.exitCode = prev || 0;
});

test('VERIFY: expected==actual clean fingerprint path', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-01', '2026-12-02'] });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.equal(report.counts.expected, report.counts.actual);
  assert.equal(report.counts.missing, 0);
  assert.equal(report.plan.counts.safeTotal, 0);
  assert.equal(report.plan.counts.manualRequired, 0);
});

test('SAFE INSERT: groups multiple missing nights per booking', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-05')
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  const insertLogs = report.repair.log.filter((l) => l.kind === REPAIR_KIND.SAFE_INSERT && l.ok);
  assert.equal(insertLogs.length, 1);
  assert.equal(insertLogs[0].nights.length, 4);
});

test('SAFE RELEASE: completed status releases claims', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'completed' });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('SAFE RELEASE: isTest Booking treated as excluded release', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, isTest: true });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-10'] });
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('plan: orphan reason code is ORPHAN_AMBIGUOUS', async () => {
  const cabin = await makeCabin();
  await CabinNightClaim.collection.insertOne({
    cabinId: cabin._id,
    bookingId: new mongoose.Types.ObjectId(),
    night: sofiaDay('2026-12-19'),
    source: 'other'
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  const orphan = report.plan.manualRequired.find((m) => m.classification === 'orphan');
  assert.ok(orphan);
  assert.equal(orphan.reason, MANUAL_REASONS.ORPHAN_AMBIGUOUS);
  assert.equal(orphan.kind, REPAIR_KIND.MANUAL_REQUIRED);
});

test('plan: invalid date range is MANUAL', async () => {
  const cabin = await makeCabin();
  await Booking.collection.insertOne({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-12-10'),
    checkOut: sofiaDay('2026-12-09'),
    adults: 1,
    children: 0,
    guestInfo: {
      firstName: 'T',
      lastName: 'G',
      email: `s18-invdate-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+359'
    },
    totalPrice: 1,
    status: 'confirmed',
    isTest: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const report = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.ok(
    report.counts.invalidDateRanges >= 1 ||
      report.plan.manualRequired.some((m) => m.reason === MANUAL_REASONS.INVALID_DATE_RANGE)
  );
});

test('gate: writer not ready refuses mutation', () => {
  const gate = gateMutationPrecheck({
    toolFailure: false,
    scanCompleteness: 'full',
    authoritativeIndexState: 'EXACT',
    authoritativeUniquePresent: true,
    writerReadiness: { codeReady: false }
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, MANUAL_REASONS.WRITER_NOT_READY);
});

test('gate: tool failure refuses mutation', () => {
  const gate = gateMutationPrecheck({
    toolFailure: true,
    toolFailureMessage: 'boom',
    scanCompleteness: 'failed',
    authoritativeIndexState: 'EXACT',
    writerReadiness: { codeReady: true }
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, MANUAL_REASONS.TOOL_FAILURE);
});

test('gate: incomplete scan refuses mutation', () => {
  const gate = gateMutationPrecheck({
    toolFailure: false,
    scanCompleteness: 'partial',
    authoritativeIndexState: 'EXACT',
    writerReadiness: { codeReady: true }
  });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, MANUAL_REASONS.SCAN_INCOMPLETE);
});

test('STATIC: dual-flag mutation requirement documented in service throw', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.match(src, /S1_8_REPAIR_FLAGS_REQUIRED/);
  assert.match(src, /--repair and --apply-safe-repairs/);
});

test('STATIC: no source-first release comment inverted', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(src, /Release surplus.*before.*target/i);
  assert.match(src, /Secure canonical target first/);
});

test('STATIC: AvailabilityBlock unused by S1.8 reconcile', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(src, /AvailabilityBlock/);
});

test('STATIC: R1 StayChange unused by S1.8 reconcile', () => {
  const src = readSource('services/inventory/cabinNightClaimS1ReconciliationService.js');
  assert.doesNotMatch(src, /StayChange|reallocateStayChange/);
});

test('IDEMPOTENCY: verify twice yields same clean fingerprint', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03')
  });
  await claimAuth({ cabinId: cabin._id, bookingId: booking._id, nights: ['2026-12-01', '2026-12-02'] });
  const a = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  const b = await runCabinNightClaimS1Reconciliation({ mode: 'verify' });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.clean, true);
  assert.equal(b.clean, true);
});

test('REPAIR: mixed missing + nonblocking release in one pass', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  const cancelled = await makeBooking({
    cabin: await makeCabin('CX'),
    status: 'cancelled',
    checkIn: sofiaDay('2026-12-05'),
    checkOut: sofiaDay('2026-12-06')
  });
  await claimAuth({
    cabinId: cancelled.cabinId,
    bookingId: cancelled._id,
    nights: ['2026-12-05']
  });
  const report = await runCabinNightClaimS1Reconciliation({
    mode: 'repair',
    applySafeRepairs: true,
    openMri: false
  });
  assert.equal(report.clean, true);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: cancelled._id }), 0);
  assert.equal(await CabinNightClaim.countDocuments({}), 1);
});

test('NONTOUCH: payment fields on Booking unchanged after repair', async () => {
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { stripePaymentIntentId: 'pi_s18_test', totalPrice: 777 } }
  );
  await runCabinNightClaimS1Reconciliation({ mode: 'repair', applySafeRepairs: true, openMri: false });
  const refreshed = await Booking.findById(booking._id).lean();
  assert.equal(refreshed.stripePaymentIntentId, 'pi_s18_test');
  assert.equal(refreshed.totalPrice, 777);
});
