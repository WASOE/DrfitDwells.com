'use strict';

const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { baseBookingFilter } = require('../ops/reporting/reportingFilters');

/**
 * Whether a Booking should own CabinNightClaims (REBOOK-S1 §24.4).
 */
function isValidSingleCabinCommercialShape(booking) {
  if (!booking) return false;
  const cabinId = booking.cabinId;
  const cabinTypeId = booking.cabinTypeId;
  const unitId = booking.unitId;
  if (!cabinId) return false;
  if (cabinTypeId != null && cabinTypeId !== '') return false;
  if (unitId != null && unitId !== '') return false;
  return true;
}

function shouldBookingOwnCabinNightClaims(booking) {
  if (!booking || !booking._id) return false;
  if (!BLOCKING_BOOKING_STATUSES.includes(String(booking.status || ''))) return false;
  if (!isValidSingleCabinCommercialShape(booking)) return false;
  if (booking.isTest === true) return false;
  if (booking.archivedAt) return false;
  const filter = baseBookingFilter();
  if (filter.isTest && booking.isTest === true) return false;
  return true;
}

function describeBookingClaimShape(booking) {
  if (!booking) return 'missing_booking';
  if (booking.cabinTypeId && booking.cabinId) return 'malformed_mixed';
  if (booking.cabinTypeId || booking.unitId) return 'multi_unit';
  if (!booking.cabinId) return 'missing_cabin';
  if (booking.isTest === true) return 'is_test';
  if (booking.archivedAt) return 'archived';
  if (!BLOCKING_BOOKING_STATUSES.includes(String(booking.status || ''))) {
    return 'nonblocking';
  }
  return 'single_cabin_blocking';
}

module.exports = {
  shouldBookingOwnCabinNightClaims,
  isValidSingleCabinCommercialShape,
  describeBookingClaimShape
};
