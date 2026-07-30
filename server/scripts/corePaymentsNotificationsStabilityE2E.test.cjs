/**
 * Production-equivalent local E2E: accommodation payment + finalize,
 * gift vouchers, ops MRI notify, SW /api NetworkOnly, capability handshake.
 *
 * Requires client/dist (production Vite build). No production access.
 *
 * Build (if needed):
 *   cd client && \
 *   VITE_CHECKOUT_SESSION_V2=1 \
 *   VITE_FINALIZE_INTENT_PERSIST=1 \
 *   VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1 \
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_stability \
 *   npx vite build
 *
 * Run:
 *   cd server && node --test scripts/corePaymentsNotificationsStabilityE2E.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const ManualReviewItem = require('../models/ManualReviewItem');
const bookingRoutes = require('../routes/bookingRoutes');
const giftVoucherRoutes = require('../routes/giftVoucherRoutes');
const {
  setStripeClientForTesting,
  activatePaidVoucherFromStripeEvent
} = require('../services/giftVouchers/giftVoucherPaymentService');
const { openManualReviewItem } = require('../services/ops/ingestion/manualReviewService');
const {
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting
} = require('../services/ops/push/opsPushEventNotifications');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

const DIST = path.join(__dirname, '../../client/dist');
const ARTIFACT_DIR = path.join(__dirname, '../../.scratch/core-stability-e2e');
const SW_SRC = path.join(__dirname, '../../client/src/sw.js');
const SW_DIST = path.join(DIST, 'sw.js');

let mongoServer;
let server;
let baseURL;
let cabin;
let stripe;
let emailLogs = [];
let pushCalls = [];
let origConsoleLog;

const ORIG = {
  V2: process.env.CHECKOUT_SESSION_V2,
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_URL: process.env.SMTP_URL,
  EMAIL_DELIVERY_REQUIRED: process.env.EMAIL_DELIVERY_REQUIRED,
  ADMIN_JWT_SECRET: process.env.ADMIN_JWT_SECRET
};

function setStrictEnv() {
  process.env.CHECKOUT_SESSION_V2 = '1';
  process.env.FINALIZE_INTENT_PERSIST = '1';
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = '1';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_URL;
  delete process.env.EMAIL_DELIVERY_REQUIRED;
  if (!process.env.ADMIN_JWT_SECRET) {
    process.env.ADMIN_JWT_SECRET = 'core-stability-e2e-secret';
  }
}

function restoreEnv() {
  for (const [key, env] of [
    ['V2', 'CHECKOUT_SESSION_V2'],
    ['PERSIST', 'FINALIZE_INTENT_PERSIST'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI'],
    ['SMTP_HOST', 'SMTP_HOST'],
    ['SMTP_URL', 'SMTP_URL'],
    ['EMAIL_DELIVERY_REQUIRED', 'EMAIL_DELIVERY_REQUIRED'],
    ['ADMIN_JWT_SECRET', 'ADMIN_JWT_SECRET']
  ]) {
    if (ORIG[key] === undefined) delete process.env[env];
    else process.env[env] = ORIG[key];
  }
}

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function makeStripe() {
  const store = new Map();
  let n = 0;
  return {
    paymentIntents: {
      create: async (args) => {
        n += 1;
        const id = `pi_core_stab_${n}`;
        const pi = {
          id,
          client_secret: `${id}_secret_test`,
          status: 'requires_payment_method',
          amount: args.amount,
          currency: args.currency || 'eur',
          metadata: { ...(args.metadata || {}) }
        };
        store.set(id, { ...pi });
        return { ...pi, metadata: { ...pi.metadata } };
      },
      retrieve: async (id) => {
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error('missing');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi, metadata: { ...pi.metadata } };
      },
      update: async (id, patch) => {
        const pi = store.get(String(id));
        if (!pi) return null;
        if (patch?.metadata) pi.metadata = { ...pi.metadata, ...patch.metadata };
        if (patch?.amount != null) pi.amount = patch.amount;
        return { ...pi, metadata: { ...pi.metadata } };
      },
      cancel: async (id) => {
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      },
      __succeed(id) {
        const pi = store.get(String(id));
        if (pi) pi.status = 'succeeded';
        return pi;
      },
      __store: store
    }
  };
}

function legalAcceptance() {
  return {
    acceptedTermsAndCancellation: true,
    acceptedActivityRisk: true,
    termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
    activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
    checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
    checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
    locale: 'en'
  };
}

function guestInfo(overrides = {}) {
  return {
    firstName: 'Core',
    lastName: 'Stability',
    email: 'core.stability@example.com',
    phone: '+359888000999',
    ...overrides
  };
}

/** Mirrors client/src/utils/checkoutCapabilityHandshake.js (CJS-safe). */
function evaluateCheckoutCapabilityCompatibility(serverCaps, clientCaps) {
  if (!serverCaps || typeof serverCaps !== 'object') {
    return { ok: true, reason: 'capabilities_unavailable', shouldReload: false };
  }
  if (serverCaps.requiresFinalizeIntentPayload || serverCaps.finalizeIntentRequiredForPi) {
    if (
      !clientCaps.checkoutSessionV2 &&
      !clientCaps.finalizeIntentRequiredForPi &&
      !clientCaps.finalizeIntentPersist
    ) {
      return {
        ok: false,
        reason: 'stale_client_missing_finalize_support',
        shouldReload: false
      };
    }
  }
  if (serverCaps.checkoutSessionV2 && !clientCaps.checkoutSessionV2) {
    return {
      ok: false,
      reason: 'stale_client_missing_v2',
      shouldReload: false
    };
  }
  return { ok: true, reason: null, shouldReload: false };
}

