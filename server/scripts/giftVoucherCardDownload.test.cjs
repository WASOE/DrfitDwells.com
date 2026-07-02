'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const giftVoucherRoutes = require('../routes/giftVoucherRoutes');
const {
  issueCardAccessToken,
  hashCardAccessToken,
  CARD_ACCESS_NOT_FOUND
} = require('../services/giftVouchers/giftVoucherCardAccessService');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent,
  computeGiftVoucherPricing
} = require('../services/giftVouchers/giftVoucherPaymentService');
const { voidVoucher } = require('../services/ops/domain/giftVoucherWriteService');

let mongoServer;
let app;

function buildCreatePayload(overrides = {}) {
  return {
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: 'gvr_dl_req_12345678',
    ...overrides
  };
}

function buildWebhookEvent({ voucherId, purchaseRequestId, paymentIntentId, eventId }) {
  const { totalDueCents } = computeGiftVoucherPricing({ amountOriginalCents: 15000, deliveryMode: 'email' });
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: totalDueCents,
        amount_received: totalDueCents,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: voucherId,
          purchaseRequestId
        }
      }
    }
  };
}

function buildApp({ cardAccessMax = 60 } = {}) {
  const instance = express();
  const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: cardAccessMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: CARD_ACCESS_NOT_FOUND
  });
  instance.use('/api/gift-vouchers', (req, res, next) => {
    if (req.path.startsWith('/card/')) {
      return strictLimiter(req, res, next);
    }
    return next();
  }, giftVoucherRoutes);
  return instance;
}

async function activateVoucherWithToken() {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_dl_test_001', client_secret: 'sec' })
    }
  });
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const voucherId = created.giftVoucherId;
  const activation = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId,
      purchaseRequestId: created.purchaseRequestId,
      paymentIntentId: created.stripePaymentIntentId,
      eventId: 'evt_dl_001'
    })
  );
  assert.ok(activation.cardAccessToken);
  return {
    voucherId,
    rawToken: activation.cardAccessToken,
    code: (await GiftVoucher.findById(voucherId).lean()).code
  };
}

function opsCtx({ idempotencyKey = 'void-dl-1' } = {}) {
  return {
    user: { id: 'ops_user_1', role: 'admin' },
    req: { headers: { 'x-idempotency-key': idempotencyKey } },
    idempotencyKey
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
  await mongoose.connection.dropDatabase();
  app = buildApp();
});

test('valid token returns printable HTML with real code', async () => {
  const { rawToken, code } = await activateVoucherWithToken();
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.text, /data-gv-card-mode="print"/);
  assert.match(response.text, new RegExp(code));
  assert.doesNotMatch(response.text, /XXXX-XXXX/);
});

test('wrong token returns uniform 404', async () => {
  const response = await request(app).get('/api/gift-vouchers/card/not-a-valid-token-at-all');
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, CARD_ACCESS_NOT_FOUND);
});

test('voided voucher returns uniform 404', async () => {
  const { rawToken, voucherId } = await activateVoucherWithToken();
  await voidVoucher({
    giftVoucherId: voucherId,
    note: 'test void',
    reason: 'qa',
    ctx: opsCtx({ idempotencyKey: 'void-dl-1' })
  });
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, CARD_ACCESS_NOT_FOUND);
});

test('expired voucher returns uniform 404 not 410', async () => {
  const { rawToken, voucherId } = await activateVoucherWithToken();
  await GiftVoucher.updateOne(
    { _id: voucherId },
    { $set: { expiresAt: new Date('2020-01-01T00:00:00.000Z') } }
  );
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, CARD_ACCESS_NOT_FOUND);
});

test('pending_payment voucher returns uniform 404', async () => {
  const { rawToken, tokenHash } = issueCardAccessToken();
  await GiftVoucher.create({
    status: 'pending_payment',
    amountOriginalCents: 15000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    buyerName: 'A',
    buyerEmail: 'a@example.com',
    recipientName: 'B',
    recipientEmail: 'b@example.com',
    code: null,
    cardAccessTokenHash: tokenHash,
    stripePaymentIntentId: 'pi_pending_only',
    purchaseRequestId: 'gvr_pending_only_1'
  });
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, CARD_ACCESS_NOT_FOUND);
});

test('refunded voucher returns uniform 404', async () => {
  const { rawToken, voucherId } = await activateVoucherWithToken();
  await GiftVoucher.updateOne({ _id: voucherId }, { $set: { status: 'refunded' } });
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, CARD_ACCESS_NOT_FOUND);
});

test('partially_redeemed voucher remains downloadable', async () => {
  const { rawToken, voucherId, code } = await activateVoucherWithToken();
  await GiftVoucher.updateOne(
    { _id: voucherId },
    { $set: { status: 'partially_redeemed', balanceRemainingCents: 5000 } }
  );
  const response = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(response.status, 200);
  assert.match(response.text, new RegExp(code));
});

test('activation sets cardAccessTokenHash and webhook replay does not rotate hash', async () => {
  const { rawToken, voucherId } = await activateVoucherWithToken();
  const first = await GiftVoucher.findById(voucherId).lean();
  const firstHash = first.cardAccessTokenHash;
  assert.equal(firstHash, hashCardAccessToken(rawToken));

  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_dl_test_001', client_secret: 'sec' })
    }
  });
  const replay = await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      voucherId,
      purchaseRequestId: 'gvr_dl_req_12345678',
      paymentIntentId: 'pi_dl_test_001',
      eventId: 'evt_dl_002'
    })
  );
  assert.equal(replay.cardAccessToken, undefined);
  const second = await GiftVoucher.findById(voucherId).lean();
  assert.equal(second.cardAccessTokenHash, firstHash);
});

test('download URL path does not contain voucher code', async () => {
  const { rawToken, code } = await activateVoucherWithToken();
  assert.doesNotMatch(`/api/gift-vouchers/card/${rawToken}`, new RegExp(code));
});

test('rate limit returns 429 with generic not-found body', async () => {
  app = buildApp({ cardAccessMax: 2 });
  const { rawToken } = await activateVoucherWithToken();
  assert.equal((await request(app).get(`/api/gift-vouchers/card/${rawToken}`)).status, 200);
  assert.equal((await request(app).get(`/api/gift-vouchers/card/${rawToken}`)).status, 200);
  const third = await request(app).get(`/api/gift-vouchers/card/${rawToken}`);
  assert.equal(third.status, 429);
  assert.deepEqual(third.body, CARD_ACCESS_NOT_FOUND);
});
