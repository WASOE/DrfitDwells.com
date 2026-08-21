/**
 * Inventory Integrity I6 — authoritative UnitNightClaim cutover.
 * Run: cd server && node --test scripts/unitNightClaim.i6.test.cjs
 *
 * Scenario tags map to docs/stay-change-implementation-plan.md
 * "I6 authoritative unit claim cutover semantics (LOCKED)" clauses 1–24.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const UnitNightClaim = require('../models/UnitNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../models/UnitNightClaim');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Cabin = require('../models/Cabin');
const ManualReviewItem = require('../models/ManualReviewItem');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');

const {
  claimUnitNights,
  releaseUnitNights,
  transferUnitNightClaims,
  assertAuthoritativeUnitNightIndex,
  assertBookingOwnsNights,
  compensateClaimAttempt,
  isDuplicateKeyError,
  nightDateFromDateOnly,
  dateOnlyFromNightDate,
  ensureAuthoritativeUniqueIndexForTests,
  ERR
} = require('../services/inventory/unitNightClaimService');
const {
  evaluateCabinTypeCommercialCapacity,
  isUnitCommerciallyAssignable
} = require('../services/inventory/cabinTypeCommercialCapacity');
const AssignmentEngine = require('../services/assignmentEngine');
const { isUnitGuestStayAvailable } = require('../services/publicAvailabilityService');
const { reassignReservation } = require('../services/ops/domain/reservationWriteService');
const { clearAllRememberedResults } = require('../services/idempotencyService');
const {
  computeStayNights,
  expandOccupiedSofiaNightDateOnlys
} = require('../services/ops/reporting/stayNights');
const {
  normalizeDateToSofiaDayStart,
  formatSofiaDateOnly,
  PROPERTY_TIMEZONE
} = require('../utils/dateTime');
const cutover = require('./unitNightClaimI6Cutover');

const { assignUnit, getAvailabilitySummary } = AssignmentEngine;
const {
  main: cutoverMain,
  parseArgs,
  exitCodeForI6Report,
  computeReadyForUniqueIndex,
  isAuthoritativeUniqueExact,
  mapCountsFromI5
} = cutover;

const AUTH_NAME = AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name;
const LEGACY_NAME = AUTHORITATIVE_UNIQUE_INDEX_SPEC.legacyNonUniqueName;
const RESERVATION_WRITE_SERVICE_PATH = path.join(
  __dirname,
  '../services/ops/domain/reservationWriteService.js'
);

let mongoServer;
let seq = 0;

// --- Sofia date helpers -----------------------------------------------------

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function sofiaDateOnly(daysFromNow = 0) {
  return moment
    .tz(PROPERTY_TIMEZONE)
    .startOf('day')
    .add(daysFromNow, 'day')
    .format('YYYY-MM-DD');
}

function sofiaDayFromNow(daysFromNow = 0) {
  return sofiaDay(sofiaDateOnly(daysFromNow));
}

// --- Index helpers ----------------------------------------------------------

async function indexList() {
  return (await UnitNightClaim.collection.indexes()) || [];
}

async function indexNames() {
  return (await indexList()).map((ix) => ix.name);
}

async function dropAuthoritativeUnique() {
  try {
    await UnitNightClaim.collection.dropIndex(AUTH_NAME);
  } catch (_) {
    /* already absent */
  }
}

async function createLegacyNonUnique() {
  await UnitNightClaim.collection.createIndex({ unitId: 1, night: 1 }, { name: LEGACY_NAME });
}

async function dropLegacyNonUnique() {
  try {
    await UnitNightClaim.collection.dropIndex(LEGACY_NAME);
  } catch (_) {
    /* already absent */
  }
}

// --- Fixtures ---------------------------------------------------------------

async function seedInventory({ units = 2, inactiveIndexes = [] } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `I6 CT ${suffix}`,
    slug: `i6-ct-${suffix}`,
    description: 'i6 authoritative cutover',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/i6.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const unitDocs = [];
  for (let i = 0; i < units; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const unit = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: `I6-${suffix}-A${i + 1}`,
      displayName: `I6 Unit ${i + 1}`,
      isActive: !inactiveIndexes.includes(i)
    });
    unitDocs.push(unit);
  }
  return {
    cabinType,
    units: unitDocs,
    unitA: unitDocs[0],
    unitB: unitDocs[1],
    unitC: unitDocs[2],
    suffix
  };
}

async function makeBooking(overrides = {}) {
  seq += 1;
  const payload = {
    cabinTypeId: overrides.cabinTypeId === undefined ? null : overrides.cabinTypeId,
    unitId: overrides.unitId === undefined ? null : overrides.unitId,
    cabinId: overrides.cabinId === undefined ? null : overrides.cabinId,
    checkIn: overrides.checkIn || sofiaDay('2027-05-10'),
    checkOut: overrides.checkOut || sofiaDay('2027-05-12'),
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest === true,
    isProductionSafe: false,
    locationBookingId: overrides.locationBookingId || null,
    guestInfo: {
      firstName: 'I6',
      lastName: 'Guest',
      email: overrides.email || `i6-guest-${seq}@example.com`,
      phone: '+359000000006'
    },
    totalPrice: 240,
    tripType: 'retreat',
    romanticSetup: false
  };
  if (overrides.archivedAt) payload.archivedAt = overrides.archivedAt;
  if (overrides.metadata) payload.metadata = overrides.metadata;
  return Booking.create(payload);
}

async function ownedDateOnlys(bookingId) {
  const rows = await UnitNightClaim.find({ bookingId }).sort({ night: 1 }).lean();
  return rows.map((r) => formatSofiaDateOnly(r.night));
}

function adminCtx(overrides = {}) {
  seq += 1;
  return {
    user: { id: `i6-admin-${seq}`, role: 'admin' },
    route: 'POST /api/ops/reservations/:id/actions/reassign',
    ...overrides
  };
}

/** Hide the claim pre-read exactly once so the insert hits a real E11000 race. */
function hideFirstClaimPreRead() {
  const original = UnitNightClaim.find;
  let calls = 0;
  UnitNightClaim.find = function patchedFind(...args) {
    calls += 1;
    if (calls === 1) {
      return {
        session() {
          return this;
        },
        lean: async () => []
      };
    }
    return original.apply(this, args);
  };
  return () => {
    UnitNightClaim.find = original;
  };
}

async function withoutAuthoritativeUnique(fn) {
  await dropAuthoritativeUnique();
  try {
    return await fn();
  } finally {
    await ensureAuthoritativeUniqueIndexForTests();
  }
}

async function runCutover(argv) {
  const prevExit = process.exitCode;
  try {
    return await cutoverMain(argv);
  } finally {
    process.exitCode = prevExit;
  }
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await ensureAuthoritativeUniqueIndexForTests();
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
  await dropLegacyNonUnique();
  await ensureAuthoritativeUniqueIndexForTests();
});

// ===========================================================================
// Clause 2 — model + authoritative index specification
// ===========================================================================

test('I6#2 spec declares named unique {unitId,night} index', () => {
  assert.deepEqual({ ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys }, { unitId: 1, night: 1 });
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.unique, true);
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name, 'unitNightClaim_unitId_night_unique');
});

test('I6#2 spec pins cutoverBatch I6', () => {
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'I6');
});

test('I6#2 spec names the legacy non-unique compound index', () => {
  assert.equal(AUTHORITATIVE_UNIQUE_INDEX_SPEC.legacyNonUniqueName, 'unitId_1_night_1');
});

test('I6#2 spec object and key map are frozen', () => {
  assert.equal(Object.isFrozen(AUTHORITATIVE_UNIQUE_INDEX_SPEC), true);
  assert.equal(Object.isFrozen(AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys), true);
  assert.equal(Object.isFrozen(AUTHORITATIVE_UNIQUE_INDEX_SPEC.options), true);
});

test('I6#2 single canonical spec is shared by model, service and cutover CLI', () => {
  const fromService = require('../services/inventory/unitNightClaimService')
    .AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  assert.equal(fromService, AUTHORITATIVE_UNIQUE_INDEX_SPEC);
  assert.equal(cutover.AUTHORITATIVE_UNIQUE_INDEX_SPEC, AUTHORITATIVE_UNIQUE_INDEX_SPEC);
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC, AUTHORITATIVE_UNIQUE_INDEX_SPEC);
});

test('I6#2 schema autoIndex is disabled', () => {
  assert.equal(UnitNightClaim.schema.get('autoIndex'), false);
});

test('I6#2 authoritative unique index exists after explicit cutover helper', async () => {
  const names = await indexNames();
  assert.ok(names.includes(AUTH_NAME));
  const ix = (await indexList()).find((i) => i.name === AUTH_NAME);
  assert.equal(ix.unique, true);
  assert.deepEqual(ix.key, { unitId: 1, night: 1 });
});

test('I6#2 legacy non-unique compound coexists with the authoritative unique index', async () => {
  await createLegacyNonUnique();
  const rows = await indexList();
  const legacy = rows.find((i) => i.name === LEGACY_NAME);
  const auth = rows.find((i) => i.name === AUTH_NAME);
  assert.ok(legacy);
  assert.notEqual(legacy.unique, true);
  assert.ok(auth);
  assert.equal(auth.unique, true);
});