async function ensurePaymentEvidence(paymentIntentId, amountCents) {
  return Payment.findOneAndUpdate(
    { provider: 'stripe', providerReference: String(paymentIntentId) },
    {
      $setOnInsert: {
        provider: 'stripe',
        providerReference: String(paymentIntentId),
        status: 'paid',
        amount: Number(amountCents) / 100,
        currency: 'eur',
        source: 'webhook',
        sourceReference: `evt_core_stab_${paymentIntentId}`,
        reservationId: null,
        metadata: { paymentIntentId: String(paymentIntentId) }
      }
    },
    { upsert: true, new: true }
  );
}

function writeArtifact(name, data) {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const file = path.join(ARTIFACT_DIR, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return file;
}

function randomCodeSegment() {
  return Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
}

async function createActiveVoucher(overrides = {}) {
  return GiftVoucher.create({
    code: `DD-${randomCodeSegment()}-${randomCodeSegment()}-${randomCodeSegment()}`,
    amountOriginalCents: 50000,
    balanceRemainingCents: 50000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: plusDays(60),
    ...overrides
  });
}

test.before(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(
      'client/dist missing. Build with VITE_CHECKOUT_SESSION_V2=1 VITE_FINALIZE_INTENT_PERSIST=1 VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1 before running this E2E.'
    );
  }

  setStrictEnv();
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  emailLogs = [];
  origConsoleLog = console.log;
  console.log = (...args) => {
    const joined = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (joined.includes('EMAIL LOG')) {
      emailLogs.push(joined);
    }
    return origConsoleLog(...args);
  };

  pushCalls = [];
  __setSendOpsPushSafelyForTesting(async (params) => {
    pushCalls.push(params);
    return { skipped: false, usersTargeted: 1 };
  });

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
  await Promise.all([
    Cabin.syncIndexes(),
    Booking.syncIndexes(),
    Payment.syncIndexes(),
    CheckoutSession.syncIndexes(),
    GiftVoucher.syncIndexes(),
    GiftVoucherEvent.syncIndexes(),
    GiftVoucherRedemption.syncIndexes(),
    ManualReviewItem.syncIndexes()
  ]);

  cabin = await Cabin.create({
    name: 'Core Stability Cabin',
    description: 'Production-equivalent E2E cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 220,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: [],
    slug: 'core-stability-cabin'
  });

  stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  setStripeClientForTesting(stripe);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/cabins', require('../routes/cabinRoutes'));
  app.use('/api/gift-vouchers', giftVoucherRoutes);
  // Ops notification routes (auth-gated); MRI notify path is asserted via openManualReviewItem.
  try {
    app.use('/api/admin', require('../routes/adminRoutes'));
    app.use('/api/ops', require('../routes/ops/index'));
  } catch (err) {
    origConsoleLog('[core-stability-e2e] ops routes not mounted:', err.message);
  }
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (origConsoleLog) console.log = origConsoleLog;
  bookingRoutes.__setStripeClientForTesting(null);
  setStripeClientForTesting(null);
  __resetSendOpsPushSafelyForTesting();
  restoreEnv();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setStrictEnv();
  emailLogs.length = 0;
  pushCalls.length = 0;
  await Promise.all([
    Booking.deleteMany({}),
    Payment.deleteMany({}),
    CheckoutSession.deleteMany({}),
    GiftVoucher.deleteMany({}),
    mongoose.connection.db.collection('giftvoucherevents').deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
  bookingRoutes.__setStripeClientForTesting(stripe);
  setStripeClientForTesting(stripe);
});

test('accommodation browser Continue → create-PI → server finalize: booking, payment link, email, no MRI', async (t) => {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    t.skip('playwright not installed in this environment');
    return;
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const piResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/bookings/create-payment-intent') && res.request().method() === 'POST') {
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      piResponses.push({ status: res.status(), json });
    }
  });

  const checkIn = dateOnly(plusDays(25));
  const checkOut = dateOnly(plusDays(27));
  const guest = guestInfo({ email: 'ada.core.e2e@example.com', firstName: 'Ada', lastName: 'Lovelace' });
  const confirmUrl = `${baseURL}/cabin/${cabin._id}/confirm?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0`;

  await page.goto(confirmUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#confirm-first-name', { timeout: 60000 });
  await page.fill('#confirm-first-name', guest.firstName);
  await page.fill('#confirm-last-name', guest.lastName);
  await page.fill('#confirm-email', guest.email);
  await page.fill('#confirm-phone', guest.phone);
  await page.locator('#confirm-agreed-to-terms').check();
  await page.locator('#confirm-agreed-to-activity-risk').check();

  const continueBtn = page.getByRole('button', { name: /continue to secure payment/i });
  await continueBtn.waitFor({ state: 'visible', timeout: 60000 });
  await continueBtn.click();

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && piResponses.length === 0) {
    await page.waitForTimeout(250);
  }

  assert.ok(piResponses.length >= 1, 'create-payment-intent was not called from browser');
  const last = piResponses[piResponses.length - 1];
  assert.equal(last.status, 200, JSON.stringify(last.json));
  assert.equal(last.json?.success, true);
  assert.ok(last.json?.clientSecret);
  assert.ok(last.json?.canonicalPaymentIntentId || last.json?.paymentIntentId);
  assert.ok(last.json?.finalizeIntentHash);

  const paymentIntentId = String(
    last.json.canonicalPaymentIntentId || last.json.paymentIntentId
  );
  const checkoutId = String(last.json.checkoutId || '');
  assert.ok(checkoutId, 'checkoutId missing from create-payment-intent response');

  stripe.paymentIntents.__succeed(paymentIntentId);
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  await ensurePaymentEvidence(paymentIntentId, pi.amount);

  const bookRes = await request(baseURL)
    .post('/api/bookings')
    .set('X-Forwarded-For', '10.66.1.10')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      paymentIntentId,
      checkoutId,
      guestInfo: guest,
      legalAcceptance: legalAcceptance()
    });

  const mriCount = await ManualReviewItem.countDocuments({
    category: 'payment_finalization_failure'
  });
  const bookings = await Booking.find({ checkoutId }).lean();
  const payments = await Payment.find({ providerReference: paymentIntentId }).lean();

  const evidence = {
    confirmUrl,
    piStatus: last.status,
    paymentIntentId,
    checkoutId,
    bookStatus: bookRes.status,
    bookBody: bookRes.body,
    bookingCount: bookings.length,
    paymentCount: payments.length,
    paymentReservationId: payments[0]?.reservationId ? String(payments[0].reservationId) : null,
    confirmationEmailSentAt: bookings[0]?.confirmationEmailSentAt || null,
    emailLogCount: emailLogs.length,
    mriCount,
    pushCallCount: pushCalls.length
  };
  writeArtifact('accommodation-browser-finalize.json', evidence);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'accommodation-browser-finalize.png'),
    fullPage: true
  });

  assert.ok(
    bookRes.status === 201 || bookRes.status === 200,
    JSON.stringify({ bookStatus: bookRes.status, bookBody: bookRes.body, evidence })
  );
  assert.equal(bookings.length, 1, 'expected exactly one Booking');
  assert.equal(payments.length, 1, 'expected exactly one Payment for PI');
  assert.ok(payments[0].reservationId, 'Payment not linked to Booking');
  assert.equal(String(payments[0].reservationId), String(bookings[0]._id));
  assert.ok(
    bookings[0].confirmationEmailSentAt || emailLogs.some((l) => l.includes(guest.email)),
    'confirmation email not logged / claimed'
  );
  assert.equal(mriCount, 0, 'unexpected payment_finalization_failure MRI');

  await browser.close();
});

