/**
 * REBOOK-S1.1 — CabinNightClaim model + service foundation.
 * Run: cd server && node --test scripts/cabinNightClaim.s1.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CabinNightClaim = require('../models/CabinNightClaim');
const {
  AUTHORITATIVE_UNIQUE_INDEX_SPEC,
  CLAIM_SOURCES
} = require('../models/CabinNightClaim');
const {
  ERR,
  claimCabinNights,
  releaseCabinNights,
  releaseStayChangeTargetCabinClaims,
  assertBookingOwnsCabinNights,
  listCabinNightClaims,
  assertAuthoritativeCabinNightIndex,
  compensateCabinClaimAttempt,
  ensureAuthoritativeUniqueIndexForTests,
  expandOccupiedSofiaNightDateOnlys,
  normalizeSource
} = require('../services/inventory/cabinNightClaimService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function ids() {
  return {
    cabinId: new mongoose.Types.ObjectId(),
    bookingA: new mongoose.Types.ObjectId(),
    bookingB: new mongoose.Types.ObjectId(),
    stayChangeA: new mongoose.Types.ObjectId(),
    stayChangeB: new mongoose.Types.ObjectId()
  };
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
  await CabinNightClaim.deleteMany({});
  try {
    await CabinNightClaim.collection.dropIndexes();
  } catch {
    /* first run */
  }
});

async function withAuthoritativeIndex(fn) {
  await ensureAuthoritativeUniqueIndexForTests();
  return fn();
}

// --- MODEL ---

test('model: required fields and no updatedAt', () => {
  const paths = CabinNightClaim.schema.paths;
  assert.ok(paths.cabinId.options.required);
  assert.ok(paths.night.options.required);
  assert.ok(paths.bookingId.options.required);
  assert.ok(paths.source.options.required);
  assert.equal(paths.stayChangeId.options.required, undefined);
  assert.equal(CabinNightClaim.schema.options.timestamps.updatedAt, false);
  assert.ok(paths.createdAt);
  assert.equal(paths.guestInfo, undefined);
  assert.equal(paths.totalPrice, undefined);
  assert.equal(paths.status, undefined);
});

test('model: optional stayChangeId defaults null', async () => {
  const { cabinId, bookingA } = ids();
  const row = await CabinNightClaim.create({
    cabinId,
    night: sofiaDay('2026-08-20'),
    bookingId: bookingA,
    source: 'test'
  });
  assert.equal(row.stayChangeId, null);
});

// --- INDEX SAFETY ---

test('index: authoritative spec exact', () => {
  assert.deepEqual(AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys, { cabinId: 1, night: 1 });
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name, 'cabinNightClaim_cabinId_night_unique');
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.unique, true);
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'S1');
});

test('index: autoIndex disabled and authoritative unique not on schema', () => {
  assert.equal(CabinNightClaim.schema.get('autoIndex'), false);
  const indexes = CabinNightClaim.schema.indexes();
  const uniqueDecl = indexes.find(
    ([keys, opts]) => keys.cabinId === 1 && keys.night === 1 && opts && opts.unique === true
  );
  assert.equal(uniqueDecl, undefined);
  assert.ok(CabinNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC);
  assert.equal(CabinNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'S1');
});

test('index: syncIndexes does not create authoritative unique index', async () => {
  await CabinNightClaim.syncIndexes();
  const names = (await CabinNightClaim.collection.indexes()).map((i) => i.name);
  assert.ok(!names.includes('cabinNightClaim_cabinId_night_unique'));
});

test('index assertion: missing authoritative index', async () => {
  await assert.rejects(
    () => assertAuthoritativeCabinNightIndex(),
    (err) => err.code === ERR.INDEX_MISSING
  );
});

test('index assertion: wrong unique metadata rejected', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1, night: 1 },
    { unique: false, name: 'cabinNightClaim_cabinId_night_unique' }
  );
  await assert.rejects(
    () => assertAuthoritativeCabinNightIndex(),
    (err) => err.code === ERR.INDEX_WRONG
  );
});

test('index assertion: wrong keys rejected', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1, night: -1 },
    { unique: true, name: 'cabinNightClaim_cabinId_night_unique' }
  );
  await assert.rejects(
    () => assertAuthoritativeCabinNightIndex(),
    (err) => err.code === ERR.INDEX_WRONG
  );
});

