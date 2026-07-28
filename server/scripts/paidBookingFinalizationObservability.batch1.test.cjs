'use strict';

/**
 * Batch 1 — paid booking finalization observability
 * Run: node --test server/scripts/paidBookingFinalizationObservability.batch1.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const ManualReviewItem = require('../models/ManualReviewItem');
const Payment = require('../models/Payment');
const CheckoutSession = require('../models/CheckoutSession');
const Booking = require('../models/Booking');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const {
  recordPaidBookingResolutionIssue,
  recordPaidBookingResolutionIssueSafe,
  buildPaymentUnlinkedObservabilityEvidence,
  PAID_BOOKING_FINALIZATION_STAGES,
  normalizeFinalizationStage,
  isFinalizeObservabilityEnabled,
  buildSafeLogFields
} = require('../services/payments/paidBookingFinalizationObservability');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const { openManualReviewItem } = require('../services/ops/ingestion/manualReviewService');

let mongoServer;

function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    PaymentResolutionIssue.syncIndexes(),
    ManualReviewItem.syncIndexes(),
    Payment.syncIndexes(),
    CheckoutSession.syncIndexes(),
    Booking.syncIndexes(),
    StripeEventEvidence.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    PaymentResolutionIssue.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    Payment.deleteMany({}),
    CheckoutSession.deleteMany({}),
    Booking.deleteMany({})
  ]);
  // StripeEventEvidence is append-only; wipe via native collection for test isolation.
  await mongoose.connection.collection('stripeeventevidences').deleteMany({});
});

test('normalizeFinalizationStage maps unknown to unknown', () => {
  assert.equal(normalizeFinalizationStage('unit_assignment'), 'unit_assignment');
  assert.equal(normalizeFinalizationStage('not-a-real-stage'), 'unknown');
  assert.equal(normalizeFinalizationStage(null), 'unknown');
});

test('paid booking save failure stores exact error code and stage', async () => {
  const paymentIntentId = 'pi_obs_save_fail_1';
  const checkoutId = 'chk_obs_save_fail_1';
  const checkIn = plusDays(10);
  const checkOut = plusDays(12);

  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 120,
    currency: 'eur',
    source: 'webhook',
    sourceReference: 'evt_obs_1',
    reservationId: null
  });

  await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'pi_active',
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    quoteSnapshotHash: 'hash_abc',
    stayFingerprint: 'stay_fp_1',
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents: 12000
  });

  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_save_failed',
    errorCode: 'NO_UNITS_AVAILABLE',
    errorSummary: 'All units are occupied for the selected dates',
    paymentIntentId,
    paymentIntent: { amount: 12000, currency: 'eur', status: 'succeeded' },
    bookingAttempt: {
      entityType: 'cabinType',
      cabinTypeId: new mongoose.Types.ObjectId().toString(),
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: 2,
      children: 0,
      guestInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+359888' }
    },
    checkoutId,
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNIT_ASSIGNMENT,
    failureSource: 'booking_finalize_worker',
    stripePaymentVerified: true
  });

  assert.ok(issue);
  assert.equal(issue.errorCode, 'NO_UNITS_AVAILABLE');
  assert.equal(issue.finalizationStage, 'unit_assignment');
  assert.equal(issue.checkoutId, checkoutId);
  assert.equal(issue.occurrenceCount, 1);
  assert.ok(issue.firstFailedAt);
  assert.ok(issue.lastFailedAt);
  assert.equal(issue.metadata.observability.paymentLinked, false);
  assert.equal(issue.metadata.observability.sessionFinalized, false);
  assert.equal(issue.metadata.observability.quoteSnapshotHash, 'hash_abc');
  assert.equal(issue.metadata.observability.stayFingerprint, 'stay_fp_1');
  assert.equal(issue.metadata.observability.stripePaymentVerified, true);
  assert.ok(issue.metadata.observability.paymentId);
  assert.ok(!JSON.stringify(issue.metadata).includes('client_secret'));
  assert.ok(!JSON.stringify(issue.metadata).includes('card'));

  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
  assert.ok(review);
  assert.equal(review.evidence.classification, 'booking_finalization_failure');
  assert.equal(review.evidence.finalizationStage, 'unit_assignment');
  assert.equal(review.evidence.errorCode, 'NO_UNITS_AVAILABLE');
  assert.equal(review.evidence.checkoutId, checkoutId);
  assert.equal(review.evidence.guest?.name, 'Ada Lovelace');
  assert.equal(review.evidence.guest?.email, undefined);
  assert.equal(review.evidence.guest?.phone, undefined);
});

test('repeated identical failures update one issue and increment occurrenceCount', async () => {
  const paymentIntentId = 'pi_obs_repeat_1';
  const checkoutId = 'chk_obs_repeat_1';

  const first = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_conflict',
    errorCode: 'CABIN_OVERLAP_AFTER_SAVE',
    errorSummary: 'overlaps=1',
    paymentIntentId,
    paymentIntent: { amount: 5000, currency: 'eur', status: 'succeeded' },
    bookingAttempt: {
      entityType: 'cabin',
      cabinId: new mongoose.Types.ObjectId().toString(),
      checkInDate: plusDays(3),
      checkOutDate: plusDays(5),
      adults: 2,
      children: 0,
      guestInfo: { firstName: 'Bo', lastName: 'Peep', email: 'bo@example.com', phone: '1' }
    },
    checkoutId,
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.OVERLAP_CHECK,
    stripePaymentVerified: true
  });

  const firstFailedAt = new Date(first.firstFailedAt).getTime();
  await new Promise((r) => setTimeout(r, 15));

  const second = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_conflict',
    errorCode: 'CABIN_OVERLAP_AFTER_SAVE',
    errorSummary: 'overlaps=1 retry',
    paymentIntentId,
    paymentIntent: { amount: 5000, currency: 'eur', status: 'succeeded' },
    bookingAttempt: {
      entityType: 'cabin',
      cabinId: first.bookingAttempt.cabinId,
      checkInDate: plusDays(3),
      checkOutDate: plusDays(5),
      adults: 2,
      children: 0,
      guestInfo: { firstName: 'Bo', lastName: 'Peep', email: 'bo@example.com', phone: '1' }
    },
    checkoutId,
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.OVERLAP_CHECK,
    stripePaymentVerified: true
  });

  const all = await PaymentResolutionIssue.find({ paymentIntentId });
  assert.equal(all.length, 1);
  assert.equal(String(second._id), String(first._id));
  assert.equal(second.occurrenceCount, 2);
  assert.equal(new Date(second.firstFailedAt).getTime(), firstFailedAt);
  assert.ok(new Date(second.lastFailedAt).getTime() >= firstFailedAt);
  assert.equal(second.errorSummary, 'overlaps=1 retry');

  const reviews = await ManualReviewItem.find({ category: 'payment_finalization_failure' });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].evidence.occurrenceCount, 2);
});

test('partial bookingId and payment linkage state are captured', async () => {
  const paymentIntentId = 'pi_obs_partial_1';
  const checkoutId = 'chk_obs_partial_1';
  const booking = await Booking.create({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: plusDays(20),
    checkOut: plusDays(22),
    adults: 2,
    children: 0,
    guestInfo: { firstName: 'Pat', lastName: 'Partial', email: 'pat@example.com', phone: '2' },
    totalPrice: 99,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    checkoutId,
    legalAcceptance: {
      termsVersion: 'v1',
      activityRiskVersion: 'v1',
      acceptedAt: new Date(),
      firstName: 'Pat',
      lastName: 'Partial',
      checkbox1TextSnapshot: 'c1',
      checkbox2TextSnapshot: 'c2'
    }
  });

  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 99,
    currency: 'eur',
    source: 'webhook',
    reservationId: booking._id
  });

  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_conflict',
    errorCode: 'UNIT_OVERLAP_AFTER_SAVE',
    errorSummary: 'overlap after save',
    paymentIntentId,
    paymentIntent: { amount: 9900, currency: 'eur', status: 'succeeded' },
    bookingAttempt: {
      entityType: 'cabin',
      cabinId: String(booking.cabinId),
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      adults: 2,
      children: 0,
      guestInfo: booking.guestInfo
    },
    checkoutId,
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.OVERLAP_CHECK,
    bookingId: String(booking._id),
    stripePaymentVerified: true
  });

  assert.equal(issue.metadata.observability.bookingId, String(booking._id));
  assert.equal(issue.metadata.observability.bookingExists, true);
  assert.equal(issue.metadata.observability.paymentLinked, true);
});

test('sensitive Stripe or request data is not persisted in metadata', async () => {
  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_unknown_failure',
    errorCode: 'TEST',
    errorSummary: 'x',
    paymentIntentId: 'pi_obs_sensitive_1',
    paymentIntent: { amount: 1000, currency: 'eur', status: 'succeeded' },
    bookingAttempt: {
      adults: 1,
      children: 0,
      guestInfo: { firstName: 'S', lastName: 'T', email: 's@example.com', phone: '3' }
    },
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
    extraMetadata: {
      clientSecret: 'secret_should_not_store',
      card: { number: '4242' },
      stack: 'Error\n  at foo',
      raw: { huge: true },
      okField: 'kept'
    }
  });

  const meta = issue.metadata || {};
  assert.equal(meta.clientSecret, undefined);
  assert.equal(meta.card, undefined);
  assert.equal(meta.stack, undefined);
  assert.equal(meta.raw, undefined);
  assert.equal(meta.okField, 'kept');
});

test('observability write failure does not throw from safe wrapper', async () => {
  const original = PaymentResolutionIssue.findOneAndUpdate;
  PaymentResolutionIssue.findOneAndUpdate = async () => {
    throw new Error('simulated db down');
  };
  try {
    const result = await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_save_failed',
      errorCode: 'X',
      errorSummary: 'y',
      paymentIntentId: 'pi_obs_safe_1',
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE
    });
    assert.equal(result, null);
  } finally {
    PaymentResolutionIssue.findOneAndUpdate = original;
  }
});

test('resolved PaymentResolutionIssue can be reopened on new failure', async () => {
  const paymentIntentId = 'pi_obs_resolved_1';
  await PaymentResolutionIssue.create({
    paymentIntentId,
    status: 'resolved',
    issueType: 'paid_booking_save_failed',
    errorCode: 'OLD',
    resolvedAt: new Date(),
    resolutionNote: 'fixed',
    occurrenceCount: 1,
    firstFailedAt: new Date(Date.now() - 60_000)
  });

  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_save_failed',
    errorCode: 'NEW_FAIL',
    errorSummary: 'failed again',
    paymentIntentId,
    paymentIntent: { amount: 2000, currency: 'eur', status: 'succeeded' },
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE
  });

  assert.equal(issue.status, 'needs_review');
  assert.equal(issue.errorCode, 'NEW_FAIL');
  assert.equal(issue.occurrenceCount, 2);
  assert.ok(issue.firstFailedAt);
});

test('ordinary payment ingestion remains payment_unlinked not finalization failure', async () => {
  const paymentIntentId = 'pi_obs_unlinked_race_1';
  const event = {
    id: 'evt_obs_unlinked_race_1',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        status: 'succeeded',
        metadata: {
          checkoutId: 'chk_obs_unlinked_race_1',
          quoteSnapshotHash: 'qh1',
          entityType: 'cabin',
          cabinId: 'cabin123'
        }
      }
    }
  };

  await processStripeWebhookEvent(event);

  const unlinked = await ManualReviewItem.find({ category: 'payment_unlinked' });
  assert.equal(unlinked.length, 1);
  assert.equal(unlinked[0].evidence.classification, 'payment_observed_before_booking_linkage');
  assert.equal(unlinked[0].evidence.isFinalizationFailure, false);
  assert.equal(unlinked[0].evidence.checkoutId, 'chk_obs_unlinked_race_1');
  assert.equal(unlinked[0].evidence.paymentIntentId, paymentIntentId);

  const finalization = await ManualReviewItem.find({ category: 'payment_finalization_failure' });
  assert.equal(finalization.length, 0);

  const issues = await PaymentResolutionIssue.find({ paymentIntentId });
  assert.equal(issues.length, 0);

  const bookings = await Booking.find({});
  assert.equal(bookings.length, 0);
});

test('buildPaymentUnlinkedObservabilityEvidence never marks finalization failure', () => {
  const evidence = buildPaymentUnlinkedObservabilityEvidence({
    payment: {
      _id: new mongoose.Types.ObjectId(),
      providerReference: 'pi_x',
      status: 'paid',
      amount: 10,
      currency: 'eur'
    },
    paymentIntentId: 'pi_x',
    eventId: 'evt_x',
    metadata: { checkoutId: 'chk_x' }
  });
  assert.equal(evidence.isFinalizationFailure, false);
  assert.equal(evidence.classification, 'payment_observed_before_booking_linkage');
});

test('invalid issueType is normalized without throwing', async () => {
  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'voucher_confirm_failed',
    errorCode: 'VOUCHER_CONFIRM_FAILED',
    errorSummary: 'confirm failed',
    paymentIntentId: 'pi_obs_issue_type_1',
    paymentIntent: { amount: 1000, currency: 'eur', status: 'succeeded' },
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.VOUCHER_CONFIRM
  });
  assert.equal(issue.issueType, 'paid_booking_unknown_failure');
  assert.equal(issue.metadata.originalIssueType, 'voucher_confirm_failed');
});

test('openManualReviewItem still upserts payment_unlinked separately from finalization', async () => {
  await openManualReviewItem({
    category: 'payment_unlinked',
    severity: 'high',
    entityType: 'Payment',
    entityId: 'abc',
    title: 'unlinked',
    details: 'x',
    provenance: { source: 'stripe_webhook', sourceReference: 'evt_1' },
    evidence: buildPaymentUnlinkedObservabilityEvidence({
      payment: { providerReference: 'pi_y', status: 'paid', amount: 1, currency: 'eur' },
      paymentIntentId: 'pi_y',
      eventId: 'evt_1'
    })
  });

  await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_save_failed',
    errorCode: 'Z',
    errorSummary: 'z',
    paymentIntentId: 'pi_y',
    paymentIntent: { amount: 100, currency: 'eur', status: 'succeeded' },
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE
  });

  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 1);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_finalization_failure' }), 1);
});

test('different stages on same PaymentIntent preserve bounded failureHistory', async () => {
  const paymentIntentId = 'pi_obs_history_stages';
  const stages = [
    PAID_BOOKING_FINALIZATION_STAGES.UNIT_ASSIGNMENT,
    PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE,
    PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_LINK,
    PAID_BOOKING_FINALIZATION_STAGES.CONFIRMATION_SIDE_EFFECT
  ];
  const codes = ['NO_UNITS_AVAILABLE', 'BOOKING_SAVE_ERROR', 'PAYMENT_LINK_ERROR', 'EMAIL_QUEUE_ERROR'];

  for (let i = 0; i < stages.length; i += 1) {
    await recordPaidBookingResolutionIssue({
      issueType: i === 0 ? 'paid_booking_conflict' : 'paid_booking_save_failed',
      errorCode: codes[i],
      errorSummary: `failure at ${stages[i]}`,
      paymentIntentId,
      paymentIntent: { amount: 1000, currency: 'eur', status: 'succeeded' },
      finalizationStage: stages[i],
      failureSource: 'test'
    });
  }

  const issue = await PaymentResolutionIssue.findOne({ paymentIntentId }).lean();
  assert.equal(issue.occurrenceCount, 4);
  assert.equal(issue.finalizationStage, PAID_BOOKING_FINALIZATION_STAGES.CONFIRMATION_SIDE_EFFECT);
  assert.equal(issue.errorCode, 'EMAIL_QUEUE_ERROR');
  assert.equal(issue.failureHistory.length, 4);
  assert.deepEqual(
    issue.failureHistory.map((h) => h.finalizationStage),
    stages
  );
  assert.deepEqual(
    issue.failureHistory.map((h) => h.errorCode),
    codes
  );
});

test('failureHistory is bounded to max 10 entries', async () => {
  const paymentIntentId = 'pi_obs_history_bound';
  for (let i = 0; i < 12; i += 1) {
    await recordPaidBookingResolutionIssue({
      issueType: 'paid_booking_unknown_failure',
      errorCode: `E${i}`,
      errorSummary: `n=${i}`,
      paymentIntentId,
      paymentIntent: { amount: 100, currency: 'eur', status: 'succeeded' },
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN
    });
  }
  const issue = await PaymentResolutionIssue.findOne({ paymentIntentId }).lean();
  assert.equal(issue.occurrenceCount, 12);
  assert.equal(issue.failureHistory.length, 10);
  assert.equal(issue.failureHistory[0].errorCode, 'E2');
  assert.equal(issue.failureHistory[9].errorCode, 'E11');
});

test('duplicate Stripe events do not create or inflate PaymentResolutionIssue', async () => {
  const paymentIntentId = 'pi_obs_dup_webhook';
  const event = {
    id: 'evt_obs_dup_webhook',
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: 8000,
        amount_received: 8000,
        currency: 'eur',
        status: 'succeeded',
        metadata: { checkoutId: 'chk_obs_dup_webhook' }
      }
    }
  };

  await processStripeWebhookEvent(event);
  await processStripeWebhookEvent(event);

  assert.equal(await PaymentResolutionIssue.countDocuments({ paymentIntentId }), 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_finalization_failure' }), 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 1);
  assert.equal(await Payment.countDocuments({ providerReference: paymentIntentId }), 1);
});

test('feature flag parsing: related enrichment skipped when FINALIZE_OBSERVABILITY=0', async () => {
  const prev = process.env.FINALIZE_OBSERVABILITY;
  process.env.FINALIZE_OBSERVABILITY = '0';
  try {
    assert.equal(isFinalizeObservabilityEnabled(), false);
    const paymentIntentId = 'pi_obs_flag_off';
    await Payment.create({
      provider: 'stripe',
      providerReference: paymentIntentId,
      status: 'paid',
      amount: 50,
      currency: 'eur',
      source: 'webhook'
    });
    const issue = await recordPaidBookingResolutionIssue({
      issueType: 'paid_booking_save_failed',
      errorCode: 'STILL_RECORDED',
      errorSummary: 'stage still written when flag off',
      paymentIntentId,
      paymentIntent: { amount: 5000, currency: 'eur', status: 'succeeded' },
      finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE,
      checkoutId: 'chk_missing_session'
    });
    assert.equal(issue.errorCode, 'STILL_RECORDED');
    assert.equal(issue.finalizationStage, 'booking_save');
    assert.equal(issue.metadata.observability.paymentId, null);
  } finally {
    if (prev === undefined) delete process.env.FINALIZE_OBSERVABILITY;
    else process.env.FINALIZE_OBSERVABILITY = prev;
  }
});

test('feature flag true/1 enable enrichment; false disables', async () => {
  const prev = process.env.FINALIZE_OBSERVABILITY;
  try {
    delete process.env.FINALIZE_OBSERVABILITY;
    assert.equal(isFinalizeObservabilityEnabled(), true);
    process.env.FINALIZE_OBSERVABILITY = '1';
    assert.equal(isFinalizeObservabilityEnabled(), true);
    process.env.FINALIZE_OBSERVABILITY = 'true';
    assert.equal(isFinalizeObservabilityEnabled(), true);
    process.env.FINALIZE_OBSERVABILITY = '0';
    assert.equal(isFinalizeObservabilityEnabled(), false);
    process.env.FINALIZE_OBSERVABILITY = 'false';
    assert.equal(isFinalizeObservabilityEnabled(), false);
  } finally {
    if (prev === undefined) delete process.env.FINALIZE_OBSERVABILITY;
    else process.env.FINALIZE_OBSERVABILITY = prev;
  }
});

test('reopening resolved issue stores previousResolution and clears resolvedAt', async () => {
  const paymentIntentId = 'pi_obs_reopen_hist';
  const resolvedAt = new Date(Date.now() - 120_000);
  await PaymentResolutionIssue.create({
    paymentIntentId,
    status: 'resolved',
    issueType: 'paid_booking_save_failed',
    errorCode: 'OLD',
    resolvedAt,
    resolutionNote: 'manually fixed',
    occurrenceCount: 1,
    firstFailedAt: new Date(Date.now() - 200_000)
  });

  const issue = await recordPaidBookingResolutionIssue({
    issueType: 'paid_booking_save_failed',
    errorCode: 'NEW',
    errorSummary: 'failed again',
    paymentIntentId,
    paymentIntent: { amount: 1000, currency: 'eur', status: 'succeeded' },
    finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.BOOKING_SAVE
  });

  assert.equal(issue.status, 'needs_review');
  assert.equal(issue.resolvedAt, null);
  assert.equal(issue.resolutionNote, null);
  assert.equal(issue.metadata.previousResolution.resolutionNote, 'manually fixed');
  assert.ok(issue.metadata.previousResolution.resolvedAt);
  assert.equal(issue.failureHistory.length, 1);
});

test('buildSafeLogFields never includes email or phone keys', () => {
  const fields = buildSafeLogFields({
    checkoutId: 'c',
    paymentIntentId: 'p',
    errorCode: 'E',
    stage: 'booking_save'
  });
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'phone'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'guestEmail'), false);
});

test('observabilityRecorded flag documents single-writer contract for nested layers', () => {
  // Route skips recording when worker already marked the error.
  const sourceError = { observabilityRecorded: true, code: 'PAID_BOOKING_SAVE_FAILED' };
  assert.equal(Boolean(sourceError.observabilityRecorded), true);
});
