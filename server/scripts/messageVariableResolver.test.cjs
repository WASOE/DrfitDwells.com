/**
 * Batch C5 — cleaner variable bag (no guest PII).
 * Run: npm run test:message-variable-resolver (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const { CLEANER_VARIABLE_SCHEMA } = require('../data/messageTemplates/gmaApprovedCopy');
const {
  resolveVariables,
  resolveGuestVariables,
  resolveCleanerVariables,
  CLEANER_FORBIDDEN_GUEST_PII_KEYS
} = require('../services/messaging/messageVariableResolver');

let mongoServer;

function futureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function insertCabin(overrides = {}) {
  return Cabin.create({
    name: 'The Cabin',
    description: 'test',
    location: 'Rhodopes',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin',
    meetingPoint: {
      label: 'Park-and-walk point for The Cabin',
      googleMapsUrl: 'https://www.google.com/maps/place/cabin-park'
    },
    arrivalGuideUrl: '/guides/the-cabin',
    arrivalWindowDefault: 'From 15:00. Park and walk.',
    ...overrides
  });
}

async function insertCabinType(overrides = {}) {
  return CabinType.create({
    name: 'The Valley',
    slug: 'the-valley',
    description: 'test',
    location: 'Valley',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/valley.jpg',
    propertyKind: 'valley',
    meetingPoint: {
      label: 'Chereshovo parking — last km on foot/jeep/ATV',
      googleMapsUrl: 'https://maps.app.goo.gl/vTk7jCrGtxvbKsJB6'
    },
    arrivalGuideUrl: '/guides/the-valley',
    arrivalWindowDefault: 'From 15:00. Last 1 km on foot, jeep, horse or ATV only.',
    ...overrides
  });
}

async function insertBooking({ cabin, cabinType, overrides = {} }) {
  return Booking.create({
    cabinId: cabin?._id || null,
    cabinTypeId: cabinType?._id || null,
    checkIn: futureDate(5),
    checkOut: futureDate(8),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Secret',
      lastName: 'Guest',
      email: 'secret.guest@example.com',
      phone: '+359889999999'
    },
    status: 'confirmed',
    totalPrice: 300,
    subtotalPrice: 300,
    discountAmount: 0,
    totalValueCents: 30000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 30000,
    stripePaymentIntentId: 'pi_test_cleaner_vars',
    cleaningNotes: overrides.cleaningNotes,
    ...overrides
  });
}

function assertNoGuestPiiInCleanerBag(variables) {
  for (const key of CLEANER_FORBIDDEN_GUEST_PII_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(variables, key), false, `forbidden key present: ${key}`);
  }
  const serialized = JSON.stringify(variables);
  assert.equal(serialized.includes('secret.guest@example.com'), false);
  assert.equal(serialized.includes('+359889999999'), false);
  assert.equal(serialized.includes('Secret'), false);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Cabin.deleteMany({}), CabinType.deleteMany({}), Booking.deleteMany({})]);
});

test('CLEANER_VARIABLE_SCHEMA is exported and excludes guest PII keys', () => {
  assert.ok(CLEANER_VARIABLE_SCHEMA.properties);
  assert.equal(CLEANER_VARIABLE_SCHEMA.properties.guestFirstName, undefined);
  assert.ok(CLEANER_VARIABLE_SCHEMA.required.includes('propertyName'));
  assert.ok(CLEANER_VARIABLE_SCHEMA.required.includes('checkoutTime'));
});

test('resolveCleanerVariables: cabin booking resolves operational keys', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({
    cabin,
    overrides: { cleaningNotes: 'Deep clean requested' }
  });
  const result = await resolveCleanerVariables({ booking, stayTarget: cabin });
  assert.equal(result.ok, true);
  assertNoGuestPiiInCleanerBag(result.variables);
  assert.equal(result.variables.propertyName, 'The Cabin');
  assert.equal(result.variables.unitLabel, 'The Cabin');
  assert.match(result.variables.checkOutDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result.variables.checkoutTime, '11:00');
  assert.equal(result.variables.cleaningNotes, 'Deep clean requested');
  assert.equal(result.variables.meetingPointLabel, 'Park-and-walk point for The Cabin');
  assert.match(result.variables.guideUrl, /guides\/the-cabin/);
  assert.equal(result.variables.accessNote, 'From 15:00. Park and walk.');
});

test('resolveCleanerVariables: cleaningNotes empty when absent', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin, overrides: { cleaningNotes: null } });
  const result = await resolveCleanerVariables({ booking, stayTarget: cabin });
  assert.equal(result.ok, true);
  assert.equal(result.variables.cleaningNotes, '');
});

test('resolveCleanerVariables: valley access fields differ from cabin', async () => {
  const cabin = await insertCabin();
  const cabinType = await insertCabinType();
  const cabinBooking = await insertBooking({ cabin });
  const valleyBooking = await insertBooking({ cabinType });

  const cabinResult = await resolveCleanerVariables({ booking: cabinBooking, stayTarget: cabin });
  const valleyResult = await resolveCleanerVariables({ booking: valleyBooking, stayTarget: cabinType });

  assert.equal(cabinResult.variables.meetingPointLabel, 'Park-and-walk point for The Cabin');
  assert.equal(valleyResult.variables.meetingPointLabel, 'Chereshovo parking — last km on foot/jeep/ATV');
  assert.notEqual(cabinResult.variables.accessNote, valleyResult.variables.accessNote);
  assert.match(valleyResult.variables.accessNote, /ATV/);
});

test('resolveVariables audience branch: cleaner vs guest unchanged', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin });

  const guest = await resolveVariables({ booking, stayTarget: cabin, audience: 'guest' });
  const cleaner = await resolveVariables({ booking, stayTarget: cabin, audience: 'cleaner' });

  assert.equal(guest.ok, true);
  assert.equal(guest.variables.guestFirstName, 'Secret');
  assert.equal(cleaner.ok, true);
  assertNoGuestPiiInCleanerBag(cleaner.variables);
});

test('resolveGuestVariables unchanged for guest path', async () => {
  const cabin = await insertCabin();
  const booking = await insertBooking({ cabin });
  const result = resolveGuestVariables({ booking, stayTarget: cabin });
  assert.equal(result.ok, true);
  assert.equal(result.variables.guestFirstName, 'Secret');
  assert.equal(result.variables.propertyName, 'The Cabin');
});
