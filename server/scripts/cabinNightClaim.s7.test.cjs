/**
 * REBOOK-S1.7 — authoritative CabinNightClaim writer semantics.
 * Binding: docs/stay-change-implementation-plan.md — §24.44.
 *
 * Run: cd server && node --test scripts/cabinNightClaim.s7.test.cjs
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
const Guest = require('../models/Guest');
const AuditEvent = require('../models/AuditEvent');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const ManualReviewItem = require('../models/ManualReviewItem');
const CabinNightClaim = require('../models/CabinNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../models/CabinNightClaim');

const {
  MODES,
  SUPPORTED_MODES,
  normalizeMode,
  readConfiguredMode,
  getCabinNightClaimMode,
  isCabinNightClaimOff,
  isCabinNightClaimShadowEnabled,
  isCabinNightClaimAuthoritativeEnabled,
  isCabinNightClaimWritesEnabled
} = require('../services/inventory/cabinNightClaimMode');

const {
  assertCabinNightClaimAuthoritativeBootReady
} = require('../services/inventory/cabinNightClaimAuthoritativeBoot');

const {
  preAcquireCabinNightsForCreate,
  preAcquireCabinNightsForMutation,
  compensateCreateAttemptClaims,
  postMirrorCabinNightsAfterCanonical,
  releaseCabinNightsAfterCanonicalNonOwning,
  releaseSurplusCabinNightsAuthoritative,
  bookingQualifiesForSingleCabinAuthority,
  bookingIsValidSingleCabinShape,
  CLAIM_ERR,
  ACQUISITION_MODES
} = require('../services/inventory/cabinNightClaimAuthorityOps');

const {
  claimCabinNights,
  releaseCabinNights,
  listCabinNightClaims,
  ERR: SERVICE_ERR
} = require('../services/inventory/cabinNightClaimService');

const {
  CABIN_NIGHT_CLAIM_S1_WRITERS,
  STATUS_RELEASE_COVERS,
  listCabinNightClaimS1Writers,
  isKnownCabinNightClaimS1Writer,
  listStatusReleaseCoverage
} = require('../services/inventory/cabinNightClaimWriterReadiness');

const {
  AUTHORITY_EVENTS
} = require('../services/inventory/cabinNightClaimObservability');

const { SHADOW_OUTCOMES } = require('../services/inventory/ensureCabinNightClaimsShadow');
const { RELEASE_OUTCOMES } = require('../services/inventory/ensureCabinNightClaimsReleasedShadow');

const {
  createManualReservation,
  editReservationDates,
  reassignReservation,
  transitionReservation
} = require('../services/ops/domain/reservationWriteService');
const {
  archiveReservation,
  deleteFixtureReservation
} = require('../services/maintenance/maintenanceOpsService');
const { clearAllRememberedResults } = require('../services/idempotencyService');

const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');

let mongoServer;
let seq = 0;
const ORIG_MODE = process.env.CABIN_NIGHT_CLAIM_MODE;
const AUTH_INDEX_NAME = AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

/** Source slice between two anchors so ordering proofs stay inside one function. */
function sliceBetween(src, startMarker, endMarker = null) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  if (!endMarker) return src.slice(start);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return src.slice(start, end);
}

function orderedIn(body, ...markers) {
  let cursor = -1;
  for (const marker of markers) {
    const at = body.indexOf(marker, cursor + 1);
    assert.ok(at > cursor, `expected "${marker}" after position ${cursor}`);
    cursor = at;
  }
  return true;
}

function setMode(mode) {
  process.env.CABIN_NIGHT_CLAIM_MODE = mode;
}

async function ensureAuthoritativeIndex() {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
}

async function goAuthoritative() {
  await ensureAuthoritativeIndex();
  setMode(MODES.AUTHORITATIVE);
}

async function indexNames() {
  return ((await CabinNightClaim.collection.indexes()) || []).map((i) => i.name);
}

async function makeCabin(prefix = 'S17 Cabin') {
  seq += 1;
  return Cabin.create({
    name: `${prefix} ${Date.now().toString(36)}-${seq}`,
    slug: `s17-cabin-${Date.now().toString(36)}-${seq}`,
    location: 'Bulgaria',
    description: 'S1.7 authoritative cabin',
    imageUrl: 'https://example.com/s17.jpg',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    propertyKind: 'valley',
    isActive: true
  });
}

async function makeBooking(overrides = {}) {
  seq += 1;
  const cabin = overrides.cabin || (overrides.cabinId === undefined ? await makeCabin() : null);
  const doc = {
    _id: overrides._id || new mongoose.Types.ObjectId(),
    cabinId: overrides.cabinId !== undefined ? overrides.cabinId : cabin._id,
    cabinTypeId: overrides.cabinTypeId,
    unitId: overrides.unitId,
    checkIn: overrides.checkIn || sofiaDay('2027-03-10'),
    checkOut: overrides.checkOut || sofiaDay('2027-03-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'S17',
      lastName: 'Guest',
      email: overrides.email || `s17-${seq}-${Date.now().toString(36)}@example.com`,
      phone: '+35900000017'
    },
    totalPrice: 240,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest === true,
    archivedAt: overrides.archivedAt
  };
  Object.keys(doc).forEach((k) => {
    if (doc[k] === undefined) delete doc[k];
  });
  return Booking.create(doc);
}

async function shadowClaim({ cabinId, bookingId, nights, source = 'test' }) {
  return claimCabinNights({
    cabinId,
    bookingId,
    nights,
    source,
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
}

async function claimedNights(bookingId) {
  const rows = await CabinNightClaim.find({ bookingId }).sort({ night: 1 }).lean();
  return rows.map((r) => formatSofiaDateOnly(r.night));
}

async function claimCount(filter = {}) {
  return CabinNightClaim.countDocuments(filter);
}

async function reloadBooking(bookingId) {
  return Booking.findOne({ _id: bookingId }).lean();
}

async function reloadBlock(blockId) {
  return AvailabilityBlock.findOne({ _id: blockId }).lean();
}

/** Capture the structured authority events emitted on stderr. */
async function captureAuthorityEvents(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  let value;
  let error = null;
  try {
    value = await fn();
  } catch (err) {
    error = err;
  } finally {
    console.error = original;
  }
  const events = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.component === 'cabin_night_claim_authority') events.push(parsed);
    } catch {
      /* non-JSON log line */
    }
  }
  return { value, error, events, lines };
}

function adminCtx(route = 'POST /api/ops/reservations') {
  seq += 1;
  return {
    user: { id: `s17-admin-${seq}`, role: 'admin' },
    req: { headers: {}, user: { role: 'admin' } },
    route
  };
}

function maintenanceCtx(route = 'POST /api/maintenance/reservations/:id/archive') {
  seq += 1;
  return {
    user: { id: `s17-maint-${seq}`, role: 'admin' },
    req: { headers: {}, user: { role: 'admin' } },
    route
  };
}

function throwingRelease() {
  return 'not-a-valid-object-id';
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (ORIG_MODE === undefined) delete process.env.CABIN_NIGHT_CLAIM_MODE;
  else process.env.CABIN_NIGHT_CLAIM_MODE = ORIG_MODE;
});

test.beforeEach(async () => {
  setMode(MODES.SHADOW);
  clearAllRememberedResults();
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    Guest.deleteMany({})
  ]);
  try {
    await CabinNightClaim.collection.dropIndexes();
  } catch {
    /* collection may not exist yet */
  }
});

// ===========================================================================
// MODE — normalization / helpers (S1.7 accepts authoritative)
// ===========================================================================

test('MODE: normalizeMode accepts off', () => {
  assert.equal(normalizeMode('off'), MODES.OFF);
});

test('MODE: normalizeMode accepts shadow', () => {
  assert.equal(normalizeMode('shadow'), MODES.SHADOW);
});

test('MODE: normalizeMode accepts authoritative (S1.7)', () => {
  assert.equal(normalizeMode('authoritative'), MODES.AUTHORITATIVE);
});

test('MODE: normalizeMode no longer throws MODE_UNSUPPORTED for authoritative', () => {
  assert.doesNotThrow(() => normalizeMode('authoritative'));
});

test('MODE: normalizeMode trims and lowercases authoritative', () => {
  assert.equal(normalizeMode('  AUTHORITATIVE  '), MODES.AUTHORITATIVE);
});

test('MODE: normalizeMode treats empty string as off', () => {
  assert.equal(normalizeMode(''), MODES.OFF);
});

test('MODE: normalizeMode treats null/undefined as off', () => {
  assert.equal(normalizeMode(null), MODES.OFF);
  assert.equal(normalizeMode(undefined), MODES.OFF);
});

test('MODE: normalizeMode refuses an unsupported value', () => {
  assert.throws(
    () => normalizeMode('semi-authoritative'),
    (err) => err.code === 'CABIN_NIGHT_CLAIM_MODE_INVALID'
  );
});

test('MODE: refusal carries the requested mode for observability', () => {
  try {
    normalizeMode('banana');
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.requestedMode, 'banana');
  }
});

test('MODE: SUPPORTED_MODES is exactly off/shadow/authoritative', () => {
  assert.deepEqual([...SUPPORTED_MODES].sort(), ['authoritative', 'off', 'shadow']);
});

test('MODE: MODES map is frozen', () => {
  assert.equal(Object.isFrozen(MODES), true);
});

test('MODE: readConfiguredMode reads authoritative from env', () => {
  setMode(MODES.AUTHORITATIVE);
  assert.equal(readConfiguredMode(), MODES.AUTHORITATIVE);
});

test('MODE: readConfiguredMode honours an injected env object', () => {
  assert.equal(readConfiguredMode({ CABIN_NIGHT_CLAIM_MODE: 'authoritative' }), MODES.AUTHORITATIVE);
  assert.equal(readConfiguredMode({}), MODES.OFF);
});

test('MODE: getCabinNightClaimMode prefers the explicit override', () => {
  setMode(MODES.SHADOW);
  assert.equal(getCabinNightClaimMode(MODES.AUTHORITATIVE), MODES.AUTHORITATIVE);
  assert.equal(getCabinNightClaimMode(null), MODES.SHADOW);
});

test('MODE: isCabinNightClaimOff only true for off', () => {
  assert.equal(isCabinNightClaimOff(MODES.OFF), true);
  assert.equal(isCabinNightClaimOff(MODES.SHADOW), false);
  assert.equal(isCabinNightClaimOff(MODES.AUTHORITATIVE), false);
});

test('MODE: isCabinNightClaimShadowEnabled excludes authoritative', () => {
  assert.equal(isCabinNightClaimShadowEnabled(MODES.SHADOW), true);
  assert.equal(isCabinNightClaimShadowEnabled(MODES.AUTHORITATIVE), false);
  assert.equal(isCabinNightClaimShadowEnabled(MODES.OFF), false);
});

test('MODE: isCabinNightClaimAuthoritativeEnabled only true for authoritative', () => {
  assert.equal(isCabinNightClaimAuthoritativeEnabled(MODES.AUTHORITATIVE), true);
  assert.equal(isCabinNightClaimAuthoritativeEnabled(MODES.SHADOW), false);
  assert.equal(isCabinNightClaimAuthoritativeEnabled(MODES.OFF), false);
});

test('MODE: isCabinNightClaimWritesEnabled covers shadow and authoritative', () => {
  assert.equal(isCabinNightClaimWritesEnabled(MODES.SHADOW), true);
  assert.equal(isCabinNightClaimWritesEnabled(MODES.AUTHORITATIVE), true);
  assert.equal(isCabinNightClaimWritesEnabled(MODES.OFF), false);
});

