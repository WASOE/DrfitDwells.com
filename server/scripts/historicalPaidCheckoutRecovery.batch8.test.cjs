/**
 * Batch 8 — Controlled historical paid-checkout recovery.
 *
 * Run: node --test --test-concurrency=1 server/scripts/historicalPaidCheckoutRecovery.batch8.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
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
  HistoricalRecoveryError,
  loadAndValidateAllowlist,
  recoverHistoricalPaidCheckouts
} = require('../services/checkout/historicalPaidCheckoutRecovery');

let mongoServer;
let tmpDir;
const ORIG_HIST = process.env.FINALIZE_RECONCILE_HISTORICAL;
const ORIG_ENQUEUE = process.env.FINALIZE_RECONCILE_ENQUEUE;
const ORIG_SIDE = process.env.FINALIZE_SIDE_EFFECTS;
const ORIG_SEND = process.env.FINALIZE_WORKER_SEND_CONFIRMATION;

function restoreEnv() {
  if (ORIG_HIST === undefined) delete process.env.FINALIZE_RECONCILE_HISTORICAL;
  else process.env.FINALIZE_RECONCILE_HISTORICAL = ORIG_HIST;
  if (ORIG_ENQUEUE === undefined) delete process.env.FINALIZE_RECONCILE_ENQUEUE;
  else process.env.FINALIZE_RECONCILE_ENQUEUE = ORIG_ENQUEUE;
  if (ORIG_SIDE === undefined) delete process.env.FINALIZE_SIDE_EFFECTS;
  else process.env.FINALIZE_SIDE_EFFECTS = ORIG_SIDE;
  if (ORIG_SEND === undefined) delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  else process.env.FINALIZE_WORKER_SEND_CONFIRMATION = ORIG_SEND;
}

function writeAllowlist(name, rows) {
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  return filePath;
}

function buildQuote(cabinId, amountCents = 20000) {
  return {
    entityType: 'cabin',
    entity: { _id: cabinId },
    checkInDate: new Date('2030-10-10T12:00:00.000Z'),
    checkOutDate: new Date('2030-10-12T12:00:00.000Z'),
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
      lastName: 'Eight',
      email: 'batch8@example.com',
      phone: '+359888000888'
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
    name: 'Batch8 Cabin',
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
  amountCents = 20000
} = {}) {
  const created = await createCheckoutSession({
    input: {
      cabinId: String(cabin._id),
      checkIn: '2030-10-10',
      checkOut: '2030-10-12',
      adults: 2,
      children: 0,
      guestEmail: 'batch8@example.com'
    },
    quote: buildQuote(cabin._id, amountCents)
  });
  const session = created.session || created;
  const piId = `pi_b8_${String(session.checkoutId).slice(0, 8)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  const quoteSnapshot = {
    ...(session.quoteSnapshot || {}),
    currency: 'eur',
    entityType: 'cabin',
    cabinId: String(cabin._id),
    checkInDateOnly: '2030-10-10',
    checkOutDateOnly: '2030-10-12',
    checkInISO: normalizeDateToSofiaDayStart('2030-10-10').toISOString(),
    checkOutISO: normalizeDateToSofiaDayStart('2030-10-12').toISOString()
  };
  const intent = buildValidatedFinalizeIntent({
    body: buildIntentBody(),
    requestMeta: { ip: '127.0.0.1', userAgent: 'Batch8Test', acceptLanguage: 'en' },
    capturedAt: new Date('2030-01-01T00:00:00.000Z'),
    quoteSnapshot
  });

  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: session.checkoutId },
    {
      $set: {
        flowVersion: 'v2',
        canonicalPaymentIntentId: piId,
        stripeAmountCents: amountCents,
        currency: 'eur',
        paymentStatus,
        finalizeStatus,
        quoteSnapshot,
        finalizeIntent: intent,
        finalizeIntentHash: hashFinalizeIntent(intent)
      }
    },
    { new: true }
  );
  return { session: updated, paymentIntentId: piId };
}

function buildSucceededPi({ session, paymentIntentId, overrides = {} }) {
  const { metadata: metaOverrides, ...rest } = overrides;
  return {
    id: paymentIntentId,
    object: 'payment_intent',
    status: 'succeeded',
    amount: session.stripeAmountCents,
    amount_received: session.stripeAmountCents,
    currency: 'eur',
    ...rest,
    metadata: {
      checkoutId: session.checkoutId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      finalizeIntentHash: session.finalizeIntentHash || '',
      cabinId: String(session.quoteSnapshot.cabinId),
      checkIn: '2030-10-10',
      checkOut: '2030-10-12',
      flowVersion: 'v2',
      ...(metaOverrides || {})
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
        return { ...pi, client_secret: 'pi_secret_MUST_NOT_APPEAR' };
      },
      create: async () => {
        calls.create += 1;
        throw new Error('paymentIntents.create must not be called');
      },
      update: async () => ({})
    },
    refunds: {
      create: async () => {
        calls.refunds += 1;
        throw new Error('refunds.create must not be called');
      }
    }
  };
}

async function createPaidPayment({ paymentIntentId, checkoutId, reservationId = null, metadata = {} }) {
  return Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 200,
    currency: 'eur',
    source: 'webhook',
    reservationId,
    metadata: { checkoutId, ...metadata }
  });
}

async function createBookingForSession({ session, paymentIntentId, cabin, email = 'batch8@example.com' }) {
  return Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-10-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-10-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: `fp_b8_${session.checkoutId}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Eight',
      email,
      phone: '+359888000888'
    },
    legalAcceptance: {
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Eight',
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    },
    cabinId: cabin._id
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b8-allowlist-'));
});

test.after(async () => {
  restoreEnv();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test.beforeEach(async () => {
  restoreEnv();
  process.env.FINALIZE_RECONCILE_HISTORICAL = '0';
  process.env.FINALIZE_RECONCILE_ENQUEUE = '0';
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

test('flag FINALIZE_RECONCILE_HISTORICAL defaults off', () => {
  delete process.env.FINALIZE_RECONCILE_HISTORICAL;
  assert.equal(featureFlags.isFinalizeReconcileHistoricalEnabled(), false);
});

test('1) Dry-run performs no writes', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('dry.json', [
    { checkoutId: session.checkoutId, paymentIntentId, reason: 'dry-run' }
  ]);

  const beforeJobs = await CheckoutFinalizationJob.countDocuments({});
  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: false,
    stripe,
    limit: 10
  });

  assert.equal(summary.dryRun, true);
  assert.equal(summary.mutatedCount, 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), beforeJobs);
  const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(reloaded.paymentStatus, 'unpaid');
  assert.equal(stripe.calls.create, 0);
  assert.equal(stripe.calls.refunds, 0);
});

test('2) Execute without feature flag is rejected', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '0';
  const allowlist = writeAllowlist('noflag.json', [
    { checkoutId: 'chk_x', paymentIntentId: 'pi_x', reason: 'test' }
  ]);
  await assert.rejects(
    () =>
      recoverHistoricalPaidCheckouts({
        allowlistPath: allowlist,
        execute: true
      }),
    (err) => err instanceof HistoricalRecoveryError && err.code === 'HISTORICAL_FLAG_REQUIRED'
  );
});

test('3) Execute without allowlist is rejected', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  await assert.rejects(
    () =>
      recoverHistoricalPaidCheckouts({
        allowlistPath: null,
        execute: true
      }),
    (err) => err instanceof HistoricalRecoveryError && err.code === 'ALLOWLIST_REQUIRED'
  );
});

test('4) Only allowlisted entries are processed', async () => {
  const cabin = await createCabin();
  const a = await seedSession({ cabin, paymentStatus: 'paid' });
  const b = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({
    paymentIntentId: a.paymentIntentId,
    checkoutId: a.session.checkoutId
  });
  await createPaidPayment({
    paymentIntentId: b.paymentIntentId,
    checkoutId: b.session.checkoutId
  });

  const allowlist = writeAllowlist('only-a.json', [
    { checkoutId: a.session.checkoutId, paymentIntentId: a.paymentIntentId }
  ]);
  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: false,
    limit: 50
  });
  assert.equal(summary.processed, 1);
  assert.equal(summary.results[0].checkoutId, a.session.checkoutId);
  assert.ok(!summary.results.some((r) => r.checkoutId === b.session.checkoutId));
});

test('5) Malformed allowlist entries are rejected safely', () => {
  const allowlist = writeAllowlist('bad.json', [
    { reason: 'missing ids' },
    { checkoutId: 'chk_ok', paymentIntentId: 'pi_ok' }
  ]);
  assert.throws(
    () => loadAndValidateAllowlist(allowlist),
    (err) => err instanceof HistoricalRecoveryError && err.code === 'ALLOWLIST_VALIDATION_FAILED'
  );
});

test('6) Duplicate identical entries remain idempotent', () => {
  const allowlist = writeAllowlist('dup-identical.json', [
    { checkoutId: 'chk_same', paymentIntentId: 'pi_same', reason: 'one' },
    { checkoutId: 'chk_same', paymentIntentId: 'pi_same', reason: 'two' }
  ]);
  const loaded = loadAndValidateAllowlist(allowlist);
  assert.equal(loaded.entryCount, 1);
});

test('7) Conflicting duplicate entries are rejected', () => {
  const allowlist = writeAllowlist('dup-conflict.json', [
    { checkoutId: 'chk_same', paymentIntentId: 'pi_one' },
    { checkoutId: 'chk_same', paymentIntentId: 'pi_two' }
  ]);
  assert.throws(
    () => loadAndValidateAllowlist(allowlist),
    (err) =>
      err instanceof HistoricalRecoveryError &&
      err.code === 'ALLOWLIST_VALIDATION_FAILED' &&
      err.details.rejected.some((r) => r.code === 'CONFLICTING_DUPLICATE')
  );
});

test('8) Verified safe historical checkout is repaired through existing services', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('safe.json', [
    { checkoutId: session.checkoutId, paymentIntentId, reason: 'ops approved' }
  ]);

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe,
    limit: 5
  });

  assert.equal(summary.dryRun, false);
  assert.equal(summary.results[0].classification, RECONCILE_CLASSIFICATIONS.SESSION_NOT_MARKED_PAID);
  assert.equal(summary.results[0].mutated, true);
  const updated = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(updated.paymentStatus, 'paid');
  assert.equal(await CheckoutFinalizationJob.countDocuments({ checkoutId: session.checkoutId }), 1);
});

test('9) Existing Booking is adopted without duplication', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  const booking = await createBookingForSession({ session, paymentIntentId, cabin });
  await createPaidPayment({
    paymentIntentId,
    checkoutId: session.checkoutId
  });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId })
  });
  const allowlist = writeAllowlist('adopt.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);

  await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe,
    limit: 5
  });
  await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe,
    limit: 5
  });

  const bookings = await Booking.find({ checkoutId: session.checkoutId });
  assert.equal(bookings.length, 1);
  assert.equal(String(bookings[0]._id), String(booking._id));
  const activeJobs = await CheckoutFinalizationJob.find({
    checkoutId: session.checkoutId,
    status: { $in: ['scheduled', 'claimed'] }
  });
  assert.ok(activeJobs.length <= 1);
});

test('10) Missing or ambiguous evidence creates review state only', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  // No Payment row → missing evidence
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('missing-pay.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });

  assert.equal(
    summary.results[0].classification,
    RECONCILE_CLASSIFICATIONS.PAYMENT_RECORD_MISSING_OR_NOT_PAID
  );
  const sessionAfter = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(sessionAfter.paymentStatus, 'unpaid');
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
  assert.ok((await PaymentResolutionIssue.countDocuments({ paymentIntentId })) >= 1);
});

test('11) Amount/currency/entity/date mismatch is never mutated', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  pi.amount = 99999;
  pi.amount_received = 99999;
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('mismatch.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });
  assert.equal(summary.results[0].classification, RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH);
  assert.equal(
    (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).paymentStatus,
    'unpaid'
  );
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('12) Superseded or noncanonical PI is never recovered', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  const otherPi = `${paymentIntentId}_other`;
  await CheckoutSession.updateOne(
    { checkoutId: session.checkoutId },
    {
      $set: {
        canonicalPaymentIntentId: otherPi,
        supersededPaymentIntentIds: [paymentIntentId]
      }
    }
  );
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('super.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });
  assert.equal(
    summary.results[0].classification,
    RECONCILE_CLASSIFICATIONS.SUPERSEDED_OR_NONCANONICAL_PI
  );
  assert.equal(
    (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).paymentStatus,
    'unpaid'
  );
});

test('13) Gift voucher and location entries are excluded', async () => {
  const cabin = await createCabin();
  const gift = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({
    paymentIntentId: gift.paymentIntentId,
    checkoutId: gift.session.checkoutId,
    metadata: { type: 'gift_voucher' }
  });
  const loc = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({
    paymentIntentId: loc.paymentIntentId,
    checkoutId: loc.session.checkoutId,
    metadata: { locationKey: 'valley', propertyKind: 'valley' }
  });

  const allowlist = writeAllowlist('excl.json', [
    {
      checkoutId: gift.session.checkoutId,
      paymentIntentId: gift.paymentIntentId
    },
    {
      checkoutId: loc.session.checkoutId,
      paymentIntentId: loc.paymentIntentId
    }
  ]);

  const stripe = createStripeStub({
    [gift.paymentIntentId]: {
      id: gift.paymentIntentId,
      status: 'succeeded',
      metadata: { type: 'gift_voucher', checkoutId: gift.session.checkoutId }
    },
    [loc.paymentIntentId]: {
      id: loc.paymentIntentId,
      status: 'succeeded',
      metadata: {
        checkoutId: loc.session.checkoutId,
        locationKey: 'valley',
        propertyKind: 'valley'
      }
    }
  });

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: false,
    stripe
  });
  assert.equal(summary.processed, 2);
  assert.ok(
    summary.results.every(
      (r) => r.classification === RECONCILE_CLASSIFICATIONS.GIFT_VOUCHER_OR_LOCATION_EXCLUSION
    )
  );
});

test('14) Ambiguous email is not resent', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({
    cabin,
    paymentStatus: 'paid',
    finalizeStatus: FINALIZE_STATUS.FINALIZED
  });
  const booking = await createBookingForSession({
    session,
    paymentIntentId,
    cabin,
    email: 'batch8-amb@example.com'
  });
  await CheckoutSession.updateOne(
    { checkoutId: session.checkoutId },
    { $set: { bookingId: booking._id } }
  );
  await createPaidPayment({
    paymentIntentId,
    checkoutId: session.checkoutId,
    reservationId: booking._id
  });
  await CheckoutFinalizationJob.create({
    checkoutId: session.checkoutId,
    paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    attemptCount: 1,
    maxAttempts: 20,
    nextAttemptAt: new Date(),
    createdReason: 'reconcile',
    bookingId: booking._id
  });
  await EmailDeliveryState.create({
    correlationKey: `booking:${booking._id}:booking_confirmed:batch8-amb@example.com`,
    domain: 'booking_lifecycle',
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipient: 'batch8-amb@example.com',
    latestStatus: 'ambiguous',
    latestEventAt: new Date(),
    ambiguousAt: new Date(),
    ambiguousReason: 'AMBIGUOUS_SMTP_RETRY'
  });

  const allowlist = writeAllowlist('amb.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);
  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true
  });
  assert.equal(summary.results[0].classification, RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS);
  assert.equal(summary.results[0].emailResendAttempted, false);
  assert.equal(summary.results[0].mutated, false);
});

test('15–17) No refund, no PI create, no duplicate Booking/active job', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const stripe = createStripeStub({
    [paymentIntentId]: buildSucceededPi({ session, paymentIntentId })
  });
  const allowlist = writeAllowlist('hardban.json', [
    { checkoutId: session.checkoutId, paymentIntentId }
  ]);

  await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });
  await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });

  assert.equal(stripe.calls.create, 0);
  assert.equal(stripe.calls.refunds, 0);
  assert.equal(await Booking.countDocuments({ checkoutId: session.checkoutId }), 0);
  const active = await CheckoutFinalizationJob.countDocuments({
    checkoutId: session.checkoutId,
    status: { $in: ['scheduled', 'claimed'] }
  });
  assert.equal(active, 1);

  const src = fs.readFileSync(
    path.join(__dirname, '../services/checkout/historicalPaidCheckoutRecovery.js'),
    'utf8'
  );
  assert.doesNotMatch(src, /refunds\.create|paymentIntents\.create|Booking\.create/);
});

test('18) Partial run can be resumed safely', async () => {
  const cabin = await createCabin();
  const rows = [];
  for (let i = 0; i < 3; i += 1) {
    const seeded = await seedSession({ cabin, paymentStatus: 'paid' });
    await createPaidPayment({
      paymentIntentId: seeded.paymentIntentId,
      checkoutId: seeded.session.checkoutId
    });
    rows.push({
      checkoutId: seeded.session.checkoutId,
      paymentIntentId: seeded.paymentIntentId
    });
  }
  const allowlist = writeAllowlist('resume.json', rows);
  const checkpoint = path.join(tmpDir, 'checkpoint.json');

  const first = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: false,
    limit: 2,
    offset: 0,
    checkpointPath: checkpoint
  });
  assert.equal(first.processed, 2);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.exhausted, false);
  assert.equal(JSON.parse(fs.readFileSync(checkpoint, 'utf8')).nextOffset, 2);

  const second = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: false,
    limit: 2,
    offset: first.nextOffset,
    checkpointPath: checkpoint
  });
  assert.equal(second.processed, 1);
  assert.equal(second.exhausted, true);
  assert.equal(second.results[0].checkoutId, rows[2].checkoutId);
});

test('19) Output contains no guest PII, client_secret or full Stripe objects', async () => {
  process.env.FINALIZE_RECONCILE_HISTORICAL = '1';
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  await createPaidPayment({ paymentIntentId, checkoutId: session.checkoutId });
  const pi = buildSucceededPi({ session, paymentIntentId });
  const stripe = createStripeStub({ [paymentIntentId]: pi });
  const allowlist = writeAllowlist('redact.json', [
    {
      checkoutId: session.checkoutId,
      paymentIntentId,
      reason: 'contact batch8@example.com or +359888000888'
    }
  ]);

  const summary = await recoverHistoricalPaidCheckouts({
    allowlistPath: allowlist,
    execute: true,
    stripe
  });
  const text = JSON.stringify(summary);
  assert.doesNotMatch(text, /client_secret/i);
  assert.doesNotMatch(text, /pi_secret_/);
  assert.doesNotMatch(text, /batch8@example\.com/);
  assert.doesNotMatch(text, /\+359888000888/);
  assert.doesNotMatch(text, /"charges"/);
  assert.ok(summary.invariants.noGuestPiiInReport);
});

test('docs and example allowlist exist', () => {
  const docs = path.join(
    __dirname,
    '../../docs/checkout-payment-architecture/03_HISTORICAL_RECOVERY_CLI.md'
  );
  const example = path.join(
    __dirname,
    '../../docs/checkout-payment-architecture/examples/historical-recovery-allowlist.example.json'
  );
  assert.ok(fs.existsSync(docs));
  assert.ok(fs.existsSync(example));
  const parsed = JSON.parse(fs.readFileSync(example, 'utf8'));
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed[0].checkoutId.startsWith('chk_example_'));
  const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.doesNotMatch(serverSrc, /recoverHistoricalPaidCheckout|historicalPaidCheckoutRecovery/);
});
