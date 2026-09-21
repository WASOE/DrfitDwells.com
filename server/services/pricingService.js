/**
 * Shared pricing logic for cabin bookings.
 * Used by create-payment-intent and booking creation to ensure consistency.
 * Never trust client-supplied amounts.
 */
const moment = require('moment');

/**
 * Human guest count for lodging (adults + children). Pets never count.
 */
function humanGuestCount(adults, children = 0) {
  return Math.max(0, parseInt(adults, 10) || 0) + Math.max(0, parseInt(children, 10) || 0);
}

/**
 * Nightly lodging rate for an entity given human guest count.
 * Models:
 * - per_night: flat pricePerNight
 * - per_person: pricePerNight × guests (legacy)
 * - base_plus_extra: pricePerNight for up to includedGuests, then +extraGuestPricePerNight per extra guest
 */
function calculateNightlyLodgingRate(entity, adults, children = 0) {
  const rate = Number(entity?.pricePerNight) || 0;
  const guests = humanGuestCount(adults, children);
  const model = entity?.pricingModel || 'per_night';

  if (model === 'per_person') {
    return rate * Math.max(guests, 1);
  }

  if (model === 'base_plus_extra') {
    const included = Math.max(0, parseInt(entity.includedGuests, 10) || 0);
    const extraRate = Number(entity.extraGuestPricePerNight) || 0;
    const extraGuests = Math.max(0, guests - included);
    return rate + extraGuests * extraRate;
  }

  return rate;
}

/**
 * Nights × nightly rate. Excludes experiences, transport, romantic setup.
 * Pets never affect lodging.
 */
function calculateBaseLodgingPrice(entity, checkIn, checkOut, adults, children = 0) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const nightly = calculateNightlyLodgingRate(entity, adults, children);
  return Math.round(totalNights * nightly * 100) / 100;
}

/**
 * Full price split: lodging (promo-eligible in v1) vs extras (experiences + transport + romantic).
 */
function calculateCabinPriceBreakdown(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  const totalNights = moment(checkOutDate).diff(moment(checkInDate), 'days');
  const totalGuests = humanGuestCount(adults, children);

  const baseLodgingPrice = calculateBaseLodgingPrice(entity, checkIn, checkOut, adults, children);

  const experiences = Array.isArray(entity.experiences)
    ? entity.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(experiences.map(e => e.key));

  let extrasTotal = 0;
  const keysUsed = [];
  const uniqueKeys = [...new Set(Array.isArray(experienceKeys) ? experienceKeys : [])];
  for (const key of uniqueKeys) {
    if (!allowedKeys.has(key)) continue;
    const exp = experiences.find(e => e.key === key);
    if (exp) {
      const qty = exp.unit === 'per_guest' ? Math.max(totalGuests, 1) : 1;
      extrasTotal += (exp.price || 0) * qty;
      keysUsed.push(key);
    }
  }

  if (opts.transportMethod && opts.transportMethod !== 'Not selected') {
    const transportOptions = entity.transportOptions || [];
    const opt = transportOptions.find(t => t && t.type === opts.transportMethod);
    if (opt && opt.pricePerPerson != null) {
      extrasTotal += opt.pricePerPerson * totalGuests;
    }
  }

  if (opts.romanticSetup) {
    extrasTotal += 30;
  }

  extrasTotal = Math.round(extrasTotal * 100) / 100;
  const totalPrice = Math.round((baseLodgingPrice + extrasTotal) * 100) / 100;

  return {
    baseLodgingPrice,
    extrasTotal,
    totalPrice,
    totalNights,
    experienceKeysUsed: keysUsed
  };
}

function calculateCabinPrice(entity, checkIn, checkOut, adults, children = 0, experienceKeys = [], opts = {}) {
  const b = calculateCabinPriceBreakdown(entity, checkIn, checkOut, adults, children, experienceKeys, opts);
  return { totalPrice: b.totalPrice, totalNights: b.totalNights, experienceKeysUsed: b.experienceKeysUsed };
}