test('MODE: helpers read the environment when no override is given', () => {
  setMode(MODES.AUTHORITATIVE);
  assert.equal(isCabinNightClaimAuthoritativeEnabled(), true);
  assert.equal(isCabinNightClaimShadowEnabled(), false);
  assert.equal(isCabinNightClaimWritesEnabled(), true);
  assert.equal(isCabinNightClaimOff(), false);
});

test('MODE: invalid env value is refused by every helper', () => {
  setMode('nonsense');
  for (const fn of [
    isCabinNightClaimOff,
    isCabinNightClaimShadowEnabled,
    isCabinNightClaimAuthoritativeEnabled,
    isCabinNightClaimWritesEnabled
  ]) {
    assert.throws(() => fn(), (err) => err.code === 'CABIN_NIGHT_CLAIM_MODE_INVALID');
  }
});

test('MODE: static — mode module documents the authoritative barrier', () => {
  const src = readSource('services/inventory/cabinNightClaimMode.js');
  assert.match(src, /authoritative/);
  assert.match(src, /S1\.7/);
  assert.doesNotMatch(src, /MODE_UNSUPPORTED/);
});

test('MODE: static — mode module never touches indexes', () => {
  const src = readSource('services/inventory/cabinNightClaimMode.js');
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
});

// ===========================================================================
// BOOT — read-only authoritative index assertion
// ===========================================================================

test('BOOT: shadow mode is ready without the authoritative index', async () => {
  setMode(MODES.SHADOW);
  const boot = await assertCabinNightClaimAuthoritativeBootReady({ processName: 'p' });
  assert.equal(boot.required, false);
  assert.equal(boot.ok, true);
  assert.equal(boot.mode, MODES.SHADOW);
});

test('BOOT: off mode is ready without the authoritative index', async () => {
  setMode(MODES.OFF);
  const boot = await assertCabinNightClaimAuthoritativeBootReady({ processName: 'p' });
  assert.equal(boot.required, false);
  assert.equal(boot.ok, true);
  assert.equal(boot.mode, MODES.OFF);
});

test('BOOT: shadow boot reports no index payload', async () => {
  setMode(MODES.SHADOW);
  const boot = await assertCabinNightClaimAuthoritativeBootReady({});
  assert.equal(boot.index, undefined);
});

test('BOOT: explicit mode override wins over the environment', async () => {
  setMode(MODES.AUTHORITATIVE);
  const boot = await assertCabinNightClaimAuthoritativeBootReady({ mode: MODES.SHADOW });
  assert.equal(boot.required, false);
});

test('BOOT: injected env object is honoured', async () => {
  setMode(MODES.AUTHORITATIVE);
  const boot = await assertCabinNightClaimAuthoritativeBootReady({
    env: { CABIN_NIGHT_CLAIM_MODE: 'off' }
  });
  assert.equal(boot.mode, MODES.OFF);
  assert.equal(boot.required, false);
});

test('BOOT: authoritative with the exact index succeeds', async () => {
  await goAuthoritative();
  const boot = await assertCabinNightClaimAuthoritativeBootReady({ processName: 'driftdwells' });
  assert.equal(boot.required, true);
  assert.equal(boot.ok, true);
  assert.equal(boot.mode, MODES.AUTHORITATIVE);
  assert.equal(boot.index.name, AUTH_INDEX_NAME);
  assert.equal(boot.index.unique, true);
});

test('BOOT: authoritative success echoes the process name', async () => {
  await goAuthoritative();
  const boot = await assertCabinNightClaimAuthoritativeBootReady({ processName: 'finalize-worker' });
  assert.equal(boot.processName, 'finalize-worker');
});

test('BOOT: authoritative without the index fails closed', async () => {
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () => assertCabinNightClaimAuthoritativeBootReady({ processName: 'driftdwells' }),
    (err) => err.code === CLAIM_ERR.INDEX_MISSING
  );
});

test('BOOT: missing-index failure names the process in the message', async () => {
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () => assertCabinNightClaimAuthoritativeBootReady({ processName: 'unit-under-test' }),
    (err) => /unit-under-test/.test(err.message)
  );
});

test('BOOT: authoritative with a wrong-named unique index fails', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1, night: 1 },
    { unique: true, name: 'cabinId_1_night_1' }
  );
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () => assertCabinNightClaimAuthoritativeBootReady({ processName: 'p' }),
    (err) => err.code === CLAIM_ERR.INDEX_MISSING || err.code === CLAIM_ERR.INDEX_WRONG
  );
});

test('BOOT: authoritative with a non-unique correctly-named index fails', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1, night: 1 },
    { name: AUTH_INDEX_NAME }
  );
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () => assertCabinNightClaimAuthoritativeBootReady({ processName: 'p' }),
    (err) => err.code === CLAIM_ERR.INDEX_WRONG
  );
});

test('BOOT: authoritative with the right name but wrong keys fails', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1 },
    { unique: true, name: AUTH_INDEX_NAME }
  );
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () => assertCabinNightClaimAuthoritativeBootReady({ processName: 'p' }),
    (err) => err.code === CLAIM_ERR.INDEX_WRONG
  );
});

test('BOOT: failure emits an authority_index_unavailable event', async () => {
  setMode(MODES.AUTHORITATIVE);
  const { error, events } = await captureAuthorityEvents(() =>
    assertCabinNightClaimAuthoritativeBootReady({ processName: 'evented' })
  );
  assert.ok(error);
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_INDEX_UNAVAILABLE));
});

test('BOOT: failure event carries the writer but no guest PII', async () => {
  setMode(MODES.AUTHORITATIVE);
  const { events } = await captureAuthorityEvents(() =>
    assertCabinNightClaimAuthoritativeBootReady({ processName: 'pii-check' })
  );
  const evt = events.find((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_INDEX_UNAVAILABLE);
  assert.equal(evt.writer, 'pii-check');
  assert.doesNotMatch(JSON.stringify(evt), /firstName|lastName|guestInfo/);
});

test('BOOT: boot failure preserves the underlying cause', async () => {
  setMode(MODES.AUTHORITATIVE);
  try {
    await assertCabinNightClaimAuthoritativeBootReady({ processName: 'cause' });
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err.cause);
    assert.equal(err.cause.code, CLAIM_ERR.INDEX_MISSING);
  }
});

test('BOOT: does not create the index as a side effect of a failed assertion', async () => {
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(() => assertCabinNightClaimAuthoritativeBootReady({}));
  assert.equal((await indexNames()).includes(AUTH_INDEX_NAME), false);
});

test('BOOT: repeated assertions are idempotent and index-count stable', async () => {
  await goAuthoritative();
  const before = (await indexNames()).length;
  await assertCabinNightClaimAuthoritativeBootReady({ processName: 'a' });
  await assertCabinNightClaimAuthoritativeBootReady({ processName: 'b' });
  assert.equal((await indexNames()).length, before);
});

test('BOOT: static — boot module never creates/drops/syncs indexes', () => {
  const src = readSource('services/inventory/cabinNightClaimAuthoritativeBoot.js');
  assert.doesNotMatch(src, /createIndex/);
  assert.doesNotMatch(src, /dropIndex/);
  assert.doesNotMatch(src, /syncIndexes/);
  assert.doesNotMatch(src, /ensureAuthoritativeUniqueIndexForTests/);
});

test('BOOT: static — boot module delegates to the read-only assertion', () => {
  const src = readSource('services/inventory/cabinNightClaimAuthoritativeBoot.js');
  assert.match(src, /assertAuthoritativeCabinNightIndex/);
  assert.match(src, /Never create\/drop\/sync indexes here/);
});

test('BOOT: static — boot module performs no claim mutations', () => {
  const src = readSource('services/inventory/cabinNightClaimAuthoritativeBoot.js');
  assert.doesNotMatch(src, /deleteMany|deleteOne|claimCabinNights\(|releaseCabinNights\(/);
});

// ===========================================================================
// AUTHORITY OPS — pre-canonical acquire
// ===========================================================================

test('OPS: preAcquire for create is skipped in shadow', async () => {
  setMode(MODES.SHADOW);
  const out = await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2027-03-10'),
    checkOut: sofiaDay('2027-03-12'),
    source: 'manual_reservation'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'shadow_post_canonical');
  assert.equal(await claimCount(), 0);
});

test('OPS: preAcquire for create is skipped in off', async () => {
  setMode(MODES.OFF);
  const out = await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2027-03-10'),
    checkOut: sofiaDay('2027-03-12'),
    source: 'finalize'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'off');
  assert.equal(await claimCount(), 0);
});

test('OPS: skipped acquire returns a neutral zero-count shape', async () => {
  setMode(MODES.OFF);
  const out = await preAcquireCabinNightsForCreate({ bookingId: 'x', cabinId: 'y' });
  assert.equal(out.ok, true);
  assert.equal(out.insertedCount, 0);
  assert.equal(out.alreadyOwnedCount, 0);
  assert.deepEqual(out.insertedClaimIdsThisAttempt, []);
  assert.deepEqual(out.insertedNightsThisAttempt, []);
  assert.deepEqual(out.nights, []);
});

test('OPS: authoritative preAcquire claims the occupied nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  const out = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    checkIn: sofiaDay('2027-03-10'),
    checkOut: sofiaDay('2027-03-13'),
    source: 'manual_reservation'
  });
  assert.equal(out.skipped, false);
  assert.equal(out.insertedCount, 3);
  assert.deepEqual(await claimedNights(bookingId), ['2027-03-10', '2027-03-11', '2027-03-12']);
});

test('OPS: authoritative preAcquire never claims the checkout day', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    checkIn: sofiaDay('2027-03-10'),
    checkOut: sofiaDay('2027-03-12'),
    source: 'finalize'
  });
  assert.equal((await claimedNights(bookingId)).includes('2027-03-12'), false);
});

test('OPS: authoritative preAcquire uses the authoritative acquisition mode', async () => {
  await goAuthoritative();
  let captured = null;
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10'],
    source: 'finalize',
    claimCabinNightsFn: async (opts) => {
      captured = opts;
      return {
        ok: true,
        insertedCount: 1,
        alreadyOwnedCount: 0,
        nights: ['2027-03-10'],
        insertedClaimIdsThisAttempt: [],
        insertedNightsThisAttempt: ['2027-03-10']
      };
    }
  });
  assert.equal(captured.acquisitionMode, ACQUISITION_MODES.AUTHORITATIVE);
});

test('OPS: authoritative preAcquire fails closed without the unique index', async () => {
  setMode(MODES.AUTHORITATIVE);
  await assert.rejects(
    () =>
      preAcquireCabinNightsForCreate({
        bookingId: new mongoose.Types.ObjectId(),
        cabinId: new mongoose.Types.ObjectId(),
        checkIn: sofiaDay('2027-03-10'),
        checkOut: sofiaDay('2027-03-11'),
        source: 'finalize'
      }),
    (err) => err.code === CLAIM_ERR.INDEX_MISSING
  );
  assert.equal(await claimCount(), 0);
});

test('OPS: missing bookingId is a validation error in authoritative', async () => {
  await goAuthoritative();
  await assert.rejects(
    () =>
      preAcquireCabinNightsForCreate({
        cabinId: new mongoose.Types.ObjectId(),
        checkIn: sofiaDay('2027-03-10'),
        checkOut: sofiaDay('2027-03-11'),
        source: 'finalize'
      }),
    (err) => err.code === CLAIM_ERR.VALIDATION
  );
});

test('OPS: missing cabinId is a validation error in authoritative', async () => {
  await goAuthoritative();
  await assert.rejects(
    () =>
      preAcquireCabinNightsForCreate({
        bookingId: new mongoose.Types.ObjectId(),
        checkIn: sofiaDay('2027-03-10'),
        checkOut: sofiaDay('2027-03-11'),
        source: 'finalize'
      }),
    (err) => err.code === CLAIM_ERR.VALIDATION
  );
});

