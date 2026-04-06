/**
 * Central promo validation and lodging-only discount math.
 * v1: discount applies to base accommodation only (not experiences, transport, romantic setup).
 */
const PromoCode = require('../models/PromoCode');

function normalizePromoCodeInput(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toUpperCase();
  return s.length ? s : null;
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function promoWindowStart(doc) {
  return doc.startsAt || doc.validFrom;
}

function promoWindowEnd(doc) {
  return doc.endsAt || doc.validUntil;
}

/**
 * Load promo document and validate rules that do not depend on stay amount.
 * @returns {Promise<{ doc: object|null, invalidReason: string|null }>}
 */
async function resolvePromoDocument(promoCodeRaw) {
  const normalized = normalizePromoCodeInput(promoCodeRaw);
  if (!normalized) {
    return { doc: null, invalidReason: null };
  }

  const doc = await PromoCode.findOne({ code: normalized }).lean();
  if (!doc) {
    return { doc: null, invalidReason: 'This promo code is not valid.' };
  }

  const now = new Date();
  if (!doc.isActive) {
    return { doc: null, invalidReason: 'This promo code is not active.' };
  }

  const start = promoWindowStart(doc);
  if (start && now < new Date(start)) {
    return { doc: null, invalidReason: 'This promo code is not valid yet.' };
  }

  const end = promoWindowEnd(doc);
  if (end && now > new Date(end)) {
    return { doc: null, invalidReason: 'This promo code has expired.' };
  }

  const limit = doc.usageLimit;
  if (limit != null && Number(doc.usageCount) >= Number(limit)) {
    return { doc: null, invalidReason: 'This promo code is no longer available.' };
  }

  return { doc, invalidReason: null };
}

function computeLodgingDiscountAmount(baseLodgingPrice, doc) {
  if (!doc) return 0;
  const base = roundMoney(baseLodgingPrice);
  if (doc.minSubtotal != null && base < doc.minSubtotal) {
    return null;
  }
  if (doc.discountType === 'percent') {
    const pct = Math.min(100, Math.max(0, Number(doc.discountValue) || 0));
    return roundMoney(base * (pct / 100));
  }
  return roundMoney(Math.min(Number(doc.discountValue) || 0, base));
}

/**
 * @param {number} baseLodgingPrice
 * @param {string|null|undefined} promoCodeRaw
 * @returns {Promise<{
 *   discountedLodging: number,
 *   discountAmount: number,
 *   promoSnapshot: object|null,
 *   appliedPromoCode: string|null,
 *   promoInvalidReason: string|null
 * }>}
 */
async function applyPromoToLodgingOnly(baseLodgingPrice, promoCodeRaw) {
  const base = roundMoney(baseLodgingPrice);
  const normalized = normalizePromoCodeInput(promoCodeRaw);
  if (!normalized) {
    return {
      discountedLodging: base,
      discountAmount: 0,
      promoSnapshot: null,
      appliedPromoCode: null,
      promoInvalidReason: null
    };
  }

  const { doc, invalidReason } = await resolvePromoDocument(promoCodeRaw);
  if (!doc) {
    return {
      discountedLodging: base,
      discountAmount: 0,
      promoSnapshot: null,
      appliedPromoCode: null,
      promoInvalidReason: invalidReason
    };
  }

  const discountAmount = computeLodgingDiscountAmount(base, doc);
  if (discountAmount === null) {
    return {
      discountedLodging: base,
      discountAmount: 0,
      promoSnapshot: null,
      appliedPromoCode: null,
      promoInvalidReason: `This code requires a minimum stay price of €${doc.minSubtotal}.`
    };
  }

  const discountedLodging = roundMoney(Math.max(0, base - discountAmount));
  const promoSnapshot = {
    code: doc.code,
    discountType: doc.discountType,
    discountValue: doc.discountValue,
    internalName: doc.internalName,
    scope: 'lodging_only'
  };

  return {
    discountedLodging,
    discountAmount,
    promoSnapshot,
    appliedPromoCode: normalized,
    promoInvalidReason: null
  };
}

/**
 * Apply promo to lodging portion of a full pricing breakdown (from calculateCabinPriceBreakdown).
 */
async function applyPromoToBreakdown(breakdown, promoCodeRaw) {
  const lodging = await applyPromoToLodgingOnly(breakdown.baseLodgingPrice, promoCodeRaw);
  const totalPrice = roundMoney(lodging.discountedLodging + breakdown.extrasTotal);
  return {
    subtotalPrice: breakdown.totalPrice,
    baseLodgingPrice: breakdown.baseLodgingPrice,
    extrasTotal: breakdown.extrasTotal,
    discountAmount: lodging.discountAmount,
    totalPrice,
    promoSnapshot: lodging.promoSnapshot,
    appliedPromoCode: lodging.appliedPromoCode,
    promoInvalidReason: lodging.promoInvalidReason
  };
}

/**
 * Sync: already-validated doc (e.g. search loop). No DB.
 */
function applyValidatedDocToLodging(baseLodging, doc) {
  const base = roundMoney(baseLodging);
  if (!doc) {
    return { displayPrice: base };
  }
  const amt = computeLodgingDiscountAmount(base, doc);
  if (amt === null) {
    return { displayPrice: base };
  }
  return { displayPrice: roundMoney(Math.max(0, base - amt)) };
}

module.exports = {
  normalizePromoCodeInput,
  resolvePromoDocument,
  applyPromoToLodgingOnly,
  applyPromoToBreakdown,
  applyValidatedDocToLodging
};
