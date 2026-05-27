function derivePaymentStatusFromTrail(payments) {
  if (!payments || payments.length === 0) return null;
  if (payments.some((p) => p.status === 'disputed')) return 'disputed';
  if (payments.some((p) => p.status === 'failed')) return 'failed';
  if (payments.some((p) => p.status === 'refunded')) return 'refunded';
  if (payments.some((p) => p.status === 'partial')) return 'partial';
  if (payments.some((p) => p.status === 'paid')) return 'paid';
  return null;
}

function classifyReservationPaymentStatus({ booking, linkedPaymentTrail, hasUnlinkedStripePayment }) {
  const linkedStatus = derivePaymentStatusFromTrail(linkedPaymentTrail);
  if (linkedStatus) return linkedStatus;

  const provenanceSource = String(booking?.provenance?.source || '').trim();
  const hasStripePaymentIntent = typeof booking?.stripePaymentIntentId === 'string' && booking.stripePaymentIntentId.trim().length > 0;
  const isManualReservation = provenanceSource === 'admin_manual' || provenanceSource === 'operator_manual';

  if (hasStripePaymentIntent && hasUnlinkedStripePayment) {
    return 'unlinked_payment';
  }
  if (hasStripePaymentIntent && !hasUnlinkedStripePayment) {
    return 'pending_verification';
  }
  if (isManualReservation) {
    return 'manual_not_required';
  }
  if (booking?.totalPrice > 0) {
    return 'unpaid';
  }
  return 'unknown';
}

function derivePaymentAttention({ reservationStatus, paymentStatus }) {
  const baseAttentionStatuses = new Set([
    'unpaid',
    'failed',
    'disputed',
    'pending_verification',
    'unlinked_payment'
  ]);
  const cancelled = reservationStatus === 'cancelled';
  const cancelledPaid = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial');
  const refundPending = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial' || paymentStatus === 'pending_verification');
  const paymentAttention = baseAttentionStatuses.has(paymentStatus) || cancelledPaid || refundPending;
  return { cancelledPaid, refundPending, paymentAttention };
}

function shouldEmitRefundFollowUpAlert({ reservationStatus, paymentStatus }) {
  return reservationStatus === 'cancelled' && (paymentStatus === 'paid' || paymentStatus === 'partial');
}

module.exports = {
  derivePaymentStatusFromTrail,
  classifyReservationPaymentStatus,
  derivePaymentAttention,
  shouldEmitRefundFollowUpAlert
};
