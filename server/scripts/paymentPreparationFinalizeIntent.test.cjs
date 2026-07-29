/**
 * Accommodation payment preparation: server-owned finalizeIntent before PI.
 * Run: cd server && node --test scripts/paymentPreparationFinalizeIntent.test.cjs
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
  buildValidatedFinalizeIntent,
  hashFinalizeIntent,
  sessionHasCompleteFinalizeIntent,
  normalizeOptionalAccommodationConsents,
  ensureFinalizeIntentForPaymentPreparation,
  persistFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const {
  ensureCanonicalPaymentIntent
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');

let mongoServer;
let createdPiIds = [];
let chargeCalls = [];
let refundCalls = [];

const ORIG = {
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI
};

function setFlags({ persist = '1', required = '1' } = {}) {
  process.env.FINALIZE_INTENT_PERSIST = persist;
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = required;
}

function restoreFlags() {
  for (const [key, envKey] of [
    ['PERSIST', 'FINALIZE_INTENT_PERSIST'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI']
  ]) {
    if (ORIG[key] === undefined) delete process.env[envKey];
    else process.env[envKey] = ORIG[key];
  }
}

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function makeStripe() {
  return {
    paymentIntents: {
      create: async (args) => {
        const id = `pi_test_prep_${createdPiIds.length + 1}_${Date.now()}`;
        createdPiIds.push(id);
        return {
          id,
          client_secret: `${id}_secret`,
          status: 'requires_payment_method',
          amount: args.amount,
          currency: args.currency,
          metadata: args.metadata || {}
        };
      },
      retrieve: async (id) => ({
        id,
        client_secret: `${id}_secret`,
        status: 'requires_payment_method',
        amount: 20000,
        currency: 'eur',
        metadata: { checkoutId: 'x' }
      }),
      update: async (id, args) => ({
        id,
        client_secret: `${id}_secret`,
        status: 'requires_payment_method',
        metadata: args.metadata || {}
      }),
      cancel: async (id) => ({ id, status: 'canceled' })
    },
    charges: {
      create: async (...args) => {
        chargeCalls.push(args);
        throw new Error('charges.create must not be called during preparation');
      }
    },
    refunds: {
      create: async (...args) => {
        refundCalls.push(args);
        throw new Error('refunds.create must not be called during preparation');
      }
    }
  };
}

function guestLegalBody(overrides = {}) {
  return {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
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
    experienceKeys: [],
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    ...overrides
  };
}

function quoteFromSession(session) {
  const snap = session.quoteSnapshot || {};
  return {
    subtotalPrice: (snap.subtotalCents || 20000) / 100,
    discountAmount: (snap.discountAmountCents || 0) / 100,
    totalPrice: (snap.totalValueCents || snap.stripeAmountCents || 20000) / 100,
    appliedPromoCode: snap.appliedPromoCode || '',
    nights: snap.nights || 2,
    entityType: snap.entityType || 'cabin',
    entity: {
      cabinId: snap.cabinId,
      cabinTypeId: snap.cabinTypeId
    }
  };
}

function inputFromSession(session, body = {}) {
  const snap = session.quoteSnapshot || {};
  return {
    cabinId: snap.cabinId,
    cabinTypeId: snap.cabinTypeId,
    checkIn: snap.checkInDateOnly || snap.checkInISO,
    checkOut: snap.checkOutDateOnly || snap.checkOutISO,
    adults: snap.adults || 2,
    children: snap.children || 0,
    experienceKeys: snap.experienceKeys || [],
    checkoutId: session.checkoutId,
    ...body
  };
}

async function seedSession() {
  const cabinId = new mongoose.Types.ObjectId().toString();
  const checkIn = plusDays(10);
  const checkOut = plusDays(12);
  const result = await createCheckoutSession({
    input: {
      cabinId,
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: []
    },
    quote: {
      subtotalPrice: 200,
      discountAmount: 0,
      totalPrice: 200,
      appliedPromoCode: '',
      nights: 2,
      entityType: 'cabin',
      entity: { cabinId }
    }
  });
  return result.session;
}

test.before(async () => {
  setFlags({ persist: '1', required: '1' });
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
  setFlags({ persist: '1', required: '1' });
  createdPiIds = [];
  chargeCalls = [];
  refundCalls = [];
  await CheckoutSession.deleteMany({});
  await Booking.deleteMany({});
});

test('legal acceptance text drift guard: client and server constants match', () => {
  const clientPath = path.join(
    __dirname,
    '../../client/src/constants/legalAcceptance.js'
  );
  const clientSrc = fs.readFileSync(clientPath, 'utf8');
  assert.match(clientSrc, new RegExp(LEGAL_ACCEPTANCE_TERMS_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(
    clientSrc,
    new RegExp(LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT));
  assert.ok(clientSrc.includes(LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT));
});

test('1-4. valid guest+legal persists finalize intent, hash matches, PI after persist, strict on', async () => {
  const session = await seedSession();
  const body = guestLegalBody();
  const prep = await ensureFinalizeIntentForPaymentPreparation({
    session,
    body,
    requestMeta: { ip: '127.0.0.1', userAgent: 'test', acceptLanguage: 'en' },
    stripe: makeStripe()
  });
  assert.equal(prep.persisted, true);
  assert.ok(prep.finalizeIntentHash);
  assert.ok(sessionHasCompleteFinalizeIntent(prep.session));
  assert.equal(hashFinalizeIntent(prep.session.finalizeIntent), prep.finalizeIntentHash);

  const dto = await ensureCanonicalPaymentIntent({
    checkoutId: prep.session.checkoutId,
    input: inputFromSession(prep.session, {
      ...body,
      __requestMeta: { ip: '127.0.0.1', userAgent: 'test', acceptLanguage: 'en' }
    }),
    quote: quoteFromSession(prep.session),
    stripe: makeStripe()
  });
  assert.ok(dto.canonicalPaymentIntentId);
  assert.ok(dto.clientSecret);
  assert.ok(dto.finalizeIntentHash);
  assert.equal(createdPiIds.length, 1);
  assert.equal(await Booking.countDocuments({}), 0);
});

test('5-10. missing guest/legal fields reject before PI', async () => {
  const cases = [
    { name: 'firstName', body: guestLegalBody({ guestInfo: { ...guestLegalBody().guestInfo, firstName: '' } }) },
    { name: 'lastName', body: guestLegalBody({ guestInfo: { ...guestLegalBody().guestInfo, lastName: '' } }) },
    { name: 'email', body: guestLegalBody({ guestInfo: { ...guestLegalBody().guestInfo, email: 'bad' } }) },
    { name: 'phone', body: guestLegalBody({ guestInfo: { ...guestLegalBody().guestInfo, phone: '' } }) },
    {
      name: 'terms',
      body: guestLegalBody({
        legalAcceptance: { ...guestLegalBody().legalAcceptance, acceptedTermsAndCancellation: false }
      })
    },
    {
      name: 'risk',
      body: guestLegalBody({
        legalAcceptance: { ...guestLegalBody().legalAcceptance, acceptedActivityRisk: false }
      })
    }
  ];

  for (const c of cases) {
    createdPiIds = [];
    const session = await seedSession();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent({
          checkoutId: session.checkoutId,
          input: inputFromSession(session, c.body),
          quote: quoteFromSession(session),
          stripe: makeStripe()
        }),
      (err) => {
        assert.ok(err.code === 'FINALIZE_INTENT_INVALID' || err.code === 'FINALIZE_INTENT_REQUIRED');
        return true;
      },
      c.name
    );
    assert.equal(createdPiIds.length, 0, c.name);
  }
});

test('11-12. optional consents absent/false default false and allow PI', async () => {
  assert.deepEqual(normalizeOptionalAccommodationConsents({}), {
    quoteDeliveryRequested: false,
    bookingReminderConsent: false,
    marketingConsent: false
  });
  const intent = buildValidatedFinalizeIntent({
    body: guestLegalBody({ consents: undefined }),
    requestMeta: { ip: null, userAgent: null, acceptLanguage: null },
    capturedAt: new Date(),
    quoteSnapshot: { experienceKeys: [] }
  });
  assert.equal(intent.consents.quoteDeliveryRequested, false);
  assert.equal(intent.consents.bookingReminderConsent, false);
  assert.equal(intent.consents.marketingConsent, false);

  const session = await seedSession();
  const dto = await ensureCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    input: inputFromSession(
      session,
      guestLegalBody({
        consents: {
          quoteDeliveryRequested: false,
          bookingReminderConsent: false,
          marketingConsent: false
        }
      })
    ),
    quote: quoteFromSession(session),
    stripe: makeStripe()
  });
  assert.ok(dto.canonicalPaymentIntentId);
});

test('13-15. reuse existing intent; conflict rejects; identical prep idempotent', async () => {
  const session = await seedSession();
  const body = guestLegalBody();
  const first = await persistFinalizeIntent({
    checkoutId: session.checkoutId,
    body,
    requestMeta: { ip: '1.1.1.1', userAgent: 'a', acceptLanguage: 'en' },
    stripe: makeStripe()
  });

  const reused = await ensureFinalizeIntentForPaymentPreparation({
    session: await CheckoutSession.findOne({ checkoutId: session.checkoutId }),
    body,
    requestMeta: { ip: '9.9.9.9', userAgent: 'b', acceptLanguage: 'bg' },
    stripe: makeStripe()
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.finalizeIntentHash, first.finalizeIntentHash);

  await assert.rejects(
    async () =>
      ensureFinalizeIntentForPaymentPreparation({
        session: await CheckoutSession.findOne({ checkoutId: session.checkoutId }),
        body: guestLegalBody({
          guestInfo: { ...guestLegalBody().guestInfo, firstName: 'Changed' }
        }),
        requestMeta: { ip: null, userAgent: null, acceptLanguage: null },
        stripe: makeStripe()
      }),
    (err) => err.code === 'FINALIZE_INTENT_IMMUTABLE'
  );

  const dto1 = await ensureCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    input: inputFromSession(session, body),
    quote: quoteFromSession(session),
    stripe: makeStripe()
  });
  const dto2 = await ensureCanonicalPaymentIntent({
    checkoutId: session.checkoutId,
    input: inputFromSession(session, body),
    quote: quoteFromSession(session),
    stripe: makeStripe()
  });
  assert.equal(dto1.canonicalPaymentIntentId, dto2.canonicalPaymentIntentId);
  assert.equal(createdPiIds.length, 1);
});

test('16-20. concurrent prep one PI; retry no replacement; no booking/charge/refund', async () => {
  const session = await seedSession();
  const body = guestLegalBody();
  const input = inputFromSession(session, body);
  const stripe = makeStripe();
  const [a, b] = await Promise.all([
    ensureCanonicalPaymentIntent({
      checkoutId: session.checkoutId,
      input,
      quote: quoteFromSession(session),
      stripe
    }),
    ensureCanonicalPaymentIntent({
      checkoutId: session.checkoutId,
      input,
      quote: quoteFromSession(session),
      stripe
    })
  ]);
  assert.equal(a.canonicalPaymentIntentId, b.canonicalPaymentIntentId);
  assert.ok(createdPiIds.length >= 1);
  const refreshed = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(String(refreshed.canonicalPaymentIntentId), String(a.canonicalPaymentIntentId));
  assert.ok(!refreshed.supersededPaymentIntentIds.includes(refreshed.canonicalPaymentIntentId));
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(chargeCalls.length, 0);
  assert.equal(refundCalls.length, 0);
});