test('OPS: preAcquire accepts documents and coerces ids', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  const out = await preAcquireCabinNightsForCreate({
    bookingId: booking,
    cabinId: cabin,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  assert.equal(out.bookingId, String(booking._id));
  assert.equal(out.cabinId, String(cabin._id));
});

test('OPS: re-running preAcquire reports alreadyOwned not inserted', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  const args = {
    bookingId,
    cabinId: cabin._id,
    checkIn: sofiaDay('2027-03-10'),
    checkOut: sofiaDay('2027-03-12'),
    source: 'finalize'
  };
  const first = await preAcquireCabinNightsForCreate(args);
  const second = await preAcquireCabinNightsForCreate(args);
  assert.equal(first.insertedCount, 2);
  assert.equal(first.alreadyOwnedCount, 0);
  assert.equal(second.insertedCount, 0);
  assert.equal(second.alreadyOwnedCount, 2);
  assert.equal(await claimCount({ bookingId }), 2);
});

test('OPS: partial overlap reports insertedClaimIdsThisAttempt only for new nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  const grown = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'finalize'
  });
  assert.equal(grown.insertedCount, 1);
  assert.equal(grown.alreadyOwnedCount, 1);
  assert.deepEqual(grown.insertedNightsThisAttempt, ['2027-03-11']);
  assert.equal(grown.insertedClaimIdsThisAttempt.length, 1);
});

test('OPS: foreign owner conflict throws FOREIGN_OWNER', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const owner = new mongoose.Types.ObjectId();
  const intruder = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: owner,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      preAcquireCabinNightsForCreate({
        bookingId: intruder,
        cabinId: cabin._id,
        nights: ['2027-03-11'],
        source: 'manual_reservation'
      }),
    (err) => err.code === CLAIM_ERR.FOREIGN_OWNER
  );
});

test('OPS: foreign conflict leaves the incumbent owner untouched', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const owner = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: owner,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    preAcquireCabinNightsForCreate({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: cabin._id,
      nights: ['2027-03-10'],
      source: 'finalize'
    })
  );
  assert.equal(await claimCount({ bookingId: owner }), 1);
  assert.equal(await claimCount(), 1);
});

test('OPS: foreign conflict details name the contested night', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  try {
    await preAcquireCabinNightsForCreate({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: cabin._id,
      nights: ['2027-03-10'],
      source: 'finalize'
    });
    assert.fail('expected conflict');
  } catch (err) {
    assert.equal(err.details.night, '2027-03-10');
    assert.equal(err.details.cabinId, String(cabin._id));
  }
});

test('OPS: foreign conflict emits authority_claim_conflict', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  const { error, events } = await captureAuthorityEvents(() =>
    preAcquireCabinNightsForCreate({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: cabin._id,
      nights: ['2027-03-10'],
      source: 'finalize'
    })
  );
  assert.ok(error);
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_CONFLICT));
});

test('OPS: successful acquire emits authority_claim_acquired with counts', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const { events } = await captureAuthorityEvents(() =>
    preAcquireCabinNightsForCreate({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: cabin._id,
      nights: ['2027-03-10', '2027-03-11'],
      source: 'finalize'
    })
  );
  const evt = events.find((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_ACQUIRED);
  assert.ok(evt);
  assert.equal(evt.insertedCount, 2);
  assert.equal(evt.nightCount, 2);
  assert.equal(evt.writer, 'finalize');
});

test('OPS: index-missing failure emits authority_index_unavailable', async () => {
  setMode(MODES.AUTHORITATIVE);
  const { error, events } = await captureAuthorityEvents(() =>
    preAcquireCabinNightsForCreate({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: new mongoose.Types.ObjectId(),
      nights: ['2027-03-10'],
      source: 'finalize'
    })
  );
  assert.ok(error);
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_INDEX_UNAVAILABLE));
});

test('OPS: an unknown claim source is refused before any write', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await assert.rejects(
    () =>
      preAcquireCabinNightsForCreate({
        bookingId: new mongoose.Types.ObjectId(),
        cabinId: cabin._id,
        nights: ['2027-03-10'],
        source: 'totally_unknown_writer'
      }),
    (err) => err.code === SERVICE_ERR.INVALID_SOURCE
  );
  assert.equal(await claimCount(), 0);
});

test('OPS: preAcquireCabinNightsForMutation skipped in shadow', async () => {
  setMode(MODES.SHADOW);
  const out = await preAcquireCabinNightsForMutation({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10'],
    source: 'date_edit'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'shadow_post_canonical');
});

test('OPS: preAcquireCabinNightsForMutation skipped in off', async () => {
  setMode(MODES.OFF);
  const out = await preAcquireCabinNightsForMutation({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10'],
    source: 'reassign'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'off');
});

test('OPS: mutation acquire with no new nights is a no-op', async () => {
  await goAuthoritative();
  const out = await preAcquireCabinNightsForMutation({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: [],
    source: 'date_edit'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'no_new_nights');
  assert.equal(await claimCount(), 0);
});

test('OPS: mutation acquire treats a non-array nights value as no-op', async () => {
  await goAuthoritative();
  const out = await preAcquireCabinNightsForMutation({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: null,
    source: 'date_edit'
  });
  assert.equal(out.reason, 'no_new_nights');
});

test('OPS: mutation acquire claims only the requested nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  const out = await preAcquireCabinNightsForMutation({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-14', '2027-03-15'],
    source: 'date_edit'
  });
  assert.equal(out.insertedCount, 2);
  assert.deepEqual(await claimedNights(bookingId), ['2027-03-14', '2027-03-15']);
});

test('OPS: mutation acquire conflict on the target cabin throws FOREIGN_OWNER', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForMutation({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-03-14'],
    source: 'reassign'
  });
  await assert.rejects(
    () =>
      preAcquireCabinNightsForMutation({
        bookingId: new mongoose.Types.ObjectId(),
        cabinId: cabin._id,
        nights: ['2027-03-14'],
        source: 'reassign'
      }),
    (err) => err.code === CLAIM_ERR.FOREIGN_OWNER
  );
});

test('OPS: the same night on a different cabin is not a conflict', async () => {
  await goAuthoritative();
  const a = await makeCabin('A');
  const b = await makeCabin('B');
  const one = new mongoose.Types.ObjectId();
  const two = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: one,
    cabinId: a._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  const out = await preAcquireCabinNightsForCreate({
    bookingId: two,
    cabinId: b._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  assert.equal(out.insertedCount, 1);
  assert.equal(await claimCount(), 2);
});

test('OPS: acquired rows persist the requesting writer as source', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'location_child'
  });
  const rows = await CabinNightClaim.find({ bookingId }).lean();
  assert.equal(rows[0].source, 'location_child');
});

// ===========================================================================
// AUTHORITY OPS — compensation
// ===========================================================================

test('COMPENSATE: empty attempt is a no-op', async () => {
  const out = await compensateCreateAttemptClaims({ attempt: null, writer: 'finalize' });
  assert.equal(out.ok, true);
  assert.equal(out.compensated, false);
  assert.equal(out.deletedCount, 0);
});

test('COMPENSATE: attempt with no inserted ids is a no-op', async () => {
  const out = await compensateCreateAttemptClaims({
    attempt: { insertedClaimIdsThisAttempt: [] },
    writer: 'finalize'
  });
  assert.equal(out.compensated, false);
  assert.equal(out.deletedCount, 0);
});

test('COMPENSATE: deletes exactly the nights this attempt inserted', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'date_edit'
  });
  const attempt = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'date_edit'
  });
  const out = await compensateCreateAttemptClaims({
    attempt,
    writer: 'date_edit',
    bookingId,
    cabinId: cabin._id
  });
  assert.equal(out.ok, true);
  assert.equal(out.compensated, true);
  assert.equal(out.deletedCount, 1);
  assert.deepEqual(await claimedNights(bookingId), ['2027-03-10']);
});

test('COMPENSATE: retains pre-existing claims owned before the attempt', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'date_edit'
  });
  const attempt = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11', '2027-03-12'],
    source: 'date_edit'
  });
  await compensateCreateAttemptClaims({ attempt, writer: 'date_edit' });
  assert.equal(await claimCount({ bookingId }), 2);
});

test('COMPENSATE: never deletes another booking claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const other = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: other,
    cabinId: cabin._id,
    nights: ['2027-03-20'],
    source: 'finalize'
  });
  const mine = new mongoose.Types.ObjectId();
  const attempt = await preAcquireCabinNightsForCreate({
    bookingId: mine,
    cabinId: cabin._id,
    nights: ['2027-03-21'],
    source: 'finalize'
  });
  await compensateCreateAttemptClaims({ attempt, writer: 'finalize' });
  assert.equal(await claimCount({ bookingId: other }), 1);
  assert.equal(await claimCount({ bookingId: mine }), 0);
});

test('COMPENSATE: emits authority_claim_compensated on success', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  const attempt = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  const { events } = await captureAuthorityEvents(() =>
    compensateCreateAttemptClaims({ attempt, writer: 'finalize', bookingId, cabinId: cabin._id })
  );
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_COMPENSATED));
});

test('COMPENSATE: failure returns needsReconciliation instead of throwing', async () => {
  const out = await compensateCreateAttemptClaims({
    attempt: { insertedClaimIdsThisAttempt: [String(new mongoose.Types.ObjectId())] },
    writer: 'finalize',
    compensateFn: async () => {
      throw Object.assign(new Error('injected compensation failure'), {
        code: CLAIM_ERR.COMPENSATION_FAILED
      });
    }
  });
  assert.equal(out.ok, false);
  assert.equal(out.compensated, false);
  assert.equal(out.needsReconciliation, true);
  assert.match(out.error.message, /injected compensation failure/);
});

test('COMPENSATE: failure emits compensation_failed and reconciliation_required', async () => {
  const { events } = await captureAuthorityEvents(() =>
    compensateCreateAttemptClaims({
      attempt: { insertedClaimIdsThisAttempt: ['a'] },
      writer: 'finalize',
      compensateFn: async () => {
        throw new Error('boom');
      }
    })
  );
  assert.ok(
    events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_COMPENSATION_FAILED)
  );
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED));
});

test('COMPENSATE: failure opens a manual review item when a booking id is known', async () => {
  const calls = [];
  await compensateCreateAttemptClaims({
    attempt: { insertedClaimIdsThisAttempt: ['a'] },
    writer: 'finalize',
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    compensateFn: async () => {
      throw new Error('boom');
    },
    openManualReviewItemFn: async (payload) => {
      calls.push(payload);
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].category, 'cabin_night_claim_authority_failure');
  assert.equal(calls[0].severity, 'critical');
});

test('COMPENSATE: failure skips manual review when there is no booking id', async () => {
  const calls = [];
  await compensateCreateAttemptClaims({
    attempt: { insertedClaimIdsThisAttempt: ['a'] },
    writer: 'finalize',
    compensateFn: async () => {
      throw new Error('boom');
    },
    openManualReviewItemFn: async (p) => calls.push(p)
  });
  assert.equal(calls.length, 0);
});

test('COMPENSATE: a manual review failure never masks the compensation outcome', async () => {
  const out = await compensateCreateAttemptClaims({
    attempt: { insertedClaimIdsThisAttempt: ['a'] },
    writer: 'finalize',
    bookingId: new mongoose.Types.ObjectId(),
    compensateFn: async () => {
      throw new Error('boom');
    },
    openManualReviewItemFn: async () => {
      throw new Error('mri down');
    }
  });
  assert.equal(out.needsReconciliation, true);
});

test('COMPENSATE: conservative retention keeps rows when compensation fails', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  const attempt = await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await compensateCreateAttemptClaims({
    attempt,
    writer: 'finalize',
    compensateFn: async () => {
      throw new Error('storage unavailable');
    }
  });
  assert.equal(await claimCount({ bookingId }), 1);
});

