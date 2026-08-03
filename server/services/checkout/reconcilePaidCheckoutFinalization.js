'use strict';

/**
 * Batch 7 — Paid checkout reconciliation / operational repair.
 *
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md
 *
 * Dry-run by default. Mutations require FINALIZE_RECONCILE_ENQUEUE=1 AND execute=true.
 * Reuses existing services only — never duplicates Booking/payment/finalization logic.
 * Does not run from server startup. Batch 8 historical recovery is a separate
 * allowlist CLI that calls reconcilePaidCheckoutSubject with mutationFlag=historical.
 */

const Stripe = require('stripe');
const featureFlags = require('../../utils/featureFlags');
const CheckoutSession = require('../../models/CheckoutSession');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const Booking = require('../../models/Booking');
const Payment = require('../../models/Payment');
const EmailDeliveryState = require('../../models/EmailDeliveryState');
const {
  verifyAccommodationPaymentSuccess,
  markCheckoutSessionPaid,
  isGiftVoucherPaymentIntent,
  VERIFICATION_ERROR_CODES
} = require('./paidCheckoutWebhookSyncService');
const {
  ensureCheckoutFinalizationJob,
  findPreservedJobForCheckout,
  reclaimStaleClaimedCheckoutFinalizationJob,
  markCheckoutFinalizationJobSucceeded,
  INCOMPLETE_RECOVERY_STATUSES
} = require('./checkoutFinalizationJobService');
const { finalizePaidCheckout } = require('./finalizePaidCheckout');
const { createDefaultDependencies } = require('./executeBookingFinalizeWork');
const { runCheckoutFinalizeSideEffects } = require('./checkoutFinalizeSideEffects');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES,
  safeErrorSummary
} = require('../payments/paidBookingFinalizationObservability');
const { isDefinitiveSentStatus } = require('../../models/EmailDeliveryState');
const { FINALIZE_STATUS } = require('./checkoutFinalizeService');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const RESULT_HISTORY_MAX = 50;

const RECONCILE_CLASSIFICATIONS = Object.freeze({
  SESSION_NOT_MARKED_PAID: 'SESSION_NOT_MARKED_PAID',
  SESSION_PAID_NO_JOB: 'SESSION_PAID_NO_JOB',
  JOB_ACTIVE_OR_RETRYABLE: 'JOB_ACTIVE_OR_RETRYABLE',
  JOB_SUCCEEDED_SESSION_NOT_FINALIZED: 'JOB_SUCCEEDED_SESSION_NOT_FINALIZED',
  BOOKING_EXISTS_LINKAGE_INCOMPLETE: 'BOOKING_EXISTS_LINKAGE_INCOMPLETE',
  BOOKING_EXISTS_BY_CHECKOUT_ID: 'BOOKING_EXISTS_BY_CHECKOUT_ID',
  BOOKING_EXISTS_BY_PAYMENT_INTENT_ID: 'BOOKING_EXISTS_BY_PAYMENT_INTENT_ID',
  SESSION_FINALIZED_JOB_NOT_SUCCEEDED: 'SESSION_FINALIZED_JOB_NOT_SUCCEEDED',
  PAID_SESSION_EXPIRED: 'PAID_SESSION_EXPIRED',
  SUPERSEDED_OR_NONCANONICAL_PI: 'SUPERSEDED_OR_NONCANONICAL_PI',
  VERIFICATION_MISMATCH: 'VERIFICATION_MISMATCH',
  PAYMENT_RECORD_MISSING_OR_NOT_PAID: 'PAYMENT_RECORD_MISSING_OR_NOT_PAID',
  PERMANENT_FINALIZATION_FAILURE: 'PERMANENT_FINALIZATION_FAILURE',
  RETRYABLE_FINALIZATION_FAILURE: 'RETRYABLE_FINALIZATION_FAILURE',
  CONFIRMATION_PENDING_OR_FAILED: 'CONFIRMATION_PENDING_OR_FAILED',
  CONFIRMATION_AMBIGUOUS: 'CONFIRMATION_AMBIGUOUS',
  GIFT_VOUCHER_OR_LOCATION_EXCLUSION: 'GIFT_VOUCHER_OR_LOCATION_EXCLUSION',
  ALREADY_FULLY_CONSISTENT: 'ALREADY_FULLY_CONSISTENT'
});

const UNSAFE_MISMATCH_CODES = new Set([
  VERIFICATION_ERROR_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
  VERIFICATION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
  VERIFICATION_ERROR_CODES.AMOUNT_MISMATCH,
  VERIFICATION_ERROR_CODES.CURRENCY_MISMATCH,
  VERIFICATION_ERROR_CODES.DATE_MISMATCH,
  VERIFICATION_ERROR_CODES.ENTITY_MISMATCH,
  VERIFICATION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT,
  VERIFICATION_ERROR_CODES.NONCANONICAL_PAYMENT_INTENT
]);

const ACTIVE_JOB_STATUSES = new Set(['scheduled', 'claimed', 'failed_retryable']);

