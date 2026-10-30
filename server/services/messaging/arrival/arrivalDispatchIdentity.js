'use strict';

/**
 * Durable MessageDispatch idempotency keys for Arrival Communications V2.
 *
 * initial is booking-scoped (not date-scoped) so a date change after an
 * accepted initial cannot mint a second "initial" send.
 */

function assertBookingId(bookingId) {
  const id = bookingId != null ? String(bookingId).trim() : '';
  if (!id) throw new Error('arrivalDispatchIdentity: missing bookingId');
  return id;
}

function buildInitialArrivalIdempotencyKey(bookingId) {
  return `arrival_v2:email:${assertBookingId(bookingId)}:initial`;
}

function buildResendArrivalIdempotencyKey(bookingId, operationId) {
  const op = operationId != null ? String(operationId).trim() : '';
  if (!op) throw new Error('arrivalDispatchIdentity: missing resend operationId');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(op)) {
    throw new Error('arrivalDispatchIdentity: invalid resend operationId');
  }
  return `arrival_v2:email:${assertBookingId(bookingId)}:resend:${op}`;
}

function buildCorrectionArrivalIdempotencyKey(bookingId, materialFingerprint) {
  const fp = materialFingerprint != null ? String(materialFingerprint).trim() : '';
  if (!fp) throw new Error('arrivalDispatchIdentity: missing materialFingerprint');
  return `arrival_v2:email:${assertBookingId(bookingId)}:correction:${fp}`;
}

module.exports = {
  buildInitialArrivalIdempotencyKey,
  buildResendArrivalIdempotencyKey,
  buildCorrectionArrivalIdempotencyKey
};
