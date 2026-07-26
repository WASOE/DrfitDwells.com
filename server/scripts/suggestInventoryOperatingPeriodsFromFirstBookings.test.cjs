'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const {
  buildSuggestions,
  main
} = require('./suggestInventoryOperatingPeriodsFromFirstBookings.cjs');

const scriptPath = path.join(__dirname, 'suggestInventoryOperatingPeriodsFromFirstBookings.cjs');

function sofia(dateOnly) {
  return moment.tz(`${dateOnly} 12:00`, 'YYYY-MM-DD HH:mm', 'Europe/Sofia').toDate();
}

async function insertBooking(doc) {
  const now = new Date();
  const payload = {
    adults: 2,
    children: 0,
    status: 'confirmed',
    paymentMethod: 'card',
    provenance: { source: 'guest_portal' },
    createdAt: now,
    updatedAt: now,
    ...doc
  };
  const result = await Booking.collection.insertOne(payload);
  return { _id: result.insertedId, ...payload };
}

test('missing Mongo URI exits non-zero before connect', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, MONGODB_URI: '', MONGO_URI: '', NODE_ENV: 'test' },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr || '', /ERROR: MONGODB_URI or MONGO_URI is required\./);
});

test('suggests earliest cabin/cabinType/unit/location; skips missing unit and cancelled', async () => {
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);

  const cabin = await Cabin.create({
    name: 'Bucephalus',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/c.jpg'
  });
  const cabinType = await CabinType.create({
    name: 'A-frame',
    slug: `af-${Date.now()}`,
    description: 'd',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 150,
    imageUrl: 'https://example.com/ct.jpg',
    propertyKind: 'valley'
  });
  const unit = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: '01',
    isActive: true
  });

  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-06-10'),
    checkOut: sofia('2024-06-12'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'a@test.com', phone: '+1' },
    totalPrice: 100
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-05-01'),
    checkOut: sofia('2024-05-03'),
    guestInfo: { firstName: 'A', lastName: 'B', email: 'earlier@test.com', phone: '+1' },
    totalPrice: 100
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2023-01-01'),
    checkOut: sofia('2023-01-03'),
    status: 'cancelled',
    guestInfo: { firstName: 'A', lastName: 'B', email: 'cancel@test.com', phone: '+1' },
    totalPrice: 100
  });
  await insertBooking({
    cabinTypeId: cabinType._id,
    unitId: unit._id,
    checkIn: sofia('2025-03-01'),
    checkOut: sofia('2025-03-03'),
    guestInfo: { firstName: 'V', lastName: 'U', email: 'unit@test.com', phone: '+2' },
    totalPrice: 200
  });
  await insertBooking({
    cabinTypeId: cabinType._id,
    checkIn: sofia('2025-01-01'),
    checkOut: sofia('2025-01-03'),
    guestInfo: { firstName: 'V', lastName: 'N', email: 'nounit@test.com', phone: '+2' },
    totalPrice: 200
  });
  await LocationBooking.collection.insertOne({
    locationKey: 'valley',
    checkIn: sofia('2025-02-01'),
    checkOut: sofia('2025-02-04'),
    adults: 4,
    children: 0,
    guestInfo: { firstName: 'L', lastName: 'B', email: 'loc@test.com', phone: '+3' },
    totalPrice: 900,
    currency: 'EUR',
    status: 'confirmed',
    source: 'website',
    childBookingIds: [],
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await mongoose.disconnect();

  let stderr = '';
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    stderr += String(chunk);
    return originalWrite(chunk, ...args);
  };
  let stdout = '';
  const originalLog = console.log;
  console.log = (msg) => {
    stdout += String(msg);
  };

  try {
    const report = await main({ MONGODB_URI: uri, NODE_ENV: 'test' });
    assert.equal(report.readOnly, true);
    assert.ok(stderr.includes('"mode": "read-only"') || stderr.includes('"mode":"read-only"'));
    assert.ok(!stderr.includes('mongodb://'));
    assert.ok(JSON.parse(stdout));

    const cabinSug = report.suggestions.find((s) => s.entityType === 'cabin');
    assert.ok(cabinSug);
    assert.equal(cabinSug.operatingFrom, '2024-05-01');
    assert.equal(cabinSug.source, 'first_verified_booking');
    assert.equal(cabinSug.reason, 'opened');
    assert.equal(cabinSug.confidence, 'usable_with_limitations');
    assert.equal(cabinSug.displayName, 'Bucephalus');

    const typeSug = report.suggestions.find((s) => s.entityType === 'cabin_type');
    assert.ok(typeSug);
    assert.equal(typeSug.operatingFrom, '2025-01-01');

    const unitSug = report.suggestions.find((s) => s.entityType === 'unit');
    assert.ok(unitSug);
    assert.equal(unitSug.operatingFrom, '2025-03-01');
    assert.equal(unitSug.entityId, String(unit._id));

    const locSug = report.suggestions.find((s) => s.entityType === 'location');
    assert.ok(locSug);
    assert.equal(locSug.operatingFrom, '2025-02-01');
    assert.equal(locSug.entityId, 'valley');

    assert.ok(
      report.excluded.some((e) => e.reason === 'valley_booking_missing_unit_no_unit_suggestion')
    );
  } finally {
    process.stderr.write = originalWrite;
    console.log = originalLog;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    await mongoServer.stop();
  }
});