function isReconcileEnqueueEnabled() {
  return featureFlags.isFinalizeReconcileEnqueueEnabled();
}

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now);
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

function redactSummary(value, max = 500) {
  let s = value == null ? '' : String(value);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  s = s.replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, '[redacted-secret]');
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function buildSyntheticSucceededEvent(pi, stripeEventId = null) {
  const id =
    stripeEventId ||
    `reconcile_${String(pi?.id || 'unknown')}_${Date.now().toString(36)}`;
  return {
    id,
    type: 'payment_intent.succeeded',
    data: { object: pi }
  };
}

function getStripeClient(stripeOverride = null) {
  if (stripeOverride) return stripeOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function retrievePaymentIntent(stripe, paymentIntentId) {
  const piId = String(paymentIntentId || '').trim();
  if (!stripe?.paymentIntents?.retrieve || !piId) return null;
  return stripe.paymentIntents.retrieve(piId);
}

function isLocationPaymentMetadata(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.type === 'location' || meta.type === 'valley' || meta.type === 'location_retreat') {
    return true;
  }
  if (meta.locationKey || meta.locationBookingId) return true;
  if (String(meta.propertyKind || '').toLowerCase() === 'valley') return true;
  return false;
}

function paymentLooksGiftOrLocation(payment, pi) {
  if (isGiftVoucherPaymentIntent(pi)) return true;
  if (isGiftVoucherPaymentIntent({ metadata: payment?.metadata })) return true;
  if (isLocationPaymentMetadata(pi?.metadata)) return true;
  if (isLocationPaymentMetadata(payment?.metadata)) return true;
  return false;
}

async function loadPaymentByIntentId(paymentIntentId) {
  const piId = String(paymentIntentId || '').trim();
  if (!piId) return null;
  return Payment.findOne({ provider: 'stripe', providerReference: piId }).lean();
}

async function loadConfirmationState(booking) {
  if (!booking?._id) return null;
  if (booking.confirmationEmailSentAt) {
    return { latestStatus: 'succeeded', adoptedFromBooking: true };
  }
  const rows = await EmailDeliveryState.find({
    bookingId: booking._id,
    domain: 'booking_lifecycle',
    templateKey: { $in: ['booking_confirmed', 'booking_received'] }
  })
    .sort({ latestEventAt: -1 })
    .limit(5)
    .lean();
  if (!rows.length) return null;
  const ambiguous = rows.find((r) => r.latestStatus === 'ambiguous');
  if (ambiguous) return ambiguous;
  const pendingOrFailed = rows.find((r) =>
    ['pending', 'failed', 'sending'].includes(r.latestStatus)
  );
  if (pendingOrFailed) return pendingOrFailed;
  return rows[0];
}

/**
 * Inspect a single checkout/PI subject and classify.
 */