test('I6#2 unique index rejects a raw duplicate {unitId,night} insert', async () => {
  const { unitA } = await seedInventory();
  const night = sofiaDay('2027-05-10');
  await UnitNightClaim.create({
    unitId: unitA._id,
    night,
    bookingId: new mongoose.Types.ObjectId(),
    source: 'test'
  });
  await assert.rejects(
    () =>
      UnitNightClaim.create({
        unitId: unitA._id,
        night,
        bookingId: new mongoose.Types.ObjectId(),
        source: 'test'
      }),
    (err) => isDuplicateKeyError(err)
  );
});

test('I6#2 unique index still allows the same night on a different unit', async () => {
  const { unitA, unitB } = await seedInventory();
  const night = sofiaDay('2027-05-10');
  const bookingId = new mongoose.Types.ObjectId();
  await UnitNightClaim.create({ unitId: unitA._id, night, bookingId, source: 'test' });
  await UnitNightClaim.create({ unitId: unitB._id, night, bookingId, source: 'test' });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);
});

// ===========================================================================
// Clause 4 — acquisition index guard
// ===========================================================================

test('I6#4 guard resolves when the exact authoritative unique index is present', async () => {
  const result = await assertAuthoritativeUnitNightIndex();
  assert.equal(result.ok, true);
  assert.equal(result.index.name, AUTH_NAME);
  assert.equal(result.index.unique, true);
});

test('I6#4 guard accepts an explicitly injected collection', async () => {
  const result = await assertAuthoritativeUnitNightIndex({
    collection: UnitNightClaim.collection
  });
  assert.equal(result.ok, true);
});

test('I6#4 guard throws INDEX_MISSING when the unique index is absent', async () => {
  await withoutAuthoritativeUnique(async () => {
    await assert.rejects(
      () => assertAuthoritativeUnitNightIndex(),
      (err) => {
        assert.equal(err.code, ERR.INDEX_MISSING);
        assert.equal(err.details.expectedName, AUTH_NAME);
        assert.deepEqual(err.details.expectedKeys, { unitId: 1, night: 1 });
        assert.equal(err.details.expectedUnique, true);
        assert.ok(Array.isArray(err.details.foundNames));
        return true;
      }
    );
  });
});

test('I6#4 guard never creates or mutates indexes on failure', async () => {
  await withoutAuthoritativeUnique(async () => {
    const before = await indexNames();
    await assert.rejects(() => assertAuthoritativeUnitNightIndex());
    assert.deepEqual(await indexNames(), before);
    assert.ok(!before.includes(AUTH_NAME));
  });
});

test('I6#4 guard rejects when only the legacy non-unique compound exists', async () => {
  await withoutAuthoritativeUnique(async () => {
    await createLegacyNonUnique();
    await assert.rejects(
      () => assertAuthoritativeUnitNightIndex(),
      (err) => {
        assert.equal(err.code, ERR.INDEX_MISSING);
        assert.ok(err.details.foundNames.includes(LEGACY_NAME));
        return true;
      }
    );
  });
});

test('I6#4 guard passes when legacy compound coexists with authoritative unique', async () => {
  await createLegacyNonUnique();
  const result = await assertAuthoritativeUnitNightIndex();
  assert.equal(result.ok, true);
  assert.equal(result.index.name, AUTH_NAME);
});

test('I6#4 guard rejects an index with the right name but unique:false', async () => {
  await assert.rejects(
    () =>
      assertAuthoritativeUnitNightIndex({
        collection: {
          indexes: async () => [{ name: AUTH_NAME, key: { unitId: 1, night: 1 } }]
        }
      }),
    (err) => err.code === ERR.INDEX_MISSING
  );
});

test('I6#4 guard rejects a unique index with a different name', async () => {
  await assert.rejects(
    () =>
      assertAuthoritativeUnitNightIndex({
        collection: {
          indexes: async () => [{ name: 'someone_elses_unique', key: { unitId: 1, night: 1 }, unique: true }]
        }
      }),
    (err) => err.code === ERR.INDEX_MISSING
  );
});

test('I6#4 guard rejects a unique index with extra key fields', async () => {
  await assert.rejects(
    () =>
      assertAuthoritativeUnitNightIndex({
        collection: {
          indexes: async () => [
            { name: AUTH_NAME, key: { unitId: 1, night: 1, bookingId: 1 }, unique: true }
          ]
        }
      }),
    (err) => err.code === ERR.INDEX_MISSING
  );
});

test('I6#4 guard accepts an exact injected index descriptor', async () => {
  const result = await assertAuthoritativeUnitNightIndex({
    collection: {
      indexes: async () => [{ name: AUTH_NAME, key: { unitId: 1, night: 1 }, unique: true }]
    }
  });
  assert.equal(result.ok, true);
});

test('I6#4 guard surfaces index-listing failure as INDEX_MISSING with cause', async () => {
  await assert.rejects(
    () =>
      assertAuthoritativeUnitNightIndex({
        collection: {
          indexes: async () => {
            throw new Error('listIndexes boom');
          }
        }
      }),
    (err) => {
      assert.equal(err.code, ERR.INDEX_MISSING);
      assert.match(String(err.details.cause), /listIndexes boom/);
      return true;
    }
  );
});

test('I6#4 acquisition fails without the unique index and writes nothing', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await withoutAuthoritativeUnique(async () => {
    await assert.rejects(
      () =>
        claimUnitNights({
          bookingId,
          unitId: unitA._id,
          checkIn: sofiaDay('2027-05-10'),
          checkOut: sofiaDay('2027-05-13'),
          source: 'finalize'
        }),
      (err) => err.code === ERR.INDEX_MISSING
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
  });
});

test('I6#4 acquisition succeeds again once the unique index is restored', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await withoutAuthoritativeUnique(async () => {
    await assert.rejects(
      () => claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' }),
      (err) => err.code === ERR.INDEX_MISSING
    );
  });
  const ok = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10'],
    source: 'finalize'
  });
  assert.equal(ok.insertedCount, 1);
});

test('I6#4 skipIndexAssert bypasses the guard for internal callers', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await withoutAuthoritativeUnique(async () => {
    const result = await claimUnitNights({
      bookingId,
      unitId: unitA._id,
      nights: ['2027-05-10', '2027-05-11'],
      source: 'bootstrap',
      skipIndexAssert: true
    });
    assert.equal(result.insertedCount, 2);
  });
});

test('I6#4 guard runs once per acquisition, not once per night', async () => {
  const { unitA } = await seedInventory();
  const col = UnitNightClaim.collection;
  const had = Object.prototype.hasOwnProperty.call(col, 'indexes');
  const prev = col.indexes;
  const original = col.indexes.bind(col);
  let calls = 0;
  col.indexes = async (...args) => {
    calls += 1;
    return original(...args);
  };
  try {
    await claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unitA._id,
      checkIn: sofiaDay('2027-05-10'),
      checkOut: sofiaDay('2027-05-15'),
      source: 'finalize'
    });
    assert.equal(calls, 1);
  } finally {
    if (had) col.indexes = prev;
    else delete col.indexes;
  }
});

test('I6#4 no positive process cache: a later acquisition re-checks the index', async () => {
  const { unitA } = await seedInventory();
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitA._id,
    nights: ['2027-05-10'],
    source: 'finalize'
  });
  await withoutAuthoritativeUnique(async () => {
    await assert.rejects(
      () =>
        claimUnitNights({
          bookingId: new mongoose.Types.ObjectId(),
          unitId: unitA._id,
          nights: ['2027-05-20'],
          source: 'finalize'
        }),
      (err) => err.code === ERR.INDEX_MISSING
    );
  });
});

test('I6#4 release proceeds without the authoritative unique index', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  });
  await withoutAuthoritativeUnique(async () => {
    assert.ok(!(await indexNames()).includes(AUTH_NAME));
    const released = await releaseUnitNights({ bookingId });
    assert.equal(released.ok, true);
    assert.equal(released.deletedCount, 3);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
  });
});

test('I6#4 scoped release by nights works without the unique index', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  });
  await withoutAuthoritativeUnique(async () => {
    const released = await releaseUnitNights({
      bookingId,
      unitId: unitA._id,
      nights: ['2027-05-11']
    });
    assert.equal(released.deletedCount, 1);
    assert.deepEqual(await ownedDateOnlys(bookingId), ['2027-05-10', '2027-05-12']);
  });
});

test('I6#4 read-only ownership assertion works without the unique index', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11'],
    source: 'finalize'
  });
  await withoutAuthoritativeUnique(async () => {
    const owned = await assertBookingOwnsNights({
      bookingId,
      unitId: unitA._id,
      nights: ['2027-05-10', '2027-05-11'],
      mode: 'exact'
    });
    assert.equal(owned.ok, true);
  });
});

test('I6#4 transfer without the unique index fails and leaves source intact', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  await withoutAuthoritativeUnique(async () => {
    await assert.rejects(
      () =>
        transferUnitNightClaims({
          bookingId,
          fromUnitId: unitA._id,
          toUnitId: unitB._id,
          checkIn,
          checkOut,
          source: 'reallocate'
        }),
      (err) => err.code === ERR.INDEX_MISSING
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 2);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 0);
  });
});

// ===========================================================================
// Clause 5 — one canonical claim API
// ===========================================================================

test('I6#5 empty unit-nights acquire cleanly', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  });
  assert.equal(result.ok, true);
  assert.equal(result.insertedCount, 3);
  assert.equal(result.alreadyOwnedCount, 0);
  assert.deepEqual(result.nights, ['2027-05-10', '2027-05-11', '2027-05-12']);
});

