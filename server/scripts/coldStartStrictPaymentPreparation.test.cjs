/**
 * Cold-start strict V2 payment preparation — reproduces and guards the production
 * orphan-session failure (three sessions, finalizeIntentHash null, no PI).
 *
 * Run: cd server && node --test scripts/coldStartStrictPaymentPreparation.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const path = require('path');

const CheckoutSession = require('../models/CheckoutSession');
const Booking = require('../models/Booking');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  ensureCanonicalPaymentIntent
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const {
  sessionHasCompleteFinalizeIntent,
  hashFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const { loadSessionOrThrow } = require('../services/checkout/checkoutSessionService');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');

let mongoServer;
let createdPiIds = [];
let chargeCalls = [];
let refundCalls = [];

const ORIG = {
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI,
  V2: process.env.CHECKOUT_SESSION_V2
};

function setStrictFlags() {
  process.env.FINALIZE_INTENT_PERSIST = '1';
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = '1';
  process.env.CHECKOUT_SESSION_V2 = '1';
}

function restoreFlags() {
  for (const [key, envKey] of [
    ['PERSIST', 'FINALIZE_INTENT_PERSIST'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI'],
    ['V2', 'CHECKOUT_SESSION_V2']
  ]) {
    if (ORIG[key] === undefined) delete process.env[envKey];
    else process.env[envKey] = ORIG[key];
  }
}

function makeStripe() {
  const store = new Map();
  return {
    paymentIntents: {
      create: async (args) => {
        const id = `pi_cold_${createdPiIds.length + 1}_${Date.now()}`;
        createdPiIds.push(id);
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
          const err = new Error(`No such payment_intent: ${id}`);
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi, metadata: { ...pi.metadata } };
      },
      update: async (id, patch) => {
        const pi = store.get(String(id));
        if (!pi) throw new Error(`No such payment_intent: ${id}`);
        if (patch?.metadata) pi.metadata = { ...pi.metadata, ...patch.metadata };
        return { ...pi };
      },
      cancel: async (id) => {
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      }
    },
    charges: {
      create: async (...args) => {
        chargeCalls.push(args);
        throw new Error('charges.create must not run during preparation');
      }
    },
    refunds: {
      create: async (...args) => {
        refundCalls.push(args);
        throw new Error('refunds.create must not run during preparation');
      }
    },
    __store: store
  };
}

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function guestLegal(overrides = {}) {
  return {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
      phone: '+359888000111',
      ...(overrides.guestInfo || {})
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en',
      ...(overrides.legalAcceptance || {})
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    experienceKeys: [],
    ...overrides
  };
}

function buildCabinTypeCase() {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const checkIn = plusDays(14);
  const checkOut = plusDays(16);
  const input = {
    cabinTypeId: String(cabinTypeId),
    checkIn: checkIn.toISOString().slice(0, 10),
    checkOut: checkOut.toISOString().slice(0, 10),
    adults: 2,
    children: 0,
    experienceKeys: [],
    // Production client default before any server round-trip:
    expectedSessionVersion: 1,
    ...guestLegal()
  };
  const quote = {
    entityType: 'cabinType',
    entity: {
      _id: cabinTypeId,
      cabinTypeId: String(cabinTypeId),
      minNights: 1,
      capacity: 8,
      pricingModel: 'per_night'
    },
    checkInDate: checkIn,
    checkOutDate: checkOut,
    subtotalPrice: 480,
    discountAmount: 0,
    totalPrice: 480,
    appliedPromoCode: '',
    voucherAppliedCents: 0,
    remainingDueCents: 48000,
    fullVoucherCoverage: false
  };
  return { cabinTypeId, input, quote };
}

test.before(async () => {
  setStrictFlags();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await Booking.syncIndexes();
});

test.after(async () => {
  restoreFlags();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setStrictFlags();
  createdPiIds = [];
  chargeCalls = [];
  refundCalls = [];
  await CheckoutSession.deleteMany({});
  await Booking.deleteMany({});
});

test('REGRESSION: missing finalize payload + null checkoutId creates orphan sessions (documented failure mode)', async () => {
  const { input, quote } = buildCabinTypeCase();
  delete input.guestInfo;
  delete input.legalAcceptance;
  delete input.consents;
  const stripe = makeStripe();
  const errors = [];
  for (let i = 0; i < 3; i += 1) {
    try {
      await ensureCanonicalPaymentIntent({
        checkoutId: null,
        input: { ...input },
        quote,
        stripe
      });
    } catch (err) {
      errors.push(err.code);
    }
  }
  assert.deepEqual(errors, [
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED
  ]);
  const sessions = await CheckoutSession.find({}).lean();
  assert.equal(sessions.length, 3);
  assert.ok(sessions.every((s) => s.finalizeIntentHash == null));
  assert.ok(sessions.every((s) => s.canonicalPaymentIntentId == null));
  assert.equal(createdPiIds.length, 0);
});

test('1-5. cold-start strict V2 with stable checkoutId succeeds: one session, intent before PI', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_stable_0001';
  input.checkoutId = checkoutId;
  const stripe = makeStripe();

  const dto = await ensureCanonicalPaymentIntent({
    checkoutId,
    input,
    quote,
    stripe
  });

  assert.equal(dto.checkoutId, checkoutId);
  assert.ok(dto.finalizeIntentHash);
  assert.ok(dto.canonicalPaymentIntentId);
  assert.ok(dto.clientSecret);
  assert.equal(createdPiIds.length, 1);

  const session = await loadSessionOrThrow(checkoutId);
  assert.ok(sessionHasCompleteFinalizeIntent(session));
  assert.equal(hashFinalizeIntent(session.finalizeIntent), session.finalizeIntentHash);
  assert.equal(await CheckoutSession.countDocuments({}), 1);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(chargeCalls.length, 0);
  assert.equal(refundCalls.length, 0);
});

test('6-7. three simulated retries with same checkoutId produce one session and one PI', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_retry_0002';
  input.checkoutId = checkoutId;
  const stripe = makeStripe();

  const results = [];
  for (let i = 0; i < 3; i += 1) {
    const dto = await ensureCanonicalPaymentIntent({
      checkoutId,
      input: { ...input, expectedSessionVersion: undefined },
      quote,
      stripe
    });
    results.push(dto);
  }

  assert.equal(await CheckoutSession.countDocuments({}), 1);
  assert.equal(new Set(results.map((r) => r.canonicalPaymentIntentId)).size, 1);
  assert.equal(results[0].canonicalPaymentIntentId, results[2].canonicalPaymentIntentId);
  assert.ok(createdPiIds.length >= 1);
  const session = await loadSessionOrThrow(checkoutId);
  assert.ok(sessionHasCompleteFinalizeIntent(session));
  assert.ok(!session.supersededPaymentIntentIds.includes(session.canonicalPaymentIntentId));
});

test('8-9. timeout-style re-entry reuses persisted intent and PI', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_timeout_0003';
  input.checkoutId = checkoutId;
  const stripe = makeStripe();

  const first = await ensureCanonicalPaymentIntent({ checkoutId, input, quote, stripe });
  const beforeCreates = createdPiIds.length;
  const second = await ensureCanonicalPaymentIntent({
    checkoutId,
    input: { ...input, expectedSessionVersion: undefined },
    quote,
    stripe
  });
  assert.equal(second.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
  assert.equal(createdPiIds.length, beforeCreates);
  assert.equal(await CheckoutSession.countDocuments({}), 1);
});

test('10. FINALIZE_INTENT_REQUIRED details include generated checkoutId', async () => {
  const { input, quote } = buildCabinTypeCase();
  delete input.guestInfo;
  delete input.legalAcceptance;
  const stripe = makeStripe();
  await assert.rejects(
    () => ensureCanonicalPaymentIntent({ checkoutId: null, input, quote, stripe }),
    (err) => {
      assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED);
      assert.ok(err.details?.checkoutId);
      assert.ok(err.details?.sessionVersion != null);
      return true;
    }
  );
});

test('12. cold-start default client sessionVersion does not cause false concurrency conflict', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_version_0004';
  input.checkoutId = checkoutId;
  input.expectedSessionVersion = 1;
  const stripe = makeStripe();
  const dto = await ensureCanonicalPaymentIntent({ checkoutId, input, quote, stripe });
  assert.ok(dto.finalizeIntentHash);
  assert.ok(dto.canonicalPaymentIntentId);
});

test('13. real resumed-session stale version still produces concurrency conflict', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_stale_0005';
  input.checkoutId = checkoutId;
  const stripe = makeStripe();
  await ensureCanonicalPaymentIntent({ checkoutId, input, quote, stripe });
  const session = await loadSessionOrThrow(checkoutId);
  await assert.rejects(
    () =>
      ensureCanonicalPaymentIntent({
        checkoutId,
        input: {
          ...input,
          expectedSessionVersion: 1
        },
        quote,
        stripe
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT
  );
  assert.ok(Number(session.sessionVersion) >= 1);
});

test('14-15. invalid phone rejects with field validation and creates no PI; valid phone succeeds', async () => {
  const { input, quote } = buildCabinTypeCase();
  const bad = {
    ...input,
    checkoutId: 'chk_cold_phone_bad',
    guestInfo: { ...input.guestInfo, phone: '' }
  };
  const stripe = makeStripe();
  await assert.rejects(
    () => ensureCanonicalPaymentIntent({ checkoutId: bad.checkoutId, input: bad, quote, stripe }),
    (err) => {
      assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID);
      assert.equal(err.details?.field, 'guestInfo.phone');
      return true;
    }
  );
  assert.equal(createdPiIds.length, 0);

  const good = {
    ...input,
    checkoutId: 'chk_cold_phone_ok',
    guestInfo: { ...input.guestInfo, phone: '+359888111222' }
  };
  const dto = await ensureCanonicalPaymentIntent({
    checkoutId: good.checkoutId,
    input: good,
    quote,
    stripe
  });
  assert.ok(dto.canonicalPaymentIntentId);
});

test('16. legal constants match frontend and backend', () => {
  const clientPath = path.join(__dirname, '../../client/src/constants/legalAcceptance.js');
  const clientSrc = fs.readFileSync(clientPath, 'utf8');
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_TERMS_VERSION));
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION));
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT));
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT));
});

test('18-20. optional consents false; strict on; no booking/charge/refund', async () => {
  assert.equal(process.env.FINALIZE_INTENT_REQUIRED_FOR_PI, '1');
  assert.equal(process.env.FINALIZE_INTENT_PERSIST, '1');
  const { input, quote } = buildCabinTypeCase();
  input.checkoutId = 'chk_cold_consents_0006';
  const stripe = makeStripe();
  const dto = await ensureCanonicalPaymentIntent({
    checkoutId: input.checkoutId,
    input,
    quote,
    stripe
  });
  const session = await loadSessionOrThrow(dto.checkoutId);
  assert.equal(session.finalizeIntent.consents.quoteDeliveryRequested, false);
  assert.equal(session.finalizeIntent.consents.bookingReminderConsent, false);
  assert.equal(session.finalizeIntent.consents.marketingConsent, false);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(chargeCalls.length, 0);
  assert.equal(refundCalls.length, 0);
});

test('REGRESSION ASSERTION: bounded retry sequence never yields three null-hash sessions', async () => {
  const { input, quote } = buildCabinTypeCase();
  const checkoutId = 'chk_cold_no_orphans_0007';
  input.checkoutId = checkoutId;
  const stripe = makeStripe();
  for (let i = 0; i < 3; i += 1) {
    await ensureCanonicalPaymentIntent({
      checkoutId,
      input: { ...input, expectedSessionVersion: undefined },
      quote,
      stripe
    });
  }
  const sessions = await CheckoutSession.find({}).lean();
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].finalizeIntentHash);
  assert.ok(sessions[0].canonicalPaymentIntentId);
  assert.notEqual(
    sessions.filter((s) => s.finalizeIntentHash == null).length,
    3
  );
});