// ===========================================================================
// AUTHORITY OPS — post-canonical mirror
// ===========================================================================

test('MIRROR: authoritative post-mirror is a no-op', async () => {
  await goAuthoritative();
  const booking = await makeBooking();
  const out = await postMirrorCabinNightsAfterCanonical({
    booking,
    source: 'manual_reservation'
  });
  assert.equal(out.skipped, true);
  assert.equal(out.reason, 'authoritative_preclaimed');
  assert.equal(out.outcome, 'skipped_authoritative');
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('MIRROR: shadow post-mirror writes the claims', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking();
  const out = await postMirrorCabinNightsAfterCanonical({
    booking,
    source: 'manual_reservation'
  });
  assert.equal(out.outcome, SHADOW_OUTCOMES.MIRRORED);
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
});

test('MIRROR: shadow mirror does not require the authoritative index', async () => {
  setMode(MODES.SHADOW);
  assert.equal((await indexNames()).includes(AUTH_INDEX_NAME), false);
  const booking = await makeBooking();
  const out = await postMirrorCabinNightsAfterCanonical({ booking, source: 'finalize' });
  assert.equal(out.ok, true);
});

test('MIRROR: off mode mirror is skipped', async () => {
  setMode(MODES.OFF);
  const booking = await makeBooking();
  const out = await postMirrorCabinNightsAfterCanonical({ booking, source: 'finalize' });
  assert.equal(out.outcome, SHADOW_OUTCOMES.SKIPPED_OFF);
  assert.equal(await claimCount(), 0);
});

test('MIRROR: authoritative no-op honours an explicit mode override', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking();
  const out = await postMirrorCabinNightsAfterCanonical({
    booking,
    source: 'finalize',
    mode: MODES.AUTHORITATIVE
  });
  assert.equal(out.skipped, true);
  assert.equal(await claimCount(), 0);
});

test('MIRROR: authoritative mirror never double-claims already-owned nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  const before = await claimCount({ bookingId: booking._id });
  await postMirrorCabinNightsAfterCanonical({ booking, source: 'manual_reservation' });
  assert.equal(await claimCount({ bookingId: booking._id }), before);
});

test('MIRROR: shadow mirror skips a non-qualifying booking', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking({ status: 'cancelled' });
  const out = await postMirrorCabinNightsAfterCanonical({ booking, source: 'finalize' });
  assert.equal(out.outcome, SHADOW_OUTCOMES.SKIPPED_NOT_QUALIFIED);
});

test('MIRROR: shadow mirror skips isTest bookings', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking({ isTest: true });
  const out = await postMirrorCabinNightsAfterCanonical({ booking, source: 'finalize' });
  assert.equal(out.outcome, SHADOW_OUTCOMES.SKIPPED_NOT_QUALIFIED);
  assert.equal(await claimCount(), 0);
});

// ===========================================================================
// AUTHORITY OPS — release after canonical non-owning
// ===========================================================================

test('RELEASE: off mode release is skipped', async () => {
  setMode(MODES.OFF);
  const booking = await makeBooking();
  await shadowClaim({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    nights: ['2027-03-10']
  });
  const out = await releaseCabinNightsAfterCanonicalNonOwning({ bookingId: booking._id });
  assert.equal(out.outcome, 'skipped_off');
  assert.equal(await claimCount({ bookingId: booking._id }), 1);
});

test('RELEASE: shadow mode delegates to the shadow release helper', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking();
  await shadowClaim({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    nights: ['2027-03-10', '2027-03-11']
  });
  const out = await releaseCabinNightsAfterCanonicalNonOwning({ bookingId: booking._id });
  assert.equal(out.outcome, RELEASE_OUTCOMES.RELEASED);
  assert.equal(out.deletedCount, 2);
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('RELEASE: authoritative release deletes owner-scoped claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  const out = await releaseCabinNightsAfterCanonicalNonOwning({
    booking,
    bookingId: booking._id,
    lifecycleSource: 'cancel'
  });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, 'released');
  assert.equal(out.deletedCount, 2);
  assert.equal(out.needsReconciliation, false);
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('RELEASE: authoritative release is idempotent (already_empty)', async () => {
  await goAuthoritative();
  const booking = await makeBooking();
  const out = await releaseCabinNightsAfterCanonicalNonOwning({ bookingId: booking._id });
  assert.equal(out.ok, true);
  assert.equal(out.outcome, 'already_empty');
  assert.equal(out.deletedCount, 0);
});

test('RELEASE: authoritative release never touches foreign claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const mine = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: mine,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: other,
    cabinId: cabin._id,
    nights: ['2027-03-11'],
    source: 'finalize'
  });
  await releaseCabinNightsAfterCanonicalNonOwning({ bookingId: mine });
  assert.equal(await claimCount({ bookingId: other }), 1);
});

test('RELEASE: authoritative release accepts a booking document only', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  const out = await releaseCabinNightsAfterCanonicalNonOwning({ booking });
  assert.equal(out.bookingId, String(booking._id));
  assert.equal(out.deletedCount, 1);
});

test('RELEASE: authoritative release without any id is an invalid outcome', async () => {
  await goAuthoritative();
  const out = await releaseCabinNightsAfterCanonicalNonOwning({});
  assert.equal(out.ok, false);
  assert.equal(out.outcome, 'invalid_booking_id');
  assert.equal(out.errorCode, CLAIM_ERR.VALIDATION);
});

test('RELEASE: authoritative release defaults the lifecycle source', async () => {
  await goAuthoritative();
  const booking = await makeBooking();
  const out = await releaseCabinNightsAfterCanonicalNonOwning({ bookingId: booking._id });
  assert.equal(out.lifecycleSource, 'status_release');
});

test('RELEASE: authoritative release records the given lifecycle source', async () => {
  await goAuthoritative();
  const booking = await makeBooking();
  const out = await releaseCabinNightsAfterCanonicalNonOwning({
    bookingId: booking._id,
    lifecycleSource: 'archive'
  });
  assert.equal(out.lifecycleSource, 'archive');
});

test('RELEASE: authoritative write failure sets needsReconciliation', async () => {
  await goAuthoritative();
  const out = await releaseCabinNightsAfterCanonicalNonOwning({
    bookingId: throwingRelease(),
    lifecycleSource: 'cancel'
  });
  assert.equal(out.ok, false);
  assert.equal(out.outcome, 'write_failure');
  assert.equal(out.needsReconciliation, true);
  assert.equal(out.deletedCount, 0);
});

test('RELEASE: authoritative write failure emits release_failed + reconciliation_required', async () => {
  await goAuthoritative();
  const { events } = await captureAuthorityEvents(() =>
    releaseCabinNightsAfterCanonicalNonOwning({
      bookingId: throwingRelease(),
      lifecycleSource: 'archive'
    })
  );
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_RELEASE_FAILED));
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED));
});

test('RELEASE: authoritative write failure opens a manual review item', async () => {
  await goAuthoritative();
  const calls = [];
  await releaseCabinNightsAfterCanonicalNonOwning({
    bookingId: throwingRelease(),
    lifecycleSource: 'cancel',
    openManualReviewItemFn: async (p) => calls.push(p)
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].evidence.operation, 'release');
  assert.equal(calls[0].evidence.lifecycleSource, 'cancel');
});

test('RELEASE: throwOnFailure surfaces a reconciliation error', async () => {
  await goAuthoritative();
  await assert.rejects(
    () =>
      releaseCabinNightsAfterCanonicalNonOwning({
        bookingId: throwingRelease(),
        throwOnFailure: true
      }),
    (err) => err.needsReconciliation === true && err.releaseOutcome.outcome === 'write_failure'
  );
});

test('RELEASE: release failure never reopens the canonical booking', async () => {
  await goAuthoritative();
  const booking = await makeBooking({ status: 'cancelled' });
  await releaseCabinNightsAfterCanonicalNonOwning({
    bookingId: throwingRelease(),
    lifecycleSource: 'cancel'
  });
  const fresh = await reloadBooking(booking._id);
  assert.equal(fresh.status, 'cancelled');
});

test('RELEASE: explicit mode override drives the release branch', async () => {
  setMode(MODES.SHADOW);
  const booking = await makeBooking();
  await shadowClaim({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    nights: ['2027-03-10']
  });
  const out = await releaseCabinNightsAfterCanonicalNonOwning({
    bookingId: booking._id,
    mode: MODES.OFF
  });
  assert.equal(out.outcome, 'skipped_off');
  assert.equal(await claimCount({ bookingId: booking._id }), 1);
});

// ===========================================================================
// AUTHORITY OPS — surplus release
// ===========================================================================

test('SURPLUS: skipped in shadow mode', async () => {
  setMode(MODES.SHADOW);
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10']
  });
  assert.equal(out.skipped, true);
  assert.equal(out.deletedCount, 0);
});

test('SURPLUS: skipped in off mode', async () => {
  setMode(MODES.OFF);
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10']
  });
  assert.equal(out.skipped, true);
});

test('SURPLUS: empty night list is a no-op', async () => {
  await goAuthoritative();
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: []
  });
  assert.equal(out.skipped, true);
  assert.equal(out.deletedCount, 0);
});

test('SURPLUS: releases only the listed nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11', '2027-03-12'],
    source: 'date_edit'
  });
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-12'],
    writer: 'date_edit'
  });
  assert.equal(out.ok, true);
  assert.equal(out.deletedCount, 1);
  assert.deepEqual(await claimedNights(bookingId), ['2027-03-10', '2027-03-11']);
});

test('SURPLUS: release is cabin-scoped', async () => {
  await goAuthoritative();
  const source = await makeCabin('src');
  const target = await makeCabin('dst');
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: source._id,
    nights: ['2027-03-10'],
    source: 'reassign'
  });
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: target._id,
    nights: ['2027-03-10'],
    source: 'reassign'
  });
  await releaseSurplusCabinNightsAuthoritative({
    bookingId,
    cabinId: source._id,
    nights: ['2027-03-10'],
    writer: 'reassign'
  });
  assert.equal(await claimCount({ cabinId: source._id }), 0);
  assert.equal(await claimCount({ cabinId: target._id }), 1);
});

test('SURPLUS: release never removes foreign claims on the same nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const mine = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: other,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: mine,
    cabinId: cabin._id,
    nights: ['2027-03-11'],
    source: 'finalize'
  });
  await releaseSurplusCabinNightsAuthoritative({
    bookingId: mine,
    cabinId: cabin._id,
    nights: ['2027-03-10', '2027-03-11']
  });
  assert.equal(await claimCount({ bookingId: other }), 1);
  assert.equal(await claimCount({ bookingId: mine }), 0);
});

test('SURPLUS: repeated release is idempotent', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-03-10'],
    source: 'date_edit'
  });
  const args = { bookingId, cabinId: cabin._id, nights: ['2027-03-10'] };
  assert.equal((await releaseSurplusCabinNightsAuthoritative(args)).deletedCount, 1);
  assert.equal((await releaseSurplusCabinNightsAuthoritative(args)).deletedCount, 0);
});

test('SURPLUS: write failure returns needsReconciliation without throwing', async () => {
  await goAuthoritative();
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId: throwingRelease(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10'],
    writer: 'date_edit'
  });
  assert.equal(out.ok, false);
  assert.equal(out.needsReconciliation, true);
  assert.equal(out.deletedCount, 0);
});