async function inspectPaidCheckoutSubject({
  checkoutId = null,
  paymentIntentId = null,
  stripe = null,
  paymentIntent = null,
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  const stripeClient = getStripeClient(stripe);
  let session = null;
  let checkoutKey = checkoutId ? String(checkoutId).trim() : '';
  let piId = paymentIntentId ? String(paymentIntentId).trim() : '';

  if (checkoutKey) {
    session = await CheckoutSession.findOne({ checkoutId: checkoutKey }).lean();
  }
  if (!session && piId) {
    session = await CheckoutSession.findOne({ canonicalPaymentIntentId: piId }).lean();
    if (session) checkoutKey = session.checkoutId;
  }

  if (session && !piId) {
    piId = String(session.canonicalPaymentIntentId || '').trim();
  }

  const payment = piId ? await loadPaymentByIntentId(piId) : null;
  if (!checkoutKey && payment?.metadata?.checkoutId) {
    checkoutKey = String(payment.metadata.checkoutId).trim();
    if (!session && checkoutKey) {
      session = await CheckoutSession.findOne({ checkoutId: checkoutKey }).lean();
    }
  }

  let pi = paymentIntent || null;
  if (!pi && piId && stripeClient) {
    try {
      pi = await retrievePaymentIntent(stripeClient, piId);
    } catch (err) {
      pi = null;
      // Keep going with local evidence; Stripe retrieve failure is retryable ops noise.
      void err;
    }
  }

  const bookingByCheckout = checkoutKey
    ? await Booking.findOne({ checkoutId: checkoutKey }).lean()
    : null;
  const bookingByPi = piId
    ? await Booking.findOne({ stripePaymentIntentId: piId }).lean()
    : null;
  const booking =
    bookingByCheckout ||
    bookingByPi ||
    (session?.bookingId ? await Booking.findById(session.bookingId).lean() : null);

  const job = checkoutKey ? await findPreservedJobForCheckout(checkoutKey) : null;
  const confirmation = await loadConfirmationState(booking);

  const base = {
    checkoutId: checkoutKey || null,
    paymentIntentId: piId || null,
    inspectedAt: at.toISOString(),
    session: session
      ? {
          paymentStatus: session.paymentStatus,
          finalizeStatus: session.finalizeStatus,
          status: session.status,
          flowVersion: session.flowVersion,
          expiresAt: session.expiresAt || null,
          bookingId: session.bookingId ? String(session.bookingId) : null,
          canonicalPaymentIntentId: session.canonicalPaymentIntentId || null
        }
      : null,
    payment: payment
      ? {
          id: String(payment._id),
          status: payment.status,
          reservationId: payment.reservationId ? String(payment.reservationId) : null
        }
      : null,
    job: job
      ? {
          id: String(job._id),
          status: job.status,
          stage: job.stage,
          attemptCount: job.attemptCount,
          lastErrorCode: job.lastErrorCode || null
        }
      : null,
    booking: booking
      ? {
          id: String(booking._id),
          status: booking.status,
          checkoutId: booking.checkoutId || null,
          stripePaymentIntentId: booking.stripePaymentIntentId || null,
          confirmationEmailSentAt: booking.confirmationEmailSentAt || null,
          foundByCheckoutId: Boolean(bookingByCheckout),
          foundByPaymentIntentId: Boolean(bookingByPi)
        }
      : null,
    confirmation: confirmation
      ? {
          latestStatus: confirmation.latestStatus,
          correlationKey: confirmation.correlationKey || null
        }
      : null,
    stripePaymentIntentStatus: pi?.status || null,
    failureStage: null,
    safeToMutate: false,
    repairAction: 'none'
  };

  // 17 — exclusions
  if (paymentLooksGiftOrLocation(payment, pi)) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.GIFT_VOUCHER_OR_LOCATION_EXCLUSION,
      reason: 'Gift voucher or location payment excluded from accommodation reconcile'
    };
  }
  if (session && session.flowVersion !== 'v2') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.GIFT_VOUCHER_OR_LOCATION_EXCLUSION,
      reason: 'CheckoutSession is not V2 accommodation flow'
    };
  }
  if (!session && pi?.metadata && !pi.metadata.checkoutId) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.GIFT_VOUCHER_OR_LOCATION_EXCLUSION,
      reason: 'No accommodation checkoutId on PaymentIntent metadata'
    };
  }

  // Verify against Stripe when PI is available
  let verification = null;
  if (pi && String(pi.status || '').toLowerCase() === 'succeeded' && session) {
    verification = await verifyAccommodationPaymentSuccess({
      event: buildSyntheticSucceededEvent(pi),
      payment
    });
    if (!verification.ok && !verification.skipped) {
      if (
        verification.errorCode === VERIFICATION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT ||
        verification.errorCode === VERIFICATION_ERROR_CODES.NONCANONICAL_PAYMENT_INTENT
      ) {
        return {
          ...base,
          classification: RECONCILE_CLASSIFICATIONS.SUPERSEDED_OR_NONCANONICAL_PI,
          reason: verification.errorSummary,
          failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
          errorCode: verification.errorCode,
          safeToMutate: false,
          repairAction: 'open_manual_review'
        };
      }
      if (UNSAFE_MISMATCH_CODES.has(verification.errorCode)) {
        return {
          ...base,
          classification: RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH,
          reason: verification.errorSummary,
          failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
          errorCode: verification.errorCode,
          safeToMutate: false,
          repairAction: 'open_manual_review'
        };
      }
      if (verification.errorCode === VERIFICATION_ERROR_CODES.PAYMENT_RECORD_NOT_PAID) {
        return {
          ...base,
          classification: RECONCILE_CLASSIFICATIONS.PAYMENT_RECORD_MISSING_OR_NOT_PAID,
          reason: verification.errorSummary,
          failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
          errorCode: verification.errorCode,
          safeToMutate: false,
          repairAction: 'open_manual_review'
        };
      }
    }
  }

  if (piId && !payment) {
    // If Stripe says succeeded we still need a paid Payment row for safe mark-paid.
    if (pi && String(pi.status || '').toLowerCase() === 'succeeded') {
      return {
        ...base,
        classification: RECONCILE_CLASSIFICATIONS.PAYMENT_RECORD_MISSING_OR_NOT_PAID,
        reason: 'Canonical Payment record is missing',
        failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
        safeToMutate: false,
        repairAction: 'open_manual_review'
      };
    }
  } else if (payment && payment.status !== 'paid') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.PAYMENT_RECORD_MISSING_OR_NOT_PAID,
      reason: `Payment status is ${payment.status}`,
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_VERIFIED,
      safeToMutate: false,
      repairAction: 'open_manual_review'
    };
  }

  if (job?.status === 'failed_permanent') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.PERMANENT_FINALIZATION_FAILURE,
      reason: job.lastErrorCode || 'CheckoutFinalizationJob failed_permanent',
      failureStage: job.stage || PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
      errorCode: job.lastErrorCode || 'FINALIZE_JOB_FAILED_PERMANENT',
      safeToMutate: false,
      repairAction: 'open_manual_review'
    };
  }

  const sessionPaid = session && String(session.paymentStatus || '') === 'paid';
  const sessionFinalized =
    session && String(session.finalizeStatus || '') === FINALIZE_STATUS.FINALIZED;
  const paymentLinked =
    Boolean(payment?.reservationId) &&
    booking &&
    String(payment.reservationId) === String(booking._id);
  const jobSucceeded = job?.status === 'succeeded';
  const confirmationOk =
    !booking ||
    Boolean(booking.confirmationEmailSentAt) ||
    isDefinitiveSentStatus(confirmation?.latestStatus) ||
    !confirmation;

  if (
    sessionPaid &&
    sessionFinalized &&
    jobSucceeded &&
    booking &&
    paymentLinked &&
    confirmationOk
  ) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.ALREADY_FULLY_CONSISTENT,
      reason: 'Checkout, job, booking, payment linkage and confirmation are consistent',
      safeToMutate: false,
      repairAction: 'none'
    };
  }

  // Confirmation-only issues when booking+session already finalized
  if (sessionFinalized && booking && confirmation?.latestStatus === 'ambiguous') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS,
      reason: 'Confirmation delivery is ambiguous; automatic resend suppressed',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.CONFIRMATION_SIDE_EFFECT,
      safeToMutate: false,
      repairAction: 'none'
    };
  }
  if (
    sessionFinalized &&
    booking &&
    !booking.confirmationEmailSentAt &&
    confirmation &&
    ['pending', 'failed', 'sending'].includes(confirmation.latestStatus)
  ) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.CONFIRMATION_PENDING_OR_FAILED,
      reason: `Confirmation delivery status=${confirmation.latestStatus}`,
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.CONFIRMATION_SIDE_EFFECT,
      safeToMutate: true,
      repairAction: 'repair_side_effects'
    };
  }

  const stripeSucceeded =
    (pi && String(pi.status || '').toLowerCase() === 'succeeded') ||
    (payment && payment.status === 'paid');

  if (session && stripeSucceeded && !sessionPaid) {
    const canMark =
      verification?.ok === true ||
      (payment?.status === 'paid' &&
        String(session.canonicalPaymentIntentId || '') === piId);
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.SESSION_NOT_MARKED_PAID,
      reason: 'Stripe-succeeded PaymentIntent but CheckoutSession is not marked paid',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_INGESTED,
      safeToMutate: canMark,
      repairAction: canMark ? 'mark_paid_and_ensure_job' : 'open_manual_review',
      verificationOk: verification?.ok === true
    };
  }

  if (sessionPaid && !job) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.SESSION_PAID_NO_JOB,
      reason: 'Session is paid but CheckoutFinalizationJob is missing',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_INGESTED,
      safeToMutate: true,
      repairAction: 'ensure_job'
    };
  }

  if (job?.status === 'failed_retryable') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.RETRYABLE_FINALIZATION_FAILURE,
      reason: job.lastErrorCode || 'CheckoutFinalizationJob failed_retryable',
      failureStage: job.stage || PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
      errorCode: job.lastErrorCode || null,
      safeToMutate: true,
      repairAction: 'ensure_job'
    };
  }

  if (job && ACTIVE_JOB_STATUSES.has(job.status)) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.JOB_ACTIVE_OR_RETRYABLE,
      reason: `Job status=${job.status}; leave to worker (reclaim stale claimed if needed)`,
      failureStage: job.stage || null,
      safeToMutate: job.status === 'claimed',
      repairAction: job.status === 'claimed' ? 'reclaim_stale_job' : 'none'
    };
  }

  if (jobSucceeded && session && !sessionFinalized) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.JOB_SUCCEEDED_SESSION_NOT_FINALIZED,
      reason: 'Job succeeded but CheckoutSession is not finalized',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.SESSION_FINALIZE,
      safeToMutate: true,
      repairAction: 'finalize_paid_checkout'
    };
  }

  if (sessionFinalized && job && !jobSucceeded) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.SESSION_FINALIZED_JOB_NOT_SUCCEEDED,
      reason: 'Session finalized but job is not succeeded',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.SESSION_FINALIZE,
      safeToMutate: Boolean(session.bookingId),
      repairAction: session.bookingId ? 'mark_job_succeeded' : 'open_manual_review'
    };
  }

  if (booking && session && (!paymentLinked || !sessionFinalized || !session.bookingId)) {
    if (bookingByCheckout && !bookingByPi) {
      return {
        ...base,
        classification: RECONCILE_CLASSIFICATIONS.BOOKING_EXISTS_BY_CHECKOUT_ID,
        reason: 'Booking exists by checkoutId; adopt via finalizePaidCheckout',
        failureStage: PAID_BOOKING_FINALIZATION_STAGES.SESSION_FINALIZE,
        safeToMutate: sessionPaid || stripeSucceeded,
        repairAction: 'finalize_paid_checkout'
      };
    }
    if (bookingByPi && !bookingByCheckout) {
      return {
        ...base,
        classification: RECONCILE_CLASSIFICATIONS.BOOKING_EXISTS_BY_PAYMENT_INTENT_ID,
        reason: 'Booking exists by paymentIntentId; adopt via finalizePaidCheckout',
        failureStage: PAID_BOOKING_FINALIZATION_STAGES.SESSION_FINALIZE,
        safeToMutate: sessionPaid || stripeSucceeded,
        repairAction: 'finalize_paid_checkout'
      };
    }
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.BOOKING_EXISTS_LINKAGE_INCOMPLETE,
      reason: 'Booking exists but Payment/session linkage is incomplete',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.PAYMENT_LINK,
      safeToMutate: sessionPaid || stripeSucceeded,
      repairAction: 'finalize_paid_checkout'
    };
  }

  if (
    sessionPaid &&
    !sessionFinalized &&
    session.expiresAt &&
    new Date(session.expiresAt).getTime() < at.getTime()
  ) {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.PAID_SESSION_EXPIRED,
      reason: 'Paid session is expired but not finalized',
      failureStage: PAID_BOOKING_FINALIZATION_STAGES.FINALIZE_PRECHECK,
      safeToMutate: true,
      repairAction: job ? 'finalize_paid_checkout' : 'ensure_job'
    };
  }

  if (sessionPaid && !sessionFinalized && !booking) {
    return {
      ...base,
      classification: job
        ? RECONCILE_CLASSIFICATIONS.JOB_ACTIVE_OR_RETRYABLE
        : RECONCILE_CLASSIFICATIONS.SESSION_PAID_NO_JOB,
      reason: 'Paid session has no booking yet',
      safeToMutate: true,
      repairAction: job ? 'finalize_paid_checkout' : 'ensure_job'
    };
  }

  if (sessionFinalized && booking && confirmation?.latestStatus === 'ambiguous') {
    return {
      ...base,
      classification: RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS,
      reason: 'Confirmation delivery is ambiguous; automatic resend suppressed',
      safeToMutate: false,
      repairAction: 'none'
    };
  }

  return {
    ...base,
    classification: RECONCILE_CLASSIFICATIONS.ALREADY_FULLY_CONSISTENT,
    reason: 'No actionable incomplete paid-checkout state detected',
    safeToMutate: false,
    repairAction: 'none'
  };
}

