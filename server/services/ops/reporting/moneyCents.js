'use strict';

/**
 * Convert major currency units (e.g. EUR) to integer cents without float drift.
 * Payment.amount is stored as major units from Stripe ingestion (cents / 100).
 */
function majorCurrencyAmountToCents(amount) {
  if (amount == null || amount === '') return 0;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return 0;
  // Scale via integer math on a fixed 2-decimal string representation.
  const negative = n < 0;
  const abs = Math.abs(n);
  const [wholeRaw, fracRaw = ''] = String(abs.toFixed(2)).split('.');
  const whole = Number.parseInt(wholeRaw, 10) || 0;
  const frac = Number.parseInt(fracRaw.padEnd(2, '0').slice(0, 2), 10) || 0;
  const cents = whole * 100 + frac;
  return negative ? -cents : cents;
}

function isGiftVoucherPaymentMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.type === 'gift_voucher') return true;
  if (metadata.giftVoucherId) return true;
  if (metadata.purchaseRequestId) return true;
  return false;
}

module.exports = {
  majorCurrencyAmountToCents,
  isGiftVoucherPaymentMetadata
};
