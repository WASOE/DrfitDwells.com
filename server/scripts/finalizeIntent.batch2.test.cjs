/**
 * Batch 2 — finalizeIntent persistence, hash, PI metadata binding.
 *
 * Run:
 *   node --test server/scripts/finalizeIntent.batch2.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const featureFlags = require('../utils/featureFlags');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  createCheckoutSession,
  loadSessionOrThrow
} = require('../services/checkout/checkoutSessionService');
const {
  ensureCanonicalPaymentIntent,
  buildPaymentIntentMetadata
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const {
  FINALIZE_INTENT_SCHEMA_VERSION,
  buildValidatedFinalizeIntent,
  buildFinalizeIntentHashPayload,
  hashFinalizeIntent,
  materialFinalizeIntentEqual,
  persistFinalizeIntent,
  assertFinalizeIntentAvailableForPi,
  syncFinalizeIntentHashToPaymentIntent,
  sessionHasCompleteFinalizeIntent,
  buildRequestMetaFromReq
} = require('../services/checkout/finalizeIntentService');
const {
  CheckoutSessionError,
  CHECKOUT_SESSION_ERROR_CODES
} = require('../services/checkout/checkoutSessionErrors');
const { createGiftVoucherPaymentIntent } = require('../services/giftVouchers/giftVoucherPaymentService');

let mongoServer;
const ENTITY_ID = new mongoose.Types.ObjectId();

const ORIG_PERSIST = process.env.FINALIZE_INTENT_PERSIST;
const ORIG_REQUIRED = process.env.FINALIZE_INTENT_REQUIRED_FOR_PI;

function setFlags({ persist = '1', required = '0' } = {}) {
  process.env.FINALIZE_INTENT_PERSIST = persist;
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = required;
}

function restoreFlags() {
  if (ORIG_PERSIST === undefined) delete process.env.FINALIZE_INTENT_PERSIST;
  else process.env.FINALIZE_INTENT_PERSIST = ORIG_PERSIST;
  if (ORIG_REQUIRED === undefined) delete process.env.FINALIZE_INTENT_REQUIRED_FOR_PI;
  else process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = ORIG_REQUIRED;
}

function createFakeStripe() {
  const store = new Map();
  const idempotencyStore = new Map();
  let seq = 0;
  const calls = { create: 0, uniqueCreated: 0, retrieve: 0, cancel: 0, update: 0 };

  return {
    paymentIntents: {
      create: async (payload, options = {}) => {
        calls.create += 1;
        const idempotencyKey = options.idempotencyKey || null;
        if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
          return { ...idempotencyStore.get(idempotencyKey) };
        }
        const id = `pi_test_${++seq}`;
        calls.uniqueCreated += 1;
        const pi = {
          id,
          client_secret: `cs_secret_${id}`,
          amount: payload.amount,
          currency: payload.currency,
          metadata: { ...(payload.metadata || {}) },
          status: 'requires_payment_method',
          idempotencyKey
        };
        store.set(id, pi);
        if (idempotencyKey) idempotencyStore.set(idempotencyKey, pi);
        return pi;
      },
      retrieve: async (id) => {
        calls.retrieve += 1;
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error(`No such payment_intent: ${id}`);
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi, metadata: { ...pi.metadata } };
      },
      cancel: async (id) => {
        calls.cancel += 1;
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      },
      update: async (id, patch) => {
        calls.update += 1;
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error(`No such payment_intent: ${id}`);
          err.code = 'resource_missing';
          throw err;
        }
        if (patch?.metadata) {
          pi.metadata = { ...pi.metadata, ...patch.metadata };
        }
        return { ...pi, metadata: { ...pi.metadata } };
      }
    },
    __store: store,
    __calls: calls,
    setStatus(id, status) {
      const pi = store.get(String(id));
      if (pi) pi.status = status;
    },
    failNextUpdate() {
      const original = this.paymentIntents.update;
      this.paymentIntents.update = async () => {
        this.paymentIntents.update = original;
        throw new Error('stripe_update_failed');
      };
    }
  };
}

function buildFabricatedQuote(overrides = {}) {
  const checkInDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const checkOutDate = new Date(Date.now() + 12 * 24 * 60 * 60 * 1000);
  return {
    entityType: 'cabin',
    entity: {
      _id: ENTITY_ID,
      minNights: 1,
      capacity: 4,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 0,
    totalPrice: 200,
    appliedPromoCode: '',
    promo: null,
    voucherAppliedCents: 0,
    remainingDueCents: 20000,
    fullVoucherCoverage: false,
    ...overrides
  };
}

function buildInput(overrides = {}) {
  return {
    cabinId: String(ENTITY_ID),
    checkIn: '2030-08-10',
    checkOut: '2030-08-12',
    adults: 2,
    children: 0,
    experienceKeys: ['sauna'],
    transportMethod: '',
    romanticSetup: false,
    ...overrides
  };
}

function validFinalizeBody(overrides = {}) {
  return {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'Ada.Lovelace@Example.COM',
      phone: '+359888000111'
    },
    specialRequests: 'Quiet cabin',
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
      quoteDeliveryRequested: true,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    experienceKeys: ['sauna'],
    tripType: null,
    customTripType: null,
    transportMethod: 'Not selected',
    romanticSetup: false,
    attribution: { utmSource: 'test', utmMedium: 'suite' },
    metaClientContext: {
      eventSourceUrl: 'http://localhost:5173/confirm',
      fbp: 'fb.1.test'
    },
    ...overrides
  };
}

const requestMeta = {
  ip: '203.0.113.10',
  userAgent: 'Batch2TestAgent/1.0',
  acceptLanguage: 'en-US,en;q=0.9'
};

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  restoreFlags();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setFlags({ persist: '1', required: '0' });
  await CheckoutSession.deleteMany({});
});

test.afterEach(() => {
  restoreFlags();
});

test('feature flags: unset defaults off; 1/true/on/yes enable; 0/false/off/no disable', () => {
  delete process.env.FINALIZE_INTENT_PERSIST;
  delete process.env.FINALIZE_INTENT_REQUIRED_FOR_PI;
  assert.equal(featureFlags.isFinalizeIntentPersistEnabled(), false);
  assert.equal(featureFlags.isFinalizeIntentRequiredForPiEnabled(), false);

  for (const v of ['1', 'true', 'ON', 'yes']) {
    process.env.FINALIZE_INTENT_PERSIST = v;
    assert.equal(featureFlags.isFinalizeIntentPersistEnabled(), true, v);
  }
  for (const v of ['0', 'false', 'OFF', 'no']) {
    process.env.FINALIZE_INTENT_PERSIST = v;
    assert.equal(featureFlags.isFinalizeIntentPersistEnabled(), false, v);
  }
});

test('1) valid finalizeIntent persistence', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  const result = await persistFinalizeIntent({
    checkoutId: created.session.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe: createFakeStripe()
  });
  assert.equal(result.idempotentReplay, false);
  assert.match(result.finalizeIntentHash, /^[a-f0-9]{64}$/);
  assert.equal(result.schemaVersion, FINALIZE_INTENT_SCHEMA_VERSION);

  const session = await loadSessionOrThrow(created.session.checkoutId);
  assert.ok(session.finalizeIntent);
  assert.equal(session.finalizeIntent.guestInfo.email, 'ada.lovelace@example.com');
  assert.equal(session.finalizeIntentHash, result.finalizeIntentHash);
  assert.ok(session.finalizeIntentCapturedAt);
  assert.equal(session.finalizeIntent.requestMeta.ip, requestMeta.ip);
  assert.equal(session.guestEmail, 'ada.lovelace@example.com');
});

test('2) required-field validation', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: created.session.checkoutId,
        body: validFinalizeBody({ guestInfo: { firstName: '', lastName: 'X', email: 'a@b.co', phone: '1' } }),
        requestMeta
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID
  );
});

test('3) server-owned capturedAt and request metadata (ignore client forged values)', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  const forged = validFinalizeBody({
    capturedAt: '2000-01-01T00:00:00.000Z',
    requestMeta: { ip: '1.2.3.4', userAgent: 'forged', acceptLanguage: 'xx' }
  });
  const before = Date.now();
  const result = await persistFinalizeIntent({
    checkoutId: created.session.checkoutId,
    body: forged,
    requestMeta,
    stripe: createFakeStripe()
  });
  const session = await loadSessionOrThrow(created.session.checkoutId);
  const capturedMs = new Date(session.finalizeIntent.capturedAt).getTime();
  assert.ok(capturedMs >= before - 1000);
  assert.notEqual(String(session.finalizeIntent.capturedAt), '2000-01-01T00:00:00.000Z');
  assert.equal(session.finalizeIntent.requestMeta.ip, requestMeta.ip);
  assert.equal(session.finalizeIntent.requestMeta.userAgent, requestMeta.userAgent);
  assert.ok(result.finalizeIntentHash);
});

test('4) legal version/text snapshot validation', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: created.session.checkoutId,
        body: validFinalizeBody({
          legalAcceptance: {
            ...validFinalizeBody().legalAcceptance,
            termsVersion: 'wrong-version'
          }
        }),
        requestMeta
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID
  );
});

test('5) hash determinism for semantically identical input', () => {
  const capturedAt = new Date('2030-01-15T12:00:00.000Z');
  const a = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  const b = buildValidatedFinalizeIntent({
    body: validFinalizeBody({
      experienceKeys: ['sauna'],
      guestInfo: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.lovelace@example.com',
        phone: '+359888000111'
      }
    }),
    requestMeta: { ...requestMeta },
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  assert.equal(hashFinalizeIntent(a), hashFinalizeIntent(b));
});

test('6) material edits produce different hash', () => {
  const capturedAt = new Date('2030-01-15T12:00:00.000Z');
  const base = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  const edited = buildValidatedFinalizeIntent({
    body: validFinalizeBody({
      guestInfo: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        phone: '+359888000222'
      }
    }),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  assert.notEqual(hashFinalizeIntent(base), hashFinalizeIntent(edited));
});

test('7) harmless normalization produces same hash where intended', () => {
  const capturedAt = new Date('2030-01-15T12:00:00.000Z');
  const a = buildValidatedFinalizeIntent({
    body: validFinalizeBody({
      guestInfo: {
        firstName: '  Ada  ',
        lastName: ' Lovelace ',
        email: 'Ada.Lovelace@Example.COM',
        phone: ' +359888000111 '
      },
      transportMethod: 'Not selected',
      experienceKeys: ['sauna', 'sauna']
    }),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  const b = buildValidatedFinalizeIntent({
    body: validFinalizeBody({
      guestInfo: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.lovelace@example.com',
        phone: '+359888000111'
      },
      transportMethod: null,
      experienceKeys: ['sauna']
    }),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  assert.equal(hashFinalizeIntent(a), hashFinalizeIntent(b));
  assert.equal(a.transportMethod, null);
});

test('8) duplicate persistence is idempotent (preserves capturedAt, hash, sessionVersion)', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  const stripe = createFakeStripe();
  const first = await persistFinalizeIntent({
    checkoutId: created.session.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe
  });
  assert.equal(first.idempotentReplay, false);
  assert.ok(first.capturedAt);
  const firstCapturedIso = new Date(first.capturedAt).toISOString();

  const afterFirst = await loadSessionOrThrow(created.session.checkoutId);
  const storedCapturedIso = new Date(afterFirst.finalizeIntent.capturedAt).toISOString();
  assert.equal(storedCapturedIso, firstCapturedIso);
  assert.equal(afterFirst.finalizeIntentHash, first.finalizeIntentHash);

  const second = await persistFinalizeIntent({
    checkoutId: created.session.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: first.sessionVersion
  });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.finalizeIntentHash, first.finalizeIntentHash);
  assert.equal(second.sessionVersion, first.sessionVersion);
  assert.equal(new Date(second.capturedAt).toISOString(), firstCapturedIso);

  const afterSecond = await loadSessionOrThrow(created.session.checkoutId);
  assert.equal(new Date(afterSecond.finalizeIntent.capturedAt).toISOString(), firstCapturedIso);
  assert.equal(afterSecond.finalizeIntentHash, first.finalizeIntentHash);
  assert.equal(Number(afterSecond.sessionVersion), Number(first.sessionVersion));
});

test('8b) material edit before payment gets new capturedAt, new hash, synced PI metadata', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const first = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  const firstCapturedIso = new Date(first.capturedAt).toISOString();

  await new Promise((r) => setTimeout(r, 5));

  const second = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody({
      specialRequests: 'Late check-in please'
    }),
    requestMeta,
    stripe,
    expectedSessionVersion: first.sessionVersion
  });

  assert.equal(second.idempotentReplay, false);
  assert.notEqual(second.finalizeIntentHash, first.finalizeIntentHash);
  assert.notEqual(new Date(second.capturedAt).toISOString(), firstCapturedIso);
  assert.ok(second.sessionVersion > first.sessionVersion);
  assert.equal(second.metadataSync?.synced, true);
  assert.equal(
    stripe.__store.get(ensured.canonicalPaymentIntentId).metadata.finalizeIntentHash,
    second.finalizeIntentHash
  );
  assert.equal(stripe.__calls.uniqueCreated, 1);
});

test('8c) idempotent retry still syncs stale PI metadata and fails closed on sync error', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const first = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });

  // Simulate stale metadata after a prior sync interruption
  const pi = stripe.__store.get(ensured.canonicalPaymentIntentId);
  pi.metadata.finalizeIntentHash = '';

  const second = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: first.sessionVersion
  });
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.finalizeIntentHash, first.finalizeIntentHash);
  assert.equal(new Date(second.capturedAt).toISOString(), new Date(first.capturedAt).toISOString());
  assert.equal(second.metadataSync?.synced, true);
  assert.equal(pi.metadata.finalizeIntentHash, first.finalizeIntentHash);

  pi.metadata.finalizeIntentHash = '';
  stripe.failNextUpdate();
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: ensured.checkoutId,
        body: validFinalizeBody(),
        requestMeta,
        stripe,
        expectedSessionVersion: first.sessionVersion
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED
  );
});

test('9) sessionVersion conflict', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: created.session.checkoutId,
        body: validFinalizeBody(),
        requestMeta,
        expectedSessionVersion: 999
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_SESSION_VERSION_CONFLICT
  );
});

test('10) edit before PI confirmation updates hash and syncs metadata without new PI', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const checkoutId = ensured.checkoutId;
  const piId = ensured.canonicalPaymentIntentId;
  assert.ok(piId);

  const first = await persistFinalizeIntent({
    checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  assert.equal(stripe.__store.get(piId).metadata.finalizeIntentHash, first.finalizeIntentHash);

  const second = await persistFinalizeIntent({
    checkoutId,
    body: validFinalizeBody({
      guestInfo: {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        phone: '+359888000222'
      }
    }),
    requestMeta,
    stripe,
    expectedSessionVersion: first.sessionVersion
  });
  assert.notEqual(second.finalizeIntentHash, first.finalizeIntentHash);
  assert.equal(stripe.__calls.uniqueCreated, 1);
  assert.equal(stripe.__store.get(piId).metadata.finalizeIntentHash, second.finalizeIntentHash);
  assert.ok(stripe.__calls.update >= 1);
});

test('11) rejection after PI processing', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  stripe.setStatus(ensured.canonicalPaymentIntentId, 'processing');
  const session = await loadSessionOrThrow(ensured.checkoutId);
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: ensured.checkoutId,
        body: validFinalizeBody({
          guestInfo: {
            firstName: 'X',
            lastName: 'Y',
            email: 'xy@example.com',
            phone: '+359111'
          }
        }),
        requestMeta,
        stripe,
        expectedSessionVersion: session.sessionVersion
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE
  );
});

test('12) rejection after PI success', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const persisted = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  stripe.setStatus(ensured.canonicalPaymentIntentId, 'succeeded');
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: ensured.checkoutId,
        body: validFinalizeBody({
          guestInfo: {
            firstName: 'X',
            lastName: 'Y',
            email: 'xy@example.com',
            phone: '+359111'
          }
        }),
        requestMeta,
        stripe,
        expectedSessionVersion: persisted.sessionVersion
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE
  );
});

test('13) PI metadata contains finalizeIntentHash', async () => {
  setFlags({ persist: '1', required: '1' });
  const stripe = createFakeStripe();
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  const persisted = await persistFinalizeIntent({
    checkoutId: created.session.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe
  });
  const ensured = await ensureCanonicalPaymentIntent({
    checkoutId: created.session.checkoutId,
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const pi = stripe.__store.get(ensured.canonicalPaymentIntentId);
  assert.equal(pi.metadata.finalizeIntentHash, persisted.finalizeIntentHash);
  assert.equal(pi.metadata.checkoutId, created.session.checkoutId);
  assert.ok(pi.metadata.quoteSnapshotHash);
  assert.equal(pi.metadata.flowVersion, 'v2');
  assert.equal(pi.metadata.type, undefined);
});

test('14) existing PI metadata synchronization on ensure reuse', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const persisted = await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  const beforeCreates = stripe.__calls.uniqueCreated;
  const reused = await ensureCanonicalPaymentIntent({
    checkoutId: ensured.checkoutId,
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  assert.equal(reused.canonicalPaymentIntentId, ensured.canonicalPaymentIntentId);
  assert.equal(stripe.__calls.uniqueCreated, beforeCreates);
  assert.equal(
    stripe.__store.get(ensured.canonicalPaymentIntentId).metadata.finalizeIntentHash,
    persisted.finalizeIntentHash
  );
});

test('15) metadata sync failure prevents payment continuation', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  stripe.failNextUpdate();
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: ensured.checkoutId,
        body: validFinalizeBody(),
        requestMeta,
        stripe,
        expectedSessionVersion: ensured.sessionVersion
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_METADATA_SYNC_FAILED
  );
});

test('16) required-for-PI flag blocks missing intent', async () => {
  setFlags({ persist: '1', required: '1' });
  const stripe = createFakeStripe();
  await assert.rejects(
    () =>
      ensureCanonicalPaymentIntent({
        input: buildInput(),
        quote: buildFabricatedQuote(),
        stripe
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED
  );
});

test('17) persist-only mode remains backward compatible (PI without intent)', async () => {
  setFlags({ persist: '1', required: '0' });
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  assert.ok(ensured.canonicalPaymentIntentId);
  assert.equal(stripe.__store.get(ensured.canonicalPaymentIntentId).metadata.finalizeIntentHash, '');
});

test('18) disabled flags preserve current behaviour', async () => {
  setFlags({ persist: '0', required: '0' });
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  assert.ok(ensured.clientSecret);
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: ensured.checkoutId,
        body: validFinalizeBody(),
        requestMeta,
        stripe
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_PERSIST_DISABLED
  );
});

test('19) gift vouchers remain unaffected (no finalizeIntentHash requirement)', async () => {
  // Accommodation ensure metadata builder must not leak into gift voucher create.
  // Gift voucher payment service builds its own metadata with type: gift_voucher.
  const meta = buildPaymentIntentMetadata({
    session: {
      flowVersion: 'v2',
      checkoutId: 'chk_test',
      quoteSnapshotHash: 'abc',
      finalizeIntentHash: 'should-not-matter-for-gift'
    },
    snapshot: {
      entityType: 'cabin',
      cabinId: 'c1',
      checkInISO: new Date().toISOString(),
      checkOutISO: new Date().toISOString(),
      stripeAmountCents: 1000,
      experienceKeys: [],
      transportMethod: '',
      romanticSetup: false,
      subtotalCents: 1000,
      discountAmountCents: 0,
      totalValueCents: 1000,
      voucherAppliedCents: 0
    }
  });
  assert.equal(meta.finalizeIntentHash, 'should-not-matter-for-gift');
  assert.notEqual(meta.type, 'gift_voucher');

  // Confirm gift voucher module still exports create function (path untouched).
  assert.equal(typeof createGiftVoucherPaymentIntent, 'function');
});

test('20) location checkout path untouched (no finalizeIntent imports in public location routes)', () => {
  const fs = require('fs');
  const path = require('path');
  const loc = fs.readFileSync(
    path.join(__dirname, '../routes/publicLocationCheckoutRoutes.js'),
    'utf8'
  );
  assert.equal(loc.includes('finalizeIntent'), false);
  assert.equal(loc.includes('FINALIZE_INTENT'), false);
});

test('21) no worker, webhook booking creation or session paid writer exists in Batch 2 modules', () => {
  const fs = require('fs');
  const path = require('path');
  const finalizeSvc = fs.readFileSync(
    path.join(__dirname, '../services/checkout/finalizeIntentService.js'),
    'utf8'
  );
  assert.equal(finalizeSvc.includes('CheckoutFinalizationJob'), false);
  assert.equal(finalizeSvc.includes("paymentStatus: 'paid'"), false);
  assert.equal(finalizeSvc.includes('paymentStatus: "paid"'), false);

  const ingestion = fs.readFileSync(
    path.join(__dirname, '../services/ops/ingestion/stripeIngestionService.js'),
    'utf8'
  );
  assert.equal(ingestion.includes('CheckoutFinalizationJob'), false);
  assert.equal(ingestion.includes('markCheckoutSessionPaid'), false);
  assert.equal(ingestion.includes('enqueueCheckoutFinalization'), false);
});

test('22) logs redact guest/legal/request data (structured log fields only)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '../services/checkout/finalizeIntentService.js'),
    'utf8'
  );
  assert.match(src, /logFinalizeIntentEvent/);
  assert.match(src, /checkoutId/);
  assert.match(src, /finalizeIntentHash/);
  // Must not stringify full intent into logs
  assert.equal(src.includes('JSON.stringify(intent)'), false);
  assert.equal(src.includes('JSON.stringify(body)'), false);
  assert.equal(src.includes('client_secret'), false);
});

test('23) no new PaymentIntent solely because finalizeIntent changes', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const createdCount = stripe.__calls.uniqueCreated;
  await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody(),
    requestMeta,
    stripe,
    expectedSessionVersion: ensured.sessionVersion
  });
  const session = await loadSessionOrThrow(ensured.checkoutId);
  await persistFinalizeIntent({
    checkoutId: ensured.checkoutId,
    body: validFinalizeBody({
      specialRequests: 'Late check-in please'
    }),
    requestMeta,
    stripe,
    expectedSessionVersion: session.sessionVersion
  });
  assert.equal(stripe.__calls.uniqueCreated, createdCount);
  assert.equal(
    (await loadSessionOrThrow(ensured.checkoutId)).canonicalPaymentIntentId,
    ensured.canonicalPaymentIntentId
  );
});

test('hash payload excludes metaClientContext and includes capturedAt ISO', () => {
  const capturedAt = new Date('2030-01-15T12:00:00.000Z');
  const intent = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt,
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  const payload = buildFinalizeIntentHashPayload(intent);
  assert.equal(payload.capturedAt, '2030-01-15T12:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'metaClientContext'), false);
  assert.ok(intent.metaClientContext);
});

test('buildRequestMetaFromReq reads live request headers', () => {
  const meta = buildRequestMetaFromReq({
    ip: '198.51.100.9',
    get(name) {
      if (name === 'user-agent') return 'UA-Test';
      if (name === 'accept-language') return 'bg-BG';
      return null;
    }
  });
  assert.equal(meta.ip, '198.51.100.9');
  assert.equal(meta.userAgent, 'UA-Test');
  assert.equal(meta.acceptLanguage, 'bg-BG');
});

test('materialFinalizeIntentEqual ignores capturedAt differences', () => {
  const a = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt: new Date('2030-01-15T12:00:00.000Z'),
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  const b = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt: new Date('2030-01-16T12:00:00.000Z'),
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  assert.equal(materialFinalizeIntentEqual(a, b), true);
  assert.notEqual(hashFinalizeIntent(a), hashFinalizeIntent(b));
});

test('assertFinalizeIntentAvailableForPi no-ops when required flag off', async () => {
  setFlags({ persist: '0', required: '0' });
  const session = { checkoutId: 'x', finalizeIntent: null, finalizeIntentHash: null };
  assert.deepEqual(assertFinalizeIntentAvailableForPi(session), { ok: true, required: false });
});

test('sessionHasCompleteFinalizeIntent detects hash mismatch', () => {
  const intent = buildValidatedFinalizeIntent({
    body: validFinalizeBody(),
    requestMeta,
    capturedAt: new Date('2030-01-15T12:00:00.000Z'),
    quoteSnapshot: { experienceKeys: ['sauna'] }
  });
  assert.equal(
    sessionHasCompleteFinalizeIntent({
      finalizeIntent: intent,
      finalizeIntentHash: 'deadbeef'
    }),
    false
  );
  assert.equal(
    sessionHasCompleteFinalizeIntent({
      finalizeIntent: intent,
      finalizeIntentHash: hashFinalizeIntent(intent)
    }),
    true
  );
});

test('paymentStatus paid rejects finalizeIntent mutation', async () => {
  const created = await createCheckoutSession({
    input: buildInput(),
    quote: buildFabricatedQuote()
  });
  created.session.paymentStatus = 'paid';
  await created.session.save();
  await assert.rejects(
    () =>
      persistFinalizeIntent({
        checkoutId: created.session.checkoutId,
        body: validFinalizeBody(),
        requestMeta
      }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_IMMUTABLE
  );
});

test('syncFinalizeIntentHashToPaymentIntent updates mutable PI only', async () => {
  const stripe = createFakeStripe();
  const ensured = await ensureCanonicalPaymentIntent({
    input: buildInput(),
    quote: buildFabricatedQuote(),
    stripe
  });
  const session = await loadSessionOrThrow(ensured.checkoutId);
  session.finalizeIntentHash = 'abc123hash';
  await session.save();
  const sync = await syncFinalizeIntentHashToPaymentIntent({
    stripe,
    session,
    finalizeIntentHash: 'abc123hash'
  });
  assert.equal(sync.synced, true);
  assert.equal(stripe.__store.get(ensured.canonicalPaymentIntentId).metadata.finalizeIntentHash, 'abc123hash');
});
