/**
 * REBOOK-S1.6 — Controlled CabinNightClaim authoritative unique-index cutover.
 * Run: cd server && node --test scripts/cabinNightClaim.s6.test.cjs
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
  runCabinNightClaimS1Preflight,
  classifyAuthoritativeIndexState,
  AUTHORITATIVE_INDEX_STATES
} = require('../services/inventory/cabinNightClaimS1PreflightService');
const {
  runCabinNightClaimS1Backfill,
  REFUSE: BACKFILL_REFUSE
} = require('../services/inventory/cabinNightClaimS1BackfillService');
const {
  runCabinNightClaimS1UniqueIndexCutover,
  readRuntimeModeSafe,
  inventoryCleanForUnique,
  requestedIndexSpec,
  isDuplicateIndexBuildFailure,
  REFUSE
} = require('../services/inventory/cabinNightClaimS1UniqueIndexCutoverService');
const {
  parseArgs,
  exitCodeForReport,
  main: cutoverMain
} = require('./cabinNightClaimS1Cutover');
const {
  ACQUISITION_MODES,
  claimCabinNights
} = require('../services/inventory/cabinNightClaimService');

let mongoServer;
const ORIG_MODE = process.env.CABIN_NIGHT_CLAIM_MODE;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function makeCabin(name = 'S16-Cabin') {
  return Cabin.create({
    name: `${name}-${new mongoose.Types.ObjectId()}`,
    location: 'Valley',
    description: 'S1.6 test cabin',
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
      email: overrides.email || `s16-${new mongoose.Types.ObjectId()}@example.com`,
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

async function insertClaim({ cabinId, bookingId, night, source = 'finalize' }) {
  return claimCabinNights({
    cabinId,
    bookingId,
    nights: [night],
    source,
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
}

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.stdout.write = orig;
    })
    .then((code) => ({ code, report: JSON.parse(chunks.join('') || '{}') }));
}

function cleanPreflight(overrides = {}) {
  return {
    toolFailure: false,
    scanCompleteness: 'full',
    writerReadiness: { codeReady: true },
    readyForStableVerification: true,
    unexpectedIndexState: false,
    authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.ABSENT,
    authoritativeUniquePresent: false,
    authoritativeUniqueExact: false,
    fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    stableVerification: { satisfied: true, priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
    counts: {
      expected: 0,
      actual: 0,
      missing: 0,
      stale: 0,
      orphan: 0,
      wrongCabin: 0,
      outsideRange: 0,
      sameOwnerDuplicates: 0,
      foreignOwnerDuplicates: 0,
      canonicalCollisions: 0,
      foreignClaimConflicts: 0,
      claimsForNonblockingBooking: 0,
      claimsForMultiInventoryBooking: 0,
      claimsForExcludedBooking: 0,
      claimsForMalformedBooking: 0,
      malformedBookings: 0,
      malformedClaims: 0,
      invalidCabinReferences: 0,
      invalidDateRanges: 0
    },
    remainingBlockers: {},
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (ORIG_MODE === undefined) delete process.env.CABIN_NIGHT_CLAIM_MODE;
  else process.env.CABIN_NIGHT_CLAIM_MODE = ORIG_MODE;
});

test.beforeEach(async () => {
  process.env.CABIN_NIGHT_CLAIM_MODE = 'shadow';
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinNightClaim.deleteMany({})
  ]);
  try {
    await CabinNightClaim.collection.dropIndexes();
  } catch {
    /* empty */
  }
});

// ========== CLI ==========

test('CLI: default parseArgs has no mutation flags', () => {
  const a = parseArgs([]);
  assert.equal(a.createUniqueIndex, false);
  assert.equal(a.backfill, false);
  assert.equal(a.liveWritersVerified, false);
  assert.equal(a.priorFingerprint, null);
});

test('CLI: --verify parsed', () => {
  assert.equal(parseArgs(['--verify']).verify, true);
});

