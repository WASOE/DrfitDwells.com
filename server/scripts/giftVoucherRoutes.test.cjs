const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const giftVoucherRoutes = require('../routes/giftVoucherRoutes');
const {
  setStripeClientForTesting,
  PHYSICAL_CARD_FEE_CENTS
} = require('../services/giftVouchers/giftVoucherPaymentService');

let mongoServer;
let app;
let lastStripeCreatePayload = null;
let purchaseSeq = 0;

function buildApp() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(express.json());
  instance.use('/api/gift-vouchers', giftVoucherRoutes);
  return instance;
}

function browserEmailPayload(overrides = {}) {
  purchaseSeq += 1;
  return {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Browser Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Browser Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    purchaseRequestId: `gvr_route_email_${purchaseSeq}`,
    termsAccepted: true,
    termsVersion: 'v1',
    ...overrides
  };
}

function browserPostalPayload(overrides = {}) {
  purchaseSeq += 1;
  return {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Browser Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Browser Recipient',
    deliveryMode: 'postal',
    deliveryAddress: {
      addressLine1: '16 Forest Lane',
      city: 'Plovdiv',
      postalCode: '4000',
      country: 'Bulgaria'
    },
    purchaseRequestId: `gvr_route_postal_${purchaseSeq}`,
    termsAccepted: true,
    termsVersion: 'v1',
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucher.deleteMany({});
  lastStripeCreatePayload = null;
  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => {
        lastStripeCreatePayload = payload;
        return { id: `pi_route_${Date.now()}`, client_secret: 'cs_route_1' };
      },
      retrieve: async (id) => ({ id, client_secret: 'cs_route_1' })
    }
  });
});

test('POST /quote email returns totalDueCents 5000', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/quote')
    .send({ amountOriginalCents: 5000, currency: 'EUR', deliveryMode: 'email' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.physicalCardFeeCents, 0);
  assert.equal(response.body.data.totalDueCents, 5000);
});

test('POST /quote postal returns totalDueCents 5500', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/quote')
    .send({ amountOriginalCents: 5000, currency: 'EUR', deliveryMode: 'postal' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.physicalCardFeeCents, PHYSICAL_CARD_FEE_CENTS);
  assert.equal(response.body.data.totalDueCents, 5500);
});

test('POST /create-payment-intent email browser payload charges 5000', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.20.0.1')
    .send(browserEmailPayload());
  assert.equal(response.status, 200);
  assert.equal(lastStripeCreatePayload.amount, 5000);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 5000);
  assert.equal(voucher.balanceRemainingCents, 5000);
  assert.equal(voucher.physicalCardFeeCents, 0);
});

test('POST /create-payment-intent postal browser payload charges 5500 with balance 5000', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.20.0.2')
    .send(browserPostalPayload());
  assert.equal(response.status, 200);
  assert.equal(lastStripeCreatePayload.amount, 5500);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 5000);
  assert.equal(voucher.balanceRemainingCents, 5000);
  assert.equal(voucher.physicalCardFeeCents, 500);
  assert.equal(lastStripeCreatePayload.metadata.voucherValueCents, '5000');
  assert.equal(lastStripeCreatePayload.metadata.physicalCardFeeCents, '500');
  assert.equal(lastStripeCreatePayload.metadata.totalDueCents, '5500');
  assert.equal(lastStripeCreatePayload.metadata.deliveryMode, 'postal');
});

test('POST /create-payment-intent default browser payload without message or deliveryDate works', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.20.0.3')
    .send(browserEmailPayload());
  assert.equal(response.status, 200);
  assert.ok(response.body.data.clientSecret);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.deliveryOption, 'recipient_now');
});

test('POST /create-payment-intent legacy email payload with deliveryDate still succeeds', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.20.0.4')
    .send(browserEmailPayload({ deliveryDate: '2026-09-20' }));
  assert.equal(response.status, 200);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.deliveryOption, 'recipient_now');
  assert.ok(voucher.deliveryDate);
});
