const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  INDEX_NAME,
  isEquivalentIndex,
  findDuplicatePurchaseRequestIds
} = require('./ensureGiftVoucherPurchaseRequestIndex');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const {
  setStripeClientForTesting,
  quoteGiftVoucherPurchase,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent,
  PHYSICAL_CARD_FEE_CENTS,
  computeGiftVoucherPricing,
  __resetPurchaseRequestIndexCheckForTests
} = require('../services/giftVouchers/giftVoucherPaymentService');

let mongoServer;
let lastStripeCreatePayload = null;
let stripeCreateCalls = [];
let stripeIntentsByIdempotencyKey = new Map();
let stripeIntentsById = new Map();

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
    deliveryOption: 'recipient_now',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: 'gvr_req_12345678',
    attribution: {
      referralCode: 'ref-12',
      landingPath: '/gift-vouchers',
      utmSource: 'ig',
      utmMedium: 'social',
      utmCampaign: 'spring'
    },
    ...overrides
  };
}

function buildLegacyPurchaseFingerprint(payload) {
  const canonical = {
    amountOriginalCents: payload.amountOriginalCents,
    currency: payload.currency,
    buyerName: payload.buyerName,
    buyerEmail: payload.buyerEmail,
    recipientName: payload.recipientName,
    recipientEmail: payload.recipientEmail,
    deliveryMode: payload.deliveryMode,
    deliveryOption: payload.deliveryOption,
    cardOccasion: payload.cardOccasion || null,
    cardTemplateId: payload.cardTemplateId || null,
    cardLocale: payload.cardLocale || null,
    message: payload.message || null,
    deliveryAddress: {
      addressLine1: payload.deliveryAddress?.addressLine1 || null,
      addressLine2: payload.deliveryAddress?.addressLine2 || null,
      city: payload.deliveryAddress?.city || null,
      postalCode: payload.deliveryAddress?.postalCode || null,
      country: payload.deliveryAddress?.country || null
    }
  };
  if (payload.deliveryOption === 'scheduled' && payload.deliveryDate) {
    canonical.scheduledDeliveryDate = payload.deliveryDate.toISOString();
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function buildPostalPayload(overrides = {}) {
  return buildCreatePayload({
    deliveryMode: 'postal',
    deliveryOption: 'postal',
    recipientEmail: null,
    deliveryAddress: {
      addressLine1: '16 Forest Lane',
      addressLine2: 'Apt 2',
      city: 'Plovdiv',
      postalCode: '4000',
      country: 'Bulgaria'
    },
    ...overrides
  });
}

function buildWebhookEvent(overrides = {}) {
  return {
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_1',
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: '',
          purchaseRequestId: ''
        }
      }
    },
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await ManualReviewItem.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await ManualReviewItem.deleteMany({});
  await GiftVoucher.deleteMany({});
  lastStripeCreatePayload = null;
  stripeCreateCalls = [];
  stripeIntentsByIdempotencyKey = new Map();
  stripeIntentsById = new Map();
  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload, options = {}) => {
        lastStripeCreatePayload = payload;
        stripeCreateCalls.push({ payload, options });
        const existing = stripeIntentsByIdempotencyKey.get(options.idempotencyKey);
        if (existing) return existing;
        const intent = { id: `pi_${stripeIntentsById.size + 1}`, client_secret: `cs_${stripeIntentsById.size + 1}` };
        stripeIntentsByIdempotencyKey.set(options.idempotencyKey, intent);
        stripeIntentsById.set(intent.id, intent);
        return intent;
      },
      retrieve: async (id) => stripeIntentsById.get(id) || { id, client_secret: 'cs_retrieved' }
    }
  });
});

test('quote rejects amount below 1500 cents (EUR 15 minimum)', async () => {
  assert.throws(
    () => quoteGiftVoucherPurchase({ amountOriginalCents: 1499, currency: 'EUR' }),
    (err) => err.code === 'AMOUNT_BELOW_MINIMUM'
  );
});

test('quote accepts exactly 1500 cents (EUR 15 minimum)', async () => {
  const result = quoteGiftVoucherPurchase({ amountOriginalCents: 1500, currency: 'EUR' });
  assert.equal(result.ok, true);
  assert.equal(result.amountOriginalCents, 1500);
  assert.equal(result.currency, 'EUR');
  assert.equal(result.minimumAmountCents, 1500);
});

