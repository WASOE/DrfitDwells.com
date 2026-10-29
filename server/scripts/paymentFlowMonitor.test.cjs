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
    'validation:buyerName'
  );
  assert.equal(
    extractSafeErrorReason({ code: 'FINALIZE_INTENT_PERSIST_DISABLED' }),
    'FINALIZE_INTENT_PERSIST_DISABLED'
  );
  assert.equal(
    extractSafeErrorReason({ code: 'STALE_CLIENT_SECRET' }),
    'STALE_CLIENT_SECRET'
  );
});

test('unknown payment messages do not enter incident evidence', async () => {
  const body = {
    message: 'Payment failed for Jane Doe, +359888123456, 12 Pirin Street, pi_3NabcSecret',
    errors: [{ path: 'guestInfo.phone', msg: '+359888123456 is invalid for Jane Doe' }]
  };
  assert.equal(extractSafeErrorReason(body, 400), 'validation:guestInfo.phone');
  assert.equal(
    extractSafeErrorReason({
      message: 'Card for Jane Doe at 12 Pirin Street was declined',
      code: 'pi_3NabcSecret'
    }, 402),
    'unclassified_http_402'
  );
  assert.equal(
    extractSafeErrorReason({
      code: 'Jane Doe',
      error: { code: 'cus_secretguest' }
    }, 500),
    'unclassified_http_500'
  );

  const result = await recordPaymentFlowOutcome({
    route: BOOKING_ROUTE,
    statusCode: 500,
    body: { message: 'Payment failed for Jane Doe, +359888123456, pi_3NabcSecret' }
  });
  assert.equal(result.alerted, true);
  const serialized = JSON.stringify(manualReviewCalls[0]) + JSON.stringify(pushCalls[0]);
  assert.equal(serialized.includes('Jane Doe'), false);
  assert.equal(serialized.includes('+359888123456'), false);
  assert.equal(serialized.includes('pi_3NabcSecret'), false);
  assert.equal(serialized.includes('12 Pirin'), false);
  assert.equal(manualReviewCalls[0].evidence.errorCode, 'unclassified_http_500');
  assert.equal(manualReviewCalls[0].evidence.statusCode, 500);
  assert.equal(manualReviewCalls[0].evidence.route, BOOKING_ROUTE);
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

  // origin/master returns 503 CHECKOUT_SESSION_V2_REQUIRED before Stripe when
  // Checkout V2 is off. The monitor is attached first, so this is still an immediate alert.
  assert.equal(failResponse.status, 503);
  assert.equal(failResponse.body.code, 'CHECKOUT_SESSION_V2_REQUIRED');
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(pushCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_server_error');
});

const FINALIZE_ROUTE = '/api/bookings/checkout-sessions/:checkoutId/finalize-intent';

test('FINALIZE_INTENT_REQUIRED is an immediate contract alert', async () => {
  const result = await recordPaymentFlowOutcome({
    route: '/api/bookings/create-payment-intent',
    statusCode: 409,
    body: { code: 'FINALIZE_INTENT_REQUIRED' }
  });
  assert.equal(result.alerted, true);
  assert.equal(result.immediate, true);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_contract_incident');
  assert.equal(manualReviewCalls[0].evidence.paymentContractVersion, 'checkout-payment-v2-finalize-1');
});

test('FINALIZE_INTENT_PERSIST_DISABLED triggers an immediate contract alert', async () => {
  const result = await recordPaymentFlowOutcome({
    route: FINALIZE_ROUTE,
    statusCode: 403,
    body: {
      code: 'FINALIZE_INTENT_PERSIST_DISABLED',
      message: 'Finalize intent persistence is disabled',
      guestEmail: 'guest@example.test',
      client_secret: 'pi_test_secret_value'
    }
  });
  assert.equal(result.alerted, true);
  assert.equal(result.immediate, true);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(manualReviewCalls[0].category, 'payment_flow_contract_incident');
  assert.equal(manualReviewCalls[0].severity, 'high');
  assert.equal(manualReviewCalls[0].evidence.errorCode, 'FINALIZE_INTENT_PERSIST_DISABLED');
  assert.equal(manualReviewCalls[0].evidence.paymentContractVersion, 'checkout-payment-v2-finalize-1');
  assert.ok('applicationRelease' in manualReviewCalls[0].evidence);
  const serialized = JSON.stringify(manualReviewCalls[0]);
  assert.equal(serialized.includes('guest@example.test'), false);
  assert.equal(serialized.includes('pi_test_secret_value'), false);
  assert.equal(serialized.includes('client_secret'), false);
});

test('three repeated monitored 403 failures trigger one threshold alert', async () => {
  const body = { code: 'PAYMENT_ROUTE_FORBIDDEN', message: 'forbidden' };
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 403, body });
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 403, body });
  const third = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 403, body });
  assert.equal(third.alerted, true);
  assert.equal(third.immediate, false);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(manualReviewCalls[0].evidence.statusCode, 403);
  assert.equal(manualReviewCalls[0].evidence.count, 3);
  assert.equal(manualReviewCalls[0].evidence.route, FINALIZE_ROUTE);
});

test('finalize-intent 409 hash mismatch is monitored and does not page on the first failure', async () => {
  const body = { code: 'FINALIZE_INTENT_HASH_MISMATCH' };
  const first = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  assert.equal(first.alerted, false);
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  const third = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  assert.equal(third.alerted, true);
  assert.equal(third.classification, 'monitored_conflict');
  assert.equal(manualReviewCalls[0].evidence.errorCode, 'FINALIZE_INTENT_HASH_MISMATCH');
});