test('index assertion: accepts exact authoritative index', async () => {
  await ensureAuthoritativeUniqueIndexForTests();
  const r = await assertAuthoritativeCabinNightIndex();
  assert.equal(r.ok, true);
  assert.equal(r.index.name, 'cabinNightClaim_cabinId_night_unique');
});

// --- NIGHTS ---

test('nights: one-night stay', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-21'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-08-20']);
});

test('nights: multi-night stay', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-23'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-08-20', '2026-08-21', '2026-08-22']);
});

test('nights: checkout day excluded', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-22'));
  assert.ok(!r.dateOnlys.includes('2026-08-22'));
});

test('nights: same-day invalid range rejected', async () => {
  const { cabinId, bookingA } = ids();
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-20'),
        source: 'test'
      }),
    (err) => err.code === ERR.VALIDATION
  );
});

test('nights: inverted range rejected', async () => {
  const { cabinId, bookingA } = ids();
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-22'),
        checkOut: sofiaDay('2026-08-20'),
        source: 'test'
      }),
    (err) => err.code === ERR.VALIDATION
  );
});

test('nights: Sofia DST spring boundary', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-03-28'), sofiaDay('2026-03-30'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-03-28', '2026-03-29']);
});

test('nights: Sofia DST autumn boundary', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-10-24'), sofiaDay('2026-10-26'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-10-24', '2026-10-25']);
});

// --- SOURCE ---

test('source: canonical allowlist accepted', () => {
  for (const s of CLAIM_SOURCES) {
    assert.equal(normalizeSource(s), s);
  }
});

test('source: invalid source rejected', async () => {
  const { cabinId, bookingA } = ids();
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-21'),
        source: 'not_a_real_source'
      }),
    (err) => err.code === ERR.INVALID_SOURCE
  );
});

// --- OWNERSHIP ---

test('ownership: first claim creates rows', async () => {
  const { cabinId, bookingA } = ids();
  const r = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'manual_reservation'
  });
  assert.equal(r.insertedCount, 2);
  assert.equal(r.alreadyOwnedCount, 0);
  assert.equal(await CabinNightClaim.countDocuments({}), 2);
});

test('ownership: same booking null StayChange idempotent', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'finalize'
  });
  const r2 = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'finalize'
  });
  assert.equal(r2.insertedCount, 0);
  assert.equal(r2.alreadyOwnedCount, 1);
  assert.equal(await CabinNightClaim.countDocuments({}), 1);
});

test('ownership: same booking same StayChange idempotent', async () => {
  const { cabinId, bookingA, stayChangeA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'rebook'
  });
  const r2 = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'rebook'
  });
  assert.equal(r2.insertedCount, 0);
  assert.equal(r2.alreadyOwnedCount, 1);
});

test('ownership: foreign booking rejected', async () => {
  const { cabinId, bookingA, bookingB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingB,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-21'),
        source: 'test'
      }),
    (err) => err.code === ERR.FOREIGN_OWNER
  );
});

test('ownership: different StayChange rejected', async () => {
  const { cabinId, bookingA, stayChangeA, stayChangeB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'rebook'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        stayChangeId: stayChangeB,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-21'),
        source: 'rebook'
      }),
    (err) => err.code === ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
  );
});

test('ownership: null requested cannot take over StayChange-owned claim', async () => {
  const { cabinId, bookingA, stayChangeA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'rebook'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-21'),
        source: 'finalize'
      }),
    (err) => err.code === ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
  );
});

test('ownership: StayChange request cannot adopt ordinary claim', async () => {
  const { cabinId, bookingA, stayChangeA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        stayChangeId: stayChangeA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-21'),
        source: 'rebook'
      }),
    (err) => err.code === ERR.STAY_CHANGE_OWNERSHIP_CONFLICT
  );
});

test('ownership: existing source not rewritten on idempotent replay', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'legacy_create'
  });
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'finalize'
  });
  const row = await CabinNightClaim.findOne({ cabinId, bookingId: bookingA }).lean();
  assert.equal(row.source, 'legacy_create');
});

// --- MULTI-NIGHT ---

test('multi-night: full acquisition', async () => {
  const { cabinId, bookingA } = ids();
  const r = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-23'),
    source: 'test'
  });
  assert.equal(r.nights.length, 3);
  assert.equal(r.insertedCount, 3);
});

test('multi-night: mixed existing-own plus new nights', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  const r = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-23'),
    source: 'test'
  });
  assert.equal(r.insertedCount, 2);
  assert.equal(r.alreadyOwnedCount, 1);
});

