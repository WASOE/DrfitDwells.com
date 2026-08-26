/**
 * Work Windows route tests (auth, module, validation).
 * Run: node --test server/scripts/workWindows.route.test.cjs
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
const { createToken } = require('../middleware/adminAuth');
const { PROPERTY_TIMEZONE } = require('../utils/dateTime');

let mongoServer;
let app;

function tokenFor({ sub = 'ww-route', role = 'admin', modules } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const resolvedModules =
    modules ||
    (role === 'admin' ? ['*'] : role === 'cleaner' ? ['cleaning'] : ['calendar', 'reservations', 'dashboard']);
  return createToken(
    {
      sub,
      role,
      modules: resolvedModules,
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `ww-${sub}-${role}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

function sofiaDateOnly(daysFromToday) {
  return moment.tz(PROPERTY_TIMEZONE).startOf('day').add(daysFromToday, 'days').format('YYYY-MM-DD');
}

test.before(async () => {
  process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'ww-route-test-secret';
  process.env.ADMIN_TOKEN_VERSION = process.env.ADMIN_TOKEN_VERSION || '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  // Require ops router after env is set
  const opsRouter = require('../routes/ops');
  app = express();
  app.use(express.json());
  app.use('/api/ops', opsRouter);

  await Cabin.create({
    name: 'Stone House Route WW',
    description: 'Valley test',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true,
    transportOptions: []
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('requires auth', async () => {
  const res = await request(app).get('/api/ops/work-windows').query({
    locationKey: 'valley',
    from: sofiaDateOnly(0),
    to: sofiaDateOnly(10)
  });
  assert.equal(res.status, 401);
});

test('operator with calendar module can read', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'operator' })}`)
    .query({
      locationKey: 'valley',
      from: sofiaDateOnly(0),
      to: sofiaDateOnly(10)
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.data.generatedAt);
  assert.equal(res.body.data.locationKey, 'valley');
  assert.ok(Array.isArray(res.body.data.resources));
  assert.ok(res.body.data.resources[0].kind === 'location');
  assert.ok(Array.isArray(res.body.data.bestWindows));
  assert.ok(Array.isArray(res.body.data.dayKeys));
  assert.equal(res.body.data.checkInTime, '15:00');
  assert.equal(res.body.data.checkOutTime, '11:00');
});

test('cleaner forbidden', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'cleaner', modules: ['cleaning'] })}`)
    .query({
      locationKey: 'valley',
      from: sofiaDateOnly(0),
      to: sofiaDateOnly(10)
    });
  assert.ok(res.status === 403 || res.status === 401);
});

test('bad location key rejected', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
    .query({
      locationKey: 'not-a-place',
      from: sofiaDateOnly(0),
      to: sofiaDateOnly(10)
    });
  assert.equal(res.status, 400);
});

test('bad range rejected', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
    .query({
      locationKey: 'valley',
      from: sofiaDateOnly(10),
      to: sofiaDateOnly(5)
    });
  assert.equal(res.status, 400);
});

test('> 92 exclusive days rejected', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
    .query({
      locationKey: 'valley',
      from: sofiaDateOnly(0),
      to: sofiaDateOnly(93)
    });
  assert.equal(res.status, 400);
  assert.match(String(res.body.message || ''), /92/);
});

test('92 exclusive days accepted', async () => {
  const res = await request(app)
    .get('/api/ops/work-windows')
    .set('Authorization', `Bearer ${tokenFor({ role: 'admin' })}`)
    .query({
      locationKey: 'valley',
      from: sofiaDateOnly(0),
      to: sofiaDateOnly(92)
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.dayKeys.length, 92);
});