test('CLI: --create-unique-index recognized', () => {
  assert.equal(parseArgs(['--create-unique-index']).createUniqueIndex, true);
});

test('CLI: --prior-fingerprint and --live-writers-verified parsed', () => {
  const a = parseArgs([
    '--create-unique-index',
    '--prior-fingerprint',
    'abc',
    '--live-writers-verified'
  ]);
  assert.equal(a.priorFingerprint, 'abc');
  assert.equal(a.liveWritersVerified, true);
});

test('CLI: default verify remains read-only (no createIndex call)', async () => {
  let createCalls = 0;
  const Fake = {
    collection: {
      indexes: async () => [],
      createIndex: async () => {
        createCalls += 1;
        return 'x';
      }
    }
  };
  const r = await runCabinNightClaimS1Preflight({ CabinNightClaimModel: Fake });
  assert.equal(r.mode, 'verify');
  assert.equal(createCalls, 0);
});

test('CLI: --verify exit path does not create index on empty DB', async () => {
  const before = await CabinNightClaim.collection.indexes();
  const { code, report } = await captureStdout(() => cutoverMain(['--verify']));
  assert.equal(report.mode, 'verify');
  assert.equal(code, 0);
  const after = await CabinNightClaim.collection.indexes();
  assert.equal(after.length, before.length);
});

test('CLI: missing prior fingerprint refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    liveWritersVerified: true,
    priorFingerprint: null
  });
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, REFUSE.PRIOR_FINGERPRINT_REQUIRED);
  assert.equal(r.created, false);
});

test('CLI: missing live-writers ack refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: false
  });
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, REFUSE.LIVE_WRITERS_NOT_VERIFIED);
});

test('CLI: invalid backfill+create combination refused', async () => {
  const { code, report } = await captureStdout(() =>
    cutoverMain(['--backfill', '--create-unique-index'])
  );
  assert.equal(code, 2);
  assert.equal(report.refused, true);
  assert.equal(report.refuseCode, BACKFILL_REFUSE.INVALID_FLAG_COMBINATION);
});

test('CLI: backfill remains controlled flag', () => {
  assert.equal(parseArgs(['--backfill']).backfill, true);
});

// ========== MODE ==========

test('MODE: shadow accepted for absent-index creation path gate', () => {
  assert.equal(readRuntimeModeSafe({ CABIN_NIGHT_CLAIM_MODE: 'shadow' }).shadowOk, true);
});

test('MODE: off refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    env: { CABIN_NIGHT_CLAIM_MODE: 'off' },
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: true,
    runPreflight: async () => cleanPreflight()
  });
  assert.equal(r.refuseCode, REFUSE.MODE_NOT_SHADOW);
});

test('MODE: unset refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    env: {},
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: true,
    runPreflight: async () => cleanPreflight()
  });
  assert.equal(r.refuseCode, REFUSE.MODE_NOT_SHADOW);
  assert.equal(r.runtimeMode, 'unset');
});

test('MODE: authoritative refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    env: { CABIN_NIGHT_CLAIM_MODE: 'authoritative' },
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: true,
    runPreflight: async () => cleanPreflight()
  });
  assert.equal(r.refuseCode, REFUSE.MODE_NOT_SHADOW);
});

test('MODE: invalid refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    env: { CABIN_NIGHT_CLAIM_MODE: 'banana' },
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: true,
    runPreflight: async () => cleanPreflight()
  });
  assert.equal(r.refuseCode, REFUSE.MODE_NOT_SHADOW);
});

// ========== FRESH PREFLIGHT ==========

async function refuseOnDirty(patch) {
  const fp = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  return runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    runPreflight: async () =>
      cleanPreflight({
        fingerprint: fp,
        stableVerification: { satisfied: true, priorFingerprint: fp },
        ...patch,
        counts: { ...cleanPreflight().counts, ...(patch.counts || {}) }
      })
  });
}

