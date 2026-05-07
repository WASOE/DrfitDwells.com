const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const ManualReviewItem = require('../models/ManualReviewItem');
const {
  setStripeClientForTesting,
  quoteGiftVoucherPurchase,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent
} = require('../services/giftVouchers/giftVoucherPaymentService');

let mongoServer;

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

function buildPostalPayload(overrides = {}) {
  return buildCreatePayload({
    deliveryMode: 'postal',
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
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_1', client_secret: 'cs_1' }),
      retrieve: async () => ({ id: 'pi_1', client_secret: 'cs_1' })
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

test('same purchaseRequestId after voided PI failure returns PURCHASE_REQUEST_CLOSED', async () => {
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
  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload()),
    (err) => err.code === 'PURCHASE_REQUEST_CLOSED'
  );
});

test('PI creation failure voids voucher and writes event with no manual review', async () => {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        throw new Error('forced stripe PI failure');
      },
      retrieve: async () => ({ id: 'pi_none', client_secret: null })
    }
  });

  await assert.rejects(
    () => createGiftVoucherPaymentIntent(buildCreatePayload()),
    (err) => err.code === 'PAYMENT_INTENT_INIT_FAILED'
  );

  const voucher = await GiftVoucher.findOne({ purchaseRequestId: 'gvr_req_12345678' }).lean();
  assert.equal(voucher.status, 'voided');
  const voidedEvent = await GiftVoucherEvent.findOne({
    giftVoucherId: voucher._id,
    type: 'voided'
  }).lean();
  assert.ok(voidedEvent);
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
