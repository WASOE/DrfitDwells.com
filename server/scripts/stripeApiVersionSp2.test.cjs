/**
 * SP2 — Stripe SDK/API upgrade characterization (no split behavior).
 *
 * Proves:
 * - configured API version equals installed Stripe.API_VERSION
 * - every production `new Stripe(...)` passes the pinned apiVersion
 * - webhook constructEvent works with the upgraded SDK
 * - PaymentIntent webhook fixtures for 2023-10-16 and 2026-08-26.dahlia
 *   both ingest through the same path (idempotent redelivery preserved)
 * - gift-voucher events remain isolated from accommodation payment_unlinked
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/stripeApiVersionSp2.test.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Stripe = require('stripe');

const { STRIPE_API_VERSION } = require('../config/stripeApiVersion');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent
} = require('../services/giftVouchers/giftVoucherPaymentService');

const SERVER_ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(SERVER_ROOT, 'fixtures', 'stripe-webhooks');

const PRODUCTION_STRIPE_INIT_FILES = [
  'routes/bookingRoutes.js',
  'routes/stripeWebhookRoutes.js',
  'routes/publicLocationCheckoutRoutes.js',
  'services/giftVouchers/giftVoucherPaymentService.js',
  'services/checkout/checkoutFinalizationWorker.js',
  'services/checkout/reconcilePaidCheckoutFinalization.js',
  'services/checkout/multiUnitPaidOrphanRecoveryService.js'
];

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
}

function walkJsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'scripts') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(full, out);
      continue;
    }
    if (entry.isFile() && /\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Payment.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await StripeEventEvidence.syncIndexes();
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Payment.deleteMany({});
  await ManualReviewItem.deleteMany({});
  // StripeEventEvidence is append-only at the model layer; bypass via collection.
  await StripeEventEvidence.collection.deleteMany({});
  await GiftVoucher.deleteMany({});
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_sp2_gv', client_secret: 'cs_sp2_gv' }),
      retrieve: async () => ({ id: 'pi_sp2_gv', client_secret: 'cs_sp2_gv', status: 'succeeded' })
    }
  });
});

test('configured STRIPE_API_VERSION equals installed Stripe.API_VERSION', () => {
  assert.equal(STRIPE_API_VERSION, '2026-08-26.dahlia');
  assert.equal(Stripe.API_VERSION, '2026-08-26.dahlia');
  assert.equal(STRIPE_API_VERSION, Stripe.API_VERSION);
  assert.equal(Stripe.PACKAGE_VERSION, '22.6.2');
});

test('every production new Stripe(...) passes pinned apiVersion', () => {
  const offenders = [];
  for (const rel of PRODUCTION_STRIPE_INIT_FILES) {
    const src = fs.readFileSync(path.join(SERVER_ROOT, rel), 'utf8');
    assert.match(
      src,
      /require\(['"].*config\/stripeApiVersion['"]\)/,
      `${rel} must import stripeApiVersion`
    );
    const inits = [...src.matchAll(/new Stripe\(([^)]*)\)/g)];
    assert.ok(inits.length >= 1, `${rel} must construct Stripe`);
    for (const m of inits) {
      if (!/apiVersion:\s*STRIPE_API_VERSION/.test(m[0])) {
        offenders.push(`${rel}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `missing apiVersion: ${offenders.join('; ')}`);

  // No additional production Stripe constructors outside the known set.
  const knownAbs = new Set(
    PRODUCTION_STRIPE_INIT_FILES.map((rel) => path.resolve(SERVER_ROOT, rel))
  );
  const unexpected = [];
  for (const file of walkJsFiles(SERVER_ROOT)) {
    if (knownAbs.has(path.resolve(file))) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (/new Stripe\s*\(/.test(src)) {
      unexpected.push(path.relative(SERVER_ROOT, file));
    }
  }
  assert.deepEqual(unexpected, [], `unexpected Stripe inits: ${unexpected.join(',')}`);
});

test('webhooks.constructEvent verifies signatures with upgraded SDK', () => {
  const secret = 'whsec_sp2_test_secret';
  const payload = JSON.stringify({
    id: 'evt_sp2_sig',
    object: 'event',
    type: 'payment_intent.succeeded',
    api_version: STRIPE_API_VERSION,
    data: { object: { id: 'pi_sp2_sig', object: 'payment_intent' } }
  });
  const header = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret
  });
  const client = new Stripe('sk_test_sp2', { apiVersion: STRIPE_API_VERSION });
  const event = client.webhooks.constructEvent(payload, header, secret);
  assert.equal(event.id, 'evt_sp2_sig');
  assert.equal(event.type, 'payment_intent.succeeded');
});

test('legacy 2023-10-16 PaymentIntent fixture ingests through current path', async () => {
  const event = readFixture('payment_intent.succeeded.api-2023-10-16.json');
  assert.equal(event.api_version, '2023-10-16');

  const first = await processStripeWebhookEvent(event);
  assert.equal(first.ok, true);
  assert.equal(first.deduped, false);

  const payment = await Payment.findOne({ providerReference: 'pi_sp2_legacy_compat_1' }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'paid');
  assert.equal(payment.amount, 360);
  assert.equal(payment.currency, 'eur');

  const evidence = await StripeEventEvidence.findOne({ eventId: event.id }).lean();
  assert.ok(evidence);
  assert.equal(evidence.metadata?.apiVersion, '2023-10-16');

  const second = await processStripeWebhookEvent(event);
  assert.equal(second.ok, true);
  assert.equal(second.deduped, true);
  assert.equal(await Payment.countDocuments({ providerReference: 'pi_sp2_legacy_compat_1' }), 1);
});

test('2026-08-26.dahlia PaymentIntent fixture ingests through same path', async () => {
  const event = readFixture('payment_intent.succeeded.api-2026-08-26.dahlia.json');
  assert.equal(event.api_version, '2026-08-26.dahlia');

  const first = await processStripeWebhookEvent(event);
  assert.equal(first.ok, true);
  assert.equal(first.deduped, false);

  const payment = await Payment.findOne({ providerReference: 'pi_sp2_dahlia_compat_1' }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'paid');
  assert.equal(payment.amount, 360);

  const evidence = await StripeEventEvidence.findOne({ eventId: event.id }).lean();
  assert.ok(evidence);
  assert.equal(evidence.metadata?.apiVersion, '2026-08-26.dahlia');

  const second = await processStripeWebhookEvent(event);
  assert.equal(second.ok, true);
  assert.equal(second.deduped, true);
});

test('gift-voucher payment_intent.succeeded remains isolated from payment_unlinked', async () => {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_sp2_gv_iso', client_secret: 'cs_sp2_gv_iso' }),
      retrieve: async () => ({
        id: 'pi_sp2_gv_iso',
        client_secret: 'cs_sp2_gv_iso',
        status: 'succeeded',
        amount: 15000,
        amount_received: 15000,
        currency: 'eur'
      })
    }
  });

  const created = await createGiftVoucherPaymentIntent({
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'SP2 Buyer',
    buyerEmail: 'sp2-buyer@example.com',
    recipientName: 'SP2 Recipient',
    recipientEmail: 'sp2-recipient@example.com',
    message: 'SP2 gift',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: 'gvr_sp2_iso_1'
  });

  const event = {
    id: 'evt_sp2_gv_iso_1',
    object: 'event',
    api_version: STRIPE_API_VERSION,
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: created.stripePaymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        status: 'succeeded',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: created.giftVoucherId,
          purchaseRequestId: created.purchaseRequestId
        }
      }
    }
  };

  const result = await processStripeWebhookEvent(event);
  assert.equal(result.ok, true);

  const payment = await Payment.findOne({ providerReference: created.stripePaymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'paid');

  const unlinked = await ManualReviewItem.find({ category: 'payment_unlinked' }).lean();
  assert.equal(unlinked.length, 0);
});
