'use strict';

const MANUAL_RESERVATION_PURPOSES = Object.freeze([
  'paid_guest',
  'creator_influencer',
  'friends_family',
  'owner_use',
  'staff_stay',
  'comp_other',
  'manual_other'
]);

const MANUAL_OPS_PROVENANCE_SOURCES = Object.freeze(['admin_manual', 'operator_manual']);

function isManualOpsReservation(booking) {
  const source = String(booking?.provenance?.source || '').trim();
  return MANUAL_OPS_PROVENANCE_SOURCES.includes(source);
}

/**
 * Whether automatic booking_confirmed should be sent for this booking.
 * Guest-portal and other non-manual bookings: always true (unchanged).
 * Manual OPS: explicit false skips; true sends; null/undefined legacy sends.
 */
function shouldSendAutomaticGuestConfirmation(booking) {
  if (!isManualOpsReservation(booking)) {
    return true;
  }
  if (booking.sendGuestConfirmationEmail === true) {
    return true;
  }
  if (booking.sendGuestConfirmationEmail === false) {
    return false;
  }
  return true;
}

function defaultSendGuestConfirmationForPurpose(purpose) {
  if (purpose === 'paid_guest') {
    return true;
  }
  if (purpose && MANUAL_RESERVATION_PURPOSES.includes(purpose)) {
    return false;
  }
  return null;
}

function normalizeManualReservationPurpose(raw) {
  if (raw == null || raw === '') {
    return null;
  }
  const value = String(raw).trim();
  if (!MANUAL_RESERVATION_PURPOSES.includes(value)) {
    const err = new Error(
      `manualReservationPurpose must be one of: ${MANUAL_RESERVATION_PURPOSES.join(', ')}`
    );
    err.code = 'validation';
    throw err;
  }
  return value;
}

function normalizeSendGuestConfirmationEmail(raw) {
  if (raw === true || raw === false) {
    return raw;
  }
  if (raw == null || raw === '') {
    return null;
  }
  if (raw === 'true' || raw === 1 || raw === '1') {
    return true;
  }
  if (raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return null;
}

/**
 * Resolve stored flag at manual create: explicit body wins, else purpose default, else null (legacy).
 */
function resolveSendGuestConfirmationEmailAtIntake(manualReservationPurpose, sendGuestConfirmationEmail) {
  const explicit = normalizeSendGuestConfirmationEmail(sendGuestConfirmationEmail);
  if (explicit === true || explicit === false) {
    return explicit;
  }
  return defaultSendGuestConfirmationForPurpose(manualReservationPurpose);
}

module.exports = {
  MANUAL_RESERVATION_PURPOSES,
  MANUAL_OPS_PROVENANCE_SOURCES,
  isManualOpsReservation,
  shouldSendAutomaticGuestConfirmation,
  defaultSendGuestConfirmationForPurpose,
  normalizeManualReservationPurpose,
  normalizeSendGuestConfirmationEmail,
  resolveSendGuestConfirmationEmailAtIntake
};
