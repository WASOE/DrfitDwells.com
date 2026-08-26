'use strict';

/**
 * S3.1 — detect source promotional / voucher economics that REBOOK v1 rejects.
 * Binding: docs/stay-change-implementation-plan.md §25 (S3.1 hardening)
 *
 * Reject only explicit promo/voucher evidence on the Booking.
 * Do NOT treat historical rack drift (current price ≠ stored total) as promo.
 */

const PROMO_REASON = 'PROMOTIONAL_PRICING_UNSUPPORTED';

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

/**
 * @param {object} booking
 * @returns {{ promotional: boolean, reasonCode: string|null, evidenceKeys: string[] }}
 */
function detectPromotionalSourceEconomics(booking) {
  if (!booking || typeof booking !== 'object') {
    return { promotional: false, reasonCode: null, evidenceKeys: [] };
  }

  const evidenceKeys = [];

  if (typeof booking.promoCode === 'string' && booking.promoCode.trim()) {
    evidenceKeys.push('promoCode');
  }
  if (booking.promoSnapshot != null && typeof booking.promoSnapshot === 'object') {
    const snap = booking.promoSnapshot;
    if (snap.code || snap.discountType != null || snap.discountValue != null) {
      evidenceKeys.push('promoSnapshot');
    }
  }
  if (positiveNumber(booking.discountAmount)) {
    evidenceKeys.push('discountAmount');
  }
  if (positiveNumber(booking.discountAmountCents)) {
    evidenceKeys.push('discountAmountCents');
  }
  if (positiveNumber(booking.giftVoucherAppliedCents)) {
    evidenceKeys.push('giftVoucherAppliedCents');
  }
  if (booking.giftVoucherRedemptionId != null && booking.giftVoucherRedemptionId !== '') {
    evidenceKeys.push('giftVoucherRedemptionId');
  }
  const method = String(booking.paymentMethod || '').trim();
  if (method === 'gift_voucher' || method === 'stripe_plus_gift_voucher') {
    evidenceKeys.push('paymentMethod');
  }

  if (evidenceKeys.length === 0) {
    return { promotional: false, reasonCode: null, evidenceKeys: [] };
  }
  return {
    promotional: true,
    reasonCode: PROMO_REASON,
    evidenceKeys
  };
}

module.exports = {
  PROMO_REASON,
  detectPromotionalSourceEconomics
};
