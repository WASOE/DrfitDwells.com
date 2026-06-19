'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const funnelEventRoutes = require('../routes/funnelEventRoutes');
const { funnelEventLimiter } = require('../routes/funnelEventRoutes');
const BookingFunnelEvent = require('../models/BookingFunnelEvent');

let mongoServer;
let app;

function buildApp() {
  const instance = express();
  instance.use('/api/funnel-events', funnelEventLimiter, express.json({ limit: '8kb' }), funnelEventRoutes);
  return instance;
}

test.before(async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  delete process.env.FUNNEL_TRACKING_ENABLED;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await BookingFunnelEvent.deleteMany({});
});

test('valid property_view returns 202 and inserts row', async () => {
  const cabinId = new mongoose.Types.ObjectId().toString();
  const response = await request(app)
    .post('/api/funnel-events')
    .send({ eventType: 'property_view', sessionKey: 'sess-abc', cabinId });
  assert.equal(response.status, 202);
  assert.equal(response.body.success, true);
  assert.equal(await BookingFunnelEvent.countDocuments({ eventType: 'property_view' }), 1);
});

test('duplicate property_view returns duplicate flag', async () => {
  const cabinId = new mongoose.Types.ObjectId().toString();
  const payload = { eventType: 'property_view', sessionKey: 'sess-dup', cabinId };
  await request(app).post('/api/funnel-events').send(payload);
  const second = await request(app).post('/api/funnel-events').send(payload);
  assert.equal(second.body.duplicate, true);
  assert.equal(await BookingFunnelEvent.countDocuments({}), 1);
});

test('invalid eventType returns 400', async () => {
  const response = await request(app)
    .post('/api/funnel-events')
    .send({ eventType: 'booking_converted', sessionKey: 'sess-1' });
  assert.equal(response.status, 400);
});

test('feature flag off returns skipped', async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '0';
  const cabinId = new mongoose.Types.ObjectId().toString();
  const response = await request(app)
    .post('/api/funnel-events')
    .send({ eventType: 'property_view', sessionKey: 'sess-off', cabinId });
  assert.equal(response.status, 202);
  assert.equal(response.body.skipped, true);
  assert.equal(await BookingFunnelEvent.countDocuments({}), 0);
  process.env.FUNNEL_TRACKING_ENABLED = '1';
});
