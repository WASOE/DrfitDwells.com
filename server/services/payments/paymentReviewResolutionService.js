const ManualReviewItem = require('../../models/ManualReviewItem');

function normalizeString(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

async function resolvePaymentUnlinkedReviews({
  paymentId,
  paymentIntentId,
  reservationId,
  resolvedBy = 'payment_linking_service',
  note = 'Auto-resolved: payment now linked to booking.'
}) {
  const paymentIdStr = normalizeString(paymentId);
  const paymentIntentIdStr = normalizeString(paymentIntentId);
  const reservationIdStr = normalizeString(reservationId);

  if (!paymentIdStr && !paymentIntentIdStr) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_lookup_keys' };
  }
  if (!reservationIdStr) {
    return { attempted: false, resolvedCount: 0, reason: 'missing_reservation_id' };
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
  }

  const updateResult = await ManualReviewItem.updateMany(
    {
      status: 'open',
      category: 'payment_unlinked',
      $or: orFilters
    },
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

module.exports = {
  resolvePaymentUnlinkedReviews
};
