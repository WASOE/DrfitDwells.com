'use strict';

const RatePlan = require('../models/RatePlan');
const NightlyRateOverride = require('../models/NightlyRateOverride');
const { formatSofiaDateOnly } = require('../utils/dateTime');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

class PricingOverrideManagementError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PricingOverrideManagementError';
    this.code = code;
    this.status = status;
  }
}

function parseDateOnly(value, field) {
  const date = typeof value === 'string' ? value.trim() : formatSofiaDateOnly(value);
  if (!DATE_ONLY_RE.test(date)) {
    throw new PricingOverrideManagementError('INVALID_DATE', `${field} must be YYYY-MM-DD`);
  }
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new PricingOverrideManagementError('INVALID_DATE', `${field} is not a real calendar date`);
  }
  return date;
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expandRange(startDate, endDate) {
  const dates = [];
  for (let date = startDate; date < endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function parseAccommodationQuery(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return value.split(',').map((accommodationKey) => ({ entityType: 'cabin', accommodationKey }));
  }
}

function normalizeAccommodationSelection(accommodations) {
  if (!Array.isArray(accommodations) || accommodations.length === 0) {
    throw new PricingOverrideManagementError(
      'ACCOMMODATIONS_REQUIRED',
      'At least one accommodation is required'
    );
  }
  const seen = new Set();
  return accommodations.map((row) => {
    const key = String(row?.accommodationKey || '').trim().toLowerCase();
    const entityType = String(row?.entityType || '').trim();
    const identity = `${entityType}:${key}`;
    if (!key || !['cabin', 'cabinType'].includes(entityType) || seen.has(identity)) {
      throw new PricingOverrideManagementError(
        'INVALID_ACCOMMODATION',
        'Each accommodation must have a unique valid entityType and accommodationKey'
      );
    }
    seen.add(identity);
    return { accommodationKey: key, entityType };
  });
}

function findPlanFilter(code, version) {
  return { code: String(code || '').trim().toLowerCase(), version: Number(version) };
}

async function loadPlan(code, version, model = RatePlan) {
  const normalizedCode = String(code || '').trim().toLowerCase();
  if (!normalizedCode || !Number.isInteger(Number(version)) || Number(version) < 1) {
    throw new PricingOverrideManagementError('RATE_PLAN_REQUIRED', 'Exact RatePlan code and version are required');
  }
  const plan = await model.findOne(findPlanFilter(normalizedCode, version)).lean();
  if (!plan) {
    throw new PricingOverrideManagementError('RATE_PLAN_NOT_FOUND', 'RatePlan version was not found', 404);
  }
  return plan;
}

function applicableAccommodation(plan, identity) {
  return (plan.accommodations || []).find(
    (row) =>
      String(row.accommodationKey).toLowerCase() === identity.accommodationKey &&
      row.entityType === identity.entityType
  );
}

function assertMutationPlan(plan) {
  if (plan.type !== 'seasonal_stay') {
    throw new PricingOverrideManagementError(
      'RATE_PLAN_NOT_SEASONAL',
      'Nightly overrides apply only to seasonal RatePlans'
    );
  }
  if (plan.status !== 'active') {
    throw new PricingOverrideManagementError(
      plan.status === 'retired' ? 'RATE_PLAN_RETIRED' : 'RATE_PLAN_NOT_EDITABLE',
      'Only active RatePlans can receive nightly overrides',
      409
    );
  }
  if (String(plan.currency || 'EUR') !== 'EUR') {
    throw new PricingOverrideManagementError('UNSUPPORTED_CURRENCY', 'RatePlan currency must be EUR');
  }
}

function assertDatesWithinPlan(plan, dates) {
  const start = plan.arrivalWindowStart ? formatSofiaDateOnly(plan.arrivalWindowStart) : null;
  const end = plan.arrivalWindowEnd ? formatSofiaDateOnly(plan.arrivalWindowEnd) : null;
  if (start && dates.some((date) => date < start) || end && dates.some((date) => date > end)) {
    throw new PricingOverrideManagementError(
      'DATE_OUTSIDE_RATE_PLAN',
      'Override dates must fall inside the RatePlan usable window'
    );
  }
}

function actorIdentifier(actor) {
  return String(actor?.id || actor?.username || actor?.email || '').trim() || 'ops';
}

function serializeOverride(row) {
  return {
    date: row.dateKey,
    accommodationKey: row.accommodationKey,
    entityType: row.entityType,
    basePriceCents: row.basePriceCents,
    overridePriceCents: row.overridePriceCents,
    effectivePriceCents: row.effectivePriceCents,
    currency: 'EUR'
  };
}

async function getPricingCalendar({
  ratePlanCode,
  ratePlanVersion,
  startDate,
  endDate,
  accommodations,
  ratePlanModel = RatePlan,
  overrideModel = NightlyRateOverride
}) {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  if (end <= start) {
    throw new PricingOverrideManagementError('INVALID_RANGE', 'endDate must be after startDate');
  }
  const dates = expandRange(start, end);
  const plan = await loadPlan(ratePlanCode, ratePlanVersion, ratePlanModel);
  const selectedAccommodations = parseAccommodationQuery(accommodations);
  const selected = selectedAccommodations?.length
    ? normalizeAccommodationSelection(selectedAccommodations)
    : (plan.accommodations || []).map((row) => ({
        accommodationKey: row.accommodationKey,
        entityType: row.entityType
      }));
  const applicable = selected
    .map((identity) => ({ identity, pricing: applicableAccommodation(plan, identity) }))
    .filter((row) => row.pricing);
  const rows = await overrideModel
    .find({
      ratePlanCode: plan.code,
      ratePlanVersion: plan.version,
      dateKey: { $gte: start, $lt: end },
      $or: applicable.map(({ identity }) => identity)
    })
    .lean();
  const byIdentity = new Map(
    rows.map((row) => [`${row.entityType}:${row.accommodationKey}:${row.dateKey}`, row])
  );
  const nights = [];
  for (const { identity, pricing } of applicable) {
    for (const date of dates) {
      const override = byIdentity.get(`${identity.entityType}:${identity.accommodationKey}:${date}`);
      const basePriceCents = Math.round(Number(pricing.nightlyPerUnitAmount || 0) * 100);
      const overridePriceCents =
        override?.baseNightlyAmountCents == null ? null : Number(override.baseNightlyAmountCents);
      nights.push({
        date,
        accommodationKey: identity.accommodationKey,
        entityType: identity.entityType,
        basePriceCents,
        overridePriceCents,
        effectivePriceCents: overridePriceCents == null ? basePriceCents : overridePriceCents,
        currency: 'EUR'
      });
    }
  }
  return {
    ratePlan: {
      code: plan.code,
      version: plan.version,
      internalName: plan.internalName,
      status: plan.status,
      type: plan.type,
      currency: plan.currency || 'EUR',
      arrivalWindowStart: plan.arrivalWindowStart ? formatSofiaDateOnly(plan.arrivalWindowStart) : null,
      arrivalWindowEnd: plan.arrivalWindowEnd ? formatSofiaDateOnly(plan.arrivalWindowEnd) : null,
      accommodations: plan.accommodations.map((row) => ({
        accommodationKey: row.accommodationKey,
        entityType: row.entityType,
        pricingMethod: row.pricingMethod,
        nightlyPerUnitAmount: row.nightlyPerUnitAmount
      }))
    },
    startDate: start,
    endDate,
    nights
  };
}

async function upsertPricingOverrides({
  ratePlanCode,
  ratePlanVersion,
  startDate,
  endDate,
  accommodations,
  priceCents,
  actor,
  ratePlanModel = RatePlan,
  overrideModel = NightlyRateOverride
}) {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  if (end <= start) {
    throw new PricingOverrideManagementError('INVALID_RANGE', 'endDate must be after startDate');
  }
  const dates = expandRange(start, end);
  const price = Number(priceCents);
  if (!Number.isInteger(price) || price <= 0) {
    throw new PricingOverrideManagementError('INVALID_PRICE', 'priceCents must be a positive integer');
  }
  const plan = await loadPlan(ratePlanCode, ratePlanVersion, ratePlanModel);
  assertMutationPlan(plan);
  const selected = normalizeAccommodationSelection(accommodations);
  selected.forEach((identity) => {
    if (!applicableAccommodation(plan, identity)) {
      throw new PricingOverrideManagementError(
        'INVALID_ACCOMMODATION',
        `${identity.entityType}:${identity.accommodationKey} is not applicable to this RatePlan`
      );
    }
  });
  assertDatesWithinPlan(plan, dates);
  const actorId = actorIdentifier(actor);
  const operations = [];
  for (const identity of selected) {
    for (const dateKey of dates) {
      operations.push({
        updateOne: {
          filter: {
            ratePlanCode: plan.code,
            ratePlanVersion: plan.version,
            entityType: identity.entityType,
            accommodationKey: identity.accommodationKey,
            dateKey
          },
          update: {
            $set: {
              baseNightlyAmountCents: price,
              source: 'manual',
              updatedBy: actorId,
              reason: null,
              recommendation: null,
              recommendationId: null
            },
            $setOnInsert: { createdBy: actorId }
          },
          upsert: true
        }
      });
    }
  }
  const result = operations.length ? await overrideModel.bulkWrite(operations) : { upsertedCount: 0, modifiedCount: 0 };
  return {
    affectedCount: Number(result.upsertedCount || 0) + Number(result.modifiedCount || 0),
    createdCount: Number(result.upsertedCount || 0),
    updatedCount: Number(result.modifiedCount || 0),
    calendar: await getPricingCalendar({
      ratePlanCode: plan.code,
      ratePlanVersion: plan.version,
      startDate: start,
      endDate: end,
      accommodations: selected,
      ratePlanModel,
      overrideModel
    })
  };
}

async function clearPricingOverrides({
  ratePlanCode,
  ratePlanVersion,
  startDate,
  endDate,
  accommodations,
  ratePlanModel = RatePlan,
  overrideModel = NightlyRateOverride
}) {
  const start = parseDateOnly(startDate, 'startDate');
  const end = parseDateOnly(endDate, 'endDate');
  if (end <= start) {
    throw new PricingOverrideManagementError('INVALID_RANGE', 'endDate must be after startDate');
  }
  const plan = await loadPlan(ratePlanCode, ratePlanVersion, ratePlanModel);
  const selected = normalizeAccommodationSelection(accommodations);
  const result = await overrideModel.deleteMany({
    ratePlanCode: plan.code,
    ratePlanVersion: plan.version,
    dateKey: { $gte: start, $lt: end },
    $or: selected
  });
  return {
    affectedCount: Number(result.deletedCount || 0),
    calendar: await getPricingCalendar({
      ratePlanCode: plan.code,
      ratePlanVersion: plan.version,
      startDate: start,
      endDate: end,
      accommodations: selected,
      ratePlanModel,
      overrideModel
    })
  };
}

module.exports = {
  PricingOverrideManagementError,
  parseDateOnly,
  expandRange,
  normalizeAccommodationSelection,
  parseAccommodationQuery,
  getPricingCalendar,
  upsertPricingOverrides,
  clearPricingOverrides
};