test('gift voucher purchase happy path: create-PI → activate → active voucher', async () => {
  let createPayload = null;
  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => {
        createPayload = payload;
        const id = 'pi_gv_core_purchase_1';
        stripe.paymentIntents.__store.set(id, {
          id,
          client_secret: `${id}_secret`,
          status: 'requires_payment_method',
          amount: payload.amount,
          currency: payload.currency || 'eur',
          metadata: { ...(payload.metadata || {}) }
        });
        return { id, client_secret: `${id}_secret` };
      },
      retrieve: async (id) => stripe.paymentIntents.retrieve(id)
    }
  });

  const purchaseRequestId = `gvr_core_stab_${Date.now()}`;
  const createRes = await request(baseURL)
    .post('/api/gift-vouchers/create-payment-intent')
    .set('X-Forwarded-For', '10.66.2.1')
    .send({
      amountOriginalCents: 5000,
      currency: 'EUR',
      buyerName: 'GV Buyer',
      buyerEmail: 'gv.buyer@example.com',
      recipientName: 'GV Recipient',
      recipientEmail: 'gv.recipient@example.com',
      deliveryMode: 'email',
      purchaseRequestId,
      termsAccepted: true,
      termsVersion: 'v1'
    });

  assert.equal(createRes.status, 200, JSON.stringify(createRes.body));
  assert.ok(createRes.body?.data?.clientSecret);
  assert.ok(createRes.body?.data?.giftVoucherId);
  assert.equal(createPayload?.amount, 5000);

  const giftVoucherId = createRes.body.data.giftVoucherId;
  const piId = createRes.body.data.stripePaymentIntentId || createRes.body.data.paymentIntentId;
  const event = {
    id: 'evt_gv_core_activate_1',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: piId,
        amount: 5000,
        amount_received: 5000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(giftVoucherId),
          purchaseRequestId
        }
      }
    }
  };

  const activated = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(activated.ok, true);
  const voucher = await GiftVoucher.findById(giftVoucherId).lean();
  assert.equal(voucher.status, 'active');
  assert.ok(voucher.code);
  writeArtifact('gift-voucher-purchase.json', {
    giftVoucherId,
    piId,
    status: voucher.status,
    code: voucher.code
  });
});