test('create-payment-intent accepts exactly 1500 cents (EUR 15 minimum)', async () => {
  const result = await createGiftVoucherPaymentIntent(buildCreatePayload({
    amountOriginalCents: 1500,
    purchaseRequestId: 'gvr_min_boundary_1'
  }));
  assert.equal(result.ok, true);
  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 1500);
  assert.equal(voucher.balanceRemainingCents, 1500);
});

test('create-payment-intent creates pending voucher, PI, and payment_pending event', async () => {
  const result = await createGiftVoucherPaymentIntent(buildCreatePayload());
  assert.equal(result.ok, true);
  assert.equal(result.idempotentReplay, false);
  assert.equal(result.stripePaymentIntentId, 'pi_1');

  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.status, 'pending_payment');
  assert.equal(voucher.stripePaymentIntentId, 'pi_1');
  assert.equal(typeof voucher.purchaseFingerprint, 'string');
  assert.equal(Boolean(voucher.termsAcceptedAt), true);
  assert.equal(voucher.termsVersion, 'v1');

  const event = await GiftVoucherEvent.findOne({ giftVoucherId: voucher._id, type: 'payment_pending' }).lean();
  assert.ok(event);
});

test('purchase request unique partial index protects request IDs without restricting historical records', async () => {
  const indexes = await GiftVoucher.collection.indexes();
  const index = indexes.find((candidate) => candidate.name === INDEX_NAME);
  assert.ok(isEquivalentIndex(index));
  await GiftVoucher.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    amountOriginalCents: 1500,
    balanceRemainingCents: 1500,
    currency: 'EUR',
    status: 'active',
    purchaseRequestId: null
  });
  await GiftVoucher.collection.insertOne({
    _id: new mongoose.Types.ObjectId(),
    amountOriginalCents: 1500,
    balanceRemainingCents: 1500,
    currency: 'EUR',
    status: 'active',
    purchaseRequestId: null
  });
  const requestRecord = {
    amountOriginalCents: 1500,
    balanceRemainingCents: 1500,
    currency: 'EUR',
    status: 'pending_payment',
    purchaseRequestId: 'gvr_unique_test_1'
  };
  await GiftVoucher.collection.insertOne({ _id: new mongoose.Types.ObjectId(), ...requestRecord });
  await assert.rejects(
    () => GiftVoucher.collection.insertOne({ _id: new mongoose.Types.ObjectId(), ...requestRecord }),
    (error) => error.code === 11000
  );
});

test('payment preparation fails closed when the purchase request index is absent', async () => {
  await GiftVoucher.collection.dropIndex(INDEX_NAME);
  __resetPurchaseRequestIndexCheckForTests();
  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload()),
    (error) => error.code === 'PURCHASE_REQUEST_INDEX_NOT_READY'
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
  await GiftVoucher.collection.createIndex(
    { purchaseRequestId: 1 },
    {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: { purchaseRequestId: { $type: 'string' } }
    }
  );
  __resetPurchaseRequestIndexCheckForTests();
});

test('migration duplicate preflight reports existing IDs without exposing them', async () => {
  const collection = mongoose.connection.db.collection('gift_voucher_purchase_id_preflight_test');
  await collection.insertMany([
    { purchaseRequestId: 'sensitive-request-id-1' },
    { purchaseRequestId: 'sensitive-request-id-1' },
    { purchaseRequestId: null }
  ]);
  try {
    const summary = await findDuplicatePurchaseRequestIds(collection);
    assert.equal(summary.count, 1);
    assert.equal(summary.samples[0].count, 2);
    assert.equal(summary.samples[0]._id, 'sensitive-request-id-1');
  } finally {
    await collection.drop();
  }
});

test('terms not accepted creates nothing', async () => {
  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload({ termsAccepted: false })),
    (err) => err.code === 'TERMS_NOT_ACCEPTED'
  );
  assert.equal(await GiftVoucher.countDocuments({}), 0);
  assert.equal(await GiftVoucherEvent.countDocuments({}), 0);
});