test('PREFLIGHT: incomplete scan refused', async () => {
  const r = await refuseOnDirty({ scanCompleteness: 'partial' });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: toolFailure refused', async () => {
  const r = await refuseOnDirty({ toolFailure: true, toolFailureMessage: 'boom' });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: missing refused', async () => {
  const r = await refuseOnDirty({ counts: { missing: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: stale refused', async () => {
  const r = await refuseOnDirty({ counts: { stale: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: orphan refused', async () => {
  const r = await refuseOnDirty({ counts: { orphan: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: wrongCabin refused', async () => {
  const r = await refuseOnDirty({ counts: { wrongCabin: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: outsideRange refused', async () => {
  const r = await refuseOnDirty({ counts: { outsideRange: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: duplicate refused', async () => {
  const r = await refuseOnDirty({ counts: { sameOwnerDuplicates: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: canonical collision refused', async () => {
  const r = await refuseOnDirty({
    counts: { canonicalCollisions: 1 },
    readyForStableVerification: false
  });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: foreign claim conflict refused', async () => {
  const r = await refuseOnDirty({ counts: { foreignClaimConflicts: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: malformed refused', async () => {
  const r = await refuseOnDirty({ counts: { malformedClaims: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: invalid cabin refused', async () => {
  const r = await refuseOnDirty({ counts: { invalidCabinReferences: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: invalid date refused', async () => {
  const r = await refuseOnDirty({ counts: { invalidDateRanges: 1 } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

test('PREFLIGHT: writer capability gap refused', async () => {
  const r = await refuseOnDirty({ writerReadiness: { codeReady: false } });
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
});

// ========== FINGERPRINT ==========

test('FINGERPRINT: exact prior match accepted into create path', async () => {
  const fp = 'cccccccccccccccccccccccc';
  let createCalls = 0;
  const Fake = {
    collection: {
      indexes: async () => [{ name: '_id_', key: { _id: 1 } }],
      createIndex: async (keys, options) => {
        createCalls += 1;
        assert.deepEqual(keys, AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys);
        assert.equal(options.name, AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name);
        assert.equal(options.unique, true);
        return options.name;
      }
    }
  };
  let phase = 0;
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    CabinNightClaimModel: Fake,
    createIndexFn: Fake.collection.createIndex,
    runPreflight: async () => {
      phase += 1;
      if (phase === 1) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({
        fingerprint: fp,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT,
        authoritativeUniquePresent: true,
        authoritativeUniqueExact: true,
        stableVerification: { satisfied: false }
      });
    }
  });
  assert.equal(createCalls, 1);
  assert.equal(r.created, true);
  assert.equal(r.postVerificationClean, true);
  assert.equal(r.refused, false);
});

test('FINGERPRINT: mismatch refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: 'dddddddddddddddddddddddd',
    liveWritersVerified: true,
    runPreflight: async () =>
      cleanPreflight({
        fingerprint: 'eeeeeeeeeeeeeeeeeeeeeeee',
        stableVerification: { satisfied: false }
      })
  });
  assert.equal(r.refuseCode, REFUSE.FINGERPRINT_MISMATCH);
  assert.equal(r.created, false);
});

test('FINGERPRINT: stableVerification false refused', async () => {
  const fp = 'ffffffffffffffffffffffff';
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    runPreflight: async () =>
      cleanPreflight({
        fingerprint: fp,
        stableVerification: { satisfied: false, priorFingerprint: fp }
      })
  });
  assert.equal(r.refuseCode, REFUSE.FINGERPRINT_MISMATCH);
});

test('FINGERPRINT: no mutation on mismatch', async () => {
  let createCalls = 0;
  await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: '111111111111111111111111',
    liveWritersVerified: true,
    createIndexFn: async () => {
      createCalls += 1;
      return 'x';
    },
    runPreflight: async () =>
      cleanPreflight({
        fingerprint: '222222222222222222222222',
        stableVerification: { satisfied: false }
      })
  });
  assert.equal(createCalls, 0);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

// ========== LIVE WRITER ACK ==========

test('LIVE: missing ack refused', async () => {
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: false
  });
  assert.equal(r.refuseCode, REFUSE.LIVE_WRITERS_NOT_VERIFIED);
});

test('LIVE: explicit ack accepted field', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async (_k, o) => o.name,
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({
        fingerprint: fp,
        authoritativeUniqueExact: true,
        authoritativeUniquePresent: true,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT
      });
    }
  });
  assert.equal(r.liveWriterProcessAcknowledged, true);
  assert.equal(r.liveWriterProcessInspectedByCli, false);
});

test('LIVE: output does not falsely claim PM2 inspection', () => {
  const src = readSource('services/inventory/cabinNightClaimS1UniqueIndexCutoverService.js');
  assert.doesNotMatch(src, /pm2\s+(list|jlist|describe)/i);
  assert.match(src, /does not inspect PM2/);
  const cli = readSource('scripts/cabinNightClaimS1Cutover.js');
  assert.match(cli, /does not inspect PM2/);
  assert.match(cli, /liveWriterProcessInspectedByCli: false/);
});

// ========== INDEX STATE ==========

test('INDEX: absent classified', () => {
  const c = classifyAuthoritativeIndexState([]);
  assert.equal(c.authoritativeIndexState, AUTHORITATIVE_INDEX_STATES.ABSENT);
});

test('INDEX: exact classified', () => {
  const c = classifyAuthoritativeIndexState([
    {
      name: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
      key: { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys },
      unique: true
    }
  ]);
  assert.equal(c.authoritativeIndexState, AUTHORITATIVE_INDEX_STATES.EXACT);
  assert.equal(c.unexpectedIndexState, false);
});

test('INDEX: same name wrong key refused', async () => {
  const Fake = {
    collection: {
      indexes: async () => [
        {
          name: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
          key: { cabinId: 1 },
          unique: true
        }
      ]
    }
  };
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    CabinNightClaimModel: Fake,
    priorFingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    liveWritersVerified: true
  });
  assert.equal(r.refuseCode, REFUSE.WRONG_INDEX_STATE);
  assert.equal(r.indexStateBefore, AUTHORITATIVE_INDEX_STATES.WRONG_NAMED_AUTHORITY);
});

test('INDEX: same name nonunique refused', async () => {
  const Fake = {
    collection: {
      indexes: async () => [
        {
          name: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
          key: { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys },
          unique: false
        }
      ]
    }
  };
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    CabinNightClaimModel: Fake,
    priorFingerprint: 'x',
    liveWritersVerified: true
  });
  assert.equal(r.refuseCode, REFUSE.WRONG_INDEX_STATE);
});

test('INDEX: equivalent key wrong name refused', async () => {
  const Fake = {
    collection: {
      indexes: async () => [
        { name: 'cabinId_1_night_1', key: { cabinId: 1, night: 1 }, unique: true }
      ]
    }
  };
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    CabinNightClaimModel: Fake,
    priorFingerprint: 'x',
    liveWritersVerified: true
  });
  assert.equal(r.refuseCode, REFUSE.WRONG_INDEX_STATE);
  assert.equal(r.indexStateBefore, AUTHORITATIVE_INDEX_STATES.EQUIVALENT_KEY_CONFLICT);
});

test('INDEX: other unrelated index allowed (OTHER_SAFE)', () => {
  const c = classifyAuthoritativeIndexState([
    { name: 'bookingId_1', key: { bookingId: 1 } }
  ]);
  assert.equal(c.authoritativeIndexState, AUTHORITATIVE_INDEX_STATES.OTHER_SAFE_INDEXES_ONLY);
  assert.equal(c.unexpectedIndexState, false);
});

// ========== CREATE ==========

test('CREATE: exact spec reuse from AUTHORITATIVE_UNIQUE_INDEX_SPEC', () => {
  const spec = requestedIndexSpec();
  assert.deepEqual(spec.keys, AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys);
  assert.equal(spec.name, AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name);
  assert.equal(spec.unique, true);
});

test('CREATE: integration creates exact named index; no claim/Booking mutation', async () => {
  const cabin = await makeCabin();
  const b = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-12-10'),
    checkOut: sofiaDay('2026-12-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-12-10'
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-12-11'
  });
  const pre = await runCabinNightClaimS1Preflight({});
  assert.equal(pre.readyForStableVerification, true);
  const bookingCountBefore = await Booking.countDocuments({});
  const claimCountBefore = await CabinNightClaim.countDocuments({});

  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: pre.fingerprint,
    liveWritersVerified: true
  });
  assert.equal(r.created, true);
  assert.equal(r.createdIndexName, AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name);
  assert.equal(r.authoritativeUniqueExact, true);
  assert.equal(r.postVerificationClean, true);
  assert.equal(r.needsReview, false);
  assert.equal(await Booking.countDocuments({}), bookingCountBefore);
  assert.equal(await CabinNightClaim.countDocuments({}), claimCountBefore);
  const ix = await CabinNightClaim.collection.indexes();
  assert.ok(ix.some((i) => i.name === AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name && i.unique));
});

test('CREATE: no schema syncIndexes in unique cutover service', () => {
  const src = readSource('services/inventory/cabinNightClaimS1UniqueIndexCutoverService.js');
  assert.doesNotMatch(src, /syncIndexes/);
  assert.doesNotMatch(src, /\.init\(/);
  assert.match(src, /createIndex/);
});

// ========== RACE / FAILURE ==========

test('RACE: duplicate index-build failure surfaced; no claim delete', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const claimCountBefore = await CabinNightClaim.countDocuments({});
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async () => {
      const err = new Error('E11000 duplicate key error');
      err.code = 11000;
      throw err;
    },
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({ fingerprint: fp });
    }
  });
  assert.equal(r.refuseCode, REFUSE.INDEX_BUILD_DUPLICATE);
  assert.equal(r.created, false);
  assert.equal(r.needsReview, true);
  assert.equal(await CabinNightClaim.countDocuments({}), claimCountBefore);
});

test('RACE: isDuplicateIndexBuildFailure helper', () => {
  assert.equal(isDuplicateIndexBuildFailure({ code: 11000, message: 'x' }), true);
  assert.equal(isDuplicateIndexBuildFailure({ message: 'cannot create unique index' }), true);
  assert.equal(isDuplicateIndexBuildFailure({ message: 'network timeout' }), false);
});

test('RACE: generic createIndex failure surfaced; post-preflight attempted', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  let postCalls = 0;
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async () => {
      throw new Error('not authorized');
    },
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      postCalls += 1;
      return cleanPreflight({ fingerprint: fp });
    }
  });
  assert.equal(r.toolFailure, true);
  assert.match(r.toolFailureMessage, /not authorized/);
  assert.equal(r.postVerificationPerformed, true);
  assert.ok(postCalls >= 1);
});

// ========== POST VERIFY ==========

test('POST: exact authority + parity clean => success exit 0', () => {
  assert.equal(
    exitCodeForReport({
      mode: 'create-unique-index',
      toolFailure: false,
      refused: false,
      needsReview: false,
      postVerificationClean: true,
      authoritativeUniqueExact: true
    }),
    0
  );
});

test('POST: exact authority but missing => needsReview/nonzero', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async (_k, o) => o.name,
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({
        fingerprint: 'changedddddddddddddddddd',
        authoritativeUniqueExact: true,
        authoritativeUniquePresent: true,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT,
        counts: { ...cleanPreflight().counts, expected: 2, actual: 1, missing: 1 },
        readyForStableVerification: false
      });
    }
  });
  assert.equal(r.created, true);
  assert.equal(r.postVerificationClean, false);
  assert.equal(r.needsReview, true);
  assert.equal(exitCodeForReport(r), 2);
});

