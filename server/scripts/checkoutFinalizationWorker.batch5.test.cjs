/**
 * Batch 5 — CheckoutFinalizationJob worker claim/execute.
 *
 * Run: node --test server/scripts/checkoutFinalizationWorker.batch5.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
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
  ensureCheckoutFinalizationJob,
  claimDueCheckoutFinalizationJob,
  reclaimStaleClaimedCheckoutFinalizationJob,
  markCheckoutFinalizationJobFailedRetryable,
  markCheckoutFinalizationJobFailedPermanent,
  classifyFinalizeJobError,
  computeFinalizeJobBackoffMs
} = require('../services/checkout/checkoutFinalizationJobService');
const {
  tickOnce,
  sweepStaleClaimedOnce,
  executeClaimedJob,
  startCheckoutFinalizationWorkerIfEnabled,
  stopCheckoutFinalizationWorkerForTest,
  setAwaitExecuteForTests,
  __setFinalizePaidCheckoutForTesting,
  __resetFinalizePaidCheckoutForTesting,
  __setStripeClientForTesting,
  __resetStripeClientForTesting,
  getCheckoutFinalizationWorkerState
} = require('../services/checkout/checkoutFinalizationWorker');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');
const { finalizePaidCheckout } = require('../services/checkout/finalizePaidCheckout');

let mongoServer;
const ORIG_EXECUTE = process.env.FINALIZE_JOB_EXECUTE;
const ORIG_SEND = process.env.FINALIZE_WORKER_SEND_CONFIRMATION;

function restoreEnv() {
  if (ORIG_EXECUTE === undefined) delete process.env.FINALIZE_JOB_EXECUTE;
  else process.env.FINALIZE_JOB_EXECUTE = ORIG_EXECUTE;
  if (ORIG_SEND === undefined) delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  else process.env.FINALIZE_WORKER_SEND_CONFIRMATION = ORIG_SEND;
}

function buildQuote(cabinId, amountCents = 20000) {
  return {
    entityType: 'cabin',
    entity: { _id: cabinId },
    checkInDate: new Date('2030-08-10T12:00:00.000Z'),
    checkOutDate: new Date('2030-08-12T12:00:00.000Z'),
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
      lastName: 'Five',
      email: 'batch5@example.com',
      phone: '+359888000555'
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
    romanticSetup: false
  };
}

async function createCabin() {
  return Cabin.create({
    name: 'Batch5 Cabin',
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

async function seedPaidSessionAndJob({
  cabin,
  paymentIntentId = `pi_b5_${new mongoose.Types.ObjectId().toString()}`,
  paymentStatus = 'paid',
  expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000),
  maxAttempts = 20,
  attemptCount = 0
} = {}) {
  const created = await createCheckoutSession({
    input: {
      cabinId: String(cabin._id),
      checkIn: '2030-08-10',
      checkOut: '2030-08-12',
      adults: 2,
      children: 0,
      experienceKeys: ['sauna'],
      guestEmail: 'batch5@example.com'
    },
    quote: buildQuote(cabin._id)
  });
  const session = created.session;
  const intent = buildValidatedFinalizeIntent({
    body: buildIntentBody(),
    requestMeta: { ip: '127.0.0.1', userAgent: 'Batch5Test', acceptLanguage: 'en' },
    capturedAt: new Date('2030-01-01T00:00:00.000Z'),
    quoteSnapshot: session.quoteSnapshot
  });
  const finalizeIntentHash = hashFinalizeIntent(intent);
  session.canonicalPaymentIntentId = paymentIntentId;
  session.status = 'pi_active';
  session.paymentStatus = paymentStatus;
  session.stripeAmountCents = 20000;
  session.finalizeIntent = intent;
  session.finalizeIntentHash = finalizeIntentHash;
  session.finalizeIntentCapturedAt = intent.capturedAt;
  session.finalizeStatus = FINALIZE_STATUS.OPEN;
  session.expiresAt = expiresAt;
  await session.save();

  const enq = await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    quoteSnapshotHash: session.quoteSnapshotHash,
    finalizeIntentHash,
    createdReason: 'webhook'
  });
  const job = await CheckoutFinalizationJob.findById(enq.jobId);
  if (maxAttempts !== 20 || attemptCount !== 0) {
    job.maxAttempts = maxAttempts;
    job.attemptCount = attemptCount;
    await job.save();
  }
  return { session, paymentIntentId, finalizeIntentHash, job };
}

function buildSucceededPi({ session, paymentIntentId, finalizeIntentHash }) {
  const snapshot = session.quoteSnapshot || {};
  return {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount: session.stripeAmountCents,
    amount_received: session.stripeAmountCents,
    currency: 'eur',
    metadata: {
      flowVersion: 'v2',
      checkoutId: session.checkoutId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      finalizeIntentHash: finalizeIntentHash || session.finalizeIntentHash || '',
      cabinId: snapshot.cabinId || '',
      cabinTypeId: '',
      checkIn: snapshot.checkInISO || '2030-08-10T12:00:00.000Z',
      checkOut: snapshot.checkOutISO || '2030-08-12T12:00:00.000Z'
    }
  };
}

function createStripeStub(piById) {
  const store = new Map(Object.entries(piById || {}));
  const calls = { retrieve: 0, create: 0, update: 0, refunds: 0 };
  return {
    calls,
    paymentIntents: {
      retrieve: async (id) => {
        calls.retrieve += 1;
        const pi = store.get(String(id));
        if (!pi) throw new Error('No such payment_intent');
        return { ...pi };
      },
      create: async () => {
        calls.create += 1;
        throw new Error('PaymentIntent create is forbidden in Batch 5 worker tests');
      },
      update: async (id, patch) => {
        calls.update += 1;
        const current = store.get(String(id)) || { id, metadata: {} };
        const next = {
          ...current,
          metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) }
        };
        store.set(String(id), next);
        return next;
      }
    },
    refunds: {
      create: async () => {
        calls.refunds += 1;
        throw new Error('Refund is forbidden in Batch 5 worker');
      }
    }
  };
}

async function seedExistingBooking({ session, paymentIntentId, cabin }) {
  return Booking.create({
    cabinId: cabin._id,
    checkIn: normalizeDateToSofiaDayStart(session.quoteSnapshot.checkInDateOnly),
    checkOut: normalizeDateToSofiaDayStart(session.quoteSnapshot.checkOutDateOnly),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Five',
      email: 'batch5@example.com',
      phone: '+359888000555'
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
      lastName: 'Five',
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
  await CheckoutFinalizationJob.syncIndexes();
});

test.after(async () => {
  stopCheckoutFinalizationWorkerForTest();
  __resetFinalizePaidCheckoutForTesting();
  __resetStripeClientForTesting();
  restoreEnv();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  stopCheckoutFinalizationWorkerForTest();
  __resetFinalizePaidCheckoutForTesting();
  __resetStripeClientForTesting();
  restoreEnv();
  process.env.FINALIZE_JOB_EXECUTE = '1';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '0';
  setAwaitExecuteForTests(true);
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('1: scheduled job claimed atomically', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-a',
    visibilityTimeoutMs: 60_000
  });
  assert.ok(claimed);
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.claimedBy, 'worker-a');
  assert.equal(claimed.attemptCount, 1);
  assert.ok(claimed.visibilityTimeoutAt);
});

test('2: two workers cannot claim the same job', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  const first = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-a',
    visibilityTimeoutMs: 60_000
  });
  const second = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-b',
    visibilityTimeoutMs: 60_000
  });
  assert.ok(first);
  assert.equal(second, null);
  const reloaded = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloaded.claimedBy, 'worker-a');
  assert.equal(reloaded.attemptCount, 1);
});

test('3: stale claimed job is recovered', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-a',
    visibilityTimeoutMs: 60_000
  });
  assert.ok(claimed);
  claimed.visibilityTimeoutAt = new Date(Date.now() - 60_000);
  await claimed.save();

  const reclaimed = await reclaimStaleClaimedCheckoutFinalizationJob({
    jobId: job._id,
    now: new Date()
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.status, 'scheduled');
  assert.equal(reclaimed.lastErrorCode, 'JOB_VISIBILITY_TIMEOUT');
  assert.equal(reclaimed.claimedBy, null);

  const sweep = await sweepStaleClaimedOnce({ now: new Date() });
  assert.equal(typeof sweep.reclaimed, 'number');
});

test('4: worker crash allows later retry via visibility reclaim', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'crashed-worker',
    visibilityTimeoutMs: 60_000
  });
  assert.ok(claimed);
  // Crash: leave claimed, expire visibility.
  claimed.visibilityTimeoutAt = new Date(Date.now() - 60_000);
  await claimed.save();

  await reclaimStaleClaimedCheckoutFinalizationJob({ jobId: job._id, now: new Date() });
  const reclaimed = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reclaimed.status, 'scheduled');

  const again = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-b',
    visibilityTimeoutMs: 60_000
  });
  assert.ok(again);
  assert.equal(again.claimedBy, 'worker-b');
  assert.equal(again.attemptCount, 2);
});

test('5: retryable failure returns to scheduled/failed_retryable with backoff', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-a',
    visibilityTimeoutMs: 60_000
  });
  const failed = await markCheckoutFinalizationJobFailedRetryable({
    jobId: claimed._id,
    errorCode: 'FINALIZE_IN_PROGRESS',
    errorSummary: 'lock held',
    stage: 'acquire_lock',
    attemptCount: claimed.attemptCount,
    maxAttempts: claimed.maxAttempts
  });
  assert.ok(failed);
  assert.equal(failed.status, 'failed_retryable');
  assert.ok(failed.nextAttemptAt.getTime() > Date.now());
  assert.equal(failed.lastErrorCode, 'FINALIZE_IN_PROGRESS');
  const backoff = computeFinalizeJobBackoffMs(1, { random: () => 0.5 });
  assert.ok(backoff >= 30_000);
});

test('6: attempts exhausted become failed_permanent', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin, maxAttempts: 2, attemptCount: 1 });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-a',
    visibilityTimeoutMs: 60_000
  });
  assert.equal(claimed.attemptCount, 2);
  const failed = await markCheckoutFinalizationJobFailedRetryable({
    jobId: claimed._id,
    errorCode: 'MONGO_TRANSIENT',
    errorSummary: 'transient',
    attemptCount: claimed.attemptCount,
    maxAttempts: claimed.maxAttempts
  });
  assert.equal(failed.status, 'failed_permanent');
  assert.equal(failed.lastErrorCode, 'MONGO_TRANSIENT');
});

test('7: permanent domain failure becomes failed_permanent immediately', async () => {
  const cabin = await createCabin();
  const { job } = await seedPaidSessionAndJob({ cabin });
  __setFinalizePaidCheckoutForTesting(async () => {
    const err = new Error('amount mismatch');
    err.code = 'CHECKOUT_SESSION_NOT_USABLE';
    err.verificationErrorCode = 'AMOUNT_MISMATCH';
    err.details = { permanent: true, verificationErrorCode: 'AMOUNT_MISMATCH' };
    throw err;
  });
  setAwaitExecuteForTests(true);
  const tick = await tickOnce({ now: new Date() });
  assert.equal(tick.claimed, 1);
  assert.equal(tick.failedPermanent, 1);
  const reloaded = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloaded.status, 'failed_permanent');
  assert.equal(reloaded.lastErrorCode, 'AMOUNT_MISMATCH');
});

test('8: FINALIZE_IN_PROGRESS is retryable', () => {
  const err = new Error('in progress');
  err.code = CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS;
  const classified = classifyFinalizeJobError(err);
  assert.equal(classified.permanent, false);
  assert.equal(classified.errorCode, 'FINALIZE_IN_PROGRESS');
});

test('9: existing Booking adoption succeeds via worker', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash, job } = await seedPaidSessionAndJob({
    cabin
  });
  const booking = await seedExistingBooking({ session, paymentIntentId, cabin });
  session.finalizeStatus = FINALIZE_STATUS.IN_PROGRESS;
  session.finalizeStartedAt = new Date(Date.now() - 10 * 60 * 1000);
  await session.save();

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);
  __resetFinalizePaidCheckoutForTesting();

  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-adopt',
    visibilityTimeoutMs: 60_000
  });
  const result = await executeClaimedJob(claimed);
  assert.equal(result.ok, true);
  assert.equal(String(result.bookingId), String(booking._id));
  const reloaded = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloaded.status, 'succeeded');
  assert.equal(String(reloaded.bookingId), String(booking._id));
});

test('10: paid expired session succeeds via worker', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash, job } = await seedPaidSessionAndJob({
    cabin,
    paymentStatus: 'paid',
    expiresAt: new Date(Date.now() - 60 * 60 * 1000)
  });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);
  __resetFinalizePaidCheckoutForTesting();

  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-expired',
    visibilityTimeoutMs: 60_000
  });
  const result = await executeClaimedJob(claimed);
  assert.equal(result.ok, true);
  assert.ok(result.bookingId);
  const reloadedSession = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloadedSession.finalizeStatus, FINALIZE_STATUS.FINALIZED);
});

test('11: successful job becomes succeeded with bookingId', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash, job } = await seedPaidSessionAndJob({
    cabin
  });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);

  const tick = await tickOnce({ now: new Date() });
  assert.equal(tick.claimed, 1);
  assert.equal(tick.succeeded, 1);
  const reloaded = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloaded.status, 'succeeded');
  assert.ok(reloaded.bookingId);
  assert.equal(reloaded.stage, 'succeeded');
  const bookings = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(bookings.length, 1);
});

test('12: partial payment linkage / session state is repaired on adopt', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash, job } = await seedPaidSessionAndJob({
    cabin,
    paymentStatus: 'unpaid'
  });
  const booking = await seedExistingBooking({ session, paymentIntentId, cabin });
  // Session still open / unpaid while booking exists (partial crash).
  assert.equal(session.finalizeStatus, FINALIZE_STATUS.OPEN);

  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);

  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-repair',
    visibilityTimeoutMs: 60_000
  });
  const result = await executeClaimedJob(claimed);
  assert.equal(result.ok, true);
  assert.equal(result.adoptedExisting, true);

  const reloadedSession = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
  assert.equal(reloadedSession.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(reloadedSession.paymentStatus, 'paid');
  assert.equal(String(reloadedSession.bookingId), String(booking._id));

  const reloadedJob = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloadedJob.status, 'succeeded');
  assert.ok(reloadedJob.paymentLinkedAt);
  assert.ok(reloadedJob.sessionFinalizedAt);
});

test('13: feature flag off claims nothing', async () => {
  process.env.FINALIZE_JOB_EXECUTE = '0';
  const cabin = await createCabin();
  await seedPaidSessionAndJob({ cabin });
  const tick = await tickOnce({ now: new Date() });
  assert.equal(tick.claimed, 0);
  assert.equal(tick.candidatesCount, 0);
  const start = startCheckoutFinalizationWorkerIfEnabled();
  assert.equal(start.started, false);
});

test('14: gift-voucher jobs are rejected or excluded', async () => {
  const cabin = await createCabin();
  const { paymentIntentId, job } = await seedPaidSessionAndJob({ cabin });
  __setStripeClientForTesting({
    paymentIntents: {
      retrieve: async () => ({
        id: paymentIntentId,
        metadata: { type: 'gift_voucher' }
      })
    }
  });
  const claimed = await claimDueCheckoutFinalizationJob({
    jobId: job._id,
    workerId: 'worker-gv',
    visibilityTimeoutMs: 60_000
  });
  const result = await executeClaimedJob(claimed);
  assert.equal(result.cancelled, true);
  assert.equal(result.errorCode, 'GIFT_VOUCHER_EXCLUDED');
  const reloaded = await CheckoutFinalizationJob.findById(job._id);
  assert.equal(reloaded.status, 'cancelled');
});

test('15+16+17: no email, no refund, no PaymentIntent create', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSessionAndJob({ cabin });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);

  let emailCalled = false;
  __setFinalizePaidCheckoutForTesting(async (args) => {
    // Domain path still used; ensure worker did not pass an email sender.
    assert.equal(args.source, 'webhook_worker');
    return finalizePaidCheckout(args);
  });

  const tick = await tickOnce({ now: new Date() });
  assert.equal(tick.succeeded, 1);
  assert.equal(tick.emailSendAttempted, false);
  assert.equal(tick.refundAttempted, false);
  assert.equal(tick.paymentIntentCreateAttempted, false);
  assert.equal(stripe.calls.create, 0);
  assert.equal(stripe.calls.refunds, 0);
  assert.equal(emailCalled, false);

  const workerState = getCheckoutFinalizationWorkerState();
  assert.equal(workerState.lastEmailSendAttempted, false);
  assert.equal(workerState.lastRefundAttempted, false);
  assert.equal(workerState.lastPaymentIntentCreateAttempted, false);
});

test('18: no duplicate Booking is created', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId, finalizeIntentHash } = await seedPaidSessionAndJob({ cabin });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId, finalizeIntentHash })
  });
  __setStripeClientForTesting(stripe);

  await tickOnce({ now: new Date() });
  // Second ensure + tick should not create another booking (job already succeeded).
  await ensureCheckoutFinalizationJob({
    checkoutId: session.checkoutId,
    paymentIntentId,
    createdReason: 'webhook'
  });
  await tickOnce({ now: new Date() });

  const bookings = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(bookings.length, 1);
  const jobs = await CheckoutFinalizationJob.find({ checkoutId: session.checkoutId });
  assert.equal(jobs.filter((j) => j.status === 'succeeded').length, 1);
});

test('flag defaults: FINALIZE_JOB_EXECUTE and SEND_CONFIRMATION off', () => {
  delete process.env.FINALIZE_JOB_EXECUTE;
  delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  assert.equal(featureFlags.isFinalizeJobExecuteEnabled(), false);
  assert.equal(featureFlags.isFinalizeWorkerSendConfirmationEnabled(), false);
});
