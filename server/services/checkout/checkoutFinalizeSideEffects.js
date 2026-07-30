'use strict';

/**
 * Batch 6 — Centralized post-finalization side effects.
 *
 * Uses authoritative finalizePaidCheckout result only (booking + session).
 * Never creates Booking, PaymentIntent, or refunds.
 *
 * Flags:
 * - FINALIZE_SIDE_EFFECTS (default off): quote convert, alert resolve, enqueue confirmation pending
 * - FINALIZE_WORKER_SEND_CONFIRMATION (default off): worker/caller may SMTP-send via delivery SM
 */

const featureFlags = require('../../utils/featureFlags');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { markSavedQuoteConverted } = require('../savedQuotes/savedQuoteService');
const { resolvePaymentUnlinkedReviews } = require('../payments/paymentReviewResolutionService');
const {
  processBookingConfirmationDelivery,
  reclaimStaleSendingConfirmationDeliveries
} = require('../email/bookingConfirmationDeliveryService');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');

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

async function resolveAlertsForBooking({ booking, session }) {
  if (!booking?._id) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_booking' };
  }
  const paymentIntentId =
    booking.stripePaymentIntentId ||
    session?.canonicalPaymentIntentId ||
    session?.paymentEvidence?.paymentIntentId ||
    null;
  try {
    return await resolvePaymentUnlinkedReviews({
      paymentId: null,
      paymentIntentId,
      reservationId: String(booking._id),
      resolvedBy: 'checkout_finalize_side_effects',
      note: 'Auto-resolved: paid checkout finalized and booking linked.'
    });
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
 * Domain finalize entry: quote/alerts/enqueue pending when FINALIZE_SIDE_EFFECTS on.
 * Never sends SMTP from domain core (sendConfirmation defaults false).
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

  if (!enabled && !shouldSend) {
    return {
      deferred: true,
      quoteConvert: 'flag_off',
      alertResolve: 'flag_off',
      confirmationEmail: 'flag_off',
      refundAttempted: false,
      paymentIntentCreateAttempted: false,
      bookingDeleted: false
    };
  }

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
    alertResolve = await resolveAlertsForBooking({ booking, session });
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
