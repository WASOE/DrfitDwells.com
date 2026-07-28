/**
 * Batch 4 — finalizePaidCheckout domain service crash cases.
 *
 * Run: node --test server/scripts/finalizePaidCheckout.batch4.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('../services/checkout/checkoutSessionErrors');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');
const {
  buildValidatedFinalizeIntent,
  hashFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const {
  FINALIZE_STATUS,
  acquireFinalizeLock,
  reclaimStaleFinalizeLock,
  getFinalizeLockVisibilityMs
} = require('../services/checkout/checkoutFinalizeService');
const {
  DOMAIN_VERIFICATION_CODES,
  finalizePaidCheckout
} = require('../services/checkout/finalizePaidCheckout');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const featureFlags = require('../utils/featureFlags');

let mongoServer;
const ORIG_VIS = process.env.FINALIZE_LOCK_VISIBILITY_MS;
const ORIG_DOMAIN = process.env.FINALIZE_DOMAIN_SERVICE;
const ORIG_EXECUTE = process.env.FINALIZE_JOB_EXECUTE;

function restoreEnv() {
  if (ORIG_VIS === undefined) delete process.env.FINALIZE_LOCK_VISIBILITY_MS;
  else process.env.FINALIZE_LOCK_VISIBILITY_MS = ORIG_VIS;
  if (ORIG_DOMAIN === undefined) delete process.env.FINALIZE_DOMAIN_SERVICE;
  else process.env.FINALIZE_DOMAIN_SERVICE = ORIG_DOMAIN;
  if (ORIG_EXECUTE === undefined) delete process.env.FINALIZE_JOB_EXECUTE;
  else process.env.FINALIZE_JOB_EXECUTE = ORIG_EXECUTE;
}

function buildQuote(overrides = {}) {
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  return {
    entityType: 'cabin',
    entity: { _id: cabinId },
    checkInDate: new Date('2030-08-10T12:00:00.000Z'),
    checkOutDate: new Date('2030-08-12T12:00:00.000Z'),
    subtotalPrice: 200,
    discountAmount: 0,
    totalPrice: 200,
    remainingDueCents: 20000,
    voucherAppliedCents: 0,
    fullVoucherCoverage: false,
    appliedPromoCode: '',
    ...overrides
  };
}

function buildInput(cabinId, overrides = {}) {
  return {
    cabinId: String(cabinId),
    checkIn: '2030-08-10',
    checkOut: '2030-08-12',
    adults: 2,
    children: 0,
    experienceKeys: ['sauna'],
    guestEmail: 'batch4@example.com',
    ...overrides
  };
}

function buildIntentBody(overrides = {}) {
  return {
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Four',
      email: 'batch4@example.com',
      phone: '+359888000444',
      ...(overrides.guestInfo || {})
    },
    specialRequests: '',
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
    experienceKeys: ['sauna'],
    romanticSetup: false,
    ...overrides
  };
}

async function createCabin() {
  return Cabin.create({
    name: 'Batch4 Cabin',
    description: 'Test',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
}

async function seedPaidSession({
  cabin,
  paymentIntentId = `pi_b4_${new mongoose.Types.ObjectId().toString()}`,
  paymentStatus = 'paid',
  expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000),
  finalizeStatus = FINALIZE_STATUS.OPEN,
  supersededPaymentIntentIds = [],
  amountCents = 20000
} = {}) {
  const created = await createCheckoutSession({
    input: buildInput(cabin._id),
    quote: buildQuote({ cabinId: cabin._id, remainingDueCents: amountCents, totalPrice: amountCents / 100 })
  });
  const session = created.session;
  const intent = buildValidatedFinalizeIntent({
    body: buildIntentBody(),
    requestMeta: { ip: '127.0.0.1', userAgent: 'Batch4Test', acceptLanguage: 'en' },
    capturedAt: new Date('2030-01-01T00:00:00.000Z'),
    quoteSnapshot: session.quoteSnapshot
  });
  const finalizeIntentHash = hashFinalizeIntent(intent);

  session.canonicalPaymentIntentId = paymentIntentId;
  session.status = 'pi_active';
  session.paymentStatus = paymentStatus;
  session.stripeAmountCents = amountCents;
  session.finalizeIntent = intent;
  session.finalizeIntentHash = finalizeIntentHash;
  session.finalizeIntentCapturedAt = intent.capturedAt;
  session.finalizeStatus = finalizeStatus;
  session.expiresAt = expiresAt;
  session.supersededPaymentIntentIds = supersededPaymentIntentIds;
  await session.save();

  return { session, paymentIntentId, finalizeIntentHash, intent };
}

function buildSucceededPi({ session, paymentIntentId, finalizeIntentHash, amountCents = null }) {
  const snapshot = session.quoteSnapshot || {};
  const amount = amountCents != null ? amountCents : session.stripeAmountCents;
  return {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount,
    amount_received: amount,
    currency: 'eur',
    metadata: {
      flowVersion: 'v2',
      checkoutId: session.checkoutId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      finalizeIntentHash: finalizeIntentHash || session.finalizeIntentHash || '',
      cabinId: snapshot.cabinId || '',
      cabinTypeId: snapshot.cabinTypeId || '',
      checkIn: snapshot.checkInISO || '2030-08-10T12:00:00.000Z',
      checkOut: snapshot.checkOutISO || '2030-08-12T12:00:00.000Z'
    }
  };
}

function createStripeStub(piById) {
  const store = new Map(Object.entries(piById || {}));
  return {
    paymentIntents: {
      retrieve: async (id) => {
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error('No such payment_intent');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi };
      },
      update: async (id, patch) => {
        const current = store.get(String(id)) || { id, metadata: {} };
        const next = {
          ...current,
          metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) }
        };
        store.set(String(id), next);
        return next;
      }
    }
  };
}

async function seedExistingBooking({ session, paymentIntentId, cabin }) {
  const checkIn = normalizeDateToSofiaDayStart(session.quoteSnapshot.checkInDateOnly);
  const checkOut = normalizeDateToSofiaDayStart(session.quoteSnapshot.checkOutDateOnly);
  return Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Four',
      email: 'batch4@example.com',
      phone: '+359888000444'
    },
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    paymentMethod: 'stripe',
    status: 'confirmed',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: session.stayFingerprint,
    checkoutSessionId: session._id,
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Four',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    },
    provenance: {
      source: 'guest_portal',
      intakeRevision: 1,
      createdByRoute: 'POST /api/bookings'
    }
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  restoreEnv();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  restoreEnv();
  process.env.FINALIZE_JOB_EXECUTE = '0';
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('1+6: adopt existing Booking by checkoutId when session still in_progress', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });
  const booking = await seedExistingBooking({ session, paymentIntentId, cabin });

  session.finalizeStatus = FINALIZE_STATUS.IN_PROGRESS;
  session.finalizeStartedAt = new Date(Date.now() - 10 * 60 * 1000);
  await session.save();

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  const result = await finalizePaidCheckout({
    checkoutId: session.checkoutId,
    paymentIntentId,
    source: 'frontend',
    dependencies: { stripe }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adoptedExisting, true);
  assert.equal(String(result.bookingId), String(booking._id));

  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloaded.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(String(reloaded.bookingId), String(booking._id));
  assert.equal(reloaded.paymentStatus, 'paid');
});

test('2+7: adopt existing Booking by stripePaymentIntentId when session not finalized', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });
  const booking = await seedExistingBooking({ session, paymentIntentId, cabin });
  // Clear checkoutId on booking to force PI lookup path, then restore session checkout link via PI.
  booking.checkoutId = undefined;
  await booking.save();

  const bookingByPi = await Booking.findOne({ stripePaymentIntentId: paymentIntentId });
  assert.ok(bookingByPi);

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  const result = await finalizePaidCheckout({
    checkoutId: session.checkoutId,
    paymentIntentId,
    source: 'webhook_worker',
    dependencies: { stripe }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adoptedExisting, true);
  assert.equal(String(result.bookingId), String(bookingByPi._id));

  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloaded.finalizeStatus, FINALIZE_STATUS.FINALIZED);
});

test('3: reclaim stale finalize lock then finalize', async () => {
  process.env.FINALIZE_LOCK_VISIBILITY_MS = '1000';
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });

  session.finalizeStatus = FINALIZE_STATUS.IN_PROGRESS;
  session.finalizeStartedAt = new Date(Date.now() - 60 * 1000);
  await session.save();

  const reclaimed = await reclaimStaleFinalizeLock({
    checkoutId: session.checkoutId,
    visibilityMs: 1000
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.finalizeStatus, FINALIZE_STATUS.OPEN);

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  const result = await finalizePaidCheckout({
    checkoutId: session.checkoutId,
    paymentIntentId,
    source: 'frontend',
    dependencies: { stripe, finalizeLockVisibilityMs: 1000 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.adoptedExisting, false);
  assert.ok(result.bookingId);

  const booking = await Booking.findById(result.bookingId);
  assert.ok(booking);
  assert.equal(booking.checkoutId, session.checkoutId);
});

test('4: simultaneous finalize — second call gets FINALIZE_IN_PROGRESS while lock fresh', async () => {
  process.env.FINALIZE_LOCK_VISIBILITY_MS = String(60 * 60 * 1000);
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });

  await acquireFinalizeLock({
    checkoutId: session.checkoutId,
    paidFinalizeOverride: true,
    visibilityMs: 60 * 60 * 1000
  });

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  await assert.rejects(
    finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        finalizeLockVisibilityMs: 60 * 60 * 1000
      }
    }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS
  );
});

test('5: paid session past expiresAt still finalizes', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({
    cabin,
    paymentStatus: 'paid',
    expiresAt: new Date(Date.now() - 60 * 60 * 1000)
  });

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  const result = await finalizePaidCheckout({
    checkoutId: session.checkoutId,
    paymentIntentId,
    source: 'frontend',
    dependencies: { stripe }
  });

  assert.equal(result.ok, true);
  assert.ok(result.bookingId);
  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloaded.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(reloaded.paymentStatus, 'paid');
});

test('8: same-day Sofia check-in is accepted by Booking validator', async () => {
  const cabin = await createCabin();
  const today = formatSofiaDateOnly(new Date());
  const tomorrow = formatSofiaDateOnly(new Date(Date.now() + 24 * 60 * 60 * 1000));

  const booking = new Booking({
    cabinId: cabin._id,
    checkIn: normalizeDateToSofiaDayStart(today),
    checkOut: normalizeDateToSofiaDayStart(tomorrow),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Same',
      lastName: 'Day',
      email: 'sameday@example.com',
      phone: '+359800000001'
    },
    totalPrice: 100,
    subtotalPrice: 100,
    paymentMethod: 'stripe',
    status: 'confirmed',
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Same',
      lastName: 'Day',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  await assert.doesNotReject(booking.validate());
});

test('9: superseded PaymentIntent fails verification', async () => {
  const cabin = await createCabin();
  const piId = `pi_superseded_${new mongoose.Types.ObjectId().toString()}`;
  const { session, finalizeIntentHash } = await seedPaidSession({
    cabin,
    paymentIntentId: piId,
    supersededPaymentIntentIds: [piId]
  });

  const stripe = createStripeStub({
    [piId]: buildSucceededPi({
      session,
      paymentIntentId: piId,
      finalizeIntentHash
    })
  });

  await assert.rejects(
    finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId: piId,
      source: 'frontend',
      dependencies: { stripe }
    }),
    (err) =>
      err instanceof CheckoutSessionError &&
      (err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.SUPERSEDED_PAYMENT_INTENT ||
        err.code === CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT)
  );
});

test('10: no available unit / cabin race surfaces as paid failure path via overlap retain', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });

  // Blocking competitor booking on same cabin/dates
  await Booking.create({
    cabinId: cabin._id,
    checkIn: normalizeDateToSofiaDayStart('2030-08-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-08-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Other',
      lastName: 'Guest',
      email: 'other@example.com',
      phone: '+359800000099'
    },
    totalPrice: 200,
    subtotalPrice: 200,
    paymentMethod: 'stripe',
    status: 'confirmed',
    commercialStayFingerprint: buildStayFingerprint({
      guestEmail: 'other@example.com',
      entityType: 'cabin',
      cabinId: String(cabin._id),
      checkInDateOnly: '2030-08-10',
      checkOutDateOnly: '2030-08-12'
    }),
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Other',
      lastName: 'Guest',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  await assert.rejects(
    finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        openManualReviewItem: async () => ({ _id: new mongoose.Types.ObjectId() }),
        recordPaidBookingResolutionIssue: async () => null
      }
    }),
    (err) => err.code === 'PAID_BOOKING_SAVE_FAILED' || err.needsReview === true
  );

  const retained = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(retained.length, 1);
  assert.equal(retained[0].metadata?.paidOverlapConflict, true);
});

test('11: commercial stay conflict rejects before duplicate booking', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });

  await Booking.create({
    cabinId: cabin._id,
    checkIn: normalizeDateToSofiaDayStart('2030-08-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-08-12'),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Four',
      email: 'batch4@example.com',
      phone: '+359888000444'
    },
    totalPrice: 200,
    subtotalPrice: 200,
    paymentMethod: 'stripe',
    status: 'confirmed',
    // Same commercial fingerprint, different checkoutId
    checkoutId: `chk_other_${Date.now()}`,
    commercialStayFingerprint: session.stayFingerprint,
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Four',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  await assert.rejects(
    finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.code === CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );

  const count = await Booking.countDocuments({ checkoutId: session.checkoutId });
  assert.equal(count, 0);
});

test('12: Stripe verification failure (not succeeded)', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({ cabin });
  const pi = buildSucceededPi({ session, paymentIntentId, finalizeIntentHash });
  pi.status = 'requires_payment_method';

  const stripe = createStripeStub({ [paymentIntentId]: pi });

  await assert.rejects(
    finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    }),
    (err) =>
      err instanceof CheckoutSessionError &&
      err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.PAYMENT_NOT_SUCCEEDED
  );
});

test('happy path: domain finalize creates booking and sets paymentStatus paid', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSession({
    cabin,
    paymentStatus: 'unpaid'
  });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });

  const result = await finalizePaidCheckout({
    checkoutId: session.checkoutId,
    paymentIntentId,
    source: 'frontend',
    confirmBody: {
      guestInfo: {
        firstName: 'Batch',
        lastName: 'Four',
        email: 'batch4@example.com',
        phone: '+359888000444'
      },
      cabinId: String(cabin._id),
      checkIn: '2030-08-10',
      checkOut: '2030-08-12'
    },
    dependencies: { stripe }
  });

  assert.equal(result.ok, true);
  assert.equal(result.idempotentReplay, false);
  assert.equal(result.adoptedExisting, false);

  const booking = await Booking.findById(result.bookingId);
  assert.ok(booking);
  assert.equal(booking.provenance.createdByRoute, 'POST /api/bookings');
  assert.equal(booking.stripePaymentIntentId, paymentIntentId);

  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloaded.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(reloaded.paymentStatus, 'paid');
});

test('flag defaults: FINALIZE_DOMAIN_SERVICE off; FINALIZE_JOB_EXECUTE off', () => {
  delete process.env.FINALIZE_DOMAIN_SERVICE;
  delete process.env.FINALIZE_JOB_EXECUTE;
  assert.equal(featureFlags.isFinalizeDomainServiceEnabled(), false);
  assert.equal(featureFlags.isFinalizeJobExecuteEnabled(), false);
  assert.ok(getFinalizeLockVisibilityMs() >= 60 * 1000);
});
