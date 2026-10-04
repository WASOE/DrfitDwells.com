'use strict';

/**
 * Batch 6 — Centralized post-finalization side effects.
 *
 * Uses authoritative finalizePaidCheckout result only (booking + session).
 * Never creates Booking, PaymentIntent, or refunds.
 *
 * FINALIZE_SIDE_EFFECTS controls optional quote conversion and alert resolution.
 * Confirmation delivery state is always persisted; SMTP sending remains separately controlled.
 */

const featureFlags = require('../../utils/featureFlags');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { markSavedQuoteConverted } = require('../savedQuotes/savedQuoteService');
const { resolvePaymentUnlinkedReviews } = require('../payments/paymentReviewResolutionService');
const { verifyPaymentLinkedToBooking } = require('../payments/paymentLinkingService');
const ManualReviewItem = require('../../models/ManualReviewItem');
const PaymentResolutionIssue = require('../../models/PaymentResolutionIssue');
const {
  processBookingConfirmationDelivery,
  reclaimStaleSendingConfirmationDeliveries
} = require('../email/bookingConfirmationDeliveryService');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const { FINALIZE_STATUS } = require('./checkoutFinalizeService');
const {
  withOrdinaryManualReviewHoldExclusion
} = require('../ops/ingestion/manualReviewResolutionHoldFilter');

const TRANSIENT_PAYMENT_RECORD_ERROR_CODES = [
  'PAYMENT_RECORD_MISSING',
  'PAYMENT_RECORD_NOT_PAID',
  'PAYMENT_RECORD_MISSING_OR_NOT_PAID'
];

function sideEffectsEnabled() {
  return featureFlags.isFinalizeSideEffectsEnabled();
}

async function convertSavedQuoteForBooking({ booking, session }) {
  if (!booking?._id) {
    return { skipped: true, reason: 'missing_booking' };
  }
  try {
    return await markSavedQuoteConverted({
      bookingId: booking._id,
      checkoutId: session?.checkoutId || booking.checkoutId || null,
      guestEmail: booking.guestInfo?.email || null,
      cabinId: booking.cabinId || null,
      cabinTypeId: booking.cabinTypeId || null,
      checkInDateOnly: booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null,
      checkOutDateOnly: booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'checkout-finalize-side-effects',
        phase: 'quote_convert',
        bookingId: String(booking._id),
        error: err?.message || String(err)
      })
    );
    return { skipped: true, reason: 'quote_convert_error', error: err?.message || String(err) };
  }
}

async function resolveConvergedFinalizationFailure({
  booking,
  session,
  paymentIntentId,
  now
}) {
  const checkoutId = session?.checkoutId || booking.checkoutId || null;
  if (
    !checkoutId ||
    session?.paymentStatus !== 'paid' ||
    session?.finalizeStatus !== FINALIZE_STATUS.FINALIZED ||
    String(session?.bookingId || '') !== String(booking._id) ||
    String(session?.canonicalPaymentIntentId || '') !== String(paymentIntentId || '')
  ) {
    return { attempted: false, resolvedCount: 0, reason: 'checkout_not_fully_finalized' };
  }

  const job = await CheckoutFinalizationJob.findOne({ checkoutId })
    .select('status')
    .lean();
  if (job && job.status !== 'succeeded') {
    return { attempted: false, resolvedCount: 0, reason: 'finalization_job_not_succeeded' };
  }

  const issue = await PaymentResolutionIssue.findOne({
    paymentIntentId,
    checkoutId,
    status: 'needs_review',
    errorCode: { $in: TRANSIENT_PAYMENT_RECORD_ERROR_CODES }
  })
    .select('_id occurrenceCount lastFailedAt')
    .lean();
  if (!issue) {
    return { attempted: false, resolvedCount: 0, reason: 'no_transient_finalization_issue' };
  }

  const reviewQuery = {
    category: 'payment_finalization_failure',
    status: 'open',
    entityType: 'PaymentResolutionIssue',
    entityId: String(issue._id)
  };
  const heldReview = await ManualReviewItem.exists({
    ...reviewQuery,
    'resolutionHold.status': 'active'
  });
  if (heldReview) {
    return { attempted: false, resolvedCount: 0, reason: 'active_operator_hold' };
  }

  const resolutionNote =
    'Auto-resolved: paid checkout finalized and Payment ledger linked to booking.';
  const reviewResult = await ManualReviewItem.updateMany(
    withOrdinaryManualReviewHoldExclusion(reviewQuery),
    {
      $set: {
        status: 'resolved',
        'resolution.resolvedAt': now,
        'resolution.resolvedBy': 'checkout_finalize_side_effects',
        'resolution.note': resolutionNote,
        updatedAt: now,
        'evidence.autoResolvedCheckoutId': String(checkoutId)
      }
    }
  );

  if (
    await ManualReviewItem.exists({
      ...reviewQuery,
      'resolutionHold.status': 'active'
    })
  ) {
    return { attempted: false, resolvedCount: 0, reason: 'active_operator_hold' };
  }

  const issueResult = await PaymentResolutionIssue.updateOne(
    {
      _id: issue._id,
      status: 'needs_review',
      occurrenceCount: issue.occurrenceCount,
      lastFailedAt: issue.lastFailedAt,
      errorCode: { $in: TRANSIENT_PAYMENT_RECORD_ERROR_CODES }
    },
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        resolutionNote
      }
    }
  );
  return {
    attempted: true,
    resolvedCount: Number(reviewResult.modifiedCount || 0),
    issueResolved: Number(issueResult.modifiedCount || 0) > 0
  };
}