test('SURPLUS: write failure emits release_failed + reconciliation_required', async () => {
  await goAuthoritative();
  const { events } = await captureAuthorityEvents(() =>
    releaseSurplusCabinNightsAuthoritative({
      bookingId: throwingRelease(),
      cabinId: new mongoose.Types.ObjectId(),
      nights: ['2027-03-10', '2027-03-11'],
      writer: 'reassign'
    })
  );
  const failed = events.find((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_CLAIM_RELEASE_FAILED);
  assert.ok(failed);
  assert.equal(failed.nightCount, 2);
  assert.equal(failed.writer, 'reassign');
  assert.ok(events.some((e) => e.event === AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED));
});

test('SURPLUS: explicit mode override can force the skip path', async () => {
  await goAuthoritative();
  const out = await releaseSurplusCabinNightsAuthoritative({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    nights: ['2027-03-10'],
    mode: MODES.SHADOW
  });
  assert.equal(out.skipped, true);
});

// ===========================================================================
// QUALIFICATION re-exports used by the authoritative writers
// ===========================================================================

test('QUALIFY: single-cabin blocking booking qualifies for authority', async () => {
  const booking = await makeBooking();
  assert.equal(bookingQualifiesForSingleCabinAuthority(booking), true);
  assert.equal(bookingIsValidSingleCabinShape(booking), true);
});

test('QUALIFY: cancelled booking does not qualify', async () => {
  const booking = await makeBooking({ status: 'cancelled' });
  assert.equal(bookingQualifiesForSingleCabinAuthority(booking), false);
});

test('QUALIFY: isTest booking does not qualify', async () => {
  const booking = await makeBooking({ isTest: true });
  assert.equal(bookingQualifiesForSingleCabinAuthority(booking), false);
});

test('QUALIFY: archived booking does not qualify', async () => {
  const booking = await makeBooking({ archivedAt: new Date() });
  assert.equal(bookingQualifiesForSingleCabinAuthority(booking), false);
});

test('QUALIFY: allocated multi-unit shape is not single-cabin', () => {
  const booking = {
    _id: new mongoose.Types.ObjectId(),
    cabinTypeId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    status: 'confirmed'
  };
  assert.equal(bookingIsValidSingleCabinShape(booking), false);
  assert.equal(bookingQualifiesForSingleCabinAuthority(booking), false);
});

test('QUALIFY: mixed cabinId + cabinTypeId shape is refused', () => {
  const booking = {
    _id: new mongoose.Types.ObjectId(),
    cabinId: new mongoose.Types.ObjectId(),
    cabinTypeId: new mongoose.Types.ObjectId(),
    status: 'confirmed'
  };
  assert.equal(bookingIsValidSingleCabinShape(booking), false);
});

// ===========================================================================
// WRITER READINESS registry
// ===========================================================================

test('READINESS: every S1.7 authoritative writer is registered', () => {
  assert.deepEqual([...CABIN_NIGHT_CLAIM_S1_WRITERS].sort(), [
    'date_edit',
    'finalize',
    'legacy_create',
    'location_child',
    'manual_reservation',
    'reassign',
    'status_release'
  ]);
});

test('READINESS: status_release is part of the writer registry', () => {
  assert.equal(CABIN_NIGHT_CLAIM_S1_WRITERS.includes('status_release'), true);
  assert.equal(isKnownCabinNightClaimS1Writer('status_release'), true);
});

test('READINESS: listCabinNightClaimS1Writers returns a defensive copy', () => {
  const list = listCabinNightClaimS1Writers();
  list.push('mutated');
  assert.equal(CABIN_NIGHT_CLAIM_S1_WRITERS.includes('mutated'), false);
});

test('READINESS: STATUS_RELEASE_COVERS includes archive', () => {
  assert.equal(STATUS_RELEASE_COVERS.includes('archive'), true);
});

test('READINESS: STATUS_RELEASE_COVERS includes cancel, complete and maintenance_delete', () => {
  for (const kind of ['cancel', 'complete', 'maintenance_delete']) {
    assert.equal(STATUS_RELEASE_COVERS.includes(kind), true, kind);
  }
});

test('READINESS: listStatusReleaseCoverage returns a defensive copy', () => {
  const list = listStatusReleaseCoverage();
  list.push('mutated');
  assert.equal(STATUS_RELEASE_COVERS.includes('mutated'), false);
});

test('READINESS: registries are frozen', () => {
  assert.equal(Object.isFrozen(CABIN_NIGHT_CLAIM_S1_WRITERS), true);
  assert.equal(Object.isFrozen(STATUS_RELEASE_COVERS), true);
});

test('READINESS: unknown writers are rejected', () => {
  assert.equal(isKnownCabinNightClaimS1Writer('archive'), false);
  assert.equal(isKnownCabinNightClaimS1Writer(''), false);
  assert.equal(isKnownCabinNightClaimS1Writer(null), false);
});

test('READINESS: static — registry documents archive coverage under status_release', () => {
  const src = readSource('services/inventory/cabinNightClaimWriterReadiness.js');
  assert.match(src, /Archive is covered under status_release/);
  assert.match(src, /AUTHORITATIVE path readiness/);
});

// ===========================================================================
// STATIC ORDERING PROOFS — finalize
// ===========================================================================

test('STATIC finalize: cabin pre-acquire happens before saveBookingWithReplay', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  orderedIn(
    src,
    'if (needsCabinPreClaim) {',
    'cabinPreClaimAttempt = await cabinAcquire({',
    'saveOutcome = await saveBookingWithReplay(deps, {'
  );
});

test('STATIC finalize: compensation runs on the save failure branch', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  orderedIn(
    src,
    'saveOutcome = await saveBookingWithReplay(deps, {',
    '} catch (saveErr) {',
    'compensateCreateAttemptClaims'
  );
});

test('STATIC finalize: post-canonical mirror is the mode-aware wrapper', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  assert.match(src, /postMirrorCabinNightsAfterCanonical/);
  assert.match(src, /preAcquireCabinNightsForCreate/);
});

test('STATIC finalize: release wrapper is used for non-owning transitions', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
});

test('STATIC finalize: finalize never creates a claim index', () => {
  const src = readSource('services/checkout/executeBookingFinalizeWork.js');
  assert.doesNotMatch(src, /cabinNightClaim_cabinId_night_unique/);
  assert.doesNotMatch(src, /CabinNightClaim\.collection/);
});

// ===========================================================================
// STATIC ORDERING PROOFS — legacy create route
// ===========================================================================

test('STATIC legacy: cabin pre-acquire precedes new Booking(bookingData)', () => {
  const src = readSource('routes/bookingRoutes.js');
  orderedIn(
    src,
    'cabinPreClaimAttempt = await preAcquireCabinNightsForCreate({',
    'booking = new Booking(bookingData);'
  );
});

test('STATIC legacy: booking _id is minted before the pre-acquire', () => {
  const src = readSource('routes/bookingRoutes.js');
  orderedIn(
    src,
    'if (!bookingData._id) {',
    'bookingData._id = new mongoose.Types.ObjectId();',
    'cabinPreClaimAttempt = await preAcquireCabinNightsForCreate({'
  );
});

test('STATIC legacy: save failure compensates the cabin claim attempt', () => {
  const src = readSource('routes/bookingRoutes.js');
  orderedIn(
    src,
    'booking = new Booking(bookingData);',
    '} catch (saveErr) {',
    'await compensateLegacyCabinCreateClaimAttempt({'
  );
});

test('STATIC legacy: pre-acquire is gated on single-cabin blocking shape', () => {
  const src = readSource('routes/bookingRoutes.js');
  assert.match(src, /isValidSingleCabinCommercialShape\(bookingData\)/);
  assert.match(src, /BLOCKING_BOOKING_STATUSES\.includes\(bookingData\.status\)/);
});

test('STATIC legacy: claim conflict maps to NOT_AVAILABLE and index failure to INVENTORY_INDEX_UNAVAILABLE', () => {
  const src = readSource('routes/bookingRoutes.js');
  assert.match(src, /INVENTORY_INDEX_UNAVAILABLE/);
  assert.match(src, /This cabin was just booked by another guest/);
});

test('STATIC legacy: route uses the mode-aware mirror and release wrappers', () => {
  const src = readSource('routes/bookingRoutes.js');
  assert.match(src, /postMirrorCabinNightsAfterCanonical/);
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
});

// ===========================================================================
// STATIC ORDERING PROOFS — reservationWriteService
// ===========================================================================

const RWS = 'services/ops/domain/reservationWriteService.js';
const RWS_TRANSITION = 'async function transitionReservation({';
const RWS_REASSIGN = 'async function reassignReservation({';
const RWS_COMMIT = 'async function commitBookingDatesAndReservationBlocks({';
const RWS_EDIT_DATES = 'async function editReservationDates({';
const RWS_MANUAL = 'async function createManualReservation({';

test('STATIC date-edit: pre-acquire precedes the canonical date commit', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  orderedIn(
    body,
    'newTargetCabinClaim = await preAcquireCabinNightsForMutation({',
    'await commitBookingDatesAndReservationBlocks({'
  );
});

test('STATIC date-edit: surplus release happens after the canonical commit', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  orderedIn(
    body,
    'await commitBookingDatesAndReservationBlocks({',
    'await releaseSurplusCabinNightsAuthoritative({'
  );
});

test('STATIC date-edit: commit failure compensates only the attempt nights', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  orderedIn(
    body,
    'await commitBookingDatesAndReservationBlocks({',
    '} catch (commitErr) {',
    'await compensateCreateAttemptClaims({'
  );
  assert.match(body, /Compensate ONLY the nights this attempt inserted/);
});

test('STATIC date-edit: only newOnly nights are pre-acquired', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  assert.match(body, /const newTarget = newExpanded\.dateOnlys\.filter\(\(n\) => !oldSet\.has\(n\)\)/);
  assert.match(body, /nights: newTarget/);
});

test('STATIC date-edit: cabin authority is gated on single-cabin shape', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  assert.match(body, /isCabinNightClaimAuthoritativeEnabled\(\)/);
  assert.match(body, /isValidSingleCabinCommercialShape\(booking\)/);
});

test('STATIC date-edit: shadow mode still syncs after the canonical commit', () => {
  const body = sliceBetween(readSource(RWS), RWS_EDIT_DATES, RWS_MANUAL);
  orderedIn(
    body,
    'await commitBookingDatesAndReservationBlocks({',
    'await syncCabinNightClaimsShadow({'
  );
});

test('STATIC reassign: target claim precedes the cabinId save', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  orderedIn(
    body,
    'targetCabinClaim = await preAcquireCabinNightsForMutation({',
    'booking.cabinId = toCabinId;',
    'await booking.save({ validateBeforeSave: false });'
  );
});

test('STATIC reassign: reservation AvailabilityBlocks are re-pointed with $set cabinId', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  orderedIn(
    body,
    'booking.cabinId = toCabinId;',
    'await AvailabilityBlock.updateMany(',
    "{ $set: { cabinId: toCabinId } }"
  );
});

test('STATIC reassign: only active reservation blocks are re-pointed', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  assert.match(
    body,
    /reservationId: booking\._id, blockType: 'reservation', status: 'active'/
  );
});

test('STATIC reassign: source release runs after the projection update', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  orderedIn(
    body,
    'await AvailabilityBlock.updateMany(',
    'await releaseSurplusCabinNightsAuthoritative({'
  );
  assert.match(body, /Source release is LAST/);
});

test('STATIC reassign: save failure compensates the target claim', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  orderedIn(body, '} catch (saveErr) {', 'await compensateCreateAttemptClaims({');
});

test('STATIC reassign: same-cabin reassign is excluded from the authority path', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  assert.match(body, /previousCabinId !== String\(toCabinId\)/);
  assert.match(body, /A same-cabin reassign must not enter this path/);
});

