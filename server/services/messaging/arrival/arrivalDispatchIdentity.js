'use strict';

/**
 * Durable MessageDispatch idempotency keys for Arrival Communications V2.
 *
 * initial is booking-scoped (not date-scoped) so a date change after an
 * accepted initial cannot mint a second "initial" send.
 *
 * Corrections use a durable booking-scoped communication revision number
 * (not a content fingerprint) so A→B→A→B can notify each necessary
 * transition while repeated processing of the same revision is a no-op.
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

/**
 * @param {string|import('mongoose').Types.ObjectId} bookingId
 * @param {number|string} revision — integer >= 1
 */
function buildCorrectionArrivalIdempotencyKey(bookingId, revision) {
  const rev = typeof revision === 'number' ? revision : Number.parseInt(String(revision), 10);
  if (!Number.isInteger(rev) || rev < 1) {
    throw new Error('arrivalDispatchIdentity: correction revision must be an integer >= 1');
  }
  return `arrival_v2:email:${assertBookingId(bookingId)}:correction:rev:${rev}`;
}

module.exports = {
  buildInitialArrivalIdempotencyKey,
  buildResendArrivalIdempotencyKey,
  buildCorrectionArrivalIdempotencyKey
};
