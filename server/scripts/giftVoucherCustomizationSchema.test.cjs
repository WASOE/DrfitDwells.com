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
  buildPurchaseFingerprint,
  createGiftVoucherPaymentIntent
} = require('../services/giftVouchers/giftVoucherPaymentService');
const {
  resolveDeliveryOption,
  deliveryModeFromOption,
  validateScheduledDeliveryDate,
  addCalendarDaysIso,
  sofiaDateIso
} = require('../services/giftVouchers/giftVoucherDeliveryOption');
const { SCHEDULED_DELIVERY_ENV_FLAG } = require('../services/giftVouchers/giftVoucherCustomizationConstants');

let mongoServer;
let app;
let purchaseSeq = 0;
let originalScheduledFlag;

function buildApp() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(express.json());
  instance.use('/api/gift-vouchers', giftVoucherRoutes);
  return instance;
}

function basePayload(overrides = {}) {
  purchaseSeq += 1;
  return {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    purchaseRequestId: `gvr_custom_${purchaseSeq}`,
    termsAccepted: true,
    termsVersion: 'v1',
    ...overrides
  };
}

function mockStripe() {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: `pi_custom_${Date.now()}`, client_secret: 'cs_custom' }),
      retrieve: async (id) => ({ id, client_secret: 'cs_custom' })
    }
  });
}

test.before(async () => {
  originalScheduledFlag = process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  delete process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  app = buildApp();
  mockStripe();
});

test.after(async () => {
  if (originalScheduledFlag === undefined) {
    delete process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  } else {
    process.env[SCHEDULED_DELIVERY_ENV_FLAG] = originalScheduledFlag;
  }
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  delete process.env[SCHEDULED_DELIVERY_ENV_FLAG];
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucher.deleteMany({});
  mockStripe();
});

test('schema stores customization fields and null legacy defaults', async () => {
  const voucher = await GiftVoucher.create({
    amountOriginalCents: 5000,
    balanceRemainingCents: 5000,
    currency: 'EUR',
    status: 'pending_payment',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryOption: 'recipient_now',
    deliveryMode: 'email',
    cardOccasion: 'birthday',
    cardTemplateId: 'forest',
    cardLocale: 'bg'
  });
  assert.equal(voucher.cardOccasion, 'birthday');
  assert.equal(voucher.cardTemplateId, 'forest');
  assert.equal(voucher.cardLocale, 'bg');
  assert.equal(voucher.deliveryOption, 'recipient_now');

  const legacy = await GiftVoucher.create({
    amountOriginalCents: 5000,
    balanceRemainingCents: 5000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    code: 'DD-LEGACY-AAAA'
  });
  assert.equal(legacy.cardTemplateId, null);
  assert.equal(legacy.deliveryOption, null);
});

test('message longer than 250 is rejected by API', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.1')
    .send(basePayload({ message: 'x'.repeat(251) }));
  assert.equal(response.status, 400);
});

test('fingerprint changes when customization or delivery option changes', () => {
  const base = {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    deliveryOption: 'recipient_now',
    message: 'Hello'
  };
  const a = buildPurchaseFingerprint(base);
  const b = buildPurchaseFingerprint({ ...base, cardTemplateId: 'minimal' });
  const c = buildPurchaseFingerprint({ ...base, message: 'Changed' });
  const d = buildPurchaseFingerprint({ ...base, deliveryOption: 'send_to_buyer', recipientEmail: null });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('fingerprint excludes deliveryDate unless scheduled', () => {
  const deliveryDate = new Date('2026-08-01T10:00:00.000Z');
  const base = {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    deliveryMode: 'email',
    deliveryOption: 'recipient_now',
    deliveryDate
  };
  const withoutScheduled = buildPurchaseFingerprint(base);
  const withDifferentDate = buildPurchaseFingerprint({
    ...base,
    deliveryDate: new Date('2026-09-01T10:00:00.000Z')
  });
  assert.equal(withoutScheduled, withDifferentDate);

  const scheduledA = buildPurchaseFingerprint({ ...base, deliveryOption: 'scheduled' });
  const scheduledB = buildPurchaseFingerprint({
    ...base,
    deliveryOption: 'scheduled',
    deliveryDate: new Date('2026-09-01T10:00:00.000Z')
  });
  assert.notEqual(scheduledA, scheduledB);
});

test('delivery option mapping derives deliveryMode', () => {
  assert.equal(deliveryModeFromOption('recipient_now'), 'email');
  assert.equal(deliveryModeFromOption('send_to_buyer'), 'email');
  assert.equal(deliveryModeFromOption('scheduled'), 'email');
  assert.equal(deliveryModeFromOption('postal'), 'postal');
});

test('legacy deliveryMode email maps to recipient_now', () => {
  assert.equal(resolveDeliveryOption({ deliveryMode: 'email' }), 'recipient_now');
});

test('legacy payload with deliveryMode email and deliveryDate succeeds as recipient_now', async () => {
  const deliveryDate = '2026-09-15';
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.2')
    .send(basePayload({ deliveryDate }));
  assert.equal(response.status, 200);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.deliveryOption, 'recipient_now');
  assert.equal(voucher.deliveryMode, 'email');
  assert.ok(voucher.deliveryDate);
});

test('send_to_buyer stores null recipientEmail', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.3')
    .send(
      basePayload({
        deliveryOption: 'send_to_buyer',
        recipientEmail: 'should-not-store@example.com'
      })
    );
  assert.equal(response.status, 200);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.deliveryOption, 'send_to_buyer');
  assert.equal(voucher.recipientEmail, null);
});