test('STATIC reassign: shadow mode keeps the sync helper', () => {
  const body = sliceBetween(readSource(RWS), RWS_REASSIGN, RWS_COMMIT);
  assert.match(body, /await syncCabinNightClaimsShadow\(\{/);
});

test('STATIC manual: pre-acquire precedes booking.save', () => {
  const body = sliceBetween(readSource(RWS), RWS_MANUAL);
  orderedIn(
    body,
    'cabinPreClaimAttempt = await preAcquireCabinNightsForCreate({',
    'await booking.save({ validateBeforeSave: false });'
  );
});

test('STATIC manual: external hold acknowledgement cannot bypass the barrier', () => {
  const body = sliceBetween(readSource(RWS), RWS_MANUAL);
  assert.match(body, /External hold acknowledgement above never bypasses this barrier/);
});

test('STATIC manual: overlap rollback deletes the Booking before releasing claims', () => {
  const body = sliceBetween(readSource(RWS), RWS_MANUAL);
  orderedIn(
    body,
    'await Booking.deleteOne({ _id: booking._id });',
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
  assert.match(body, /Canonical record must stop blocking BEFORE owner claims are released/);
});

test('STATIC manual: save failure compensates the create attempt', () => {
  const body = sliceBetween(readSource(RWS), RWS_MANUAL);
  orderedIn(
    body,
    'cabinPreClaimAttempt = await preAcquireCabinNightsForCreate({',
    '} catch (saveErr) {',
    'await compensateCreateAttemptClaims({'
  );
});

test('STATIC manual: post-canonical mirror runs after the overlap guard', () => {
  const body = sliceBetween(readSource(RWS), RWS_MANUAL);
  orderedIn(
    body,
    'if (overlaps > 0 || blockRace > 0) {',
    'await postMirrorCabinNightsAfterCanonical({'
  );
});

test('STATIC transition: cancel/complete release runs after the status save', () => {
  const body = sliceBetween(readSource(RWS), RWS_TRANSITION, RWS_REASSIGN);
  orderedIn(
    body,
    'booking.status = nextStatus;',
    "if (nextStatus === 'cancelled' || nextStatus === 'completed') {",
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
});

test('STATIC transition: release never reopens the booking', () => {
  const body = sliceBetween(readSource(RWS), RWS_TRANSITION, RWS_REASSIGN);
  assert.match(body, /Booking already ceased blocking; release never reopens it/);
});

test('STATIC transition: remembered idempotent replay still attempts release', () => {
  const body = sliceBetween(readSource(RWS), RWS_TRANSITION, RWS_REASSIGN);
  orderedIn(
    body,
    'if (remembered) {',
    'await releaseCabinNightsAfterCanonicalNonOwning({',
    'return remembered;'
  );
});

test('STATIC transition: tombstone error is still surfaced after the release attempt', () => {
  const body = sliceBetween(readSource(RWS), RWS_TRANSITION, RWS_REASSIGN);
  orderedIn(
    body,
    'await releaseCabinNightsAfterCanonicalNonOwning({',
    'if (tombstoneError) {',
    'throw tombstoneError;'
  );
});

test('STATIC rws: the service never creates or drops a claim index', () => {
  const src = readSource(RWS);
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
});

// ===========================================================================
// STATIC ORDERING PROOFS — maintenance
// ===========================================================================

const MAINT = 'services/maintenance/maintenanceOpsService.js';

test('STATIC maintenance: archive saves the non-owning booking before releasing', () => {
  const body = sliceBetween(
    readSource(MAINT),
    'async function archiveReservation(',
    'async function deleteFixtureReservation('
  );
  orderedIn(
    body,
    "booking.status = 'cancelled';",
    'await booking.save({ validateBeforeSave: false });',
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
});

test('STATIC maintenance: archive tombstones reservation blocks before releasing claims', () => {
  const body = sliceBetween(
    readSource(MAINT),
    'async function archiveReservation(',
    'async function deleteFixtureReservation('
  );
  orderedIn(
    body,
    'await AvailabilityBlock.updateMany(',
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
});

test('STATIC maintenance: archive uses the archive lifecycle source', () => {
  const body = sliceBetween(
    readSource(MAINT),
    'async function archiveReservation(',
    'async function deleteFixtureReservation('
  );
  assert.match(body, /lifecycleSource: 'archive'/);
});

test('STATIC maintenance: fixture delete removes the Booking before releasing claims', () => {
  const body = sliceBetween(
    readSource(MAINT),
    'async function deleteFixtureReservation(',
    'async function listMaintenanceCabins('
  );
  orderedIn(
    body,
    'await Booking.deleteOne({ _id: bid });',
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
});

test('STATIC maintenance: fixture delete documents the canonical-first ordering', () => {
  const body = sliceBetween(
    readSource(MAINT),
    'async function deleteFixtureReservation(',
    'async function listMaintenanceCabins('
  );
  assert.match(body, /must stop blocking before claims are released/);
});

test('STATIC maintenance: bulk archive releases per booking after the status update', () => {
  const src = readSource(MAINT);
  orderedIn(
    src,
    'await Booking.updateMany(',
    'for (const bookingId of bookingIds) {',
    'await releaseCabinNightsAfterCanonicalNonOwning({'
  );
});

test('STATIC maintenance: release failures open manual review items', () => {
  const src = readSource(MAINT);
  assert.match(src, /openManualReviewItemFn: openManualReviewItem/);
});

// ===========================================================================
// STATIC ORDERING PROOFS — location checkout
// ===========================================================================

const LOC = 'services/locationCheckout/locationCheckoutService.js';

test('STATIC location: single-cabin child claims before Booking.create', () => {
  const src = readSource(LOC);
  orderedIn(
    src,
    'const cabinClaimed = await preAcquireCabinNightsForCreate({',
    'const child = await Booking.create([childPayload], createOpts);'
  );
});

test('STATIC location: child _id is minted before the pre-acquire', () => {
  const src = readSource(LOC);
  orderedIn(
    src,
    'childPayload._id = new mongoose.Types.ObjectId();',
    'const cabinClaimed = await preAcquireCabinNightsForCreate({'
  );
});

test('STATIC location: claim failures compensate the recorded attempts', () => {
  const src = readSource(LOC);
  orderedIn(
    src,
    'const cabinClaimed = await preAcquireCabinNightsForCreate({',
    '} catch (claimErr) {',
    'await compensateCreateAttemptClaims({'
  );
});

test('STATIC location: only non-skipped attempts are tracked for compensation', () => {
  const src = readSource(LOC);
  assert.match(src, /if \(!cabinClaimed\.skipped\)/);
});

test('STATIC location: rollback releases via the mode-aware wrapper', () => {
  const src = readSource(LOC);
  assert.match(src, /releaseCabinNightsAfterCanonicalNonOwning/);
  assert.match(src, /LIFECYCLE_SOURCES\.LOCATION_ROLLBACK/);
});

test('STATIC location: multi-unit children still use the unit claim path', () => {
  const src = readSource(LOC);
  assert.match(src, /if \(childPayload\.cabinTypeId && childPayload\.unitId\)/);
  assert.match(src, /I2_SOURCES\.LOCATION_CHILD/);
});

// ===========================================================================
// STATIC — inventory-writing process boot gates
// ===========================================================================

test('STATIC boot: server.js starts via startApiProcess gate', () => {
  const src = readSource('server.js');
  assert.match(src, /startApiProcess/);
  assert.match(src, /assertCabinNightClaimAuthoritativeBootReady/);
  assert.match(src, /bootstrap\/startApiProcess/);
});

test('STATIC boot: startApiProcess exits when the assertion fails', () => {
  const src = readSource('bootstrap/startApiProcess.js');
  orderedIn(
    src,
    'await assertAuthorityBootFn({',
    'authoritative boot assertion failed',
    'exitFn(1)'
  );
});

test('STATIC boot: startApiProcess listens only after authoritative gate', () => {
  const src = readSource('bootstrap/startApiProcess.js');
  orderedIn(
    src,
    'await assertAuthorityBootFn({',
    'startPostConnectRuntimeFn({',
    'startHttpListenerFn()'
  );
});

test('STATIC boot: server.js boot gate stays read-only', () => {
  const src = readSource('server.js');
  assert.doesNotMatch(src, /cabinNightClaim_cabinId_night_unique/);
  assert.doesNotMatch(src, /CabinNightClaim\.collection\.createIndex/);
});

test('STATIC boot: startApiProcess never mutates indexes or claims', () => {
  const src = readSource('bootstrap/startApiProcess.js');
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
  assert.doesNotMatch(src, /claimCabinNights\(|releaseCabinNights\(/);
});

test('STATIC boot: finalize worker asserts authoritative boot readiness', () => {
  const src = readSource('scripts/runCheckoutFinalizationWorker.js');
  assert.match(src, /assertCabinNightClaimAuthoritativeBootReady/);
});

test('STATIC boot: finalize worker loads server env before connecting', () => {
  const src = readSource('scripts/runCheckoutFinalizationWorker.js');
  orderedIn(
    src,
    "require('../config/loadServerEnv')",
    'loadServerEnv();',
    'assertCabinNightClaimAuthoritativeBootReady'
  );
});

test('STATIC boot: finalize worker exits non-zero on a failed assertion', () => {
  const src = readSource('scripts/runCheckoutFinalizationWorker.js');
  orderedIn(
    src,
    'assertCabinNightClaimAuthoritativeBootReady({',
    'boot assertion failed',
    'process.exit(1);'
  );
});

test('STATIC boot: finalize worker asserts before starting the worker loop', () => {
  const src = readSource('scripts/runCheckoutFinalizationWorker.js');
  orderedIn(
    src,
    'assertCabinNightClaimAuthoritativeBootReady({',
    'startCheckoutFinalizationWorkerIfEnabled()'
  );
});

// ===========================================================================
// STATIC — blast-radius containment
// ===========================================================================

const AUTHORITY_FILES = [
  'services/inventory/cabinNightClaimAuthorityOps.js',
  'services/inventory/cabinNightClaimAuthoritativeBoot.js',
  'services/inventory/cabinNightClaimMode.js',
  'services/inventory/cabinNightClaimWriterReadiness.js'
];

test('STATIC scope: authority files never reference client code', () => {
  for (const rel of AUTHORITY_FILES) {
    assert.doesNotMatch(readSource(rel), /client\//, rel);
  }
});

test('STATIC scope: authority files never reference cleaning domain models', () => {
  for (const rel of AUTHORITY_FILES) {
    assert.doesNotMatch(readSource(rel), /CleaningJob|cleaningService|CleaningPayment/i, rel);
  }
});

test('STATIC scope: authority files never touch availability readers', () => {
  for (const rel of AUTHORITY_FILES) {
    assert.doesNotMatch(readSource(rel), /publicAvailabilityService|conflictService/, rel);
  }
});

test('STATIC scope: authority files never mutate indexes', () => {
  for (const rel of AUTHORITY_FILES) {
    assert.doesNotMatch(readSource(rel), /createIndex|dropIndex|syncIndexes/, rel);
  }
});

test('STATIC scope: authority ops never writes Booking documents', () => {
  const src = readSource('services/inventory/cabinNightClaimAuthorityOps.js');
  assert.doesNotMatch(src, /Booking\.(create|updateOne|updateMany|deleteOne|deleteMany|save)/);
});

test('STATIC scope: authority ops never references the unit claim collection', () => {
  const src = readSource('services/inventory/cabinNightClaimAuthorityOps.js');
  assert.doesNotMatch(src, /UnitNightClaim|unitNightClaim/);
});

test('STATIC scope: the unit claim service keeps its own primitive untouched', () => {
  const src = readSource('services/inventory/unitNightClaimService.js');
  assert.match(src, /async function claimUnitNights\(/);
  assert.doesNotMatch(src, /CabinNightClaim/);
  assert.doesNotMatch(src, /cabinNightClaimMode/);
});

test('STATIC scope: the unit claim schema is untouched by S1.7', () => {
  const src = readSource('models/UnitNightClaim.js');
  assert.doesNotMatch(src, /cabinId/);
  assert.match(src, /unitId/);
});

test('STATIC scope: the claim model still leaves the unique index to the cutover CLI', () => {
  const src = readSource('models/CabinNightClaim.js');
  assert.match(src, /autoIndex['"],\s*false/);
  assert.match(src, /Authoritative unique index is NOT declared on schema/);
});

test('STATIC scope: the authoritative spec is a single shared object', () => {
  const fromService =
    require('../services/inventory/cabinNightClaimService').AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  assert.equal(fromService, AUTHORITATIVE_UNIQUE_INDEX_SPEC);
  assert.equal(CabinNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC, AUTHORITATIVE_UNIQUE_INDEX_SPEC);
});

test('STATIC scope: observability payloads carry no guest PII fields', () => {
  const src = readSource('services/inventory/cabinNightClaimObservability.js');
  assert.doesNotMatch(src, /guestInfo|firstName|lastName|specialRequests/i);
  for (const key of Object.values(AUTHORITY_EVENTS)) {
    assert.match(src, new RegExp(key));
  }
});

// ===========================================================================
// INTEGRATION — manual reservation create
// ===========================================================================

test('INTEGRATION manual: authoritative create claims the stay nights', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const result = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-13',
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 's17-manual-ok@example.com',
      phone: '+359888000001'
    },
    reason: 'authoritative manual create',
    ctx: adminCtx()
  });
  assert.ok(result.reservationId);
  assert.deepEqual(await claimedNights(result.reservationId), [
    '2027-06-10',
    '2027-06-11',
    '2027-06-12'
  ]);
});

test('INTEGRATION manual: claims are attributed to manual_reservation', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const result = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-12',
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 's17-manual-src@example.com',
      phone: '+359888000002'
    },
    reason: 'authoritative manual create',
    ctx: adminCtx()
  });
  const rows = await CabinNightClaim.find({ bookingId: result.reservationId }).lean();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.source === 'manual_reservation'));
});

test('INTEGRATION manual: claims are bound to the persisted Booking id', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const result = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-12',
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 's17-manual-bind@example.com',
      phone: '+359888000003'
    },
    reason: 'authoritative manual create',
    ctx: adminCtx()
  });
  const booking = await reloadBooking(result.reservationId);
  assert.ok(booking);
  assert.equal(String(booking.cabinId), String(cabin._id));
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
});

