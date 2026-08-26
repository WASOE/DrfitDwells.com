function derivePaymentStatusFromTrail(payments) {
  if (!payments || payments.length === 0) return null;
  if (payments.some((p) => p.status === 'disputed')) return 'disputed';
  if (payments.some((p) => p.status === 'failed')) return 'failed';
  if (payments.some((p) => p.status === 'refunded')) return 'refunded';
  if (payments.some((p) => p.status === 'partial')) return 'partial';
  if (payments.some((p) => p.status === 'paid')) return 'paid';
  return null;
}

/**
 * REBOOK-S2: coverage transferred via StayChange (not a Payment row).
 * Callers may pass the StayChange doc when booking.settledByStayChangeId is set.
 */
function deriveStatusFromRebookTransfer({ booking, rebookStayChange }) {
  if (!booking?.settledByStayChangeId || !rebookStayChange) return null;
  if (String(rebookStayChange._id) !== String(booking.settledByStayChangeId)) return null;

  const {
    resolveReplacementCoverageCents,
    resolveContractualTargetFromStayChange,
    isRebookTransferSettling
  } = require('../../stayChange/rebookStayChangeSpine');

  if (!isRebookTransferSettling(rebookStayChange)) return null;

  const coverage = resolveReplacementCoverageCents({
    rebookStayChange,
    replacementIncrementalPaidCents: 0,
    replacementVoucherCents: Number.isFinite(booking.giftVoucherAppliedCents)
      ? Math.max(0, Math.round(booking.giftVoucherAppliedCents))
      : 0
  });
  const contractual = resolveContractualTargetFromStayChange(rebookStayChange);
  if (coverage == null || contractual == null) return null;
  if (coverage >= contractual) return 'paid';
  if (coverage > 0) return 'partial';
  return null;
}

function classifyReservationPaymentStatus({
  booking,
  linkedPaymentTrail,
  hasUnlinkedStripePayment,
  rebookStayChange = null
}) {
  const linkedStatus = derivePaymentStatusFromTrail(linkedPaymentTrail);
  if (linkedStatus) return linkedStatus;

  const rebookStatus = deriveStatusFromRebookTransfer({ booking, rebookStayChange });
  if (rebookStatus) return rebookStatus;

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

function suppressesCancelledPaidRefundFollowUp(cancellationSettlementOutcome) {
  return (
    cancellationSettlementOutcome === 'payment_retained' ||
    cancellationSettlementOutcome === 'credits_issued' ||
    cancellationSettlementOutcome === 'cash_refunded' ||
    cancellationSettlementOutcome === 'rebooked_or_moved'
  );
}

function derivePaymentAttention({ reservationStatus, paymentStatus, cancellationSettlementOutcome = null }) {
  const baseAttentionStatuses = new Set([
    'unpaid',
    'failed',
    'disputed',
    'pending_verification',
    'unlinked_payment'
  ]);
  const cancelled = reservationStatus === 'cancelled';
  const isCancelledPaidOrPartial = cancelled && (paymentStatus === 'paid' || paymentStatus === 'partial');
  const suppressCancelledPaidFollowUp =
    isCancelledPaidOrPartial && suppressesCancelledPaidRefundFollowUp(cancellationSettlementOutcome);
  const cancelledPaid = suppressCancelledPaidFollowUp ? false : isCancelledPaidOrPartial;
  const refundPending = cancelled
    && (paymentStatus === 'paid' || paymentStatus === 'partial' || paymentStatus === 'pending_verification')
    && !suppressCancelledPaidFollowUp;
  const paymentAttention = baseAttentionStatuses.has(paymentStatus) || cancelledPaid || refundPending;
  return { cancelledPaid, refundPending, paymentAttention };
}

function shouldEmitRefundFollowUpAlert({ reservationStatus, paymentStatus, cancellationSettlementOutcome = null }) {
  if (suppressesCancelledPaidRefundFollowUp(cancellationSettlementOutcome)) return false;
  return reservationStatus === 'cancelled' && (paymentStatus === 'paid' || paymentStatus === 'partial');
}

module.exports = {
  derivePaymentStatusFromTrail,
  classifyReservationPaymentStatus,
  derivePaymentAttention,
  shouldEmitRefundFollowUpAlert,
  suppressesCancelledPaidRefundFollowUp
};
