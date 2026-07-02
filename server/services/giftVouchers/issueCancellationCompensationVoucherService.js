const mongoose = require('mongoose');
const GiftVoucher = require('../../models/GiftVoucher');
const {
  ISSUANCE_SOURCE_CANCELLATION_COMPENSATION
} = require('./giftVoucherIssuance');
const { generateUniqueVoucherCode } = require('./giftVoucherCodeService');
const { appendVoucherEvent } = require('./giftVoucherEventService');
const { issueCardAccessToken } = require('./giftVoucherCardAccessService');

const MIN_CREDIT_AMOUNT_CENTS = 10000;
const DEFAULT_EXPIRY_YEARS = 1;
const COMPENSATION_EVENT_TYPE = 'compensation_issued';

function validationError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isDuplicateKeyError(err) {
  return err?.code === 11000;
}

function normalizeObjectId(value, fieldName) {
  if (value == null || value === '') {
    throw validationError(`${fieldName} is required`, 'RESERVATION_ID_REQUIRED');
  }
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw validationError(`${fieldName} must be a valid ObjectId`, 'INVALID_RESERVATION_ID');
  }
  return new mongoose.Types.ObjectId(String(value));
}

function validateCreditAmountCents(creditAmountCents) {
  if (!Number.isInteger(creditAmountCents)) {
    throw validationError('creditAmountCents must be an integer', 'INVALID_CREDIT_AMOUNT');
  }
  if (creditAmountCents < MIN_CREDIT_AMOUNT_CENTS) {
    throw validationError(
      `creditAmountCents must be at least ${MIN_CREDIT_AMOUNT_CENTS}`,
      'CREDIT_AMOUNT_TOO_LOW'
    );
  }
}

function defaultExpiresAt() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + DEFAULT_EXPIRY_YEARS);
  return date;
}

function parseExpiresAt(expiresAt) {
  if (expiresAt == null) {
    return defaultExpiresAt();
  }
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    throw validationError('expiresAt must be a valid date', 'INVALID_EXPIRES_AT');
  }
  return date;
}

function normalizeIdempotencyKey(idempotencyKey) {
  if (idempotencyKey == null) return null;
  const value = String(idempotencyKey).trim();
  return value ? value.slice(0, 120) : null;
}

async function findExistingCompensationVoucher(sourceReservationId) {
  return GiftVoucher.findOne({
    sourceReservationId,
    issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
    status: { $ne: 'voided' }
  }).lean();
}

function formatSuccess(voucher, idempotentReplay) {
  return {
    ok: true,
    idempotentReplay,
    giftVoucherId: String(voucher._id),
    code: voucher.code,
    issuanceSource: voucher.issuanceSource,
    sourceReservationId: String(voucher.sourceReservationId)
  };
}

function assertExistingAmountMatches(existing, creditAmountCents) {
  if (existing.amountOriginalCents !== creditAmountCents) {
    const err = validationError(
      `Existing compensation voucher amount (${existing.amountOriginalCents}) does not match requested credit (${creditAmountCents})`,
      'CREDIT_AMOUNT_MISMATCH'
    );
    err.existingAmountCents = existing.amountOriginalCents;
    err.requestedCreditAmountCents = creditAmountCents;
    throw err;
  }
}

async function issueCancellationCompensationVoucher({
  reservationId,
  creditAmountCents,
  recipientEmail,
  recipientName,
  actor,
  reason,
  expiresAt,
  idempotencyKey
} = {}) {
  const sourceReservationId = normalizeObjectId(reservationId, 'reservationId');
  validateCreditAmountCents(creditAmountCents);

  const normalizedActor = String(actor || '').trim();
  if (!normalizedActor) {
    throw validationError('actor is required', 'ACTOR_REQUIRED');
  }

  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) {
    throw validationError('reason is required', 'REASON_REQUIRED');
  }
  if (normalizedReason.length > 500) {
    throw validationError('reason must be at most 500 characters', 'REASON_TOO_LONG');
  }

  let normalizedRecipientEmail;
  if (recipientEmail != null && String(recipientEmail).trim()) {
    normalizedRecipientEmail = String(recipientEmail).trim().toLowerCase();
  }

  let normalizedRecipientName;
  if (recipientName != null && String(recipientName).trim()) {
    normalizedRecipientName = String(recipientName).trim();
  }

  const expiresAtDate = parseExpiresAt(expiresAt);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);

  const existing = await findExistingCompensationVoucher(sourceReservationId);
  if (existing) {
    assertExistingAmountMatches(existing, creditAmountCents);
    return formatSuccess(existing, true);
  }

  const { code } = await generateUniqueVoucherCode();
  const { tokenHash } = issueCardAccessToken();
  const now = new Date();

  const voucherPayload = {
    status: 'active',
    code,
    activatedAt: now,
    expiresAt: expiresAtDate,
    cardAccessTokenHash: tokenHash,
    amountOriginalCents: creditAmountCents,
    balanceRemainingCents: creditAmountCents,
    currency: 'EUR',
    deliveryMode: 'manual',
    issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
    sourceReservationId,
    issuedByActorId: normalizedActor,
    compensationNote: normalizedReason,
    stripePaymentIntentId: null,
    stripeCheckoutSessionId: null,
    purchaseRequestId: null
  };

  if (normalizedRecipientEmail) {
    voucherPayload.recipientEmail = normalizedRecipientEmail;
  }
  if (normalizedRecipientName) {
    voucherPayload.recipientName = normalizedRecipientName;
  }

  try {
    const created = await GiftVoucher.create(voucherPayload);

    const metadata = {
      issuanceSource: ISSUANCE_SOURCE_CANCELLATION_COMPENSATION,
      sourceReservationId: String(sourceReservationId),
      creditAmountCents
    };
    if (normalizedIdempotencyKey) {
      metadata.idempotencyKey = normalizedIdempotencyKey;
    }

    await appendVoucherEvent({
      giftVoucherId: created._id,
      type: COMPENSATION_EVENT_TYPE,
      actor: normalizedActor,
      note: normalizedReason,
      metadata
    });

    return formatSuccess(created.toObject(), false);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const replay = await findExistingCompensationVoucher(sourceReservationId);
      if (replay) {
        assertExistingAmountMatches(replay, creditAmountCents);
        return formatSuccess(replay, true);
      }
    }
    throw err;
  }
}

module.exports = {
  issueCancellationCompensationVoucher,
  MIN_CREDIT_AMOUNT_CENTS,
  COMPENSATION_EVENT_TYPE
};