test('email mode requires recipientEmail', async () => {
  await assert.rejects(
    () =>
      createGiftVoucherPaymentIntent(
        buildCreatePayload({
          deliveryMode: 'email',
          recipientEmail: null,
          purchaseRequestId: 'gvr_req_email_requires_recipient'
        })
      ),
    (err) => err.code === 'MISSING_REQUIRED_FIELDS'
  );
});

test('postal mode accepts valid postal address without recipientEmail', async () => {
  const result = await createGiftVoucherPaymentIntent(
    buildPostalPayload({ purchaseRequestId: 'gvr_req_postal_valid_1' })
  );
  assert.equal(result.ok, true);
  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.deliveryMode, 'postal');
  assert.equal(voucher.recipientEmail, null);
  assert.equal(voucher.deliveryAddress.addressLine1, '16 Forest Lane');
});

test('postal mode rejects missing required address fields', async () => {
  await assert.rejects(
    () =>
      createGiftVoucherPaymentIntent(
        buildPostalPayload({
          purchaseRequestId: 'gvr_req_postal_missing_addr',
          deliveryAddress: {
            addressLine1: '',
            city: '',
            postalCode: '',
            country: ''
          }
        })
      ),
    (err) => err.code === 'MISSING_REQUIRED_FIELDS'
  );
});

test('same purchaseRequestId and same fingerprint returns existing voucher/payment intent', async () => {
  const first = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const second = await createGiftVoucherPaymentIntent(buildCreatePayload());
  assert.equal(second.ok, true);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.giftVoucherId, first.giftVoucherId);
  assert.equal(await GiftVoucher.countDocuments({}), 1);
});

test('legacy pending purchase fingerprint replays only when stored attribution also matches', async () => {
  const payload = buildCreatePayload();
  const first = await createGiftVoucherPaymentIntent(payload);
  await GiftVoucher.updateOne(
    { _id: first.giftVoucherId },
    { $set: { purchaseFingerprint: buildLegacyPurchaseFingerprint(payload) } }
  );

  const replay = await createGiftVoucherPaymentIntent(payload);
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.giftVoucherId, first.giftVoucherId);
  assert.equal(replay.stripePaymentIntentId, first.stripePaymentIntentId);
  assert.equal(stripeCreateCalls.length, 1);
  assert.equal(await GiftVoucher.countDocuments({}), 1);
});

test('legacy pending purchase rejects a changed attribution fingerprint', async () => {
  const payload = buildCreatePayload();
  const first = await createGiftVoucherPaymentIntent(payload);
  await GiftVoucher.updateOne(
    { _id: first.giftVoucherId },
    { $set: { purchaseFingerprint: buildLegacyPurchaseFingerprint(payload) } }
  );

  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload({
      attribution: { referralCode: 'different-referral' }
    })),
    (err) => err.code === 'PURCHASE_REQUEST_CONFLICT'
  );
  assert.equal(stripeCreateCalls.length, 1);
});

test('same purchaseRequestId and different fingerprint returns conflict', async () => {
  await createGiftVoucherPaymentIntent(buildCreatePayload());
  await assert.rejects(
    () =>
      createGiftVoucherPaymentIntent(
        buildCreatePayload({
          amountOriginalCents: 20000
        })
      ),
    (err) => err.code === 'PURCHASE_REQUEST_CONFLICT'
  );
  assert.equal(await GiftVoucher.countDocuments({}), 1);
});

test('same purchaseRequestId with different postal address returns conflict', async () => {
  await createGiftVoucherPaymentIntent(
    buildPostalPayload({ purchaseRequestId: 'gvr_req_postal_conflict_1' })
  );
  await assert.rejects(
    () =>
      createGiftVoucherPaymentIntent(
        buildPostalPayload({
          purchaseRequestId: 'gvr_req_postal_conflict_1',
          deliveryAddress: {
            addressLine1: '99 River Road',
            addressLine2: null,
            city: 'Sofia',
            postalCode: '1000',
            country: 'Bulgaria'
          }
        })
      ),
    (err) => err.code === 'PURCHASE_REQUEST_CONFLICT'
  );
});

test('same purchaseRequestId with changed attribution returns conflict', async () => {
  await createGiftVoucherPaymentIntent(buildCreatePayload());
  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload({
      attribution: { referralCode: 'different-referral' }
    })),
    (err) => err.code === 'PURCHASE_REQUEST_CONFLICT'
  );
  assert.equal(await GiftVoucher.countDocuments({}), 1);
});

