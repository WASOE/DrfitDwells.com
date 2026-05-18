/**
 * CheckoutSession V2 route adapter (C2D-A): feature flag routing, GET state, POST create-payment-intent.
 *
 * Run: node --test server/scripts/checkoutSessionRoutes.test.cjs
 */
'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const PromoCode = require('../models/PromoCode');
const bookingRoutes = require('../routes/bookingRoutes');
const bookingQuoteService = require('../services/bookingQuoteService');
const checkoutSessionRouteAdapter = require('../routes/checkoutSessionRouteAdapter');
const { ensureCanonicalPaymentIntent } = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const { CheckoutSessionError, CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');

let mongoServer;
let app;
let savedCheckoutSessionV2;

function buildApp() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(express.json());
  instance.use('/api/bookings', bookingRoutes);
  return instance;
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function setCheckoutSessionV2Flag(value) {
  if (value === undefined || value === null) {
    delete process.env.CHECKOUT_SESSION_V2;
  } else {
    process.env.CHECKOUT_SESSION_V2 = value;
  }
}

async function createCabin() {
  return Cabin.create({
    name: 'Route Adapter Cabin',
    description: 'Test cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
}

function postPaymentIntent(agent, body, ipSuffix = 1) {
  return agent
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', `10.88.0.${ipSuffix}`)
    .send(body);
}

function createMockStripeWithCreateSpy() {
  let createCalls = 0;
  const client = {
    paymentIntents: {
      create: async (payload) => {
        createCalls += 1;
        const id = `pi_route_${createCalls}`;
        return {
          id,
          client_secret: `cs_${id}`,
          amount: payload.amount,
          metadata: { ...(payload.metadata || {}) },
          status: 'requires_payment_method'
        };
      },
      retrieve: async () => {
        throw new Error('retrieve not expected in this test');
      },
      cancel: async () => ({ status: 'canceled' }),
      update: async () => ({ ok: true })
    }
  };
  return { client, getCreateCalls: () => createCalls };
}

async function seedV2Session(overrides = {}) {
  const checkoutId = overrides.checkoutId || 'chk_routes_v2_test01';
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: overrides.status || 'payment_required',
    paymentStatus: overrides.paymentStatus || 'unpaid',
    stayFingerprint: 'fp_stay_route_1',
    replayFingerprint: 'fp_replay_route_1',
    quoteSnapshotHash: 'hash_route_1',
    stripeAmountCents: overrides.stripeAmountCents ?? 32400,
    giftVoucherAppliedCents: overrides.giftVoucherAppliedCents ?? 0,
    sessionVersion: 1,
    quoteSnapshot: {
      fullVoucherCoverage: Boolean(overrides.fullVoucherCoverage),
      stripeAmountCents: overrides.stripeAmountCents ?? 32400,
      voucherAppliedCents: overrides.giftVoucherAppliedCents ?? 0
    },
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides
  });
}

test.before(async () => {
  savedCheckoutSessionV2 = process.env.CHECKOUT_SESSION_V2;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await GiftVoucher.syncIndexes();
  await PromoCode.syncIndexes();
  app = buildApp();
});

test.beforeEach(async () => {
  await Promise.all([
    CheckoutSession.deleteMany({}),
    GiftVoucher.deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    PromoCode.deleteMany({}),
    Cabin.deleteMany({})
  ]);
  setCheckoutSessionV2Flag(undefined);
  checkoutSessionRouteAdapter.__resetEnsureCanonicalPaymentIntentForTesting();
  bookingRoutes.__resetStripeClientForTesting();
});

test.afterEach(() => {
  checkoutSessionRouteAdapter.__resetEnsureCanonicalPaymentIntentForTesting();
  bookingRoutes.__resetStripeClientForTesting();
});

test.after(async () => {
  setCheckoutSessionV2Flag(savedCheckoutSessionV2);
  checkoutSessionRouteAdapter.__resetEnsureCanonicalPaymentIntentForTesting();
  bookingRoutes.__resetStripeClientForTesting();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('CHECKOUT_SESSION_V2=0 keeps legacy create-payment-intent path (route stripe.create)', async () => {
  setCheckoutSessionV2Flag('0');
  const cabin = await createCabin();
  const mock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => {
    ensureCalls += 1;
    throw new Error('ensureCanonicalPaymentIntent must not run when flag is off');
  });

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(5).toISOString(),
    checkOut: nextDate(7).toISOString(),
    adults: 2,
    children: 0
  };

  const res = await postPaymentIntent(request(app), payload, 1);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(res.body.paymentIntentId);
  assert.ok(res.body.clientSecret);
  assert.equal(ensureCalls, 0);
  assert.equal(mock.getCreateCalls(), 1);
});

test('CHECKOUT_SESSION_V2=1 uses V2 ensureCanonicalPaymentIntent path without route stripe.create', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();
  const mock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => {
    ensureCalls += 1;
    return {
      checkoutId: 'chk_v2_flag_on_01',
      flowVersion: 'v2',
      sessionStatus: 'payment_required',
      paymentStatus: 'unpaid',
      quoteSnapshotHash: 'hash_v2',
      sessionVersion: 1,
      clientSecret: 'cs_mock_v2',
      canonicalPaymentIntentId: 'pi_canonical_1',
      stripeAmountCents: 36000,
      giftVoucherAppliedCents: 0,
      fullVoucherCoverage: false,
      voucherRedemptionId: null,
      idempotentReplay: false,
      noPaymentRequired: false
    };
  });

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(8).toISOString(),
    checkOut: nextDate(10).toISOString(),
    adults: 2,
    children: 0
  };

  const res = await postPaymentIntent(request(app), payload, 2);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.checkoutId, 'chk_v2_flag_on_01');
  assert.equal(res.body.clientSecret, 'cs_mock_v2');
  assert.equal(res.body.flowVersion, 'v2');
  assert.equal(ensureCalls, 1);
  assert.equal(mock.getCreateCalls(), 0);
});

