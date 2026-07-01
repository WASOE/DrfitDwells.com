const {
  MIN_GIFT_VOUCHER_AMOUNT_CENTS,
  PUBLIC_VOUCHER_ERROR_MESSAGE,
  isGuestSafeVoucherFailureCode
} = require('./giftVoucherConstants');

function assertIntegerCents(value, fieldName) {
  if (!Number.isInteger(value)) {
    const err = new Error(`${fieldName} must be an integer cents value`);
    err.code = 'INVALID_CENTS_VALUE';
    err.field = fieldName;
    throw err;
  }
  return true;
}

function coerceVoucherDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function assertVoucherMonetaryInvariants(voucherLike) {
  const amountOriginalCents = Number(voucherLike?.amountOriginalCents);
  const balanceRemainingCents = Number(voucherLike?.balanceRemainingCents);

  assertIntegerCents(amountOriginalCents, 'amountOriginalCents');
  assertIntegerCents(balanceRemainingCents, 'balanceRemainingCents');

  if (amountOriginalCents < MIN_GIFT_VOUCHER_AMOUNT_CENTS) {
    const err = new Error(
      `amountOriginalCents must be at least ${MIN_GIFT_VOUCHER_AMOUNT_CENTS}`
    );
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
  const expiresAt = coerceVoucherDate(voucher.expiresAt);
  if (!expiresAt) return 'MISSING_EXPIRY';
  if (expiresAt <= now) return 'EXPIRED';
  if (!Number.isInteger(voucher.balanceRemainingCents) || voucher.balanceRemainingCents <= 0) {
    return 'NO_BALANCE';
  }
  return null;
}

function buildPublicGenericVoucherError() {
  return {
    success: false,
    message: PUBLIC_VOUCHER_ERROR_MESSAGE
  };
}

function buildVoucherBookingValidationFailure(internalCode, totalValueCents) {
  return {
    ok: false,
    success: false,
    publicMessage: PUBLIC_VOUCHER_ERROR_MESSAGE,
    message: PUBLIC_VOUCHER_ERROR_MESSAGE,
    internalCode: internalCode || 'VOUCHER_VALIDATION_FAILED',
    voucherAppliedCents: 0,
    remainingDueCents: Math.max(0, Number(totalValueCents) || 0),
    fullVoucherCoverage: false
  };
}

function buildVoucherBookingValidationSuccess({ voucher, voucherCode, totalValueCents }) {
  const voucherAppliedCents = computeRedeemableAmountCents({
    voucher,
    amountDueCents: totalValueCents
  });
  return {
    ok: true,
    success: true,
    publicMessage: null,
    message: null,
    internalCode: null,
    voucherAppliedCents,
    remainingDueCents: Math.max(0, totalValueCents - voucherAppliedCents),
    fullVoucherCoverage: voucherAppliedCents >= totalValueCents,
    giftVoucherId: String(voucher._id),
    voucherCode
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

/**
 * Shared quote + payment-intent voucher validation result.
 */
function evaluateVoucherForBookingAmount({
  voucher,
  voucherCode,
  totalValueCents,
  now = new Date()
}) {
  assertIntegerCents(totalValueCents, 'totalValueCents');
  if (!voucher) {
    return buildVoucherBookingValidationFailure('NOT_FOUND', totalValueCents);
  }
  try {
    assertVoucherRedeemable(voucher, { now });
    return buildVoucherBookingValidationSuccess({
      voucher,
      voucherCode,
      totalValueCents
    });
  } catch (err) {
    return buildVoucherBookingValidationFailure(err.code, totalValueCents);
  }
}

function voucherValidationError(err) {
  const code = err?.code || 'VOUCHER_VALIDATION_FAILED';
  const wrapped = new Error(PUBLIC_VOUCHER_ERROR_MESSAGE);
  wrapped.code = code;
  wrapped.internalCode = code;
  wrapped.isGuestSafeVoucherFailure = isGuestSafeVoucherFailureCode(code);
  return wrapped;
}

module.exports = {
  MIN_GIFT_VOUCHER_AMOUNT_CENTS,
  PUBLIC_VOUCHER_ERROR_MESSAGE,
  isGuestSafeVoucherFailureCode,
  assertIntegerCents,
  coerceVoucherDate,
  assertVoucherMonetaryInvariants,
  deriveInternalVoucherValidationReason,
  buildPublicGenericVoucherError,
  buildVoucherBookingValidationFailure,
  buildVoucherBookingValidationSuccess,
  assertVoucherRedeemable,
  computeRedeemableAmountCents,
  evaluateVoucherForBookingAmount,
  voucherValidationError
};