test('recipient_now without recipientEmail is rejected', async () => {
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.4')
    .send(basePayload({ deliveryOption: 'recipient_now', recipientEmail: '' }));
  assert.equal(response.status, 400);
});

test('scheduled delivery rejected while feature flag is off', async () => {
  const tomorrow = addCalendarDaysIso(sofiaDateIso(new Date()), 2);
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.5')
    .send(
      basePayload({
        deliveryOption: 'scheduled',
        deliveryDate: `${tomorrow}T09:00:00.000Z`
      })
    );
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'SCHEDULED_DELIVERY_NOT_ENABLED');
});

test('scheduled delivery accepted while feature flag is on', async () => {
  process.env[SCHEDULED_DELIVERY_ENV_FLAG] = '1';
  const tomorrow = addCalendarDaysIso(sofiaDateIso(new Date()), 2);
  const response = await request(app)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.30.0.6')
    .send(
      basePayload({
        deliveryOption: 'scheduled',
        deliveryDate: `${tomorrow}T09:00:00.000Z`
      })
    );
  assert.equal(response.status, 200);
  const voucher = await GiftVoucher.findById(response.body.data.giftVoucherId).lean();
  assert.equal(voucher.deliveryOption, 'scheduled');
});

test('scheduled date validation rejects past and far-future dates', () => {
  const createdAt = new Date('2026-07-01T12:00:00.000Z');
  assert.throws(
    () => validateScheduledDeliveryDate({ deliveryDate: new Date('2026-07-01T12:00:00.000Z'), createdAt }),
    (err) => err.code === 'INVALID_SCHEDULED_DELIVERY_DATE'
  );
  assert.throws(
    () => validateScheduledDeliveryDate({ deliveryDate: new Date('2027-08-01T12:00:00.000Z'), createdAt }),
    (err) => err.code === 'INVALID_SCHEDULED_DELIVERY_DATE'
  );
  const okDate = new Date('2026-08-01T12:00:00.000Z');
  assert.equal(validateScheduledDeliveryDate({ deliveryDate: okDate, createdAt }).toISOString(), okDate.toISOString());
});

test('manual issuance vouchers remain valid without deliveryOption', async () => {
  const voucher = await GiftVoucher.create({
    amountOriginalCents: 10000,
    balanceRemainingCents: 10000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Ops',
    buyerEmail: 'ops@example.com',
    recipientName: 'Guest',
    deliveryMode: 'manual',
    issuanceSource: 'cancellation_compensation',
    code: 'DD-MANUAL-AAAA'
  });
  assert.equal(voucher.deliveryMode, 'manual');
  assert.equal(voucher.deliveryOption, null);
});

test('purchase fingerprint idempotent replay with same customization', async () => {
  const payload = basePayload({
    cardOccasion: 'wedding',
    cardTemplateId: 'romantic',
    cardLocale: 'en',
    message: 'Congrats'
  });
  const first = await createGiftVoucherPaymentIntent(payload);
  const second = await createGiftVoucherPaymentIntent(payload);
  assert.equal(second.idempotentReplay, true);
  assert.equal(first.giftVoucherId, second.giftVoucherId);
});
