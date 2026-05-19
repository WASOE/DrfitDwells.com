const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError,
  isCheckoutSessionError
} = require('./checkoutSessionErrors');

const CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS = {
  [CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT]: 409,
  [CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED]: 400,
  [CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH]: 409
};

function normalizeFinalizeDate(value) {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Server-trusted booking snapshot for finalize orchestration / fingerprint derivation.
 * Excludes checkoutId and payment fields by design.
 */
function buildTrustedBookingPayloadForFinalize(input) {
  if (!input || typeof input !== 'object') {
    return {
      cabinId: null,
      cabinTypeId: null,
      unitId: null,
      checkIn: null,
      checkOut: null,
      guestInfo: null
    };
  }

  const cabinId = input.cabinId != null && input.cabinId !== '' ? input.cabinId : null;
  const cabinTypeId =
    input.cabinTypeId != null && input.cabinTypeId !== '' ? input.cabinTypeId : null;
  const unitId = input.unitId != null && input.unitId !== '' ? input.unitId : null;

  const guestInfo =
    input.guestInfo && typeof input.guestInfo === 'object' ? { ...input.guestInfo } : null;

  return {
    cabinId,
    cabinTypeId,
    unitId,
    checkIn: normalizeFinalizeDate(input.checkInDate ?? input.checkIn),
    checkOut: normalizeFinalizeDate(input.checkOutDate ?? input.checkOut),
    guestInfo
  };
}

function isFinalizeReplayError(err) {
  if (!isCheckoutSessionError(err)) {
    return false;
  }
  const details = err.details;
  if (!details || typeof details !== 'object') {
    return false;
  }
  return details.idempotentReplay === true && details.replay != null;
}

function getFinalizeReplayFromError(err) {
  if (!isFinalizeReplayError(err)) {
    return null;
  }
  return err.details.replay;
}

function mapFinalizeOrchestrationResultToHttp(result) {
  if (!result || typeof result !== 'object') {
    return {
      statusCode: 201,
      idempotentReplay: false,
      bookingId: null
    };
  }

  const bookingId = result.bookingId != null ? String(result.bookingId) : null;

  if (result.idempotentReplay === true) {
    return {
      statusCode: 200,
      idempotentReplay: true,
      bookingId
    };
  }

  return {
    statusCode: 201,
    idempotentReplay: false,
    bookingId
  };
}

/**
 * HTTP status for CheckoutSessionError codes (C3 finalize extensions + caller fallback).
 */
function mapCheckoutSessionErrorToHttpStatus(code, err) {
  const normalizedCode =
    code || (isCheckoutSessionError(err) ? err.code : null) || null;
  if (normalizedCode && CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS[normalizedCode] != null) {
    return CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS[normalizedCode];
  }
  return undefined;
}

module.exports = {
  CHECKOUT_SESSION_C3_ERROR_HTTP_STATUS,
  buildTrustedBookingPayloadForFinalize,
  isFinalizeReplayError,
  getFinalizeReplayFromError,
  mapFinalizeOrchestrationResultToHttp,
  mapCheckoutSessionErrorToHttpStatus,
  CheckoutSessionError
};