test('I6#5 same-booking replay is idempotent', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const args = {
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  };
  await claimUnitNights(args);
  const replay = await claimUnitNights(args);
  assert.equal(replay.insertedCount, 0);
  assert.equal(replay.alreadyOwnedCount, 3);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 3);
});

test('I6#5 partial ownership fills only the missing nights', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-11'], source: 'finalize' });
  const filled = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  });
  assert.equal(filled.insertedCount, 2);
  assert.equal(filled.alreadyOwnedCount, 1);
  assert.deepEqual(filled.insertedNightsThisAttempt.sort(), ['2027-05-10', '2027-05-12']);
});

test('I6#5 foreign pre-read produces a structured conflict', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-11'], source: 'finalize' });
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: challenger,
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-13'),
        source: 'finalize'
      }),
    (err) => {
      assert.equal(err.code, ERR.FOREIGN_OWNER);
      assert.equal(err.details.unitId, String(unitA._id));
      assert.equal(err.details.night, '2027-05-11');
      assert.equal(err.details.requestedBookingId, String(challenger));
      assert.equal(err.details.existingBookingId, String(owner));
      return true;
    }
  );
});

test('I6#5 structured conflict lists every contested night', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: owner,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-12'],
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-13'),
        source: 'finalize'
      }),
    (err) => {
      assert.equal(err.details.conflicts.length, 2);
      assert.deepEqual(err.details.conflicts.map((c) => c.night).sort(), ['2027-05-10', '2027-05-12']);
      assert.ok(err.details.conflicts.every((c) => c.claimId));
      return true;
    }
  );
});

test('I6#5 structured conflict carries no guest PII', async () => {
  const { cabinType, unitA } = await seedInventory();
  const holder = await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    email: 'i6-conflict-secret@example.com'
  });
  await claimUnitNights({
    bookingId: holder._id,
    unitId: unitA._id,
    nights: ['2027-05-10'],
    source: 'finalize'
  });
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: unitA._id,
        nights: ['2027-05-10'],
        source: 'finalize'
      }),
    (err) => {
      const blob = JSON.stringify(err.details);
      assert.doesNotMatch(blob, /i6-conflict-secret@example\.com/);
      assert.doesNotMatch(blob, /firstName/);
      return true;
    }
  );
});

test('I6#5 foreign conflict inserts nothing for the challenger', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-12'], source: 'finalize' });
  await assert.rejects(() =>
    claimUnitNights({
      bookingId: challenger,
      unitId: unitA._id,
      checkIn: sofiaDay('2027-05-10'),
      checkOut: sofiaDay('2027-05-13'),
      source: 'finalize'
    })
  );
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: challenger }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: owner }), 1);
});

test('I6#5 claim persists the requested source', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'location_child' });
  const row = await UnitNightClaim.findOne({ bookingId }).lean();
  assert.equal(row.source, 'location_child');
});

test('I6#5 claim persists stayChangeId when supplied', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const stayChangeId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10'],
    stayChangeId,
    source: 'reallocate'
  });
  const row = await UnitNightClaim.findOne({ bookingId }).lean();
  assert.equal(String(row.stayChangeId), String(stayChangeId));
});

test('I6#5 claim defaults stayChangeId to null', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  const row = await UnitNightClaim.findOne({ bookingId }).lean();
  assert.equal(row.stayChangeId, null);
});

test('I6#5 claim validation rejects a missing bookingId', async () => {
  const { unitA } = await seedInventory();
  await assert.rejects(
    () => claimUnitNights({ unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' }),
    (err) => err.code === ERR.VALIDATION && err.details.field === 'bookingId'
  );
});

test('I6#5 claim validation rejects an invalid unitId', async () => {
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: 'not-an-objectid',
        nights: ['2027-05-10'],
        source: 'finalize'
      }),
    (err) => err.code === ERR.VALIDATION && err.details.field === 'unitId'
  );
});

test('I6#5 claim validation rejects a same-day stay', async () => {
  const { unitA } = await seedInventory();
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-10'),
        source: 'finalize'
      }),
    (err) => err.code === ERR.VALIDATION && err.details.reason === 'same_day_or_inverted'
  );
});

test('I6#5 claim validation rejects an inverted stay', async () => {
  const { unitA } = await seedInventory();
  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-13'),
        checkOut: sofiaDay('2027-05-10'),
        source: 'finalize'
      }),
    (err) => err.code === ERR.VALIDATION
  );
});

test('I6#5 claim validation rejects a missing range and missing nights', async () => {
  const { unitA } = await seedInventory();
  await assert.rejects(
    () => claimUnitNights({ bookingId: new mongoose.Types.ObjectId(), unitId: unitA._id, source: 'finalize' }),
    (err) => err.code === ERR.VALIDATION
  );
});

test('I6#5 nights may be supplied as Sofia date-only strings', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11'],
    source: 'finalize'
  });
  assert.deepEqual(result.nights, ['2027-05-10', '2027-05-11']);
});

test('I6#5 nights may be supplied as Date instants', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: [new Date('2027-05-10T12:00:00.000Z')],
    source: 'finalize'
  });
  assert.deepEqual(result.nights, ['2027-05-10']);
});

test('I6#5 claim result echoes the persisted claim rows', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11'],
    source: 'finalize'
  });
  assert.equal(result.claims.length, 2);
  assert.deepEqual(result.claims.map((c) => c.night).sort(), ['2027-05-10', '2027-05-11']);
  assert.ok(result.claims.every((c) => c.source === 'finalize'));
});

test('I6#1 checkout night is never claimed', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-12'),
    source: 'finalize'
  });
  const owned = await ownedDateOnlys(bookingId);
  assert.deepEqual(owned, ['2027-05-10', '2027-05-11']);
  assert.ok(!owned.includes('2027-05-12'));
});

test('I6#1 a one-night stay claims exactly the check-in night', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-11'),
    source: 'finalize'
  });
  assert.deepEqual(result.nights, ['2027-05-10']);
});

test('I6#1 back-to-back stays on one unit never contend for the turnover night', async () => {
  const { unitA } = await seedInventory();
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: first,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-12'),
    source: 'finalize'
  });
  const next = await claimUnitNights({
    bookingId: second,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-12'),
    checkOut: sofiaDay('2027-05-14'),
    source: 'finalize'
  });
  assert.equal(next.insertedCount, 2);
  assert.deepEqual(await ownedDateOnlys(second), ['2027-05-12', '2027-05-13']);
});

// ===========================================================================
// Clause 6 — all-or-nothing acquisition, E11000 normalization, compensation
// ===========================================================================

test('I6#6 concurrent E11000 race normalizes to the same structured conflict', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-12'], source: 'finalize' });
  const restore = hideFirstClaimPreRead();
  try {
    await assert.rejects(
      () =>
        claimUnitNights({
          bookingId: challenger,
          unitId: unitA._id,
          checkIn: sofiaDay('2027-05-10'),
          checkOut: sofiaDay('2027-05-13'),
          source: 'finalize'
        }),
      (err) => {
        assert.equal(err.code, ERR.FOREIGN_OWNER);
        assert.equal(err.details.existingBookingId, String(owner));
        assert.equal(err.details.night, '2027-05-12');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('I6#6 E11000 race compensates every insert from the failed attempt', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-12'], source: 'finalize' });
  const restore = hideFirstClaimPreRead();
  try {
    await assert.rejects(() =>
      claimUnitNights({
        bookingId: challenger,
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-13'),
        source: 'finalize'
      })
    );
  } finally {
    restore();
  }
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: challenger }), 0);
});

test('I6#6 E11000 race never steals or deletes the foreign claim', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-12'], source: 'finalize' });
  const restore = hideFirstClaimPreRead();
  try {
    await assert.rejects(() =>
      claimUnitNights({
        bookingId: new mongoose.Types.ObjectId(),
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-13'),
        source: 'finalize'
      })
    );
  } finally {
    restore();
  }
  const row = await UnitNightClaim.findOne({ bookingId: owner }).lean();
  assert.ok(row);
  assert.equal(formatSofiaDateOnly(row.night), '2027-05-12');
});

test('I6#6 raw E11000 never escapes the claim API', async () => {
  const { unitA } = await seedInventory();
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitA._id,
    nights: ['2027-05-12'],
    source: 'finalize'
  });
  const restore = hideFirstClaimPreRead();
  try {
    await assert.rejects(
      () =>
        claimUnitNights({
          bookingId: new mongoose.Types.ObjectId(),
          unitId: unitA._id,
          checkIn: sofiaDay('2027-05-10'),
          checkOut: sofiaDay('2027-05-13'),
          source: 'finalize'
        }),
      (err) => {
        assert.notEqual(err.code, 11000);
        assert.equal(err.code, ERR.FOREIGN_OWNER);
        assert.doesNotMatch(String(err.message), /E11000/);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('I6#6 failed attempt preserves pre-existing same-booking claims', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitA._id,
    nights: ['2027-05-12'],
    source: 'finalize'
  });
  const restore = hideFirstClaimPreRead();
  try {
    await assert.rejects(() =>
      claimUnitNights({
        bookingId,
        unitId: unitA._id,
        checkIn: sofiaDay('2027-05-10'),
        checkOut: sofiaDay('2027-05-13'),
        source: 'finalize'
      })
    );
  } finally {
    restore();
  }
  assert.deepEqual(await ownedDateOnlys(bookingId), ['2027-05-10']);
});

