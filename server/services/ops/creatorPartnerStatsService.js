const Booking = require('../../models/Booking');
const CreatorPartner = require('../../models/CreatorPartner');
const CreatorReferralVisit = require('../../models/CreatorReferralVisit');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherCreatorCommission = require('../../models/GiftVoucherCreatorCommission');
const CreatorCommission = require('../../models/CreatorCommission');
const { normalizeReferralCode } = require('../../models/CreatorPartner');
const mongoose = require('mongoose');
const {
  stayCashCommissionBaseCents,
  estimateStayCommissionableRevenueEUR
} = require('./creatorCommissionLedgerService');

const PAID_BOOKING_STATUSES = new Set(['confirmed', 'in_house', 'completed']);
const PAID_VOUCHER_STATUSES = ['active', 'partially_redeemed', 'redeemed', 'expired'];

function attributionObjectIdMaybe(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  const s = String(value).trim();
  return mongoose.Types.ObjectId.isValid(s) ? s : null;
}

function resolveGiftVoucherStatsCreator(voucher, maps) {
  const refNorm = normalizeReferralCode(voucher?.attribution?.referralCode);
  const idStr = attributionObjectIdMaybe(voucher?.attribution?.creatorPartnerId);
  let refCreator = refNorm ? maps.referralToCreatorId.get(refNorm) || null : null;
  const idCreator = idStr;
  if (refCreator && idCreator && refCreator !== idCreator) return null;
  return refCreator || idCreator || null;
}

function normalizePromoCode(raw) {
  if (raw == null) return null;
  const code = String(raw).trim().toUpperCase();
  return code || null;
}

function toMoneyNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function resolveStayBookingCashRevenueCents(booking) {
  const cents = stayCashCommissionBaseCents(booking);
  if (cents !== null) return cents;
  return Math.round(Math.max(0, toMoneyNumber(booking.totalPrice)) * 100);
}

function buildAttributionMaps(creatorPartners) {
  const referralToCreatorId = new Map();
  const promoToCreatorId = new Map();

  for (const creator of creatorPartners) {
    const creatorId = String(creator._id);
    const referralCode = normalizeReferralCode(creator?.referral?.code);
    // Draft creators should not receive campaign attribution; archived creators retain historical visibility.
    if (referralCode && ['active', 'paused', 'archived'].includes(creator?.status)) {
      referralToCreatorId.set(referralCode, creatorId);
    }

    const promoCode = normalizePromoCode(creator?.promo?.code);
    if (promoCode && ['active', 'paused'].includes(creator?.status)) {
      promoToCreatorId.set(promoCode, creatorId);
    }
  }

  return { referralToCreatorId, promoToCreatorId };
}

function resolveBookingCreatorAttribution(booking, maps) {
  const promoCode = normalizePromoCode(booking?.promoCode);
  if (promoCode && maps.promoToCreatorId.has(promoCode)) {
    return {
      creatorPartnerId: maps.promoToCreatorId.get(promoCode),
      source: 'creator_promo'
    };
  }

  const referralCode = normalizeReferralCode(booking?.attribution?.referralCode);
  if (referralCode && maps.referralToCreatorId.has(referralCode)) {
    return {
      creatorPartnerId: maps.referralToCreatorId.get(referralCode),
      source: 'creator_referral'
    };
  }

  return null;
}

function buildEmptyStats() {
  return {
    visits: 0,
    uniqueVisitors: 0,
    lastVisitAt: null,
    attributedBookings: 0,
    paidConfirmedBookings: 0,
    cancelledRefundedVoidBookings: 0,
    grossBookingRevenue: 0,
    commissionableRevenueEstimate: 0,
    giftVoucherPurchases: 0,
    giftVoucherRevenueCents: 0,
    giftVoucherCommissionCents: 0,
    stayBookingRevenueCents: 0,
    stayBookingCommissionCents: 0,
    totalCommissionCents: 0,
    lastBookingAt: null,
    conversionRate: 0
  };
}

function applyConversionRate(stats) {
  stats.conversionRate = stats.visits > 0 ? Number((stats.attributedBookings / stats.visits).toFixed(4)) : 0;
  return stats;
}

