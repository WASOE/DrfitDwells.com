/**
 * GET /api/availability/suggestions — next same-length availability.
 *
 * Run: node --test server/scripts/availabilitySuggestions.test.cjs
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
const AvailabilityBlock = require('../models/AvailabilityBlock');
const availabilityRoutes = require('../routes/availabilityRoutes');
const { findNextSameLengthAvailability } = require('../services/availabilitySuggestionService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let app;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/availability', availabilityRoutes);
  return instance;
}

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: `Suggestion Cabin ${new mongoose.Types.ObjectId()}`,
    description: 'Test cabin for availability suggestions',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Test Valley',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function createCabinType(overrides = {}) {
  return CabinType.create({
    name: `A-Frame ${new mongoose.Types.ObjectId()}`,
    slug: `a-frame-${new mongoose.Types.ObjectId()}`,
    description: 'Test multi-unit type',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Test Valley',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function blockCabinRange(cabinId, checkIn, checkOut, unitId = null) {
  const { startDate, endDate } = normalizeGuestStayRange(checkIn, checkOut);
  const doc = {
    cabinId,
    blockType: 'manual_block',
    startDate,
    endDate,
    status: 'active',
    source: 'test'
  };
  if (unitId) doc.unitId = unitId;
  return AvailabilityBlock.create(doc);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  app = buildApp();
  process.env.MULTI_UNIT_ENABLED = 'true';
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  delete process.env.MULTI_UNIT_ENABLED;
});

test('single cabin: returns next same-length range when requested dates are blocked', async () => {
  const cabin = await createCabin();
  const checkIn = sofiaDateOnly(40);
  const checkOut = sofiaDateOnly(43);

  await blockCabinRange(cabin._id, checkIn, checkOut);

  const data = await findNextSameLengthAvailability({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    cabinId: String(cabin._id),
    maxShiftDays: 30
  });

  assert.equal(data.listingType, 'cabin');
  assert.equal(data.reasonSkipped, null);
  assert.ok(data.sameLength);
  assert.equal(data.sameLength.nights, 3);
  assert.equal(data.sameLength.checkIn, sofiaDateOnly(43));
  assert.equal(data.sameLength.checkOut, sofiaDateOnly(46));
  assert.equal(data.sameLength.currency, 'EUR');
});

test('single cabin: no range within horizon returns no_availability_found', async () => {
  const cabin = await createCabin();
  const horizonStart = 50;
  const checkIn = sofiaDateOnly(horizonStart);
  const checkOut = sofiaDateOnly(horizonStart + 2);

  for (let shift = 0; shift <= 5; shift += 1) {
    const blockIn = sofiaDateOnly(horizonStart + shift);
    const blockOut = sofiaDateOnly(horizonStart + shift + 2);
    await blockCabinRange(cabin._id, blockIn, blockOut);
  }

  const data = await findNextSameLengthAvailability({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    cabinId: String(cabin._id),
    maxShiftDays: 5
  });

  assert.equal(data.reasonSkipped, 'no_availability_found');
  assert.equal(data.sameLength, null);
  assert.equal(data.scannedDays, 5);
});

test('multi-unit cabin type: pool blocked on request, next shift frees one unit', async () => {
  const cabinType = await createCabinType({ slug: 'a-frame' });
  const parentCabin = await createCabin({
    name: 'A-Frame parent',
    cabinTypeRef: cabinType._id,
    inventoryType: 'multi'
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-01',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-02',
    isActive: true
  });

  const checkIn = sofiaDateOnly(60);
  const checkOut = sofiaDateOnly(62);

  await blockCabinRange(parentCabin._id, checkIn, checkOut, unitA._id);
  await blockCabinRange(parentCabin._id, checkIn, checkOut, unitB._id);

  const nextBlockedCheckIn = sofiaDateOnly(61);
  const nextBlockedCheckOut = sofiaDateOnly(63);
  await blockCabinRange(parentCabin._id, nextBlockedCheckIn, nextBlockedCheckOut, unitA._id);

  const data = await findNextSameLengthAvailability({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    cabinTypeId: String(cabinType._id),
    maxShiftDays: 10
  });

  assert.equal(data.listingType, 'cabinType');
  assert.equal(data.reasonSkipped, null);
  assert.ok(data.sameLength);
  assert.ok(data.sameLength.checkIn > checkIn);
  const candidateNights = moment(data.sameLength.checkOut).diff(moment(data.sameLength.checkIn), 'days');
  assert.equal(candidateNights, 2);
});

test('min_guests: skipped without scanning', async () => {
  const cabin = await createCabin({ minGuests: 3, capacity: 6 });
  const data = await findNextSameLengthAvailability({
    checkIn: sofiaDateOnly(20),
    checkOut: sofiaDateOnly(23),
    adults: 2,
    children: 0,
    cabinId: String(cabin._id)
  });

  assert.equal(data.reasonSkipped, 'min_guests');
  assert.equal(data.sameLength, null);
  assert.equal(data.scannedDays, 0);
});

test('min_nights: skipped without scanning', async () => {
  const cabin = await createCabin({ minNights: 3 });
  const data = await findNextSameLengthAvailability({
    checkIn: sofiaDateOnly(20),
    checkOut: sofiaDateOnly(21),
    adults: 2,
    children: 0,
    cabinId: String(cabin._id)
  });

  assert.equal(data.reasonSkipped, 'min_nights');
  assert.equal(data.sameLength, null);
  assert.equal(data.scannedDays, 0);
});

test('max_guests: skipped without scanning', async () => {
  const cabin = await createCabin({ capacity: 2 });
  const data = await findNextSameLengthAvailability({
    checkIn: sofiaDateOnly(20),
    checkOut: sofiaDateOnly(23),
    adults: 2,
    children: 1,
    cabinId: String(cabin._id)
  });

  assert.equal(data.reasonSkipped, 'max_guests');
  assert.equal(data.sameLength, null);
});

test('invalid request: missing listing id', async () => {
  const data = await findNextSameLengthAvailability({
    checkIn: sofiaDateOnly(20),
    checkOut: sofiaDateOnly(23),
    adults: 2,
    children: 0
  });
  assert.equal(data.reasonSkipped, 'invalid_request');
});

test('invalid request: both listing ids', async () => {
  const cabin = await createCabin();
  const cabinType = await createCabinType();
  const data = await findNextSameLengthAvailability({
    checkIn: sofiaDateOnly(20),
    checkOut: sofiaDateOnly(23),
    adults: 2,
    children: 0,
    cabinId: String(cabin._id),
    cabinTypeId: String(cabinType._id)
  });
  assert.equal(data.reasonSkipped, 'invalid_request');
});

test('HTTP route returns success payload for blocked single cabin', async () => {
  const cabin = await createCabin();
  const checkIn = sofiaDateOnly(80);
  const checkOut = sofiaDateOnly(83);
  await blockCabinRange(cabin._id, checkIn, checkOut);

  const res = await request(app)
    .get('/api/availability/suggestions')
    .query({
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      cabinId: String(cabin._id),
      maxShiftDays: 15
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.reasonSkipped, null);
  assert.equal(res.body.data.sameLength.checkIn, sofiaDateOnly(83));
});

test('GET /api/availability search contract unchanged (smoke)', async () => {
  const cabin = await createCabin();
  const checkIn = sofiaDateOnly(90);
  const checkOut = sofiaDateOnly(92);

  const res = await request(app)
    .get('/api/availability')
    .query({ checkIn, checkOut, adults: 2, children: 0 });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data.cabins));
  const row = res.body.data.cabins.find((c) => String(c._id) === String(cabin._id));
  assert.ok(row);
  assert.equal(typeof row.available, 'boolean');
});
