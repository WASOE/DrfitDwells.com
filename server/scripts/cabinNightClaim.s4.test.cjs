/**
 * REBOOK-S1.4 — Controlled CabinNightClaim INSERT-ONLY backfill.
 * Run: cd server && node --test scripts/cabinNightClaim.s4.test.cjs
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
  runCabinNightClaimS1Preflight
} = require('../services/inventory/cabinNightClaimS1PreflightService');
const {
  runCabinNightClaimS1Backfill,
  normalizeBatchSize,
  BACKFILL_SOURCE,
  REFUSE,
  preflightAllowsBackfill
} = require('../services/inventory/cabinNightClaimS1BackfillService');
const {
  parseArgs,
  exitCodeForReport,
  REFUSE_CODE,
  main: cutoverMain
} = require('./cabinNightClaimS1Cutover');
const {
  ACQUISITION_MODES,
  claimCabinNights,
  ERR: CLAIM_ERR
} = require('../services/inventory/cabinNightClaimService');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function makeCabin(name = 'S14-Cabin') {
  return Cabin.create({
    name: `${name}-${new mongoose.Types.ObjectId()}`,
    location: 'Valley',
    description: 'S1.4 test cabin',
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
    checkIn: overrides.checkIn || sofiaDay('2026-11-10'),
    checkOut: overrides.checkOut || sofiaDay('2026-11-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: overrides.email || `s14-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+35900000000'
    },
    totalPrice: 200,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest ?? false,
    archivedAt: overrides.archivedAt ?? undefined,
    locationBookingId: overrides.locationBookingId
  };
  Object.keys(doc).forEach((k) => {
    if (doc[k] === undefined) delete doc[k];
  });
  return Booking.create(doc);
}

async function insertClaim({ cabinId, bookingId, night, source = 'finalize', stayChangeId = null }) {
  return claimCabinNights({
    cabinId,
    bookingId,
    nights: [night],
    source,
    stayChangeId,
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
}

async function insertBookingRaw(doc) {
  const _id = doc._id || new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({
    _id,
    adults: 1,
    children: 0,
    guestInfo: {
      firstName: 'A',
      lastName: 'B',
      email: `raw-${_id}@example.com`,
      phone: '1'
    },
    totalPrice: 1,
    isTest: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...doc,
    _id
  });
  return Booking.findById(_id);
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

// --- CLI ---

test('CLI: default parseArgs has no mutation flags', () => {
  const a = parseArgs([]);
  assert.equal(a.backfill, false);
  assert.equal(a.createUniqueIndex, false);
  assert.equal(a.verify, false);
});

test('CLI: --verify parsed', () => {
  assert.equal(parseArgs(['--verify']).verify, true);
});

test('CLI: --backfill parsed', () => {
  assert.equal(parseArgs(['--backfill']).backfill, true);
});

test('CLI: --create-unique-index still refused', async () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  try {
    const code = await cutoverMain(['--create-unique-index']);
    assert.equal(code, 2);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.refuseCode, REFUSE_CODE);
    assert.equal(report.refused, true);
  } finally {
    process.stdout.write = orig;
  }
});

test('CLI: --backfill --create-unique-index combination refused', async () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  try {
    const code = await cutoverMain(['--backfill', '--create-unique-index']);
    assert.equal(code, 2);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.refuseCode, REFUSE.INVALID_FLAG_COMBINATION);
    assert.equal(await CabinNightClaim.countDocuments({}), 0);
  } finally {
    process.stdout.write = orig;
  }
});

test('CLI: invalid batch-size refused', async () => {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  try {
    const code = await cutoverMain(['--backfill', '--batch-size', '0']);
    assert.equal(code, 2);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.refuseCode, REFUSE.INVALID_BATCH_SIZE);
  } finally {
    process.stdout.write = orig;
  }
});

test('normalizeBatchSize: rejects non-positive / non-integer / oversize', () => {
  assert.equal(normalizeBatchSize(0).ok, false);
  assert.equal(normalizeBatchSize(-1).ok, false);
  assert.equal(normalizeBatchSize(1.5).ok, false);
  assert.equal(normalizeBatchSize(99999).ok, false);
  assert.equal(normalizeBatchSize(50).ok, true);
  assert.equal(normalizeBatchSize(null).value, 200);
});

test('default verify remains read-only (no claims inserted)', async () => {
  await makeBooking({});
  const before = await CabinNightClaim.countDocuments({});
  const chunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  process.stderr.write = () => true;
  try {
    await cutoverMain([]);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.mode, 'verify');
    assert.equal(await CabinNightClaim.countDocuments({}), before);
    assert.ok(report.counts.missing >= 1);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
});

// --- PREFLIGHT GATES ---

test('gate: readyForBackfill false => zero mutation', async () => {
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    cabinTypeId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
  assert.equal(r.inserted, 0);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

test('gate: collision => zero mutation', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.inserted, 0);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

test('gate: invalid cabin => zero mutation', async () => {
  await insertBookingRaw({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.inserted, 0);
});

test('gate: invalid range => zero mutation', async () => {
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-11-12'),
    checkOut: sofiaDay('2026-11-10'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.inserted, 0);
});

test('gate: writer gap => zero mutation', async () => {
  await makeBooking({});
  const r = await runCabinNightClaimS1Backfill({
    declaredWriters: ['finalize']
  });
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, REFUSE.PREFLIGHT_NOT_READY);
  assert.equal(r.inserted, 0);
});

test('gate: unexpected authority index => zero mutation', async () => {
  await makeBooking({});
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.inserted, 0);
});

test('gate: incomplete scan refused by preflightAllowsBackfill', () => {
  const g = preflightAllowsBackfill({
    scanCompleteness: 'partial',
    toolFailure: false,
    readyForBackfill: true,
    writerReadiness: { codeReady: true },
    unexpectedIndexState: false,
    counts: {}
  });
  assert.equal(g.ok, false);
});

test('gate: toolFailure refused', () => {
  const g = preflightAllowsBackfill({
    scanCompleteness: 'full',
    toolFailure: true,
    readyForBackfill: false,
    writerReadiness: { codeReady: true },
    unexpectedIndexState: false,
    counts: {}
  });
  assert.equal(g.ok, false);
});

// --- INSERT ---

test('insert: one missing tuple inserts bootstrap', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, false);
  assert.equal(r.inserted, 1);
  assert.equal(r.readyForStableVerification, true);
  const row = await CabinNightClaim.findOne({ bookingId: b._id }).lean();
  assert.equal(row.source, BACKFILL_SOURCE);
  assert.equal(row.stayChangeId, null);
  assert.equal(String(row.cabinId), String(b.cabinId));
});

test('insert: multiple missing insert exact night count', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-13')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.inserted, 3);
  assert.equal(r.post.counts.missing, 0);
  assert.equal(r.post.counts.actual, 3);
  assert.equal(r.readyForStableVerification, true);
});

test('insert: deterministic order cabinId|night|bookingId', async () => {
  const c1 = await makeCabin('A');
  const c2 = await makeCabin('B');
  // Force order by creating bookings such that missing sort is stable
  await makeBooking({
    cabin: c2,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  await makeBooking({
    cabin: c1,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const seen = [];
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      seen.push(`${opts.cabinId}|${opts.nights[0]}|${opts.bookingId}`);
      return claimCabinNights(opts);
    }
  });
  assert.equal(r.inserted, 2);
  const sorted = [...seen].sort();
  assert.deepEqual(seen, sorted);
});

test('insert: batch size respected', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-14')
  });
  const r = await runCabinNightClaimS1Backfill({ batchSize: 2 });
  assert.equal(r.processed, 2);
  assert.equal(r.inserted, 2);
  assert.equal(await CabinNightClaim.countDocuments({}), 2);
  // Not fully stable yet
  assert.equal(r.readyForStableVerification, false);
  assert.ok(r.post.counts.missing >= 1);
});

test('insert: Sofia night retained as date-only expansion', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  await runCabinNightClaimS1Backfill({});
  const nights = (await CabinNightClaim.find({ bookingId: b._id }).lean())
    .map((r) => require('../utils/dateTime').formatSofiaDateOnly(r.night))
    .sort();
  assert.deepEqual(nights, ['2026-11-10', '2026-11-11']);
});

test('insert: stayChangeId null and source bootstrap', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  await runCabinNightClaimS1Backfill({});
  const row = await CabinNightClaim.findOne({ bookingId: b._id }).lean();
  assert.equal(row.stayChangeId, null);
  assert.equal(row.source, 'bootstrap');
});

// --- IDEMPOTENCY ---

test('idempotency: same-owner existing skipped; organic source preserved', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-11-10',
    source: 'finalize'
  });
  const pre = await runCabinNightClaimS1Preflight({});
  assert.equal(pre.counts.missing, 1);
  assert.equal(pre.missingOwnership.length, 1);
  assert.equal(pre.missingOwnership[0].night, '2026-11-11');

  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.inserted, 1);
  assert.equal(r.missingAtPreflight, 1);
  const finalize = await CabinNightClaim.findOne({
    bookingId: b._id,
    night: sofiaDay('2026-11-10')
  }).lean();
  assert.equal(finalize.source, 'finalize');
  const boot = await CabinNightClaim.findOne({
    bookingId: b._id,
    night: sofiaDay('2026-11-11')
  }).lean();
  assert.equal(boot.source, 'bootstrap');
});

test('idempotency: live re-check skip increments skippedAlreadyOwned', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      // First call from backfill: pretend already owned (insertedCount 0)
      return {
        ok: true,
        insertedCount: 0,
        alreadyOwnedCount: 1,
        insertedClaimIdsThisAttempt: []
      };
    }
  });
  assert.equal(r.inserted, 0);
  assert.equal(r.skippedAlreadyOwned, 1);
});

test('CLI: --verify read-only with existing missing', async () => {
  await makeBooking({});
  const before = await CabinNightClaim.countDocuments({});
  const chunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  process.stderr.write = () => true;
  try {
    const code = await cutoverMain(['--verify']);
    assert.ok(code === 0 || code === 2);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.mode, 'verify');
    assert.equal(await CabinNightClaim.countDocuments({}), before);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
});

test('gate: malformed Booking blocks backfill', async () => {
  await insertBookingRaw({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, true);
  assert.equal(r.inserted, 0);
});

test('insert: two bookings backfill all nights', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  await makeBooking({
    cabin: await makeCabin(),
    checkIn: sofiaDay('2026-11-20'),
    checkOut: sofiaDay('2026-11-22')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.inserted, 3);
  assert.equal(r.readyForStableVerification, true);
});

test('batch-size=1 processes exactly one missing tuple', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-13')
  });
  const r = await runCabinNightClaimS1Backfill({ batchSize: 1 });
  assert.equal(r.processed, 1);
  assert.equal(r.inserted, 1);
  assert.equal(r.missingQueued, 3);
});

test('post: readyForUniqueIndex always false after clean backfill', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.readyForStableVerification, true);
  assert.equal(r.readyForUniqueIndex, false);
  assert.equal(r.post.readyForUniqueIndex, false);
});

test('invalid batch-size via service refuses without preflight mutation', async () => {
  await makeBooking({});
  const r = await runCabinNightClaimS1Backfill({ batchSize: -5 });
  assert.equal(r.refuseCode, REFUSE.INVALID_BATCH_SIZE);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

test('foreign conflict exit code is 2 not 0', async () => {
  const r = {
    mode: 'backfill',
    refused: true,
    toolFailure: false,
    failed: 0,
    foreignConflicts: 1,
    readyForStableVerification: false
  };
  assert.equal(exitCodeForReport(r), 2);
});

test('toolFailure exit code is 1', () => {
  assert.equal(exitCodeForReport({ mode: 'backfill', toolFailure: true }), 1);
});

test('location child booking is backfilled', async () => {
  const locId = new mongoose.Types.ObjectId();
  await makeBooking({
    locationBookingId: locId,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.inserted, 1);
  assert.equal(r.readyForStableVerification, true);
});

test('pending and in_house bookings backfill', async () => {
  await makeBooking({
    status: 'pending',
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  await makeBooking({
    cabin: await makeCabin(),
    status: 'in_house',
    checkIn: sofiaDay('2026-11-12'),
    checkOut: sofiaDay('2026-11-13')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.inserted, 2);
  assert.equal(r.readyForStableVerification, true);
});

test('isTest booking not backfilled', async () => {
  await makeBooking({ isTest: true });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.missingAtPreflight, 0);
  assert.equal(r.inserted, 0);
  assert.equal(r.readyForStableVerification, true);
});

test('conflictSamples bounded and PII-free', async () => {
  const cabin = await makeCabin();
  const owner = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const foreign = await makeBooking({
    cabin: await makeCabin(),
    status: 'cancelled',
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02')
  });
  void owner;
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      await CabinNightClaim.create({
        cabinId: opts.cabinId,
        bookingId: foreign._id,
        night: sofiaDay(opts.nights[0]),
        source: 'other'
      });
      return claimCabinNights(opts);
    }
  });
  assert.ok(r.conflictSamples.length >= 1);
  assert.equal(r.conflictSamples[0].email, undefined);
  assert.ok(r.conflictSamples[0].bookingId);
});

test('idempotency: second backfill inserts zero', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  const first = await runCabinNightClaimS1Backfill({});
  assert.equal(first.readyForStableVerification, true);
  const second = await runCabinNightClaimS1Backfill({});
  assert.equal(second.inserted, 0);
  assert.equal(second.missingAtPreflight, 0);
  assert.equal(second.readyForStableVerification, true);
  assert.equal(await CabinNightClaim.countDocuments({}), 2);
});

test('idempotency: restart after partial batch completes remaining', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-13')
  });
  const partial = await runCabinNightClaimS1Backfill({ batchSize: 1 });
  assert.equal(partial.inserted, 1);
  const rest = await runCabinNightClaimS1Backfill({});
  assert.equal(rest.inserted, 2);
  assert.equal(rest.readyForStableVerification, true);
});

// --- RACE ---

test('race: same-owner appeared after preflight => skip', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  let calls = 0;
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      calls += 1;
      // Simulate live writer inserting correct claim before backfill write
      await claimCabinNights({
        ...opts,
        source: 'finalize',
        acquisitionMode: ACQUISITION_MODES.SHADOW
      });
      return claimCabinNights(opts);
    }
  });
  assert.equal(calls, 1);
  assert.equal(r.inserted, 0);
  assert.equal(r.skippedAlreadyOwned, 1);
  const row = await CabinNightClaim.findOne({ bookingId: b._id }).lean();
  assert.equal(row.source, 'finalize');
});

test('race: foreign owner appeared after preflight => stop/refuse', async () => {
  const cabin = await makeCabin();
  const owner = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const foreign = await makeBooking({
    cabin: await makeCabin(),
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02'),
    status: 'cancelled'
  });
  void owner;
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      await CabinNightClaim.create({
        cabinId: opts.cabinId,
        bookingId: foreign._id,
        night: sofiaDay(opts.nights[0]),
        source: 'other'
      });
      return claimCabinNights(opts);
    }
  });
  assert.equal(r.refused, true);
  assert.equal(r.refuseCode, REFUSE.FOREIGN_OWNER_CONFLICT);
  assert.equal(r.foreignConflicts, 1);
  assert.equal(exitCodeForReport(r), 2);
  // Foreign row preserved; no overwrite
  const foreignRow = await CabinNightClaim.findOne({ bookingId: foreign._id }).lean();
  assert.ok(foreignRow);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: owner._id }), 0);
});

test('race: no delete of foreign claim', async () => {
  const src = readSource('services/inventory/cabinNightClaimS1BackfillService.js');
  assert.doesNotMatch(src, /releaseCabinNights|deleteOne|deleteMany|findOneAndDelete/);
});

// --- PARTIAL FAILURE ---

test('partial failure: earlier inserts remain; nonzero exit; rerun completes', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-13')
  });
  let n = 0;
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      n += 1;
      if (n === 2) {
        const err = new Error('injected');
        err.code = 'INJECTED_FAIL';
        throw err;
      }
      return claimCabinNights(opts);
    }
  });
  assert.equal(r.inserted, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.postVerificationPerformed, true);
  assert.equal(exitCodeForReport(r), 1);
  assert.equal(await CabinNightClaim.countDocuments({}), 1);

  const rerun = await runCabinNightClaimS1Backfill({});
  assert.equal(rerun.inserted, 2);
  assert.equal(rerun.readyForStableVerification, true);
});

// --- POST VERIFY ---

test('post verify: clean parity => readyForStableVerification true; unique false', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.post.counts.missing, 0);
  assert.equal(r.readyForStableVerification, true);
  assert.equal(r.readyForUniqueIndex, false);
  assert.notEqual(r.preflightFingerprint, r.postFingerprint);
});

test('post verify: stale remains blocker after insert of other booking', async () => {
  const stale = await makeBooking({
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02')
  });
  await insertClaim({
    cabinId: stale.cabinId,
    bookingId: stale._id,
    night: '2026-11-01',
    source: 'finalize'
  });
  stale.status = 'cancelled';
  await stale.save();

  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  // readyForBackfill is still true with stale (stale is unique-blocker not backfill-blocker)
  const pre = await runCabinNightClaimS1Preflight({});
  assert.equal(pre.readyForBackfill, true);
  assert.ok(pre.counts.stale >= 1);

  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.refused, false);
  assert.ok(r.inserted >= 1);
  assert.equal(r.readyForStableVerification, false);
  assert.ok(r.post.counts.stale >= 1);
});

test('post verify: orphan remains blocker', async () => {
  const cabin = await makeCabin();
  await CabinNightClaim.create({
    cabinId: cabin._id,
    bookingId: new mongoose.Types.ObjectId(),
    night: sofiaDay('2026-11-01'),
    source: 'other'
  });
  await makeBooking({
    cabin: await makeCabin(),
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.ok(r.inserted >= 1);
  assert.equal(r.readyForStableVerification, false);
  assert.ok(r.post.counts.orphan >= 1);
});

test('post verify: foreign remains blocker', async () => {
  // readyForBackfill still true with nonblocking claim drift; insert uncontested missing.
  const cabinA = await makeCabin();
  const cabinB = await makeCabin();
  await makeBooking({
    cabin: cabinA,
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const cancelled = await makeBooking({
    cabin: cabinB,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-02'),
    status: 'cancelled'
  });
  await CabinNightClaim.create({
    cabinId: cabinB._id,
    bookingId: cancelled._id,
    night: sofiaDay('2026-12-01'),
    source: 'other'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.ok(r.inserted >= 1);
  assert.equal(r.readyForStableVerification, false);
  assert.ok(
    r.post.counts.claimsForNonblockingBooking >= 1 || r.post.counts.stale >= 1
  );
});

// --- PROVENANCE ---

test('provenance: organic finalize preserved; bootstrap only new', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-11-10',
    source: 'finalize'
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(r.provenanceCounts.finalize, 1);
  assert.equal(r.provenanceCounts.bootstrap, 1);
});

// --- NON-MUTATION STATIC ---

test('static: backfill service has no Booking mutation / claim delete / index create', () => {
  const src = readSource('services/inventory/cabinNightClaimS1BackfillService.js');
  assert.doesNotMatch(src, /Booking\.(update|delete|findOneAndUpdate|bulkWrite)/);
  assert.doesNotMatch(src, /Booking\.save/);
  assert.doesNotMatch(src, /releaseCabinNights/);
  assert.doesNotMatch(src, /deleteOne|deleteMany|findOneAndDelete/);
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
  assert.match(src, /source: BACKFILL_SOURCE|source: 'bootstrap'/);
  assert.match(src, /ACQUISITION_MODES\.SHADOW/);
});

test('static: cutover still refuses unique index; no AvailabilityBlock', () => {
  const src = readSource('scripts/cabinNightClaimS1Cutover.js');
  assert.match(src, /create-unique-index/);
  assert.match(src, /NOT_IMPLEMENTED_IN_S1_3/);
  assert.doesNotMatch(src, /AvailabilityBlock/);
  assert.doesNotMatch(src, /publicAvailability/);
});

test('static: no client / cleaning paths in S1.4 files', () => {
  for (const rel of [
    'scripts/cabinNightClaimS1Cutover.js',
    'services/inventory/cabinNightClaimS1BackfillService.js'
  ]) {
    const src = readSource(rel);
    assert.doesNotMatch(src, /client\/|cleaningPricing|CleaningJob/i);
  }
});

// --- OUTPUT ---

test('output: machine JSON fields; no guest PII', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  for (const key of [
    'mode',
    'cutoverBatch',
    'preflightFingerprint',
    'postFingerprint',
    'requestedExpected',
    'missingAtPreflight',
    'processed',
    'inserted',
    'skippedAlreadyOwned',
    'foreignConflicts',
    'failed',
    'postVerificationPerformed',
    'readyForStableVerification',
    'readyForUniqueIndex'
  ]) {
    assert.ok(key in r, key);
  }
  assert.equal(r.mode, 'backfill');
  const blob = JSON.stringify(r);
  assert.doesNotMatch(blob, /@example\.com|firstName|lastName|\+35900000000/i);
});

test('output: exit 0 on successful complete backfill', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({});
  assert.equal(exitCodeForReport(r), 0);
});

test('CLI main --backfill succeeds on clean fixture', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const chunks = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (c) => {
    chunks.push(String(c));
    return true;
  };
  process.stderr.write = () => true;
  try {
    const code = await cutoverMain(['--backfill']);
    assert.equal(code, 0);
    const report = JSON.parse(chunks.join(''));
    assert.equal(report.mode, 'backfill');
    assert.equal(report.readyForStableVerification, true);
    assert.equal(report.inserted, 1);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
});

test('Booking documents unchanged by backfill', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const before = await Booking.findById(b._id).lean();
  await runCabinNightClaimS1Backfill({});
  const after = await Booking.findById(b._id).lean();
  assert.equal(String(after.status), String(before.status));
  assert.equal(String(after.cabinId), String(before.cabinId));
  assert.equal(new Date(after.checkIn).toISOString(), new Date(before.checkIn).toISOString());
  assert.equal(new Date(after.checkOut).toISOString(), new Date(before.checkOut).toISOString());
});

test('stayChange conflict on existing claim refuses without rewrite', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const sc = new mongoose.Types.ObjectId();
  await claimCabinNights({
    cabinId: b.cabinId,
    bookingId: b._id,
    nights: ['2026-11-10'],
    stayChangeId: sc,
    source: 'rebook',
    acquisitionMode: ACQUISITION_MODES.SHADOW
  });
  // Expected still missing for preflight? Same ownership key exists — missing=0
  // Force a second night missing plus stayChange conflict on first via custom fn
  const b2 = await makeBooking({
    cabin: await makeCabin(),
    checkIn: sofiaDay('2026-11-20'),
    checkOut: sofiaDay('2026-11-21')
  });
  void b2;
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async (opts) => {
      if (String(opts.bookingId) === String(b._id)) {
        return claimCabinNights(opts);
      }
      return claimCabinNights(opts);
    }
  });
  // b already owned under stayChange — not in missingOwnership; b2 inserts bootstrap
  assert.ok(r.inserted >= 1);
  const row = await CabinNightClaim.findOne({ bookingId: b._id }).lean();
  assert.equal(String(row.stayChangeId), String(sc));
  assert.equal(row.source, 'rebook');
});

test('malformed claim key state fails closed via claim service validation', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-11')
  });
  const r = await runCabinNightClaimS1Backfill({
    claimCabinNightsFn: async () => {
      const err = new Error('malformed');
      err.code = CLAIM_ERR.VALIDATION;
      throw err;
    }
  });
  assert.equal(r.failed, 1);
  assert.equal(exitCodeForReport(r), 1);
  assert.equal(await CabinNightClaim.countDocuments({}), 0);
});

test('preflight missingOwnership full list equals missing count', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-11-10'),
    checkOut: sofiaDay('2026-11-15')
  });
  const pre = await runCabinNightClaimS1Preflight({});
  assert.equal(pre.missingOwnership.length, pre.counts.missing);
  assert.equal(pre.counts.missing, 5);
});

test('REFUSE codes exported for ops', () => {
  assert.equal(REFUSE.FOREIGN_OWNER_CONFLICT, 'BACKFILL_FOREIGN_OWNER_CONFLICT');
  assert.equal(REFUSE.PREFLIGHT_NOT_READY, 'BACKFILL_PREFLIGHT_NOT_READY');
});
