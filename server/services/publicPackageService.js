'use strict';

const {
  validateAndNormalizeRatePlan,
  confirmAccommodationApplicability
} = require('./ratePlanService');
const { buildFixedPackageQuote } = require('./bookingQuoteService');

const PUBLIC_PACKAGE_QUERY = {
  status: 'active',
  type: 'fixed_package',
  $or: [{ packageVisibility: 'public' }, { packageVisibility: null }]
};

function dateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function publicPricing(row) {
  const pricingMethod = row.pricingMethod;
  if (pricingMethod === 'fixed_per_unit') {
    return {
      pricingMode: 'fixed_accommodation',
      currency: 'EUR',
      fromAmount: row.fixedPerUnitAmount,
      unitLabel: 'accommodation'
    };
  }
  if (pricingMethod === 'fixed_per_participant') {
    const amounts = [row.adultPackageAmount, row.childPackageAmount, row.infantPackageAmount]
      .filter((amount) => Number.isFinite(Number(amount)))
      .filter((amount) => Number(amount) > 0)
      .map(Number);
    return {
      pricingMode: 'participant',
      currency: 'EUR',
      fromAmount: amounts.length ? Math.min(...amounts) : null,
      unitLabel: 'participant',
      adultAmount: row.adultPackageAmount,
      childAmount: row.childPackageAmount,
      infantAmount: row.infantPackageAmount
    };
  }
  return {
    pricingMode: 'nightly',
    currency: 'EUR',
    fromAmount: row.nightlyPerUnitAmount,
    unitLabel: 'night',
    additionalGuestNightlyAmount: row.additionalGuestNightlyAmount,
    includedGuests: row.includedGuests
  };
}

function participantRequirements(plan) {
  const rows = plan.accommodations || [];
  const participant = rows.some((row) => row.pricingMethod === 'fixed_per_participant');
  return {
    required: participant,
    adultsRequired: participant,
    childrenSupported: participant && rows.some((row) => row.childPackageAmount != null),
    infantsSupported: participant && rows.some((row) => row.infantPackageAmount != null)
  };
}

function serializeAccommodation(row, availability = 'available') {
  return {
    key: row.accommodationKey,
    entityType: row.entityType,
    pricing: publicPricing(row),
    availability
  };
}

function serializePlan(plan, entities = new Map()) {
  const accommodations = (plan.accommodations || []).map((row) =>
    serializeAccommodation(row, entities.has(row.accommodationKey) ? 'available' : 'unavailable')
  );
  return {
    id: plan.code,
    slug: plan.code,
    name: plan.internalName,
    packageType: plan.packageType || 'other',
    description: null,
    status: 'active',
    sellable: true,
    dates: {
      checkIn: dateOnly(plan.packageArrivalDate || plan.dates?.checkIn),
      checkOut: dateOnly(plan.packageDepartureDate || plan.dates?.checkOut)
    },
    inclusions: Array.isArray(plan.inclusions) ? [...plan.inclusions] : [],
    accommodations,
    participantRequirements: participantRequirements(plan),
    pricing: accommodations.length
      ? {
          currency: plan.currency || 'EUR',
          options: accommodations.map((item) => ({
            accommodationKey: item.key,
            ...item.pricing
          })),
          fromAmount: accommodations
            .map((item) => item.pricing.fromAmount)
            .filter((value) => Number.isFinite(Number(value)))
            .reduce((min, value) => Math.min(min, Number(value)), Infinity)
        }
      : { currency: plan.currency || 'EUR', options: [], fromAmount: null },
    accommodationSelectionRequired: accommodations.length > 1,
    availability: accommodations.some((item) => item.availability === 'available')
      ? 'available'
      : 'sold_out'
  };
}

