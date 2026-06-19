'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const BookingFunnelEvent = require('../models/BookingFunnelEvent');
const {
  recordClientFunnelEvent,
  mapQuoteFailureClass,
  isFunnelTrackingEnabled
} = require('../services/conversion/funnelEventService');

let mongoServer;

test.before(async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
});

test.after(async () => {
  delete process.env.FUNNEL_TRACKING_ENABLED;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([Cabin.deleteMany({}), BookingFunnelEvent.deleteMany({})]);
});

test('rejects unknown client event type', async () => {
  await assert.rejects(() =>
    recordClientFunnelEvent({ eventType: 'booking_converted', sessionKey: 'sess-1' })
  );
});

test('rejects PII fields on client ingest', async () => {
  await assert.rejects(() =>
    recordClientFunnelEvent({
      eventType: 'property_view',
      sessionKey: 'sess-1',
      cabinId: new mongoose.Types.ObjectId().toString(),
      email: 'guest@example.com'
    })
  );
});

test('property_view dedupes within same session and day', async () => {
  const cabinId = new mongoose.Types.ObjectId().toString();
  const payload = { eventType: 'property_view', sessionKey: 'sess-1', cabinId };
  const first = await recordClientFunnelEvent(payload);
  const second = await recordClientFunnelEvent(payload);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(await BookingFunnelEvent.countDocuments({}), 1);
});

test('checkout_started stores checkoutId and dedupes', async () => {
  const cabin = await Cabin.create({
    name: 'Checkout Cabin',
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 2,
    propertyKind: 'cabin',
    imageUrl: 'https://example.com/cabin.jpg'
  });

  const payload = {
    eventType: 'checkout_started',
    sessionKey: 'sess-checkout',
    cabinId: String(cabin._id),
    checkInDateOnly: '2026-08-01',
    checkOutDateOnly: '2026-08-04',
    adults: 2,
    children: 0,
    checkoutId: 'chk-abc'
  };

  const first = await recordClientFunnelEvent(payload);
  const second = await recordClientFunnelEvent(payload);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);

  const stored = await BookingFunnelEvent.findOne({ eventType: 'checkout_started' }).lean();
  assert.equal(stored.checkoutId, 'chk-abc');
  assert.equal(stored.propertyKind, 'cabin');
});

test('checkout_started pay-on-arrival fallback dedupes by stay identity', async () => {
  const cabinId = new mongoose.Types.ObjectId().toString();
  const payload = {
    eventType: 'checkout_started',
    sessionKey: 'sess-poa',
    cabinId,
    checkInDateOnly: '2026-08-01',
    checkOutDateOnly: '2026-08-04',
    adults: 2,
    children: 0
  };
  const first = await recordClientFunnelEvent(payload);
  const second = await recordClientFunnelEvent(payload);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
});

test('mapQuoteFailureClass never returns raw messages', () => {
  const cls = mapQuoteFailureClass({ status: 409, message: 'No units available for the selected dates' });
  assert.equal(cls, 'unavailable');
});

test('feature flag off makes record functions no-op', async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '0';
  const result = await recordClientFunnelEvent({
    eventType: 'property_view',
    sessionKey: 'sess-1',
    cabinId: new mongoose.Types.ObjectId().toString()
  });
  assert.equal(result.skipped, true);
  assert.equal(await BookingFunnelEvent.countDocuments({}), 0);
  process.env.FUNNEL_TRACKING_ENABLED = '1';
});

test('isFunnelTrackingEnabled respects env flag', () => {
  process.env.FUNNEL_TRACKING_ENABLED = '1';
  assert.equal(isFunnelTrackingEnabled(), true);
  process.env.FUNNEL_TRACKING_ENABLED = '0';
  assert.equal(isFunnelTrackingEnabled(), false);
  process.env.FUNNEL_TRACKING_ENABLED = '1';
});
