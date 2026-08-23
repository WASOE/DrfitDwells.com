'use strict';

const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { baseBookingFilter } = require('../ops/reporting/reportingFilters');

/** Commercial inventory identity classes (REBOOK-S1.3). */
const COMMERCIAL_SHAPES = Object.freeze({
  VALID_SINGLE: 'VALID_SINGLE',
  VALID_ALLOCATED_MULTI: 'VALID_ALLOCATED_MULTI',
  UNALLOCATED_MULTI: 'UNALLOCATED_MULTI',
  MIXED: 'MIXED',
  MISSING_PRODUCT: 'MISSING_PRODUCT',
  OTHER_MALFORMED: 'OTHER_MALFORMED'
});

function hasId(value) {
  return value != null && value !== '';
}

/**
 * Classify commercial inventory identity independently of blocking/test/archive.
 */
function classifyCommercialInventoryShape(booking) {
  if (!booking) return COMMERCIAL_SHAPES.MISSING_PRODUCT;
  const cabinId = hasId(booking.cabinId);
  const cabinTypeId = hasId(booking.cabinTypeId);
  const unitId = hasId(booking.unitId);

  if (cabinId && !cabinTypeId && !unitId) return COMMERCIAL_SHAPES.VALID_SINGLE;
  if (!cabinId && cabinTypeId && unitId) return COMMERCIAL_SHAPES.VALID_ALLOCATED_MULTI;
  if (!cabinId && cabinTypeId && !unitId) return COMMERCIAL_SHAPES.UNALLOCATED_MULTI;
  if (cabinId && cabinTypeId) return COMMERCIAL_SHAPES.MIXED;
  if (!cabinId && !cabinTypeId && !unitId) return COMMERCIAL_SHAPES.MISSING_PRODUCT;
  // e.g. cabinId+unitId without cabinTypeId, or unitId alone
  return COMMERCIAL_SHAPES.OTHER_MALFORMED;
}

/**
 * Whether a Booking should own CabinNightClaims (REBOOK-S1 §24.4).
 */
function isValidSingleCabinCommercialShape(booking) {
  return classifyCommercialInventoryShape(booking) === COMMERCIAL_SHAPES.VALID_SINGLE;
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
  const commercial = classifyCommercialInventoryShape(booking);
  if (commercial === COMMERCIAL_SHAPES.MIXED) return 'malformed_mixed';
  if (
    commercial === COMMERCIAL_SHAPES.VALID_ALLOCATED_MULTI ||
    commercial === COMMERCIAL_SHAPES.UNALLOCATED_MULTI
  ) {
    return 'multi_unit';
  }
  if (commercial === COMMERCIAL_SHAPES.MISSING_PRODUCT) return 'missing_cabin';
  if (commercial === COMMERCIAL_SHAPES.OTHER_MALFORMED) return 'other_malformed';
  if (booking.isTest === true) return 'is_test';
  if (booking.archivedAt) return 'archived';
  if (!BLOCKING_BOOKING_STATUSES.includes(String(booking.status || ''))) {
    return 'nonblocking';
  }
  return 'single_cabin_blocking';
}

function isLocationLinkedBooking(booking) {
  return Boolean(booking && hasId(booking.locationBookingId));
}

module.exports = {
  COMMERCIAL_SHAPES,
  classifyCommercialInventoryShape,
  shouldBookingOwnCabinNightClaims,
  isValidSingleCabinCommercialShape,
  describeBookingClaimShape,
  isLocationLinkedBooking
};
