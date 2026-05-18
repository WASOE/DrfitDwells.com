const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { buildStayFingerprint } = require('./checkoutSessionFingerprints');

function normalizeGuestEmail(raw) {
  if (raw == null) return '';
  return String(raw).trim().toLowerCase();
}

function toCheckInOutDateOnly(value) {
  if (value == null || value === '') return '';
  return formatSofiaDateOnly(value);
}

/**
 * Normalize a Booking document for commercial-stay fingerprint (C3).
 * Uses cabinId or cabinTypeId only — never unitId.
 */
function normalizeBookingForCommercialStay(booking) {
  if (!booking) {
    return null;
  }
  const guestEmail = normalizeGuestEmail(booking.guestInfo?.email);
  const cabinTypeId = booking.cabinTypeId ? String(booking.cabinTypeId) : '';
  const cabinId = booking.cabinId ? String(booking.cabinId) : '';

  let entityType = null;
  let entityId = '';
  if (cabinTypeId) {
    entityType = 'cabinType';
    entityId = cabinTypeId;
  } else if (cabinId) {
    entityType = 'cabin';
    entityId = cabinId;
  }

  return {
    guestEmail,
    entityType,
    entityId,
    cabinId: cabinId || null,
    cabinTypeId: cabinTypeId || null,
    checkInDateOnly: toCheckInOutDateOnly(booking.checkIn),
    checkOutDateOnly: toCheckInOutDateOnly(booking.checkOut),
    status: booking.status || null
  };
}

function buildCommercialStayFingerprintFromBooking(booking) {
  const normalized = normalizeBookingForCommercialStay(booking);
  if (!normalized || !normalized.entityType || !normalized.entityId) {
    return null;
  }
  if (!normalized.guestEmail) {
    return null;
  }
  if (!normalized.checkInDateOnly || !normalized.checkOutDateOnly) {
    return null;
  }

  const payload = {
    guestEmail: normalized.guestEmail,
    checkInDateOnly: normalized.checkInDateOnly,
    checkOutDateOnly: normalized.checkOutDateOnly
  };
  if (normalized.entityType === 'cabinType') {
    payload.entityType = 'cabinType';
    payload.cabinTypeId = normalized.entityId;
  } else {
    payload.entityType = 'cabin';
    payload.cabinId = normalized.entityId;
  }

  return buildStayFingerprint(payload);
}

function isBlockingBookingStatus(status) {
  return BLOCKING_BOOKING_STATUSES.includes(status);
}

function isArchivedBooking(booking) {
  return booking?.archivedAt != null;
}

module.exports = {
  BLOCKING_BOOKING_STATUSES,
  normalizeGuestEmail,
  toCheckInOutDateOnly,
  normalizeBookingForCommercialStay,
  buildCommercialStayFingerprintFromBooking,
  isBlockingBookingStatus,
  isArchivedBooking
};
