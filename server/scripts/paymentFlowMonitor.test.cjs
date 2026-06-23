const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const giftVoucherRoutes = require('../routes/giftVoucherRoutes');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  recordPaymentFlowOutcome,
  extractSafeErrorReason,
  __setPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorStateForTesting
} = require('../services/ops/paymentFlowMonitorService');

const GIFT_ROUTE = '/api/gift-vouchers/create-payment-intent';
const BOOKING_ROUTE = '/api/bookings/create-payment-intent';

let manualReviewCalls = [];
let pushCalls = [];

function resetSpyState() {
  manualReviewCalls = [];
  pushCalls = [];
  __resetPaymentFlowMonitorStateForTesting();
  __setPaymentFlowMonitorDepsForTesting({
    openManualReviewItem: async (payload) => {
      manualReviewCalls.push(payload);
      return { _id: new mongoose.Types.ObjectId() };
    },
    notifyOpsPushPaymentFlowAlert: async (payload) => {
      pushCalls.push(payload);
    }
  });
}

test.beforeEach(() => {
  resetSpyState();
});

test.after(() => {
  __resetPaymentFlowMonitorDepsForTesting();
  __resetPaymentFlowMonitorStateForTesting();
});

test('extractSafeErrorReason prefers code and validation path without payload fields', () => {
  assert.equal(extractSafeErrorReason({ code: 'TERMS_NOT_ACCEPTED' }), 'TERMS_NOT_ACCEPTED');
  assert.equal(
    extractSafeErrorReason({
      message: 'Validation failed',
      errors: [{ path: 'buyerName', msg: 'buyerName is required' }]
    }),
    'validation:buyerName:buyerName is required'
  );
});

test('2x same 400 does not alert', async () => {
  const body = { message: 'Validation failed', errors: [{ path: 'buyerName', msg: 'buyerName is required' }] };
  const first = await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  const second = await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  assert.equal(first.alerted, false);
  assert.equal(second.alerted, false);
  assert.equal(manualReviewCalls.length, 0);
  assert.equal(pushCalls.length, 0);
});

test('3x same 400 triggers one threshold alert', async () => {
  const body = { message: 'Validation failed', errors: [{ path: 'buyerName', msg: 'buyerName is required' }] };
  await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  const third = await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  assert.equal(third.alerted, true);
  assert.equal(third.immediate, false);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_threshold_warning');
  assert.match(manualReviewCalls[0].details, /Route: \/api\/gift-vouchers\/create-payment-intent/);
  assert.match(manualReviewCalls[0].details, /Count: 3/);
  assert.match(manualReviewCalls[0].details, /Window: 10 minutes/);
});

test('1x 500 triggers immediate alert', async () => {
  const result = await recordPaymentFlowOutcome({
    route: BOOKING_ROUTE,
    statusCode: 500,
    body: { message: 'Payment setup failed' }
  });
  assert.equal(result.alerted, true);
  assert.equal(result.immediate, true);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_server_error');
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].immediate, true);
  assert.equal(pushCalls[0].statusCode, 500);
});

test('PAYMENT_INTENT_INIT_FAILED on 502 triggers immediate alert', async () => {
  const result = await recordPaymentFlowOutcome({
    route: GIFT_ROUTE,
    statusCode: 502,
    body: { code: 'PAYMENT_INTENT_INIT_FAILED', message: 'Unable to initialize payment' }
  });
  assert.equal(result.alerted, true);
  assert.equal(result.immediate, true);
  assert.equal(pushCalls[0].errorReason, 'PAYMENT_INTENT_INIT_FAILED');
});

test('duplicate immediate alerts for same issue are deduped within window', async () => {
  const body = { message: 'Payment setup failed' };
  const first = await recordPaymentFlowOutcome({ route: BOOKING_ROUTE, statusCode: 500, body });
  const second = await recordPaymentFlowOutcome({ route: BOOKING_ROUTE, statusCode: 500, body });
  assert.equal(first.alerted, true);
  assert.equal(second.alerted, false);
  assert.equal(second.deduped, true);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
});

test('fourth same 400 after threshold alert does not spam', async () => {
  const body = { message: 'Validation failed', errors: [{ path: 'buyerName', msg: 'buyerName is required' }] };
  await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  const third = await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  const fourth = await recordPaymentFlowOutcome({ route: GIFT_ROUTE, statusCode: 400, body });
  assert.equal(third.alerted, true);
  assert.equal(fourth.alerted, false);
  assert.equal(fourth.deduped, true);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
});

let giftMongoServer;
let giftApp;

test('gift voucher create-payment-intent calls monitor on validation failure', async (t) => {
  giftMongoServer = await MongoMemoryServer.create();
  await mongoose.connect(giftMongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  t.after(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (giftMongoServer) await giftMongoServer.stop();
    resetSpyState();
  });

  giftApp = express();
  giftApp.set('trust proxy', 1);
  giftApp.use(express.json());
  giftApp.use('/api/gift-vouchers', giftVoucherRoutes);

  resetSpyState();
  const invalidPayload = {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    termsAccepted: true
  };

  await request(giftApp)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.1')
    .send(invalidPayload);
  await request(giftApp)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.2')
    .send(invalidPayload);
  const third = await request(giftApp)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.3')
    .send(invalidPayload);

  assert.equal(third.status, 400);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_threshold_warning');
});

let bookingMongoServer;
let bookingApp;

test('booking create-payment-intent calls monitor on validation failure', async (t) => {
  bookingMongoServer = await MongoMemoryServer.create();
  await mongoose.connect(bookingMongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  t.after(async () => {
    bookingRoutes.__resetStripeClientForTesting();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (bookingMongoServer) await bookingMongoServer.stop();
    resetSpyState();
  });

  bookingApp = express();
  bookingApp.set('trust proxy', 1);
  bookingApp.use(express.json());
  bookingApp.use('/api/bookings', bookingRoutes);

  resetSpyState();
  const invalidPayload = {
    checkIn: 'not-a-date',
    checkOut: 'also-not-a-date',
    adults: 2
  };

  const response = await request(bookingApp)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.40.0.1')
    .send(invalidPayload);

  assert.equal(response.status, 400);
  assert.equal(manualReviewCalls.length, 0);
  assert.equal(pushCalls.length, 0);

  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        throw new Error('stripe down');
      }
    }
  });

  const Cabin = require('../models/Cabin');
  const cabin = await Cabin.create({
    name: 'Monitor Cabin',
    description: 'Test',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });

  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 14);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);

  const failResponse = await request(bookingApp)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.40.0.2')
    .send({
      cabinId: String(cabin._id),
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      adults: 2,
      children: 0
    });

  assert.equal(failResponse.status, 500);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_server_error');
});
