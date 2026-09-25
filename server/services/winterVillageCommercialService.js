'use strict';

const {
  buildFixedPackageQuote,
  buildQuoteForResolvedEntity
} = require('./bookingQuoteService');
const {
  getWinterVillageProduct,
  resolveWinterVillageOffer
} = require('../config/winterVillageCommercialCatalog');

class WinterVillageCommercialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WinterVillageCommercialError';
    this.code = code;
  }
}

/**
 * Quote a fixed-date Winter Village offer through the existing package quote
 * boundary. This service only resolves the product/date identity; all money,
 * participant eligibility, inventory, and snapshots remain in bookingQuoteService.
 */
async function buildWinterVillageFixedPackageQuote(input = {}, deps = {}) {
  const {
    productId,
    checkIn,
    checkOut,
    accommodationKey,
    entity,
    participants
  } = input;
  const product = getWinterVillageProduct(productId);
  if (!product) {
    throw new WinterVillageCommercialError(
      'WINTER_PRODUCT_NOT_FOUND',
      `Unknown Winter Village product: ${productId}`
    );
  }
  if (product.kind !== 'fixed_package') {
    throw new WinterVillageCommercialError(
      'WINTER_PRODUCT_NOT_FIXED_PACKAGE',
      `Winter Village product ${productId} is not a fixed-date package`
    );
  }

  const offer = resolveWinterVillageOffer(productId, checkIn, checkOut);
  if (!offer) {
    throw new WinterVillageCommercialError(
      'WINTER_OFFER_NOT_AVAILABLE',
      `No ${productId} offer is published for ${checkIn} to ${checkOut}`
    );
  }

  return buildFixedPackageQuote(
    {
      code: offer.ratePlanCode,
      version: offer.ratePlanVersion,
      accommodationKey,
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      entity,
      participants
    },
    deps
  );
}

/**
 * Quote Winter Cabin Stay through the normal seasonal quote path, restricted
 * to the catalog's exact seasonal RatePlan identity.
 */
async function buildWinterVillageStayQuote(input = {}, deps = {}) {
  const product = getWinterVillageProduct('stay');
  const {
    entity,
    checkIn,
    checkOut,
    adults,
    children = 0,
    experienceKeys = [],
    transportMethod,
    romanticSetup,
    promoCode
  } = input;
  const loadPlans =
    deps.loadActiveSeasonalRatePlans ||
    (async () => {
      const RatePlan = require('../models/RatePlan');
      return RatePlan.find({ status: 'active', type: 'seasonal_stay' }).lean();
    });
  const plans = await loadPlans();
  const exact = (Array.isArray(plans) ? plans : []).filter(
    (plan) =>
      String(plan.code || '').trim().toLowerCase() === product.ratePlanCode &&
      Number(plan.version) === product.ratePlanVersion
  );
  if (exact.length !== 1) {
    throw new WinterVillageCommercialError(
      'WINTER_STAY_RATE_PLAN_UNAVAILABLE',
      `Winter Cabin Stay requires ${product.ratePlanCode}@v${product.ratePlanVersion}`
    );
  }
  return buildQuoteForResolvedEntity(
    {
      entity,
      entityType: input.entityType || 'cabin',
      checkIn,
      checkOut,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults,
      children,
      experienceKeys,
      transportMethod,
      romanticSetup,
      promoCode
    },
    {
      ...deps,
      loadActiveSeasonalRatePlans: async () => exact
    }
  );
}

module.exports = {
  WinterVillageCommercialError,
  buildWinterVillageFixedPackageQuote,
  buildWinterVillageStayQuote
};
