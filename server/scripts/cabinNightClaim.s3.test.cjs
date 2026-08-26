/**
 * REBOOK-S1.3 — CabinNightClaim read-only production preflight.
 * Run: cd server && node --test scripts/cabinNightClaim.s3.test.cjs
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
  COMMERCIAL_SHAPES,
  classifyCommercialInventoryShape,
  shouldBookingOwnCabinNightClaims
} = require('../services/inventory/cabinNightClaimQualification');
const {
  runCabinNightClaimS1Preflight,
  stableHash
} = require('../services/inventory/cabinNightClaimS1PreflightService');
const {
  parseArgs,
  buildRefusedReport,
  exitCodeForReport,
  REFUSE_CODE,
  main: cutoverMain
} = require('./cabinNightClaimS1Cutover');
const { ACQUISITION_MODES, claimCabinNights } = require('../services/inventory/cabinNightClaimService');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

function readSource(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function makeCabin(name = 'S1-Cabin') {
  return Cabin.create({
    name,
    location: 'Valley',
    description: 'S1.3 test cabin',
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
    checkIn: overrides.checkIn || sofiaDay('2026-10-10'),
    checkOut: overrides.checkOut || sofiaDay('2026-10-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: overrides.email || `s13-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+35900000000'
    },
    totalPrice: 200,
    status: overrides.status || 'confirmed',
    isTest: overrides.isTest ?? false,
    archivedAt: overrides.archivedAt ?? undefined,
    locationBookingId: overrides.locationBookingId,
    provenance: overrides.provenance
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
    /* first run / empty */
  }
});

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

// --- CLI / READ-ONLY ---

test('CLI: default parseArgs is verify-oriented (no mutation flags)', () => {
  const a = parseArgs([]);
  assert.equal(a.backfill, false);
  assert.equal(a.createUniqueIndex, false);
});

test('CLI: --verify accepted', () => {
  const a = parseArgs(['--verify']);
  assert.equal(a.verify, true);
});

test('CLI: --backfill flag parsed (S1.4 authorized; mutation in backfill service)', () => {
  const a = parseArgs(['--backfill']);
  assert.equal(a.backfill, true);
});

test('CLI: buildRefusedReport still exposes refuseCode helper', () => {
  const r = buildRefusedReport({
    mode: 'create-unique-index',
    reason: 'gate failed'
  });
  assert.equal(r.refuseCode, REFUSE_CODE);
  assert.equal(r.mode, 'create-unique-index');
});