test('POST: exact authority but foreign drift => needsReview', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async (_k, o) => o.name,
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({
        fingerprint: fp,
        authoritativeUniqueExact: true,
        authoritativeUniquePresent: true,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT,
        counts: { ...cleanPreflight().counts, foreignClaimConflicts: 1 },
        readyForStableVerification: false
      });
    }
  });
  assert.equal(r.needsReview, true);
  assert.equal(r.created, true);
});

test('POST: no index drop on dirty post state', () => {
  const src = readSource('services/inventory/cabinNightClaimS1UniqueIndexCutoverService.js');
  assert.doesNotMatch(src, /dropIndex|dropIndexes/);
});

test('POST: fingerprint changed reported without drop', async () => {
  const fp = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: fp,
    liveWritersVerified: true,
    createIndexFn: async (_k, o) => o.name,
    runPreflight: async ({ priorFingerprint } = {}) => {
      if (priorFingerprint) {
        return cleanPreflight({
          fingerprint: fp,
          stableVerification: { satisfied: true, priorFingerprint: fp }
        });
      }
      return cleanPreflight({
        fingerprint: 'zzzzzzzzzzzzzzzzzzzzzzzz',
        authoritativeUniqueExact: true,
        authoritativeUniquePresent: true,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT
      });
    }
  });
  assert.equal(r.postCreateFingerprintChanged, true);
  assert.equal(r.postVerificationClean, true);
  assert.equal(r.created, true);
});