async function openUnsafeReview(inspection, { failureSource = 'reconcile' } = {}) {
  if (!inspection.paymentIntentId) return null;
  return recordPaidBookingResolutionIssueSafe({
    issueType:
      inspection.classification === RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH ||
      inspection.classification === RECONCILE_CLASSIFICATIONS.SUPERSEDED_OR_NONCANONICAL_PI
        ? 'paid_booking_conflict'
        : 'paid_booking_unknown_failure',
    errorCode: inspection.errorCode || inspection.classification,
    errorSummary: redactSummary(inspection.reason || inspection.classification),
    paymentIntentId: inspection.paymentIntentId,
    checkoutId: inspection.checkoutId || null,
    bookingId: inspection.booking?.id || null,
    finalizationStage:
      inspection.failureStage || PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
    failureSource,
    stripePaymentVerified: true,
    extraMetadata: {
      reconcile: true,
      classification: inspection.classification,
      repairAction: inspection.repairAction
    }
  });
}

async function executeRepair(inspection, { stripe = null, now = new Date() } = {}) {
  const at = normalizeNow(now);
  const action = inspection.repairAction;
  const result = {
    mutated: false,
    action,
    details: null,
    refundAttempted: false,
    paymentIntentCreateAttempted: false,
    bookingCreated: false,
    emailResendAttempted: false
  };

  if (action === 'none') return result;

  // Binding §2.10: while an S0 multi-unit paid-orphan recovery is incomplete
  // for this job, generic reconciliation must no-op its mutations (report only)
  // and must not alter job status or lease/hold fields.
  if (inspection.job?.id) {
    const recoveryState = await CheckoutFinalizationJob.findById(inspection.job.id)
      .select('recoveryStatus')
      .lean();
    if (recoveryState && INCOMPLETE_RECOVERY_STATUSES.includes(recoveryState.recoveryStatus)) {
      result.details = {
        skipped: true,
        reason: 'incomplete_multi_unit_recovery_in_progress',
        recoveryStatus: recoveryState.recoveryStatus
      };
      return result;
    }
  }

  if (action === 'open_manual_review') {
    result.details = await openUnsafeReview(inspection);
    result.mutated = Boolean(result.details);
    return result;
  }

  if (!inspection.safeToMutate) {
    result.details = { skipped: true, reason: 'not_safe_to_mutate' };
    return result;
  }

  const checkoutId = inspection.checkoutId;
  const paymentIntentId = inspection.paymentIntentId;
  const stripeClient = getStripeClient(stripe);

  if (action === 'mark_paid_and_ensure_job') {
    let pi = null;
    if (stripeClient && paymentIntentId) {
      pi = await retrievePaymentIntent(stripeClient, paymentIntentId);
    }
    if (!pi) {
      throw new Error('Stripe PaymentIntent retrieve required to mark session paid');
    }
    const verified = await verifyAccommodationPaymentSuccess({
      event: buildSyntheticSucceededEvent(pi),
      payment: await loadPaymentByIntentId(paymentIntentId)
    });
    if (!verified.ok) {
      result.details = await openUnsafeReview({
        ...inspection,
        errorCode: verified.errorCode,
        reason: verified.errorSummary,
        classification: UNSAFE_MISMATCH_CODES.has(verified.errorCode)
          ? RECONCILE_CLASSIFICATIONS.VERIFICATION_MISMATCH
          : inspection.classification
      });
      result.mutated = Boolean(result.details);
      return result;
    }
    const paidSession = await markCheckoutSessionPaid({
      session: verified.session,
      evidence: verified.evidence,
      now: at
    });
    const jobResult = await ensureCheckoutFinalizationJob({
      checkoutId: paidSession.checkoutId,
      paymentIntentId,
      stripeEventId: verified.evidence?.stripeEventId || null,
      quoteSnapshotHash: paidSession.quoteSnapshotHash || null,
      finalizeIntentHash: paidSession.finalizeIntentHash || null,
      createdReason: 'reconcile',
      now: at
    });
    result.mutated = true;
    result.details = {
      paymentStatus: paidSession.paymentStatus,
      job: jobResult
    };
    return result;
  }

  if (action === 'ensure_job') {
    const session = await CheckoutSession.findOne({ checkoutId }).lean();
    const jobResult = await ensureCheckoutFinalizationJob({
      checkoutId,
      paymentIntentId:
        paymentIntentId ||
        session?.canonicalPaymentIntentId ||
        inspection.paymentIntentId,
      quoteSnapshotHash: session?.quoteSnapshotHash || null,
      finalizeIntentHash: session?.finalizeIntentHash || null,
      createdReason: 'reconcile',
      now: at
    });
    result.mutated = jobResult.created === true || jobResult.rescheduled === true;
    result.details = jobResult;
    return result;
  }

  if (action === 'reclaim_stale_job') {
    if (!inspection.job?.id) {
      result.details = { skipped: true, reason: 'missing_job' };
      return result;
    }
    const reclaimed = await reclaimStaleClaimedCheckoutFinalizationJob({
      jobId: inspection.job.id,
      now: at
    });
    result.mutated = Boolean(reclaimed);
    result.details = reclaimed
      ? { jobId: String(reclaimed._id), status: reclaimed.status }
      : { reclaimed: false };
    return result;
  }

  if (action === 'finalize_paid_checkout') {
    const beforeCount = await Booking.countDocuments(
      checkoutId ? { checkoutId } : { stripePaymentIntentId: paymentIntentId }
    );
    const finalizeResult = await finalizePaidCheckout({
      checkoutId,
      paymentIntentId,
      source: 'reconcile',
      now: at,
      dependencies: {
        ...createDefaultDependencies(),
        stripe: stripeClient
      }
    });
    const afterCount = await Booking.countDocuments(
      checkoutId ? { checkoutId } : { stripePaymentIntentId: paymentIntentId }
    );
    result.mutated = true;
    result.bookingCreated = afterCount > beforeCount;
    result.details = {
      bookingId: finalizeResult.bookingId,
      adoptedExisting: finalizeResult.adoptedExisting === true,
      idempotentReplay: finalizeResult.idempotentReplay === true
    };

    // Ensure durable job exists / marks progress for ops visibility.
    if (checkoutId && paymentIntentId) {
      const session = finalizeResult.session || (await CheckoutSession.findOne({ checkoutId }));
      await ensureCheckoutFinalizationJob({
        checkoutId,
        paymentIntentId,
        quoteSnapshotHash: session?.quoteSnapshotHash || null,
        finalizeIntentHash: session?.finalizeIntentHash || null,
        createdReason: 'reconcile',
        now: at
      });
      if (finalizeResult.bookingId) {
        const job = await findPreservedJobForCheckout(checkoutId);
        if (job && job.status !== 'succeeded' && job.status !== 'failed_permanent') {
          await markCheckoutFinalizationJobSucceeded({
            jobId: job._id,
            bookingId: finalizeResult.bookingId,
            now: at,
            sessionFinalizedAt: session?.finalizedAt || at,
            paymentLinkedAt: at
          });
        }
      }
    }
    return result;
  }

  if (action === 'mark_job_succeeded') {
    const job = await findPreservedJobForCheckout(checkoutId);
    if (!job) {
      result.details = { skipped: true, reason: 'missing_job' };
      return result;
    }
    if (job.status === 'succeeded') {
      result.details = { skipped: true, reason: 'already_succeeded' };
      return result;
    }
    const updated = await markCheckoutFinalizationJobSucceeded({
      jobId: job._id,
      bookingId: inspection.booking?.id || inspection.session?.bookingId,
      now: at
    });
    result.mutated = true;
    result.details = { jobId: String(updated._id), status: updated.status };
    return result;
  }

  if (action === 'repair_side_effects') {
    const booking = inspection.booking?.id
      ? await Booking.findById(inspection.booking.id)
      : null;
    const session = checkoutId
      ? await CheckoutSession.findOne({ checkoutId })
      : null;
    if (!booking) {
      result.details = { skipped: true, reason: 'missing_booking' };
      return result;
    }
    // Never auto-resend ambiguous; pending/failed may enqueue/send only behind existing flags.
    const sendConfirmation =
      featureFlags.isFinalizeWorkerSendConfirmationEnabled() &&
      inspection.classification !== RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS;
    result.emailResendAttempted = sendConfirmation;
    const side = await runCheckoutFinalizeSideEffects({
      booking,
      session,
      source: 'reconcile',
      adoptedExisting: true,
      sendConfirmation,
      now: at
    });
    result.mutated = true;
    result.details = {
      confirmationStatus: side.confirmationEmail?.status || null,
      adoptedSent: side.confirmationEmail?.adoptedSent === true,
      ambiguous: side.confirmationEmail?.ambiguous === true
    };
    return result;
  }

  result.details = { skipped: true, reason: `unknown_action:${action}` };
  return result;
}