test('existing V2 checkoutId uses V2 even when CHECKOUT_SESSION_V2 is off', async () => {
  setCheckoutSessionV2Flag('0');
  const cabin = await createCabin();
  const checkoutId = 'chk_pinned_v2_session1';
  await seedV2Session({ checkoutId });

  const mock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async (args) => {
    ensureCalls += 1;
    assert.equal(args.checkoutId, checkoutId);
    return {
      checkoutId,
      flowVersion: 'v2',
      sessionStatus: 'payment_required',
      paymentStatus: 'unpaid',
      quoteSnapshotHash: 'hash_pinned',
      sessionVersion: 2,
      clientSecret: 'cs_pinned',
      canonicalPaymentIntentId: 'pi_pinned',
      stripeAmountCents: 32400,
      giftVoucherAppliedCents: 0,
      fullVoucherCoverage: false,
      voucherRedemptionId: null,
      idempotentReplay: true,
      noPaymentRequired: false
    };
  });

  const res = await postPaymentIntent(
    request(app),
    {
      cabinId: String(cabin._id),
      checkIn: nextDate(11).toISOString(),
      checkOut: nextDate(13).toISOString(),
      adults: 2,
      checkoutId
    },
    3
  );

  assert.equal(res.status, 200);
  assert.equal(ensureCalls, 1);
  assert.equal(mock.getCreateCalls(), 0);
  assert.equal(res.body.checkoutId, checkoutId);
});

