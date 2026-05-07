const GiftVoucher = require('../../../models/GiftVoucher');
const GiftVoucherEvent = require('../../../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../../../models/GiftVoucherRedemption');
const ManualReviewItem = require('../../../models/ManualReviewItem');
const { escapeRegex } = require('../../../utils/escapeRegex');

const MANUAL_REVIEW_CATEGORIES = ['gift_voucher_email_failed', 'gift_voucher_physical_card_required'];

function normalizePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function buildListFilter(query = {}) {
  const filter = {};
  if (query.status) filter.status = String(query.status);
  if (query.deliveryMode) filter.deliveryMode = String(query.deliveryMode);
  if (query.search && String(query.search).trim()) {
    const pattern = new RegExp(escapeRegex(String(query.search).trim()), 'i');
    filter.$or = [
      { code: pattern },
      { buyerName: pattern },
      { buyerEmail: pattern },
      { recipientName: pattern },
      { recipientEmail: pattern }
    ];
  }
  return filter;
}

function mapListItem(doc) {
  return {
    giftVoucherId: String(doc._id),
    code: doc.code || null,
    status: doc.status,
    amountOriginalCents: doc.amountOriginalCents,
    balanceRemainingCents: doc.balanceRemainingCents,
    currency: doc.currency,
    buyerName: doc.buyerName || null,
    buyerEmail: doc.buyerEmail || null,
    recipientName: doc.recipientName || null,
    recipientEmail: doc.recipientEmail || null,
    deliveryMode: doc.deliveryMode || 'email',
    expiresAt: doc.expiresAt || null,
    activatedAt: doc.activatedAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

async function getGiftVouchersWorkspaceReadModel(query = {}) {
  const { page, limit, skip } = normalizePagination(query);
  const filter = buildListFilter(query);
  const [items, total] = await Promise.all([
    GiftVoucher.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    GiftVoucher.countDocuments(filter)
  ]);
  return {
    items: items.map(mapListItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit))
    }
  };
}

function mapVoucherDetail(voucher) {
  return {
    giftVoucherId: String(voucher._id),
    code: voucher.code || null,
    status: voucher.status,
    amountOriginalCents: voucher.amountOriginalCents,
    balanceRemainingCents: voucher.balanceRemainingCents,
    currency: voucher.currency,
    buyerName: voucher.buyerName || null,
    buyerEmail: voucher.buyerEmail || null,
    recipientName: voucher.recipientName || null,
    recipientEmail: voucher.recipientEmail || null,
    message: voucher.message || null,
    deliveryMode: voucher.deliveryMode || 'email',
    deliveryDate: voucher.deliveryDate || null,
    deliveryAddress: voucher.deliveryMode === 'postal' ? voucher.deliveryAddress || null : null,
    sentAt: voucher.sentAt || null,
    expiresAt: voucher.expiresAt || null,
    activatedAt: voucher.activatedAt || null,
    stripePaymentIntentId: voucher.stripePaymentIntentId || null,
    purchaseRequestId: voucher.purchaseRequestId || null,
    attribution: voucher.attribution || {},
    createdAt: voucher.createdAt,
    updatedAt: voucher.updatedAt
  };
}

async function getGiftVoucherDetailReadModel(giftVoucherId) {
  const voucher = await GiftVoucher.findById(giftVoucherId).lean();
  if (!voucher) return null;

  const [events, redemptions, manualReviewItems] = await Promise.all([
    GiftVoucherEvent.find({ giftVoucherId: voucher._id }).sort({ createdAt: -1 }).lean(),
    GiftVoucherRedemption.find({ giftVoucherId: voucher._id }).sort({ createdAt: -1 }).lean(),
    ManualReviewItem.find({
      entityType: 'GiftVoucher',
      entityId: String(voucher._id),
      category: { $in: MANUAL_REVIEW_CATEGORIES }
    })
      .sort({ createdAt: -1 })
      .lean()
  ]);

  return {
    voucher: mapVoucherDetail(voucher),
    events: events.map((event) => ({
      giftVoucherEventId: String(event._id),
      type: event.type,
      actor: event.actor,
      note: event.note || null,
      previousBalanceCents: event.previousBalanceCents,
      newBalanceCents: event.newBalanceCents,
      deltaCents: event.deltaCents,
      metadata: event.metadata || {},
      createdAt: event.createdAt
    })),
    redemptions: redemptions.map((redemption) => ({
      giftVoucherRedemptionId: String(redemption._id),
      status: redemption.status,
      bookingId: redemption.bookingId ? String(redemption.bookingId) : null,
      reservationId: redemption.reservationId ? String(redemption.reservationId) : null,
      amountAppliedCents: redemption.amountAppliedCents,
      reservedAt: redemption.reservedAt || null,
      confirmedAt: redemption.confirmedAt || null,
      releasedAt: redemption.releasedAt || null,
      expiresAt: redemption.expiresAt || null,
      reason: redemption.reason || null,
      createdAt: redemption.createdAt
    })),
    manualReviewItems: manualReviewItems.map((item) => ({
      manualReviewItemId: String(item._id),
      category: item.category,
      severity: item.severity,
      status: item.status,
      title: item.title,
      details: item.details || '',
      evidence: item.evidence || {},
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }))
  };
}

module.exports = {
  getGiftVouchersWorkspaceReadModel,
  getGiftVoucherDetailReadModel
};