test('CLI: static source routes unique-index to cutover service; verify stays preflight', () => {
  const src = readSource('scripts/cabinNightClaimS1Cutover.js');
  assert.match(src, /runCabinNightClaimS1UniqueIndexCutover/);
  assert.match(src, /runCabinNightClaimS1Preflight/);
  assert.doesNotMatch(src, /claimCabinNights\(/);
  assert.doesNotMatch(src, /syncIndexes\(/);
  assert.doesNotMatch(src, /dropIndex/);
  // createIndex only via dedicated unique cutover service, not inline in CLI verify path
  assert.match(src, /live-writers-verified/);
});

test('preflight service: static source is read-only (no writes)', async () => {
  const src = readSource('services/inventory/cabinNightClaimS1PreflightService.js');
  assert.doesNotMatch(src, /\.create\(/);
  assert.doesNotMatch(src, /insertMany|bulkWrite|findOneAndUpdate|findOneAndDelete/);
  assert.doesNotMatch(src, /\.save\(/);
  assert.doesNotMatch(src, /createIndex|dropIndex|syncIndexes/);
  assert.doesNotMatch(src, /\.updateOne|\.updateMany|\.deleteOne|\.deleteMany/);
});

test('CLI main: --create-unique-index without gates refuses (S1.6)', async () => {
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
    assert.equal(report.mode, 'create-unique-index');
    assert.equal(report.refused, true);
    assert.ok(report.refuseCode);
    assert.equal(report.created, false);
  } finally {
    process.stdout.write = orig;
  }
});

test('verify: empty DB full scan readyForBackfill true (missing=0 expected)', async () => {
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.scanCompleteness, 'full');
  assert.equal(r.toolFailure, false);
  assert.equal(r.readyForBackfill, true);
  assert.equal(r.counts.expected, 0);
  assert.equal(r.counts.actual, 0);
  assert.equal(r.readyForUniqueIndex, false);
});

// --- QUALIFICATION / SHAPE ---

test('shape: VALID_SINGLE / ALLOCATED / UNALLOCATED / MIXED / MISSING / OTHER', () => {
  assert.equal(
    classifyCommercialInventoryShape({ cabinId: 'a' }),
    COMMERCIAL_SHAPES.VALID_SINGLE
  );
  assert.equal(
    classifyCommercialInventoryShape({ cabinTypeId: 't', unitId: 'u' }),
    COMMERCIAL_SHAPES.VALID_ALLOCATED_MULTI
  );
  assert.equal(
    classifyCommercialInventoryShape({ cabinTypeId: 't' }),
    COMMERCIAL_SHAPES.UNALLOCATED_MULTI
  );
  assert.equal(
    classifyCommercialInventoryShape({ cabinId: 'a', cabinTypeId: 't' }),
    COMMERCIAL_SHAPES.MIXED
  );
  assert.equal(classifyCommercialInventoryShape({}), COMMERCIAL_SHAPES.MISSING_PRODUCT);
  assert.equal(
    classifyCommercialInventoryShape({ cabinId: 'a', unitId: 'u' }),
    COMMERCIAL_SHAPES.OTHER_MALFORMED
  );
});

test('qualification: pending/confirmed/in_house single own claims', async () => {
  for (const status of ['pending', 'confirmed', 'in_house']) {
    const b = await makeBooking({ status });
    assert.equal(shouldBookingOwnCabinNightClaims(b), true, status);
  }
});

test('qualification: cancelled/completed do not own', async () => {
  const c = await makeBooking({ status: 'cancelled' });
  const d = await makeBooking({ status: 'completed' });
  assert.equal(shouldBookingOwnCabinNightClaims(c), false);
  assert.equal(shouldBookingOwnCabinNightClaims(d), false);
});

test('qualification: isTest and archived excluded', async () => {
  const t = await makeBooking({ isTest: true });
  const a = await makeBooking({ archivedAt: new Date() });
  assert.equal(shouldBookingOwnCabinNightClaims(t), false);
  assert.equal(shouldBookingOwnCabinNightClaims(a), false);
});

test('preflight: Location single child counted and expected', async () => {
  const locId = new mongoose.Types.ObjectId();
  await makeBooking({
    status: 'confirmed',
    locationBookingId: locId,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.locationSingleBlockingBookings, 1);
  assert.equal(r.locationChildren.expectedClaims, 1);
  assert.equal(r.counts.expected, 1);
  assert.equal(r.counts.missing, 1);
  assert.equal(r.readyForBackfill, true);
});

test('preflight: multi allocated counted not expected', async () => {
  await Booking.create({
    cabinTypeId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'multi@example.com', phone: '1' },
    totalPrice: 1,
    status: 'confirmed',
    isTest: false
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.validAllocatedMultiBookings, 1);
  assert.equal(r.counts.expected, 0);
});

test('preflight: unallocated multi counted', async () => {
  await Booking.create({
    cabinTypeId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'unalloc@example.com', phone: '1' },
    totalPrice: 1,
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.unallocatedMultiBookings, 1);
});

test('preflight: mixed malformed is backfill blocker', async () => {
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    cabinTypeId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.malformedBookings, 1);
  assert.equal(r.readyForBackfill, false);
  assert.ok(r.samples.malformedBookings[0].bookingId);
  assert.equal(r.samples.malformedBookings[0].email, undefined);
});

test('preflight: missing product shape blocker', async () => {
  await insertBookingRaw({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.malformedBookings, 1);
  assert.equal(r.readyForBackfill, false);
});

// --- DATES ---

test('dates: one-night expected=1', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.expected, 1);
});

test('dates: multi-night expected=3', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-13')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.expected, 3);
});

test('dates: Sofia DST spring forward still expands', async () => {
  // Europe/Sofia DST typically late March — use raw insert to avoid past-date validators
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-03-28'),
    checkOut: sofiaDay('2026-03-30'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.expected, 2);
  assert.equal(r.counts.invalidDateRanges, 0);
});

test('dates: same-day invalid range blocker', async () => {
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-10'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.invalidDateRanges, 1);
  assert.equal(r.counts.expected, 0);
  assert.equal(r.readyForBackfill, false);
});

test('dates: inverted range blocker', async () => {
  const cabin = await makeCabin();
  await insertBookingRaw({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-10-12'),
    checkOut: sofiaDay('2026-10-10'),
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.invalidDateRanges, 1);
  assert.equal(r.readyForBackfill, false);
});

// --- CABIN REFERENCES ---

test('cabin: valid cabin reference ok', async () => {
  await makeBooking({});
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.invalidCabinReferences, 0);
  assert.equal(r.readyForBackfill, true);
});

