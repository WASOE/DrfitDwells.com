/**
 * Location-wide OPS availability blocks.
 * Run: node --test server/scripts/locationBlockService.test.cjs
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
const AuditEvent = require('../models/AuditEvent');
const { createToken } = require('../middleware/adminAuth');
const { evaluateTargetConflicts } = require('../services/ops/domain/conflictService');
const { resolveLocationTargets } = require('../services/ops/domain/locationInventoryService');
const { previewLocationBlock } = require('../services/ops/domain/locationBlockService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

let mongoServer;
let app;

function adminToken({ sub = 'location-block-test', role = 'admin' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return createToken(
    {
      sub,
      role,
      modules: ['*'],
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `location-block-${sub}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

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
    name: `A-Frame ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'Test A-frame type',
    capacity: 2,
    pricePerNight: 60,
    minNights: 1,
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
    minNights: 1,
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
      isActive: true
    });
    units.push(unit);
  }

  return { cabinType, parentCabin, units };
}

async function createBooking(overrides = {}) {
  const checkIn = overrides.checkIn || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(10, 'days').toDate();
  const checkOut = overrides.checkOut || moment.tz(PROPERTY_TIMEZONE).startOf('day').add(13, 'days').toDate();
  return Booking.create({
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: guestInfo(),
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

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'location-block-test-secret';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await AuditEvent.syncIndexes();

  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../routes/ops/modules/availabilityActionsRoutes')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];

  app = express();
  app.use(express.json());
  app.use('/api/ops', require('../routes/ops/index'));
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

test('resolveLocationTargets returns valley singles and individual A-frame units', async () => {
  await createValleySingle('Stone House');
  await createValleySingle('Lux Cabin');
  const { units } = await createValleyMultiInventory({ unitCount: 3 });

  const inventory = await resolveLocationTargets('valley');
  assert.equal(inventory.targets.length, 5);
  assert.ok(inventory.targets.some((t) => t.kind === 'single_cabin' && t.label === 'Stone House'));
  assert.ok(inventory.targets.some((t) => t.kind === 'unit' && String(t.unitId) === String(units[0]._id)));
  assert.equal(inventory.targets.filter((t) => t.kind === 'unit').length, 3);
});

test('evaluateTargetConflicts detects single cabin reservation', async () => {
  const cabin = await createValleySingle('Stone House');
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({ cabinId: cabin._id, checkIn: new Date(checkIn), checkOut: new Date(checkOut) });

  const conflict = await evaluateTargetConflicts({
    cabinId: cabin._id,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts[0].kind, 'reservation');
});

test('evaluateTargetConflicts detects A-frame unit reservation', async () => {
  const { parentCabin, units, cabinType } = await createValleyMultiInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({
    cabinTypeId: cabinType._id,
    unitId: units[0]._id,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const conflict = await evaluateTargetConflicts({
    cabinId: parentCabin._id,
    unitId: units[0]._id,
    cabinTypeId: cabinType._id,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts.some((c) => c.kind === 'reservation'), true);
});

test('evaluateTargetConflicts treats pooled A-frame booking as hard conflict', async () => {
  const { parentCabin, units, cabinType } = await createValleyMultiInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({
    cabinTypeId: cabinType._id,
    unitId: null,
    status: 'pending',
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const conflict = await evaluateTargetConflicts({
    cabinId: parentCabin._id,
    unitId: units[1]._id,
    cabinTypeId: cabinType._id,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts.some((c) => c.kind === 'reservation' && c.pooled === true), true);
});

test('evaluateTargetConflicts treats parent-wide block as hard conflict for units', async () => {
  const { parentCabin, units } = await createValleyMultiInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBlock({
    cabinId: parentCabin._id,
    unitId: null,
    blockType: 'maintenance',
    checkIn,
    checkOut
  });

  const conflict = await evaluateTargetConflicts({
    cabinId: parentCabin._id,
    unitId: units[0]._id,
    cabinTypeId: units[0].cabinTypeId,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts.some((c) => c.kind === 'availability_block' && c.parentWide === true), true);
});

test('evaluateTargetConflicts treats external_hold as hard conflict for location-wide', async () => {
  const cabin = await createValleySingle('Lux Cabin');
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBlock({
    cabinId: cabin._id,
    blockType: 'external_hold',
    checkIn,
    checkOut
  });

  const conflict = await evaluateTargetConflicts({
    cabinId: cabin._id,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts[0].blockType, 'external_hold');
});

test('evaluateTargetConflicts detects legacy blocked dates on cabin', async () => {
  const blockedDay = moment.tz(PROPERTY_TIMEZONE).startOf('day').add(11, 'days').toDate();
  const cabin = await createValleySingle('Stone House', { blockedDates: [blockedDay] });
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);

  const conflict = await evaluateTargetConflicts({
    cabinId: cabin._id,
    startDate: checkIn,
    endDate: checkOut,
    treatExternalHoldAsHard: true
  });

  assert.equal(conflict.hasHardConflicts, true);
  assert.equal(conflict.hardConflicts[0].kind, 'legacy_blocked_date');
});

test('previewLocationBlock returns canBlock false when any target conflicts', async () => {
  const cabin = await createValleySingle('Lux Cabin');
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({ cabinId: cabin._id, checkIn: new Date(checkIn), checkOut: new Date(checkOut) });

  const preview = await previewLocationBlock({
    locationKey: 'valley',
    startDate: checkIn,
    endDate: checkOut
  });

  assert.equal(preview.canBlock, false);
  assert.ok(preview.conflictedTargetCount >= 1);
});

test('create location block returns 409 and creates zero blocks on conflict', async () => {
  const cabin = await createValleySingle('Lux Cabin');
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({ cabinId: cabin._id, checkIn: new Date(checkIn), checkOut: new Date(checkOut) });
  const token = adminToken();

  const res = await request(app)
    .post('/api/ops/availability/location-blocks')
    .set('Authorization', `Bearer ${token}`)
    .send({ locationKey: 'valley', startDate: checkIn, endDate: checkOut, reason: 'Full buyout test' });

  assert.equal(res.status, 409);
  assert.equal(res.body.success, false);
  const count = await AvailabilityBlock.countDocuments({ status: 'active' });
  assert.equal(count, 0);
});

test('create location block writes one block per target with shared group id', async () => {
  await createValleySingle('Stone House');
  await createValleySingle('Lux Cabin');
  await createValleyMultiInventory({ unitCount: 2 });
  const checkIn = sofiaDateOnly(20);
  const checkOut = sofiaDateOnly(23);
  const token = adminToken();

  const res = await request(app)
    .post('/api/ops/availability/location-blocks')
    .set('Authorization', `Bearer ${token}`)
    .send({ locationKey: 'valley', startDate: checkIn, endDate: checkOut, reason: 'Private event' });

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  const groupId = res.body.data.locationBlockGroupId;
  assert.ok(groupId);
  assert.equal(res.body.data.targetCount, 4);

  const blocks = await AvailabilityBlock.find({ status: 'active', 'metadata.locationBlockGroupId': groupId }).lean();
  assert.equal(blocks.length, 4);
  assert.ok(blocks.every((b) => b.metadata.locationKey === 'valley'));
  assert.ok(blocks.some((b) => b.unitId));
  assert.ok(blocks.some((b) => !b.unitId));
});

test('remove location block group tombstones all active blocks', async () => {
  await createValleySingle('Stone House');
  const checkIn = sofiaDateOnly(30);
  const checkOut = sofiaDateOnly(33);
  const token = adminToken();

  const createRes = await request(app)
    .post('/api/ops/availability/location-blocks')
    .set('Authorization', `Bearer ${token}`)
    .send({ locationKey: 'valley', startDate: checkIn, endDate: checkOut });

  const groupId = createRes.body.data.locationBlockGroupId;

  const removeRes = await request(app)
    .post(`/api/ops/availability/location-blocks/${groupId}/remove`)
    .set('Authorization', `Bearer ${token}`)
    .send({ reason: 'Cancelled' });

  assert.equal(removeRes.status, 200);
  assert.equal(removeRes.body.data.removedCount, 1);
  const active = await AvailabilityBlock.countDocuments({ 'metadata.locationBlockGroupId': groupId, status: 'active' });
  assert.equal(active, 0);
});

test('isTest bookings are ignored for location-wide conflicts', async () => {
  const cabin = await createValleySingle('Lux Cabin');
  const checkIn = sofiaDateOnly(10);
  const checkOut = sofiaDateOnly(13);
  await createBooking({
    cabinId: cabin._id,
    isTest: true,
    checkIn: new Date(checkIn),
    checkOut: new Date(checkOut)
  });

  const preview = await previewLocationBlock({
    locationKey: 'valley',
    startDate: checkIn,
    endDate: checkOut
  });

  assert.equal(preview.canBlock, true);
});
