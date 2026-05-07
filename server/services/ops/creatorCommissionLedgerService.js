const Booking = require('../../models/Booking');
const CreatorPartner = require('../../models/CreatorPartner');
const CreatorCommission = require('../../models/CreatorCommission');
const PaymentResolutionIssue = require('../../models/PaymentResolutionIssue');
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

/**
 * Cash portion of stay value suitable for creator commission (EUR, excluding prepaid voucher).
 * @returns {number|null} EUR, or null when legacy booking has no totalValueCents.
 */
function stayCashCommissionBaseCents(booking) {
  const tv = booking?.totalValueCents;
  if (!Number.isFinite(tv)) return null;
  const gv = Number.isFinite(booking?.giftVoucherAppliedCents)
    ? Math.max(0, Math.trunc(booking.giftVoucherAppliedCents))
    : 0;
  let base = Math.max(0, Math.trunc(tv) - gv);
  if (Number.isFinite(booking?.stripePaidAmountCents)) {
    const cap = Math.max(0, Math.trunc(booking.stripePaidAmountCents));
    base = Math.min(base, cap);
  }
  return base;
}

function estimateStayCommissionableRevenueEUR(booking) {
  const baseCents = stayCashCommissionBaseCents(booking);
  if (baseCents !== null) return baseCents / 100;
  return estimateCommissionableRevenue(booking);
}