async function buildAllCreatorPartnerStats() {
  const creatorPartners = await CreatorPartner.find({})
    .select('_id name slug status referral promo createdAt updatedAt')
    .lean();
  const creatorIds = creatorPartners.map((c) => String(c._id));
  const maps = buildAttributionMaps(creatorPartners);
  const referralCodes = Array.from(maps.referralToCreatorId.keys());

  const visitDocs = await CreatorReferralVisit.find({
    $or: [
      { creatorPartnerId: { $in: creatorPartners.map((c) => c._id) } },
      { referralCode: { $in: referralCodes } }
    ]
  })
    .select('creatorPartnerId referralCode visitCount visitorKey sessionKey lastSeenAt')
    .lean();

  const bookingDocs = await Booking.find({
    $or: [
      { promoCode: { $exists: true, $ne: null } },
      { 'attribution.referralCode': { $exists: true, $ne: null } }
    ]
  })
    .select(
      'status totalPrice subtotalPrice discountAmount promoCode attribution createdAt totalValueCents giftVoucherAppliedCents stripePaidAmountCents'
    )
    .lean();

  const giftVouchersForStats = await GiftVoucher.find({
    status: { $in: PAID_VOUCHER_STATUSES },
    $or: [
      { 'attribution.referralCode': { $exists: true, $ne: null } },
      { 'attribution.creatorPartnerId': { $exists: true, $ne: null } }
    ]
  })
    .select('amountOriginalCents attribution')
    .lean();

  const creatorObjectIds = creatorPartners.map((c) => c._id);
  const gvCommDocs = await GiftVoucherCreatorCommission.find({
    creatorPartnerId: { $in: creatorObjectIds },
    status: { $ne: 'voided' }
  })
    .select('creatorPartnerId commissionAmountCents')
    .lean();

  const stayCommDocs = await CreatorCommission.find({
    creatorPartnerId: { $in: creatorObjectIds },
    status: { $nin: ['void'] }
  })
    .select('creatorPartnerId amountSnapshot')
    .lean();

  const byCreator = new Map();
  const uniqueSets = new Map();
  for (const creatorId of creatorIds) {
    byCreator.set(creatorId, buildEmptyStats());
    uniqueSets.set(creatorId, new Set());
  }

  for (const visit of visitDocs) {
    let creatorId = visit?.creatorPartnerId ? String(visit.creatorPartnerId) : null;
    if (!creatorId || !byCreator.has(creatorId)) {
      const referralCode = normalizeReferralCode(visit?.referralCode);
      creatorId = referralCode ? maps.referralToCreatorId.get(referralCode) || null : null;
    }
    if (!creatorId || !byCreator.has(creatorId)) continue;
    const stats = byCreator.get(creatorId);
    stats.visits += Math.max(1, Number(visit.visitCount) || 1);
    if (visit.lastSeenAt && (!stats.lastVisitAt || new Date(visit.lastSeenAt) > new Date(stats.lastVisitAt))) {
      stats.lastVisitAt = visit.lastSeenAt;
    }
    const dedupeKey = visit.visitorKey || (visit.sessionKey ? `s:${visit.sessionKey}` : null);
    if (dedupeKey) uniqueSets.get(creatorId).add(dedupeKey);
  }

  for (const booking of bookingDocs) {
    const attribution = resolveBookingCreatorAttribution(booking, maps);
    if (!attribution) continue;
    const creatorId = attribution.creatorPartnerId;
    if (!byCreator.has(creatorId)) continue;

    const stats = byCreator.get(creatorId);
    stats.attributedBookings += 1;
    if (PAID_BOOKING_STATUSES.has(booking.status)) {
      stats.paidConfirmedBookings += 1;
    }
    if (booking.status === 'cancelled') {
      stats.cancelledRefundedVoidBookings += 1;
    }
    stats.grossBookingRevenue += Math.max(0, toMoneyNumber(booking.totalPrice));
    if (PAID_BOOKING_STATUSES.has(booking.status)) {
      stats.stayBookingRevenueCents += resolveStayBookingCashRevenueCents(booking);
    }
    if (booking.status !== 'cancelled') {
      stats.commissionableRevenueEstimate += estimateStayCommissionableRevenueEUR(booking);
    }
    if (!stats.lastBookingAt || new Date(booking.createdAt) > new Date(stats.lastBookingAt)) {
      stats.lastBookingAt = booking.createdAt;
    }
  }

  for (const gv of giftVouchersForStats) {
    const creatorId = resolveGiftVoucherStatsCreator(gv, maps);
    if (!creatorId || !byCreator.has(creatorId)) continue;
    const s = byCreator.get(creatorId);
    s.giftVoucherPurchases += 1;
    s.giftVoucherRevenueCents += Math.max(0, Math.trunc(Number(gv.amountOriginalCents) || 0));
  }

  for (const row of gvCommDocs) {
    const id = row?.creatorPartnerId ? String(row.creatorPartnerId) : null;
    if (!id || !byCreator.has(id)) continue;
    byCreator.get(id).giftVoucherCommissionCents += Math.max(0, Math.trunc(Number(row.commissionAmountCents) || 0));
  }

  for (const row of stayCommDocs) {
    const id = row?.creatorPartnerId ? String(row.creatorPartnerId) : null;
    if (!id || !byCreator.has(id)) continue;
    const snap = Number(row.amountSnapshot);
    byCreator.get(id).stayBookingCommissionCents += Number.isFinite(snap) ? Math.round(snap * 100) : 0;
  }

  return creatorPartners.map((creator) => {
    const creatorId = String(creator._id);
    const stats = byCreator.get(creatorId) || buildEmptyStats();
    stats.totalCommissionCents = Math.max(
      0,
      Math.trunc(stats.stayBookingCommissionCents || 0) + Math.trunc(stats.giftVoucherCommissionCents || 0)
    );
    const uniqueVisitors = uniqueSets.get(creatorId)?.size || 0;
    return {
      creatorPartnerId: creatorId,
      stats: applyConversionRate({
        ...stats,
        uniqueVisitors,
        grossBookingRevenue: Number(stats.grossBookingRevenue.toFixed(2)),
        commissionableRevenueEstimate: Number(stats.commissionableRevenueEstimate.toFixed(2))
      })
    };
  });
}

