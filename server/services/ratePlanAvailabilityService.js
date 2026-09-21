/**
 * Rate-plan-aware availability (B5).
 *
 * Exclusive fixed packages own their date window for listed accommodations:
 * normal stays cannot consume that inventory; the matching package can.
 * Uses half-open [checkIn, checkOut) Sofia date-only intervals.
 *
 * Conflict checks reuse injected predicates so tests need no Mongo; production
 * wires publicAvailabilityService / booking overlap rules.
 */
'use strict';

const {
  validateAndNormalizeRatePlan,
  confirmAccommodationApplicability
} = require('./ratePlanService');
const { formatSofiaDateOnly } = require('../utils/dateTime');

const NON_SELLABLE_STATUSES = new Set(['disabled', 'maintenance', 'retired']);

class RatePlanAvailabilityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RatePlanAvailabilityError';
    this.code = code;
    this.details = details;
  }
}

function toDateOnly(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.slice(0, 10))) {
    return input.slice(0, 10);
  }
  const formatted = formatSofiaDateOnly(input);
  return formatted || null;
}

/**
 * Half-open overlap: [aStart, aEnd) overlaps [bStart, bEnd).
 */
function halfOpenOverlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Unit/cabin readiness for a requested arrival date.
 */
function isInventoryResourceReadyForArrival(resource, arrivalDateOnly) {
  if (!resource || typeof resource !== 'object') return false;
  if (resource.isActive === false) return false;
  if (resource.archivedAt) return false;

  const status = resource.salesStatus == null ? 'ready' : String(resource.salesStatus);
  if (NON_SELLABLE_STATUSES.has(status)) return false;

  const arrival = toDateOnly(arrivalDateOnly);
  if (!arrival) return false;

  if (resource.sellableFrom != null && resource.sellableFrom !== '') {
    const sellable = toDateOnly(resource.sellableFrom);
    if (!sellable) {
      throw new RatePlanAvailabilityError(
        'UNIT_STATE_INDETERMINATE',
        'Physical unit sellableFrom could not be determined'
      );
    }
    if (arrival < sellable) return false;
  }

  return true;
}

async function defaultLoadExclusiveFixedPackages() {
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB not connected for exclusive rate plan lookup');
  }
  const RatePlan = require('../models/RatePlan');
  return RatePlan.find({
    status: 'active',
    type: 'fixed_package',
    inventoryMode: 'exclusive'
  }).lean();
}

/**
 * Normalize exclusive fixed-package candidates. Fail closed on malformed active rows.
 */
function normalizeExclusivePackagePlans(rawPlans) {
  if (!Array.isArray(rawPlans)) {
    throw new RatePlanAvailabilityError(
      'EXCLUSIVE_RATE_PLAN_LOOKUP_FAILED',
      'Exclusive rate plan lookup returned an invalid result'
    );
  }

  const normalized = [];
  for (const raw of rawPlans) {
    const result = validateAndNormalizeRatePlan(raw);
    if (!result.ok) {
      throw new RatePlanAvailabilityError(
        'MALFORMED_EXCLUSIVE_RATE_PLAN',
        'Active exclusive rate plan data is invalid',
        result.errors
      );
    }
    const plan = result.value;
    if (plan.status !== 'active') continue;
    if (plan.type !== 'fixed_package') continue;
    if (plan.inventoryMode !== 'exclusive') continue;
    if (!plan.packageArrivalDate || !plan.packageDepartureDate) {
      throw new RatePlanAvailabilityError(
        'MALFORMED_EXCLUSIVE_RATE_PLAN',
        'Exclusive package is missing exact arrival/departure dates'
      );
    }
    normalized.push(plan);
  }
  return normalized;
}

/**
 * Exclusive packages that overlap a stay and apply to an accommodation.
 */
function findOverlappingExclusivePackages(plans, accommodationKey, checkIn, checkOut) {
  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  const key = String(accommodationKey || '')
    .trim()
    .toLowerCase();
  const matches = [];
  for (const plan of plans) {
    if (!confirmAccommodationApplicability(plan, key).ok) continue;
    if (
      halfOpenOverlaps(ci, co, plan.packageArrivalDate, plan.packageDepartureDate)
    ) {
      matches.push(plan);
    }
  }
  matches.sort((a, b) => {
    const c = a.code.localeCompare(b.code);
    return c !== 0 ? c : a.version - b.version;
  });
  return matches;
}

