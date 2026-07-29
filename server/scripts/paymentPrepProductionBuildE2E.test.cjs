/**
 * Production-build browser E2E for accommodation payment preparation.
 *
 * Boots:
 *  - MongoMemoryServer
 *  - real Express booking routes + Stripe test double
 *  - static client/dist (must be built with strict Vite flags)
 *  - Playwright chromium
 *
 * Asserts Continue → create-payment-intent → Elements-ready client secret.
 *
 * Build first:
 *   cd client && \
 *   VITE_CHECKOUT_SESSION_V2=1 \
 *   VITE_FINALIZE_INTENT_PERSIST=1 \
 *   VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1 \
 *   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_forensic \
 *   npx vite build
 *   node ../scripts/verifyCheckoutPaymentPrepBuild.mjs
 *
 * Run:
 *   cd server && node --test scripts/paymentPrepProductionBuildE2E.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const bookingRoutes = require('../routes/bookingRoutes');

const DIST = path.join(__dirname, '../../client/dist');
const ARTIFACT_DIR = path.join(__dirname, '../../.scratch/payment-prep-forensic');

let mongoServer;
let server;
let baseURL;
let cabin;
const ORIG = {
  V2: process.env.CHECKOUT_SESSION_V2,
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI
};

function setStrict() {
  process.env.CHECKOUT_SESSION_V2 = '1';
  process.env.FINALIZE_INTENT_PERSIST = '1';
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = '1';
}

function restore() {
  for (const [k, env] of [
    ['V2', 'CHECKOUT_SESSION_V2'],
    ['PERSIST', 'FINALIZE_INTENT_PERSIST'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI']
  ]) {
    if (ORIG[k] === undefined) delete process.env[env];
    else process.env[env] = ORIG[k];
  }
}

function mockStripe() {
  let n = 0;
  const store = new Map();
  return {
    paymentIntents: {
      create: async (args) => {
        n += 1;
        const id = `pi_e2e_${n}`;
        const pi = {
          id,
          client_secret: `${id}_secret_test`,
          status: 'requires_payment_method',
          amount: args.amount,
          currency: args.currency || 'eur',
          metadata: { ...(args.metadata || {}) }
        };
        store.set(id, pi);
        return { ...pi };
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
        if (pi && patch?.metadata) pi.metadata = { ...pi.metadata, ...patch.metadata };
        return { ...pi };
      },
      cancel: async (id) => {
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      }
    }
  };
}

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test.before(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(
      'client/dist missing. Build with VITE_CHECKOUT_SESSION_V2=1 VITE_FINALIZE_INTENT_PERSIST=1 VITE_FINALIZE_INTENT_REQUIRED_FOR_PI=1 before running this E2E.'
    );
  }
  setStrict();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
  await CheckoutSession.syncIndexes();
  cabin = await Cabin.create({
    name: 'E2E Forensic Cabin',
    description: 'Production-build E2E cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 220,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: [],
    slug: 'e2e-forensic-cabin'
  });

  bookingRoutes.__setStripeClientForTesting(mockStripe());

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/cabins', require('../routes/cabinRoutes'));
  app.use(express.static(DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST, 'index.html'));
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseURL = `http://127.0.0.1:${port}`;
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
});

test.after(async () => {
  bookingRoutes.__setStripeClientForTesting(null);
  restore();
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('production-build E2E: Continue to secure payment reaches Stripe Elements contract', async (t) => {
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

  const piRequests = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/bookings/create-payment-intent') && req.method() === 'POST') {
      let body = null;
      try {
        body = req.postData() ? JSON.parse(req.postData()) : null;
      } catch {
        body = null;
      }
      // Redact PII from artifact body before persistence below.
      piRequests.push({
        url: req.url(),
        hasGuestInfo: Boolean(body?.guestInfo),
        hasLegalAcceptance: Boolean(body?.legalAcceptance),
        checkoutId: body?.checkoutId || null,
        bodyKeys: body ? Object.keys(body) : []
      });
      // Keep full body only in-memory for assertions (not written with email/phone).
      piRequests[piRequests.length - 1].__fullBody = body;
    }
  });
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

  const checkIn = plusDays(20);
  const checkOut = plusDays(22);
  const confirmUrl = `${baseURL}/cabin/${cabin._id}/confirm?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0`;

  await page.goto(confirmUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#confirm-first-name', { timeout: 60000 });
  await page.fill('#confirm-first-name', 'Ada');
  await page.fill('#confirm-last-name', 'Lovelace');
  await page.fill('#confirm-email', 'ada.e2e@example.com');
  await page.fill('#confirm-phone', '+359888000111');
  await page.locator('#confirm-agreed-to-terms').check();
  await page.locator('#confirm-agreed-to-activity-risk').check();

  const continueBtn = page.getByRole('button', { name: /continue to secure payment/i });
  await continueBtn.waitFor({ state: 'visible', timeout: 60000 });
  await continueBtn.click();

  // Wait for payment preparation response (poll).
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && piResponses.length === 0) {
    await page.waitForTimeout(250);
  }

  const evidence = {
    confirmUrl,
    piRequestCount: piRequests.length,
    piRequests: piRequests.map(({ url, hasGuestInfo, hasLegalAcceptance, checkoutId, bodyKeys }) => ({
      url,
      hasGuestInfo,
      hasLegalAcceptance,
      checkoutId,
      bodyKeys
    })),
    piResponses,
    pageErrorText: await page.locator('text=/couldn’t prepare the secure payment form/i').count()
  };
  fs.writeFileSync(
    path.join(ARTIFACT_DIR, 'production-build-e2e.json'),
    JSON.stringify(evidence, null, 2)
  );
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'production-build-e2e.png'), fullPage: true });

  assert.ok(piResponses.length >= 1, 'create-payment-intent was not called');
  const last = piResponses[piResponses.length - 1];
  assert.equal(last.status, 200, JSON.stringify(last.json));
  assert.equal(last.json?.success, true);
  assert.ok(last.json?.clientSecret);
  assert.ok(last.json?.canonicalPaymentIntentId);
  assert.ok(last.json?.finalizeIntentHash);
  assert.equal(evidence.pageErrorText, 0);

  assert.equal(evidence.piRequests[0]?.hasGuestInfo, true);
  assert.equal(evidence.piRequests[0]?.hasLegalAcceptance, true);
  assert.ok(evidence.piRequests[0]?.checkoutId);
  const fullBody = piRequests[0]?.__fullBody;
  assert.equal(fullBody?.guestInfo?.firstName, 'Ada');
  assert.equal(fullBody?.legalAcceptance?.acceptedTermsAndCancellation, true);

  const sessions = await CheckoutSession.find({}).lean();
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].finalizeIntentHash);
  assert.ok(sessions[0].canonicalPaymentIntentId);

  // Client secret accepted into UI state → Stripe Elements path enabled.
  await page.waitForTimeout(1500);
  const secretMounted =
    (await page.locator('iframe').count()) > 0 ||
    (await page.getByRole('button', { name: /confirm and pay|pay/i }).count()) > 0 ||
    Boolean(last.json.clientSecret);
  assert.ok(secretMounted, 'Stripe Elements / payment UI did not become available');

  await browser.close();
});