test('multi-night: foreign conflict mid-range', async () => {
  const { cabinId, bookingA, bookingB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingB,
    checkIn: sofiaDay('2026-08-21'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-23'),
        source: 'test'
      }),
    (err) => err.code === ERR.FOREIGN_OWNER
  );
  const countA = await CabinNightClaim.countDocuments({ bookingId: bookingA });
  assert.equal(countA, 0);
});

test('multi-night: compensation removes only attempt inserts', async () => {
  const { cabinId, bookingA, bookingB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  await claimCabinNights({
    cabinId,
    bookingId: bookingB,
    nights: ['2026-08-22'],
    source: 'test'
  });
  await assert.rejects(
    () =>
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-23'),
        source: 'test'
      }),
    (err) => err.code === ERR.FOREIGN_OWNER
  );
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingA }), 1);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingB }), 1);
});

test('compensation: explicit helper deletes by claim ids only', async () => {
  const { cabinId, bookingA } = ids();
  const first = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    nights: ['2026-08-20'],
    source: 'test'
  });
  const second = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    nights: ['2026-08-21'],
    source: 'test'
  });
  const victimId = second.insertedClaimIdsThisAttempt[0];
  await compensateCabinClaimAttempt({ insertedClaimIdsThisAttempt: [victimId] });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingA }), 1);
  const remaining = await CabinNightClaim.findOne({ bookingId: bookingA }).lean();
  assert.equal(String(remaining._id), first.insertedClaimIdsThisAttempt[0]);
});

// --- UNIQUE / RACE (authoritative simulation) ---

test('race: duplicate-key same-owner replay under unique index', async () => {
  await withAuthoritativeIndex(async () => {
    const { cabinId, bookingA } = ids();
    await claimCabinNights({
      cabinId,
      bookingId: bookingA,
      checkIn: sofiaDay('2026-08-20'),
      checkOut: sofiaDay('2026-08-21'),
      source: 'test',
      skipIndexAssert: false
    });
    const r2 = await claimCabinNights({
      cabinId,
      bookingId: bookingA,
      checkIn: sofiaDay('2026-08-20'),
      checkOut: sofiaDay('2026-08-21'),
      source: 'test',
      skipIndexAssert: false
    });
    assert.equal(r2.insertedCount, 0);
    assert.equal(await CabinNightClaim.countDocuments({ cabinId }), 1);
  });
});

test('race: duplicate-key foreign owner under unique index', async () => {
  await withAuthoritativeIndex(async () => {
    const { cabinId, bookingA, bookingB } = ids();
    await claimCabinNights({
      cabinId,
      bookingId: bookingA,
      checkIn: sofiaDay('2026-08-20'),
      checkOut: sofiaDay('2026-08-21'),
      source: 'test',
      skipIndexAssert: false
    });
    await assert.rejects(
      () =>
        claimCabinNights({
          cabinId,
          bookingId: bookingB,
          checkIn: sofiaDay('2026-08-20'),
          checkOut: sofiaDay('2026-08-21'),
          source: 'test',
          skipIndexAssert: false
        }),
      (err) => err.code === ERR.FOREIGN_OWNER
    );
  });
});

test('race: concurrent different owners — one winner only under unique index', async () => {
  await withAuthoritativeIndex(async () => {
    const { cabinId, bookingA, bookingB } = ids();
    const checkIn = sofiaDay('2026-08-20');
    const checkOut = sofiaDay('2026-08-21');
    const results = await Promise.allSettled([
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn,
        checkOut,
        source: 'test',
        skipIndexAssert: false
      }),
      claimCabinNights({
        cabinId,
        bookingId: bookingB,
        checkIn,
        checkOut,
        source: 'test',
        skipIndexAssert: false
      })
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(await CabinNightClaim.countDocuments({ cabinId }), 1);
  });
});

test('race: concurrent same owner remains one row under unique index', async () => {
  await withAuthoritativeIndex(async () => {
    const { cabinId, bookingA } = ids();
    const checkIn = sofiaDay('2026-08-20');
    const checkOut = sofiaDay('2026-08-21');
    await Promise.all([
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn,
        checkOut,
        source: 'test',
        skipIndexAssert: false
      }),
      claimCabinNights({
        cabinId,
        bookingId: bookingA,
        checkIn,
        checkOut,
        source: 'test',
        skipIndexAssert: false
      })
    ]);
    assert.equal(await CabinNightClaim.countDocuments({ cabinId }), 1);
  });
});