/**
 * Reconcile one subject. Dry-run unless execute=true AND the selected mutation flag is on.
 * @param {'enqueue'|'historical'} [mutationFlag='enqueue']
 *   enqueue → FINALIZE_RECONCILE_ENQUEUE (Batch 7)
 *   historical → FINALIZE_RECONCILE_HISTORICAL (Batch 8)
 */
async function reconcilePaidCheckoutSubject({
  checkoutId = null,
  paymentIntentId = null,
  execute = false,
  mutationFlag = 'enqueue',
  stripe = null,
  paymentIntent = null,
  now = new Date()
} = {}) {
  const historical = mutationFlag === 'historical';
  const flagEnabled = historical
    ? featureFlags.isFinalizeReconcileHistoricalEnabled()
    : isReconcileEnqueueEnabled();
  const dryRun = !(execute === true && flagEnabled);
  const inspection = await inspectPaidCheckoutSubject({
    checkoutId,
    paymentIntentId,
    stripe,
    paymentIntent,
    now
  });

  const outcome = {
    dryRun,
    executeRequested: execute === true,
    flagEnabled,
    mutationFlag: historical ? 'historical' : 'enqueue',
    classification: inspection.classification,
    reason: inspection.reason,
    failureStage: inspection.failureStage,
    checkoutId: inspection.checkoutId,
    paymentIntentId: inspection.paymentIntentId,
    safeToMutate: inspection.safeToMutate,
    repairAction: inspection.repairAction,
    inspection,
    repair: null,
    refundAttempted: false,
    paymentIntentCreateAttempted: false
  };

  if (dryRun) {
    outcome.repair = {
      mutated: false,
      skipped: true,
      reason: execute
        ? historical
          ? 'FINALIZE_RECONCILE_HISTORICAL_disabled'
          : 'FINALIZE_RECONCILE_ENQUEUE_disabled'
        : 'dry_run',
      wouldAction: inspection.repairAction
    };
    return outcome;
  }

  // Even with execute: unsafe mismatches only open review.
  if (
    inspection.repairAction === 'open_manual_review' ||
    inspection.classification === RECONCILE_CLASSIFICATIONS.CONFIRMATION_AMBIGUOUS
  ) {
    if (inspection.repairAction === 'open_manual_review') {
      outcome.repair = await executeRepair(inspection, { stripe, now });
    } else {
      outcome.repair = {
        mutated: false,
        action: 'none',
        details: { skipped: true, reason: 'ambiguous_confirmation_no_resend' },
        emailResendAttempted: false,
        refundAttempted: false,
        paymentIntentCreateAttempted: false
      };
    }
    return outcome;
  }

  try {
    outcome.repair = await executeRepair(inspection, { stripe, now });
  } catch (err) {
    outcome.repair = {
      mutated: false,
      action: inspection.repairAction,
      error: redactSummary(safeErrorSummary(err) || err?.message || String(err)),
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
    await recordPaidBookingResolutionIssueSafe({
      issueType: 'paid_booking_unknown_failure',
      errorCode: err?.code || 'RECONCILE_REPAIR_FAILED',
      errorSummary: redactSummary(err?.message || String(err)),
      paymentIntentId: inspection.paymentIntentId || 'unknown',
      checkoutId: inspection.checkoutId || null,
      finalizationStage:
        inspection.failureStage || PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
      failureSource: 'reconcile',
      stripePaymentVerified: true,
      extraMetadata: { classification: inspection.classification }
    }).catch(() => null);
  }

  return outcome;
}

async function discoverReconcileCandidates({
  checkoutId = null,
  paymentIntentId = null,
  since = null,
  until = null,
  limit = DEFAULT_LIMIT
} = {}) {
  const capped = clampLimit(limit);
  const subjects = new Map();

  const add = (checkout, pi) => {
    const c = checkout ? String(checkout).trim() : '';
    const p = pi ? String(pi).trim() : '';
    if (!c && !p) return;
    const key = c || `pi:${p}`;
    if (!subjects.has(key)) {
      subjects.set(key, { checkoutId: c || null, paymentIntentId: p || null });
    } else {
      const cur = subjects.get(key);
      if (!cur.checkoutId && c) cur.checkoutId = c;
      if (!cur.paymentIntentId && p) cur.paymentIntentId = p;
    }
  };

  if (checkoutId || paymentIntentId) {
    add(checkoutId, paymentIntentId);
    return Array.from(subjects.values()).slice(0, capped);
  }

  const createdAt = {};
  if (since) createdAt.$gte = since instanceof Date ? since : new Date(since);
  if (until) createdAt.$lte = until instanceof Date ? until : new Date(until);
  const hasDate = Object.keys(createdAt).length > 0;

  const sessionQuery = {
    flowVersion: 'v2',
    $or: [
      { paymentStatus: 'paid', finalizeStatus: { $ne: 'finalized' } },
      {
        paymentStatus: 'paid',
        finalizeStatus: 'finalized',
        bookingId: { $ne: null }
      },
      {
        paymentStatus: { $ne: 'paid' },
        canonicalPaymentIntentId: { $nin: [null, ''] }
      }
    ]
  };
  if (hasDate) sessionQuery.createdAt = createdAt;

  const sessions = await CheckoutSession.find(sessionQuery)
    .select('checkoutId canonicalPaymentIntentId paymentStatus finalizeStatus createdAt')
    .sort({ createdAt: -1 })
    .limit(capped)
    .lean();

  for (const s of sessions) {
    add(s.checkoutId, s.canonicalPaymentIntentId);
  }

  if (subjects.size < capped) {
    const paymentQuery = {
      status: 'paid',
      reservationId: null,
      'metadata.checkoutId': { $exists: true, $nin: [null, ''] }
    };
    if (hasDate) paymentQuery.createdAt = createdAt;
    const payments = await Payment.find(paymentQuery)
      .select('providerReference metadata.checkoutId createdAt')
      .sort({ createdAt: -1 })
      .limit(capped)
      .lean();
    for (const p of payments) {
      add(p.metadata?.checkoutId, p.providerReference);
    }
  }

  if (subjects.size < capped) {
    const jobQuery = {
      status: { $in: ['scheduled', 'claimed', 'failed_retryable', 'failed_permanent'] }
    };
    if (hasDate) jobQuery.createdAt = createdAt;
    const jobs = await CheckoutFinalizationJob.find(jobQuery)
      .select('checkoutId paymentIntentId createdAt')
      .sort({ createdAt: -1 })
      .limit(capped)
      .lean();
    for (const j of jobs) {
      add(j.checkoutId, j.paymentIntentId);
    }
  }

  return Array.from(subjects.values()).slice(0, capped);
}

/**
 * Batch reconcile entrypoint.
 */
async function reconcilePaidCheckoutFinalization({
  checkoutId = null,
  paymentIntentId = null,
  since = null,
  until = null,
  limit = DEFAULT_LIMIT,
  execute = false,
  stripe = null,
  now = new Date()
} = {}) {
  const dryRun = !(execute === true && isReconcileEnqueueEnabled());
  const candidates = await discoverReconcileCandidates({
    checkoutId,
    paymentIntentId,
    since,
    until,
    limit
  });

  const results = [];
  const byClassification = {};

  for (const subject of candidates) {
    const outcome = await reconcilePaidCheckoutSubject({
      checkoutId: subject.checkoutId,
      paymentIntentId: subject.paymentIntentId,
      execute,
      stripe,
      now
    });
    results.push({
      checkoutId: outcome.checkoutId,
      paymentIntentId: outcome.paymentIntentId,
      classification: outcome.classification,
      reason: redactSummary(outcome.reason),
      failureStage: outcome.failureStage,
      dryRun: outcome.dryRun,
      repairAction: outcome.repairAction,
      mutated: outcome.repair?.mutated === true,
      refundAttempted: false,
      paymentIntentCreateAttempted: false,
      emailResendAttempted: outcome.repair?.emailResendAttempted === true,
      bookingCreated: outcome.repair?.bookingCreated === true
    });
    byClassification[outcome.classification] =
      (byClassification[outcome.classification] || 0) + 1;
  }

  const boundedResults =
    results.length > RESULT_HISTORY_MAX
      ? results.slice(0, RESULT_HISTORY_MAX)
      : results;

  return {
    dryRun,
    executeRequested: execute === true,
    flagEnabled: isReconcileEnqueueEnabled(),
    scanned: candidates.length,
    results: boundedResults,
    resultsTruncated: results.length > RESULT_HISTORY_MAX,
    byClassification,
    refundAttempted: false,
    paymentIntentCreateAttempted: false
  };
}

module.exports = {
  RECONCILE_CLASSIFICATIONS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isReconcileEnqueueEnabled,
  inspectPaidCheckoutSubject,
  reconcilePaidCheckoutSubject,
  reconcilePaidCheckoutFinalization,
  discoverReconcileCandidates,
  buildSyntheticSucceededEvent
};