async function buildSingleCreatorPartnerStats(creatorPartnerDoc) {
  const all = await buildAllCreatorPartnerStats();
  const targetId = String(creatorPartnerDoc._id);
  const row = all.find((r) => r.creatorPartnerId === targetId);
  return row ? row.stats : buildEmptyStats();
}

async function listCreatorPartnerAttributedBookings(creatorPartnerDoc, { limit = 100 } = {}) {
  const creatorPartners = await CreatorPartner.find({})
    .select('_id status referral promo')
    .lean();
  const maps = buildAttributionMaps(creatorPartners);
  const targetId = String(creatorPartnerDoc._id);

  const candidateOr = [];
  const creatorReferral = normalizeReferralCode(creatorPartnerDoc?.referral?.code);
  if (creatorReferral) candidateOr.push({ 'attribution.referralCode': creatorReferral });
  const creatorPromoCode = normalizePromoCode(creatorPartnerDoc?.promo?.code);
  if (creatorPromoCode && ['active', 'paused'].includes(creatorPartnerDoc?.status)) {
    candidateOr.push({ promoCode: creatorPromoCode });
  }
  if (candidateOr.length === 0) return [];

  const candidates = await Booking.find({ $or: candidateOr })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(300, Number(limit) || 100)))
    .select(
      'status totalPrice subtotalPrice discountAmount promoCode attribution checkIn checkOut createdAt guestInfo cabinId cabinTypeId totalValueCents giftVoucherAppliedCents stripePaidAmountCents'
    )
    .populate('cabinId', 'name')
    .populate('cabinTypeId', 'name')
    .lean();

  return candidates
    .map((booking) => {
      const attribution = resolveBookingCreatorAttribution(booking, maps);
      if (!attribution || attribution.creatorPartnerId !== targetId) return null;
      const firstName = String(booking?.guestInfo?.firstName || '').trim();
      const lastName = String(booking?.guestInfo?.lastName || '').trim();
      const guestName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
      const cabinLabel = booking?.cabinId?.name || booking?.cabinTypeId?.name || null;
      return {
        bookingId: String(booking._id),
        guestName,
        guestEmail: booking?.guestInfo?.email || null,
        cabinLabel,
        status: booking.status,
        attributionSource: attribution.source,
        referralCode: booking?.attribution?.referralCode || null,
        promoCode: booking?.promoCode || null,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        createdAt: booking.createdAt,
        subtotalPrice: Math.max(0, toMoneyNumber(booking.subtotalPrice)),
        discountAmount: Math.max(0, toMoneyNumber(booking.discountAmount)),
        totalPrice: Math.max(0, toMoneyNumber(booking.totalPrice)),
        grossBookingRevenue: Math.max(0, toMoneyNumber(booking.totalPrice)),
        commissionableRevenueEstimate: estimateStayCommissionableRevenueEUR(booking)
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildAllCreatorPartnerStats,
  buildSingleCreatorPartnerStats,
  listCreatorPartnerAttributedBookings
};