// ========== IDEMPOTENT RE-ENTRY ==========

test('IDEMPOTENT: exact existing index => no create call', async () => {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  let createCalls = 0;
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: 'ignored-after-authority',
    liveWritersVerified: false,
    createIndexFn: async () => {
      createCalls += 1;
      return 'x';
    }
  });
  assert.equal(createCalls, 0);
  assert.equal(r.alreadyPresent, true);
  assert.equal(r.created, false);
  assert.equal(r.authoritativeUniqueExact, true);
  assert.equal(r.postVerificationClean, true);
});

test('IDEMPOTENT: fingerprint may differ after authority without destructive action', async () => {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: 'old-s15-fingerprint-not-matching',
    liveWritersVerified: false
  });
  assert.equal(r.alreadyPresent, true);
  assert.equal(r.refused, false);
  assert.doesNotMatch(String(r.refuseCode), /FINGERPRINT/);
});

test('IDEMPOTENT: dirty current state => needsReview/nonzero', async () => {
  const Fake = {
    collection: {
      indexes: async () => [
        {
          name: AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
          key: { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys },
          unique: true
        }
      ]
    }
  };
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    CabinNightClaimModel: Fake,
    runPreflight: async () =>
      cleanPreflight({
        authoritativeUniqueExact: true,
        authoritativeUniquePresent: true,
        authoritativeIndexState: AUTHORITATIVE_INDEX_STATES.EXACT,
        counts: { ...cleanPreflight().counts, orphan: 1 },
        readyForStableVerification: false
      })
  });
  assert.equal(r.alreadyPresent, true);
  assert.equal(r.needsReview, true);
  assert.equal(exitCodeForReport(r), 2);
});