test('I6#6 compensation failure surfaces COMPENSATION_FAILED with night evidence', async () => {
  const { unitA } = await seedInventory();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitA._id,
    nights: ['2027-05-12'],
    source: 'finalize'
  });
  const restore = hideFirstClaimPreRead();
  const originalDeleteMany = UnitNightClaim.deleteMany;
  UnitNightClaim.deleteMany = async () => {
    throw new Error('compensate boom');
  };
  try {
    await assert.rejects(
      () =>
        claimUnitNights({
          bookingId: challenger,
          unitId: unitA._id,
          checkIn: sofiaDay('2027-05-10'),
          checkOut: sofiaDay('2027-05-13'),
          source: 'finalize'
        }),
      (err) => {
        assert.equal(err.code, ERR.COMPENSATION_FAILED);
        assert.ok(err.details.nights.includes('2027-05-10'));
        assert.match(String(err.details.cause), /compensate boom/);
        return true;
      }
    );
  } finally {
    UnitNightClaim.deleteMany = originalDeleteMany;
    restore();
  }
  // Stale rows are conservative and remain visible to reconciliation.
  assert.ok((await UnitNightClaim.countDocuments({ bookingId: challenger })) >= 1);
});

test('I6#6 compensateClaimAttempt deletes only this attempt inserts', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11'],
    source: 'finalize'
  });
  const result = await compensateClaimAttempt({
    bookingId,
    unitId: unitA._id,
    insertedNightsThisAttempt: ['2027-05-11']
  });
  assert.equal(result.ok, true);
  assert.equal(result.deletedCount, 1);
  assert.deepEqual(await ownedDateOnlys(bookingId), ['2027-05-10']);
});

test('I6#6 compensateClaimAttempt falls back to the nights argument', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11'],
    source: 'finalize'
  });
  const result = await compensateClaimAttempt({
    bookingId,
    unitId: unitA._id,
    nights: ['2027-05-10', '2027-05-11']
  });
  assert.equal(result.deletedCount, 2);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
});

test('I6#6 compensateClaimAttempt is a no-op with no nights', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  const result = await compensateClaimAttempt({ bookingId, unitId: unitA._id });
  assert.equal(result.deletedCount, 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 1);
});

test('I6#6 compensateClaimAttempt never deletes a foreign booking claim', async () => {
  const { unitA } = await seedInventory();
  const owner = new mongoose.Types.ObjectId();
  const other = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: owner, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  const result = await compensateClaimAttempt({
    bookingId: other,
    unitId: unitA._id,
    insertedNightsThisAttempt: ['2027-05-10']
  });
  assert.equal(result.deletedCount, 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: owner }), 1);
});

test('I6#6 compensateClaimAttempt is scoped to the attempted unit', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await claimUnitNights({ bookingId, unitId: unitB._id, nights: ['2027-05-10'], source: 'finalize' });
  await compensateClaimAttempt({
    bookingId,
    unitId: unitB._id,
    insertedNightsThisAttempt: ['2027-05-10']
  });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 1);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 0);
});

test('I6#6 compensateClaimAttempt validates its identifiers', async () => {
  await assert.rejects(
    () => compensateClaimAttempt({ bookingId: 'nope', unitId: new mongoose.Types.ObjectId() }),
    (err) => err.code === ERR.VALIDATION
  );
});

test('I6#5 duplicate-key detection classifies driver errors', () => {
  assert.equal(isDuplicateKeyError({ code: 11000 }), true);
  assert.equal(isDuplicateKeyError({ code: 11001 }), true);
  assert.equal(isDuplicateKeyError(new Error('E11000 duplicate key error collection')), true);
  assert.equal(isDuplicateKeyError({ message: 'duplicate key' }), true);
});

test('I6#5 duplicate-key detection ignores unrelated errors', () => {
  assert.equal(isDuplicateKeyError(null), false);
  assert.equal(isDuplicateKeyError(undefined), false);
  assert.equal(isDuplicateKeyError(new Error('network timeout')), false);
  assert.equal(isDuplicateKeyError({ code: 'SOME_OTHER' }), false);
});

// ===========================================================================
// Clause 13 — release semantics
// ===========================================================================

test('I6#13 release removes every claim for the booking', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-13'),
    source: 'finalize'
  });
  const released = await releaseUnitNights({ bookingId });
  assert.equal(released.deletedCount, 3);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
});

test('I6#13 release is idempotent', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await releaseUnitNights({ bookingId });
  const again = await releaseUnitNights({ bookingId });
  assert.equal(again.deletedCount, 0);
  assert.equal(again.ok, true);
});

test('I6#13 release can be scoped to one unit', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await claimUnitNights({ bookingId, unitId: unitB._id, nights: ['2027-05-10'], source: 'finalize' });
  const released = await releaseUnitNights({ bookingId, unitId: unitA._id });
  assert.equal(released.deletedCount, 1);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 1);
});

test('I6#13 release can be scoped to a stay range', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-14'),
    source: 'finalize'
  });
  const released = await releaseUnitNights({
    bookingId,
    checkIn: sofiaDay('2027-05-10'),
    checkOut: sofiaDay('2027-05-12')
  });
  assert.equal(released.deletedCount, 2);
  assert.deepEqual(await ownedDateOnlys(bookingId), ['2027-05-12', '2027-05-13']);
});

test('I6#13 release never touches another booking', async () => {
  const { unitA, unitB } = await seedInventory();
  const mine = new mongoose.Types.ObjectId();
  const theirs = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: mine, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await claimUnitNights({ bookingId: theirs, unitId: unitB._id, nights: ['2027-05-10'], source: 'finalize' });
  await releaseUnitNights({ bookingId: mine });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: theirs }), 1);
});

test('I6#13 release validates the bookingId', async () => {
  await assert.rejects(
    () => releaseUnitNights({ bookingId: 'bad-id' }),
    (err) => err.code === ERR.VALIDATION && err.details.field === 'bookingId'
  );
});

test('I6#13 released nights become immediately acquirable by another booking', async () => {
  const { unitA } = await seedInventory();
  const first = new mongoose.Types.ObjectId();
  const second = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId: first, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  await releaseUnitNights({ bookingId: first });
  const result = await claimUnitNights({
    bookingId: second,
    unitId: unitA._id,
    nights: ['2027-05-10'],
    source: 'finalize'
  });
  assert.equal(result.insertedCount, 1);
});

// ===========================================================================
// Clause 12 — hardened transfer primitive (no production route wires it in I6)
// ===========================================================================

test('I6#12 same-unit transfer is a no-op', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-13');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  const result = await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitA._id,
    checkIn,
    checkOut,
    source: 'reallocate'
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 3);
});

test('I6#12 transfer secures the target then releases the source', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  const result = await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitB._id,
    checkIn,
    checkOut,
    source: 'reallocate'
  });
  assert.equal(result.changed, true);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 2);
});

test('I6#12 unsecurable target rejects with TRANSFER_TARGET_FAILED', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const blocker = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  await claimUnitNights({ bookingId: blocker, unitId: unitB._id, nights: ['2027-05-11'], source: 'finalize' });
  await assert.rejects(
    () =>
      transferUnitNightClaims({
        bookingId,
        fromUnitId: unitA._id,
        toUnitId: unitB._id,
        checkIn,
        checkOut,
        source: 'reallocate'
      }),
    (err) => {
      assert.equal(err.code, ERR.TRANSFER_TARGET_FAILED);
      assert.equal(err.details.fromUnitId, String(unitA._id));
      assert.equal(err.details.toUnitId, String(unitB._id));
      return true;
    }
  );
});

test('I6#12 failed transfer never releases the source claims', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitB._id,
    nights: ['2027-05-10'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    transferUnitNightClaims({
      bookingId,
      fromUnitId: unitA._id,
      toUnitId: unitB._id,
      checkIn,
      checkOut,
      source: 'reallocate'
    })
  );
  assert.deepEqual(await ownedDateOnlys(bookingId), ['2027-05-10', '2027-05-11']);
});

test('I6#12 failed transfer leaves no partial target claims', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-13');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  await claimUnitNights({
    bookingId: new mongoose.Types.ObjectId(),
    unitId: unitB._id,
    nights: ['2027-05-12'],
    source: 'finalize'
  });
  await assert.rejects(() =>
    transferUnitNightClaims({
      bookingId,
      fromUnitId: unitA._id,
      toUnitId: unitB._id,
      checkIn,
      checkOut,
      source: 'reallocate'
    })
  );
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 0);
});

test('I6#12 transfer replay after success is idempotent', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  const args = {
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitB._id,
    checkIn,
    checkOut,
    source: 'reallocate'
  };
  await transferUnitNightClaims(args);
  const replay = await transferUnitNightClaims(args);
  assert.equal(replay.ok, true);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 2);
});

test('I6#12 transfer records the reallocate source on target claims', async () => {
  const { unitA, unitB } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2027-05-10');
  const checkOut = sofiaDay('2027-05-12');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'finalize' });
  await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitB._id,
    checkIn,
    checkOut
  });
  const rows = await UnitNightClaim.find({ bookingId, unitId: unitB._id }).lean();
  assert.ok(rows.every((r) => r.source === 'reallocate'));
});

