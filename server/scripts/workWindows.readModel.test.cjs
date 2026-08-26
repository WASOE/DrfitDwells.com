/**
 * Work Windows read-model integration tests.
 * Run: node --test server/scripts/workWindows.readModel.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { getWorkWindowsReadModel } = require('../services/ops/readModels/workWindowsReadModel');
const { PROPERTY_TIMEZONE } = require('../utils/dateTime');

let mongoServer;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function sofiaDate(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').toDate();
}

function guestInfo(overrides = {}) {
  return {
    firstName: 'Test',
    lastName: 'Guest',
    email: `guest-${new mongoose.Types.ObjectId()}@example.com`,
    phone: '+359800000000',
    ...overrides
  };
}

async function createValleySingle(name, overrides = {}) {
  return Cabin.create({
    name,
    description: 'Valley test cabin',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function createValleyMultiInventory({ unitCount = 2 } = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: `A-Frame WW ${suffix}`,
    slug: `a-frame-ww-${suffix}`,
    description: 'Test type',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true
  });
  const parent = await Cabin.create({
    name: `A-Frame Parent WW ${suffix}`,
    description: 'Multi parent',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeId: cabinType._id,
    isActive: true,
    transportOptions: []
  });
  const units = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      await Unit.create({
        cabinTypeId: cabinType._id,
        unitNumber: `AF-WW-${suffix}-${i}`,
        displayName: `AF ${i}`,
        isActive: true
      })
    );
  }
  return { cabinType, parent, units };
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
    AvailabilityBlock.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({})
  ]);
});

test('allocated A-frame booking → Valley occupied; other unit can stay free', async () => {
  const stone = await createValleySingle('Stone House WW');
  const { cabinType, parent, units } = await createValleyMultiInventory({ unitCount: 2 });
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);

  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkIn: sofiaDate(12),
    checkOut: sofiaDate(14),
    adults: 2,
    guestInfo: guestInfo(),
    totalPrice: 100,
    status: 'confirmed',
    isTest: false
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  const u0 = data.resources.find((r) => r.unitId === String(units[0]._id));
  const u1 = data.resources.find((r) => r.unitId === String(units[1]._id));
  const stoneRow = data.resources.find((r) => r.cabinId === String(stone._id));

  assert.ok(site.spans.some((s) => s.state === 'occupied'));
  assert.ok(u0.spans.some((s) => s.state === 'occupied'));
  assert.ok(!u1.spans.some((s) => s.state === 'occupied'));
  assert.ok(!stoneRow.spans.some((s) => s.state === 'occupied'));
  assert.ok(parent);
});

test('unallocated cabinType booking → Valley occupied and applied to all units', async () => {
  const { cabinType, units } = await createValleyMultiInventory({ unitCount: 2 });
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);

  await Booking.create({
    cabinTypeId: cabinType._id,
    unitId: null,
    checkIn: sofiaDate(12),
    checkOut: sofiaDate(14),
    adults: 2,
    guestInfo: guestInfo(),
    totalPrice: 100,
    status: 'confirmed',
    isTest: false
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  assert.ok(site.spans.some((s) => s.state === 'occupied'));
  for (const u of units) {
    const row = data.resources.find((r) => r.unitId === String(u._id));
    assert.ok(row.spans.some((s) => s.state === 'occupied'), `unit ${u.unitNumber} should be occupied`);
  }
});

test('Stone House occupancy → Valley occupied', async () => {
  await createValleySingle('Lux Cabin WW');
  const stone = await createValleySingle('Stone House WW2');
  const from = sofiaDateOnly(5);
  const to = sofiaDateOnly(20);

  await Booking.create({
    cabinId: stone._id,
    checkIn: sofiaDate(8),
    checkOut: sofiaDate(10),
    adults: 2,
    guestInfo: guestInfo(),
    totalPrice: 100,
    status: 'confirmed',
    isTest: false
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  assert.ok(site.spans.some((s) => s.state === 'occupied'));
});

test('cancelled ignored; pending counted occupied', async () => {
  const cabin = await createValleySingle('Cabin Pending WW');
  const from = sofiaDateOnly(5);
  const to = sofiaDateOnly(20);

  await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDate(8),
    checkOut: sofiaDate(10),
    adults: 2,
    guestInfo: guestInfo(),
    totalPrice: 100,
    status: 'cancelled',
    isTest: false
  });
  await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDate(12),
    checkOut: sofiaDate(14),
    adults: 2,
    guestInfo: guestInfo({ lastName: 'Pending' }),
    totalPrice: 100,
    status: 'pending',
    isTest: false
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  const occupied = site.spans.filter((s) => s.state === 'occupied');
  assert.equal(occupied.length, 1);
  assert.equal(occupied[0].source.status, 'pending');
});

test('inactive unit absent from resources', async () => {
  const { cabinType, units } = await createValleyMultiInventory({ unitCount: 2 });
  await Unit.updateOne({ _id: units[1]._id }, { $set: { isActive: false } });
  const from = sofiaDateOnly(1);
  const to = sofiaDateOnly(10);
  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  assert.ok(data.resources.some((r) => r.unitId === String(units[0]._id)));
  assert.ok(!data.resources.some((r) => r.unitId === String(units[1]._id)));
  assert.ok(cabinType);
});

test('child maintenance block does NOT mark entire Valley blocked', async () => {
  const { parent, units } = await createValleyMultiInventory({ unitCount: 2 });
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);

  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[0]._id,
    blockType: 'maintenance',
    startDate: sofiaDate(12),
    endDate: sofiaDate(15),
    status: 'active',
    source: 'internal_admin'
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  const u0 = data.resources.find((r) => r.unitId === String(units[0]._id));
  const u1 = data.resources.find((r) => r.unitId === String(units[1]._id));

  assert.ok(!site.spans.some((s) => s.state === 'blocked'), 'site must not be blocked by child maintenance');
  assert.ok(u0.spans.some((s) => s.state === 'blocked'));
  assert.ok(!u1.spans.some((s) => s.state === 'blocked'));
});

test('location-wide block marks site blocked', async () => {
  const stone = await createValleySingle('Stone LocBlock WW');
  const groupId = 'ww-loc-group-1';
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);

  await AvailabilityBlock.create({
    cabinId: stone._id,
    unitId: null,
    blockType: 'manual_block',
    startDate: sofiaDate(12),
    endDate: sofiaDate(14),
    status: 'active',
    source: 'internal_admin',
    sourceReference: groupId,
    metadata: {
      locationBlockGroupId: groupId,
      locationKey: 'valley',
      scope: 'location_wide',
      targetKey: `cabin:${stone._id}`
    }
  });

  const data = await getWorkWindowsReadModel({ locationKey: 'valley', from, to });
  const site = data.resources.find((r) => r.kind === 'location');
  assert.ok(site.spans.some((s) => s.state === 'blocked' && s.blockSubtype === 'manual_block'));
});

test('expired checkout_hold ignored; active checkout_hold blocked on unit', async () => {
  const { parent, units } = await createValleyMultiInventory({ unitCount: 1 });
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);
  const snapshot = moment.tz(PROPERTY_TIMEZONE).add(12, 'days').hour(12).minute(0).second(0).millisecond(0).toDate();

  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[0]._id,
    blockType: 'checkout_hold',
    startDate: sofiaDate(12),
    endDate: sofiaDate(14),
    status: 'active',
    source: 'location_checkout',
    expiresAt: new Date(snapshot.getTime() - 60_000)
  });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[0]._id,
    blockType: 'checkout_hold',
    startDate: sofiaDate(16),
    endDate: sofiaDate(18),
    status: 'active',
    source: 'location_checkout',
    expiresAt: new Date(snapshot.getTime() + 3600_000)
  });

  const data = await getWorkWindowsReadModel(
    { locationKey: 'valley', from, to },
    { now: snapshot }
  );
  assert.equal(data.generatedAt, snapshot.toISOString());
  const u0 = data.resources.find((r) => r.unitId === String(units[0]._id));
  const blocked = u0.spans.filter((s) => s.state === 'blocked' && s.blockSubtype === 'checkout_hold');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].startDateOnly, sofiaDateOnly(16));
});

test('stable generatedAt drives actionable clipping and hold expiry together', async () => {
  await createValleySingle('Stable Snapshot WW');
  const from = '2026-08-26';
  const to = '2026-08-30';
  const snapshot = moment.tz('2026-08-26 16:00', 'YYYY-MM-DD HH:mm', PROPERTY_TIMEZONE).toDate();

  const data = await getWorkWindowsReadModel(
    { locationKey: 'valley', from, to },
    { now: snapshot }
  );
  assert.equal(data.generatedAt, snapshot.toISOString());
  assert.equal(data.actionableFrom, snapshot.toISOString());
  const site = data.resources.find((r) => r.kind === 'location');
  const free = site.spans.find((s) => s.state === 'free');
  assert.ok(free);
  assert.equal(
    moment.tz(free.startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'),
    '2026-08-26 16:00'
  );
  const best = data.bestWindows[0];
  assert.ok(best);
  assert.equal(best.startAt, free.startAt);
  assert.equal(best.durationMinutes, free.durationMinutes);
});

test('guest occupancy wins over overlapping maintenance on unit resource', async () => {
  const { parent, units } = await createValleyMultiInventory({ unitCount: 1 });
  const from = sofiaDateOnly(10);
  const to = sofiaDateOnly(25);
  const snapshot = moment.tz(PROPERTY_TIMEZONE).startOf('day').add(5, 'days').toDate();

  await Booking.create({
    cabinTypeId: units[0].cabinTypeId,
    unitId: units[0]._id,
    checkIn: sofiaDate(12),
    checkOut: sofiaDate(16),
    adults: 2,
    guestInfo: guestInfo(),
    totalPrice: 100,
    status: 'confirmed',
    isTest: false
  });
  await AvailabilityBlock.create({
    cabinId: parent._id,
    unitId: units[0]._id,
    blockType: 'maintenance',
    startDate: sofiaDate(13),
    endDate: sofiaDate(15),
    status: 'active',
    source: 'internal_admin'
  });

  const data = await getWorkWindowsReadModel(
    { locationKey: 'valley', from, to },
    { now: snapshot }
  );
  const u0 = data.resources.find((r) => r.unitId === String(units[0]._id));
  const mid = moment.tz(PROPERTY_TIMEZONE).startOf('day').add(14, 'days').hour(12).toDate();
  const covering = u0.spans.filter(
    (s) => new Date(s.startAt) <= mid && new Date(s.endAt) > mid
  );
  assert.equal(covering.length, 1);
  assert.equal(covering[0].state, 'occupied');
});
