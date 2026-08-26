/**
 * REBOOK-S1.2 — CabinNightClaim shadow / dual-write integration.
 * Run: cd server && node --test scripts/cabinNightClaim.s2.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CabinNightClaim = require('../models/CabinNightClaim');
const Booking = require('../models/Booking');
const {
  ERR,
  ACQUISITION_MODES,
  claimCabinNights
} = require('../services/inventory/cabinNightClaimService');
const {
  MODES,
  normalizeMode,
  isCabinNightClaimShadowEnabled
} = require('../services/inventory/cabinNightClaimMode');
const {
  shouldBookingOwnCabinNightClaims,
  describeBookingClaimShape
} = require('../services/inventory/cabinNightClaimQualification');
const {
  ensureCabinNightClaimsShadow,
  SHADOW_OUTCOMES,
  S1_SOURCES
} = require('../services/inventory/ensureCabinNightClaimsShadow');
const {
  syncCabinNightClaimsShadow,
  SYNC_OUTCOMES
} = require('../services/inventory/syncCabinNightClaimsShadow');
const {
  ensureCabinNightClaimsReleasedShadow,
  RELEASE_OUTCOMES
} = require('../services/inventory/ensureCabinNightClaimsReleasedShadow');
const {
  CABIN_NIGHT_CLAIM_S1_WRITERS,
  listCabinNightClaimS1Writers,
  isKnownCabinNightClaimS1Writer
} = require('../services/inventory/cabinNightClaimWriterReadiness');
const { SHADOW_EVENTS } = require('../services/inventory/cabinNightClaimObservability');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;
const prevMode = process.env.CABIN_NIGHT_CLAIM_MODE;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function blockingBooking(overrides = {}) {
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  const checkIn = overrides.checkIn || sofiaDay('2026-09-10');
  const checkOut = overrides.checkOut || sofiaDay('2026-09-13');
  return {
    _id: overrides._id || new mongoose.Types.ObjectId(),
    cabinId,
    checkIn,
    checkOut,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest ?? false,
    archivedAt: overrides.archivedAt ?? null,
    cabinTypeId: overrides.cabinTypeId,
    unitId: overrides.unitId,
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  if (prevMode === undefined) delete process.env.CABIN_NIGHT_CLAIM_MODE;
  else process.env.CABIN_NIGHT_CLAIM_MODE = prevMode;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CabinNightClaim.deleteMany({});
  await Booking.deleteMany({});
  process.env.CABIN_NIGHT_CLAIM_MODE = MODES.SHADOW;
});

// --- MODE ---

test('mode: off performs no claim writes', async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = MODES.OFF;
  const booking = blockingBooking();
  const out = await ensureCabinNightClaimsShadow({ booking, source: S1_SOURCES.FINALIZE });
  assert.equal(out.outcome, SHADOW_OUTCOMES.SKIPPED_OFF);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

test('mode: shadow mirrors claims', async () => {
  const booking = blockingBooking();
  const out = await ensureCabinNightClaimsShadow({ booking, source: S1_SOURCES.LEGACY_CREATE });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, SHADOW_OUTCOMES.MIRRORED);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('mode: authoritative accepted from S1.7 onward', () => {
  assert.equal(normalizeMode(MODES.AUTHORITATIVE), MODES.AUTHORITATIVE);
  assert.equal(isCabinNightClaimShadowEnabled(MODES.AUTHORITATIVE), false);
});

test('mode: invalid env rejected', () => {
  assert.throws(() => normalizeMode('bogus'), (err) => err.code === 'CABIN_NIGHT_CLAIM_MODE_INVALID');
});

test('mode: isCabinNightClaimShadowEnabled respects explicit override', () => {
  assert.equal(isCabinNightClaimShadowEnabled(MODES.OFF), false);
  assert.equal(isCabinNightClaimShadowEnabled(MODES.SHADOW), true);
});

test('acquisitionMode: shadow explicit in ensure adapter', async () => {
  let captured = null;
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({
    booking,
    source: S1_SOURCES.MANUAL_RESERVATION,
    claimCabinNightsFn: async (opts) => {
      captured = opts;
      return claimCabinNights(opts);
    }
  });
  assert.equal(captured.acquisitionMode, ACQUISITION_MODES.SHADOW);
});

test('acquisitionMode: default authoritative cannot silently skip index (service fail-safe)', async () => {
  const { cabinId, bookingA } = {
    cabinId: new mongoose.Types.ObjectId(),
    bookingA: new mongoose.Types.ObjectId()
  };
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-09-10'),
        checkOut: sofiaDay('2026-09-11'),
        source: 'test'
      }),
    (err) => err.code === ERR.INDEX_MISSING
  );
});

// --- QUALIFICATION ---

test('qualification: pending single-cabin blocking qualifies', () => {
  const b = blockingBooking({ status: 'pending' });
  assert.equal(shouldBookingOwnCabinNightClaims(b), true);
  assert.equal(describeBookingClaimShape(b), 'single_cabin_blocking');
});

test('qualification: confirmed and in_house qualify', () => {
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ status: 'confirmed' })), true);
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ status: 'in_house' })), true);
});

test('qualification: cancelled and completed do not qualify', () => {
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ status: 'cancelled' })), false);
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ status: 'completed' })), false);
});

test('qualification: multi-unit skipped', () => {
  const b = {
    _id: new mongoose.Types.ObjectId(),
    cabinTypeId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    status: 'confirmed',
    isTest: false
  };
  assert.equal(shouldBookingOwnCabinNightClaims(b), false);
  assert.equal(describeBookingClaimShape(b), 'multi_unit');
});

test('qualification: malformed mixed cabinId+cabinTypeId skipped', () => {
  const b = blockingBooking({ cabinTypeId: new mongoose.Types.ObjectId() });
  assert.equal(shouldBookingOwnCabinNightClaims(b), false);
  assert.equal(describeBookingClaimShape(b), 'malformed_mixed');
});

test('qualification: isTest and archived skipped', () => {
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ isTest: true })), false);
  assert.equal(shouldBookingOwnCabinNightClaims(blockingBooking({ archivedAt: new Date() })), false);
});

test('qualification: location single child shape qualifies when blocking', () => {
  const b = blockingBooking({
    provenance: { source: 'website', channel: 'location_buyout_child' }
  });
  assert.equal(shouldBookingOwnCabinNightClaims(b), true);
});

// --- ENSURE SHADOW ---

test('ensure: shadow failure does not throw by default', async () => {
  const booking = blockingBooking();
  const out = await ensureCabinNightClaimsShadow({
    booking,
    source: S1_SOURCES.FINALIZE,
    claimCabinNightsFn: async () => {
      const err = new Error('injected');
      err.code = ERR.FOREIGN_OWNER;
      throw err;
    }
  });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, SHADOW_OUTCOMES.FOREIGN_OWNER);
});

test('ensure: throwOnFailure propagates when requested', async () => {
  const booking = blockingBooking();
  await assert.rejects(
    () =>
      ensureCabinNightClaimsShadow({
        booking,
        source: S1_SOURCES.FINALIZE,
        throwOnFailure: true,
        claimCabinNightsFn: async () => {
          throw Object.assign(new Error('fail'), { code: ERR.FOREIGN_OWNER });
        }
      }),
    (err) => err.code === ERR.FOREIGN_OWNER
  );
});

test('ensure: foreign owner observable non-blocking', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const bookingA = blockingBooking({ cabinId });
  const bookingB = blockingBooking({ cabinId, _id: new mongoose.Types.ObjectId() });
  await ensureCabinNightClaimsShadow({ booking: bookingA, source: S1_SOURCES.LEGACY_CREATE });
  const out = await ensureCabinNightClaimsShadow({ booking: bookingB, source: S1_SOURCES.LEGACY_CREATE });
  assert.equal(out.outcome, SHADOW_OUTCOMES.FOREIGN_OWNER);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingA._id }), 3);
});

test('ensure: resolves finalize source aliases', async () => {
  const booking = blockingBooking();
  for (const raw of ['frontend', 'webhook_worker', 'reconcile', '']) {
    // eslint-disable-next-line no-await-in-loop
    const out = await ensureCabinNightClaimsShadow({ booking, source: raw });
    assert.equal(out.source, S1_SOURCES.FINALIZE);
  }
});

test('ensure: recovery source preserved', async () => {
  const booking = blockingBooking();
  const out = await ensureCabinNightClaimsShadow({ booking, source: 'multi_unit_recovery' });
  assert.equal(out.source, S1_SOURCES.RECOVERY);
});

// --- SYNC SHADOW ---

test('sync: extension adds expected nights', async () => {
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({ booking, source: 'date_edit' });
  booking.checkOut = sofiaDay('2026-09-14');
  const out = await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, SYNC_OUTCOMES.SYNCED);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 4);
});

test('sync: shortening removes stale own nights', async () => {
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({ booking, source: 'date_edit' });
  booking.checkOut = sofiaDay('2026-09-11');
  const out = await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  assert.equal(out.ok, true);
  assert.equal(out.releasedCount, 2);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 1);
});

test('sync: reassign source mirrors target and releases old cabin nights', async () => {
  const oldCabin = new mongoose.Types.ObjectId();
  const newCabin = new mongoose.Types.ObjectId();
  const booking = blockingBooking({ cabinId: oldCabin });
  await ensureCabinNightClaimsShadow({ booking, source: 'reassign' });
  booking.cabinId = newCabin;
  const out = await syncCabinNightClaimsShadow({ booking, source: 'reassign' });
  assert.equal(out.ok, true);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: oldCabin }), 0);
  assert.equal(await CabinNightClaim.countDocuments({ cabinId: newCabin }), 3);
});

test('sync: nonblocking booking triggers release not mirror', async () => {
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({ booking, source: 'date_edit' });
  booking.status = 'cancelled';
  const out = await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  assert.equal(out.outcome, SYNC_OUTCOMES.SKIPPED_NOT_QUALIFIED);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('sync: foreign row preserved on partial fill failure', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const foreignBooking = new mongoose.Types.ObjectId();
  await claimCabinNights({
    cabinId,
    bookingId: foreignBooking,
    checkIn: sofiaDay('2026-09-11'),
    checkOut: sofiaDay('2026-09-12'),
    source: 'test',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  const booking = blockingBooking({ cabinId });
  const out = await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  assert.equal(out.ok, false);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: foreignBooking }), 1);
});

test('sync: existing source provenance not rewritten on touch', async () => {
  const booking = blockingBooking();
  await claimCabinNights({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'legacy_create',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  const rows = await CabinNightClaim.find({ bookingId: booking._id }).lean();
  assert.ok(rows.every((r) => r.source === 'legacy_create'));
});

// --- RELEASE SHADOW ---

test('release: blocking->cancelled releases all own claims', async () => {
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({ booking, source: S1_SOURCES.MANUAL_RESERVATION });
  booking.status = 'cancelled';
  await ensureCabinNightClaimsReleasedShadow({ bookingId: booking._id, lifecycleSource: 'status_release' });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: booking._id }), 0);
});

test('release: failure does not throw', async () => {
  const out = await ensureCabinNightClaimsReleasedShadow({
    bookingId: new mongoose.Types.ObjectId(),
    lifecycleSource: 'status_release',
    releaseCabinNightsFn: async () => {
      throw Object.assign(new Error('release fail'), { code: 'INJECTED' });
    }
  });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, RELEASE_OUTCOMES.WRITE_FAILURE);
});

test('release: owner-scoped does not delete foreign claims', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();
  await claimCabinNights({
    cabinId,
    bookingId: a,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-11'),
    source: 'test',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  await claimCabinNights({
    cabinId,
    bookingId: b,
    checkIn: sofiaDay('2026-09-11'),
    checkOut: sofiaDay('2026-09-12'),
    source: 'test',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  await ensureCabinNightClaimsReleasedShadow({ bookingId: a, lifecycleSource: 'finalize_cleanup' });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: b }), 1);
});

test('release: off mode skips writes', async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = MODES.OFF;
  const booking = blockingBooking();
  await claimCabinNights({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'test',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  const out = await ensureCabinNightClaimsReleasedShadow({ bookingId: booking._id });
  assert.equal(out.outcome, RELEASE_OUTCOMES.SKIPPED_OFF);
  assert.equal(await CabinNightClaim.countDocuments({}), 3);
});

// --- OBSERVABILITY ---

test('observability: structured events defined without guest PII fields', () => {
  assert.ok(SHADOW_EVENTS.SHADOW_CLAIM_FAILED);
  assert.ok(SHADOW_EVENTS.SHADOW_FOREIGN_OWNER);
  assert.ok(SHADOW_EVENTS.SHADOW_STAYCHANGE_CONFLICT);
  assert.ok(SHADOW_EVENTS.SHADOW_RELEASE_FAILED);
  assert.ok(SHADOW_EVENTS.SHADOW_MIRROR_MISMATCH);
  assert.ok(SHADOW_EVENTS.SHADOW_INVALID_BOOKING_SHAPE);
  const obsSrc = readSource('services/inventory/cabinNightClaimObservability.js');
  assert.doesNotMatch(obsSrc, /guestInfo|email|phone|specialRequests/i);
});

// --- WRITER READINESS REGISTRY ---

test('readiness: every canonical S1.2 writer represented', () => {
  const expected = [
    'finalize',
    'legacy_create',
    'manual_reservation',
    'location_child',
    'date_edit',
    'reassign',
    'status_release'
  ];
  assert.deepEqual([...CABIN_NIGHT_CLAIM_S1_WRITERS].sort(), expected.sort());
  assert.deepEqual(listCabinNightClaimS1Writers().sort(), expected.sort());
  for (const w of expected) assert.equal(isKnownCabinNightClaimS1Writer(w), true);
  assert.equal(isKnownCabinNightClaimS1Writer('production_process'), false);
});

test('readiness: registry does not claim live process deployment readiness', () => {
  const src = readSource('services/inventory/cabinNightClaimWriterReadiness.js');
  assert.match(src, /Does NOT prove live process/);
  assert.doesNotMatch(src, /process\.env\.NODE_ENV|deployment.*ready/i);
});

// --- STATIC WRITER COVERAGE ---

test('static: finalize integrates cabin shadow post-canonical', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  assert.match(src, /ensureCabinNightClaimsShadow/);
  assert.match(src, /ensureCabinNightClaimsReleasedShadow/);
  assert.match(src, /shadowReleaseBeforeBookingDelete/);
  assert.match(src, /throwOnFailure: false/);
});

// S1.7 routed these writers through the mode-aware wrappers in
// cabinNightClaimAuthorityOps, which still delegate to the shadow helpers when
// CABIN_NIGHT_CLAIM_MODE=shadow.
test('static: legacy create mirrors and releases on delete', () => {
  const src = readSource('routes/bookingRoutes.js');
  assert.match(src, /postMirrorCabinNightsAfterCanonical/);
  assert.match(src, /CABIN_S1_SOURCES\.LEGACY_CREATE/);
  assert.match(src, /shadowReleaseBeforeLegacyBookingDelete/);
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
});

test('static: reservationWriteService wires manual, date edit, reassign, status release', () => {
  const src = readSource('services/ops/domain/reservationWriteService.js');
  assert.match(src, /postMirrorCabinNightsAfterCanonical/);
  assert.match(src, /syncCabinNightClaimsShadow/);
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
  assert.match(src, /CABIN_S1_SOURCES\.MANUAL_RESERVATION/);
  assert.match(src, /source: 'reassign'/);
  assert.match(src, /source: 'date_edit'/);
  assert.match(src, /kind === 'cancel' \|\| kind === 'complete'/);
});

test('static: location child mirrors single-cabin and rollback releases', () => {
  const src = readSource('services/locationCheckout/locationCheckoutService.js');
  assert.match(src, /postMirrorCabinNightsAfterCanonical/);
  assert.match(src, /CABIN_S1_SOURCES\.LOCATION_CHILD/);
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
  assert.match(src, /LIFECYCLE_SOURCES\.LOCATION_ROLLBACK/);
});

test('static: maintenance delete releases cabin claims', () => {
  const src = readSource('services/maintenance/maintenanceOpsService.js');
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
});

test('static: recovery multi-unit path does not duplicate cabin finalize integration', () => {
  const recovery = readSource('services/checkout/multiUnitPaidOrphanRecoveryService.js');
  assert.doesNotMatch(recovery, /ensureCabinNightClaimsShadow/);
  assert.match(recovery, /ensureUnitNightClaimsShadow/);
});

test('static: no unique index creation in S1.2 surface', () => {
  const service = readSource('services/inventory/cabinNightClaimService.js');
  assert.doesNotMatch(service, /syncIndexes\(\).*authoritative/);
  for (const rel of [
    'services/inventory/ensureCabinNightClaimsShadow.js',
    'services/inventory/syncCabinNightClaimsShadow.js',
    'services/inventory/cabinNightClaimMode.js'
  ]) {
    const body = readSource(rel);
    assert.doesNotMatch(body, /createIndex|syncIndexes/);
  }
});

test('static: public availability readers unchanged by S1.2 adapters', () => {
  for (const rel of [
    'services/publicAvailabilityService.js',
    'services/ops/domain/conflictService.js'
  ]) {
    const body = readSource(rel);
    assert.doesNotMatch(body, /CabinNightClaim/);
  }
});

// --- INTEGRATION: MANUAL CREATE SHAPE ---

test('integration: manual create path mirrors after overlap guard (source contract)', async () => {
  const src = readSource('services/ops/domain/reservationWriteService.js');
  const body = src.slice(src.indexOf('async function createManualReservation('));
  const preClaimIdx = body.indexOf('preAcquireCabinNightsForCreate(');
  const saveIdx = body.indexOf('await booking.save({ validateBeforeSave: false });');
  const overlapIdx = body.indexOf('if (overlaps > 0 || blockRace > 0)');
  const mirrorIdx = body.indexOf('postMirrorCabinNightsAfterCanonical(');
  // S1.7 authoritative acquires before persistence; shadow still mirrors after.
  assert.ok(preClaimIdx > 0);
  assert.ok(preClaimIdx < saveIdx);
  assert.ok(saveIdx < overlapIdx);
  assert.ok(overlapIdx < mirrorIdx);
});

test('integration: legacy overlap delete precedes lasting shadow claims (ordering contract)', () => {
  const src = readSource('routes/bookingRoutes.js');
  assert.match(src, /shadowReleaseBeforeLegacyBookingDelete/);
  const mirrorIdx = src.indexOf('ensureCabinNightClaimsShadow');
  const deleteIdx = src.indexOf('shadowReleaseBeforeLegacyBookingDelete');
  assert.ok(mirrorIdx > 0);
  assert.ok(deleteIdx > 0);
});

// --- FAILURE INJECTION REGRESSION ---

test('failure injection: sync release failure returns write failure not throw', async () => {
  const booking = blockingBooking();
  await ensureCabinNightClaimsShadow({ booking, source: 'date_edit' });
  booking.checkOut = sofiaDay('2026-09-11');
  const out = await syncCabinNightClaimsShadow({
    booking,
    source: 'date_edit',
    releaseCabinNightsFn: async () => {
      throw new Error('release injected');
    }
  });
  assert.equal(out.ok, false);
  assert.match(out.errorMessage, /release injected/);
});

test('failure injection: ensure invalid booking shape non-throwing', async () => {
  const out = await ensureCabinNightClaimsShadow({ booking: { _id: new mongoose.Types.ObjectId() } });
  assert.equal(out.outcome, SHADOW_OUTCOMES.SKIPPED_NOT_QUALIFIED);
});

test('failure injection: mode off sync skips', async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = MODES.OFF;
  const booking = blockingBooking();
  const out = await syncCabinNightClaimsShadow({ booking, source: 'date_edit' });
  assert.equal(out.outcome, SYNC_OUTCOMES.SKIPPED_OFF);
});