test('I6#12 transfer validates its unit identifiers', async () => {
  await assert.rejects(
    () =>
      transferUnitNightClaims({
        bookingId: new mongoose.Types.ObjectId(),
        fromUnitId: 'bad',
        toUnitId: new mongoose.Types.ObjectId(),
        nights: ['2027-05-10']
      }),
    (err) => err.code === ERR.VALIDATION && err.details.field === 'fromUnitId'
  );
});

// ===========================================================================
// Clause 15 — pooled cabinType commercial capacity
// ===========================================================================

const CAP_IN = sofiaDay('2027-06-10');
const CAP_OUT = sofiaDay('2027-06-12');

test('I6#15 three free units expose three commercial slots', async () => {
  const { cabinType } = await seedInventory({ units: 3 });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.totalUnits, 3);
  assert.equal(capacity.commerciallyAvailableSlots, 3);
  assert.equal(capacity.commerciallyFull, false);
  assert.equal(capacity.unallocatedCount, 0);
});

test('I6#15 two allocated plus one unallocated is commercially full', async () => {
  const { cabinType, unitA, unitB } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.allocatedUnitIds.length, 2);
  assert.equal(capacity.unallocatedCount, 1);
  assert.equal(capacity.freePhysicalUnitIds.length, 1);
  assert.equal(capacity.commerciallyAvailableSlots, 0);
  assert.equal(capacity.commerciallyFull, true);
});

test('I6#15 assignUnit returns null when 2 allocated + 1 unallocated consume the pool', async () => {
  const { cabinType, unitA, unitB } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  const assigned = await assignUnit(cabinType._id, CAP_IN, CAP_OUT);
  assert.equal(assigned, null);
});

test('I6#15 assignUnit still returns the third unit when only two are allocated', async () => {
  const { cabinType, unitA, unitB, unitC } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  const assigned = await assignUnit(cabinType._id, CAP_IN, CAP_OUT);
  assert.ok(assigned);
  assert.equal(String(assigned._id), String(unitC._id));
});

test('I6#15 three unallocated bookings exhaust a three-unit pool', async () => {
  const { cabinType } = await seedInventory({ units: 3 });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  }
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyFull, true);
  assert.equal(await assignUnit(cabinType._id, CAP_IN, CAP_OUT), null);
});

test('I6#15 one allocated plus one unallocated leaves one slot in a three-unit pool', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 1);
  assert.ok(await assignUnit(cabinType._id, CAP_IN, CAP_OUT));
});

test('I6#15 unallocated overload clamps available slots at zero', async () => {
  const { cabinType } = await seedInventory({ units: 3 });
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  }
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.unallocatedCount, 5);
  assert.equal(capacity.commerciallyAvailableSlots, 0);
});

test('I6#15 terminal bookings consume no commercial capacity', async () => {
  const { cabinType, unitA, unitB } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    status: 'cancelled',
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitB._id,
    status: 'completed',
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, status: 'cancelled', checkIn: CAP_IN, checkOut: CAP_OUT });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
  assert.equal(capacity.unallocatedCount, 0);
});

test('I6#15 pending and in_house bookings do consume capacity', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    status: 'pending',
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: null,
    status: 'in_house',
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 1);
});

test('I6#15 isTest bookings consume no commercial capacity', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    isTest: true,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
});

test('I6#15 archived bookings consume no commercial capacity', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    archivedAt: new Date(),
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
});

test('I6#15 non-overlapping bookings consume no commercial capacity', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-07-01'),
    checkOut: sofiaDay('2027-07-03')
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
});

test('I6#15 turnover-day adjacency consumes no commercial capacity', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2027-06-08'),
    checkOut: CAP_IN
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
  assert.equal(capacity.allocatedUnitIds.length, 0);
});

test('I6#15 excludeBookingId frees the excluded booking slot', async () => {
  const { cabinType, unitA, unitB } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  const self = await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const withSelf = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const withoutSelf = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT,
    excludeBookingId: self._id
  });
  assert.equal(withSelf.commerciallyAvailableSlots, 0);
  assert.equal(withoutSelf.commerciallyAvailableSlots, 1);
});

test('I6#15 excludeUnitId marks that unit as consumed', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT,
    excludeUnitId: unitA._id
  });
  assert.equal(capacity.commerciallyAvailableSlots, 2);
  assert.ok(!capacity.freePhysicalUnitIds.includes(String(unitA._id)));
});

test('I6#15 UnitNightClaim rows are never converted into commercial capacity', async () => {
  const { cabinType, unitA, unitB, unitC } = await seedInventory({ units: 3 });
  for (const unit of [unitA, unitB, unitC]) {
    // eslint-disable-next-line no-await-in-loop
    await claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unit._id,
      checkIn: CAP_IN,
      checkOut: CAP_OUT,
      source: 'finalize'
    });
  }
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
  assert.equal(capacity.commerciallyFull, false);
});

test('I6#15 bookings on another cabinType do not consume this pool', async () => {
  const mine = await seedInventory({ units: 3 });
  const other = await seedInventory({ units: 1 });
  await makeBooking({
    cabinTypeId: other.cabinType._id,
    unitId: other.unitA._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: mine.cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.commerciallyAvailableSlots, 3);
});

test('I6#15 an allocated booking pointing at a foreign unit is not counted', async () => {
  const mine = await seedInventory({ units: 3 });
  const other = await seedInventory({ units: 1 });
  await makeBooking({
    cabinTypeId: mine.cabinType._id,
    unitId: other.unitA._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: mine.cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.allocatedUnitIds.length, 0);
  assert.equal(capacity.commerciallyAvailableSlots, 3);
});

test('I6#15 inactive units are excluded from the pool', async () => {
  const { cabinType } = await seedInventory({ units: 3, inactiveIndexes: [2] });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.totalUnits, 2);
  assert.equal(capacity.commerciallyAvailableSlots, 2);
});

test('I6#15 an empty pool is not reported as commercially full', async () => {
  const { cabinType } = await seedInventory({ units: 0 });
  const capacity = await evaluateCabinTypeCommercialCapacity({
    cabinTypeId: cabinType._id,
    checkIn: CAP_IN,
    checkOut: CAP_OUT
  });
  assert.equal(capacity.totalUnits, 0);
  assert.equal(capacity.commerciallyFull, false);
});

test('I6#15 capacity evaluation requires a cabinTypeId', async () => {
  await assert.rejects(
    () => evaluateCabinTypeCommercialCapacity({ checkIn: CAP_IN, checkOut: CAP_OUT }),
    /cabinTypeId is required/
  );
});

test('I6#15 isUnitCommerciallyAssignable is false for the last free unit when pooled-full', async () => {
  const { cabinType, unitA, unitB, unitC } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  assert.equal(
    await isUnitCommerciallyAssignable({
      unitId: unitC._id,
      cabinTypeId: cabinType._id,
      checkIn: CAP_IN,
      checkOut: CAP_OUT
    }),
    false
  );
});

test('I6#15 isUnitCommerciallyAssignable is false for an already allocated unit', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  assert.equal(
    await isUnitCommerciallyAssignable({
      unitId: unitA._id,
      cabinTypeId: cabinType._id,
      checkIn: CAP_IN,
      checkOut: CAP_OUT
    }),
    false
  );
});

test('I6#16 isUnitGuestStayAvailable is false for the free unit when pooled-full', async () => {
  const { cabinType, unitA, unitB, unitC } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  assert.equal(
    await isUnitGuestStayAvailable(unitC._id, cabinType._id, CAP_IN, CAP_OUT),
    false
  );
});

test('I6#16 isUnitGuestStayAvailable stays true while slots remain', async () => {
  const { cabinType, unitA, unitC } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  assert.equal(await isUnitGuestStayAvailable(unitC._id, cabinType._id, CAP_IN, CAP_OUT), true);
});

test('I6#16 isUnitGuestStayAvailable rejects a cabinType mismatch', async () => {
  const mine = await seedInventory({ units: 1 });
  const other = await seedInventory({ units: 1 });
  assert.equal(
    await isUnitGuestStayAvailable(other.unitA._id, mine.cabinType._id, CAP_IN, CAP_OUT),
    false
  );
});

test('I6#16 availability summary marks every unit unavailable when pooled-full', async () => {
  const { cabinType, unitA, unitB } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitB._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: null, checkIn: CAP_IN, checkOut: CAP_OUT });
  const summary = await getAvailabilitySummary(cabinType._id, CAP_IN, CAP_OUT);
  assert.equal(summary.totalUnits, 3);
  assert.equal(summary.availableUnits.length, 0);
  assert.equal(summary.unavailableUnits.length, 3);
});

test('I6#16 availability summary reports the free unit when slots remain', async () => {
  const { cabinType, unitA, unitC } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  const summary = await getAvailabilitySummary(cabinType._id, CAP_IN, CAP_OUT);
  assert.equal(summary.availableUnits.length, 2);
  assert.ok(summary.availableUnits.some((u) => String(u.unitId) === String(unitC._id)));
});

test('I6#16 assignUnit honours excludeUnitId', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 2 });
  const assigned = await assignUnit(cabinType._id, CAP_IN, CAP_OUT, unitA._id);
  assert.ok(assigned);
  assert.notEqual(String(assigned._id), String(unitA._id));
});