/**
 * Whether a normal accommodation stay is blocked by exclusive package inventory.
 *
 * @returns {Promise<{ blocked: boolean, reason?: string, plans?: object[] }>}
 */
async function evaluateNormalStayExclusivity({
  accommodationKey,
  checkIn,
  checkOut,
  loadExclusiveFixedPackages = defaultLoadExclusiveFixedPackages
} = {}) {
  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  if (!ci || !co || !(ci < co)) {
    return { blocked: false };
  }

  let raw;
  try {
    raw = await loadExclusiveFixedPackages();
  } catch (err) {
    throw new RatePlanAvailabilityError(
      'EXCLUSIVE_RATE_PLAN_LOOKUP_FAILED',
      'Unable to load exclusive rate plans for availability'
    );
  }

  const plans = normalizeExclusivePackagePlans(raw);
  const overlapping = findOverlappingExclusivePackages(
    plans,
    accommodationKey,
    ci,
    co
  );

  if (overlapping.length === 0) {
    return { blocked: false };
  }

  // Distinct exclusive owners for the same stay/accommodation → fail closed.
  const owners = new Set(overlapping.map((p) => `${p.code}@${p.version}`));
  if (owners.size > 1) {
    throw new RatePlanAvailabilityError(
      'AMBIGUOUS_EXCLUSIVE_RATE_PLAN',
      'Multiple exclusive packages overlap this stay for the same accommodation',
      overlapping.map((p) => ({ code: p.code, version: p.version }))
    );
  }

  return {
    blocked: true,
    reason: 'EXCLUSIVE_PACKAGE_INVENTORY',
    plans: overlapping
  };
}

/**
 * Confirm the resolved package owns exclusive inventory for its exact dates.
 */
function assertPackageOwnsExclusiveInventory(resolvedPlan, exclusivePlans, accommodationKey) {
  const overlapping = findOverlappingExclusivePackages(
    exclusivePlans,
    accommodationKey,
    resolvedPlan.packageArrivalDate || resolvedPlan.dates?.checkIn,
    resolvedPlan.packageDepartureDate || resolvedPlan.dates?.checkOut
  );

  if (overlapping.length === 0) {
    // Resolved plan itself should be in the set; if inventoryMode exclusive but not loaded, fail.
    throw new RatePlanAvailabilityError(
      'PACKAGE_INVENTORY_NOT_OWNED',
      'No exclusive package owns inventory for these dates'
    );
  }

  const ownerKeys = new Set(overlapping.map((p) => `${p.code}@${p.version}`));
  const selfKey = `${resolvedPlan.code}@${resolvedPlan.version}`;
  if (!ownerKeys.has(selfKey)) {
    throw new RatePlanAvailabilityError(
      'PACKAGE_INVENTORY_NOT_OWNED',
      'A different exclusive package owns inventory for these dates'
    );
  }
  if (ownerKeys.size > 1) {
    throw new RatePlanAvailabilityError(
      'AMBIGUOUS_EXCLUSIVE_RATE_PLAN',
      'Multiple exclusive packages claim inventory for these dates',
      overlapping.map((p) => ({ code: p.code, version: p.version }))
    );
  }
}

/**
 * Pure conflict helpers for injected booking/hold/block fixtures (tests + adapters).
 */
function bookingConflictsStay(booking, checkIn, checkOut, resourceId, { idField = 'unitId' } = {}) {
  if (!booking) return false;
  const statuses = ['pending', 'confirmed', 'in_house'];
  if (!statuses.includes(booking.status)) return false;
  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  const bCi = toDateOnly(booking.checkIn);
  const bCo = toDateOnly(booking.checkOut);
  if (!halfOpenOverlaps(ci, co, bCi, bCo)) return false;
  if (idField === 'unitId') {
    return String(booking.unitId) === String(resourceId);
  }
  if (idField === 'cabinId') {
    return String(booking.cabinId) === String(resourceId) && !booking.unitId;
  }
  return false;
}