function buildAttributionMaps(creatorPartners) {
  const referralToCreatorId = new Map();
  const promoToCreatorId = new Map();

  for (const creator of creatorPartners) {
    const creatorId = String(creator._id);
    const referralCode = normalizeReferralCode(creator?.referral?.code);
    if (referralCode && ['active', 'paused', 'archived'].includes(creator?.status)) {
      referralToCreatorId.set(referralCode, creatorId);
    }

    const promoCode = normalizePromoCode(creator?.promo?.code);
    // Archived creators retain historical attribution integrity for existing bookings.
    if (promoCode && ['active', 'paused', 'archived'].includes(creator?.status)) {
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

function derivePaymentStatusSnapshot(booking) {
  if (PAID_BOOKING_STATUSES.has(booking?.status)) return 'paid';
  if (booking?.status === 'pending') return 'pending';
  if (booking?.status === 'cancelled') return 'cancelled';
  return 'unpaid';
}

function deriveEligibility(booking, hasOpenReviewIssue) {
  if (hasOpenReviewIssue) {
    return { eligibilityStatus: 'needs_review', status: 'pending', voidReason: 'payment_needs_review' };
  }
  if (booking?.status === 'cancelled') {
    return { eligibilityStatus: 'not_eligible', status: 'void', voidReason: 'booking_cancelled' };
  }
  if (!PAID_BOOKING_STATUSES.has(booking?.status)) {
    return { eligibilityStatus: 'not_eligible', status: 'void', voidReason: 'booking_not_paid' };
  }
  return { eligibilityStatus: 'eligible', status: 'pending', voidReason: null };
}

async function recalculateCreatorCommissionForPartner(creatorPartnerDoc) {
  const creatorPartners = await CreatorPartner.find({})
    .select('_id status referral promo')
    .lean();
  const maps = buildAttributionMaps(creatorPartners);
  const targetId = String(creatorPartnerDoc._id);
  const rateBps = Math.max(0, Math.min(10000, Number(creatorPartnerDoc?.commission?.rateBps) || 0));

  const candidateOr = [];
  const creatorReferral = normalizeReferralCode(creatorPartnerDoc?.referral?.code);
  if (creatorReferral) candidateOr.push({ 'attribution.referralCode': creatorReferral });
  const creatorPromoCode = normalizePromoCode(creatorPartnerDoc?.promo?.code);
  if (creatorPromoCode && ['active', 'paused', 'archived'].includes(creatorPartnerDoc?.status)) {
    candidateOr.push({ promoCode: creatorPromoCode });
  }
  if (candidateOr.length === 0) {
    return { processed: 0, upserted: 0, eligible: 0, needsReview: 0, notEligible: 0 };
  }

  const bookings = await Booking.find({ $or: candidateOr })
    .select(
      'status totalPrice subtotalPrice discountAmount promoCode attribution stripePaymentIntentId totalValueCents giftVoucherAppliedCents stripePaidAmountCents'
    )
    .lean();

  const bookingIds = bookings.map((b) => String(b._id));
  const paymentIntentIds = bookings.map((b) => String(b?.stripePaymentIntentId || '').trim()).filter(Boolean);
  const openIssues = await PaymentResolutionIssue.find({
    $or: [
      { 'metadata.bookingId': { $in: bookingIds } },
      { paymentIntentId: { $in: paymentIntentIds } }
    ],
    status: 'needs_review'
  })
    .select('paymentIntentId metadata status')
    .lean();
  const issuesByBookingId = new Set(
    openIssues
      .map((i) => (i?.metadata?.bookingId ? String(i.metadata.bookingId) : null))
      .filter(Boolean)
  );
  const issuesByPaymentIntentId = new Set(openIssues.map((i) => String(i.paymentIntentId || '').trim()).filter(Boolean));

  let processed = 0;
  let upserted = 0;
  let eligible = 0;
  let needsReview = 0;
  let notEligible = 0;
  let preservedLocked = 0;

  for (const booking of bookings) {
    const attribution = resolveBookingCreatorAttribution(booking, maps);
    if (!attribution || attribution.creatorPartnerId !== targetId) continue;
    processed += 1;

    const bookingId = String(booking._id);
    const paymentIntentId = String(booking?.stripePaymentIntentId || '').trim();
    const hasOpenIssue = issuesByBookingId.has(bookingId) || (!!paymentIntentId && issuesByPaymentIntentId.has(paymentIntentId));
    const eligibility = deriveEligibility(booking, hasOpenIssue);

    if (eligibility.eligibilityStatus === 'eligible') eligible += 1;
    else if (eligibility.eligibilityStatus === 'needs_review') needsReview += 1;
    else notEligible += 1;

    const commissionableRevenueSnapshot =
      eligibility.eligibilityStatus === 'eligible' ? estimateStayCommissionableRevenueEUR(booking) : 0;
    const amountSnapshot =
      eligibility.eligibilityStatus === 'eligible'
        ? Number(((commissionableRevenueSnapshot * rateBps) / 10000).toFixed(2))
        : 0;

    const existing = await CreatorCommission.findOne({ bookingId: booking._id })
      .select('status approvedAt paidAt')
      .lean();
    if (existing?.status === 'approved' || existing?.status === 'paid') {
      preservedLocked += 1;
      continue;
    }

    await CreatorCommission.findOneAndUpdate(
      { bookingId: booking._id },
      {
        $set: {
          creatorPartnerId: creatorPartnerDoc._id,
          bookingId: booking._id,
          referralCode: normalizeReferralCode(booking?.attribution?.referralCode) || null,
          promoCode: normalizePromoCode(booking?.promoCode) || null,
          source: attribution.source,
          rateBpsSnapshot: rateBps,
          commissionableRevenueSnapshot,
          amountSnapshot,
          currency: 'EUR',
          bookingStatusSnapshot: booking?.status || null,
          paymentStatusSnapshot: derivePaymentStatusSnapshot(booking),
          eligibilityStatus: eligibility.eligibilityStatus,
          status: eligibility.status,
          voidReason: eligibility.voidReason,
          calculatedAt: new Date(),
          approvedAt: existing?.approvedAt || null,
          paidAt: existing?.paidAt || null
        }
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    upserted += 1;
  }

  return { processed, upserted, eligible, needsReview, notEligible, preservedLocked };
}

async function listCreatorCommissionForPartner(creatorPartnerId, { status, eligibilityStatus, limit = 200 } = {}) {
  const filter = { creatorPartnerId };
  if (status) filter.status = status;
  if (eligibilityStatus) filter.eligibilityStatus = eligibilityStatus;
  return CreatorCommission.find(filter)
    .sort({ calculatedAt: -1, createdAt: -1 })
    .limit(Math.max(1, Math.min(500, Number(limit) || 200)))
    .lean();
}

module.exports = {
  recalculateCreatorCommissionForPartner,
  listCreatorCommissionForPartner,
  stayCashCommissionBaseCents,
  estimateStayCommissionableRevenueEUR,
  estimateCommissionableRevenue
};