test('INTEGRATION manual: a foreign claim conflict is refused with 409', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-06-11'],
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      createManualReservation({
        cabinId: cabin._id,
        checkInDate: '2027-06-10',
        checkOutDate: '2027-06-13',
        guestInfo: {
          firstName: 'Grace',
          lastName: 'Hopper',
          email: 's17-manual-conflict@example.com',
          phone: '+359888000004'
        },
        reason: 'conflicting manual create',
        ctx: adminCtx()
      }),
    (err) => err.type === 'conflict' && err.status === 409
  );
});

test('INTEGRATION manual: a claim conflict creates no Booking', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-06-10'],
    source: 'finalize'
  });
  const before = await Booking.countDocuments({});
  await assert.rejects(() =>
    createManualReservation({
      cabinId: cabin._id,
      checkInDate: '2027-06-10',
      checkOutDate: '2027-06-12',
      guestInfo: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 's17-manual-noboooking@example.com',
        phone: '+359888000005'
      },
      reason: 'conflicting manual create',
      ctx: adminCtx()
    })
  );
  assert.equal(await Booking.countDocuments({}), before);
});

test('INTEGRATION manual: a claim conflict leaves the incumbent claim intact', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const owner = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: owner,
    cabinId: cabin._id,
    nights: ['2027-06-10'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    createManualReservation({
      cabinId: cabin._id,
      checkInDate: '2027-06-10',
      checkOutDate: '2027-06-12',
      guestInfo: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 's17-manual-incumbent@example.com',
        phone: '+359888000006'
      },
      reason: 'conflicting manual create',
      ctx: adminCtx()
    })
  );
  assert.equal(await claimCount({ bookingId: owner }), 1);
  assert.equal(await claimCount(), 1);
});

test('INTEGRATION manual: the conflict error exposes no guest PII', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-06-10'],
    source: 'finalize'
  });
  try {
    await createManualReservation({
      cabinId: cabin._id,
      checkInDate: '2027-06-10',
      checkOutDate: '2027-06-12',
      guestInfo: {
        firstName: 'Secret',
        lastName: 'Person',
        email: 's17-manual-pii@example.com',
        phone: '+359888000007'
      },
      reason: 'conflicting manual create',
      ctx: adminCtx()
    });
    assert.fail('expected conflict');
  } catch (err) {
    assert.doesNotMatch(JSON.stringify(err.details || {}), /s17-manual-pii@example\.com/);
  }
});

test('INTEGRATION manual: authoritative mode without the index refuses the create', async () => {
  setMode(MODES.AUTHORITATIVE);
  const cabin = await makeCabin();
  await assert.rejects(
    () =>
      createManualReservation({
        cabinId: cabin._id,
        checkInDate: '2027-06-10',
        checkOutDate: '2027-06-12',
        guestInfo: {
          firstName: 'No',
          lastName: 'Index',
          email: 's17-manual-noindex@example.com',
          phone: '+359888000008'
        },
        reason: 'missing index manual create',
        ctx: adminCtx()
      }),
    (err) => err.status === 409 && err.details.code === CLAIM_ERR.INDEX_MISSING
  );
  assert.equal(await Booking.countDocuments({}), 0);
});

test('INTEGRATION manual: shadow mode does not claim before save (no index needed)', async () => {
  setMode(MODES.SHADOW);
  assert.equal((await indexNames()).includes(AUTH_INDEX_NAME), false);
  const cabin = await makeCabin();
  const result = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-12',
    guestInfo: {
      firstName: 'Shadow',
      lastName: 'Guest',
      email: 's17-manual-shadow@example.com',
      phone: '+359888000009'
    },
    reason: 'shadow manual create',
    ctx: adminCtx()
  });
  assert.ok(result.reservationId);
  assert.equal(await claimCount({ bookingId: result.reservationId }), 2);
});

test('INTEGRATION manual: off mode creates the Booking with no claims', async () => {
  setMode(MODES.OFF);
  const cabin = await makeCabin();
  const result = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-12',
    guestInfo: {
      firstName: 'Off',
      lastName: 'Guest',
      email: 's17-manual-off@example.com',
      phone: '+359888000010'
    },
    reason: 'off mode manual create',
    ctx: adminCtx()
  });
  assert.ok(result.reservationId);
  assert.equal(await claimCount(), 0);
});

test('INTEGRATION manual: authoritative create is idempotent per fingerprint', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const args = {
    cabinId: cabin._id,
    checkInDate: '2027-06-10',
    checkOutDate: '2027-06-12',
    guestInfo: {
      firstName: 'Idem',
      lastName: 'Potent',
      email: 's17-manual-idem@example.com',
      phone: '+359888000011'
    },
    reason: 'idempotent manual create',
    ctx: { ...adminCtx(), idempotencyKey: 's17-manual-idem-key' }
  };
  const first = await createManualReservation(args);
  const second = await createManualReservation(args);
  assert.equal(first.reservationId, second.reservationId);
  assert.equal(await claimCount({ bookingId: first.reservationId }), 2);
});

// ===========================================================================
// INTEGRATION — date edit
// ===========================================================================

async function seedAuthoritativeStay({
  checkIn = '2027-07-10',
  checkOut = '2027-07-12',
  status = 'confirmed'
} = {}) {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    status,
    checkIn: sofiaDay(checkIn),
    checkOut: sofiaDay(checkOut)
  });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  return { cabin, booking };
}

test('INTEGRATION date-edit: extending the stay claims the new night', async () => {
  const { booking } = await seedAuthoritativeStay();
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    reason: 'extend stay',
    ctx: adminCtx('POST /api/ops/reservations/:id/actions/edit-dates')
  });
  assert.deepEqual(await claimedNights(booking._id), [
    '2027-07-10',
    '2027-07-11',
    '2027-07-12'
  ]);
});

test('INTEGRATION date-edit: extension commits the canonical Booking dates', async () => {
  const { booking } = await seedAuthoritativeStay();
  const result = await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    reason: 'extend stay',
    ctx: adminCtx()
  });
  assert.equal(formatSofiaDateOnly(result.checkOutDate), '2027-07-13');
  const fresh = await reloadBooking(booking._id);
  assert.equal(formatSofiaDateOnly(fresh.checkOut), '2027-07-13');
});

test('INTEGRATION date-edit: claim count grows with the stay length', async () => {
  const { booking } = await seedAuthoritativeStay();
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-14',
    reason: 'extend stay further',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 4);
});

test('INTEGRATION date-edit: contracting the stay releases surplus nights', async () => {
  const { booking } = await seedAuthoritativeStay({ checkOut: '2027-07-14' });
  assert.equal(await claimCount({ bookingId: booking._id }), 4);
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-12',
    reason: 'shorten stay',
    ctx: adminCtx()
  });
  assert.deepEqual(await claimedNights(booking._id), ['2027-07-10', '2027-07-11']);
});

test('INTEGRATION date-edit: shifting the stay swaps the owned nights', async () => {
  const { booking } = await seedAuthoritativeStay();
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-12',
    checkOutDate: '2027-07-14',
    reason: 'shift stay',
    ctx: adminCtx()
  });
  assert.deepEqual(await claimedNights(booking._id), ['2027-07-12', '2027-07-13']);
});

test('INTEGRATION date-edit: a foreign claim on the new night blocks the edit', async () => {
  const { cabin, booking } = await seedAuthoritativeStay();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-07-12'],
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: booking._id,
        checkInDate: '2027-07-10',
        checkOutDate: '2027-07-13',
        reason: 'blocked extend',
        ctx: adminCtx()
      }),
    (err) => err.status === 409
  );
});

test('INTEGRATION date-edit: a blocked edit leaves the canonical dates unchanged', async () => {
  const { cabin, booking } = await seedAuthoritativeStay();
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-07-12'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    editReservationDates({
      bookingId: booking._id,
      checkInDate: '2027-07-10',
      checkOutDate: '2027-07-13',
      reason: 'blocked extend',
      ctx: adminCtx()
    })
  );
  const fresh = await reloadBooking(booking._id);
  assert.equal(formatSofiaDateOnly(fresh.checkOut), '2027-07-12');
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
});

test('INTEGRATION date-edit: authoritative mode without the index refuses the edit', async () => {
  const { booking } = await seedAuthoritativeStay();
  await CabinNightClaim.collection.dropIndex(AUTH_INDEX_NAME);
  await assert.rejects(
    () =>
      editReservationDates({
        bookingId: booking._id,
        checkInDate: '2027-07-10',
        checkOutDate: '2027-07-13',
        reason: 'no index edit',
        ctx: adminCtx()
      }),
    (err) => err.status === 409 && err.details.code === CLAIM_ERR.INDEX_MISSING
  );
});

test('INTEGRATION date-edit: reservation AvailabilityBlocks follow the new dates', async () => {
  const { cabin, booking } = await seedAuthoritativeStay();
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal'
  });
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    reason: 'extend stay',
    ctx: adminCtx()
  });
  const fresh = await reloadBlock(block._id);
  assert.equal(formatSofiaDateOnly(fresh.endDate), '2027-07-13');
});