// ========== BACKFILL POST-AUTHORITY ==========

test('BACKFILL: refuses once exact authority established', async () => {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, BACKFILL_REFUSE.AFTER_AUTHORITY_NOT_ALLOWED);
});

// ========== OUTPUT ==========

test('OUTPUT: JSON fields for create-unique-index; no guest PII keys', async () => {
  const pre = await runCabinNightClaimS1Preflight({});
  const r = await runCabinNightClaimS1UniqueIndexCutover({
    priorFingerprint: pre.fingerprint,
    liveWritersVerified: true
  });
  for (const key of [
    'mode',
    'cutoverBatch',
    'runtimeMode',
    'codeWriterReadiness',
    'liveWriterProcessAcknowledged',
    'priorFingerprint',
    'preCreateFingerprint',
    'postCreateFingerprint',
    'preflightClean',
    'stableFingerprintMatched',
    'indexStateBefore',
    'indexStateAfter',
    'requestedIndexSpec',
    'created',
    'alreadyPresent',
    'authoritativeUniquePresent',
    'authoritativeUniqueExact',
    'postVerificationPerformed',
    'postVerificationClean',
    'needsReview'
  ]) {
    assert.ok(key in r, `missing ${key}`);
  }
  const blob = JSON.stringify(r);
  assert.doesNotMatch(blob, /firstName|lastName|phone|\+359/);
});