test('GET checkout session returns safe DTO without secrets', async () => {
  const checkoutId = 'chk_get_safe_dto_01';
  await seedV2Session({
    checkoutId,
    canonicalPaymentIntentId: 'pi_safe_1',
    giftVoucherAppliedCents: 5000
  });

  const res = await request(app).get(`/api/bookings/checkout-sessions/${checkoutId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  const dto = res.body.checkoutSession;
  assert.equal(dto.checkoutId, checkoutId);
  assert.equal(dto.flowVersion, 'v2');
  assert.equal(dto.sessionStatus, 'payment_required');
  assert.equal(dto.canonicalPaymentIntentId, 'pi_safe_1');
  assert.equal(dto.giftVoucherAppliedCents, 5000);
  assert.ok(dto.expiresAt);
  assert.equal('client_secret' in res.body, false);
  assert.equal('clientSecret' in res.body, false);
  assert.equal('client_secret' in dto, false);
  assert.equal('clientSecret' in dto, false);
  assert.equal('metadata' in dto, false);
});

test('V2 create-payment-intent returns checkoutId and clientSecret for card-due quote', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();
  bookingRoutes.__setStripeClientForTesting(createMockStripeWithCreateSpy().client);

  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => ({
    checkoutId: 'chk_card_due_01',
    flowVersion: 'v2',
    sessionStatus: 'payment_required',
    paymentStatus: 'unpaid',
    quoteSnapshotHash: 'hash_card',
    sessionVersion: 1,
    clientSecret: 'cs_card_due',
    canonicalPaymentIntentId: 'pi_card_due',
    stripeAmountCents: 36000,
    giftVoucherAppliedCents: 0,
    fullVoucherCoverage: false,
    voucherRedemptionId: null,
    idempotentReplay: false,
    noPaymentRequired: false
  }));

  const res = await postPaymentIntent(request(app), {
    cabinId: String(cabin._id),
    checkIn: nextDate(14).toISOString(),
    checkOut: nextDate(16).toISOString(),
    adults: 2
  }, 4);

  assert.equal(res.status, 200);
  assert.equal(res.body.checkoutId, 'chk_card_due_01');
  assert.equal(res.body.clientSecret, 'cs_card_due');
  assert.equal(res.body.noPaymentRequired, false);
});

test('V2 create-payment-intent omits clientSecret for full voucher / no-payment-required', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();
  bookingRoutes.__setStripeClientForTesting(createMockStripeWithCreateSpy().client);

  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => ({
    checkoutId: 'chk_full_voucher_01',
    flowVersion: 'v2',
    sessionStatus: 'voucher_only_reserved',
    paymentStatus: 'not_required',
    quoteSnapshotHash: 'hash_fv',
    sessionVersion: 1,
    clientSecret: null,
    canonicalPaymentIntentId: null,
    stripeAmountCents: 0,
    giftVoucherAppliedCents: 36000,
    fullVoucherCoverage: true,
    voucherRedemptionId: 'red_full_1',
    idempotentReplay: false,
    noPaymentRequired: true
  }));

  const res = await postPaymentIntent(request(app), {
    cabinId: String(cabin._id),
    checkIn: nextDate(17).toISOString(),
    checkOut: nextDate(19).toISOString(),
    adults: 2,
    voucherCode: 'DD-FULL-VOUCH'
  }, 5);

  assert.equal(res.status, 200);
  assert.equal(res.body.noPaymentRequired, true);
  assert.equal(res.body.clientSecret, null);
  assert.equal(res.body.fullVoucherCoverage, true);
});

test('typed CheckoutSessionError maps to expected HTTP code and body', async () => {
  const checkoutId = 'chk_expired_route_01';
  await seedV2Session({
    checkoutId,
    expiresAt: new Date(Date.now() - 60 * 1000)
  });

  const res = await request(app).get(`/api/bookings/checkout-sessions/${checkoutId}`);
  assert.equal(res.status, 410);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_EXPIRED);
  assert.ok(res.body.message);
});

test('mapCheckoutSessionErrorToHttp covers INVALID_CHECKOUT_ID as 400', () => {
  const err = new CheckoutSessionError(
    CHECKOUT_SESSION_ERROR_CODES.INVALID_CHECKOUT_ID,
    'Invalid checkout session id'
  );
  const mapped = checkoutSessionRouteAdapter.mapCheckoutSessionErrorToHttp(err);
  assert.equal(mapped.status, 400);
  assert.equal(mapped.body.code, 'INVALID_CHECKOUT_ID');
});

test('V2 card-due 1-49 cents returns 400 and does not call ensure or route stripe.create', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();
  const totalValueCents = 36000;
  const voucher = await GiftVoucher.create({
    code: 'DD-ROUTE-SUBMIN-01',
    amountOriginalCents: totalValueCents,
    balanceRemainingCents: totalValueCents - 30,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(30)
  });

  const mock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => {
    ensureCalls += 1;
    throw new Error('ensureCanonicalPaymentIntent must not run for sub-minimum card due');
  });

  const res = await postPaymentIntent(
    request(app),
    {
      cabinId: String(cabin._id),
      checkIn: nextDate(21).toISOString(),
      checkOut: nextDate(23).toISOString(),
      adults: 2,
      checkoutId: 'chk_route_submin_v2_1',
      voucherCode: voucher.code
    },
    11
  );

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'CHECKOUT_AMOUNT_BELOW_STRIPE_MINIMUM');
  assert.equal(res.body.details.stripeAmountCents, 30);
  assert.equal(ensureCalls, 0);
  assert.equal(mock.getCreateCalls(), 0);
});

test('V2 invalid negative amount returns CHECKOUT_INVALID_AMOUNT before ensure or Stripe', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();

  const quoteMock = mock.method(bookingQuoteService, 'buildPublicBookingQuote', async () => ({
    ok: true,
    entityType: 'cabin',
    entity: cabin,
    checkInDate: nextDate(30),
    checkOutDate: nextDate(32),
    subtotalPrice: 100,
    discountAmount: 0,
    totalPrice: -1,
    remainingDueCents: -100,
    fullVoucherCoverage: false,
    voucherAppliedCents: 0
  }));

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async () => {
    ensureCalls += 1;
    throw new Error('ensureCanonicalPaymentIntent must not run for invalid amount');
  });

  const stripeMock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(stripeMock.client);

  try {
    const res = await postPaymentIntent(
      request(app),
      {
        cabinId: String(cabin._id),
        checkIn: nextDate(30).toISOString(),
        checkOut: nextDate(32).toISOString(),
        adults: 2
      },
      14
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'CHECKOUT_INVALID_AMOUNT');
    assert.equal(ensureCalls, 0);
    assert.equal(stripeMock.getCreateCalls(), 0);
  } finally {
    quoteMock.mock.restore();
  }
});

test('V2 zero-due promo returns noPaymentRequired and calls ensure', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();
  await PromoCode.create({
    code: 'FREE100V2',
    internalName: 'Free stay V2 route',
    discountType: 'percent',
    discountValue: 100,
    isActive: true
  });

  let stripeCreateCalls = 0;
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        stripeCreateCalls += 1;
        throw new Error('stripe.paymentIntents.create must not run for zero-due promo');
      },
      retrieve: async () => {
        throw new Error('retrieve not expected');
      },
      cancel: async () => ({ status: 'canceled' }),
      update: async () => ({ ok: true })
    }
  });

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async (args) => {
    ensureCalls += 1;
    return ensureCanonicalPaymentIntent(args);
  });

  const res = await postPaymentIntent(
    request(app),
    {
      cabinId: String(cabin._id),
      checkIn: nextDate(24).toISOString(),
      checkOut: nextDate(26).toISOString(),
      adults: 2,
      promoCode: 'FREE100V2'
    },
    12
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.noPaymentRequired, true);
  assert.equal(res.body.clientSecret, null);
  assert.equal(ensureCalls, 1);
  assert.equal(stripeCreateCalls, 0);
});

test('V2 card-due >= 50 cents still reaches ensure', async () => {
  setCheckoutSessionV2Flag('1');
  const cabin = await createCabin();

  let ensureCalls = 0;
  checkoutSessionRouteAdapter.__setEnsureCanonicalPaymentIntentForTesting(async (args) => {
    ensureCalls += 1;
    const cents = checkoutSessionRouteAdapter.resolveRemainingCardAmountCents(
      await require('../services/bookingQuoteService').buildPublicBookingQuote(args.input)
    );
    assert.ok(cents >= 50);
    return {
      checkoutId: 'chk_route_min_ok_01',
      flowVersion: 'v2',
      sessionStatus: 'payment_required',
      paymentStatus: 'unpaid',
      quoteSnapshotHash: 'hash_min_ok',
      sessionVersion: 1,
      clientSecret: 'cs_min_ok',
      canonicalPaymentIntentId: 'pi_min_ok',
      stripeAmountCents: cents,
      giftVoucherAppliedCents: 0,
      fullVoucherCoverage: false,
      voucherRedemptionId: null,
      idempotentReplay: false,
      noPaymentRequired: false
    };
  });

  bookingRoutes.__setStripeClientForTesting(createMockStripeWithCreateSpy().client);

  const res = await postPaymentIntent(
    request(app),
    {
      cabinId: String(cabin._id),
      checkIn: nextDate(27).toISOString(),
      checkOut: nextDate(29).toISOString(),
      adults: 2
    },
    13
  );

  assert.equal(res.status, 200);
  assert.equal(ensureCalls, 1);
  assert.equal(res.body.stripeAmountCents, 36000);
});

test('legacy voucher hotfix path still runs when CHECKOUT_SESSION_V2 is off', async () => {
  setCheckoutSessionV2Flag('0');
  const cabin = await createCabin();
  const voucher = await GiftVoucher.create({
    code: 'DD-ROUTE-HOTF-0001',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(30)
  });
  await PromoCode.create({
    code: 'ROUTEHOT10',
    internalName: 'Route hotfix 10 percent',
    discountType: 'percent',
    discountValue: 10,
    isActive: true
  });

  const mock = createMockStripeWithCreateSpy();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(20).toISOString(),
    checkOut: nextDate(22).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_route_hotfix_v1',
    voucherCode: voucher.code,
    promoCode: 'ROUTEHOT10'
  };

  const first = await postPaymentIntent(request(app), payload, 10);
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  assert.ok(first.body.paymentIntentId);
  assert.equal(mock.getCreateCalls(), 1);
});
