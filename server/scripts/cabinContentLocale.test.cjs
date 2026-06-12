/**
 * Guest endpoints — per-locale cabin content overlay (i18n.bg).
 *
 * Verifies that `locale=bg` returns Bulgarian name/location/description where
 * translations exist, falls back to English where they don't, and that
 * requests without a locale are byte-for-byte unchanged English.
 *
 * Run: node --test server/scripts/cabinContentLocale.test.cjs
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
const availabilityRoutes = require('../routes/availabilityRoutes');
const cabinRoutes = require('../routes/cabinRoutes');
const cabinTypeRoutes = require('../routes/cabinTypeRoutes');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

const BG = {
  name: 'Лукс къща',
  location: 'Черешово / Орцево, Родопите, България',
  description: 'Напълно самостоятелна офгрид къща.'
};

const EN = {
  name: 'Lux Cabin',
  location: 'Chereshovo / Ortsevo, Rhodope Mountains, Bulgaria',
  description: 'A fully private off-grid cabin.'
};

let mongoServer;
let app;

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/availability', availabilityRoutes);
  instance.use('/api/cabins', cabinRoutes);
  instance.use('/api/cabin-types', cabinTypeRoutes);
  return instance;
}

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: EN.name,
    description: EN.description,
    location: EN.location,
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
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

test('GET /api/availability without locale returns English content', async () => {
  const cabin = await createCabin({ i18n: { bg: BG } });

  const res = await request(app)
    .get('/api/availability')
    .query({ checkIn: sofiaDateOnly(30), checkOut: sofiaDateOnly(32), adults: 2, children: 0 });

  assert.equal(res.status, 200);
  const row = res.body.data.cabins.find((c) => String(c._id) === String(cabin._id));
  assert.ok(row);
  assert.equal(row.name, EN.name);
  assert.equal(row.location, EN.location);
  assert.equal(row.description, EN.description);

  await Cabin.deleteMany({});
});

test('GET /api/availability with locale=bg returns Bulgarian content', async () => {
  const cabin = await createCabin({ i18n: { bg: BG } });

  const res = await request(app)
    .get('/api/availability')
    .query({ checkIn: sofiaDateOnly(30), checkOut: sofiaDateOnly(32), adults: 2, children: 0, locale: 'bg' });

  assert.equal(res.status, 200);
  const row = res.body.data.cabins.find((c) => String(c._id) === String(cabin._id));
  assert.ok(row);
  assert.equal(row.name, BG.name);
  assert.equal(row.location, BG.location);
  assert.equal(row.description, BG.description);

  await Cabin.deleteMany({});
});

test('GET /api/availability with locale=bg falls back to English for untranslated cabins', async () => {
  const cabin = await createCabin();

  const res = await request(app)
    .get('/api/availability')
    .query({ checkIn: sofiaDateOnly(30), checkOut: sofiaDateOnly(32), adults: 2, children: 0, locale: 'bg' });

  assert.equal(res.status, 200);
  const row = res.body.data.cabins.find((c) => String(c._id) === String(cabin._id));
  assert.ok(row);
  assert.equal(row.name, EN.name);
  assert.equal(row.description, EN.description);

  await Cabin.deleteMany({});
});

test('GET /api/availability rejects unsupported locale values', async () => {
  const res = await request(app)
    .get('/api/availability')
    .query({ checkIn: sofiaDateOnly(30), checkOut: sofiaDateOnly(32), adults: 2, children: 0, locale: 'de' });

  assert.equal(res.status, 400);
});

test('GET /api/cabins/:id honours locale=bg with per-field fallback', async () => {
  const cabin = await createCabin({ i18n: { bg: { name: BG.name } } });

  const resBg = await request(app).get(`/api/cabins/${cabin._id}`).query({ locale: 'bg' });
  assert.equal(resBg.status, 200);
  assert.equal(resBg.body.data.cabin.name, BG.name);
  // location/description untranslated → fall back to English
  assert.equal(resBg.body.data.cabin.location, EN.location);
  assert.equal(resBg.body.data.cabin.description, EN.description);

  const resEn = await request(app).get(`/api/cabins/${cabin._id}`);
  assert.equal(resEn.body.data.cabin.name, EN.name);

  await Cabin.deleteMany({});
});

test('GET /api/cabin-types/:slug honours locale=bg and keeps multi-unit meta', async () => {
  const cabinType = await CabinType.create({
    name: 'A-Frame',
    slug: 'a-frame',
    description: EN.description,
    location: EN.location,
    capacity: 2,
    minGuests: 1,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    isActive: true,
    transportOptions: [],
    i18n: { bg: { name: 'А-фрейм', location: BG.location, description: BG.description } }
  });
  await Unit.create({ cabinTypeId: cabinType._id, unitNumber: 'AF-01', isActive: true });

  const resBg = await request(app).get('/api/cabin-types/a-frame').query({ locale: 'bg' });
  assert.equal(resBg.status, 200);
  assert.equal(resBg.body.data.cabinType.name, 'А-фрейм');
  assert.equal(resBg.body.data.cabinType.location, BG.location);
  assert.equal(typeof resBg.body.data.cabinType.meta.isMultiUnit, 'boolean');

  const resEn = await request(app).get('/api/cabin-types/a-frame');
  assert.equal(resEn.body.data.cabinType.name, 'A-Frame');

  await Unit.deleteMany({});
  await CabinType.deleteMany({});
});
