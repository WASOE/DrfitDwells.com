'use strict';

/**
 * Batch 9 — Public checkout recovery status (read-only).
 * Maps durable session/booking/job state to safe guest-facing statuses.
 * Does not create Bookings, charges, PaymentIntents, or jobs.
 */

const CheckoutSession = require('../../models/CheckoutSession');
const Booking = require('../../models/Booking');
const Payment = require('../../models/Payment');
const { FINALIZE_STATUS } = require('./checkoutFinalizeService');
const { buildBookingRef } = require('../bookings/bookingConfirmationReadModel');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { findPreservedJobForCheckout } = require('./checkoutFinalizationJobService');
const { isGiftVoucherPaymentIntent } = require('./paidCheckoutWebhookSyncService');

const PUBLIC_CHECKOUT_RECOVERY_STATUSES = Object.freeze({
  CHECKING_PAYMENT: 'checking_payment',
  FINALIZING: 'finalizing',
  CONFIRMED: 'confirmed',
  NEEDS_REVIEW: 'needs_review',
  PAYMENT_FAILED: 'payment_failed'
});

class CheckoutRecoveryStatusError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'CheckoutRecoveryStatusError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function isLocationOrGiftMetadata(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (isGiftVoucherPaymentIntent({ metadata: meta })) return true;
  if (meta.type === 'location' || meta.type === 'valley' || meta.type === 'location_retreat') {
    return true;
  }
  if (meta.locationKey || meta.locationBookingId) return true;
  if (String(meta.propertyKind || '').toLowerCase() === 'valley') return true;
  return false;
}

async function findLinkedBooking(session) {
  if (session.bookingId) {
    const byId = await Booking.findById(session.bookingId).lean();
    if (byId) return byId;
  }
  if (session.checkoutId) {
    const byCheckout = await Booking.findOne({ checkoutId: session.checkoutId }).lean();
    if (byCheckout) return byCheckout;
  }
  const piId = String(session.canonicalPaymentIntentId || '').trim();
  if (piId) {
    const byPi = await Booking.findOne({ stripePaymentIntentId: piId }).lean();
    if (byPi) return byPi;
  }
  return null;
}

async function loadPaymentForSession(session) {
  const piId = String(session.canonicalPaymentIntentId || '').trim();
  if (!piId) return null;
  return Payment.findOne({ provider: 'stripe', providerReference: piId }).lean();
}

function paymentReceivedEvidence({ session, payment, job }) {
  if (String(session.paymentStatus || '') === 'paid') return true;
  if (String(session.paymentStatus || '') === 'not_required') return true;
  if (payment && payment.status === 'paid') return true;
  if (session.paymentEvidence?.paymentIntentId) return true;
  if (session.paymentSucceededAt) return true;
  if (job && ['scheduled', 'claimed', 'succeeded', 'failed_retryable', 'failed_permanent'].includes(job.status)) {
    // Job only enqueued after verified paid in Batch 3+
    return true;
  }
  return false;
}

function isPermanentReviewState({ session, job }) {
  if (String(session.finalizeStatus || '') === FINALIZE_STATUS.NEEDS_REVIEW) return true;
  if (String(session.status || '') === 'needs_review') return true;
  if (job?.status === 'failed_permanent') return true;
  return false;
}

function isDefinitivePaymentFailed({ session, payment, paymentReceived }) {
  if (paymentReceived) return false;
  if (payment && payment.status === 'paid') return false;
  if (String(session.paymentStatus || '') === 'failed') return true;
  if (payment && ['failed', 'refunded'].includes(String(payment.status || ''))) {
    return true;
  }
  return false;
}

/**
 * Read-only public status for accommodation V2 checkout recovery UX.
 */
async function getPublicCheckoutRecoveryStatus(checkoutId) {
  const id = String(checkoutId || '').trim();
  if (!id) {
    throw new CheckoutRecoveryStatusError('INVALID_CHECKOUT_ID', 'Invalid checkout session id', 400);
  }

  const session = await CheckoutSession.findOne({ checkoutId: id }).lean();
  if (!session) {
    throw new CheckoutRecoveryStatusError('CHECKOUT_NOT_FOUND', 'Checkout session not found', 404);
  }

  if (session.flowVersion !== 'v2') {
    throw new CheckoutRecoveryStatusError(
      'NOT_ACCOMMODATION_CHECKOUT',
      'Checkout is not an accommodation recovery session',
      404
    );
  }

  const payment = await loadPaymentForSession(session);
  if (isLocationOrGiftMetadata(payment?.metadata)) {
    throw new CheckoutRecoveryStatusError(
      'NOT_ACCOMMODATION_CHECKOUT',
      'Checkout is not an accommodation recovery session',
      404
    );
  }

  const job = await findPreservedJobForCheckout(id);
  const booking = await findLinkedBooking(session);

  const paymentReceived = paymentReceivedEvidence({ session, payment, job });
  const updatedAt =
    session.updatedAt ||
    session.finalizedAt ||
    session.paymentSucceededAt ||
    session.createdAt ||
    new Date();

  const base = {
    checkoutId: id,
    paymentReceived: false,
    bookingId: null,
    bookingReference: null,
    updatedAt: new Date(updatedAt).toISOString(),
    canRetryPayment: false
  };

  if (booking?._id) {
    const checkInDateOnly = booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : '';
    return {
      ...base,
      status: PUBLIC_CHECKOUT_RECOVERY_STATUSES.CONFIRMED,
      paymentReceived: paymentReceived || Boolean(booking.stripePaymentIntentId),
      bookingId: String(booking._id),
      bookingReference: buildBookingRef(booking._id, checkInDateOnly),
      canRetryPayment: false
    };
  }

  if (isPermanentReviewState({ session, job }) && paymentReceived) {
    return {
      ...base,
      status: PUBLIC_CHECKOUT_RECOVERY_STATUSES.NEEDS_REVIEW,
      paymentReceived: true,
      canRetryPayment: false
    };
  }

  if (paymentReceived) {
    return {
      ...base,
      status: PUBLIC_CHECKOUT_RECOVERY_STATUSES.FINALIZING,
      paymentReceived: true,
      canRetryPayment: false
    };
  }

  if (isDefinitivePaymentFailed({ session, payment, paymentReceived })) {
    return {
      ...base,
      status: PUBLIC_CHECKOUT_RECOVERY_STATUSES.PAYMENT_FAILED,
      paymentReceived: false,
      canRetryPayment: true
    };
  }

  // Unknown / delayed webhook / processing — never payment_failed
  return {
    ...base,
    status: PUBLIC_CHECKOUT_RECOVERY_STATUSES.CHECKING_PAYMENT,
    paymentReceived: false,
    canRetryPayment: false
  };
}

module.exports = {
  PUBLIC_CHECKOUT_RECOVERY_STATUSES,
  CheckoutRecoveryStatusError,
  getPublicCheckoutRecoveryStatus,
  findLinkedBooking,
  paymentReceivedEvidence
};
