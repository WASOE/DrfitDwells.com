'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const bookingRoutes = require('../routes/bookingRoutes');
const BookingFunnelEvent = require('../models/BookingFunnelEvent');
const Cabin = require('../models/Cabin');

let mongoServer;
let app;

test.before(async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
  app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/bookings', bookingRoutes);
});

test.after(async () => {
  delete process.env.FUNNEL_TRACKING_ENABLED;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([BookingFunnelEvent.deleteMany({}), Cabin.deleteMany({})]);
});

test('quote validation failure records quote_failed without blocking response', async () => {
  const response = await request(app)
    .post('/api/bookings/quote')
    .send({
      checkIn: 'not-a-date',
      checkOut: '2026-07-05',
      adults: 2
    });

  assert.equal(response.status, 400);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const failed = await BookingFunnelEvent.findOne({ eventType: 'quote_failed' }).lean();
  assert.ok(failed);
  assert.equal(failed.quoteFailureClass, 'validation_error');
});

test('successful quote records quote_received', async () => {
  const cabin = await Cabin.create({
    name: 'Quote Hook Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    propertyKind: 'cabin',
    isActive: true,
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const response = await request(app)
    .post('/api/bookings/quote')
    .send({
      cabinId: String(cabin._id),
      checkIn: '2026-09-01',
      checkOut: '2026-09-03',
      adults: 2,
      children: 0,
      funnelSessionKey: 'quote-hook-session'
    });

  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const received = await BookingFunnelEvent.findOne({ eventType: 'quote_received' }).lean();
  assert.ok(received);
  assert.equal(received.sessionKey, 'quote-hook-session');
  assert.ok(received.priceShownCents > 0);
});
