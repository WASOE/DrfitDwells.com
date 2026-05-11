const GiftVoucher = require('../../models/GiftVoucher');
const CreatorPartner = require('../../models/CreatorPartner');
const {
  buildSingleCreatorPartnerStats,
  listCreatorPartnerAttributedBookings
} = require('../ops/creatorPartnerStatsService');
const { listCreatorCommissionForPartner } = require('../ops/creatorCommissionLedgerService');

const PAID_VOUCHER_STATUSES = ['active', 'partially_redeemed', 'redeemed', 'expired'];

function mapAttributionSource(source) {
  if (source === 'creator_promo') return 'promo';
  if (source === 'creator_referral') return 'referral';
  return 'none';
}

function toMoney(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Number(x.toFixed(2)) : 0;
}

function buildCommissionIndex(entries) {
  const byBooking = new Map();
  for (const e of entries) {
    if (!e.bookingId) continue;
    const bid = String(e.bookingId);
    const prev = byBooking.get(bid);
    if (!prev) {
      byBooking.set(bid, e);
      continue;
    }
    const rank = (s) => (s === 'paid' ? 4 : s === 'approved' ? 3 : s === 'pending' ? 2 : 1);
    if (rank(e.status) > rank(prev.status)) byBooking.set(bid, e);
  }
  return byBooking;
}

function portalCommissionStatus(ledgerRow) {
  if (!ledgerRow) return 'none';
  return ledgerRow.status === 'void' ? 'void' : ledgerRow.status;
}

async function listRecentGiftVouchersForPartner(creatorPartnerDoc, limit = 15) {
  const ref = CreatorPartner.normalizeReferralCode(creatorPartnerDoc?.referral?.code);
  const id = creatorPartnerDoc._id;
  const or = [{ 'attribution.creatorPartnerId': id }];
  if (ref) or.push({ 'attribution.referralCode': ref });
  const rows = await GiftVoucher.find({
    status: { $in: PAID_VOUCHER_STATUSES },
    $or: or
  })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(50, Number(limit) || 15)))
    .select('createdAt status amountOriginalCents')
    .lean();
  return rows.map((v) => ({
    date: v.createdAt,
    status: v.status,
    amountOriginalCents: Math.max(0, Math.trunc(Number(v.amountOriginalCents) || 0))
  }));
}

/**
 * Read-only dashboard DTO for creator portal. No guest PII, no payment ids, no internal notes.
 */
async function buildCreatorPortalMe(creatorPartnerId) {
  const partner = await CreatorPartner.findById(creatorPartnerId)
    .select('name slug status referral promo commission')
    .lean();
  if (!partner) return null;
  if (partner.status === 'draft') return null;

  const stats = await buildSingleCreatorPartnerStats(partner);
  const rateBps = Math.max(0, Math.min(10000, Number(partner.commission?.rateBps) || 0));
  const projectedCommission = toMoney(
    (Number(stats.commissionableRevenueEstimate) || 0) * (rateBps / 10000)
  );

  const commissionRows = await listCreatorCommissionForPartner(partner._id, { limit: 500 });
  let approvedCommission = 0;
  let paidCommission = 0;
  for (const row of commissionRows) {
    const amt = Number(row.amountSnapshot) || 0;
    if (row.status === 'approved') approvedCommission += amt;
    if (row.status === 'paid') paidCommission += amt;
  }
  approvedCommission = toMoney(approvedCommission);
  paidCommission = toMoney(paidCommission);

  const rawBookings = await listCreatorPartnerAttributedBookings(partner, { limit: 40 });
  const commissionByBooking = buildCommissionIndex(commissionRows);

  const recentBookings = rawBookings.slice(0, 25).map((b) => {
    const ledger = commissionByBooking.get(String(b.bookingId));
    return {
      id: String(b.bookingId),
      checkIn: b.checkIn || null,
      checkOut: b.checkOut || null,
      createdAt: b.createdAt || null,
      propertyLabel: b.cabinLabel || null,
      status: b.status || null,
      attributionSource: mapAttributionSource(b.attributionSource),
      bookingValue: toMoney(b.totalPrice),
      commissionStatus: portalCommissionStatus(ledger)
    };
  });

  const recentCommission = commissionRows.slice(0, 20).map((e) => ({
    id: String(e._id),
    bookingId: e.bookingId ? String(e.bookingId) : null,
    status: e.status,
    source: e.source || null,
    amount: toMoney(e.amountSnapshot),
    currency: e.currency || 'EUR'
  }));

  const giftRows = await listRecentGiftVouchersForPartner(partner, 15);

  return {
    profile: {
      name: partner.name || '',
      slug: partner.slug || '',
      referralCode: partner.referral?.code || null,
      promoCode: partner.promo?.code || null,
      status: partner.status,
      commissionRatePercent: toMoney(rateBps / 100),
      eligibleAfter: partner.commission?.eligibleAfter || 'stay_completed'
    },
    metrics: {
      visits: Number(stats.visits || 0),
      uniqueVisitors: Number(stats.uniqueVisitors || 0),
      bookings: Number(stats.attributedBookings || 0),
      paidBookings: Number(stats.paidConfirmedBookings || 0),
      attributedBookingValue: toMoney(stats.attributedBookingValue ?? stats.grossBookingRevenue ?? 0),
      paidStayRevenue: Number.isFinite(Number(stats.paidStayRevenue))
        ? toMoney(stats.paidStayRevenue)
        : toMoney((Number(stats.stayBookingRevenueCents) || 0) / 100),
      giftVoucherSales: Number(stats.giftVoucherPurchases || 0),
      giftVoucherRevenue: {
        amount: toMoney((Number(stats.giftVoucherRevenueCents) || 0) / 100),
        currency: 'EUR'
      },
      giftVoucherCommission: {
        amount: toMoney((Number(stats.giftVoucherCommissionCents) || 0) / 100),
        currency: 'EUR'
      },
      projectedCommission: {
        amount: projectedCommission,
        currency: 'EUR',
        notPayable: true
      },
      approvedCommission: { amount: approvedCommission, currency: 'EUR' },
      paidCommission: { amount: paidCommission, currency: 'EUR' }
    },
    recentBookings,
    recentGiftVoucherSales: giftRows,
    recentCommission: recentCommission
  };
}

module.exports = { buildCreatorPortalMe };
