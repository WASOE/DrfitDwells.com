/**
 * Batch 7 — Paid checkout reconciliation.
 *
 * Run: node --test --test-concurrency=1 server/scripts/reconcilePaidCheckoutFinalization.batch7.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const ManualReviewItem = require('../models/ManualReviewItem');
const featureFlags = require('../utils/featureFlags');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');
const {
  buildValidatedFinalizeIntent,
  hashFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const { FINALIZE_STATUS } = require('../services/checkout/checkoutFinalizeService');
const {
  RECONCILE_CLASSIFICATIONS,
  inspectPaidCheckoutSubject,
  reconcilePaidCheckoutSubject,
  reconcilePaidCheckoutFinalization
} = require('../services/checkout/reconcilePaidCheckoutFinalization');
const { ensureCheckoutFinalizationJob } = require('../services/checkout/checkoutFinalizationJobService');

let mongoServer;
const ORIG_RECONCILE = process.env.FINALIZE_RECONCILE_ENQUEUE;
const ORIG_MARK = process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK;
const ORIG_ENQUEUE = process.env.FINALIZE_JOB_ENQUEUE;
const ORIG_SIDE = process.env.FINALIZE_SIDE_EFFECTS;
const ORIG_SEND = process.env.FINALIZE_WORKER_SEND_CONFIRMATION;

function restoreEnv() {
  if (ORIG_RECONCILE === undefined) delete process.env.FINALIZE_RECONCILE_ENQUEUE;
  else process.env.FINALIZE_RECONCILE_ENQUEUE = ORIG_RECONCILE;
  if (ORIG_MARK === undefined) delete process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK;
  else process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK = ORIG_MARK;
  if (ORIG_ENQUEUE === undefined) delete process.env.FINALIZE_JOB_ENQUEUE;
  else process.env.FINALIZE_JOB_ENQUEUE = ORIG_ENQUEUE;
  if (ORIG_SIDE === undefined) delete process.env.FINALIZE_SIDE_EFFECTS;
  else process.env.FINALIZE_SIDE_EFFECTS = ORIG_SIDE;
  if (ORIG_SEND === undefined) delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  else process.env.FINALIZE_WORKER_SEND_CONFIRMATION = ORIG_SEND;
}

function buildQuote(cabinId, amountCents = 20000) {
  return {
    entityType: 'cabin',
    entity: { _id: cabinId },
    checkInDate: new Date('2030-09-10T12:00:00.000Z'),
    checkOutDate: new Date('2030-09-12T12:00:00.000Z'),
    subtotalPrice: amountCents / 100,
    discountAmount: 0,
    totalPrice: amountCents / 100,
    remainingDueCents: amountCents,
    voucherAppliedCents: 0,
    fullVoucherCoverage: false,
    appliedPromoCode: ''
  };
}

function buildIntentBody() {
  return {
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Seven',
      email: 'batch7@example.com',
      phone: '+359888000777'
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
    experienceKeys: [],
    romanticSetup: false
  };
}

async function createCabin() {
  return Cabin.create({
    name: 'Batch7 Cabin',
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

async function seedSession({
  cabin,
  paymentStatus = 'unpaid',
  finalizeStatus = 'open',
  withIntent = true,
  amountCents = 20000
} = {}) {
  const quote = buildQuote(cabin._id, amountCents);
  const created = await createCheckoutSession({
    input: {
      cabinId: String(cabin._id),
      checkIn: '2030-09-10',
      checkOut: '2030-09-12',
      adults: 2,
      children: 0,
      guestEmail: 'batch7@example.com'
    },
    quote
  });
  const session = created.session || created;

  const piId = `pi_b7_${String(session.checkoutId).slice(0, 8)}_${Math.random().toString(36).slice(2, 6)}`;
  const patch = {
    flowVersion: 'v2',
    canonicalPaymentIntentId: piId,
    stripeAmountCents: amountCents,
    currency: 'eur',
    paymentStatus,
    finalizeStatus,
    quoteSnapshot: {
      ...(session.quoteSnapshot || {}),
      currency: 'eur',
      entityType: 'cabin',
      cabinId: String(cabin._id),
      checkInDateOnly: '2030-09-10',
      checkOutDateOnly: '2030-09-12',
      checkInISO: normalizeDateToSofiaDayStart('2030-09-10').toISOString(),
      checkOutISO: normalizeDateToSofiaDayStart('2030-09-12').toISOString()
    }
  };

  if (withIntent) {
    const intent = buildValidatedFinalizeIntent({
      body: buildIntentBody(),
      requestMeta: { ip: '127.0.0.1', userAgent: 'Batch7Test', acceptLanguage: 'en' },
      capturedAt: new Date('2030-01-01T00:00:00.000Z'),
      quoteSnapshot: patch.quoteSnapshot
    });
    patch.finalizeIntent = intent;
    patch.finalizeIntentHash = hashFinalizeIntent(intent);
  }

  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: session.checkoutId },
    { $set: patch },
    { new: true }
  );

  return { session: updated, paymentIntentId: piId };
}

function buildSucceededPi({ session, paymentIntentId }) {
  return {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount: session.stripeAmountCents,
    amount_received: session.stripeAmountCents,
    currency: 'eur',
    metadata: {
      checkoutId: session.checkoutId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      finalizeIntentHash: session.finalizeIntentHash || '',
      cabinId: String(session.quoteSnapshot.cabinId),
      checkIn: '2030-09-10',
      checkOut: '2030-09-12',
      flowVersion: 'v2'
    }
  };
}

function createStripeStub(piById) {
  const calls = { retrieve: 0, create: 0, refunds: 0 };
  return {
    calls,
    paymentIntents: {
      retrieve: async (id) => {
        calls.retrieve += 1;
        const pi = piById[id];
        if (!pi) {
          const err = new Error('No such payment_intent');
          err.code = 'resource_missing';
          throw err;
        }
        return pi;
      },
      create: async () => {
        calls.create += 1;
        throw new Error('paymentIntents.create must not be called from reconcile');
      },
      update: async () => ({})
    },
    refunds: {
      create: async () => {
        calls.refunds += 1;
        throw new Error('refunds.create must not be called from reconcile');
      }
    }
  };
}

async function createPaidPayment({ paymentIntentId, checkoutId, reservationId = null }) {
  return Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 200,
    currency: 'eur',
    source: 'webhook',
    reservationId,
    metadata: { checkoutId }
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
  process.env.FINALIZE_RECONCILE_ENQUEUE = '0';
  process.env.CHECKOUT_MARK_PAID_ON_WEBHOOK = '0';
  process.env.FINALIZE_JOB_ENQUEUE = '0';
  process.env.FINALIZE_SIDE_EFFECTS = '0';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '0';
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CheckoutSession.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({}),
    Payment.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    PaymentResolutionIssue.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('flag FINALIZE_RECONCILE_ENQUEUE defaults off', () => {
  delete process.env.FINALIZE_RECONCILE_ENQUEUE;
  assert.equal(featureFlags.isFinalizeReconcileEnqueueEnabled(), false);
});

test('dry-run performs no writes', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });

  const beforeSession = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  const beforeJobs = await CheckoutFinalizationJob.countDocuments({});
  const beforeIssues = await PaymentResolutionIssue.countDocuments({});

  const outcome = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: false,
    stripe,
    paymentIntent: pi
  });

  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.classification, RECONCILE_CLASSIFICATIONS.SESSION_NOT_MARKED_PAID);
  assert.equal(outcome.repair?.mutated, false);

  const afterSession = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(afterSession.paymentStatus, beforeSession.paymentStatus);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), beforeJobs);
  assert.equal(await PaymentResolutionIssue.countDocuments({}), beforeIssues);
  assert.equal(stripe.calls.create, 0);
  assert.equal(stripe.calls.refunds, 0);
});

test('explicit execution repairs safe SESSION_PAID_NO_JOB', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });

  const first = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true
  });
  assert.equal(first.dryRun, false);
  assert.equal(first.classification, RECONCILE_CLASSIFICATIONS.SESSION_PAID_NO_JOB);
  assert.equal(first.repair?.mutated, true);

  const jobs = await CheckoutFinalizationJob.find({ checkoutId: session.checkoutId });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, 'scheduled');
  assert.equal(jobs[0].createdReason, 'reconcile');
});

test('explicit execution marks paid when Stripe succeeded and session unpaid', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });

  const outcome = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe,
    paymentIntent: pi
  });

  assert.equal(outcome.classification, RECONCILE_CLASSIFICATIONS.SESSION_NOT_MARKED_PAID);
  assert.equal(outcome.repair?.mutated, true);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'paid');
  const jobs = await CheckoutFinalizationJob.find({ checkoutId: session.checkoutId });
  assert.equal(jobs.length, 1);
});

test('execute without flag remains dry-run', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '0';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });

  const outcome = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true
  });
  assert.equal(outcome.dryRun, true);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('repeated execution is idempotent (no duplicate active job)', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });

  await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true
  });
  await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true
  });

  const jobs = await CheckoutFinalizationJob.find({
    checkoutId: session.checkoutId,
    status: { $in: ['scheduled', 'claimed'] }
  });
  assert.equal(jobs.length, 1);
});

test('no duplicate Booking on adopt repair', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });

  const booking = await Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-09-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-09-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: `fp_b7_${session.checkoutId}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Seven',
      email: 'batch7@example.com',
      phone: '+359888000777'
    },
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Seven',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    },
    cabinId: cabin._id
  });

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId })
  });

  const first = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe
  });
  assert.ok(
    [
      RECONCILE_CLASSIFICATIONS.BOOKING_EXISTS_LINKAGE_INCOMPLETE,
      RECONCILE_CLASSIFICATIONS.BOOKING_EXISTS_BY_CHECKOUT_ID,
      RECONCILE_CLASSIFICATIONS.SESSION_PAID_NO_JOB,
      RECONCILE_CLASSIFICATIONS.JOB_SUCCEEDED_SESSION_NOT_FINALIZED
    ].includes(first.classification) || first.repairAction === 'finalize_paid_checkout' ||
      first.repairAction === 'ensure_job'
  );

  // Ensure job then finalize path
  await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'reconcile'
  });
  await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe
  });
  await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe
  });

  const bookings = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(bookings.length, 1);
  assert.equal(String(bookings[0]._id), String(booking._id));
});

test('no email resend for ambiguous delivery', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({
    cabin,
    paymentStatus: 'paid',
    finalizeStatus: FINALIZE_STATUS.FINALIZED
  });
  const booking = await Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-09-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-09-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: `fp_b7_amb_${session.checkoutId}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Seven',
      email: 'batch7-amb@example.com',
      phone: '+359888000777'
    },
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Seven',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    },
    cabinId: cabin._id
  });
  await CheckoutSession.updateOne(
    { checkoutId: session.checkoutId },
    { $set: { bookingId: booking._id, finalizeStatus: FINALIZE_STATUS.FINALIZED } }
  );
  await createPaidPayment({
    paymentIntentId,
    checkoutId: session.checkoutId,
    reservationId: booking._id
  });
  await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'reconcile'
  });
  await CheckoutFinalizationJob.updateOne(
    { checkoutId: session.checkoutId },
    { $set: { status: 'succeeded', bookingId: booking._id } }
  );
  await EmailDeliveryState.create({
    correlationKey: `booking:${booking._id}:booking_confirmed:batch7-amb@example.com`,
    domain: 'booking_lifecycle',
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipient: 'batch7-amb@example.com',
    latestStatus: 'ambiguous',
    latestEventAt: new Date(),
    ambiguousAt: new Date(),
    ambiguousReason: 'AMBIGUOUS_SMTP_RETRY'
  });

  let sendCalls = 0;
  const outcome = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true
  });
  assert.equal(outcome.classification, RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS);
  assert.equal(outcome.repair?.emailResendAttempted, false);
  assert.equal(outcome.repair?.mutated, false);
  void sendCalls;
});

test('unsafe mismatch creates review evidence rather than mutate', async () => {
  process.env.FINALIZE_RECONCILE_ENQUEUE = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  pi.amount_received = 99999;
  pi.amount = 99999;
  const stripe = createStripeStub({ [paymentIntentId]: pi });

  const outcome = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe,
    paymentIntent: pi
  });

  assert.equal(outcome.classification, RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH);
  assert.equal(outcome.safeToMutate, false);
  const repaired = await reconcilePaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    execute: true,
    stripe,
    paymentIntent: pi
  });
  // open review on execute
  assert.ok(
    repaired.repair?.mutated === true ||
      repaired.repairAction === 'open_manual_review'
  );
  const sessionAfter = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(sessionAfter.paymentStatus, 'unpaid');
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
  const issues = await PaymentResolutionIssue.find({ paymentIntentId });
  assert.ok(issues.length >= 1);
});

test('gift voucher exclusion', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 50,
    currency: 'eur',
    source: 'webhook',
    metadata: { type: 'gift_voucher', checkoutId: session.checkoutId }
  });
  const inspection = await inspectPaidCheckoutSubject({
    checkoutId: session.checkoutId,
    paymentIntentId,
    paymentIntent: {
      id: paymentIntentId,
      status: 'succeeded',
      metadata: { type: 'gift_voucher', checkoutId: session.checkoutId }
    }
  });
  assert.equal(
    inspection.classification,
    RECONCILE_CLASSIFICATIONS.GIFT_VOUCHER_OR_LOCATION_EXCLUSION
  );
});

test('no refund and no PaymentIntent create in reconcile module', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/checkout/reconcilePaidCheckoutFinalization.js'),
    'utf8'
  );
  assert.doesNotMatch(src, /refunds\.create/);
  assert.doesNotMatch(src, /paymentIntents\.create/);
  assert.doesNotMatch(src, /Booking\.create/);
  const cli = fs.readFileSync(
    path.join(__dirname, 'reconcilePaidCheckoutFinalization.js'),
    'utf8'
  );
  assert.match(cli, /--execute/);
  assert.match(cli, /dry-run/);
  assert.doesNotMatch(cli, /startCheckoutFinalizationWorker/);
});

test('server startup does not auto-run reconcile', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.doesNotMatch(serverSrc, /reconcilePaidCheckoutFinalization/);
});

test('batch entry respects limit and dry-run summary', async () => {
  const cabin = await createCabin();
  const a = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({
    paymentIntentId: a.paymentIntentId,
    checkoutId: a.session.checkoutId
  });
  const summary = await reconcilePaidCheckoutFinalization({
    checkoutId: a.session.checkoutId,
    execute: false,
    limit: 5
  });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.scanned, 1);
  assert.equal(summary.refundAttempted, false);
  assert.equal(summary.paymentIntentCreateAttempted, false);
});