function blockConflictsStay(block, checkIn, checkOut, resource, now = new Date()) {
  if (!block || block.status !== 'active') return false;
  const blockingTypes = [
    'external_hold',
    'manual_block',
    'maintenance',
    'reservation',
    'checkout_hold'
  ];
  if (!blockingTypes.includes(block.blockType)) return false;
  if (block.blockType === 'checkout_hold') {
    if (block.expiresAt && new Date(block.expiresAt) <= now) return false;
  }
  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  const bStart = toDateOnly(block.startDate);
  const bEnd = toDateOnly(block.endDate);
  if (!halfOpenOverlaps(ci, co, bStart, bEnd)) return false;

  const resourceUnitId = resource.unitId || resource._id;
  const resourceCabinId = resource.cabinId || resource.parentCabinId;

  if (block.unitId) {
    return String(block.unitId) === String(resourceUnitId);
  }
  // Parent-wide / cabin-scoped block
  if (resourceCabinId && block.cabinId) {
    return String(block.cabinId) === String(resourceCabinId);
  }
  if (block.cabinId && resource._id && !resource.unitNumber) {
    // Single cabin resource
    return String(block.cabinId) === String(resource._id);
  }
  return false;
}

function legacyBlockedDateConflicts(blockedDates, checkIn, checkOut) {
  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  return arr.some((d) => {
    const day = toDateOnly(d);
    return day >= ci && day < co;
  });
}

/**
 * List inventory resources eligible for a fixed package quote (no hold/assignment).
 *
 * @param {object} opts
 * @param {object} opts.plan - normalized fixed_package plan (or resolved snapshot fields)
 * @param {string} opts.accommodationKey
 * @param {string} opts.checkIn
 * @param {string} opts.checkOut
 * @param {object[]} opts.resources - Unit or Cabin-shaped fixtures
 * @param {Function} [opts.isResourceConflicted] - async (resource) => boolean
 * @param {Function} [opts.loadExclusiveFixedPackages]
 */
async function listEligiblePackageInventory(opts = {}) {
  const {
    plan,
    accommodationKey,
    checkIn,
    checkOut,
    resources,
    isResourceConflicted,
    loadExclusiveFixedPackages = defaultLoadExclusiveFixedPackages
  } = opts;

  if (!plan || plan.type !== 'fixed_package') {
    throw new RatePlanAvailabilityError(
      'NOT_FIXED_PACKAGE',
      'Package inventory requires a fixed_package rate plan'
    );
  }
  if (plan.inventoryMode !== 'exclusive') {
    throw new RatePlanAvailabilityError(
      'PACKAGE_INVENTORY_NOT_EXCLUSIVE',
      'Package inventory requires inventoryMode exclusive'
    );
  }

  const ci = toDateOnly(checkIn);
  const co = toDateOnly(checkOut);
  if (plan.packageArrivalDate !== ci || plan.packageDepartureDate !== co) {
    throw new RatePlanAvailabilityError(
      'PACKAGE_DATES_MISMATCH',
      'Stay dates must exactly match the package arrival and departure'
    );
  }

  let exclusiveRaw;
  try {
    exclusiveRaw = await loadExclusiveFixedPackages();
  } catch (err) {
    throw new RatePlanAvailabilityError(
      'EXCLUSIVE_RATE_PLAN_LOOKUP_FAILED',
      'Unable to load exclusive rate plans for package availability'
    );
  }
  const exclusivePlans = normalizeExclusivePackagePlans(exclusiveRaw);
  assertPackageOwnsExclusiveInventory(plan, exclusivePlans, accommodationKey);

  if (!Array.isArray(resources)) {
    throw new RatePlanAvailabilityError(
      'UNIT_STATE_INDETERMINATE',
      'Physical unit inventory could not be determined'
    );
  }

  const eligible = [];
  for (const resource of resources) {
    if (!isInventoryResourceReadyForArrival(resource, ci)) continue;

    if (typeof isResourceConflicted === 'function') {
      const conflicted = await isResourceConflicted(resource, ci, co);
      if (conflicted) continue;
    }

    if (legacyBlockedDateConflicts(resource.blockedDates, ci, co)) continue;

    eligible.push(resource);
  }

  return {
    ok: true,
    availableUnitCount: eligible.length,
    eligibleUnits: eligible,
    capacityMaximum: null
  };
}

module.exports = {
  RatePlanAvailabilityError,
  NON_SELLABLE_STATUSES,
  toDateOnly,
  halfOpenOverlaps,
  isInventoryResourceReadyForArrival,
  normalizeExclusivePackagePlans,
  findOverlappingExclusivePackages,
  evaluateNormalStayExclusivity,
  assertPackageOwnsExclusiveInventory,
  listEligiblePackageInventory,
  bookingConflictsStay,
  blockConflictsStay,
  legacyBlockedDateConflicts,
  defaultLoadExclusiveFixedPackages
};