test('cabin: missing cabin reference blocks backfill', async () => {
  const ghost = new mongoose.Types.ObjectId();
  await Booking.create({
    cabinId: ghost,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11'),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'ghost@example.com', phone: '1' },
    totalPrice: 1,
    status: 'confirmed'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.invalidCabinReferences, 1);
  assert.equal(r.counts.expected, 0);
  assert.equal(r.readyForBackfill, false);
});

// --- COLLISIONS ---

test('collision: no collision different cabins', async () => {
  const c1 = await makeCabin('C1');
  const c2 = await makeCabin('C2');
  await makeBooking({ cabin: c1, checkIn: sofiaDay('2026-10-10'), checkOut: sofiaDay('2026-10-11') });
  await makeBooking({ cabin: c2, checkIn: sofiaDay('2026-10-10'), checkOut: sofiaDay('2026-10-11') });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.canonicalCollisions, 0);
  assert.equal(r.readyForBackfill, true);
});

test('collision: same cabin different dates no collision', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-12'),
    checkOut: sofiaDay('2026-10-13')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.canonicalCollisions, 0);
});

test('collision: touching checkout/checkin not overlap', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-12'),
    checkOut: sofiaDay('2026-10-14')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.canonicalCollisions, 0);
});

test('collision: partial overlap detected without claims', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-13')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-11'),
    checkOut: sofiaDay('2026-10-14')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.canonicalCollisions >= 1);
  assert.equal(r.counts.actual, 0);
  assert.equal(r.readyForBackfill, false);
  assert.ok(r.samples.canonicalCollisions[0].bookingIds.length >= 2);
});

test('collision: full overlap', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.canonicalCollisions, 1);
  assert.equal(r.readyForBackfill, false);
});

test('collision: three owners same night', async () => {
  const cabin = await makeCabin();
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await makeBooking({
      cabin,
      checkIn: sofiaDay('2026-10-10'),
      checkOut: sofiaDay('2026-10-11')
    });
  }
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.canonicalCollisions, 1);
  assert.equal(r.samples.canonicalCollisions[0].bookingIds.length, 3);
});

test('collision: Location child involved flagged', async () => {
  const cabin = await makeCabin();
  const locId = new mongoose.Types.ObjectId();
  await makeBooking({
    cabin,
    locationBookingId: locId,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.locationChildren.collisionsInvolving, 1);
});

// --- CLAIM DRIFT ---

test('drift: empty collection all missing; readyForBackfill true', async () => {
  await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-13')
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.expected, 3);
  assert.equal(r.counts.missing, 3);
  assert.equal(r.counts.actual, 0);
  assert.equal(r.readyForBackfill, true);
  assert.equal(r.readyForStableVerification, false);
});

test('drift: perfect parity stable provisional', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'finalize'
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-11',
    source: 'finalize'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.missing, 0);
  assert.equal(r.counts.actual, 2);
  assert.equal(r.readyForStableVerification, true);
  assert.equal(r.readyForUniqueIndexProvisional, true);
  assert.equal(r.readyForUniqueIndex, false);
});

test('drift: stale nonblocking', async () => {
  const b = await makeBooking({ status: 'confirmed' });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'finalize'
  });
  b.status = 'cancelled';
  await b.save();
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.stale >= 1 || r.counts.claimsForNonblockingBooking >= 1);
  assert.equal(r.readyForStableVerification, false);
});

test('drift: outsideRange after date change', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'date_edit'
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-11',
    source: 'date_edit'
  });
  b.checkOut = sofiaDay('2026-10-11');
  await b.save();
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.outsideRange >= 1);
});

