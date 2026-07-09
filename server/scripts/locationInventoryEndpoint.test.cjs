/**
 * Public whole-location inventory catalog (date-independent, no conflict engine).
 * Run: node --test server/scripts/locationInventoryEndpoint.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const { buildPublicLocationInventory } = require('../services/locationQuote/locationInventoryCatalogService');
const locationConflictService = require('../services/ops/domain/locationConflictService');

let mongoServer;
let app;
let originalEvaluateLocationConflicts;
let conflictCallCount;

async function createValleySingle({
  name,
  slug,
  pricePerNight,
  buyoutPricePerNight,
  capacity = 4,
  bedConfig = []
}) {
  return Cabin.create({
    name,
    slug,
    description: 'Inventory test cabin',
    capacity,
    minGuests: 1,
    pricePerNight,
    buyoutPricePerNight,
    pricingModel: slug === 'stone-house' ? 'per_person' : 'per_night',
    minNights: 2,
    bedConfig,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
}

async function createValleyAFrames({ unitCount = 2 } = {}) {
  const suffix = new mongoose.Types.ObjectId().toString().slice(-6);
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: `a-frame-${suffix}`,
    description: 'Inventory test A-frame',
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

  const units = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      await Unit.create({
        cabinTypeId: cabinType._id,
        unitNumber: `AF-${String(i).padStart(2, '0')}`,
        displayName: `A-Frame ${i}`,
        isActive: true
      })
    );
  }

  return { cabinType, parentCabin, units };
}

async function seedFullValleyInventory() {
  const stone = await createValleySingle({
    name: 'Stone House',
    slug: 'stone-house',
    pricePerNight: 25,
    buyoutPricePerNight: 180,
    capacity: 6,
    bedConfig: [
      { bedType: 'double', count: 2 },
      { bedType: 'single', count: 2 }
    ]
  });
  const lux = await createValleySingle({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    pricePerNight: 85,
    buyoutPricePerNight: 85,
    capacity: 2,
    bedConfig: [{ bedType: 'double', count: 1 }]
  });
  const aframes = await createValleyAFrames({ unitCount: 2 });
  return { stone, lux, aframes };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });

  originalEvaluateLocationConflicts = locationConflictService.evaluateLocationConflicts;
  conflictCallCount = 0;
  locationConflictService.evaluateLocationConflicts = async () => {
    conflictCallCount += 1;
    throw new Error('evaluateLocationConflicts must not be called by inventory catalog');
  };

  app = express();
  app.use(express.json());
  app.use('/api/public', require('../routes/publicLocationInventoryRoutes'));
});

test.after(async () => {
  locationConflictService.evaluateLocationConflicts = originalEvaluateLocationConflicts;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  conflictCallCount = 0;
  await Promise.all([Cabin.deleteMany({}), CabinType.deleteMany({}), Unit.deleteMany({})]);
});

test('GET /api/public/location-inventory/the-valley returns catalog without conflict engine', async () => {
  await seedFullValleyInventory();

  const res = await request(app).get('/api/public/location-inventory/the-valley').expect(200);

  assert.equal(res.body.success, true);
  const data = res.body.data;

  assert.equal(data.locationKey, 'valley');
  assert.equal(data.locationSlug, 'the-valley');
  assert.equal(data.totalSleeps, 12);
  assert.equal(data.buildingCount, 4);
  assert.equal(data.maxMinNights, 2);
  assert.equal(data.includedTargets.length, 3);

  const stone = data.includedTargets.find((row) => row.slug === 'stone-house');
  const lux = data.includedTargets.find((row) => row.slug === 'lux-cabin');
  const aframe = data.includedTargets.find((row) => row.kind === 'cabin_type_units');

  assert.equal(stone.sleeps, 6);
  assert.equal(lux.sleeps, 2);
  assert.equal(aframe.unitCount, 2);
  assert.equal(aframe.sleeps, 4);
  assert.equal(data.includedTargets.reduce((sum, row) => sum + row.sleeps, 0), 12);

  assert.equal(data.fromPrice.nightlyTotal, 385);
  assert.equal(data.fromPrice.amount, 770);
  assert.equal(data.fromPrice.nights, 2);
  assert.equal(data.fromPrice.basis, 'minimum_stay');
  assert.equal(data.fromPrice.hasSeasonalCalendar, false);
  assert.equal(data.fromPrice.derivation, 'flat_buyout_rates');
  assert.equal(data.fromPrice.label, 'from');
  assert.equal(data.fromPrice.currency, 'EUR');

  assert.equal(conflictCallCount, 0);
});

test('buildPublicLocationInventory does not invoke conflict engine', async () => {
  await seedFullValleyInventory();

  const data = await buildPublicLocationInventory('valley');

  assert.equal(data.totalSleeps, 12);
  assert.equal(data.buildingCount, 4);
  assert.equal(data.fromPrice.nightlyTotal, 385);
  assert.equal(data.fromPrice.amount, 770);
  assert.equal(conflictCallCount, 0);
});

test('GET /api/public/location-inventory/unknown returns 404', async () => {
  const res = await request(app).get('/api/public/location-inventory/nowhere').expect(404);
  assert.equal(res.body.success, false);
  assert.equal(conflictCallCount, 0);
});