test('OUTPUT: preflight exposes authoritativeIndexState EXACT as valid', async () => {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.authoritativeIndexState, 'EXACT');
  assert.equal(r.unexpectedIndexState, false);
  assert.equal(r.readyForBackfill, false);
});

// ========== STATIC NON-TOUCH / NO STARTUP ==========

test('STATIC: schema does not register authoritative unique; autoIndex false', () => {
  const src = readSource('models/CabinNightClaim.js');
  assert.match(src, /autoIndex['\"],\s*false|set\(['\"]autoIndex['\"],\s*false\)/);
  assert.doesNotMatch(src, /cabinNightClaimSchema\.index\(\s*\{\s*cabinId:\s*1,\s*night:\s*1\s*\}\s*,\s*\{\s*unique:\s*true/);
  assert.match(src, /AUTHORITATIVE_UNIQUE_INDEX_SPEC/);
});

test('STATIC: unique cutover only via createIndex on collection; no claim delete', () => {
  const src = readSource('services/inventory/cabinNightClaimS1UniqueIndexCutoverService.js');
  assert.doesNotMatch(src, /deleteOne|deleteMany|findOneAndDelete|releaseCabinNights/);
  assert.doesNotMatch(src, /Booking\.(update|delete|findOneAndUpdate)/);
  assert.doesNotMatch(src, /CABIN_NIGHT_CLAIM_MODE\s*=\s*['\"]authoritative['\"]/);
});

test('STATIC: server.js / workers do not create CabinNightClaim unique index', () => {
  const serverSrc = readSource('server.js');
  assert.doesNotMatch(serverSrc, /cabinNightClaim_cabinId_night_unique/);
  assert.doesNotMatch(serverSrc, /AUTHORITATIVE_UNIQUE_INDEX_SPEC/);
  const modeSrc = readSource('services/inventory/cabinNightClaimMode.js');
  assert.doesNotMatch(modeSrc, /createIndex/);
});

test('STATIC: no client/Cleaning/availability reader changes in S1.6 files', () => {
  for (const rel of [
    'scripts/cabinNightClaimS1Cutover.js',
    'services/inventory/cabinNightClaimS1UniqueIndexCutoverService.js',
    'services/inventory/cabinNightClaimS1PreflightService.js'
  ]) {
    const src = readSource(rel);
    assert.doesNotMatch(src, /client\/|CleaningJob|publicAvailabilityService|conflictService/i);
  }
});

test('inventoryCleanForUnique helper rejects expected!==actual', () => {
  const r = inventoryCleanForUnique(
    cleanPreflight({ counts: { ...cleanPreflight().counts, expected: 2, actual: 1 } })
  );
  assert.equal(r.ok, false);
});

test('CLI main success path reports created with liveWriterProcessInspectedByCli false', async () => {
  const pre = await runCabinNightClaimS1Preflight({});
  const { code, report } = await captureStdout(() =>
    cutoverMain([
      '--create-unique-index',
      '--prior-fingerprint',
      pre.fingerprint,
      '--live-writers-verified'
    ])
  );
  assert.equal(code, 0);
  assert.equal(report.created, true);
  assert.equal(report.liveWriterProcessInspectedByCli, false);
  assert.equal(report.authoritativeUniqueExact, true);
});