test('FINALIZE_INTENT_METADATA_SYNC_FAILED is a monitored finalize-intent 409', async () => {
  const body = { code: 'FINALIZE_INTENT_METADATA_SYNC_FAILED' };
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  const third = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  assert.equal(third.alerted, true);
  assert.equal(third.immediate, false);
});

test('expected customer session conflicts do not page immediately', async () => {
  const body = { code: 'FINALIZE_INTENT_SESSION_VERSION_CONFLICT' };
  const first = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  const third = await recordPaymentFlowOutcome({ route: FINALIZE_ROUTE, statusCode: 409, body });
  assert.equal(first.alerted, false);
  assert.equal(first.classification, 'expected_customer');
  assert.equal(third.alerted, false);
  assert.equal(manualReviewCalls.length, 0);
  assert.equal(pushCalls.length, 0);
});

test('manual review remains when push delivery throws', async () => {
  __setPaymentFlowMonitorDepsForTesting({
    openManualReviewItem: async (payload) => {
      manualReviewCalls.push(payload);
      return { _id: new mongoose.Types.ObjectId() };
    },
    notifyOpsPushPaymentFlowAlert: async () => {
      throw new Error('push provider down for Jane Doe pi_3NabcSecret');
    }
  });
  const result = await recordPaymentFlowOutcome({
    route: BOOKING_ROUTE,
    statusCode: 500,
    body: { code: 'PAYMENT_INTENT_INIT_FAILED' }
  });
  assert.equal(result.alerted, true);
  assert.equal(result.recorded, true);
  assert.equal(manualReviewCalls.length, 1);
  assert.equal(result.pushDelivery.error, true);
  assert.equal(result.pushDelivery.deliveryOutcome, 'provider_failure');
  assert.notEqual(result.pushDelivery.deliveryOutcome, 'delivered');
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('Jane Doe'), false);
  assert.equal(serialized.includes('pi_3NabcSecret'), false);

  const retried = await recordPaymentFlowOutcome({
    route: BOOKING_ROUTE,
    statusCode: 500,
    body: { code: 'PAYMENT_INTENT_INIT_FAILED' }
  });
  assert.equal(retried.deduped, true);
  assert.equal(manualReviewCalls.length, 1);
});

test('failed manual review is not deduped and does not change the payment response', async () => {
  let attempts = 0;
  const logs = [];
  const originalError = console.error;
  console.error = (...args) => {
    logs.push(args.map(String).join(' '));
  };
  __setPaymentFlowMonitorDepsForTesting({
    openManualReviewItem: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('storage rejected Jane Doe +359888123456 pi_3NabcSecret');
      manualReviewCalls.push({ recorded: true });
      return { _id: new mongoose.Types.ObjectId() };
    },
    notifyOpsPushPaymentFlowAlert: async (payload) => {
      pushCalls.push(payload);
    }
  });
  const { attachPaymentFlowMonitor } = require('../services/ops/paymentFlowMonitorService');
  const app = express();
  app.post('/api/bookings/create-payment-intent', (req, res) => {
    attachPaymentFlowMonitor(res, BOOKING_ROUTE);
    res.status(500).json({
      code: 'PAYMENT_INTENT_INIT_FAILED',
      message: 'Payment failed for Jane Doe',
      clientSecret: 'pi_3NabcSecret'
    });
  });
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const first = await request(app).post(BOOKING_ROUTE).send({ guestName: 'Jane Doe' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(first.status, 500);
    assert.equal(first.body.code, 'PAYMENT_INTENT_INIT_FAILED');
    assert.equal(first.body.clientSecret, 'pi_3NabcSecret');
    assert.equal(manualReviewCalls.length, 0);
    assert.equal(pushCalls.length, 0);

    const second = await request(app).post(BOOKING_ROUTE).send({ guestName: 'Jane Doe' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(second.status, 500);
    assert.equal(second.body.clientSecret, 'pi_3NabcSecret');
    assert.equal(manualReviewCalls.length, 1);
    assert.equal(pushCalls.length, 1);
    assert.equal(unhandled.length, 0);
    const logged = logs.join('\n');
    assert.match(logged, /manual_review_record_failed/);
    assert.equal(logged.includes('Jane Doe'), false);
    assert.equal(logged.includes('+359888123456'), false);
    assert.equal(logged.includes('pi_3NabcSecret'), false);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    console.error = originalError;
  }
});

test('finalize-intent route attaches the monitor for persist disabled', async () => {
  const bookingRoutes = require('../routes/bookingRoutes');
  const previous = process.env.FINALIZE_INTENT_PERSIST;
  delete process.env.FINALIZE_INTENT_PERSIST;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
  try {
    const response = await request(app)
      .put('/api/bookings/checkout-sessions/chk_monitor_test_01/finalize-intent')
      .send({ guestInfo: { email: 'guest@example.test' } });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'FINALIZE_INTENT_PERSIST_DISABLED');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(manualReviewCalls.length, 1);
    assert.equal(manualReviewCalls[0].evidence.errorCode, 'FINALIZE_INTENT_PERSIST_DISABLED');
    assert.equal(JSON.stringify(manualReviewCalls[0]).includes('guest@example.test'), false);
  } finally {
    if (previous === undefined) delete process.env.FINALIZE_INTENT_PERSIST;
    else process.env.FINALIZE_INTENT_PERSIST = previous;
  }
});
