/**
 * Next same-length availability suggestions for a single listing.
 * Does not modify /api/availability search behavior.
 */
const moment = require('moment-timezone');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const AssignmentEngine = require('./assignmentEngine');
const featureFlags = require('../utils/featureFlags');
const {
  normalizeGuestStayRange,
  isSingleCabinGuestStayAvailable
} = require('./publicAvailabilityService');
const {
  formatSofiaDateOnly,
  normalizeDateToSofiaDayStart,
  PROPERTY_TIMEZONE
} = require('../utils/dateTime');

const DEFAULT_MAX_SHIFT_DAYS = 90;
const MAX_MAX_SHIFT_DAYS = 180;

function parseMaxShiftDays(raw) {
  if (raw == null || raw === '') return DEFAULT_MAX_SHIFT_DAYS;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_SHIFT_DAYS;
  return Math.min(n, MAX_MAX_SHIFT_DAYS);
}

function addSofiaDays(dateInput, days) {
  return moment.tz(dateInput, PROPERTY_TIMEZONE).startOf('day').add(days, 'days').toDate();
}

/**
 * @param {object} input
 * @param {string} input.checkIn
 * @param {string} input.checkOut
 * @param {number} input.adults
 * @param {number} [input.children]
 * @param {string} [input.cabinId]
 * @param {string} [input.cabinTypeId]
 * @param {number} [input.maxShiftDays]
 * @returns {Promise<object>} data payload for API response
 */
async function findNextSameLengthAvailability(input) {
  const {
    checkIn,
    checkOut,
    adults: adultsRaw,
    children: childrenRaw = 0,
    cabinId,
    cabinTypeId,
    maxShiftDays: maxShiftDaysRaw
  } = input;

  const hasCabinId = Boolean(cabinId);
  const hasCabinTypeId = Boolean(cabinTypeId);
  if (hasCabinId === hasCabinTypeId) {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId: cabinId || undefined,
      cabinTypeId: cabinTypeId || undefined,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }

  let checkInDate;
  let checkOutDate;
  try {
    const n = normalizeGuestStayRange(checkIn, checkOut);
    checkInDate = n.startDate;
    checkOutDate = n.endDate;
  } catch {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId,
      cabinTypeId,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }

  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  if (totalNights < 1) {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId,
      cabinTypeId,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }

  const todayStart = normalizeDateToSofiaDayStart(new Date());
  if (checkInDate < todayStart) {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId,
      cabinTypeId,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }

  const adults = parseInt(adultsRaw, 10);
  const children = parseInt(childrenRaw, 10) || 0;
  if (!Number.isFinite(adults) || adults < 1 || adults > 10) {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId,
      cabinTypeId,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }
  if (children < 0 || children > 10) {
    return basePayload({
      listingType: hasCabinId ? 'cabin' : 'cabinType',
      cabinId,
      cabinTypeId,
      reasonSkipped: 'invalid_request',
      scannedDays: 0
    });
  }

  const totalGuests = adults + children;
  const maxShiftDays = parseMaxShiftDays(maxShiftDaysRaw);

  if (hasCabinId) {
    return findForSingleCabin({
      cabinId,
      checkInDate,
      checkOutDate,
      totalNights,
      totalGuests,
      maxShiftDays,
      checkIn,
      checkOut
    });
  }

  return findForCabinType({
    cabinTypeId,
    checkInDate,
    checkOutDate,
    totalNights,
    totalGuests,
    maxShiftDays,
    checkIn,
    checkOut
  });
}

function basePayload({
  listingType,
  cabinId,
  cabinTypeId,
  sameLength = null,
  scannedDays,
  reasonSkipped
}) {
  const data = {
    listingType,
    sameLength,
    scannedDays,
    reasonSkipped
  };
  if (listingType === 'cabin' && cabinId) {
    data.cabinId = String(cabinId);
  }
  if (listingType === 'cabinType' && cabinTypeId) {
    data.cabinTypeId = String(cabinTypeId);
  }
  return data;
}

function eligibilitySkipReason(entity, totalGuests, totalNights) {
  const minGuests = entity.minGuests || 1;
  const capacity = entity.capacity;
  const minNights = entity.minNights || 1;

  if (totalGuests < minGuests) return 'min_guests';
  if (totalGuests > capacity) return 'max_guests';
  if (totalNights < minNights) return 'min_nights';
  return null;
}

async function isCabinTypeRangeAvailable(cabinTypeId, checkInDate, checkOutDate) {
  const summary = await AssignmentEngine.getAvailabilitySummary(
    cabinTypeId,
    checkInDate,
    checkOutDate
  );
  return summary.availableUnits.length > 0;
}