test('drift: orphan claim', async () => {
  const cabin = await makeCabin();
  const ghostBooking = new mongoose.Types.ObjectId();
  await insertClaim({
    cabinId: cabin._id,
    bookingId: ghostBooking,
    night: '2026-10-10',
    source: 'other'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.orphan, 1);
});

test('drift: wrongCabin', async () => {
  const c1 = await makeCabin('W1');
  const c2 = await makeCabin('W2');
  const b = await makeBooking({ cabin: c1 });
  await insertClaim({
    cabinId: c2._id,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'reassign'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.wrongCabin >= 1);
});

test('drift: sameOwner duplicate', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  // Direct insert two rows (shadow mode allows duplicates without unique index)
  await CabinNightClaim.create({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: sofiaDay('2026-10-10'),
    source: 'finalize'
  });
  await CabinNightClaim.create({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: sofiaDay('2026-10-10'),
    source: 'finalize'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.sameOwnerDuplicates >= 1);
});

test('drift: foreignOwner duplicate rows', async () => {
  const cabin = await makeCabin();
  const b1 = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const b2 = await makeBooking({
    cabin: await makeCabin('other'),
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02')
  });
  await CabinNightClaim.create({
    cabinId: cabin._id,
    bookingId: b1._id,
    night: sofiaDay('2026-10-10'),
    source: 'finalize'
  });
  await CabinNightClaim.create({
    cabinId: cabin._id,
    bookingId: b2._id,
    night: sofiaDay('2026-10-10'),
    source: 'legacy_create'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.foreignOwnerDuplicates >= 1);
});

test('drift: foreign claim conflict vs expected owner', async () => {
  const cabin = await makeCabin();
  const owner = await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const foreign = await makeBooking({
    cabin: await makeCabin('fx'),
    status: 'cancelled',
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02')
  });
  void owner;
  await CabinNightClaim.create({
    cabinId: cabin._id,
    bookingId: foreign._id,
    night: sofiaDay('2026-10-10'),
    source: 'other'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.foreignClaimConflicts >= 1 || r.counts.claimsForNonblockingBooking >= 1);
});

test('drift: claim for multi inventory', async () => {
  const multi = await Booking.create({
    cabinTypeId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11'),
    adults: 1,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'claimmulti@example.com', phone: '1' },
    totalPrice: 1,
    status: 'confirmed'
  });
  const cabin = await makeCabin();
  await CabinNightClaim.create({
    cabinId: cabin._id,
    bookingId: multi._id,
    night: sofiaDay('2026-10-10'),
    source: 'other'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.claimsForMultiInventoryBooking >= 1);
});

test('drift: claim for excluded isTest booking', async () => {
  const b = await makeBooking({ isTest: true });
  await CabinNightClaim.create({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: sofiaDay('2026-10-10'),
    source: 'test'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.claimsForExcludedBooking >= 1);
});

test('drift: malformed claim missing night classified', async () => {
  // Create a valid claim, then strip night via native update to simulate malformed row.
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const created = await CabinNightClaim.create({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: sofiaDay('2026-10-10'),
    source: 'finalize'
  });
  await CabinNightClaim.collection.updateOne(
    { _id: created._id },
    { $unset: { night: '' } }
  );
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.counts.malformedClaims >= 1);
});

// --- PROVENANCE ---

test('provenance: source grouping + unknown', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-12')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'manual_reservation'
  });
  await CabinNightClaim.create({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: sofiaDay('2026-10-11'),
    source: 'weird_custom_source'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.provenanceCounts.manual_reservation, 1);
  assert.ok(r.provenanceCounts.unknown.weird_custom_source >= 1);
});

// --- READINESS / WRITER ---

test('readiness: writer gap makes readyForBackfill false', async () => {
  await makeBooking({});
  const r = await runCabinNightClaimS1Preflight({
    declaredWriters: ['finalize', 'legacy_create']
  });
  assert.equal(r.writerReadiness.codeReady, false);
  assert.ok(r.writerReadiness.missing.length > 0);
  assert.equal(r.readyForBackfill, false);
});

test('readiness: code writers complete', async () => {
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.writerReadiness.codeReady, true);
  assert.deepEqual(r.writerReadiness.missing, []);
});

test('readiness: unique remains false even on perfect parity', async () => {
  const b = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  await insertClaim({
    cabinId: b.cabinId,
    bookingId: b._id,
    night: '2026-10-10',
    source: 'finalize'
  });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.readyForStableVerification, true);
  assert.equal(r.readyForUniqueIndex, false);
});

// --- FINGERPRINT ---

test('fingerprint: deterministic across runs', async () => {
  await makeBooking({});
  const a = await runCabinNightClaimS1Preflight({});
  const b = await runCabinNightClaimS1Preflight({});
  assert.equal(a.fingerprint, b.fingerprint);
});