async function resolveAlertsForBooking({ booking, session, now = new Date() }) {
  if (!booking?._id) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_booking' };
  }
  if (
    session?.legacyPaidRecovery?.legalConsentEvidenceStatus ===
    'missing_due_to_checkout_incident'
  ) {
    return {
      attempted: false,
      resolvedCount: 0,
      reason: 'legacy_recovery_requires_post_verification_resolution'
    };
  }
  const paymentIntentId =
    booking.stripePaymentIntentId ||
    session?.canonicalPaymentIntentId ||
    session?.paymentEvidence?.paymentIntentId ||
    null;

  // Never auto-resolve payment_unlinked merely because a booking exists.
  // Require verified Payment.reservationId === booking._id first.
  try {
    const verified = await verifyPaymentLinkedToBooking({
      booking,
      paymentIntentId
    });
    if (!verified.linked) {
      return {
        attempted: false,
        resolvedCount: 0,
        reason: 'payment_not_linked',
        verifyReason: verified.reason || null
      };
    }
    const paymentUnlinked = await resolvePaymentUnlinkedReviews({
      paymentId: verified.paymentId || null,
      paymentIntentId: verified.stripePaymentIntentId || paymentIntentId,
      reservationId: String(booking._id),
      resolvedBy: 'checkout_finalize_side_effects',
      note: 'Auto-resolved: paid checkout finalized and Payment ledger linked to booking.'
    });
    const finalizationFailure = await resolveConvergedFinalizationFailure({
      booking,
      session,
      paymentIntentId: verified.stripePaymentIntentId || paymentIntentId,
      now
    });
    return { ...paymentUnlinked, finalizationFailure };
  } catch (err) {
    console.error(
      JSON.stringify({
        source: 'checkout-finalize-side-effects',
        phase: 'alert_resolve',
        bookingId: String(booking._id),
        error: err?.message || String(err)
      })
    );
    return {
      attempted: false,
      resolvedCount: 0,
      reason: 'alert_resolve_error',
      error: err?.message || String(err)
    };
  }
}

/**
 * Domain finalize entry: confirmation delivery is always durably enqueued.
 * Optional quote/alert effects and SMTP sending remain independently controlled.
 */
async function enqueuePostFinalizeSideEffects({
  booking = null,
  session = null,
  source = null,
  adoptedExisting = false,
  jobId = null,
  sendConfirmation = false,
  workerId = null,
  entity = null,
  now = new Date(),
  sendFn = null
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const enabled = sideEffectsEnabled();
  const shouldSend = sendConfirmation === true;

  if (!booking?._id) {
    return {
      deferred: false,
      skipped: true,
      reason: 'missing_booking',
      refundAttempted: false,
      paymentIntentCreateAttempted: false,
      bookingDeleted: false
    };
  }

  let quoteConvert = { skipped: true, reason: 'side_effects_flag_off' };
  let alertResolve = { attempted: false, resolvedCount: 0, reason: 'side_effects_flag_off' };

  if (enabled) {
    quoteConvert = await convertSavedQuoteForBooking({ booking, session });
    alertResolve = await resolveAlertsForBooking({ booking, session, now: at });
    await reclaimStaleSendingConfirmationDeliveries({ now: at, limit: 10 }).catch(() => {});
  }

  const confirmation = await processBookingConfirmationDelivery({
    booking,
    session,
    source: source || 'finalize',
    send: shouldSend,
    workerId,
    jobId,
    entity,
    now: at,
    sendFn
  });

  if (jobId && (confirmation.queued || confirmation.sent || confirmation.adoptedSent)) {
    await CheckoutFinalizationJob.updateOne(
      { _id: jobId, confirmationQueuedAt: null },
      { $set: { confirmationQueuedAt: at } }
    ).catch(() => {});
  }

  // Worker/domain finalize path historically omitted booking-created push (HTTP route only).
  if (adoptedExisting !== true && booking?._id) {
    try {
      const { notifyOpsPushBookingCreated } = require('../ops/push/opsPushEventNotifications');
      await notifyOpsPushBookingCreated({
        bookingId: booking._id,
        source: source || 'checkout_finalize_side_effects'
      });
    } catch {
      /* non-fatal */
    }
  }

  return {
    deferred: false,
    adoptedExisting: adoptedExisting === true,
    quoteConvert,
    alertResolve,
    confirmationEmail: confirmation,
    refundAttempted: false,
    paymentIntentCreateAttempted: false,
    bookingDeleted: false
  };
}

/**
 * Worker / frontend helper: run side effects and optionally send confirmation.
 */
async function runCheckoutFinalizeSideEffects(params) {
  return enqueuePostFinalizeSideEffects(params);
}

module.exports = {
  enqueuePostFinalizeSideEffects,
  runCheckoutFinalizeSideEffects,
  convertSavedQuoteForBooking,
  resolveAlertsForBooking
};
