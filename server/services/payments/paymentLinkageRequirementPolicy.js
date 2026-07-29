/**
 * Shared policy: when accommodation payments require Booking/reservation linkage,
 * and when open payment_unlinked reviews should be auto-resolved as non-paid.
 *
 * Gift-voucher payments must not be routed through accommodation linkage recovery;
 * callers should skip this policy for gift-voucher metadata.
 */

const DEFINITIVELY_SUCCESSFUL_STATUSES = new Set(['paid', 'succeeded', 'captured']);

const DEFINITIVELY_NON_PAID_STATUSES = new Set([
  'failed',
  'unpaid',
  'cancelled',
  'canceled',
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing'
]);

const NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE = 'non_paid_payment_not_requiring_booking_linkage';

function normalizePaymentStatus(status) {
  if (status == null) return null;
  const next = String(status).trim().toLowerCase();
  return next || null;
}

/**
 * True only for definitive successful payment evidence (canonical + Stripe equivalents).
 */
function isDefinitivelySuccessfulPaymentStatus(status) {
  const normalized = normalizePaymentStatus(status);
  if (!normalized) return false;
  return DEFINITIVELY_SUCCESSFUL_STATUSES.has(normalized);
}

/**
 * True for statuses that never require reservation linkage and should clear false alerts.
 */
function isDefinitivelyNonPaidPaymentStatus(status) {
  const normalized = normalizePaymentStatus(status);
  if (!normalized) return false;
  return DEFINITIVELY_NON_PAID_STATUSES.has(normalized);
}

/**
 * Whether an accommodation Payment should require Booking linkage / payment_unlinked review.
 *
 * @param {object} args
 * @param {string|null|undefined} args.paymentStatus - Normalized Payment.status or Stripe PI status
 * @param {number|null|undefined} [args.amountReceived] - Amount in major currency units (e.g. EUR)
 * @param {boolean} [args.isGiftVoucher=false] - Gift vouchers never use accommodation linkage recovery
 */
function shouldRequireBookingLinkage({
  paymentStatus,
  amountReceived = null,
  isGiftVoucher = false
} = {}) {
  if (isGiftVoucher) return false;
  if (!isDefinitivelySuccessfulPaymentStatus(paymentStatus)) return false;

  if (amountReceived != null) {
    const amount = Number(amountReceived);
    if (!Number.isFinite(amount) || amount <= 0) {
      // Zero/unknown amount without successful full-voucher accommodation path: do not alert.
      return false;
    }
  }

  return true;
}

/**
 * Whether an open payment_unlinked review should be resolved because the payment is non-paid.
 * Unknown/missing status is treated as non-requiring (do not create); resolve only when
 * status is definitively non-paid so we do not clear alerts for refunded/disputed/partial.
 */
function shouldResolvePaymentUnlinkedAsNonPaid(paymentStatus) {
  return isDefinitivelyNonPaidPaymentStatus(paymentStatus);
}

module.exports = {
  DEFINITIVELY_SUCCESSFUL_STATUSES,
  DEFINITIVELY_NON_PAID_STATUSES,
  NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE,
  normalizePaymentStatus,
  isDefinitivelySuccessfulPaymentStatus,
  isDefinitivelyNonPaidPaymentStatus,
  shouldRequireBookingLinkage,
  shouldResolvePaymentUnlinkedAsNonPaid
};
