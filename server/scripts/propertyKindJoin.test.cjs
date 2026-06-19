'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const {
  loadPropertyKindMaps,
  resolveBookingPropertyKind,
  bookingMatchesPropertyKind
} = require('../services/ops/reporting/propertyKindJoin');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Cabin.deleteMany({}), CabinType.deleteMany({}), Booking.deleteMany({})]);
});

test('cabinId booking resolves to cabin', async () => {
  const cabin = await Cabin.create({
    name: 'The Cabin Test',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });
  const maps = await loadPropertyKindMaps();
  const booking = { cabinId: cabin._id };
  const resolved = resolveBookingPropertyKind(booking, maps);
  assert.equal(resolved.propertyKind, 'cabin');
  assert.equal(resolved.issue, null);
});

test('cabinTypeId booking resolves to valley', async () => {
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${Date.now()}`,
    description: 'd',
    location: 'Chereshovo',
    imageUrl: 'https://example.com/aframe.jpg',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'valley'
  });
  const maps = await loadPropertyKindMaps();
  const booking = { cabinTypeId: cabinType._id };
  const resolved = resolveBookingPropertyKind(booking, maps);
  assert.equal(resolved.propertyKind, 'valley');
});

test('missing propertyKind returns null issue', async () => {
  const cabin = await Cabin.create({
    name: 'Unset Kind Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    imageUrl: 'https://example.com/cabin.jpg'
  });
  const maps = await loadPropertyKindMaps();
  const resolved = resolveBookingPropertyKind({ cabinId: cabin._id }, maps);
  assert.equal(resolved.propertyKind, null);
  assert.equal(resolved.issue, 'missing_property_kind');
});

test('bookingMatchesPropertyKind excludes missing kind', async () => {
  const cabin = await Cabin.create({
    name: 'Unset Kind Cabin 2',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    imageUrl: 'https://example.com/cabin.jpg'
  });
  const maps = await loadPropertyKindMaps();
  const booking = { cabinId: cabin._id };
  assert.equal(bookingMatchesPropertyKind(booking, 'cabin', maps), false);
});