async function findForSingleCabin({
  cabinId,
  checkInDate,
  checkOutDate,
  totalNights,
  totalGuests,
  maxShiftDays,
  checkIn,
  checkOut
}) {
  const cabin = await Cabin.findById(cabinId);
  if (!cabin || !cabin.isActive) {
    return basePayload({
      listingType: 'cabin',
      cabinId,
      reasonSkipped: 'invalid_listing',
      scannedDays: 0
    });
  }

  const skip = eligibilitySkipReason(cabin, totalGuests, totalNights);
  if (skip) {
    return basePayload({
      listingType: 'cabin',
      cabinId,
      reasonSkipped: skip,
      scannedDays: 0
    });
  }

  const requestedAvailable = await isSingleCabinGuestStayAvailable(cabin, checkIn, checkOut);
  if (requestedAvailable) {
    return basePayload({
      listingType: 'cabin',
      cabinId,
      reasonSkipped: 'already_available',
      scannedDays: 0
    });
  }

  const found = await scanForwardSameLength({
    totalNights,
    maxShiftDays,
    originCheckInDate: checkInDate,
    isRangeAvailable: (candidateCheckIn, candidateCheckOut) =>
      isSingleCabinGuestStayAvailable(cabin, candidateCheckIn, candidateCheckOut)
  });

  if (!found) {
    return basePayload({
      listingType: 'cabin',
      cabinId,
      reasonSkipped: 'no_availability_found',
      scannedDays: maxShiftDays
    });
  }

  return basePayload({
    listingType: 'cabin',
    cabinId,
    sameLength: {
      checkIn: formatSofiaDateOnly(found.checkInDate),
      checkOut: formatSofiaDateOnly(found.checkOutDate),
      nights: totalNights,
      currency: 'EUR'
    },
    scannedDays: maxShiftDays,
    reasonSkipped: null
  });
}

async function findForCabinType({
  cabinTypeId,
  checkInDate,
  checkOutDate,
  totalNights,
  totalGuests,
  maxShiftDays,
  checkIn,
  checkOut
}) {
  const cabinType = await CabinType.findById(cabinTypeId);
  if (!cabinType || !cabinType.isActive) {
    return basePayload({
      listingType: 'cabinType',
      cabinTypeId,
      reasonSkipped: 'invalid_listing',
      scannedDays: 0
    });
  }

  if (!featureFlags.isMultiUnitGloballyEnabled() || !featureFlags.isMultiUnitType(cabinType.slug)) {
    return basePayload({
      listingType: 'cabinType',
      cabinTypeId,
      reasonSkipped: 'invalid_listing',
      scannedDays: 0
    });
  }

  const skip = eligibilitySkipReason(cabinType, totalGuests, totalNights);
  if (skip) {
    return basePayload({
      listingType: 'cabinType',
      cabinTypeId,
      reasonSkipped: skip,
      scannedDays: 0
    });
  }

  const requestedAvailable = await isCabinTypeRangeAvailable(
    cabinType._id,
    checkInDate,
    checkOutDate
  );
  if (requestedAvailable) {
    return basePayload({
      listingType: 'cabinType',
      cabinTypeId,
      reasonSkipped: 'already_available',
      scannedDays: 0
    });
  }

  const found = await scanForwardSameLength({
    totalNights,
    maxShiftDays,
    originCheckInDate: checkInDate,
    isRangeAvailable: (candidateCheckIn, candidateCheckOut) =>
      isCabinTypeRangeAvailable(cabinType._id, candidateCheckIn, candidateCheckOut)
  });

  if (!found) {
    return basePayload({
      listingType: 'cabinType',
      cabinTypeId,
      reasonSkipped: 'no_availability_found',
      scannedDays: maxShiftDays
    });
  }

  return basePayload({
    listingType: 'cabinType',
    cabinTypeId,
    sameLength: {
      checkIn: formatSofiaDateOnly(found.checkInDate),
      checkOut: formatSofiaDateOnly(found.checkOutDate),
      nights: totalNights,
      currency: 'EUR'
    },
    scannedDays: maxShiftDays,
    reasonSkipped: null
  });
}

/**
 * Scan candidate check-ins from origin+1 day through maxShiftDays forward shifts.
 */
async function scanForwardSameLength({
  totalNights,
  maxShiftDays,
  originCheckInDate,
  isRangeAvailable
}) {
  for (let shift = 1; shift <= maxShiftDays; shift += 1) {
    const candidateCheckIn = addSofiaDays(originCheckInDate, shift);
    const candidateCheckOut = addSofiaDays(candidateCheckIn, totalNights);
    const ok = await isRangeAvailable(candidateCheckIn, candidateCheckOut);
    if (ok) {
      return { checkInDate: candidateCheckIn, checkOutDate: candidateCheckOut };
    }
  }
  return null;
}

module.exports = {
  findNextSameLengthAvailability,
  DEFAULT_MAX_SHIFT_DAYS,
  MAX_MAX_SHIFT_DAYS
};