test('20 simultaneous requests reserve one voucher and one Stripe intent', async () => {
  let creationStarted = false;
  let releaseCreate;
  const creationGate = new Promise((resolve) => { releaseCreate = resolve; });
  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload, options = {}) => {
        stripeCreateCalls.push({ payload, options });
        const existing = stripeIntentsByIdempotencyKey.get(options.idempotencyKey);
        if (existing) return existing;
        if (creationStarted) {
          const error = new Error('same idempotency key is currently in progress');
          error.code = 'idempotency_key_in_use';
          error.statusCode = 409;
          throw error;
        }
        creationStarted = true;
        await creationGate;
        const intent = { id: `pi_${stripeIntentsById.size + 1}`, client_secret: `cs_${stripeIntentsById.size + 1}` };
        stripeIntentsByIdempotencyKey.set(options.idempotencyKey, intent);
        stripeIntentsById.set(intent.id, intent);
        return intent;
      },
      retrieve: async (id) => stripeIntentsById.get(id)
    }
  });
  const pending = Promise.all(Array.from({ length: 20 }, () => createGiftVoucherPaymentIntent(buildCreatePayload())));
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseCreate();
  const results = await pending;
  const voucherIds = new Set(results.map((result) => result.giftVoucherId));
  const paymentIntentIds = new Set(results.map((result) => result.stripePaymentIntentId));
  const idempotencyKeys = new Set(stripeCreateCalls.map(({ options }) => options.idempotencyKey));
  assert.equal(await GiftVoucher.countDocuments({ purchaseRequestId: 'gvr_req_12345678' }), 1);
  assert.equal(await GiftVoucher.countDocuments({}), 1);
  assert.equal(voucherIds.size, 1);
  assert.equal(paymentIntentIds.size, 1);
  assert.equal(stripeIntentsById.size, 1);
  assert.equal(idempotencyKeys.size, 1);
  assert.ok(results.some((result) => result.idempotentReplay));
  assert.equal(await GiftVoucherEvent.countDocuments({ type: 'payment_pending' }), 1);
});

test('Stripe failure preserves the reservation and same-ID retry recovers using the same Stripe key', async () => {
  setStripeClientForTesting({
    paymentIntents: {
      create: async (_payload, { idempotencyKey }) => {
        stripeCreateCalls.push({ options: { idempotencyKey } });
        throw new Error('temporary Stripe outage');
      },
      retrieve: async (id) => ({ id, client_secret: 'cs_retried' })
    }
  });
  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload()),
    (err) => err.code === 'PAYMENT_INTENT_INIT_FAILED'
  );
  const pending = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_req_12345678' }).lean();
  assert.equal(pending.status, 'pending_payment');
  assert.equal(pending.stripePaymentIntentId, null);

  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload, options) => {
        stripeCreateCalls.push({ payload, options });
        const existing = stripeIntentsByIdempotencyKey.get(options.idempotencyKey);
        if (existing) return existing;
        const intent = { id: 'pi_recovered', client_secret: 'cs_recovered' };
        stripeIntentsByIdempotencyKey.set(options.idempotencyKey, intent);
        stripeIntentsById.set(intent.id, intent);
        return intent;
      },
      retrieve: async (id) => stripeIntentsById.get(id)
    }
  });
  const result = await createGiftVoucherPaymentIntent(buildCreatePayload());
  assert.equal(result.stripePaymentIntentId, 'pi_recovered');
  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_req_12345678' }).lean();
  assert.equal(voucher.stripePaymentIntentId, 'pi_recovered');
  assert.equal(new Set(stripeCreateCalls.map(({ options }) => options.idempotencyKey)).size, 1);
  assert.equal(stripeIntentsById.size, 1);
});

