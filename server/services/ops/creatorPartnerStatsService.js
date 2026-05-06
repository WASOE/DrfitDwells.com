const Booking = require('../../models/Booking');
const CreatorPartner = require('../../models/CreatorPartner');
const CreatorReferralVisit = require('../../models/CreatorReferralVisit');
const { normalizeReferralCode } = require('../../models/CreatorPartner');

const PAID_BOOKING_STATUSES = new Set(['confirmed', 'in_house', 'completed']);

function normalizePromoCode(raw) {
  if (raw == null) return null;
  const code = String(raw).trim().toUpperCase();
  return code || null;
}

function toMoneyNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function estimateCommissionableRevenue(booking) {
  const subtotal = toMoneyNumber(booking?.subtotalPrice);
  const discount = toMoneyNumber(booking?.discountAmount);
  if (subtotal > 0) return Math.max(0, subtotal - discount);
  return Math.max(0, toMoneyNumber(booking?.totalPrice));
}

function buildAttributionMaps(creatorPartners) {
  const referralToCreatorId = new Map();
  const promoToCreatorId = new Map();

  for (const creator of creatorPartners) {
    const creatorId = String(creator._id);
    const referralCode = normalizeReferralCode(creator?.referral?.code);
    if (referralCode) referralToCreatorId.set(referralCode, creatorId);

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
    attributedBookings: 0,
    paidConfirmedBookings: 0,
    cancelledRefundedVoidBookings: 0,
    grossBookingRevenue: 0,
    commissionableRevenueEstimate: 0,
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

  const visitDocs = await CreatorReferralVisit.find({
    creatorPartnerId: { $in: creatorPartners.map((c) => c._id) }
  })
    .select('creatorPartnerId visitCount visitorKey sessionKey')
    .lean();

  const bookingDocs = await Booking.find({
    $or: [
      { promoCode: { $exists: true, $ne: null } },
      { 'attribution.referralCode': { $exists: true, $ne: null } }
    ]
  })
    .select('status totalPrice subtotalPrice discountAmount promoCode attribution createdAt')
    .lean();

  const byCreator = new Map();
  const uniqueSets = new Map();
  for (const creatorId of creatorIds) {
    byCreator.set(creatorId, buildEmptyStats());
    uniqueSets.set(creatorId, new Set());
  }

  for (const visit of visitDocs) {
    const creatorId = visit?.creatorPartnerId ? String(visit.creatorPartnerId) : null;
    if (!creatorId || !byCreator.has(creatorId)) continue;
    const stats = byCreator.get(creatorId);
    stats.visits += Math.max(1, Number(visit.visitCount) || 1);
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
    stats.commissionableRevenueEstimate += estimateCommissionableRevenue(booking);
    if (!stats.lastBookingAt || new Date(booking.createdAt) > new Date(stats.lastBookingAt)) {
      stats.lastBookingAt = booking.createdAt;
    }
  }

  return creatorPartners.map((creator) => {
    const creatorId = String(creator._id);
    const stats = byCreator.get(creatorId) || buildEmptyStats();
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
    .select('status totalPrice subtotalPrice discountAmount promoCode attribution checkIn checkOut createdAt')
    .lean();

  return candidates
    .map((booking) => {
      const attribution = resolveBookingCreatorAttribution(booking, maps);
      if (!attribution || attribution.creatorPartnerId !== targetId) return null;
      return {
        bookingId: String(booking._id),
        status: booking.status,
        attributionSource: attribution.source,
        referralCode: booking?.attribution?.referralCode || null,
        promoCode: booking?.promoCode || null,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        createdAt: booking.createdAt,
        grossBookingRevenue: Math.max(0, toMoneyNumber(booking.totalPrice)),
        commissionableRevenueEstimate: estimateCommissionableRevenue(booking)
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildAllCreatorPartnerStats,
  buildSingleCreatorPartnerStats,
  listCreatorPartnerAttributedBookings
};
