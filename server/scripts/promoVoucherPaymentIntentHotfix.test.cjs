const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const PromoCode = require('../models/PromoCode');
const Cabin = require('../models/Cabin');
const bookingQuoteService = require('../services/bookingQuoteService');
const bookingRoutes = require('../routes/bookingRoutes');

let mongoServer;
let app;

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

async function createCabin() {
  return Cabin.create({
    name: 'Hotfix Test Cabin',
    description: 'A quiet place',
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

let voucherSeq = 0;

async function createVoucher(overrides = {}) {
  voucherSeq += 1;
  const suffix = String(voucherSeq).padStart(4, '0');
  return GiftVoucher.create({
    code: `DD-HOTF-${suffix}-VOUCH`,
    amountOriginalCents: 50000,
    balanceRemainingCents: 50000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(30),
    ...overrides
  });
}

function postPaymentIntent(agent, body, ipSuffix) {
  return agent
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', `10.99.0.${ipSuffix}`)
    .send(body);
}

function createMockStripeStore() {
  const store = new Map();
  let seq = 0;
  return {
    store,
    client: {
      paymentIntents: {
        create: async (payload) => {
          const id = `pi_hotfix_${++seq}`;
          const pi = {
            id,
            client_secret: `cs_${id}`,
            amount: payload.amount,
            metadata: { ...(payload.metadata || {}) },
            status: 'requires_payment_method'
          };
          store.set(id, pi);
          return pi;
        },
        retrieve: async (id) => {
          const pi = store.get(String(id));
          if (!pi) throw new Error(`missing pi ${id}`);
          return pi;
        },
        cancel: async (id) => {
          const pi = store.get(String(id));
          if (pi) pi.status = 'canceled';
          return pi;
        },
        update: async () => ({ ok: true })
      }
    }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await PromoCode.syncIndexes();
  app = buildApp();
});

test.beforeEach(async () => {
  await Promise.all([
    GiftVoucher.deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    PromoCode.deleteMany({}),
    Cabin.deleteMany({})
  ]);
  voucherSeq = 0;
  bookingRoutes.__resetStripeClientForTesting();
});

test.after(async () => {
  bookingRoutes.__resetStripeClientForTesting();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('paymentIntentMatchesVoucherCheckout rejects amount and promo metadata drift', () => {
  const quote = {
    subtotalPrice: 360,
    discountAmount: 36,
    totalPrice: 324,
    appliedPromoCode: 'HOTFIX10'
  };
  const pi = {
    amount: 11000,
    metadata: {
      promoCode: '',
      subtotalCents: '36000',
      discountAmountCents: '0',
      finalTotalCents: '36000',
      voucherAppliedCents: '25000',
      redemptionId: 'red_1'
    }
  };
  const match = bookingQuoteService.paymentIntentMatchesVoucherCheckout(pi, {
    quote,
    stripeAmountCents: 7400,
    voucherAppliedCents: 25000,
    redemptionId: 'red_1'
  });
  assert.equal(match.ok, false);
});

test('voucher + promo checkout replaces stale PI when stored amount drifts from quote', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  await PromoCode.create({
    code: 'HOTFIX10',
    internalName: 'Hotfix 10 percent',
    discountType: 'percent',
    discountValue: 10,
    isActive: true
  });

  const mock = createMockStripeStore();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_hotfix_voucher_promo_1',
    voucherCode: voucher.code,
    promoCode: 'HOTFIX10'
  };

  const first = await postPaymentIntent(request(app), payload, 1);
  assert.equal(first.status, 200);
  assert.equal(first.body.success, true);
  const amountB = first.body.stripeAmountCents;
  assert.equal(amountB, 7400);
  const piIdA = first.body.paymentIntentId;
  mock.store.get(piIdA).amount = 11000;

  const second = await postPaymentIntent(request(app), payload, 2);
  assert.equal(second.status, 200);
  assert.equal(second.body.success, true);
  assert.notEqual(second.body.paymentIntentId, piIdA);
  assert.equal(second.body.stripeAmountCents, amountB);
  assert.equal(second.body.stripeAmountCents, mock.store.get(second.body.paymentIntentId).amount);
  assert.equal(mock.store.get(piIdA).status, 'canceled');
});

test('identical voucher checkout replays PI when amount and metadata still match', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const mock = createMockStripeStore();
  let createCalls = 0;
  const wrapped = {
    paymentIntents: {
      create: async (payload) => {
        createCalls += 1;
        return mock.client.paymentIntents.create(payload);
      },
      retrieve: mock.client.paymentIntents.retrieve,
      cancel: mock.client.paymentIntents.cancel,
      update: async () => ({ ok: true })
    }
  };
  bookingRoutes.__setStripeClientForTesting(wrapped);

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_hotfix_idempotent_1',
    voucherCode: voucher.code
  };

  const first = await postPaymentIntent(request(app), payload, 10);
  const second = await postPaymentIntent(request(app), payload, 11);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotentReplay, true);
  assert.equal(second.body.paymentIntentId, first.body.paymentIntentId);
  assert.equal(second.body.stripeAmountCents, first.body.stripeAmountCents);
  assert.equal(second.body.stripeAmountCents, mock.store.get(first.body.paymentIntentId).amount);
  assert.equal(createCalls, 1);
});

test('stale stored PI amount is replaced on identical replay params', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const mock = createMockStripeStore();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  const payload = {
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_hotfix_stale_amount_1',
    voucherCode: voucher.code
  };

  const first = await postPaymentIntent(request(app), payload, 20);
  assert.equal(first.status, 200);
  const piId = first.body.paymentIntentId;
  mock.store.get(piId).amount = 99999;

  const second = await postPaymentIntent(request(app), payload, 21);
  assert.equal(second.status, 200);
  assert.notEqual(second.body.paymentIntentId, piId);
  assert.equal(second.body.stripeAmountCents, 11000);
  assert.equal(second.body.stripeAmountCents, mock.store.get(second.body.paymentIntentId).amount);
});

test('promo-only create-payment-intent still charges discounted PI amount', async () => {
  const cabin = await createCabin();
  await PromoCode.create({
    code: 'PROMOONLY10',
    internalName: 'Promo only',
    discountType: 'percent',
    discountValue: 10,
    isActive: true
  });
  const mock = createMockStripeStore();
  bookingRoutes.__setStripeClientForTesting(mock.client);

  const response = await postPaymentIntent(request(app), {
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    promoCode: 'PROMOONLY10'
  }, 30);

  assert.equal(response.status, 200);
  assert.equal(response.body.stripeAmountCents, 32400);
  assert.equal(response.body.stripeAmountCents, mock.store.get(response.body.paymentIntentId).amount);
  assert.equal(response.body.discountAmountCents, 3600);
});