test('INTEGRATION date-edit: shadow mode syncs claims without the authoritative index', async () => {
  setMode(MODES.SHADOW);
  const cabin = await makeCabin();
  const booking = await makeBooking({
    cabin,
    checkIn: sofiaDay('2027-07-10'),
    checkOut: sofiaDay('2027-07-12')
  });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-07-10', '2027-07-11'],
    source: 'date_edit'
  });
  await editReservationDates({
    bookingId: booking._id,
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    reason: 'shadow extend',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 3);
});

// ===========================================================================
// INTEGRATION — reassign
// ===========================================================================

test('INTEGRATION reassign: claims move to the target cabin', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: from._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  const result = await reassignReservation({
    bookingId: booking._id,
    toCabinId: to._id,
    ctx: adminCtx('POST /api/ops/reservations/:id/actions/reassign')
  });
  assert.equal(result.cabinId, String(to._id));
  assert.equal(await claimCount({ cabinId: to._id, bookingId: booking._id }), 2);
});

test('INTEGRATION reassign: source cabin claims are released last', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: from._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await reassignReservation({
    bookingId: booking._id,
    toCabinId: to._id,
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ cabinId: from._id }), 0);
});

test('INTEGRATION reassign: total claim count is preserved across the move', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: from._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() });
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
});

test('INTEGRATION reassign: reservation block cabinId follows the canonical cabin', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: from._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  const block = await AvailabilityBlock.create({
    cabinId: from._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal'
  });
  await reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() });
  const fresh = await reloadBlock(block._id);
  assert.equal(String(fresh.cabinId), String(to._id));
});

test('INTEGRATION reassign: external_hold blocks are never re-pointed', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  const hold = await AvailabilityBlock.create({
    cabinId: from._id,
    reservationId: booking._id,
    blockType: 'external_hold',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'ical'
  });
  await reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() });
  const fresh = await reloadBlock(hold._id);
  assert.equal(String(fresh.cabinId), String(from._id));
});

test('INTEGRATION reassign: a foreign claim on the target refuses the move', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: from._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: to._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await assert.rejects(
    () => reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() }),
    (err) => err.status === 409
  );
});

test('INTEGRATION reassign: a refused move keeps the Booking on the source cabin', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: to._id,
    nights: ['2027-03-10'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() })
  );
  const fresh = await reloadBooking(booking._id);
  assert.equal(String(fresh.cabinId), String(from._id));
});

test('INTEGRATION reassign: authoritative mode without the index refuses the move', async () => {
  await goAuthoritative();
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await CabinNightClaim.collection.dropIndex(AUTH_INDEX_NAME);
  await assert.rejects(
    () => reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() }),
    (err) => err.status === 409 && err.details.code === CLAIM_ERR.INDEX_MISSING
  );
});

test('INTEGRATION reassign: shadow mode moves claims without the authoritative index', async () => {
  setMode(MODES.SHADOW);
  const from = await makeCabin('from');
  const to = await makeCabin('to');
  const booking = await makeBooking({ cabin: from });
  await shadowClaim({
    cabinId: from._id,
    bookingId: booking._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'reassign'
  });
  await reassignReservation({ bookingId: booking._id, toCabinId: to._id, ctx: adminCtx() });
  assert.equal(await claimCount({ cabinId: from._id }), 0);
  assert.equal(await claimCount({ cabinId: to._id }), 2);
});

// ===========================================================================
// INTEGRATION — status transitions
// ===========================================================================

test('INTEGRATION cancel: authoritative cancel releases the claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx('POST /api/ops/reservations/:id/actions/cancel')
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION cancel: cancel makes the Booking non-owning first', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx()
  });
  const fresh = await reloadBooking(booking._id);
  assert.equal(fresh.status, 'cancelled');
});

test('INTEGRATION cancel: release is owner-scoped and spares other bookings', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  const neighbour = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: neighbour,
    cabinId: cabin._id,
    nights: ['2027-03-20'],
    source: 'finalize'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: neighbour }), 1);
});

test('INTEGRATION cancel: reservation blocks are tombstoned alongside the release', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx()
  });
  const fresh = await reloadBlock(block._id);
  assert.equal(fresh.status, 'tombstoned');
});

test('INTEGRATION complete: completing an in-house stay releases the claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'in_house' });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'complete',
    reason: 'stay complete',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION confirm: confirming a pending stay keeps the claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, status: 'pending' });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'confirm',
    reason: 'confirmed by staff',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 2);
});

test('INTEGRATION cancel: shadow mode still releases the claims', async () => {
  setMode(MODES.SHADOW);
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10', '2027-03-11'],
    source: 'manual_reservation'
  });
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION cancel: off mode retains the claim rows', async () => {
  setMode(MODES.SHADOW);
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10'],
    source: 'manual_reservation'
  });
  setMode(MODES.OFF);
  await transitionReservation({
    bookingId: booking._id,
    kind: 'cancel',
    reason: 'guest cancelled',
    ctx: adminCtx()
  });
  assert.equal(await claimCount({ bookingId: booking._id }), 1);
});

// ===========================================================================
// INTEGRATION — maintenance archive / fixture delete
// ===========================================================================

test('INTEGRATION archive: archiving a reservation releases its claims', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await archiveReservation(String(booking._id), 'archive for s17 proof', maintenanceCtx());
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION archive: archive makes the Booking cancelled and archived', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await archiveReservation(String(booking._id), 'archive for s17 proof', maintenanceCtx());
  const fresh = await reloadBooking(booking._id);
  assert.equal(fresh.status, 'cancelled');
  assert.ok(fresh.archivedAt);
});

test('INTEGRATION archive: archive release is owner-scoped', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  const neighbour = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: booking._id,
    cabinId: cabin._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'manual_reservation'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: neighbour,
    cabinId: cabin._id,
    nights: ['2027-03-25'],
    source: 'finalize'
  });
  await archiveReservation(String(booking._id), 'archive for s17 proof', maintenanceCtx());
  assert.equal(await claimCount({ bookingId: neighbour }), 1);
});

test('INTEGRATION archive: archive tombstones the reservation block', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  const block = await AvailabilityBlock.create({
    cabinId: cabin._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal'
  });
  await archiveReservation(String(booking._id), 'archive for s17 proof', maintenanceCtx());
  const fresh = await reloadBlock(block._id);
  assert.equal(fresh.status, 'tombstoned');
});

test('INTEGRATION archive: shadow mode also releases on archive', async () => {
  setMode(MODES.SHADOW);
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10']
  });
  await archiveReservation(String(booking._id), 'archive for s17 proof', maintenanceCtx());
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION fixture delete: Booking is removed and claims released', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, isTest: true });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10', '2027-03-11']
  });
  await deleteFixtureReservation(
    String(booking._id),
    'delete fixture for s17 proof',
    maintenanceCtx('POST /api/maintenance/reservations/:id/delete-fixture')
  );
  assert.equal(await Booking.countDocuments({ _id: booking._id }), 0);
  assert.equal(await claimCount({ bookingId: booking._id }), 0);
});

test('INTEGRATION fixture delete: non-fixture reservations are refused', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, isTest: false });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10']
  });
  await assert.rejects(
    () =>
      deleteFixtureReservation(
        String(booking._id),
        'delete fixture for s17 proof',
        maintenanceCtx()
      ),
    (err) => err.code === 'FORBIDDEN_DELETE'
  );
  assert.equal(await claimCount({ bookingId: booking._id }), 1);
});

test('INTEGRATION fixture delete: reservation blocks are removed too', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, isTest: true });
  await AvailabilityBlock.create({
    cabinId: cabin._id,
    reservationId: booking._id,
    blockType: 'reservation',
    startDate: booking.checkIn,
    endDate: booking.checkOut,
    status: 'active',
    source: 'internal'
  });
  await deleteFixtureReservation(
    String(booking._id),
    'delete fixture for s17 proof',
    maintenanceCtx()
  );
  assert.equal(await AvailabilityBlock.countDocuments({ reservationId: booking._id }), 0);
});

test('INTEGRATION fixture delete: a short reason is refused before any write', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const booking = await makeBooking({ cabin, isTest: true });
  await shadowClaim({
    cabinId: cabin._id,
    bookingId: booking._id,
    nights: ['2027-03-10']
  });
  await assert.rejects(
    () => deleteFixtureReservation(String(booking._id), 'short', maintenanceCtx()),
    (err) => err.code === 'VALIDATION'
  );
  assert.equal(await Booking.countDocuments({ _id: booking._id }), 1);
  assert.equal(await claimCount({ bookingId: booking._id }), 1);
});

// ===========================================================================
// END-TO-END invariants
// ===========================================================================

test('E2E: authoritative exclusivity holds for two competing writers', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const first = await createManualReservation({
    cabinId: cabin._id,
    checkInDate: '2027-08-10',
    checkOutDate: '2027-08-12',
    guestInfo: {
      firstName: 'First',
      lastName: 'Winner',
      email: 's17-e2e-first@example.com',
      phone: '+359888100001'
    },
    reason: 'first writer wins',
    ctx: adminCtx()
  });
  await Booking.deleteOne({ _id: first.reservationId });
  await assert.rejects(
    () =>
      createManualReservation({
        cabinId: cabin._id,
        checkInDate: '2027-08-10',
        checkOutDate: '2027-08-12',
        guestInfo: {
          firstName: 'Second',
          lastName: 'Loser',
          email: 's17-e2e-second@example.com',
          phone: '+359888100002'
        },
        reason: 'second writer must lose to the claim',
        ctx: adminCtx()
      }),
    (err) => err.status === 409
  );
});

test('E2E: the unique index rejects a duplicate cabin-night at the storage layer', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const night = sofiaDay('2027-09-10');
  await CabinNightClaim.create({
    cabinId: cabin._id,
    night,
    bookingId: new mongoose.Types.ObjectId(),
    source: 'test'
  });
  await assert.rejects(
    () =>
      CabinNightClaim.collection.insertOne({
        cabinId: cabin._id,
        night,
        bookingId: new mongoose.Types.ObjectId(),
        source: 'test'
      }),
    (err) => err.code === 11000
  );
});

test('E2E: listCabinNightClaims reflects the authoritative ledger', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-09-10', '2027-09-11'],
    source: 'finalize'
  });
  const listed = await listCabinNightClaims({ bookingId });
  assert.equal(listed.count, 2);
  assert.deepEqual(listed.claims.map((c) => c.night), ['2027-09-10', '2027-09-11']);
});

test('E2E: a full acquire/release cycle leaves no residue', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const bookingId = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId,
    cabinId: cabin._id,
    nights: ['2027-09-10', '2027-09-11'],
    source: 'finalize'
  });
  await releaseCabinNightsAfterCanonicalNonOwning({ bookingId, lifecycleSource: 'cancel' });
  assert.equal(await claimCount(), 0);
  const reacquired = await preAcquireCabinNightsForCreate({
    bookingId: new mongoose.Types.ObjectId(),
    cabinId: cabin._id,
    nights: ['2027-09-10'],
    source: 'finalize'
  });
  assert.equal(reacquired.insertedCount, 1);
});

test('E2E: releaseCabinNights primitive stays owner-scoped under authority', async () => {
  await goAuthoritative();
  const cabin = await makeCabin();
  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();
  await preAcquireCabinNightsForCreate({
    bookingId: a,
    cabinId: cabin._id,
    nights: ['2027-09-10'],
    source: 'finalize'
  });
  await preAcquireCabinNightsForCreate({
    bookingId: b,
    cabinId: cabin._id,
    nights: ['2027-09-11'],
    source: 'finalize'
  });
  const out = await releaseCabinNights({ bookingId: a });
  assert.equal(out.deletedCount, 1);
  assert.equal(await claimCount({ bookingId: b }), 1);
});