test('partial voucher redemption: residual Stripe PI amount only', async () => {
  const voucher = await createActiveVoucher({ balanceRemainingCents: 25000 });
  const checkIn = dateOnly(plusDays(30));
  const checkOut = dateOnly(plusDays(32));
  const checkoutId = 'chk_core_partial_vouch_1';

  const response = await request(baseURL)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.66.3.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      checkoutId,
      voucherCode: voucher.code,
      guestInfo: guestInfo({ email: 'partial.vouch@example.com' }),
      legalAcceptance: legalAcceptance()
    });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(response.body.fullVoucherCoverage, false);
  assert.equal(response.body.voucherAppliedCents || response.body.giftVoucherAppliedCents, 25000);
  assert.ok(Number(response.body.stripeAmountCents) > 0);
  assert.ok(response.body.canonicalPaymentIntentId || response.body.paymentIntentId);
  writeArtifact('partial-voucher-redemption.json', {
    checkoutId,
    body: {
      fullVoucherCoverage: response.body.fullVoucherCoverage,
      voucherAppliedCents: response.body.voucherAppliedCents || response.body.giftVoucherAppliedCents,
      stripeAmountCents: response.body.stripeAmountCents
    }
  });
});

test('full voucher coverage: voucher reserved and covers stay', async () => {
  const voucher = await createActiveVoucher({
    amountOriginalCents: 100000,
    balanceRemainingCents: 100000
  });
  const checkIn = dateOnly(plusDays(35));
  const checkOut = dateOnly(plusDays(37));
  const checkoutId = 'chk_core_full_vouch_1';
  const createCallsBefore = stripe.paymentIntents.__store.size;

  const response = await request(baseURL)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.66.3.2')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      checkoutId,
      voucherCode: voucher.code,
      guestInfo: guestInfo({ email: 'full.vouch@example.com' }),
      legalAcceptance: legalAcceptance()
    });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.success, true);
  assert.equal(response.body.fullVoucherCoverage, true);
  assert.ok(response.body.voucherRedemptionId, 'expected voucher redemption reservation');
  assert.ok(
    Number(response.body.giftVoucherAppliedCents || response.body.voucherAppliedCents || 0) > 0,
    'expected gift voucher applied cents'
  );
  assert.equal(Number(response.body.stripeAmountCents || 0), 0);
  assert.equal(response.body.noPaymentRequired, true);
  assert.equal(
    stripe.paymentIntents.__store.size,
    createCallsBefore,
    'full voucher coverage must not create a Stripe PaymentIntent'
  );

  const redemption = await GiftVoucherRedemption.findById(response.body.voucherRedemptionId).lean();
  assert.ok(redemption);
  assert.equal(redemption.status, 'reserved');

  writeArtifact('full-voucher-coverage.json', {
    checkoutId,
    fullVoucherCoverage: response.body.fullVoucherCoverage,
    giftVoucherAppliedCents: response.body.giftVoucherAppliedCents,
    stripeAmountCents: response.body.stripeAmountCents,
    noPaymentRequired: response.body.noPaymentRequired,
    voucherRedemptionId: response.body.voucherRedemptionId,
    piCreated: false
  });
});

