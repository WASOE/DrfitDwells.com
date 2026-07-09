const moment = require('moment-timezone');
const { evaluateLocationConflicts } = require('../ops/domain/locationConflictService');
const { resolveLocationTargets } = require('../ops/domain/locationInventoryService');
const { getLocationEntry } = require('../ops/domain/locationRegistry');
const { createDomainError } = require('../ops/domain/errors');
const { normalizeGuestStayRange } = require('../publicAvailabilityService');
const { normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { getPublicSlugForLocationKey } = require('./locationSlugRegistry');
const { sanitizeLocationConflicts } = require('./publicConflictSanitizer');
const { normalizeRoomAllocation } = require('../../models/schemas/roomAllocationSchema');
const { buildLocationLodgingQuote } = require('./locationQuotePricing');

const PROPERTY_TIMEZONE = 'Europe/Sofia';

function formatDateOnly(date) {
  return moment.tz(date, PROPERTY_TIMEZONE).format('YYYY-MM-DD');
}

function buildUnavailableReason(conflicts) {
  const first = Array.isArray(conflicts) && conflicts.length > 0 ? conflicts[0] : null;
  if (first?.publicMessage) {
    return first.publicMessage;
  }
  return 'The Valley is not available for your selected dates.';
}

/**
 * @param {string} locationKey
 * @param {object} body
 * @param {string} body.checkIn
 * @param {string} body.checkOut
 * @param {number} [body.adults]
 * @param {number} [body.children]
 * @param {object|string} [body.roomAllocation] — optional OPS-only guest distribution
 * @param {string} [body.excludeCheckoutSessionId] — internal: ignore own checkout holds
 */
async function buildPublicLocationQuote(locationKey, body) {
  getLocationEntry(locationKey);

  const {
    checkIn,
    checkOut,
    adults,
    children = 0,
    roomAllocation: rawRoomAllocation,
    excludeCheckoutSessionId = null
  } = body || {};

  if (!checkIn || !checkOut) {
    throw createDomainError('validation', 'checkIn and checkOut are required', null, 400);
  }

  let checkInDate;
  let checkOutDate;
  try {
    const normalized = normalizeGuestStayRange(checkIn, checkOut);
    checkInDate = normalized.startDate;
    checkOutDate = normalized.endDate;
  } catch {
    throw createDomainError(
      'validation',
      'Please provide a valid stay range (check-out must be after check-in)',
      null,
      400
    );
  }

  const todayStart = normalizeDateToSofiaDayStart(new Date());
  if (checkInDate < todayStart) {
    throw createDomainError('validation', 'Check-in date cannot be in the past', null, 400);
  }

  const inventory = await resolveLocationTargets(locationKey);
  if (inventory.inventoryGaps.length > 0) {
    throw createDomainError(
      'validation',
      'Location inventory is incomplete',
      { inventoryGaps: inventory.inventoryGaps },
      422
    );
  }

  const pricing = await buildLocationLodgingQuote({
    inventory,
    checkInDate,
    checkOutDate
  });

  if (!pricing.ok) {
    throw createDomainError('validation', pricing.message, null, pricing.status || 400);
  }

  if (pricing.nights < pricing.maxMinNights) {
    throw createDomainError(
      'validation',
      `This location requires a minimum stay of ${pricing.maxMinNights} night${pricing.maxMinNights !== 1 ? 's' : ''}`,
      { minNights: pricing.maxMinNights },
      400
    );
  }

  const roomAllocation = normalizeRoomAllocation(rawRoomAllocation);

  const evaluation = await evaluateLocationConflicts(locationKey, checkInDate, checkOutDate, {
    excludeCheckoutSessionId
  });
  const locationSlug = getPublicSlugForLocationKey(locationKey);
  const conflicts = sanitizeLocationConflicts(evaluation, inventory);

  const base = {
    locationKey,
    locationSlug,
    locationLabel: inventory.locationLabel,
    checkIn: formatDateOnly(checkInDate),
    checkOut: formatDateOnly(checkOutDate),
    nights: pricing.nights,
    totalSleeps: pricing.totalSleeps,
    includedTargets: pricing.includedTargets,
    currency: 'EUR',
    priceDisclaimer: pricing.priceDisclaimer,
    adults: Math.max(1, parseInt(adults, 10) || 1),
    children: Math.max(0, parseInt(children, 10) || 0),
    ...(roomAllocation ? { roomAllocation } : {})
  };

  if (!evaluation.canBlock) {
    return {
      available: false,
      ...base,
      unavailableReason: buildUnavailableReason(conflicts),
      conflicts
    };
  }

  return {
    available: true,
    ...base,
    totalPrice: pricing.totalPrice,
    lodgingSubtotal: pricing.lodgingSubtotal
  };
}

module.exports = {
  buildPublicLocationQuote
};