test('database linkage failure is recovered on retry without creating another Stripe intent', async () => {
  const originalUpdateOne = GiftVoucher.updateOne.bind(GiftVoucher);
  let failLinkOnce = true;
  GiftVoucher.updateOne = async (...args) => {
    if (failLinkOnce && args[1]?.$set?.stripePaymentIntentId) {
      failLinkOnce = false;
      throw new Error('temporary database write failure');
    }
    return originalUpdateOne(...args);
  };
  try {
    await assert.rejects(
      () => createGiftVoucherPaymentIntent(buildCreatePayload()),
      (err) => err.code === 'PAYMENT_INTENT_INIT_FAILED'
    );
  } finally {
    GiftVoucher.updateOne = originalUpdateOne;
  }
  assert.equal(await GiftVoucher.countDocuments({}), 1);
  assert.equal(stripeIntentsById.size, 1);

  const recovered = await createGiftVoucherPaymentIntent(buildCreatePayload());
  assert.equal(recovered.stripePaymentIntentId, 'pi_1');
  assert.equal(stripeIntentsById.size, 1);
  const voucher = await GiftVoucher.findById(recovered.giftVoucherId).lean();
  assert.equal(voucher.stripePaymentIntentId, 'pi_1');
});

test('same purchaseRequestId after Stripe failure remains retryable, not voided', async () => {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        throw new Error('stripe down');
      },
      retrieve: async () => ({ id: 'pi_none', client_secret: null })
    }
  });

  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload()),
    (err) => err.code === 'PAYMENT_INTENT_INIT_FAILED'
  );
  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_req_12345678' }).lean();
  assert.equal(voucher.status, 'pending_payment');
  assert.equal(voucher.stripePaymentIntentId, null);
  assert.equal(await ManualReviewItem.countDocuments({}), 0);
});

test('payment_intent.succeeded activates voucher', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    id: 'evt_activate_1',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });

  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, true);

  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.status, 'active');
  assert.ok(voucher.code);
  assert.ok(voucher.activatedAt);
  assert.equal(voucher.stripeEventIdsProcessed.includes('evt_activate_1'), true);
});

test('duplicate webhook is idempotent and does not duplicate paid/activated events', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    id: 'evt_dupe_1',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });

  await activatePaidVoucherFromStripeEvent(event);
  await activatePaidVoucherFromStripeEvent(event);

  const paidCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'paid',
    'metadata.stripeEventId': 'evt_dupe_1'
  });
  const activatedCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'activated',
    'metadata.stripeEventId': 'evt_dupe_1'
  });
  assert.equal(paidCount, 1);
  assert.equal(activatedCount, 1);
});

test('concurrent duplicate webhook calls remain idempotent for paid/activated events', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload({ purchaseRequestId: 'gvr_req_concurrent_1' }));
  const event = buildWebhookEvent({
    id: 'evt_concurrent_dupe_1',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });

  await Promise.all([
    activatePaidVoucherFromStripeEvent(event),
    activatePaidVoucherFromStripeEvent(event),
    activatePaidVoucherFromStripeEvent(event)
  ]);

  const paidCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'paid',
    'metadata.stripeEventId': 'evt_concurrent_dupe_1'
  });
  const activatedCount = await GiftVoucherEvent.countDocuments({
    giftVoucherId: created.giftVoucherId,
    type: 'activated',
    'metadata.stripeEventId': 'evt_concurrent_dupe_1'
  });
  assert.equal(paidCount, 1);
  assert.equal(activatedCount, 1);
});

test('amount mismatch does not activate and opens manual review', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    id: 'evt_amt_mismatch',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 14000,
        amount_received: 14000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });
  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, false);
  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.status, 'pending_payment');
  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
  assert.ok(review);
});

test('currency mismatch does not activate and opens manual review', async () => {
  const created = await createGiftVoucherPaymentIntent(buildCreatePayload());
  const event = buildWebhookEvent({
    id: 'evt_currency_mismatch',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'usd',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });
  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, false);
  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
  assert.ok(review);
});

test('missing voucher opens payment_unlinked manual review', async () => {
  const event = buildWebhookEvent({
    id: 'evt_missing_voucher',
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_missing',
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(new mongoose.Types.ObjectId()),
          purchaseRequestId: 'gvr_missing'
        }
      }
    }
  });
  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, false);
  const review = await ManualReviewItem.findOne({ category: 'payment_unlinked' }).lean();
  assert.ok(review);
});

