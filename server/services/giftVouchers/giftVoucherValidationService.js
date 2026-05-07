function assertIntegerCents(value, fieldName) {
  if (!Number.isInteger(value)) {
    const err = new Error(`${fieldName} must be an integer cents value`);
    err.code = 'INVALID_CENTS_VALUE';
    err.field = fieldName;
    throw err;
  }
  return true;
}

function assertVoucherMonetaryInvariants(voucherLike) {
  const amountOriginalCents = Number(voucherLike?.amountOriginalCents);
  const balanceRemainingCents = Number(voucherLike?.balanceRemainingCents);

  assertIntegerCents(amountOriginalCents, 'amountOriginalCents');
  assertIntegerCents(balanceRemainingCents, 'balanceRemainingCents');

  if (amountOriginalCents < 10000) {
    const err = new Error('amountOriginalCents must be at least 10000');
    err.code = 'INVALID_VOUCHER_AMOUNT';
    throw err;
  }
  if (balanceRemainingCents < 0) {
    const err = new Error('balanceRemainingCents cannot be negative');
    err.code = 'INVALID_VOUCHER_BALANCE';
    throw err;
  }
  if (balanceRemainingCents > amountOriginalCents) {
    const err = new Error('balanceRemainingCents cannot exceed amountOriginalCents');
    err.code = 'INVALID_VOUCHER_BALANCE';
    throw err;
  }
  return true;
}

function deriveInternalVoucherValidationReason(voucher, now = new Date()) {
  if (!voucher) return 'NOT_FOUND';
  if (!['active', 'partially_redeemed'].includes(voucher.status)) return 'NOT_REDEEMABLE_STATUS';
  if (!(voucher.expiresAt instanceof Date) || Number.isNaN(voucher.expiresAt.getTime())) return 'MISSING_EXPIRY';
  if (voucher.expiresAt <= now) return 'EXPIRED';
  if (!Number.isInteger(voucher.balanceRemainingCents) || voucher.balanceRemainingCents <= 0) return 'NO_BALANCE';
  return null;
}

function buildPublicGenericVoucherError() {
  return {
    success: false,
    message: 'This voucher cannot be used.'
  };
}

function assertVoucherRedeemable(voucher, { now = new Date() } = {}) {
  const reason = deriveInternalVoucherValidationReason(voucher, now);
  if (!reason) return true;
  const err = new Error('Voucher is not redeemable');
  err.code = reason;
  throw err;
}

function computeRedeemableAmountCents({ voucher, amountDueCents }) {
  assertIntegerCents(amountDueCents, 'amountDueCents');
  assertVoucherMonetaryInvariants(voucher);
  if (amountDueCents < 0) {
    const err = new Error('amountDueCents cannot be negative');
    err.code = 'INVALID_AMOUNT_DUE';
    throw err;
  }
  return Math.min(voucher.balanceRemainingCents, amountDueCents);
}

module.exports = {
  assertIntegerCents,
  assertVoucherMonetaryInvariants,
  deriveInternalVoucherValidationReason,
  buildPublicGenericVoucherError,
  assertVoucherRedeemable,
  computeRedeemableAmountCents
};