/**
 * Validate experienceKeys: reject if any key is not in cabin's allowed list.
 * @returns {string|null} Error message or null if valid
 */
function validateExperienceKeys(entity, experienceKeys) {
  const experiences = Array.isArray(entity.experiences)
    ? entity.experiences.filter(e => e && e.active !== false)
    : [];
  const allowedKeys = new Set(experiences.map(e => e.key));
  const keys = Array.isArray(experienceKeys) ? experienceKeys : [];
  const unknown = keys.filter(k => k && !allowedKeys.has(k));
  return unknown.length > 0 ? `Invalid experience key(s): ${unknown.join(', ')}` : null;
}

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

/** Client-supplied money fields are never trusted as pricing inputs. */
const CLIENT_PRICE_OVERRIDE_KEYS = new Set([
  'price',
  'totalPrice',
  'total',
  'amount',
  'clientPrice',
  'nightlyRate',
  'baseLodgingPrice',
  'extrasTotal',
  'overridePricing',
  'pricingOverride',
  'preDiscountTotal',
  'finalTotal'
]);

function assertNonNegativeIntegerCount(value, field, { required }) {
  if (value === undefined || value === null) {
    if (required) {
      throw new PricingError('MISSING_PARTICIPANT_COUNT', `${field} is required`);
    }
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PricingError(
      'INVALID_PARTICIPANT_COUNT',
      `${field} must be a non-negative integer`
    );
  }
  return value;
}

function nightsFromStay(checkIn, checkOut) {
  const checkInDate = moment(checkIn).startOf('day').toDate();
  const checkOutDate = moment(checkOut).startOf('day').toDate();
  return moment(checkOutDate).diff(moment(checkInDate), 'days');
}

/**
 * Price a stay from a server-resolved RatePlan snapshot (from ratePlanService).
 * Does not load Mongo, re-select plans, or mutate the snapshot.
 * Ignores any client-supplied price override fields on `counts`.
 *
 * @param {object} resolvedRatePlan - immutable snapshot from ratePlanService
 * @param {object} [counts]
 * @param {number} [counts.adults]
 * @param {number} [counts.children]
 * @param {number} [counts.infants]
 */