test('no public activate route exists', async () => {
  const routeFile = path.join(__dirname, '..', 'routes', 'giftVoucherRoutes.js');
  const content = fs.readFileSync(routeFile, 'utf8');
  assert.equal(content.includes('/activate'), false);
});

test('quote email returns zero physical fee and totalDueCents 5000 for EUR 50', () => {
  const result = quoteGiftVoucherPurchase({
    amountOriginalCents: 5000,
    currency: 'EUR',
    deliveryMode: 'email'
  });
  assert.equal(result.physicalCardFeeCents, 0);
  assert.equal(result.totalDueCents, 5000);
});

test('quote postal returns physical fee 500 and totalDueCents 5500 for EUR 50', () => {
  const result = quoteGiftVoucherPurchase({
    amountOriginalCents: 5000,
    currency: 'EUR',
    deliveryMode: 'postal'
  });
  assert.equal(result.physicalCardFeeCents, PHYSICAL_CARD_FEE_CENTS);
  assert.equal(result.totalDueCents, 5500);
});

test('email EUR 50 charges 5000 with voucher balance 5000 and fee 0', async () => {
  const result = await createGiftVoucherPaymentIntent(
    buildCreatePayload({
      amountOriginalCents: 5000,
      purchaseRequestId: 'gvr_email_fee_50'
    })
  );
  assert.equal(result.ok, true);
  assert.equal(lastStripeCreatePayload.amount, 5000);
  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 5000);
  assert.equal(voucher.balanceRemainingCents, 5000);
  assert.equal(voucher.physicalCardFeeCents, 0);
  assert.equal(lastStripeCreatePayload.metadata.voucherValueCents, '5000');
  assert.equal(lastStripeCreatePayload.metadata.physicalCardFeeCents, '0');
  assert.equal(lastStripeCreatePayload.metadata.totalDueCents, '5000');
  assert.equal(lastStripeCreatePayload.metadata.deliveryMode, 'email');
});

test('postal EUR 50 charges 5500 with voucher balance 5000 and fee 500', async () => {
  const result = await createGiftVoucherPaymentIntent(
    buildPostalPayload({
      amountOriginalCents: 5000,
      purchaseRequestId: 'gvr_postal_fee_50'
    })
  );
  assert.equal(result.ok, true);
  assert.equal(lastStripeCreatePayload.amount, 5500);
  const voucher = await GiftVoucher.findById(result.giftVoucherId).lean();
  assert.equal(voucher.amountOriginalCents, 5000);
  assert.equal(voucher.balanceRemainingCents, 5000);
  assert.equal(voucher.physicalCardFeeCents, 500);
  assert.equal(lastStripeCreatePayload.metadata.voucherValueCents, '5000');
  assert.equal(lastStripeCreatePayload.metadata.physicalCardFeeCents, '500');
  assert.equal(lastStripeCreatePayload.metadata.totalDueCents, '5500');
  assert.equal(lastStripeCreatePayload.metadata.deliveryMode, 'postal');
});

test('postal webhook activation succeeds when paid amount is voucher value plus fee', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildPostalPayload({
      amountOriginalCents: 5000,
      purchaseRequestId: 'gvr_postal_webhook_ok'
    })
  );
  const event = buildWebhookEvent({
    id: 'evt_postal_ok',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 5500,
        amount_received: 5500,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });
  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, true);
  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.status, 'active');
  assert.equal(voucher.balanceRemainingCents, 5000);
});

test('postal paid amount equal to voucher value only triggers amount mismatch', async () => {
  const created = await createGiftVoucherPaymentIntent(
    buildPostalPayload({
      amountOriginalCents: 5000,
      purchaseRequestId: 'gvr_postal_value_only_mismatch'
    })
  );
  const event = buildWebhookEvent({
    id: 'evt_postal_value_only',
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 5000,
        amount_received: 5000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  });
  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAYMENT_AMOUNT_MISMATCH');
  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
  assert.ok(review);
});

test('computeGiftVoucherPricing keeps fee out of redeemable voucher value', () => {
  const pricing = computeGiftVoucherPricing({ amountOriginalCents: 5000, deliveryMode: 'postal' });
  assert.equal(pricing.amountOriginalCents, 5000);
  assert.equal(pricing.physicalCardFeeCents, 500);
  assert.equal(pricing.totalDueCents, 5500);
});