test('fingerprint: ownership change affects', async () => {
  await makeBooking({});
  const a = await runCabinNightClaimS1Preflight({});
  await makeBooking({
    checkIn: sofiaDay('2026-11-01'),
    checkOut: sofiaDay('2026-11-02')
  });
  const b = await runCabinNightClaimS1Preflight({});
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('fingerprint: collision change affects', async () => {
  const cabin = await makeCabin();
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const a = await runCabinNightClaimS1Preflight({});
  await makeBooking({
    cabin,
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const b = await runCabinNightClaimS1Preflight({});
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('fingerprint: drift change affects', async () => {
  const booking = await makeBooking({
    checkIn: sofiaDay('2026-10-10'),
    checkOut: sofiaDay('2026-10-11')
  });
  const a = await runCabinNightClaimS1Preflight({});
  await insertClaim({
    cabinId: booking.cabinId,
    bookingId: booking._id,
    night: '2026-10-10',
    source: 'finalize'
  });
  const b = await runCabinNightClaimS1Preflight({});
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test('fingerprint: priorFingerprint comparison optional', async () => {
  await makeBooking({});
  const a = await runCabinNightClaimS1Preflight({});
  const b = await runCabinNightClaimS1Preflight({ priorFingerprint: a.fingerprint });
  assert.equal(b.stableVerification.satisfied, true);
  const c = await runCabinNightClaimS1Preflight({ priorFingerprint: 'deadbeef' });
  assert.equal(c.stableVerification.satisfied, false);
});

test('fingerprint: stableHash helper length', () => {
  assert.equal(stableHash({ a: 1 }).length, 24);
});

// --- INDEX REPORT ---

test('index: authority absent reported', async () => {
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.authoritativeUniquePresent, false);
  assert.equal(r.authoritativeUniqueExact, false);
});

test('index: exact authority detected without create in verify', async () => {
  await CabinNightClaim.collection.createIndex(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
    { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
  );
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.authoritativeUniquePresent, true);
  assert.equal(r.authoritativeUniqueExact, true);
  assert.equal(r.authoritativeIndexState, 'EXACT');
  assert.equal(r.unexpectedIndexState, false);
  assert.equal(r.readyForBackfill, false);
});

test('index: wrong-name unique reported not exact', async () => {
  await CabinNightClaim.collection.createIndex(
    { cabinId: 1, night: 1 },
    { unique: true, name: 'wrong_name_unique' }
  );
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.authoritativeUniqueExact, false);
  assert.ok(r.existingIndexes.some((ix) => ix.name === 'wrong_name_unique'));
  assert.equal(r.unexpectedIndexState, true);
});

// --- OUTPUT / PII ---

test('output: JSON has required top-level keys; no guest PII in samples', async () => {
  await makeBooking({});
  const r = await runCabinNightClaimS1Preflight({});
  for (const key of [
    'mode',
    'cutoverBatch',
    'scanCompleteness',
    'counts',
    'fingerprint',
    'readyForBackfill',
    'readyForStableVerification',
    'readyForUniqueIndex',
    'writerReadiness',
    'provenanceCounts',
    'remainingBlockers'
  ]) {
    assert.ok(key in r, key);
  }
  const blob = JSON.stringify(r.samples);
  assert.doesNotMatch(blob, /@example\.com|firstName|lastName|phone|specialRequests/i);
});

test('output: samples bounded', async () => {
  const cabin = await makeCabin();
  for (let i = 0; i < 30; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await makeBooking({
      cabin,
      checkIn: sofiaDay('2026-10-10'),
      checkOut: sofiaDay('2026-10-11')
    });
  }
  const r = await runCabinNightClaimS1Preflight({});
  assert.ok(r.samples.canonicalCollisions.length <= 25);
});

test('isTest blocking exclusions counted', async () => {
  await makeBooking({ isTest: true });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.isTestBlockingExclusions, 1);
  assert.equal(r.counts.expected, 0);
});

test('archived blocking exclusions counted', async () => {
  await makeBooking({ archivedAt: new Date() });
  const r = await runCabinNightClaimS1Preflight({});
  assert.equal(r.counts.archivedBlockingExclusions, 1);
});

test('CLI parseArgs: prior-fingerprint and report-json', () => {
  const a = parseArgs([
    '--prior-fingerprint',
    'abc',
    '--report-json',
    '/tmp/x.json',
    '--batch-size',
    '50'
  ]);
  assert.equal(a.priorFingerprint, 'abc');
  assert.equal(a.reportJson, '/tmp/x.json');
  assert.equal(Number(a.batchSize), 50);
});

test('AUTHORITATIVE_UNIQUE_INDEX_SPEC reused (not reinvented string-only)', () => {
  const src = readSource('services/inventory/cabinNightClaimS1PreflightService.js');
  assert.match(src, /AUTHORITATIVE_UNIQUE_INDEX_SPEC/);
  assert.equal(
    AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name,
    'cabinNightClaim_cabinId_night_unique'
  );
});
