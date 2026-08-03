const ManualReviewItem = require('../../models/ManualReviewItem');
const {
  NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
} = require('./paymentLinkageRequirementPolicy');
const {
  withOrdinaryManualReviewHoldExclusion
} = require('../ops/ingestion/manualReviewResolutionHoldFilter');

function normalizeString(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

async function resolveOpenPaymentUnlinkedReviews({
  paymentId,
  paymentIntentId,
  resolvedBy,
  note
}) {
  const paymentIdStr = normalizeString(paymentId);
  const paymentIntentIdStr = normalizeString(paymentIntentId);

  if (!paymentIdStr && !paymentIntentIdStr) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_lookup_keys' };
  }

  const now = new Date();
  const orFilters = [];
  if (paymentIdStr) {
    orFilters.push({
      entityType: 'Payment',
      entityId: paymentIdStr
    });
  }
  if (paymentIntentIdStr) {
    orFilters.push({
      'evidence.providerReference': paymentIntentIdStr
    });
    orFilters.push({
      'evidence.paymentIntentId': paymentIntentIdStr
    });
  }

  const updateResult = await ManualReviewItem.updateMany(
    withOrdinaryManualReviewHoldExclusion({
      status: 'open',
      category: 'payment_unlinked',
      $or: orFilters
    }),
    {
      $set: {
        status: 'resolved',
        resolution: {
          resolvedAt: now,
          resolvedBy: normalizeString(resolvedBy) || 'payment_linking_service',
          note: normalizeString(note) || 'Auto-resolved: payment now linked to booking.'
        },
        updatedAt: now
      }
    }
  );

  return {
    attempted: true,
    resolvedCount: Number(updateResult.modifiedCount || 0)
  };
}

async function resolvePaymentUnlinkedReviews({
  paymentId,
  paymentIntentId,
  reservationId,
  resolvedBy = 'payment_linking_service',
  note = 'Auto-resolved: payment now linked to booking.'
}) {
  const reservationIdStr = normalizeString(reservationId);
  if (!reservationIdStr) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_reservation_id' };
  }

  return resolveOpenPaymentUnlinkedReviews({
    paymentId,
    paymentIntentId,
    resolvedBy,
    note
  });
}

/**
 * Idempotently resolve open payment_unlinked reviews when payment evidence is non-paid.
 * Preserves audit history (resolve, do not delete).
 */
async function resolvePaymentUnlinkedReviewsForNonPaidPayment({
  paymentId,
  paymentIntentId,
  resolvedBy = 'stripe_ingestion_non_paid',
  note = NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
} = {}) {
  return resolveOpenPaymentUnlinkedReviews({
    paymentId,
    paymentIntentId,
    resolvedBy,
    note: normalizeString(note) || NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
  });
}

module.exports = {
  resolvePaymentUnlinkedReviews,
  resolvePaymentUnlinkedReviewsForNonPaidPayment,
  NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
};