// --- RELEASE ---

test('release: booking + cabin scoped', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });
  const r = await releaseCabinNights({ bookingId: bookingA, cabinId });
  assert.equal(r.deletedCount, 2);
});

test('release: night range scoped', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-24'),
    source: 'test'
  });
  const r = await releaseCabinNights({
    bookingId: bookingA,
    cabinId,
    checkIn: sofiaDay('2026-08-21'),
    checkOut: sofiaDay('2026-08-23')
  });
  assert.equal(r.deletedCount, 2);
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingA }), 2);
});

test('release: foreign booking preserved', async () => {
  const { cabinId, bookingA, bookingB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  await claimCabinNights({
    cabinId,
    bookingId: bookingB,
    checkIn: sofiaDay('2026-08-21'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });
  await releaseCabinNights({ bookingId: bookingA, cabinId });
  assert.equal(await CabinNightClaim.countDocuments({ bookingId: bookingB }), 1);
});

test('release: unsafe unscoped release rejected', async () => {
  const { bookingA } = ids();
  await assert.rejects(
    () => releaseCabinNights({ bookingId: bookingA }),
    (err) => err.code === ERR.VALIDATION
  );
});

// --- STAYCHANGE RELEASE ---

test('stayChange release: exact REBOOK scope', async () => {
  const { cabinId, bookingA, stayChangeA, stayChangeB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'rebook'
  });
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeB,
    checkIn: sofiaDay('2026-08-22'),
    checkOut: sofiaDay('2026-08-23'),
    source: 'rebook'
  });
  const r = await releaseStayChangeTargetCabinClaims({
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    cabinId,
    source: 'rebook'
  });
  assert.equal(r.deletedCount, 2);
  assert.equal(await CabinNightClaim.countDocuments({ stayChangeId: stayChangeB }), 1);
});

test('stayChange release: ordinary claim preserved', async () => {
  const { cabinId, bookingA, stayChangeA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'finalize'
  });
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-21'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'rebook'
  });
  await releaseStayChangeTargetCabinClaims({
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    cabinId,
    source: 'rebook'
  });
  assert.equal(await CabinNightClaim.countDocuments({ source: 'finalize' }), 1);
});

// --- VERIFY ---

test('verify: exact ownership passes', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });
  const v = await assertBookingOwnsCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22')
  });
  assert.equal(v.ok, true);
});

test('verify: missing nights detected', async () => {
  const { cabinId, bookingA } = ids();
  const v = await assertBookingOwnsCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21')
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, ERR.OWNERSHIP_MISMATCH);
  assert.deepEqual(v.missingNights, ['2026-08-20']);
});

test('verify: foreign owner detected', async () => {
  const { cabinId, bookingA, bookingB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingB,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  const v = await assertBookingOwnsCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21')
  });
  assert.equal(v.ok, false);
  assert.equal(v.missingNights.length, 1);
});

test('verify: StayChange mismatch detected', async () => {
  const { cabinId, bookingA, stayChangeA, stayChangeB } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'rebook'
  });
  const v = await assertBookingOwnsCabinNights({
    cabinId,
    bookingId: bookingA,
    stayChangeId: stayChangeB,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21')
  });
  assert.equal(v.ok, false);
  assert.equal(v.code, ERR.STAY_CHANGE_OWNERSHIP_CONFLICT);
});

// --- LIST ---

test('list: requires scoped filter', async () => {
  await assert.rejects(() => listCabinNightClaims({}), (err) => err.code === ERR.VALIDATION);
});

test('list: booking scoped query', async () => {
  const { cabinId, bookingA } = ids();
  await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  const r = await listCabinNightClaims({ bookingId: bookingA });
  assert.equal(r.count, 1);
  assert.equal(r.claims[0].night, '2026-08-20');
});

// --- PRE-AUTHORITY NOTE ---

test('pre-authority: claim succeeds without authoritative index when skipIndexAssert true', async () => {
  const names = (await CabinNightClaim.collection.indexes()).map((i) => i.name);
  assert.ok(!names.includes('cabinNightClaim_cabinId_night_unique'));
  const { cabinId, bookingA } = ids();
  const r = await claimCabinNights({
    cabinId,
    bookingId: bookingA,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-21'),
    source: 'test'
  });
  assert.equal(r.ok, true);
});
