/**
 * Inventory Integrity I1 — UnitNightClaim service + dry-run projection.
 * Run: cd server && node --test scripts/unitNightClaim.i1.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const UnitNightClaim = require('../models/UnitNightClaim');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const {
  claimUnitNights,
  releaseUnitNights,
  transferUnitNightClaims,
  assertBookingOwnsNights,
  ERR,
  expandOccupiedSofiaNightDateOnlys,
  nightDateFromDateOnly
} = require('../services/inventory/unitNightClaimService');
const { expandOccupiedSofiaNightDateOnlys: expandFromStayNights } = require('../services/ops/reporting/stayNights');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');
const {
  projectUnitNightClaimIntegrity,
  buildScanFilter,
  main: integrityDryRunMain
} = require('./unitNightClaimIntegrityDryRun');
const { FIXTURE_BOOKING_EMAIL_PATTERN } = require('../utils/fixtureExclusion');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

async function seedCabinTypeAndUnits() {
  const cabinType = await CabinType.create({
    name: 'I1 Test A-Frames',
    slug: `i1-aframes-${Date.now()}`,
    description: 'UnitNightClaim I1 tests',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i1.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-01',
    displayName: 'A-Frame 1',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-02',
    displayName: 'A-Frame 2',
    isActive: true
  });
  return { cabinType, unitA, unitB };
}

async function createBlockingBooking({
  cabinTypeId,
  unitId,
  checkIn,
  checkOut,
  status = 'confirmed',
  email = 'guest@example.com',
  isTest = false,
  locationBookingId = null
}) {
  const payload = {
    cabinTypeId,
    unitId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status,
    isTest,
    isProductionSafe: false,
    guestInfo: {
      firstName: 'I1',
      lastName: 'Guest',
      email,
      phone: '+359000000000'
    },
    totalPrice: 200,
    tripType: 'retreat',
    romanticSetup: false
  };
  if (locationBookingId) payload.locationBookingId = locationBookingId;
  return Booking.create(payload);
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
    Unit.deleteMany({}),
    CabinType.deleteMany({})
  ]);
});

test('night expansion: Aug20-Aug21 => one night Aug20', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-21'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-08-20']);
  assert.equal(expandFromStayNights(sofiaDay('2026-08-20'), sofiaDay('2026-08-21')).dateOnlys.length, 1);
});

test('night expansion: Aug20-Aug23 => three nights', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-23'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-08-20', '2026-08-21', '2026-08-22']);
});

test('night expansion: checkout day never included', () => {
  const r = expandOccupiedSofiaNightDateOnlys(sofiaDay('2026-08-20'), sofiaDay('2026-08-22'));
  assert.ok(!r.dateOnlys.includes('2026-08-22'));
  assert.deepEqual(r.dateOnlys, ['2026-08-20', '2026-08-21']);
});

test('night expansion: Sofia timezone conversion around UTC midnight', () => {
  // Instant that is still Aug 19 evening UTC may be Aug 20 in Sofia depending on offset;
  // normalize via sofiaDay helpers used for Booking storage.
  const checkIn = sofiaDay('2026-03-28'); // near EU DST spring
  const checkOut = sofiaDay('2026-03-30');
  const r = expandOccupiedSofiaNightDateOnlys(checkIn, checkOut);
  assert.equal(r.ok, true);
  assert.deepEqual(r.dateOnlys, ['2026-03-28', '2026-03-29']);
  assert.equal(formatSofiaDateOnly(nightDateFromDateOnly('2026-03-28')), '2026-03-28');
});

test('claimUnitNights: same booking repeated is idempotent', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-08-20');
  const checkOut = sofiaDay('2026-08-23');

  const first = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn,
    checkOut,
    source: 'test'
  });
  assert.equal(first.insertedCount, 3);
  assert.equal(first.alreadyOwnedCount, 0);

  const second = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn,
    checkOut,
    source: 'test'
  });
  assert.equal(second.insertedCount, 0);
  assert.equal(second.alreadyOwnedCount, 3);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 3);
});

test('claimUnitNights: partial ownership fills missing nights', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2026-08-20'],
    source: 'test'
  });
  const filled = await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-23'),
    source: 'test'
  });
  assert.equal(filled.insertedCount, 2);
  assert.equal(filled.alreadyOwnedCount, 1);
  assert.deepEqual(filled.nights.sort(), ['2026-08-20', '2026-08-21', '2026-08-22']);
});

test('claimUnitNights: foreign owner causes structured conflict without partial silent success', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const owner = new mongoose.Types.ObjectId();
  const challenger = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: owner,
    unitId: unitA._id,
    nights: ['2026-08-21'],
    source: 'test'
  });

  await assert.rejects(
    () =>
      claimUnitNights({
        bookingId: challenger,
        unitId: unitA._id,
        checkIn: sofiaDay('2026-08-20'),
        checkOut: sofiaDay('2026-08-23'),
        source: 'test'
      }),
    (err) => {
      assert.equal(err.code, ERR.FOREIGN_OWNER);
      assert.ok(Array.isArray(err.details.conflicts));
      assert.equal(err.details.conflicts.length, 1);
      assert.equal(err.details.conflicts[0].night, '2026-08-21');
      assert.equal(err.details.conflicts[0].holderBookingId, String(owner));
      return true;
    }
  );

  assert.equal(await UnitNightClaim.countDocuments({ bookingId: challenger }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: owner }), 1);
});

test('releaseUnitNights: deletes only same-booking rows and is idempotent', async () => {
  const { unitA, unitB } = await seedCabinTypeAndUnits();
  const a = new mongoose.Types.ObjectId();
  const b = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId: a,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });
  await claimUnitNights({
    bookingId: b,
    unitId: unitB._id,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-22'),
    source: 'test'
  });

  const released = await releaseUnitNights({ bookingId: a });
  assert.equal(released.deletedCount, 2);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: a }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: b }), 2);

  const again = await releaseUnitNights({ bookingId: a });
  assert.equal(again.deletedCount, 0);
});

test('transferUnitNightClaims: claims target before source release; failed target preserves source', async () => {
  const { unitA, unitB } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  const blocker = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-08-20');
  const checkOut = sofiaDay('2026-08-22');

  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'test' });
  await claimUnitNights({
    bookingId: blocker,
    unitId: unitB._id,
    nights: ['2026-08-20'],
    source: 'test'
  });

  await assert.rejects(
    () =>
      transferUnitNightClaims({
        bookingId,
        fromUnitId: unitA._id,
        toUnitId: unitB._id,
        checkIn,
        checkOut,
        source: 'test'
      }),
    (err) => err.code === ERR.TRANSFER_TARGET_FAILED || err.code === ERR.FOREIGN_OWNER
  );

  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 2);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 0);

  await releaseUnitNights({ bookingId: blocker });
  const ok = await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitB._id,
    checkIn,
    checkOut,
    source: 'test'
  });
  assert.equal(ok.changed, true);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 2);

  const replay = await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitB._id,
    checkIn,
    checkOut,
    source: 'test'
  });
  assert.equal(replay.ok, true);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitB._id }), 2);
});

test('assertBookingOwnsNights: success and mismatch diagnostics', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-08-20');
  const checkOut = sofiaDay('2026-08-23');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'test' });

  const ok = await assertBookingOwnsNights({
    bookingId,
    unitId: unitA._id,
    checkIn,
    checkOut,
    mode: 'exact'
  });
  assert.equal(ok.ok, true);

  await releaseUnitNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2026-08-21']
  });
  const bad = await assertBookingOwnsNights({
    bookingId,
    unitId: unitA._id,
    checkIn,
    checkOut,
    mode: 'exact'
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, ERR.OWNERSHIP_MISMATCH);
  assert.deepEqual(bad.missingNights, ['2026-08-21']);
});

test('dry-run: confirmed / pending allocated / in_house project; unallocated pending and terminal excluded', async () => {
  const { cabinType, unitA, unitB } = await seedCabinTypeAndUnits();
  const checkIn = sofiaDay('2026-09-10');
  const checkOut = sofiaDay('2026-09-12');

  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'confirmed@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitB._id,
    checkIn,
    checkOut,
    status: 'pending',
    email: 'pending-alloc@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut: sofiaDay('2026-09-14'),
    status: 'in_house',
    email: 'inhouse@example.com'
  });
  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn,
    checkOut,
    adults: 1,
    children: 0,
    status: 'pending',
    isTest: false,
    isProductionSafe: false,
    guestInfo: { firstName: 'U', lastName: 'N', email: 'unallocated@example.com', phone: '+1' },
    totalPrice: 0,
    tripType: 'retreat',
    romanticSetup: false
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitB._id,
    checkIn,
    checkOut,
    status: 'cancelled',
    email: 'cancelled@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitB._id,
    checkIn,
    checkOut,
    status: 'completed',
    email: 'completed@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitB._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'test@example.com',
    isTest: true
  });

  const before = await UnitNightClaim.countDocuments();
  const report = await projectUnitNightClaimIntegrity();
  const after = await UnitNightClaim.countDocuments();
  assert.equal(before, after);
  assert.equal(report.summary.blockingBookingsScanned, 3);
  // confirmed 2 nights + pending 2 + in_house 4 (Sep10-14) = 8
  assert.equal(report.summary.expectedClaims, 8);
  assert.equal(report.mode, 'dry-run');
});

test('dry-run: duplicate ownership reported as conflict; wrong cabinType flagged', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const otherType = await CabinType.create({
    name: 'Other Type',
    slug: `other-${Date.now()}`,
    description: 'x',
    capacity: 2,
    pricePerNight: 50,
    minNights: 1,
    imageUrl: 'https://example.com/o.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const checkIn = sofiaDay('2026-10-01');
  const checkOut = sofiaDay('2026-10-03');

  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'a@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'b@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: otherType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02'),
    status: 'confirmed',
    email: 'mismatch@example.com'
  });

  const report = await projectUnitNightClaimIntegrity();
  assert.ok(report.summary.conflictingUnitNights >= 2);
  assert.ok(report.conflicts.every((c) => Array.isArray(c.bookingIds) && c.bookingIds.length >= 2));
  assert.ok(report.invalidAllocations.some((i) => i.type === 'unit_cabinType_mismatch'));
});

test('I1 does not define authoritative unique index on schema autoIndex path', () => {
  const indexes = UnitNightClaim.schema.indexes();
  const uniqueUnitNight = indexes.find(
    ([keys, opts]) => keys.unitId === 1 && keys.night === 1 && opts && opts.unique === true
  );
  assert.equal(uniqueUnitNight, undefined);
  assert.ok(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC);
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'I6');
});

test('buildScanFilter uses blocking statuses and requires unitId', () => {
  const f = buildScanFilter();
  assert.deepEqual(f.status.$in, ['pending', 'confirmed', 'in_house']);
  assert.ok(f.unitId);
});

test('optional Mongo session is passed through claim and release (and transfer)', async () => {
  const { unitA, unitB } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-08-20');
  const checkOut = sofiaDay('2026-08-22');
  const fakeSession = { __i1SessionMarker: 'unit-night-claim-session' };
  const findSessions = [];
  const insertManyOpts = [];
  const deleteManyOpts = [];

  const originalFind = UnitNightClaim.find;
  const originalInsertMany = UnitNightClaim.insertMany;
  const originalDeleteMany = UnitNightClaim.deleteMany;

  UnitNightClaim.find = function patchedFind(...args) {
    const query = originalFind.apply(this, args);
    const originalSession = query.session.bind(query);
    query.session = function patchedSession(sessionArg) {
      findSessions.push(sessionArg);
      // Prove propagation without handing a fake ClientSession to the driver.
      return originalSession(sessionArg === fakeSession ? null : sessionArg);
    };
    return query;
  };
  UnitNightClaim.insertMany = async function patchedInsertMany(docs, options) {
    insertManyOpts.push(options || null);
    const safe =
      options && options.session === fakeSession
        ? { ...options, session: undefined }
        : options;
    return originalInsertMany.call(this, docs, safe);
  };
  UnitNightClaim.deleteMany = async function patchedDeleteMany(filter, options) {
    deleteManyOpts.push(options || null);
    const safe =
      options && options.session === fakeSession
        ? { ...options, session: undefined }
        : options;
    return originalDeleteMany.call(this, filter, safe);
  };

  try {
    await claimUnitNights({
      bookingId,
      unitId: unitA._id,
      checkIn,
      checkOut,
      source: 'test',
      session: fakeSession
    });
    assert.ok(findSessions.some((s) => s === fakeSession));
    assert.ok(insertManyOpts.some((o) => o && o.session === fakeSession));

    findSessions.length = 0;
    insertManyOpts.length = 0;
    deleteManyOpts.length = 0;

    await releaseUnitNights({
      bookingId,
      unitId: unitA._id,
      checkIn,
      checkOut,
      session: fakeSession
    });
    assert.ok(deleteManyOpts.some((o) => o && o.session === fakeSession));

    await claimUnitNights({
      bookingId,
      unitId: unitA._id,
      checkIn,
      checkOut,
      source: 'test',
      session: fakeSession
    });
    findSessions.length = 0;
    insertManyOpts.length = 0;
    deleteManyOpts.length = 0;

    await transferUnitNightClaims({
      bookingId,
      fromUnitId: unitA._id,
      toUnitId: unitB._id,
      checkIn,
      checkOut,
      source: 'test',
      session: fakeSession
    });
    assert.ok(findSessions.some((s) => s === fakeSession));
    assert.ok(insertManyOpts.some((o) => o && o.session === fakeSession));
    assert.ok(deleteManyOpts.some((o) => o && o.session === fakeSession));
  } finally {
    UnitNightClaim.find = originalFind;
    UnitNightClaim.insertMany = originalInsertMany;
    UnitNightClaim.deleteMany = originalDeleteMany;
  }
});

test('CLI --apply and --bootstrap reject with exit 2 and no claim writes', async () => {
  const script = path.join(__dirname, 'unitNightClaimIntegrityDryRun.js');
  const cwd = path.join(__dirname, '..');
  const before = await UnitNightClaim.countDocuments();

  for (const flag of ['--apply', '--bootstrap']) {
    const result = spawnSync(process.execPath, [script, flag], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/should-not-connect' }
    });
    assert.equal(result.status, 2, `${flag} should exit 2`);
    assert.match(String(result.stderr || ''), /NOT authorized/i);
  }

  // Also exercise exported main() path without spawning.
  const prevArgv = process.argv.slice();
  const prevExit = process.exitCode;
  try {
    process.argv = ['node', script, '--apply'];
    process.exitCode = 0;
    await integrityDryRunMain();
    assert.equal(process.exitCode, 2);
  } finally {
    process.argv = prevArgv;
    process.exitCode = prevExit;
  }

  assert.equal(await UnitNightClaim.countDocuments(), before);
});

test('transferUnitNightClaims: same unit is changed:false with claims intact', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-08-20');
  const checkOut = sofiaDay('2026-08-23');
  await claimUnitNights({ bookingId, unitId: unitA._id, checkIn, checkOut, source: 'test' });
  const before = await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id });
  assert.equal(before, 3);

  const result = await transferUnitNightClaims({
    bookingId,
    fromUnitId: unitA._id,
    toUnitId: unitA._id,
    checkIn,
    checkOut,
    source: 'test'
  });
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId, unitId: unitA._id }), 3);
  assert.deepEqual(result.nights.sort(), ['2026-08-20', '2026-08-21', '2026-08-22']);
});

test('assertBookingOwnsNights: mode at-least allows extras and fails on missing', async () => {
  const { unitA } = await seedCabinTypeAndUnits();
  const bookingId = new mongoose.Types.ObjectId();
  await claimUnitNights({
    bookingId,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-08-20'),
    checkOut: sofiaDay('2026-08-23'),
    source: 'test'
  });

  const okExtra = await assertBookingOwnsNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2026-08-20', '2026-08-21'],
    mode: 'at-least'
  });
  assert.equal(okExtra.ok, true);
  assert.ok(okExtra.ownedNights.includes('2026-08-22'));

  const missing = await assertBookingOwnsNights({
    bookingId,
    unitId: unitA._id,
    nights: ['2026-08-20', '2026-08-24'],
    mode: 'at-least'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, ERR.OWNERSHIP_MISMATCH);
  assert.deepEqual(missing.missingNights, ['2026-08-24']);
  assert.deepEqual(missing.unexpectedNights, []);
});

test('dry-run excludes canonical fixture/smoke email patterns from baseBookingFilter', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const checkIn = sofiaDay('2026-09-20');
  const checkOut = sofiaDay('2026-09-22');
  assert.match('smoke-guest@example.com', FIXTURE_BOOKING_EMAIL_PATTERN);
  assert.match('batch4-guest@example.com', FIXTURE_BOOKING_EMAIL_PATTERN);

  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'smoke-guest@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-09-25'),
    checkOut: sofiaDay('2026-09-27'),
    status: 'confirmed',
    email: 'batch4-guest@example.com'
  });
  await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn: sofiaDay('2026-09-28'),
    checkOut: sofiaDay('2026-09-30'),
    status: 'confirmed',
    email: 'real-guest@example.com'
  });

  const report = await projectUnitNightClaimIntegrity();
  assert.equal(report.summary.blockingBookingsScanned, 1);
  assert.equal(report.summary.expectedClaims, 2);
  assert.equal(report.summary.conflictingUnitNights, 0);
});

test('dry-run includes specific LocationBooking child allocation nights', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const locationBookingId = new mongoose.Types.ObjectId();
  const checkIn = sofiaDay('2026-12-10');
  const checkOut = sofiaDay('2026-12-12');
  const child = await createBlockingBooking({
    cabinTypeId: cabinType._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    status: 'confirmed',
    email: 'location-child@example.com',
    locationBookingId
  });

  const scanned = await Booking.find(buildScanFilter()).select('_id locationBookingId').lean();
  assert.equal(scanned.length, 1);
  assert.equal(String(scanned[0]._id), String(child._id));
  assert.equal(String(scanned[0].locationBookingId), String(locationBookingId));

  const before = await UnitNightClaim.countDocuments();
  const report = await projectUnitNightClaimIntegrity();
  const after = await UnitNightClaim.countDocuments();
  assert.equal(before, after);
  assert.equal(report.summary.blockingBookingsScanned, 1);
  assert.equal(report.summary.expectedClaims, 2);
  assert.equal(report.summary.cleanUnitNights, 2);
  assert.equal(report.summary.conflictingUnitNights, 0);
});