test('buildSuggestions never invents unit from missing unitId; ignores createdAt', () => {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const maps = {
    cabinKindById: new Map(),
    cabinTypeKindById: new Map([[String(cabinTypeId), 'valley']])
  };
  const report = buildSuggestions({
    bookings: [
      {
        _id: new mongoose.Types.ObjectId(),
        cabinTypeId,
        unitId: null,
        checkIn: sofia('2025-04-01'),
        checkOut: sofia('2025-04-03'),
        status: 'confirmed'
      }
    ],
    locationBookings: [],
    cabins: [],
    cabinTypes: [{ _id: cabinTypeId, name: 'A-frame', propertyKind: 'valley' }],
    units: [{ _id: new mongoose.Types.ObjectId(), cabinTypeId, unitNumber: '99' }],
    maps
  });
  assert.ok(report.suggestions.some((s) => s.entityType === 'cabin_type'));
  assert.equal(report.suggestions.some((s) => s.entityType === 'unit'), false);
  assert.ok(report.inventoryWithoutSuggestion.some((r) => r.reason === 'no_verified_booking_with_unitId'));
});

test('excludes fixture/test/archived/revenue-child via load path filters', async () => {
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
  const cabin = await Cabin.create({
    name: 'Only Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/c.jpg'
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-01-01'),
    checkOut: sofia('2024-01-02'),
    isTest: true,
    guestInfo: { firstName: 'T', lastName: 'T', email: 't@test.com', phone: '+1' },
    totalPrice: 1
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-02-01'),
    checkOut: sofia('2024-02-02'),
    guestInfo: { firstName: 'F', lastName: 'F', email: 'smoke-guest@test.com', phone: '+1' },
    totalPrice: 1
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-03-01'),
    checkOut: sofia('2024-03-02'),
    archivedAt: new Date(),
    guestInfo: { firstName: 'A', lastName: 'A', email: 'arch@test.com', phone: '+1' },
    totalPrice: 1
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-04-01'),
    checkOut: sofia('2024-04-02'),
    excludeFromRevenueReporting: true,
    guestInfo: { firstName: 'C', lastName: 'C', email: 'child@test.com', phone: '+1' },
    totalPrice: 1
  });
  await insertBooking({
    cabinId: cabin._id,
    checkIn: sofia('2024-05-10'),
    checkOut: sofia('2024-05-12'),
    guestInfo: { firstName: 'G', lastName: 'G', email: 'good@test.com', phone: '+1' },
    totalPrice: 50
  });
  await mongoose.disconnect();

  const report = await main({ MONGODB_URI: uri, NODE_ENV: 'test' });
  const cabinSug = report.suggestions.find((s) => s.entityType === 'cabin');
  assert.ok(cabinSug);
  assert.equal(cabinSug.operatingFrom, '2024-05-10');
  await mongoServer.stop();
});
