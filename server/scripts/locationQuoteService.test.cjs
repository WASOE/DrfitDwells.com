/**
 * Public location quote + enquiry for whole-location retreats.
 * Run: node --test server/scripts/locationQuoteService.test.cjs
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
const LocationEnquiry = require('../models/LocationEnquiry');
const { buildPublicLocationQuote } = require('../services/locationQuote/locationQuoteService');
const { submitLocationEnquiry } = require('../services/locationQuote/locationEnquiryService');
const { createLocationBlock } = require('../services/ops/domain/locationBlockService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const emailService = require('../services/emailService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let app;
let originalSendEmail;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
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

async function createValleySingle({ name, slug, pricePerNight, pricingModel = 'per_night', minGuests = 1, capacity = 4 }) {
  return Cabin.create({
    name,
    slug,
    description: 'Valley test cabin',
    capacity,
    minGuests,
    pricePerNight,
    pricingModel,
    minNights: 2,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
}

async function createValleyAFrames({ unitCount = 3, inactiveUnitIndexes = [] } = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'Test A-frame type',
    capacity: 2,
    pricePerNight: 60,
    pricingModel: 'per_night',
    minNights: 2,
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

  const units = [];
  for (let i = 1; i <= unitCount; i += 1) {
    const unit = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: `AF-${String(i).padStart(2, '0')}`,
      displayName: `A-Frame ${i}`,
      isActive: !inactiveUnitIndexes.includes(i)
    });
    units.push(unit);
  }

  return { cabinType, parentCabin, units };
}

async function createFullValleyInventory(opts = {}) {
  const stone = await createValleySingle({
    name: 'Stone House',
    slug: 'stone-house',
    pricePerNight: 25,
    pricingModel: 'per_person',
    minGuests: 3,
    capacity: 6
  });
  const lux = await createValleySingle({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    pricePerNight: 85,
    pricingModel: 'per_night',
    capacity: 2
  });
  const aframes = await createValleyAFrames(opts);
  return { stone, lux, aframes };
}

async function createBooking(overrides = {}) {
  const checkIn = overrides.checkIn || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(10, 'days').toDate();
  const checkOut = overrides.checkOut || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(14, 'days').toDate();
  return Booking.create({
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: guestInfo({ firstName: 'Secret', lastName: 'Guest', email: 'secret@example.com' }),
    totalPrice: 300,
    checkIn,
    checkOut,
    ...overrides
  });
}

async function createBlock({ cabinId, unitId = null, blockType = 'manual_block', checkIn, checkOut, metadata = {} }) {
  const { startDate, endDate } = normalizeGuestStayRange(checkIn, checkOut);
  return AvailabilityBlock.create({
    cabinId,
    unitId,
    blockType,
    startDate,
    endDate,
    status: 'active',
    source: 'internal_admin',
    metadata
  });
}

function quoteBody(overrides = {}) {
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  return {
    checkIn,
    checkOut,
    adults: 12,
    children: 0,
    ...overrides
  };
}

function assertNoPrivateLeak(obj) {
  const json = JSON.stringify(obj);
  assert.doesNotMatch(json, /guestLabel/i);
  assert.doesNotMatch(json, /reservationId/i);
  assert.doesNotMatch(json, /blockId/i);
  assert.doesNotMatch(json, /secret@example\.com/i);
  assert.doesNotMatch(json, /Secret Guest/i);
  assert.doesNotMatch(json, /[a-f0-9]{24}/i);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  originalSendEmail = emailService.sendEmail;
  emailService.sendEmail = async () => ({ success: true, method: 'test' });

  app = express();
  app.use(express.json());
  app.use('/api/public', require('../routes/publicLocationQuoteRoutes'));
  app.use('/api/public', require('../routes/publicLocationEnquiryRoutes'));
});

test.after(async () => {
  emailService.sendEmail = originalSendEmail;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    LocationEnquiry.deleteMany({})
  ]);
});

test('all Valley targets free → available true', async () => {
  await createFullValleyInventory({ unitCount: 2 });
  const quote = await buildPublicLocationQuote('valley', quoteBody());

  assert.equal(quote.available, true);
  assert.equal(quote.locationKey, 'valley');
  assert.equal(quote.locationSlug, 'the-valley');
  assert.equal(quote.nights, 4);
  assert.ok(quote.totalPrice > 0);
  assert.ok(Array.isArray(quote.includedAccommodations));
});

test('one A-frame unit booked → unavailable', async () => {
  const { aframes } = await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinTypeId: aframes.cabinType._id,
    unitId: aframes.units[0]._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
  assert.ok(quote.conflicts.length >= 1);
  assertNoPrivateLeak(quote);
});

test('Lux Cabin booked → unavailable', async () => {
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinId: lux._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
  assert.ok(quote.conflicts.some((c) => c.accommodationLabel === 'Lux Cabin'));
});

test('Stone House manual_block → unavailable', async () => {
  const { stone } = await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBlock({ cabinId: stone._id, blockType: 'manual_block', checkIn, checkOut });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
});

test('A-frame external_hold → unavailable with externally_reserved', async () => {
  const { aframes } = await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBlock({
    cabinId: aframes.parentCabin._id,
    unitId: aframes.units[1]._id,
    blockType: 'external_hold',
    checkIn,
    checkOut
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
  assert.ok(quote.conflicts.some((c) => c.reason === 'externally_reserved'));
  assertNoPrivateLeak(quote);
});

test('location-wide OPS manual block → unavailable', async () => {
  await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(20);
  const checkOut = sofiaDateOnly(24);

  await createLocationBlock({
    locationKey: 'valley',
    startDate: checkIn,
    endDate: checkOut,
    reason: 'Private retreat hold',
    ctx: { user: { role: 'admin' } }
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
});

test('maintenance block → unavailable', async () => {
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBlock({ cabinId: lux._id, blockType: 'maintenance', checkIn, checkOut });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
  assert.ok(quote.conflicts.some((c) => c.reason === 'maintenance'));
});

test('pooled A-frame booking without unitId → unavailable', async () => {
  const { aframes } = await createFullValleyInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinTypeId: aframes.cabinType._id,
    unitId: null,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const quote = await buildPublicLocationQuote('valley', quoteBody({ checkIn, checkOut }));
  assert.equal(quote.available, false);
});

test('inactive units excluded from target count and price', async () => {
  await createFullValleyInventory({ unitCount: 3, inactiveUnitIndexes: [3] });
  const body = quoteBody();
  const quote = await buildPublicLocationQuote('valley', body);

  assert.equal(quote.available, true);
  const aframeRow = quote.includedAccommodations.find((r) => r.kind === 'cabin_type_units');
  assert.equal(aframeRow.unitCount, 2);
  assert.equal(aframeRow.lodgingSubtotal, 60 * 2 * 4);
});

test('A-frame price = active unit count × nightly rate × nights', async () => {
  await createFullValleyInventory({ unitCount: 3 });
  const body = quoteBody();
  const quote = await buildPublicLocationQuote('valley', body);
  const aframeRow = quote.includedAccommodations.find((r) => r.kind === 'cabin_type_units');
  assert.equal(aframeRow.lodgingSubtotal, 60 * 3 * 4);
});

test('Stone House per_person requires guests and calculates correctly', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const body = quoteBody({ adults: 12, children: 0 });

  await assert.rejects(
    () => buildPublicLocationQuote('valley', { ...body, adults: 0, children: 0 }),
    (err) => err.message.includes('at least 3 guest')
  );

  const quote = await buildPublicLocationQuote('valley', body);
  const stoneRow = quote.includedAccommodations.find((r) => r.slug === 'stone-house');
  assert.equal(stoneRow.guestsUsed, 12);
  assert.equal(stoneRow.lodgingSubtotal, 25 * 12 * 4);
});

test('invalid dates rejected', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  await assert.rejects(
    () => buildPublicLocationQuote('valley', { checkIn: sofiaDateOnly(14), checkOut: sofiaDateOnly(10), adults: 6 }),
    (err) => err.code === 'validation'
  );
});

test('past check-in rejected', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  await assert.rejects(
    () =>
      buildPublicLocationQuote('valley', {
        checkIn: sofiaDateOnly(-5),
        checkOut: sofiaDateOnly(-1),
        adults: 6
      }),
    (err) => err.message.includes('past')
  );
});

test('invalid location rejected via HTTP', async () => {
  const res = await request(app)
    .post('/api/public/location-quotes/unknown-place')
    .send(quoteBody());
  assert.equal(res.status, 404);
});

test('public slug the-valley works via HTTP', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const res = await request(app)
    .post('/api/public/location-quotes/the-valley')
    .send(quoteBody());
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.available, true);
});

test('conflict response contains no private fields', async () => {
  const { lux } = await createFullValleyInventory({ unitCount: 1 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(14);
  await createBooking({
    cabinId: lux._id,
    guestInfo: guestInfo({ firstName: 'Private', lastName: 'Person', email: 'leak@private.com' }),
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const res = await request(app)
    .post('/api/public/location-quotes/valley')
    .send(quoteBody({ checkIn, checkOut }));

  assert.equal(res.body.data.available, false);
  assertNoPrivateLeak(res.body);
});

test('enquiry stores snapshot and does not create Booking or AvailabilityBlock', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const quote = await buildPublicLocationQuote('valley', quoteBody());

  const result = await submitLocationEnquiry({
    name: 'Jane Retreat',
    email: 'jane@example.com',
    phone: '+359888888888',
    checkIn: quote.checkIn,
    checkOut: quote.checkOut,
    adults: 12,
    children: 0,
    message: 'Team offsite',
    locationSlug: 'the-valley',
    quoteSnapshot: quote
  });

  assert.ok(result.enquiryId);
  const stored = await LocationEnquiry.findById(result.enquiryId).lean();
  assert.equal(stored.name, 'Jane Retreat');
  assert.equal(stored.quoteSnapshot.available, true);

  assert.equal(await Booking.countDocuments(), 0);
  assert.equal(await AvailabilityBlock.countDocuments(), 0);
});

test('enquiry endpoint returns success message via HTTP', async () => {
  await createFullValleyInventory({ unitCount: 1 });
  const quoteRes = await request(app)
    .post('/api/public/location-quotes/the-valley')
    .send(quoteBody());

  const res = await request(app)
    .post('/api/public/location-enquiries')
    .send({
      name: 'Alex Group',
      email: 'alex@example.com',
      checkIn: quoteRes.body.data.checkIn,
      checkOut: quoteRes.body.data.checkOut,
      adults: 10,
      children: 0,
      locationSlug: 'the-valley',
      quoteSnapshot: quoteRes.body.data
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.match(res.body.message, /confirm availability/i);
});
