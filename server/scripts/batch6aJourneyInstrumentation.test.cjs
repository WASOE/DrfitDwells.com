'use strict';

/**
 * Batch 6A first-party journey instrumentation regression tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const LocationBooking = require('../models/LocationBooking');
const BookingFunnelEvent = require('../models/BookingFunnelEvent');

const {
  recordClientFunnelEvent,
  recordQuoteFunnelOutcome,
  recordServerCheckoutStarted,
  recordServerPaymentEvent,
  recordBookingFunnelConversion,
  recordLocationBookingFunnelConversion
} = require('../services/conversion/funnelEventService');
const { aggregateConversionSummary, MAIN_FUNNEL_STEPS } = require('../services/conversion/conversionSummaryService');
const {
  toCanonicalEventName,
  MAIN_FUNNEL_STAGE_EVENT_TYPES,
  isClientEventType,
  isServerOnlyEventType
} = require('../services/conversion/funnelEventConstants');

let mongoServer;
const prevFlag = process.env.FUNNEL_TRACKING_ENABLED;

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: overrides.name || `Cabin ${new mongoose.Types.ObjectId()}`,
    description: 'd',
    location: 'Bachevo',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    propertyKind: overrides.propertyKind || 'cabin',
    inventoryType: 'single',
    imageUrl: 'https://example.com/c.jpg',
    ...overrides
  });
}

function uuid() {
  return crypto.randomUUID();
}

test.before(async () => {
  process.env.FUNNEL_TRACKING_ENABLED = '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await BookingFunnelEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (prevFlag === undefined) delete process.env.FUNNEL_TRACKING_ENABLED;
  else process.env.FUNNEL_TRACKING_ENABLED = prevFlag;
});

test.beforeEach(async () => {
  await Promise.all([
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    Booking.deleteMany({}),
    LocationBooking.deleteMany({}),
    BookingFunnelEvent.deleteMany({})
  ]);
});

test('client cannot submit payment_succeeded or booking_confirmed', async () => {
  for (const eventType of ['payment_succeeded', 'booking_confirmed', 'quote_created', 'booking_created']) {
    await assert.rejects(
      () =>
        recordClientFunnelEvent({
          eventType,
          eventId: uuid(),
          sessionKey: 'sess-1',
          cabinId: new mongoose.Types.ObjectId().toString()
        }),
      (err) => err.code === 'SERVER_ONLY_EVENT' || err.code === 'INVALID_EVENT_TYPE'
    );
  }
  assert.equal(isServerOnlyEventType('payment_succeeded'), true);
  assert.equal(isClientEventType('payment_succeeded'), false);
});

test('unknown client fields removed; PII rejected; duplicate eventId idempotent', async () => {
  const cabin = await createCabin();
  const eventId = uuid();
  const first = await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId,
    sessionKey: 'sess-a',
    visitorKey: 'vis-a',
    cabinId: String(cabin._id),
    evilField: 'drop-me',
    nested: { a: 1 }
  });
  assert.equal(first.inserted, true);
  const second = await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId,
    sessionKey: 'sess-a',
    visitorKey: 'vis-a',
    cabinId: String(cabin._id)
  });
  assert.equal(second.duplicate, true);
  assert.equal(await BookingFunnelEvent.countDocuments({}), 1);
  const row = await BookingFunnelEvent.findOne({}).lean();
  assert.equal(row.eventId, eventId);
  assert.equal(row.evilField, undefined);
  assert.equal(row.schemaVersion, 2);
  assert.equal(row.verificationStatus, 'behavioural');

  await assert.rejects(
    () =>
      recordClientFunnelEvent({
        eventType: 'property_view',
        eventId: uuid(),
        sessionKey: 'sess-b',
        cabinId: String(cabin._id),
        email: 'no@example.com'
      }),
    (err) => err.code === 'VALIDATION_ERROR'
  );
});

test('repeated property views and date changes are preserved', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  for (let i = 0; i < 3; i += 1) {
    const r = await recordClientFunnelEvent({
      eventType: 'property_view',
      eventId: uuid(),
      sessionKey: 'sess-repeat',
      cabinId: String(cabin._id)
    });
    assert.equal(r.inserted, true);
  }
  await recordClientFunnelEvent({
    eventType: 'dates_selected',
    eventId: uuid(),
    sessionKey: 'sess-repeat',
    cabinId: String(cabin._id),
    checkInDateOnly: '2026-09-01',
    checkOutDateOnly: '2026-09-03'
  });
  await recordClientFunnelEvent({
    eventType: 'dates_selected',
    eventId: uuid(),
    sessionKey: 'sess-repeat',
    cabinId: String(cabin._id),
    checkInDateOnly: '2026-09-10',
    checkOutDateOnly: '2026-09-12'
  });
  assert.equal(await BookingFunnelEvent.countDocuments({ eventType: 'property_view' }), 3);
  assert.equal(await BookingFunnelEvent.countDocuments({ eventType: 'dates_selected' }), 2);
});

test('complete Cabin journey server commercial idempotency', async () => {
  const cabin = await createCabin({ propertyKind: 'cabin' });
  const req = {
    body: {
      funnelSessionKey: 'sess-cabin',
      funnelVisitorKey: 'vis-cabin',
      cabinId: String(cabin._id),
      checkIn: '2026-09-01',
      checkOut: '2026-09-03',
      adults: 2,
      children: 0
    }
  };
  const q1 = await recordQuoteFunnelOutcome(req, {
    kind: 'received',
    result: { ok: true, totalPrice: 200 }
  });
  const q2 = await recordQuoteFunnelOutcome(req, {
    kind: 'received',
    result: { ok: true, totalPrice: 200 }
  });
  assert.equal(q1.inserted, true);
  assert.equal(q2.duplicate, true);

  const c1 = await recordServerCheckoutStarted({
    checkoutId: 'cko_cabin_1',
    paymentId: 'pi_cabin_1',
    sessionKey: 'sess-cabin',
    visitorKey: 'vis-cabin',
    cabinId: String(cabin._id),
    propertyKind: 'cabin',
    checkInDateOnly: '2026-09-01',
    checkOutDateOnly: '2026-09-03',
    quotedTotalCents: 20000
  });
  const c2 = await recordServerCheckoutStarted({
    checkoutId: 'cko_cabin_1',
    paymentId: 'pi_cabin_1',
    sessionKey: 'sess-cabin',
    cabinId: String(cabin._id)
  });
  assert.equal(c1.inserted, true);
  assert.equal(c2.duplicate, true);

  const p1 = await recordServerPaymentEvent({
    eventName: 'payment_started',
    paymentId: 'pi_cabin_1',
    stateCode: 'requires_payment_method',
    cabinId: String(cabin._id),
    propertyKind: 'cabin'
  });
  const p2 = await recordServerPaymentEvent({
    eventName: 'payment_started',
    paymentId: 'pi_cabin_1',
    stateCode: 'requires_payment_method',
    cabinId: String(cabin._id)
  });
  assert.equal(p1.inserted, true);
  assert.equal(p2.duplicate, true);

  const bookingId = new mongoose.Types.ObjectId();
  await Booking.collection.insertOne({
    _id: bookingId,
    cabinId: cabin._id,
    checkIn: new Date('2026-09-01T12:00:00.000Z'),
    checkOut: new Date('2026-09-03T12:00:00.000Z'),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'a@test.com', phone: '+1' },
    totalPrice: 200,
    totalValueCents: 20000,
    status: 'confirmed',
    paymentMethod: 'card',
    provenance: { source: 'guest_portal' },
    stripePaymentIntentId: 'pi_cabin_1',
    checkoutId: 'cko_cabin_1',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const booking = await Booking.findById(bookingId).lean();
  const conv1 = await recordBookingFunnelConversion(booking, {
    funnelSessionKey: 'sess-cabin',
    funnelVisitorKey: 'vis-cabin'
  });
  const conv2 = await recordBookingFunnelConversion(booking, {
    funnelSessionKey: 'sess-cabin',
    funnelVisitorKey: 'vis-cabin'
  });
  assert.equal(conv1.inserted, true);
  assert.equal(conv2.duplicate, true);
  assert.ok(await BookingFunnelEvent.findOne({ eventType: 'booking_confirmed', bookingId }));
  assert.ok(await BookingFunnelEvent.findOne({ eventType: 'payment_succeeded', paymentId: 'pi_cabin_1' }));
});

test('Valley Lux / Stone / A-Frame propertyKinds never mix; location booking conversion', async () => {
  const lux = await createCabin({ name: 'Lux Cabin', propertyKind: 'valley' });
  const stone = await createCabin({ name: 'Stone House', propertyKind: 'valley' });
  const aframeType = await CabinType.create({
    name: 'A-Frame',
    slug: `aframe-${Date.now()}`,
    description: 'd',
    location: 'Valley',
    capacity: 2,
    pricePerNight: 150,
    imageUrl: 'https://example.com/a.jpg',
    propertyKind: 'valley'
  });

  await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId: uuid(),
    sessionKey: 'sess-lux',
    cabinId: String(lux._id)
  });
  await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId: uuid(),
    sessionKey: 'sess-stone',
    cabinId: String(stone._id)
  });
  await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId: uuid(),
    sessionKey: 'sess-aframe',
    cabinTypeId: String(aframeType._id)
  });

  const luxRow = await BookingFunnelEvent.findOne({ sessionKey: 'sess-lux' }).lean();
  const stoneRow = await BookingFunnelEvent.findOne({ sessionKey: 'sess-stone' }).lean();
  const aframeRow = await BookingFunnelEvent.findOne({ sessionKey: 'sess-aframe' }).lean();
  assert.equal(luxRow.propertyKind, 'valley');
  assert.equal(stoneRow.propertyKind, 'valley');
  assert.equal(aframeRow.propertyKind, 'valley');

  const cabinOnly = await createCabin({ propertyKind: 'cabin' });
  await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId: uuid(),
    sessionKey: 'sess-the-cabin',
    cabinId: String(cabinOnly._id)
  });
  const cabinRow = await BookingFunnelEvent.findOne({ sessionKey: 'sess-the-cabin' }).lean();
  assert.equal(cabinRow.propertyKind, 'cabin');

  // Valley quote + location booking
  const locReq = {
    body: {
      funnelSessionKey: 'sess-valley-quote',
      funnelVisitorKey: 'vis-valley',
      locationKey: 'valley',
      locationId: 'valley',
      checkIn: '2026-08-01',
      checkOut: '2026-08-04',
      adults: 4,
      children: 0
    }
  };
  const vq = await recordQuoteFunnelOutcome(locReq, {
    kind: 'received',
    propertyKind: 'valley',
    result: { ok: true, totalPrice: 900 }
  });
  assert.equal(vq.inserted, true);
  const quoteRow = await BookingFunnelEvent.findOne({ eventType: 'quote_created', locationId: 'valley' }).lean();
  assert.equal(quoteRow.propertyKind, 'valley');

  const locId = new mongoose.Types.ObjectId();
  await LocationBooking.collection.insertOne({
    _id: locId,
    locationKey: 'valley',
    checkIn: new Date('2026-08-01T12:00:00.000Z'),
    checkOut: new Date('2026-08-04T12:00:00.000Z'),
    adults: 4,
    children: 0,
    guestInfo: { firstName: 'V', lastName: 'G', email: 'v@test.com', phone: '+2' },
    totalPrice: 900,
    currency: 'EUR',
    status: 'confirmed',
    source: 'website',
    stripePaymentIntentId: 'pi_valley_1',
    checkoutSessionId: 'cko_valley_1',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const loc = await LocationBooking.findById(locId).lean();
  const locConv = await recordLocationBookingFunnelConversion(loc, {
    funnelSessionKey: 'sess-valley-quote',
    funnelVisitorKey: 'vis-valley',
    checkoutId: 'cko_valley_1',
    paymentId: 'pi_valley_1'
  });
  assert.equal(locConv.inserted, true);
  const conf = await BookingFunnelEvent.findOne({
    eventType: 'booking_confirmed',
    propertyKind: 'valley',
    locationId: 'valley'
  }).lean();
  assert.ok(conf);

  const cabinSummary = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-11-30'
  });
  const valleySummary = await aggregateConversionSummary({
    propertyKind: 'valley',
    from: '2026-07-01',
    to: '2026-11-30'
  });
  assert.ok(cabinSummary.steps.find((s) => s.eventType === 'property_view').eventCount >= 1);
  assert.ok(valleySummary.steps.find((s) => s.eventType === 'property_view').eventCount >= 1);
  // Cabin summary must not include valley property views in valley-only inventory rows — propertyKind filter
  const cabinPv = cabinSummary.steps.find((s) => s.eventType === 'property_view');
  assert.equal(cabinPv.eventCount, 1);
});

test('main funnel does not require search_results; legacy events still aggregate', async () => {
  assert.ok(!MAIN_FUNNEL_STEPS.some((s) => s.eventType === 'search_results'));
  assert.ok(!MAIN_FUNNEL_STEPS.some((s) => (s.matchEventTypes || []).includes('search_results')));
  assert.equal(toCanonicalEventName('search_results'), 'search_results_viewed');
  assert.equal(toCanonicalEventName('quote_received'), 'quote_created');
  assert.equal(toCanonicalEventName('booking_converted'), 'booking_confirmed');

  const cabin = await createCabin({ propertyKind: 'cabin' });
  // Legacy rows (no eventId historically — seed with eventId for schema v2 required field)
  await BookingFunnelEvent.create({
    eventId: uuid(),
    eventType: 'property_view',
    source: 'client',
    dedupeKey: `legacy-pv-${uuid()}`,
    sessionKey: 'sess-legacy',
    cabinId: cabin._id,
    propertyKind: 'cabin',
    schemaVersion: 1
  });
  await BookingFunnelEvent.create({
    eventId: uuid(),
    eventType: 'confirm_page_view',
    source: 'client',
    dedupeKey: `legacy-cp-${uuid()}`,
    sessionKey: 'sess-legacy',
    cabinId: cabin._id,
    propertyKind: 'cabin',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-03',
    schemaVersion: 1
  });
  await BookingFunnelEvent.create({
    eventId: uuid(),
    eventType: 'quote_received',
    source: 'server',
    dedupeKey: `legacy-qr-${uuid()}`,
    sessionKey: 'sess-legacy',
    cabinId: cabin._id,
    propertyKind: 'cabin',
    schemaVersion: 1
  });
  await BookingFunnelEvent.create({
    eventId: uuid(),
    eventType: 'checkout_started',
    source: 'server',
    verificationStatus: 'server_verified',
    dedupeKey: `legacy-cs-${uuid()}`,
    sessionKey: 'sess-legacy',
    cabinId: cabin._id,
    propertyKind: 'cabin',
    schemaVersion: 1
  });
  await BookingFunnelEvent.create({
    eventId: uuid(),
    eventType: 'booking_converted',
    source: 'server',
    dedupeKey: `legacy-bc-${uuid()}`,
    sessionKey: 'sess-legacy',
    cabinId: cabin._id,
    propertyKind: 'cabin',
    convertedBookingId: new mongoose.Types.ObjectId(),
    schemaVersion: 1
  });

  const summary = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-11-30'
  });
  assert.equal(summary.steps.length, 5);
  assert.ok(summary.steps.every((s) => typeof s.sessionCount === 'number'));
  assert.ok(summary.provenance.schemaVersion === 2);
  assert.ok(MAIN_FUNNEL_STAGE_EVENT_TYPES.quote.includes('quote_received'));
  assert.ok(MAIN_FUNNEL_STAGE_EVENT_TYPES.quote.includes('quote_created'));
});

test('admin/bot/test exclusion and identity suppression', async () => {
  const cabin = await createCabin();
  await recordClientFunnelEvent(
    {
      eventType: 'property_view',
      eventId: uuid(),
      sessionKey: 'sess-bot',
      cabinId: String(cabin._id)
    },
    { req: { headers: { 'user-agent': 'Googlebot/2.1' }, path: '/' } }
  );
  const bot = await BookingFunnelEvent.findOne({ sessionKey: 'sess-bot' }).lean();
  assert.equal(bot.isBotTraffic, true);

  await recordClientFunnelEvent(
    {
      eventType: 'property_view',
      eventId: uuid(),
      sessionKey: 'sess-ops',
      cabinId: String(cabin._id)
    },
    { req: { headers: { 'user-agent': 'Mozilla' }, path: '/api/ops/conversion/summary', user: { role: 'admin' } } }
  );
  const ops = await BookingFunnelEvent.findOne({ sessionKey: 'sess-ops' }).lean();
  assert.equal(ops.isInternalTraffic, true);

  const fixture = await createCabin({ name: 'SyncValidation Cabin X', propertyKind: 'cabin' });
  await recordClientFunnelEvent({
    eventType: 'property_view',
    eventId: uuid(),
    sessionKey: 'sess-fix',
    cabinId: String(fixture._id)
  });
  const fix = await BookingFunnelEvent.findOne({ sessionKey: 'sess-fix' }).lean();
  assert.equal(fix.isTestTraffic, true);

  const summary = await aggregateConversionSummary({
    propertyKind: 'cabin',
    from: '2026-07-01',
    to: '2026-11-30'
  });
  const pv = summary.steps.find((s) => s.eventType === 'property_view');
  assert.equal(pv.eventCount, 0);

  // Server quote without identity → identitySuppressed
  const q = await recordQuoteFunnelOutcome(
    { body: { cabinId: String(cabin._id), checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2 } },
    { kind: 'received', result: { ok: true, totalPrice: 100 } }
  );
  assert.equal(q.inserted, true);
  const orphan = await BookingFunnelEvent.findOne({ eventType: 'quote_created', identitySuppressed: true }).lean();
  assert.ok(orphan);
  assert.equal(orphan.sessionKey, null);
});

test('payment webhook-style retry idempotency', async () => {
  const a = await recordServerPaymentEvent({
    eventName: 'payment_failed',
    paymentId: 'pi_retry',
    stateCode: 'card_declined',
    propertyKind: 'cabin',
    origin: 'webhook'
  });
  const b = await recordServerPaymentEvent({
    eventName: 'payment_failed',
    paymentId: 'pi_retry',
    stateCode: 'card_declined',
    propertyKind: 'cabin',
    origin: 'webhook'
  });
  assert.equal(a.inserted, true);
  assert.equal(b.duplicate, true);
  const c = await recordServerPaymentEvent({
    eventName: 'payment_cancelled',
    paymentId: 'pi_retry',
    stateCode: 'canceled',
    propertyKind: 'cabin',
    origin: 'webhook'
  });
  assert.equal(c.inserted, true);
});