test('I6#16 assignUnit returns null for a cabinType with no units', async () => {
  const { cabinType } = await seedInventory({ units: 0 });
  assert.equal(await assignUnit(cabinType._id, CAP_IN, CAP_OUT), null);
});

test('I6#16 selection is read-only and writes no claims', async () => {
  const { cabinType, unitA } = await seedInventory({ units: 3 });
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id, checkIn: CAP_IN, checkOut: CAP_OUT });
  const before = await UnitNightClaim.countDocuments();
  await assignUnit(cabinType._id, CAP_IN, CAP_OUT);
  await getAvailabilitySummary(cabinType._id, CAP_IN, CAP_OUT);
  await isUnitGuestStayAvailable(unitA._id, cabinType._id, CAP_IN, CAP_OUT);
  assert.equal(await UnitNightClaim.countDocuments(), before);
});

// ===========================================================================
// Clause 11 — legacy reassign hard block
// ===========================================================================

test('I6#11 allocated multi-unit reassign is hard-rejected', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx()
      }),
    (err) => {
      assert.equal(err.type, 'conflict');
      assert.equal(err.status, 409);
      assert.equal(err.details.code, 'LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY');
      return true;
    }
  );
});

test('I6#11 unallocated cabinType reassign is hard-rejected', async () => {
  const { cabinType } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: null });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx()
      }),
    (err) => err.details.code === 'LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY'
  );
});

test('I6#11 rejection reports the offending inventory identity without PII', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    email: 'i6-reassign-secret@example.com'
  });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx()
      }),
    (err) => {
      assert.equal(err.details.cabinTypeId, String(cabinType._id));
      assert.equal(err.details.unitId, String(unitA._id));
      assert.doesNotMatch(JSON.stringify(err.details), /i6-reassign-secret@example\.com/);
      return true;
    }
  );
});

test('I6#11 unit-allocated record without cabinTypeId is still rejected', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await Booking.updateOne({ _id: booking._id }, { $unset: { cabinTypeId: '' } });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx()
      }),
    (err) => err.details.code === 'LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY' && err.status === 409
  );
});

test('I6#11 mixed cabinId + cabinTypeId identity is rejected with 409', async () => {
  const { cabinType } = await seedInventory();
  const cabin = await Cabin.create({
    name: `I6 Mixed ${Date.now()}`,
    slug: `i6-mixed-${Date.now()}`,
    description: 'mixed',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/mixed.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const booking = await makeBooking({ cabinTypeId: cabinType._id });
  await Booking.updateOne({ _id: booking._id }, { $set: { cabinId: cabin._id } });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: adminCtx()
      }),
    (err) =>
      err.status === 409 &&
      ['LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY', 'LEGACY_REASSIGN_MALFORMED_IDENTITY'].includes(
        err.details.code
      )
  );
});

test('I6#11 rejected reassign leaves claims untouched', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  await assert.rejects(() =>
    reassignReservation({
      bookingId: booking._id,
      toCabinId: new mongoose.Types.ObjectId(),
      ctx: adminCtx()
    })
  );
  assert.deepEqual(await ownedDateOnlys(booking._id), ['2027-05-10', '2027-05-11']);
});

test('I6#11 rejected reassign never mutates the booking or writes an audit event', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await assert.rejects(() =>
    reassignReservation({
      bookingId: booking._id,
      toCabinId: new mongoose.Types.ObjectId(),
      ctx: adminCtx()
    })
  );
  const live = await Booking.findById(booking._id).lean();
  assert.equal(live.cabinId, null);
  assert.equal(String(live.cabinTypeId), String(cabinType._id));
  assert.equal(
    await AuditEvent.countDocuments({ action: 'reservation_reassign', entityId: String(booking._id) }),
    0
  );
});

test('I6#11 reassign requires the admin permission', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: { user: { id: 'op-1', role: 'operator' } }
      }),
    (err) => err.code === 'PERMISSION_DENIED' && err.status === 403
  );
});

test('I6#11 reassign denies cleaner role before touching inventory', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await assert.rejects(
    () =>
      reassignReservation({
        bookingId: booking._id,
        toCabinId: new mongoose.Types.ObjectId(),
        ctx: { user: { id: 'cleaner-1', role: 'cleaner' } }
      }),
    (err) => err.code === 'PERMISSION_DENIED'
  );
});

test('I6#11 reassign validates a missing toCabinId', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await assert.rejects(
    () => reassignReservation({ bookingId: booking._id, toCabinId: null, ctx: adminCtx() }),
    (err) => err.type === 'validation'
  );
});

test('I6#11 single-cabin reassign remains available and claims stay empty', async () => {
  const from = await Cabin.create({
    name: `I6 From ${Date.now()}`,
    slug: `i6-from-${Date.now()}`,
    description: 'from',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/from.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const to = await Cabin.create({
    name: `I6 To ${Date.now()}`,
    slug: `i6-to-${Date.now()}`,
    description: 'to',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/to.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const booking = await makeBooking({ cabinId: from._id });

  const msgPath = require.resolve('../services/messaging/messageOrchestrator');
  const pushPath = require.resolve('../services/ops/push/opsPushScheduleOrchestrator');
  const prevMsg = require.cache[msgPath];
  const prevPush = require.cache[pushPath];
  require.cache[msgPath] = {
    id: msgPath,
    filename: msgPath,
    loaded: true,
    exports: { notifyReservationReassigned: async () => {} }
  };
  require.cache[pushPath] = {
    id: pushPath,
    filename: pushPath,
    loaded: true,
    exports: { notifyOpsPushReservationReassigned: async () => {} }
  };
  try {
    const result = await reassignReservation({
      bookingId: booking._id,
      toCabinId: to._id,
      ctx: adminCtx()
    });
    assert.equal(result.cabinId, String(to._id));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
  } finally {
    if (prevMsg) require.cache[msgPath] = prevMsg;
    else delete require.cache[msgPath];
    if (prevPush) require.cache[pushPath] = prevPush;
    else delete require.cache[pushPath];
  }
});

test('I6#11/#12 reassign path does not wire the transfer primitive', () => {
  const src = fs.readFileSync(RESERVATION_WRITE_SERVICE_PATH, 'utf8');
  assert.ok(src.includes('LEGACY_REASSIGN_NOT_ALLOWED_FOR_MULTI_INVENTORY'));
  assert.ok(!src.includes('transferUnitNightClaims'));
});

// ===========================================================================
// Clause 1 — Sofia night expansion including DST boundaries
// ===========================================================================

test('I6#1 spring-forward stay expands to three Sofia nights', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2027-03-27'), sofiaDay('2027-03-30'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2027-03-27', '2027-03-28', '2027-03-29']);
});

test('I6#1 fall-back stay expands to three Sofia nights', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-10-24'), sofiaDay('2026-10-27'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-10-24', '2026-10-25', '2026-10-26']);
});

test('I6#1 stay-night count is DST-stable across the spring transition', () => {
  const stay = computeStayNights(sofiaDay('2026-03-28'), sofiaDay('2026-03-31'));
  assert.equal(stay.invalid, false);
  assert.equal(stay.nights, 3);
});

test('I6#1 stay-night count is DST-stable across the autumn transition', () => {
  const stay = computeStayNights(sofiaDay('2026-10-24'), sofiaDay('2026-10-27'));
  assert.equal(stay.nights, 3);
});

test('I6#1 claims across a DST transition are distinct Sofia nights', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-03-28'),
    checkOut: sofiaDay('2026-03-31'),
    source: 'finalize'
  });
  const owned = await ownedDateOnlys(bookingId);
  assert.deepEqual(owned, ['2026-03-28', '2026-03-29', '2026-03-30']);
  const rows = await UnitNightClaim.find({ bookingId }).lean();
  assert.equal(new Set(rows.map((r) => r.night.getTime())).size, 3);
});

test('I6#1 DST night round-trips through the night-date helpers', () => {
  for (const dateOnly of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25']) {
    const night = nightDateFromDateOnly(dateOnly);
    assert.equal(dateOnlyFromNightDate(night), dateOnly);
    assert.equal(formatSofiaDateOnly(night), dateOnly);
  }
});

test('I6#1 a DST-crossing claim replay stays idempotent', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const args = {
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-10-24'),
    checkOut: sofiaDay('2026-10-27'),
    source: 'finalize'
  };
  await claimUnitNights(args);
  const replay = await claimUnitNights(args);
  assert.equal(replay.insertedCount, 0);
  assert.equal(replay.alreadyOwnedCount, 3);
});

test('I6#1 rolling Sofia date helper produces contiguous nights', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  const result = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDayFromNow(30),
    checkOut: sofiaDayFromNow(33),
    source: 'finalize'
  });
  assert.deepEqual(result.nights, [sofiaDateOnly(30), sofiaDateOnly(31), sofiaDateOnly(32)]);
});

// ===========================================================================
// Clause 3 — cutover CLI argument parsing
// ===========================================================================

test('I6#3 parseArgs defaults to a read-only verify shape', () => {
  const args = parseArgs([]);
  assert.equal(args.createUniqueIndex, false);
  assert.equal(args.verify, false);
  assert.equal(args.reportJson, null);
  assert.equal(args.batchSize, 200);
  assert.equal(args.limit, null);
  assert.equal(args.bookingId, null);
  assert.equal(args.requireStable, false);
  assert.equal(args.priorFingerprint, null);
});

