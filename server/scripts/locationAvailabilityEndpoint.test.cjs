/**
 * Public whole-location availability calendar data.
 * Run: node --test server/scripts/locationAvailabilityEndpoint.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const { buildPublicLocationAvailability } = require('../services/locationQuote/locationAvailabilityService');
const { evaluateLocationConflicts } = require('../services/ops/domain/locationConflictService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let app;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function sofiaDateToDate(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').toDate();
}

function windowQuery(fromDays, toDays) {
  return {
    from: sofiaDateOnly(fromDays),
    to: sofiaDateOnly(toDays)
  };
}

async function createValleySingle({ name, slug, capacity = 4 }) {
  return Cabin.create({
    name,
    slug,
    description: 'Availability test cabin',
    capacity,
    minGuests: 1,
    pricePerNight: 85,
    buyoutPricePerNight: 85,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
}

async function createValleyAFrameUnit() {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'Availability test A-frame',
    capacity: 2,
    pricePerNight: 60,
    buyoutPricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
    bedConfig: [{ bedType: 'double', count: 1 }],
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });

  const parentCabin = await Cabin.create({
    name: `A-Frame Parent ${suffix}`,
    description: 'Multi parent',
    capacity: 2,
    pricePerNight: 60,
    minNights: 2,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeRef: cabinType._id,
    isActive: true,
    transportOptions: []
  });

  const unit = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-01',
    displayName: 'A-Frame 1',
    isActive: true
  });

  return { cabinType, parentCabin, unit };
}

async function seedValleyInventory() {
  const stone = await createValleySingle({ name: 'Stone House', slug: 'stone-house', capacity: 6 });
  const lux = await createValleySingle({ name: 'Lux Cabin', slug: 'lux-cabin', capacity: 2 });
  const aframe = await createValleyAFrameUnit();
  return { stone, lux, aframe };
}

async function createBooking({ cabinId, unitId = null, cabinTypeId = null, checkInDays, checkOutDays }) {
  return Booking.create({
    cabinId,
    unitId,
    cabinTypeId,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Avail',
      lastName: 'Test',
      email: `avail-${new mongoose.Types.ObjectId()}@example.com`,
      phone: '+359800000000'
    },
    totalPrice: 300,
    checkIn: sofiaDateToDate(checkInDays),
    checkOut: sofiaDateToDate(checkOutDays)
  });
}

async function createBlock({
  cabinId,
  unitId = null,
  blockType,
  checkInDays,
  checkOutDays,
  expiresAt = null,
  checkoutSessionId = null,
  metadata = {}
}) {
  const { startDate, endDate } = normalizeGuestStayRange(
    sofiaDateOnly(checkInDays),
    sofiaDateOnly(checkOutDays)
  );
  return AvailabilityBlock.create({
    cabinId,
    unitId,
    blockType,
    startDate,
    endDate,
    status: 'active',
    source: 'test',
    ...(expiresAt ? { expiresAt } : {}),
    ...(checkoutSessionId ? { checkoutSessionId, sourceReference: checkoutSessionId } : {}),
    metadata
  });
}

async function fetchAvailability(fromDays, toDays) {
  const res = await request(app)
    .get('/api/public/location-availability/the-valley')
    .query(windowQuery(fromDays, toDays))
    .expect(200);
  assert.equal(res.body.success, true);
  return res.body.data;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });

  app = express();
  app.use(express.json());
  app.use('/api/public', require('../routes/publicLocationAvailabilityRoutes'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    AvailabilityBlock.deleteMany({})
  ]);
});

test('booking overlap on one target blocks the night location-wide', async () => {
  const { lux } = await seedValleyInventory();
  await createBooking({
    cabinId: lux._id,
    checkInDays: 20,
    checkOutDays: 23
  });

  const data = await fetchAvailability(18, 30);
  assert.ok(data.blockedNights.includes(sofiaDateOnly(20)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(21)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(22)));
});

test('active checkout_hold blocks the night', async () => {
  const { lux } = await seedValleyInventory();
  await createBlock({
    cabinId: lux._id,
    blockType: 'checkout_hold',
    checkInDays: 25,
    checkOutDays: 28,
    checkoutSessionId: 'active-hold-session',
    expiresAt: new Date(Date.now() + 60_000)
  });

  const data = await fetchAvailability(24, 32);
  assert.ok(data.blockedNights.includes(sofiaDateOnly(25)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(26)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(27)));
});

test('expired checkout_hold does not block', async () => {
  const { lux } = await seedValleyInventory();
  await createBlock({
    cabinId: lux._id,
    blockType: 'checkout_hold',
    checkInDays: 25,
    checkOutDays: 28,
    checkoutSessionId: 'expired-hold-session',
    expiresAt: new Date(Date.now() - 60_000)
  });

  const data = await fetchAvailability(24, 32);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(25)), false);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(26)), false);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(27)), false);
});

test('external_hold on a single target blocks the buyout night', async () => {
  const { stone } = await seedValleyInventory();
  await createBlock({
    cabinId: stone._id,
    blockType: 'external_hold',
    checkInDays: 30,
    checkOutDays: 33
  });

  const data = await fetchAvailability(28, 36);
  assert.ok(data.blockedNights.includes(sofiaDateOnly(30)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(31)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(32)));
});

test('location-wide manual block blocks all nights in its span', async () => {
  const { stone } = await seedValleyInventory();
  await createBlock({
    cabinId: stone._id,
    blockType: 'manual_block',
    checkInDays: 40,
    checkOutDays: 43,
    metadata: { scope: 'location_wide', locationKey: 'valley' }
  });

  const data = await fetchAvailability(38, 46);
  assert.ok(data.blockedNights.includes(sofiaDateOnly(40)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(41)));
  assert.ok(data.blockedNights.includes(sofiaDateOnly(42)));
});

test('nights outside all conflicts are not blocked', async () => {
  const { lux } = await seedValleyInventory();
  await createBooking({
    cabinId: lux._id,
    checkInDays: 20,
    checkOutDays: 23
  });

  const data = await fetchAvailability(18, 30);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(18)), false);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(19)), false);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(29)), false);
});

test('exclusive-end: checkout day of an existing booking is selectable as check-in night', async () => {
  const { lux } = await seedValleyInventory();
  await createBooking({
    cabinId: lux._id,
    checkInDays: 20,
    checkOutDays: 23
  });

  const data = await fetchAvailability(18, 30);
  assert.equal(data.blockedNights.includes(sofiaDateOnly(23)), false);
});

test('400 on invalid dates and 404 on unknown location', async () => {
  await seedValleyInventory();

  const missingFrom = await request(app)
    .get('/api/public/location-availability/the-valley')
    .query({ to: sofiaDateOnly(30) })
    .expect(400);
  assert.equal(missingFrom.body.success, false);

  const invalidFrom = await request(app)
    .get('/api/public/location-availability/the-valley')
    .query({ from: 'not-a-date', to: sofiaDateOnly(30) })
    .expect(400);
  assert.equal(invalidFrom.body.success, false);

  const reversed = await request(app)
    .get('/api/public/location-availability/the-valley')
    .query({ from: sofiaDateOnly(30), to: sofiaDateOnly(20) })
    .expect(400);
  assert.equal(reversed.body.success, false);

  const tooWide = await request(app)
    .get('/api/public/location-availability/the-valley')
    .query({ from: sofiaDateOnly(0), to: sofiaDateOnly(400) })
    .expect(400);
  assert.equal(tooWide.body.success, false);
  assert.match(tooWide.body.message, /12 months/i);

  const unknown = await request(app)
    .get('/api/public/location-availability/nowhere')
    .query(windowQuery(0, 30))
    .expect(404);
  assert.equal(unknown.body.success, false);
});

test('response shape includes timezone, minNights, and sorted blockedNights', async () => {
  await seedValleyInventory();
  const data = await buildPublicLocationAvailability('valley', windowQuery(0, 14));

  assert.equal(data.locationKey, 'valley');
  assert.equal(data.locationSlug, 'the-valley');
  assert.equal(data.timezone, 'Europe/Sofia');
  assert.equal(data.minNights, 2);
  assert.equal(data.from, sofiaDateOnly(0));
  assert.equal(data.to, sofiaDateOnly(14));
  assert.ok(Array.isArray(data.blockedNights));
  assert.ok(data.generatedAt);
  const sorted = [...data.blockedNights].sort();
  assert.deepEqual(data.blockedNights, sorted);
});

test('parity with evaluateLocationConflicts for blocked and clean nights', async () => {
  const { stone, lux, aframe } = await seedValleyInventory();

  await createBooking({
    cabinId: lux._id,
    checkInDays: 20,
    checkOutDays: 23
  });
  await createBlock({
    cabinId: stone._id,
    blockType: 'manual_block',
    checkInDays: 35,
    checkOutDays: 38,
    metadata: { scope: 'location_wide', locationKey: 'valley' }
  });
  await createBlock({
    cabinId: aframe.parentCabin._id,
    unitId: aframe.unit._id,
    blockType: 'checkout_hold',
    checkInDays: 50,
    checkOutDays: 53,
    checkoutSessionId: 'parity-hold',
    expiresAt: new Date(Date.now() + 60_000)
  });

  const data = await buildPublicLocationAvailability('valley', windowQuery(18, 60));
  assert.ok(data.blockedNights.length > 0, 'expected blocked nights in seeded window');

  for (const night of data.blockedNights) {
    const checkIn = moment.tz(night, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day').toDate();
    const checkOut = moment.tz(night, 'YYYY-MM-DD', PROPERTY_TIMEZONE).add(1, 'day').startOf('day').toDate();
    const evaluation = await evaluateLocationConflicts('valley', checkIn, checkOut);
    assert.equal(
      evaluation.canBlock,
      false,
      `expected 1-night range on blocked night ${night} to be rejected`
    );
  }

  const cleanSamples = [sofiaDateOnly(18), sofiaDateOnly(19), sofiaDateOnly(29)].filter(
    (night) => !data.blockedNights.includes(night)
  );
  assert.ok(cleanSamples.length >= 2, 'need at least two clean nights for parity sample');

  const rangeCheckIn = moment
    .tz(cleanSamples[0], 'YYYY-MM-DD', PROPERTY_TIMEZONE)
    .startOf('day')
    .toDate();
  const rangeCheckOut = moment
    .tz(cleanSamples[1], 'YYYY-MM-DD', PROPERTY_TIMEZONE)
    .add(1, 'day')
    .startOf('day')
    .toDate();
  const cleanEvaluation = await evaluateLocationConflicts('valley', rangeCheckIn, rangeCheckOut);
  assert.equal(
    cleanEvaluation.canBlock,
    true,
    `expected 2-night range ${cleanSamples[0]} → ${cleanSamples[1]} to be accepted`
  );
});
