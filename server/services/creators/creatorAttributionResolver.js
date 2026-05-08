const { normalizeReferralCode } = require('../../models/CreatorPartner');

const ATTRIBUTABLE_STATUSES = new Set(['active', 'paused', 'archived']);

function normalizePromoCode(raw) {
  if (raw == null) return null;
  const code = String(raw).trim().toUpperCase();
  return code || null;
}

function buildCreatorAttributionMaps(creatorPartners = []) {
  const referralToCreatorId = new Map();
  const promoToCreatorId = new Map();

  for (const creator of creatorPartners) {
    if (!creator || !ATTRIBUTABLE_STATUSES.has(creator.status)) continue;
    const creatorId = String(creator._id);
    const referralCode = normalizeReferralCode(creator?.referral?.code);
    if (referralCode) referralToCreatorId.set(referralCode, creatorId);

    const promoCode = normalizePromoCode(creator?.promo?.code);
    if (promoCode) promoToCreatorId.set(promoCode, creatorId);
  }

  return { referralToCreatorId, promoToCreatorId };
}

function resolveBookingCreatorAttribution(booking, maps) {
  const promoCode = normalizePromoCode(booking?.promoCode);
  if (promoCode && maps?.promoToCreatorId?.has(promoCode)) {
    return {
      creatorPartnerId: maps.promoToCreatorId.get(promoCode),
      source: 'creator_promo',
      referralCode: normalizeReferralCode(booking?.attribution?.referralCode),
      promoCode,
      reason: 'promo_code_match'
    };
  }

  const referralCode = normalizeReferralCode(booking?.attribution?.referralCode);
  if (referralCode && maps?.referralToCreatorId?.has(referralCode)) {
    return {
      creatorPartnerId: maps.referralToCreatorId.get(referralCode),
      source: 'creator_referral',
      referralCode,
      promoCode,
      reason: 'referral_code_match'
    };
  }

  return {
    creatorPartnerId: null,
    source: 'none',
    referralCode,
    promoCode,
    reason: 'no_creator_match'
  };
}

module.exports = {
  ATTRIBUTABLE_STATUSES,
  normalizePromoCode,
  buildCreatorAttributionMaps,
  resolveBookingCreatorAttribution
};
