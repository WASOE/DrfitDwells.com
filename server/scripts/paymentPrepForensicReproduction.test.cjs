/**
 * Forensic reproduction: production-equivalent create-payment-intent through the
 * real Express route stack + MongoMemoryServer + Stripe test double.
 *
 * Models two client builds against a strict V2 server:
 *   A) Deployed Vite flag list WITHOUT VITE_CHECKOUT_SESSION_V2 (post-95f5f33 risk)
 *   B) Full aligned strict flags with guest+legal payload
 *
 * Run: cd server && node --test scripts/paymentPrepForensicReproduction.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const path = require('path');

const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

let mongoServer;
let app;
let cabin;
const ORIG = {
  V2: process.env.CHECKOUT_SESSION_V2,
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI
};

function setStrictServerFlags() {
  process.env.CHECKOUT_SESSION_V2 = '1';
  process.env.FINALIZE_INTENT_PERSIST = '1';
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = '1';
}

function restoreFlags() {
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
        const id = `pi_forensic_${n}`;
        const pi = {
          id,
          client_secret: `${id}_secret`,
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
        if (patch?.metadata) pi.metadata = { ...pi.metadata, ...patch.metadata };
        return { ...pi };
      },
      cancel: async (id) => {
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      }
    },
    __created: () => n,
    __store: store
  };
}

function dates() {
  const checkIn = new Date();
  checkIn.setUTCDate(checkIn.getUTCDate() + 21);
  const checkOut = new Date(checkIn);
  checkOut.setUTCDate(checkOut.getUTCDate() + 2);
  return {
    checkIn: checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10)
  };
}

/** Payload shaped like ConfirmBooking after 95f5f33 when VITE_CHECKOUT_SESSION_V2 is unset. */
function payloadMissingFinalizeBecauseV2ClientOff(cabinId) {
  const { checkIn, checkOut } = dates();
  return {
    cabinId: String(cabinId),
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    experienceKeys: [],
    checkoutId: 'chk_forensic_v2_off_client_01',
    guestEmail: 'qa.forensic@example.com',
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    marketingConsent: false
    // NO guestInfo / legalAcceptance — gated on checkoutSessionV2Enabled in ConfirmBooking
  };
}

/** Payload shaped like ConfirmBooking with V2 + guest + legal ready. */
function payloadFullFinalize(cabinId, checkoutId = 'chk_forensic_full_01') {
  const { checkIn, checkOut } = dates();
  return {
    cabinId: String(cabinId),
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    experienceKeys: [],
    checkoutId,
    guestEmail: 'qa.forensic@example.com',
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    marketingConsent: false,
    expectedSessionVersion: 1,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'qa.forensic@example.com',
      phone: '+359888000111'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    specialRequests: ''
  };
}

test.before(async () => {
  setStrictServerFlags();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  cabin = await Cabin.create({
    name: 'Forensic Cabin',
    description: 'Forensic reproduction cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const stripe = mockStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
});

test.after(async () => {
  bookingRoutes.__setStripeClientForTesting(null);
  restoreFlags();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setStrictServerFlags();
  await CheckoutSession.deleteMany({});
});

test('FORENSIC A: deployed Vite flag skew (no VITE_CHECKOUT_SESSION_V2) → 409 FINALIZE_INTENT_REQUIRED', async () => {
  const body = payloadMissingFinalizeBecauseV2ClientOff(cabin._id);
  const res = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.66.0.1')
    .set('Content-Type', 'application/json')
    .send(body);

  // Capture exact production-visible failure contract.
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(res.body.code, 'FINALIZE_INTENT_REQUIRED');
  assert.match(String(res.body.message || ''), /secure payment form/i);

  const sessions = await CheckoutSession.find({}).lean();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].finalizeIntentHash, null);
  assert.equal(sessions[0].canonicalPaymentIntentId, null);
  assert.equal(sessions[0].status, 'payment_required');

  // Write evidence artifact for the audit doc.
  const outDir = path.join(__dirname, '../../.scratch/payment-prep-forensic');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'forensic-a-v2-client-off.json'),
    JSON.stringify(
      {
        assumption:
          'Client built with VITE_FINALIZE_INTENT_*=1 but VITE_CHECKOUT_SESSION_V2 unset → ConfirmBooking does not attach guestInfo/legalAcceptance',
        requestBodyKeys: Object.keys(body),
        responseStatus: res.status,
        responseBody: res.body,
        session: {
          checkoutId: sessions[0].checkoutId,
          status: sessions[0].status,
          sessionVersion: sessions[0].sessionVersion,
          finalizeIntentHash: sessions[0].finalizeIntentHash,
          canonicalPaymentIntentId: sessions[0].canonicalPaymentIntentId
        },
        failingSource:
          'server/services/checkout/finalizeIntentService.js ensureFinalizeIntentForPaymentPreparation (!hasPayload && required) → FINALIZE_INTENT_REQUIRED'
      },
      null,
      2
    )
  );
});

test('FORENSIC B: aligned V2 client payload succeeds through real route', async () => {
  const body = payloadFullFinalize(cabin._id, 'chk_forensic_full_ok_01');
  const res = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.66.0.2')
    .set('Content-Type', 'application/json')
    .send(body);

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.flowVersion, 'v2');
  assert.ok(res.body.checkoutId);
  assert.ok(res.body.clientSecret);
  assert.ok(res.body.canonicalPaymentIntentId);
  assert.ok(res.body.finalizeIntentHash);

  const session = await CheckoutSession.findOne({ checkoutId: res.body.checkoutId }).lean();
  assert.ok(session.finalizeIntent);
  assert.equal(session.finalizeIntentHash, res.body.finalizeIntentHash);
  assert.equal(session.canonicalPaymentIntentId, res.body.canonicalPaymentIntentId);
});

test('FORENSIC C: ConfirmBooking attaches finalize whenever guest+legal ready (not V2-only)', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../client/src/pages/ConfirmBooking.jsx'),
    'utf8'
  );
  assert.match(src, /if \(guestOk && legalOk\)/);
  assert.doesNotMatch(
    src,
    /if \(checkoutSessionV2Enabled && guestOk && legalOk\)/
  );
});