test('notification: payment_finalization_failure MRI opens notify path via ops push hook', async () => {
  pushCalls.length = 0;
  const item = await openManualReviewItem({
    category: 'payment_finalization_failure',
    severity: 'high',
    entityType: 'checkout_session',
    entityId: 'chk_core_mri_notify_1',
    title: 'Core stability MRI notify probe',
    details: 'Deterministic MRI for ops push notify path',
    provenance: {
      source: 'core_stability_e2e',
      sourceReference: 'chk_core_mri_notify_1'
    },
    evidence: {
      failedInvariant: 'core_stability_probe',
      correlationId: 'chk_core_mri_notify_1'
    }
  });

  assert.ok(item?._id);
  // openManualReviewItem awaits notifyOpsPushManualReviewOpened for this category
  assert.ok(pushCalls.length >= 1, 'expected sendOpsPushSafely via __setSendOpsPushSafelyForTesting');
  const call = pushCalls.find((c) => c?.source === 'manual_review_opened') || pushCalls[0];
  assert.equal(call.role, 'admin');
  assert.match(String(call.dedupeKey || ''), /manual_review:/);
  assert.match(String(call.body || ''), /payment_finalization_failure|core_stability_probe/);

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.category, 'payment_finalization_failure');
  assert.equal(stored.status, 'open');
  writeArtifact('mri-notify-path.json', {
    manualReviewItemId: String(item._id),
    pushCalls
  });
});

test('service worker registers NetworkOnly for /api/', () => {
  const swPath = fs.existsSync(SW_SRC) ? SW_SRC : SW_DIST;
  assert.ok(fs.existsSync(swPath), `sw.js missing at ${SW_SRC} and ${SW_DIST}`);
  const source = fs.readFileSync(swPath, 'utf8');
  assert.match(source, /NetworkOnly/);
  assert.match(source, /pathname\.startsWith\(['"`]\/api\//);
  assert.match(source, /create-payment-intent|checkout-session/);
  writeArtifact('sw-network-only.json', {
    swPath: path.relative(path.join(__dirname, '../..'), swPath),
    hasNetworkOnly: true,
    hasApiPrefix: true
  });
});

test('capability handshake: matching client ok; stale client mismatches without shouldReload', async () => {
  const capsRes = await request(baseURL).get('/api/bookings/checkout-capabilities');
  assert.equal(capsRes.status, 200);
  const serverCaps = capsRes.body;
  assert.equal(serverCaps.checkoutSessionV2, true);
  assert.equal(serverCaps.finalizeIntentRequiredForPi, true);
  assert.equal(serverCaps.requiresFinalizeIntentPayload, true);

  const matched = evaluateCheckoutCapabilityCompatibility(serverCaps, {
    checkoutSessionV2: true,
    finalizeIntentPersist: true,
    finalizeIntentRequiredForPi: true
  });
  assert.equal(matched.ok, true);
  assert.equal(matched.shouldReload, false);

  const staleMissingV2 = evaluateCheckoutCapabilityCompatibility(serverCaps, {
    checkoutSessionV2: false,
    finalizeIntentPersist: true,
    finalizeIntentRequiredForPi: true
  });
  assert.equal(staleMissingV2.ok, false);
  assert.equal(staleMissingV2.reason, 'stale_client_missing_v2');
  assert.equal(staleMissingV2.shouldReload, false);

  const staleLegacy = evaluateCheckoutCapabilityCompatibility(serverCaps, {
    checkoutSessionV2: false,
    finalizeIntentPersist: false,
    finalizeIntentRequiredForPi: false
  });
  assert.equal(staleLegacy.ok, false);
  assert.equal(staleLegacy.reason, 'stale_client_missing_finalize_support');
  assert.equal(staleLegacy.shouldReload, false);

  writeArtifact('capability-handshake.json', {
    serverCaps,
    matched,
    staleMissingV2,
    staleLegacy
  });
});