function createPublicPackageService(deps = {}) {
  const loadPlans =
    deps.loadPlans ||
    (async () => {
      const RatePlan = require('../models/RatePlan');
      return RatePlan.find(PUBLIC_PACKAGE_QUERY).lean();
    });
  const loadPlan =
    deps.loadPlan ||
    (async (slug) => {
      const RatePlan = require('../models/RatePlan');
      return RatePlan.findOne({ ...PUBLIC_PACKAGE_QUERY, code: String(slug).trim().toLowerCase() }).lean();
    });
  const loadEntity =
    deps.loadEntity ||
    (async (row) => {
      const Model = require(row.entityType === 'cabinType' ? '../models/CabinType' : '../models/Cabin');
      return Model.findOne({ slug: row.accommodationKey }).lean();
    });
  const quotePackage = deps.quotePackage || buildFixedPackageQuote;

  async function resolvePublicPlan(slug) {
    const raw = await loadPlan(slug);
    if (!raw) return { ok: false, status: 404, code: 'PACKAGE_NOT_FOUND', message: 'Package not found' };
    const normalized = validateAndNormalizeRatePlan(raw);
    if (!normalized.ok || normalized.value.status !== 'active' || normalized.value.type !== 'fixed_package') {
      return { ok: false, status: 404, code: 'PACKAGE_NOT_FOUND', message: 'Package not found' };
    }
    if (normalized.value.packageVisibility === 'private') {
      return { ok: false, status: 404, code: 'PACKAGE_NOT_FOUND', message: 'Package not found' };
    }
    return { ok: true, plan: normalized.value };
  }

  async function list() {
    const raws = await loadPlans();
    const plans = [];
    for (const raw of raws || []) {
      const normalized = validateAndNormalizeRatePlan(raw);
      if (!normalized.ok || normalized.value.status !== 'active' || normalized.value.type !== 'fixed_package') continue;
      if (normalized.value.packageVisibility === 'private') continue;
      const entities = new Map();
      for (const row of normalized.value.accommodations || []) {
        if (await loadEntity(row)) entities.set(row.accommodationKey, true);
      }
      plans.push(serializePlan(normalized.value, entities));
    }
    return plans;
  }

  async function detail(slug) {
    const result = await resolvePublicPlan(slug);
    if (!result.ok) return result;
    const entities = new Map();
    for (const row of result.plan.accommodations || []) {
      if (await loadEntity(row)) entities.set(row.accommodationKey, true);
    }
    return { ok: true, package: serializePlan(result.plan, entities) };
  }

  async function quote(slug, input = {}) {
    if (Object.prototype.hasOwnProperty.call(input, 'checkIn') ||
        Object.prototype.hasOwnProperty.call(input, 'checkOut') ||
        Object.prototype.hasOwnProperty.call(input, 'price') ||
        Object.prototype.hasOwnProperty.call(input, 'totalPrice')) {
      return { ok: false, status: 400, code: 'INVALID_PACKAGE_INPUT', message: 'Package dates and price are server-owned' };
    }
    const result = await resolvePublicPlan(slug);
    if (!result.ok) return result;
    const accommodationKey = String(input.accommodationKey || '').trim().toLowerCase();
    const row = (result.plan.accommodations || []).find((item) => item.accommodationKey === accommodationKey);
    if (!row || !confirmAccommodationApplicability(result.plan, accommodationKey).ok) {
      return { ok: false, status: 400, code: 'INVALID_ACCOMMODATION', message: 'Accommodation is not eligible for this package' };
    }
    const entity = await loadEntity(row);
    if (!entity) return { ok: false, status: 409, code: 'PACKAGE_SOLD_OUT', message: 'This package is not currently available' };
    const quoteResult = await quotePackage({
      code: result.plan.code,
      version: result.plan.version,
      accommodationKey,
      checkIn: dateOnly(result.plan.packageArrivalDate),
      checkOut: dateOnly(result.plan.packageDepartureDate),
      participants: input.participants,
      entity
    });
    if (!quoteResult.ok) {
      if (quoteResult.code === 'NO_ELIGIBLE_UNIT') quoteResult.code = 'PACKAGE_SOLD_OUT';
      return quoteResult;
    }
    return {
      ok: true,
      quote: {
        totalPrice: quoteResult.totalPrice,
        currency: quoteResult.ratePlan.currency,
        checkIn: dateOnly(quoteResult.checkInDate),
        checkOut: dateOnly(quoteResult.checkOutDate),
        accommodationKey,
        availableUnitCount: quoteResult.availableUnitCount,
        packageSnapshot: quoteResult.packageSnapshot
      }
    };
  }

  return { list, detail, quote };
}

module.exports = {
  PUBLIC_PACKAGE_QUERY,
  publicPricing,
  participantRequirements,
  serializePlan,
  createPublicPackageService
};
