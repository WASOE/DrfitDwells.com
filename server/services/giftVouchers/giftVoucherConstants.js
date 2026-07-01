/** Single source of truth for purchasable / redeemable gift voucher face value (cents). */
const MIN_GIFT_VOUCHER_AMOUNT_CENTS = 1500;

const PUBLIC_VOUCHER_ERROR_MESSAGE = 'This voucher cannot be used.';

/** Guest-safe voucher validation failures — must not surface as HTTP 500. */
const GUEST_SAFE_VOUCHER_FAILURE_CODES = new Set([
  'NOT_FOUND',
  'NOT_REDEEMABLE_STATUS',
  'EXPIRED',
  'MISSING_EXPIRY',
  'NO_BALANCE',
  'INVALID_VOUCHER_AMOUNT',
  'INVALID_VOUCHER_BALANCE',
  'VOUCHER_CODE_REQUIRED',
  'INVALID_AMOUNT_DUE',
  'RESERVE_FAILED',
  'VOUCHER_VALIDATION_FAILED'
]);

function isGuestSafeVoucherFailureCode(code) {
  return GUEST_SAFE_VOUCHER_FAILURE_CODES.has(String(code || '').trim());
}

module.exports = {
  MIN_GIFT_VOUCHER_AMOUNT_CENTS,
  PUBLIC_VOUCHER_ERROR_MESSAGE,
  GUEST_SAFE_VOUCHER_FAILURE_CODES,
  isGuestSafeVoucherFailureCode
};
