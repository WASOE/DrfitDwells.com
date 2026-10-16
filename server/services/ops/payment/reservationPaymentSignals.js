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

function idsEqual(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function positiveIntegerOrNull(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Conservative amount due: the larger of the booking total fields, so coverage must satisfy both. */
function resolveAmountDueCents(booking) {
  const candidates = [];
  if (booking?.totalPrice != null && Number.isFinite(Number(booking.totalPrice))) {
    candidates.push(Math.max(0, Math.round(Number(booking.totalPrice) * 100)));
  }
  if (booking?.totalValueCents != null && Number.isFinite(Number(booking.totalValueCents))) {
    candidates.push(Math.max(0, Math.round(Number(booking.totalValueCents))));
  }
  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * Gift voucher coverage counts only when the booking's own redemption reference resolves to a
 * confirmed ledger redemption for this booking/checkout whose amount equals the booking field.
 * Any mismatch fails closed (0) so booking fields alone can never establish payment.
 */
function resolveVerifiedGiftVoucherCents(booking, giftVoucherRedemption) {
  const applied = positiveIntegerOrNull(booking?.giftVoucherAppliedCents);
  if (!applied || !booking?.giftVoucherRedemptionId || !giftVoucherRedemption) return 0;
  const r = giftVoucherRedemption;
  if (!idsEqual(r._id, booking.giftVoucherRedemptionId)) return 0;
  if (String(r.status || '') !== 'confirmed') return 0;
  if (r.bookingId != null && !idsEqual(r.bookingId, booking._id)) return 0;
  if (r.reservationId != null && !idsEqual(r.reservationId, booking._id)) return 0;
  if (r.checkoutId != null && booking.checkoutId != null && !idsEqual(r.checkoutId, booking.checkoutId)) return 0;
  if (!idsEqual(r.bookingId, booking._id) && !idsEqual(r.reservationId, booking._id) &&
      !idsEqual(r.checkoutId, booking.checkoutId)) return 0;
  if (r.currency != null && String(r.currency).toUpperCase() !== 'EUR') return 0;
  if (positiveIntegerOrNull(r.amountAppliedCents) !== applied) return 0;
  return applied;
}

/** Stay credit counts only with exactly one consumed reservation bound to this booking for the applied amount. */
function resolveVerifiedStayCreditCents(booking, stayCreditReservations) {
  const applied = positiveIntegerOrNull(booking?.stayCreditAppliedCents);
  if (!applied || !Array.isArray(stayCreditReservations)) return 0;
  const consumed = stayCreditReservations.filter(
    (row) => row && String(row.status || '') === 'consumed' && idsEqual(row.bookingId, booking._id)
  );
  if (consumed.length !== 1) return 0;
  const row = consumed[0];
  if (booking.stayCreditId != null && !idsEqual(row.stayCreditId, booking.stayCreditId)) return 0;
  if (positiveIntegerOrNull(row.amountCents) !== applied) return 0;
  return applied;
}

/**
 * Returns { paymentStatus, coverage } where coverage describes non-card coverage evidence used.
 * Stripe trail, rebook transfer, unverified Stripe intents and manual provenance keep precedence;
 * verified voucher/stay-credit coverage only replaces the no-evidence `unpaid` fallback.
 */
function assessReservationPaymentCoverage({
  booking,
  linkedPaymentTrail,
  hasUnlinkedStripePayment,
  rebookStayChange = null,
  giftVoucherRedemption = null,
  stayCreditReservations = null
}) {
  const result = (paymentStatus, coverage = null) => ({ paymentStatus, coverage });

  const linkedStatus = derivePaymentStatusFromTrail(linkedPaymentTrail);
  if (linkedStatus) return result(linkedStatus);

  const rebookStatus = deriveStatusFromRebookTransfer({ booking, rebookStayChange });
  if (rebookStatus) return result(rebookStatus);

  const provenanceSource = String(booking?.provenance?.source || '').trim();
  const hasStripePaymentIntent = typeof booking?.stripePaymentIntentId === 'string' && booking.stripePaymentIntentId.trim().length > 0;
  const isManualReservation = provenanceSource === 'admin_manual' || provenanceSource === 'operator_manual';

  if (hasStripePaymentIntent && hasUnlinkedStripePayment) {
    return result('unlinked_payment');
  }
  if (hasStripePaymentIntent && !hasUnlinkedStripePayment) {
    return result('pending_verification');
  }
  if (isManualReservation) {
    return result('manual_not_required');
  }

  const dueCents = resolveAmountDueCents(booking);
  if (dueCents != null && dueCents > 0) {
    const giftVoucherCents = resolveVerifiedGiftVoucherCents(booking, giftVoucherRedemption);
    const stayCreditCents = resolveVerifiedStayCreditCents(booking, stayCreditReservations);
    const coveredCents = giftVoucherCents + stayCreditCents;
    const coverage = {
      dueCents,
      giftVoucherCents,
      stayCreditCents,
      coveredCents,
      outstandingCents: Math.max(0, dueCents - coveredCents)
    };
    if (coveredCents >= dueCents) return result('paid', coverage);
    if (coveredCents > 0) return result('partial', coverage);
  }

  if (booking?.totalPrice > 0) {
    return result('unpaid');
  }
  return result('unknown');
}

function classifyReservationPaymentStatus(input) {
  return assessReservationPaymentCoverage(input).paymentStatus;
}

/** True when verified non-card coverage left a balance that nothing else is collecting. */
function hasOutstandingNonCardBalance(assessment) {
  return Boolean(
    assessment &&
      assessment.paymentStatus === 'partial' &&
      assessment.coverage &&
      assessment.coverage.outstandingCents > 0
  );
}

function suppressesCancelledPaidRefundFollowUp(cancellationSettlementOutcome) {
  return (
    cancellationSettlementOutcome === 'payment_retained' ||
    cancellationSettlementOutcome === 'credits_issued' ||
    cancellationSettlementOutcome === 'cash_refunded' ||
    cancellationSettlementOutcome === 'rebooked_or_moved'
  );
}

function derivePaymentAttention({
  reservationStatus,
  paymentStatus,
  cancellationSettlementOutcome = null,
  outstandingBalance = false
}) {
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
  const paymentAttention =
    baseAttentionStatuses.has(paymentStatus) ||
    cancelledPaid ||
    refundPending ||
    (!cancelled && outstandingBalance === true);
  return { cancelledPaid, refundPending, paymentAttention };
}

function shouldEmitRefundFollowUpAlert({ reservationStatus, paymentStatus, cancellationSettlementOutcome = null }) {
  if (suppressesCancelledPaidRefundFollowUp(cancellationSettlementOutcome)) return false;
  return reservationStatus === 'cancelled' && (paymentStatus === 'paid' || paymentStatus === 'partial');
}

module.exports = {
  derivePaymentStatusFromTrail,
  assessReservationPaymentCoverage,
  classifyReservationPaymentStatus,
  hasOutstandingNonCardBalance,
  resolveAmountDueCents,
  resolveVerifiedGiftVoucherCents,
  resolveVerifiedStayCreditCents,
  derivePaymentAttention,
  shouldEmitRefundFollowUpAlert,
  suppressesCancelledPaidRefundFollowUp
};