test('I6#3 parseArgs reads --verify', () => {
  assert.equal(parseArgs(['--verify']).verify, true);
});

test('I6#3 parseArgs reads --create-unique-index', () => {
  assert.equal(parseArgs(['--create-unique-index']).createUniqueIndex, true);
});

test('I6#3 parseArgs reads --require-stable', () => {
  assert.equal(parseArgs(['--require-stable']).requireStable, true);
});

test('I6#3 parseArgs reads --booking-id in both forms', () => {
  assert.equal(parseArgs(['--booking-id', 'abc123']).bookingId, 'abc123');
  assert.equal(parseArgs(['--booking-id=def456']).bookingId, 'def456');
});

test('I6#3 parseArgs reads --report-json in both forms', () => {
  assert.equal(parseArgs(['--report-json', '/tmp/a.json']).reportJson, '/tmp/a.json');
  assert.equal(parseArgs(['--report-json=/tmp/b.json']).reportJson, '/tmp/b.json');
});

test('I6#3 parseArgs reads --batch-size in both forms', () => {
  assert.equal(parseArgs(['--batch-size', '50']).batchSize, 50);
  assert.equal(parseArgs(['--batch-size=75']).batchSize, 75);
});

test('I6#3 parseArgs reads --limit in both forms', () => {
  assert.equal(parseArgs(['--limit', '9']).limit, 9);
  assert.equal(parseArgs(['--limit=11']).limit, 11);
});

test('I6#3 parseArgs reads --prior-fingerprint in both forms', () => {
  assert.equal(parseArgs(['--prior-fingerprint', 'fp-1']).priorFingerprint, 'fp-1');
  assert.equal(parseArgs(['--prior-fingerprint=fp-2']).priorFingerprint, 'fp-2');
});

test('I6#3 parseArgs reads --mongo=', () => {
  assert.equal(parseArgs(['--mongo=mongodb://127.0.0.1:27017/x']).mongoUri, 'mongodb://127.0.0.1:27017/x');
});

test('I6#3 parseArgs ignores unknown flags', () => {
  const args = parseArgs(['--nope', '--verify']);
  assert.equal(args.verify, true);
  assert.equal(args.createUniqueIndex, false);
});

test('I6#3 parseArgs exposes no drop/replace index switches', () => {
  const args = parseArgs(['--drop-legacy', '--replace-legacy-compound-index']);
  assert.equal(Object.prototype.hasOwnProperty.call(args, 'dropLegacy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(args, 'replaceLegacyCompoundIndex'), false);
});

test('I6#3 cutover CLI source never drops or syncs indexes', () => {
  const src = fs.readFileSync(path.join(__dirname, 'unitNightClaimI6Cutover.js'), 'utf8');
  assert.doesNotMatch(src, /\.dropIndex\s*\(/);
  assert.doesNotMatch(src, /\.dropIndexes\s*\(/);
  assert.doesNotMatch(src, /\.syncIndexes\s*\(/);
  assert.doesNotMatch(src, /\.createIndexes\s*\(/);
});

// ===========================================================================
// Clause 3 — cutover readiness / exit-code helpers
// ===========================================================================

function zeroCounts(overrides = {}) {
  return { ...mapCountsFromI5({ summary: {} }), ...overrides };
}

test('I6#3 mapCountsFromI5 zero-fills a missing summary', () => {
  const counts = mapCountsFromI5(null);
  assert.equal(counts.missing, 0);
  assert.equal(counts.remainingBlockers, 0);
  assert.equal(counts.duplicates, 0);
});

test('I6#3 mapCountsFromI5 maps I5 summary fields', () => {
  const counts = mapCountsFromI5({
    summary: {
      expectedUnitNightClaims: 7,
      actualUnitNightClaimRows: 6,
      missing: 1,
      uniqueIndexDuplicateKeys: 2,
      remainingBlockers: 3
    }
  });
  assert.equal(counts.expected, 7);
  assert.equal(counts.actual, 6);
  assert.equal(counts.missing, 1);
  assert.equal(counts.duplicates, 2);
  assert.equal(counts.remainingBlockers, 3);
});

test('I6#3 readiness is true when the exact unique index already exists', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'partial',
      counts: zeroCounts({ missing: 5 }),
      duplicates: [{}],
      readyForI6: false,
      readyForI6Provisional: false,
      authoritativeUniqueExact: true
    }),
    true
  );
});

test('I6#3 readiness is false for a partial scan', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'partial',
      counts: zeroCounts(),
      duplicates: [],
      readyForI6: true,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 readiness is false for a targeted scan', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'targeted',
      counts: zeroCounts(),
      duplicates: [],
      readyForI6: true,
      readyForI6Provisional: false,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 readiness is true for a clean full scan', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'full',
      counts: zeroCounts(),
      duplicates: [],
      readyForI6: true,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    true
  );
});

test('I6#3 readiness is false when duplicate keys are present', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'full',
      counts: zeroCounts(),
      duplicates: [{ unitId: 'u', night: 'n' }],
      readyForI6: true,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 readiness is false when blockers remain', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'full',
      counts: zeroCounts({ remainingBlockers: 1 }),
      duplicates: [],
      readyForI6: true,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 readiness is false when excluded-booking claims remain', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'full',
      counts: zeroCounts({ claimsForExcludedBooking: 2 }),
      duplicates: [],
      readyForI6: true,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 readiness is false when safe repairs failed', () => {
  assert.equal(
    computeReadyForUniqueIndex({
      scanCompleteness: 'full',
      counts: zeroCounts({ repairFailures: 1 }),
      duplicates: [],
      readyForI6: false,
      readyForI6Provisional: true,
      authoritativeUniqueExact: false
    }),
    false
  );
});

test('I6#3 isAuthoritativeUniqueExact accepts the exact index', () => {
  assert.equal(
    isAuthoritativeUniqueExact({ name: AUTH_NAME, key: { unitId: 1, night: 1 }, unique: true }),
    true
  );
});

test('I6#3 isAuthoritativeUniqueExact rejects non-unique or misnamed indexes', () => {
  assert.equal(isAuthoritativeUniqueExact(null), false);
  assert.equal(isAuthoritativeUniqueExact({ name: AUTH_NAME, key: { unitId: 1, night: 1 } }), false);
  assert.equal(
    isAuthoritativeUniqueExact({ name: LEGACY_NAME, key: { unitId: 1, night: 1 }, unique: true }),
    false
  );
});

test('I6#3 isAuthoritativeUniqueExact rejects a different key order or shape', () => {
  assert.equal(
    isAuthoritativeUniqueExact({ name: AUTH_NAME, key: { night: 1, unitId: 1 }, unique: true }),
    false
  );
  assert.equal(
    isAuthoritativeUniqueExact({ name: AUTH_NAME, key: { unitId: 1 }, unique: true }),
    false
  );
});

test('I6#3 exit code 0 for a ready read-only preflight', () => {
  assert.equal(exitCodeForI6Report({ mode: 'verify', readyForUniqueIndex: true }), 0);
});

test('I6#3 exit code 2 for a non-ready read-only preflight', () => {
  assert.equal(exitCodeForI6Report({ mode: 'verify', readyForUniqueIndex: false }), 2);
});

test('I6#3 exit code 2 for a refusal', () => {
  assert.equal(exitCodeForI6Report({ mode: 'create-unique-index', refused: true }), 2);
});

test('I6#3 exit code 1 for a tool failure', () => {
  assert.equal(exitCodeForI6Report({ mode: 'verify', toolFailure: true }), 1);
  assert.equal(exitCodeForI6Report(null), 1);
});

test('I6#3 exit code 0 for created and already-present index outcomes', () => {
  assert.equal(
    exitCodeForI6Report({ mode: 'create-unique-index', indexCreate: { status: 'created' } }),
    0
  );
  assert.equal(
    exitCodeForI6Report({ mode: 'create-unique-index', indexCreate: { status: 'already-present' } }),
    0
  );
});

test('I6#3 exit code 1 for a failed index creation', () => {
  assert.equal(
    exitCodeForI6Report({ mode: 'create-unique-index', indexCreate: { status: 'failed' } }),
    1
  );
});

// ===========================================================================
// Clause 3 / 22 — cutover CLI behaviour against a live database
// ===========================================================================

test('I6#3 default preflight runs in verify mode', async () => {
  const report = await runCutover([]);
  assert.equal(report.mode, 'verify');
  assert.equal(report.cutoverBatch, 'I6');
  assert.equal(report.refused, false);
  assert.equal(report.indexCreate, null);
});

test('I6#3 read-only preflight writes zero claims and zero review items', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  const claimsBefore = await UnitNightClaim.countDocuments();
  const mriBefore = await ManualReviewItem.countDocuments();
  await runCutover(['--verify']);
  assert.equal(await UnitNightClaim.countDocuments(), claimsBefore);
  assert.equal(await ManualReviewItem.countDocuments(), mriBefore);
});

test('I6#3 read-only preflight reports index metadata', async () => {
  const report = await runCutover(['--verify']);
  assert.equal(report.authoritativeUniquePresent, true);
  assert.equal(report.authoritativeUniqueExact, true);
  assert.deepEqual(report.authoritativeIndexSpec, {
    name: AUTH_NAME,
    keys: { unitId: 1, night: 1 },
    unique: true
  });
  assert.ok(report.existingIndexes.some((ix) => ix.name === AUTH_NAME && ix.unique === true));
});