function calculateRatePlanPriceBreakdown(resolvedRatePlan, counts = {}) {
  if (!resolvedRatePlan || typeof resolvedRatePlan !== 'object') {
    throw new PricingError('MISSING_RATE_PLAN', 'resolvedRatePlan is required');
  }

  const input = counts && typeof counts === 'object' ? counts : {};
  for (const key of CLIENT_PRICE_OVERRIDE_KEYS) {
    // Explicitly ignore — never read as pricing authority.
    void input[key];
  }

  const accommodationKey = resolvedRatePlan.accommodation?.accommodationKey;
  if (!accommodationKey) {
    throw new PricingError(
      'ACCOMMODATION_NOT_APPLICABLE',
      'Resolved rate plan is missing accommodation applicability'
    );
  }

  const pricing = resolvedRatePlan.pricing;
  if (!pricing || typeof pricing !== 'object') {
    throw new PricingError('MISSING_PRICING', 'Resolved rate plan is missing pricing');
  }

  const pricingMethod = pricing.pricingMethod;
  const checkIn = resolvedRatePlan.dates?.checkIn;
  const checkOut = resolvedRatePlan.dates?.checkOut;
  if (checkIn == null || checkOut == null) {
    throw new PricingError('MISSING_STAY_DATES', 'Resolved rate plan is missing stay dates');
  }

  const numberOfNights = nightsFromStay(checkIn, checkOut);
  if (!Number.isFinite(numberOfNights) || numberOfNights < 1) {
    throw new PricingError('INVALID_STAY_DATES', 'Stay must include at least one night');
  }

  const participantRequired = pricingMethod === 'fixed_per_participant';
  const adults = assertNonNegativeIntegerCount(input.adults, 'adults', {
    required: participantRequired
  });
  const children = assertNonNegativeIntegerCount(input.children, 'children', {
    required: participantRequired
  });
  const infants = assertNonNegativeIntegerCount(input.infants, 'infants', {
    required: participantRequired
  });

  const lodgingGuests = adults + children;
  const totalParticipants = adults + children + infants;

  let baseLodgingAmount = 0;
  let additionalGuestAmount = 0;
  let adultAmount = 0;
  let childAmount = 0;
  let infantAmount = 0;

  if (pricingMethod === 'nightly_per_unit') {
    const nightly = Number(pricing.nightlyPerUnitAmount) || 0;
    baseLodgingAmount = roundEuro(nightly * numberOfNights);
  } else if (pricingMethod === 'nightly_base_plus_extra_guest') {
    const nightlyBase = Number(pricing.nightlyPerUnitAmount) || 0;
    const included = Math.max(0, parseInt(pricing.includedGuests, 10) || 0);
    const extraNightly = Number(pricing.additionalGuestNightlyAmount) || 0;
    const extraGuests = Math.max(0, lodgingGuests - included);
    baseLodgingAmount = roundEuro(nightlyBase * numberOfNights);
    additionalGuestAmount = roundEuro(extraNightly * extraGuests * numberOfNights);
  } else if (pricingMethod === 'fixed_per_unit') {
    baseLodgingAmount = roundEuro(Number(pricing.fixedPerUnitAmount) || 0);
  } else if (pricingMethod === 'fixed_per_participant') {
    adultAmount = roundEuro(adults * (Number(pricing.adultPackageAmount) || 0));
    childAmount = roundEuro(children * (Number(pricing.childPackageAmount) || 0));
    infantAmount = roundEuro(infants * (Number(pricing.infantPackageAmount) || 0));
  } else {
    throw new PricingError(
      'UNSUPPORTED_PRICING_METHOD',
      `Unsupported pricing method: ${pricingMethod == null ? '(missing)' : pricingMethod}`
    );
  }

  const preDiscountTotal = roundEuro(
    baseLodgingAmount + additionalGuestAmount + adultAmount + childAmount + infantAmount
  );

  return {
    ratePlanCode: resolvedRatePlan.code,
    ratePlanVersion: resolvedRatePlan.version,
    ratePlanType: resolvedRatePlan.type,
    currency: resolvedRatePlan.currency || pricing.currency || 'EUR',
    accommodationKey,
    pricingMethod,
    numberOfNights,
    guests: {
      adults,
      children,
      infants,
      lodgingGuests,
      totalParticipants
    },
    baseLodgingAmount,
    additionalGuestAmount,
    adultAmount,
    childAmount,
    infantAmount,
    preDiscountTotal,
    /** Final lodging total before promos, vouchers, or other external discounts. */
    finalTotalBeforeExternalDiscounts: preDiscountTotal,
    totalPrice: preDiscountTotal
  };
}

/**
 * Authoritative lodging dispatcher.
 * - No resolvedRatePlan → existing normal entity pricing (unchanged).
 * - With resolvedRatePlan → RatePlan pricing only (server snapshot; no client overrides).
 */
function calculateAuthoritativePriceBreakdown({
  entity,
  checkIn,
  checkOut,
  adults,
  children = 0,
  infants = 0,
  experienceKeys = [],
  opts = {},
  resolvedRatePlan = null
} = {}) {
  if (resolvedRatePlan) {
    return calculateRatePlanPriceBreakdown(resolvedRatePlan, {
      adults,
      children,
      infants
    });
  }
  return calculateCabinPriceBreakdown(
    entity,
    checkIn,
    checkOut,
    adults,
    children,
    experienceKeys,
    opts
  );
}

module.exports = {
  calculateCabinPrice,
  calculateCabinPriceBreakdown,
  calculateBaseLodgingPrice,
  calculateNightlyLodgingRate,
  humanGuestCount,
  validateExperienceKeys,
  calculateRatePlanPriceBreakdown,
  calculateAuthoritativePriceBreakdown,
  PricingError,
  roundEuro
};
