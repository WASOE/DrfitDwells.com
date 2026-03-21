const Payment = require('../../../models/Payment');
const Payout = require('../../../models/Payout');
const Booking = require('../../../models/Booking');
const StripeEventEvidence = require('../../../models/StripeEventEvidence');
const ManualReviewItem = require('../../../models/ManualReviewItem');

async function getPaymentsSummaryReadModel() {
  const [total, failed, disputed, unlinked, lastWebhook, unlinkedReviewCount] = await Promise.all([
    Payment.countDocuments({}),
    Payment.countDocuments({ status: 'failed' }),
    Payment.countDocuments({ status: 'disputed' }),
    Payment.countDocuments({ reservationId: null }),
    StripeEventEvidence.findOne({}).sort({ createdAtProvider: -1 }).lean(),
    ManualReviewItem.countDocuments({ category: { $in: ['payment_unlinked', 'payout_unlinked'] }, status: 'open' })
  ]);

  return {
    totals: { total, failed, disputed, unlinked },
    observability: {
      webhookLastSeenAt: lastWebhook?.createdAtProvider || null,
      webhookLastEventType: lastWebhook?.eventType || null,
      openReconciliationItems: unlinkedReviewCount
    },
    derived: {
      classification: 'derived_on_read'
    }
  };
}

async function getPaymentsLedgerReadModel({ page = 1, limit = 20 }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Payment.find({}).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    Payment.countDocuments({})
  ]);

  return {
    items: items.map((p) => ({
      paymentId: String(p._id),
      reservationId: p.reservationId ? String(p.reservationId) : null,
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      providerReference: p.providerReference,
      linkageState: p.reservationId ? 'linked' : 'unlinked',
      createdAt: p.createdAt
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  };
}

async function getPayoutsListReadModel({ page = 1, limit = 20 }) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [items, total] = await Promise.all([
    Payout.find({}).sort({ createdAt: -1 }).skip(skip).limit(safeLimit).lean(),
    Payout.countDocuments({})
  ]);

  return {
    items: items.map((p) => ({
      payoutId: String(p._id),
      status: p.status,
      amount: p.amount,
      currency: p.currency,
      provider: p.provider,
      providerReference: p.providerReference,
      expectedArrivalDate: p.expectedArrivalDate || null,
      paidAt: p.paidAt || null
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  };
}

async function getPayoutDetailReadModel(payoutId) {
  const payout = await Payout.findById(payoutId).lean();
  if (!payout) return null;

  const reservationRef = payout.metadata?.reservationId || null;
  let reservation = null;
  if (reservationRef) {
    reservation = await Booking.findById(reservationRef).select('_id checkIn checkOut').lean();
  }

  return {
    payout: {
      payoutId: String(payout._id),
      status: payout.status,
      amount: payout.amount,
      currency: payout.currency,
      provider: payout.provider,
      providerReference: payout.providerReference,
      expectedArrivalDate: payout.expectedArrivalDate || null,
      paidAt: payout.paidAt || null
    },
    reconciliation: {
      reservationId: reservation ? String(reservation._id) : null,
      linkageState: reservation ? 'linked' : 'unknown_or_unlinked'
    },
    degraded: {
      linkageIncomplete: !reservation
    }
  };
}

async function getPayoutReconciliationSummaryReadModel() {
  const [total, withReservationRef, openUnlinkedPayoutReviews] = await Promise.all([
    Payout.countDocuments({}),
    Payout.countDocuments({ 'metadata.reservationId': { $exists: true, $ne: null } }),
    ManualReviewItem.countDocuments({ category: 'payout_unlinked', status: 'open' })
  ]);

  return {
    totals: {
      totalPayouts: total,
      withReservationReference: withReservationRef,
      incompleteLinkage: total - withReservationRef
    },
    manualReview: {
      openUnlinkedPayouts: openUnlinkedPayoutReviews
    }
  };
}

module.exports = {
  getPaymentsSummaryReadModel,
  getPaymentsLedgerReadModel,
  getPayoutsListReadModel,
  getPayoutDetailReadModel,
  getPayoutReconciliationSummaryReadModel
};