test('I6#3 read-only preflight reports the legacy compound index presence', async () => {
  const before = await runCutover(['--verify']);
  assert.equal(before.legacyCompoundPresent, false);
  await createLegacyNonUnique();
  const after = await runCutover(['--verify']);
  assert.equal(after.legacyCompoundPresent, true);
  assert.equal(after.authoritativeUniqueExact, true);
});

test('I6#3 read-only preflight never creates the index when it is absent', async () => {
  await withoutAuthoritativeUnique(async () => {
    const report = await runCutover(['--verify']);
    assert.equal(report.authoritativeUniqueExact, false);
    assert.equal(report.indexCreate, null);
    assert.ok(!(await indexNames()).includes(AUTH_NAME));
  });
});

test('I6#3 read-only preflight surfaces mongo/git provenance and I5 summary', async () => {
  const report = await runCutover(['--verify']);
  assert.ok(report.mongoServerVersion === null || typeof report.mongoServerVersion === 'string');
  assert.ok(report.gitSha === null || typeof report.gitSha === 'string');
  assert.ok(report.i5 && report.i5.summary);
  assert.equal(report.i5.mode, 'verify');
});

test('I6#3 preflight report contains no guest PII', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    email: 'i6-preflight-secret@example.com'
  });
  const report = await runCutover(['--verify']);
  const blob = JSON.stringify(report);
  assert.doesNotMatch(blob, /i6-preflight-secret@example\.com/);
  assert.doesNotMatch(blob, /"firstName"/);
});

test('I6#3 partial verify scan is never ready for the unique index', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await withoutAuthoritativeUnique(async () => {
    const report = await runCutover(['--verify', '--limit', '1']);
    assert.equal(report.scanCompleteness, 'partial');
    assert.equal(report.readyForUniqueIndex, false);
    assert.equal(exitCodeForI6Report(report), 2);
  });
});

test('I6#3 --report-json writes the report to disk', async () => {
  const target = path.join(os.tmpdir(), `i6-cutover-${Date.now()}-${process.pid}.json`);
  try {
    const report = await runCutover([`--report-json=${target}`]);
    const onDisk = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(onDisk.mode, report.mode);
    assert.equal(onDisk.cutoverBatch, 'I6');
  } finally {
    fs.rmSync(target, { force: true });
  }
});

test('I6#3 --create-unique-index is idempotent when the exact unique index exists', async () => {
  const report = await runCutover(['--create-unique-index']);
  assert.equal(report.mode, 'create-unique-index');
  assert.equal(report.indexCreate.status, 'already-present');
  assert.equal(report.indexCreate.mutated, false);
  assert.equal(report.indexCreate.name, AUTH_NAME);
  assert.equal(report.readyForUniqueIndex, true);
  assert.equal(report.refused, false);
  assert.equal(exitCodeForI6Report(report), 0);
});

test('I6#3 repeated --create-unique-index runs stay already-present', async () => {
  await runCutover(['--create-unique-index']);
  const second = await runCutover(['--create-unique-index']);
  assert.equal(second.indexCreate.status, 'already-present');
  assert.equal((await indexNames()).filter((n) => n === AUTH_NAME).length, 1);
});

test('I6#3 idempotent create path does not mutate claims', async () => {
  const { unitA } = await seedInventory();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({ bookingId, unitId: unitA._id, nights: ['2027-05-10'], source: 'finalize' });
  const before = await UnitNightClaim.countDocuments();
  await runCutover(['--create-unique-index']);
  assert.equal(await UnitNightClaim.countDocuments(), before);
});

test('I6#3 --create-unique-index creates the exact named unique index on a clean scan', async () => {
  await withoutAuthoritativeUnique(async () => {
    assert.ok(!(await indexNames()).includes(AUTH_NAME));
    const report = await runCutover(['--create-unique-index']);
    assert.equal(report.refused, false);
    assert.equal(report.indexCreate.status, 'created');
    assert.equal(report.indexCreate.mutated, true);
    assert.equal(report.authoritativeUniqueExact, true);
    assert.equal(exitCodeForI6Report(report), 0);
    const created = (await indexList()).find((ix) => ix.name === AUTH_NAME);
    assert.equal(created.unique, true);
    assert.deepEqual(created.key, { unitId: 1, night: 1 });
  });
});

test('I6#3 --create-unique-index never drops the legacy compound index', async () => {
  await createLegacyNonUnique();
  await withoutAuthoritativeUnique(async () => {
    const report = await runCutover(['--create-unique-index']);
    assert.equal(report.indexCreate.status, 'created');
    assert.equal(report.legacyCompoundPresent, true);
    assert.ok((await indexNames()).includes(LEGACY_NAME));
  });
});

test('I6#3 --create-unique-index refuses while duplicate unit-nights exist', async () => {
  const { unitA } = await seedInventory();
  await withoutAuthoritativeUnique(async () => {
    const night = sofiaDay('2027-05-10');
    await UnitNightClaim.create({
      unitId: unitA._id,
      night,
      bookingId: new mongoose.Types.ObjectId(),
      source: 'bootstrap'
    });
    await UnitNightClaim.create({
      unitId: unitA._id,
      night,
      bookingId: new mongoose.Types.ObjectId(),
      source: 'bootstrap'
    });
    const report = await runCutover(['--create-unique-index']);
    assert.equal(report.refused, true);
    assert.ok(report.duplicates.length >= 1);
    assert.equal(report.indexCreate, null);
    assert.ok(!(await indexNames()).includes(AUTH_NAME));
    assert.equal(exitCodeForI6Report(report), 2);
    await UnitNightClaim.deleteMany({});
  });
});

test('I6#3 --create-unique-index refuses while drift remains', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await withoutAuthoritativeUnique(async () => {
    const report = await runCutover(['--create-unique-index']);
    assert.equal(report.refused, true);
    assert.equal(typeof report.refuseReason, 'string');
    assert.ok(report.refuseReason.length > 0);
    assert.equal(report.readyForUniqueIndex, false);
    assert.equal(report.indexCreate, null);
    assert.ok(!(await indexNames()).includes(AUTH_NAME));
  });
});

test('I6#3 a refused create-unique-index run performs no claim repair', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await withoutAuthoritativeUnique(async () => {
    await runCutover(['--create-unique-index']);
    assert.equal(await UnitNightClaim.countDocuments(), 0);
  });
});

test('I6#3 --create-unique-index with --verify is rejected', async () => {
  const prevExit = process.exitCode;
  try {
    const report = await cutoverMain(['--create-unique-index', '--verify']);
    assert.equal(report, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExit;
  }
});

test('I6#3 --create-unique-index with --limit is rejected', async () => {
  const prevExit = process.exitCode;
  try {
    const report = await cutoverMain(['--create-unique-index', '--limit', '5']);
    assert.equal(report, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExit;
  }
});

test('I6#3 --create-unique-index with --booking-id is rejected', async () => {
  const prevExit = process.exitCode;
  try {
    const report = await cutoverMain([
      '--create-unique-index',
      '--booking-id',
      String(new mongoose.Types.ObjectId())
    ]);
    assert.equal(report, null);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = prevExit;
  }
});

test('I6#3 rejected flag combinations mutate nothing', async () => {
  const before = await indexNames();
  const prevExit = process.exitCode;
  try {
    await cutoverMain(['--create-unique-index', '--verify']);
    await cutoverMain(['--create-unique-index', '--limit', '2']);
  } finally {
    process.exitCode = prevExit;
  }
  assert.deepEqual(await indexNames(), before);
  assert.equal(await UnitNightClaim.countDocuments(), 0);
});

// ===========================================================================
// Clause 19 / 23 — post-cutover posture
// ===========================================================================

test('I6#19 preflight is ready on a clean inventory with claims in place', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    source: 'finalize'
  });
  const report = await runCutover(['--verify']);
  assert.equal(report.scanCompleteness, 'full');
  assert.equal(report.counts.missing, 0);
  assert.equal(report.counts.duplicates, 0);
  assert.equal(report.readyForUniqueIndex, true);
});

test('I6#19 preflight flags an allocated booking with no claims', async () => {
  const { cabinType, unitA } = await seedInventory();
  await makeBooking({ cabinTypeId: cabinType._id, unitId: unitA._id });
  const report = await runCutover(['--verify']);
  assert.ok(report.counts.missing >= 1);
});

test('I6#1 terminal bookings are expected to own zero claims', async () => {
  const { cabinType, unitA } = await seedInventory();
  const booking = await makeBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    status: 'cancelled'
  });
  const report = await runCutover(['--verify']);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
  assert.equal(report.counts.missing, 0);
});

test('I6#23 no shadow claim wrappers remain in the authoritative service surface', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/inventory/unitNightClaimService.js'),
    'utf8'
  );
  assert.ok(src.includes('claimUnitNights'));
  assert.ok(src.includes('assertAuthoritativeUnitNightIndex'));
  assert.ok(!src.includes('ensureUnitNightClaimsShadow'));
  assert.ok(!src.includes('syncUnitNightClaimsShadow'));
});

test('I6#24 the peer I1-I5 suites remain present alongside I6', () => {
  for (const suite of ['i1', 'i2', 'i3', 'i4', 'i5']) {
    assert.ok(fs.existsSync(path.join(__dirname, `unitNightClaim.${suite}.test.cjs`)));
  }
});
