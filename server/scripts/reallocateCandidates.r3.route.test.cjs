/**
 * R3 HTTP route auth + contract for GET /api/ops/reservations/:id/reallocate-candidates
 * Run: cd server && node --test scripts/reallocateCandidates.r3.route.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

const OpsUser = require('../models/OpsUser');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const StayChange = require('../models/StayChange');
const UnitNightClaim = require('../models/UnitNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const AuditEvent = require('../models/AuditEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const { createOpsUser } = require('../services/ops/opsUserService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;
let app;
let seq = 0;

function sofiaDay(daysAhead) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return normalizeDateToSofiaDayStart(d);
}

async function login(email, password) {
  const res = await request(app).post('/api/admin/login').send({ username: email, password });
  assert.equal(res.status, 200, res.body?.message);
  return res.body.token;
}

async function seedAllocated() {
  seq += 1;
  const ct = await CabinType.create({
    name: `R3R Type ${seq}`,
    slug: `r3r-type-${seq}`,
    description: 'r3r',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    pricePerNight: 100,
    imageUrl: 'https://example.com/r3r.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: `R3R Parent ${seq}`,
    slug: `r3r-parent-${seq}`,
    description: 'parent',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/p.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    cabinTypeId: ct._id,
    isActive: true
  });
  const units = [];
  for (let i = 0; i < 2; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    units.push(
      await Unit.create({
        cabinTypeId: ct._id,
        unitNumber: `R${i + 1}`,
        displayName: `Unit ${i + 1}`,
        isActive: true
      })
    );
  }
  const booking = await Booking.create({
    cabinTypeId: ct._id,
    unitId: units[0]._id,
    checkIn: sofiaDay(20),
    checkOut: sofiaDay(22),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Route',
      lastName: 'Guest',
      email: `r3r-${crypto.randomBytes(3).toString('hex')}@example.com`,
      phone: '+359800000000'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    legalAcceptance: {
      termsVersion: 't',
      activityRiskVersion: 'a',
      acceptedAt: new Date(),
      firstName: 'Route',
      lastName: 'Guest',
      checkbox1TextSnapshot: 'c1',
      checkbox2TextSnapshot: 'c2'
    }
  });
  return { booking, units, cabinType: ct };
}

async function snapshotCounts() {
  return {
    stayChange: await StayChange.countDocuments(),
    claims: await UnitNightClaim.countDocuments(),
    blocks: await AvailabilityBlock.countDocuments(),
    audit: await AuditEvent.countDocuments(),
    mri: await ManualReviewItem.countDocuments(),
    booking: await Booking.countDocuments()
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'r3-candidates-route-test-secret';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    OpsUser.deleteMany({}),
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    StayChange.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    AuditEvent.collection.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('R3 route#1 unauthenticated request denied', async () => {
  const { booking } = await seedAllocated();
  const res = await request(app).get(`/api/ops/reservations/${booking._id}/reallocate-candidates`);
  assert.ok(res.status === 401 || res.status === 403);
});

test('R3 route#2 operator with reservations module denied by reassign permission', async () => {
  await createOpsUser({
    email: 'r3.operator@test.local',
    name: 'R3 Operator',
    password: 'pass-123456',
    role: 'operator',
    modules: ['reservations']
  });
  const token = await login('r3.operator@test.local', 'pass-123456');
  const { booking } = await seedAllocated();
  const res = await request(app)
    .get(`/api/ops/reservations/${booking._id}/reallocate-candidates`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.errorType, 'permission');
});

test('R3 route#3 admin succeeds and returns candidates', async () => {
  await createOpsUser({
    email: 'r3.admin@test.local',
    name: 'R3 Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  const token = await login('r3.admin@test.local', 'pass-123456');
  const { booking, units } = await seedAllocated();
  const res = await request(app)
    .get(`/api/ops/reservations/${booking._id}/reallocate-candidates`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.candidates.length, 2);
  assert.equal(
    res.body.data.candidates.find((c) => c.unitId === String(units[0]._id)).state,
    'CURRENT'
  );
  assert.equal(
    res.body.data.candidates.find((c) => c.unitId === String(units[1]._id)).state,
    'AVAILABLE'
  );
});

test('R3 route#4 admin success is read-only (no durable writes)', async () => {
  await createOpsUser({
    email: 'r3.admin2@test.local',
    name: 'R3 Admin2',
    password: 'pass-123456',
    role: 'admin'
  });
  const token = await login('r3.admin2@test.local', 'pass-123456');
  const { booking } = await seedAllocated();
  const before = await snapshotCounts();
  const res = await request(app)
    .get(`/api/ops/reservations/${booking._id}/reallocate-candidates`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  const after = await snapshotCounts();
  assert.deepEqual(after, before);
});

test('R3 route#5 invalid reservation id returns 400 validation', async () => {
  await createOpsUser({
    email: 'r3.admin3@test.local',
    name: 'R3 Admin3',
    password: 'pass-123456',
    role: 'admin'
  });
  const token = await login('r3.admin3@test.local', 'pass-123456');
  const res = await request(app)
    .get('/api/ops/reservations/not-a-mongo-id/reallocate-candidates')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
});

test('R3 route#6 missing booking returns 404 domain error', async () => {
  await createOpsUser({
    email: 'r3.admin4@test.local',
    name: 'R3 Admin4',
    password: 'pass-123456',
    role: 'admin'
  });
  const token = await login('r3.admin4@test.local', 'pass-123456');
  const missing = new mongoose.Types.ObjectId();
  const res = await request(app)
    .get(`/api/ops/reservations/${missing}/reallocate-candidates`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 404);
});

test('R3 route#7 query/body cannot override stay dates or product', async () => {
  await createOpsUser({
    email: 'r3.admin5@test.local',
    name: 'R3 Admin5',
    password: 'pass-123456',
    role: 'admin'
  });
  const token = await login('r3.admin5@test.local', 'pass-123456');
  const { booking, cabinType } = await seedAllocated();
  const res = await request(app)
    .get(`/api/ops/reservations/${booking._id}/reallocate-candidates`)
    .query({
      cabinTypeId: new mongoose.Types.ObjectId().toString(),
      checkIn: '2099-01-01',
      checkOut: '2099-01-05',
      unitId: new mongoose.Types.ObjectId().toString()
    })
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.cabinTypeId, String(cabinType._id));
  assert.equal(res.body.data.candidates.every((c) => typeof c.state === 'string'), true);
});
