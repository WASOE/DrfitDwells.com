/**
 * Public availability lodging pricing — aligns search/cabin-type totals with the
 * production booking-quote RatePlan selection + pricing path (lodging only, no extras).
 *
 * Reuses:
 * - bookingQuoteService.resolveSeasonalRatePlanForQuote
 * - pricingService.calculateAuthoritativePriceBreakdown / calculateBaseLodgingPrice
 *
 * Does not select fixed_package plans. Does not silently fall back after ambiguity
 * or RatePlan validation failures.
 */
'use strict';

const promoService = require('./promoService');
const pricingService = require('./pricingService');
const {
  resolveSeasonalRatePlanForQuote
} = require('./bookingQuoteService');

/** Safe operator/guest-facing codes only — never attach server details/stacks. */
const SAFE_PRICING_ERROR_MESSAGES = Object.freeze({
  AMBIGUOUS_SEASONAL_RATE_PLAN:
    'Pricing is temporarily unavailable for this stay. Please try different dates or contact us.',
  SEASONAL_MIN_NIGHTS: 'This seasonal rate requires a longer stay.',
  MALFORMED_SEASONAL_RATE_PLAN:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  RATE_PLAN_LOOKUP_FAILED:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  INVALID_STAY_DATES: 'Please provide a valid stay range.',
  MISSING_ACCOMMODATION_KEY:
    'Pricing is temporarily unavailable for this stay. Please try again later.',
  PRICING_FAILED:
    'Pricing is temporarily unavailable for this stay. Please try again later.'
});

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

function defaultLoadActiveSeasonalRatePlans() {
  const RatePlan = require('../models/RatePlan');
  return RatePlan.find({ status: 'active', type: 'seasonal_stay' }).lean();
}

/**
 * Compute lodging total for a complete public availability stay request.
 *
 * @returns {Promise<
 *   | {
 *       ok: true,
 *       pricingMode: 'exact_stay',
 *       pricingSource: 'entity'|'rate_plan',
 *       currency: string,
 *       totalPrice: number,
 *       lodgingSubtotalBeforePromo: number,
 *       ratePlan: { code: string, version: number, type: 'seasonal_stay' }|null
 *     }
 *   | { ok: false, code: string, message: string }
 * >}
 */
async function pricePublicStayLodging({
  entity,
  checkInDate,
  checkOutDate,
  adults,
  children = 0,
  promoDoc = null,
  loadActiveSeasonalRatePlans
} = {}) {
  const accommodationKey =
    entity && entity.slug != null ? String(entity.slug).trim().toLowerCase() : '';
  if (!accommodationKey) {
    return {
      ok: false,
      code: 'MISSING_ACCOMMODATION_KEY',
      message: SAFE_PRICING_ERROR_MESSAGES.MISSING_ACCOMMODATION_KEY
    };
  }

  const adultsN = parseInt(adults, 10);
  const childrenN = parseInt(children, 10) || 0;
  if (!Number.isInteger(adultsN) || adultsN < 1) {
    return {
      ok: false,
      code: 'INVALID_STAY_DATES',
      message: SAFE_PRICING_ERROR_MESSAGES.INVALID_STAY_DATES
    };
  }

  const loader = loadActiveSeasonalRatePlans || defaultLoadActiveSeasonalRatePlans;

  let seasonal;
  try {
    seasonal = await resolveSeasonalRatePlanForQuote({
      checkInDate,
      checkOutDate,
      accommodationKey,
      loadActiveSeasonalRatePlans: loader
    });
  } catch (err) {
    return {
      ok: false,
      code: 'PRICING_FAILED',
      message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    };
  }

  if (!seasonal || seasonal.ok !== true) {
    const code = seasonal?.code || 'PRICING_FAILED';
    return {
      ok: false,
      code,
      message: SAFE_PRICING_ERROR_MESSAGES[code] || SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    };
  }

  let lodgingSubtotalBeforePromo;
  let currency = 'EUR';
  let pricingSource = 'entity';
  let ratePlan = null;

  try {
    const authoritative = pricingService.calculateAuthoritativePriceBreakdown({
      entity,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      adults: adultsN,
      children: childrenN,
      infants: 0,
      experienceKeys: [],
      opts: {},
      resolvedRatePlan: seasonal.resolved
    });

    if (seasonal.resolved) {
      lodgingSubtotalBeforePromo = roundEuro(
        authoritative.preDiscountTotal != null
          ? authoritative.preDiscountTotal
          : authoritative.totalPrice
      );
      currency = authoritative.currency || seasonal.resolved.currency || 'EUR';
      pricingSource = 'rate_plan';
      ratePlan = {
        code: String(seasonal.resolved.code || ''),
        version: seasonal.resolved.version,
        type: 'seasonal_stay'
      };
    } else {
      // Preserve entity pricing fallback when no seasonal plan applies.
      lodgingSubtotalBeforePromo = pricingService.calculateBaseLodgingPrice(
        entity,
        checkInDate,
        checkOutDate,
        adultsN,
        childrenN
      );
      currency = 'EUR';
      pricingSource = 'entity';
      ratePlan = null;
    }
  } catch (err) {
    return {
      ok: false,
      code: 'PRICING_FAILED',
      message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    };
  }

  let totalPrice = lodgingSubtotalBeforePromo;
  if (promoDoc) {
    const { displayPrice } = promoService.applyValidatedDocToLodging(
      lodgingSubtotalBeforePromo,
      promoDoc
    );
    totalPrice = displayPrice;
  }

  return {
    ok: true,
    pricingMode: 'exact_stay',
    pricingSource,
    currency,
    totalPrice,
    lodgingSubtotalBeforePromo,
    ratePlan
  };
}

/**
 * Build the price fields attached to an availability cabin/cabinType row.
 * On failure: null totals + safe pricingError (never base-price fallback).
 * Never copies priced.message — public text comes only from SAFE_PRICING_ERROR_MESSAGES.
 */
function publicPricingErrorFromCode(code) {
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(SAFE_PRICING_ERROR_MESSAGES, code)) {
    return {
      code,
      message: SAFE_PRICING_ERROR_MESSAGES[code]
    };
  }
  return {
    code: 'PRICING_FAILED',
    message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
  };
}

function availabilityPriceFieldsFromResult(priced) {
  if (priced && priced.ok) {
    return {
      totalPrice: priced.totalPrice,
      lodgingSubtotalBeforePromo: priced.lodgingSubtotalBeforePromo,
      pricingMode: priced.pricingMode,
      pricingSource: priced.pricingSource,
      currency: priced.currency,
      ratePlan: priced.ratePlan,
      pricingError: null
    };
  }
  const pricingError = publicPricingErrorFromCode(priced?.code);
  return {
    totalPrice: null,
    lodgingSubtotalBeforePromo: null,
    pricingMode: null,
    pricingSource: null,
    currency: null,
    ratePlan: null,
    pricingError
  };
}

module.exports = {
  pricePublicStayLodging,
  availabilityPriceFieldsFromResult,
  publicPricingErrorFromCode,
  SAFE_PRICING_ERROR_MESSAGES,
  defaultLoadActiveSeasonalRatePlans
};
