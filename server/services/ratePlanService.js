/**
 * RatePlan foundation service (B1).
 *
 * Pure validation / resolution helpers. Not connected to live quote, pricing,
 * availability, checkout, Stripe, admin, or client surfaces.
 * Money: euro Number, two-decimal rounding (same public convention as pricingService).
 */
'use strict';

const {
  RATE_PLAN_STATUSES,
  RATE_PLAN_TYPES,
  RATE_PLAN_CURRENCIES,
  INVENTORY_MODES,
  PRICING_METHODS,
  ENTITY_TYPES
} = require('../models/RatePlan');

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

class RatePlanError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RatePlanError';
    this.code = code;
    this.details = details;
  }
}

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertNonNegativeEuro(value, field, errors) {
  if (value == null) return;
  if (!isFiniteNumber(value)) {
    errors.push(`${field} must be a finite number`);
    return;
  }
  if (value < 0) {
    errors.push(`${field} cannot be negative`);
    return;
  }
  if (roundEuro(value) !== value) {
    errors.push(`${field} must already be rounded to two decimal places`);
  }
}

function normalizeDateOnly(input, field, errors) {
  if (input == null || input === '') {
    return null;
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      errors.push(`${field} is an invalid Date`);
      return null;
    }
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, '0');
    const d = String(input.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(input).trim().slice(0, 10);
  if (!DATE_ONLY_RE.test(s)) {
    errors.push(`${field} must be YYYY-MM-DD`);
    return null;
  }
  const [yy, mm, dd] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd));
  if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) {
    errors.push(`${field} is not a real calendar date`);
    return null;
  }
  return s;
}

function dateOnlyToUtcDate(dateOnly) {
  const [yy, mm, dd] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(yy, mm - 1, dd));
}

function nightsBetween(checkIn, checkOut) {
  const a = dateOnlyToUtcDate(checkIn).getTime();
  const b = dateOnlyToUtcDate(checkOut).getTime();
  return Math.round((b - a) / 86400000);
}

function addDays(dateOnly, days) {
  const dt = dateOnlyToUtcDate(dateOnly);
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function compareDateOnly(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function freezeDeep(value) {
  if (value == null || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) {
    freezeDeep(child);
  }
  return value;
}

function stripClientPriceOverrides(input) {
  if (!input || typeof input !== 'object') return {};
  const ignored = [
    'price',
    'totalPrice',
    'total',
    'amount',
    'clientPrice',
    'nightlyRate',
    'baseLodgingPrice',
    'extrasTotal',
    'overridePricing',
    'pricingOverride'
  ];
  const rest = { ...input };
  for (const key of ignored) {
    delete rest[key];
  }
  return rest;
}

function pricingFieldsForMethod(method, row, prefix, errors) {
  const out = {
    pricingMethod: method,
    nightlyPerUnitAmount: null,
    includedGuests: null,
    additionalGuestNightlyAmount: null,
    fixedPerUnitAmount: null,
    adultPackageAmount: null,
    childPackageAmount: null,
    infantPackageAmount: null
  };

  if (method === 'nightly_per_unit') {
    if (row.nightlyPerUnitAmount == null) {
      errors.push(`${prefix}.nightlyPerUnitAmount is required`);
    } else {
      assertNonNegativeEuro(row.nightlyPerUnitAmount, `${prefix}.nightlyPerUnitAmount`, errors);
      out.nightlyPerUnitAmount = roundEuro(row.nightlyPerUnitAmount);
    }
  } else if (method === 'nightly_base_plus_extra_guest') {
    if (row.nightlyPerUnitAmount == null) {
      errors.push(`${prefix}.nightlyPerUnitAmount is required`);
    } else {
      assertNonNegativeEuro(row.nightlyPerUnitAmount, `${prefix}.nightlyPerUnitAmount`, errors);
      out.nightlyPerUnitAmount = roundEuro(row.nightlyPerUnitAmount);
    }
    if (row.includedGuests == null || !Number.isInteger(row.includedGuests) || row.includedGuests < 0) {
      errors.push(`${prefix}.includedGuests must be a non-negative integer`);
    } else {
      out.includedGuests = row.includedGuests;
    }
    if (row.additionalGuestNightlyAmount == null) {
      errors.push(`${prefix}.additionalGuestNightlyAmount is required`);
    } else {
      assertNonNegativeEuro(
        row.additionalGuestNightlyAmount,
        `${prefix}.additionalGuestNightlyAmount`,
        errors
      );
      out.additionalGuestNightlyAmount = roundEuro(row.additionalGuestNightlyAmount);
    }
  } else if (method === 'fixed_per_unit') {
    if (row.fixedPerUnitAmount == null) {
      errors.push(`${prefix}.fixedPerUnitAmount is required`);
    } else {
      assertNonNegativeEuro(row.fixedPerUnitAmount, `${prefix}.fixedPerUnitAmount`, errors);
      out.fixedPerUnitAmount = roundEuro(row.fixedPerUnitAmount);
    }
  } else if (method === 'fixed_per_participant') {
    for (const field of ['adultPackageAmount', 'childPackageAmount', 'infantPackageAmount']) {
      if (row[field] == null) {
        errors.push(`${prefix}.${field} is required`);
      } else {
        assertNonNegativeEuro(row[field], `${prefix}.${field}`, errors);
        out[field] = roundEuro(row[field]);
      }
    }
  } else {
    errors.push(`${prefix}.pricingMethod is unsupported`);
  }

  return out;
}

/**
 * Validate and normalize a rate-plan input object (plain or mongoose-like).
 * Does not persist. Does not overwrite existing versions (no update API).
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function validateAndNormalizeRatePlan(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Rate plan input is required'] };
  }

  const codeRaw = input.code == null ? '' : String(input.code).trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(codeRaw) || codeRaw.length < 2) {
    errors.push('code must be lowercase kebab-case (min 2 characters)');
  }

  const internalName = input.internalName == null ? '' : String(input.internalName).trim();
  if (!internalName) errors.push('internalName is required');

  const version = input.version;
  if (!Number.isInteger(version) || version < 1) {
    errors.push('version must be a positive integer');
  }

  const status = input.status == null ? 'draft' : String(input.status);
  if (!RATE_PLAN_STATUSES.includes(status)) {
    errors.push('status must be draft, active, or retired');
  }

  const type = input.type == null ? '' : String(input.type);
  if (!RATE_PLAN_TYPES.includes(type)) {
    errors.push('type must be seasonal_stay or fixed_package');
  }

  const currency = input.currency == null ? 'EUR' : String(input.currency).toUpperCase();
  if (!RATE_PLAN_CURRENCIES.includes(currency)) {
    errors.push('Unsupported currency');
  }

  const inventoryMode = input.inventoryMode == null ? '' : String(input.inventoryMode);
  if (!INVENTORY_MODES.includes(inventoryMode)) {
    errors.push('inventoryMode must be shared or exclusive');
  }

  const requiresFullPayment = input.requiresFullPayment !== false;
  if (typeof input.requiresFullPayment === 'boolean' && input.requiresFullPayment === false) {
    // Allowed in schema but commercial foundation expects full payment for these plans.
  }

  const cancellationPolicyCode =
    input.cancellationPolicyCode == null
      ? ''
      : String(input.cancellationPolicyCode).trim().toLowerCase();
  if (!cancellationPolicyCode) errors.push('cancellationPolicyCode is required');

  const cancellationPolicyVersion = input.cancellationPolicyVersion;
  if (!Number.isInteger(cancellationPolicyVersion) || cancellationPolicyVersion < 1) {
    errors.push('cancellationPolicyVersion must be a positive integer');
  }

  let minNights = input.minNights == null ? 1 : input.minNights;
  if (!Number.isInteger(minNights) || minNights < 1) {
    errors.push('minNights must be a positive integer');
    minNights = 1;
  }

  const arrivalWindowStart = normalizeDateOnly(input.arrivalWindowStart, 'arrivalWindowStart', errors);
  const arrivalWindowEnd = normalizeDateOnly(input.arrivalWindowEnd, 'arrivalWindowEnd', errors);
  const bookingWindowStart = normalizeDateOnly(input.bookingWindowStart, 'bookingWindowStart', errors);
  const bookingWindowEnd = normalizeDateOnly(input.bookingWindowEnd, 'bookingWindowEnd', errors);
  const packageArrivalDate = normalizeDateOnly(input.packageArrivalDate, 'packageArrivalDate', errors);
  const packageDepartureDate = normalizeDateOnly(
    input.packageDepartureDate,
    'packageDepartureDate',
    errors
  );

  if (type === 'seasonal_stay') {
    if (!arrivalWindowStart || !arrivalWindowEnd) {
      errors.push('seasonal_stay requires arrivalWindowStart and arrivalWindowEnd');
    } else if (compareDateOnly(arrivalWindowEnd, arrivalWindowStart) < 0) {
      errors.push('arrivalWindowEnd must be on or after arrivalWindowStart');
    }
    if (packageArrivalDate || packageDepartureDate) {
      errors.push('seasonal_stay must not set packageArrivalDate or packageDepartureDate');
    }
  }

  if (type === 'fixed_package') {
    if (!packageArrivalDate || !packageDepartureDate) {
      errors.push('fixed_package requires packageArrivalDate and packageDepartureDate');
    } else if (compareDateOnly(packageDepartureDate, packageArrivalDate) <= 0) {
      errors.push('packageDepartureDate must be after packageArrivalDate');
    } else {
      const duration = nightsBetween(packageArrivalDate, packageDepartureDate);
      if (duration !== minNights) {
        errors.push('fixed_package minNights must equal package duration in nights');
      }
    }
    if (inventoryMode && inventoryMode !== 'exclusive') {
      errors.push('fixed_package inventoryMode must be exclusive');
    }
  }

  if (bookingWindowStart && bookingWindowEnd && compareDateOnly(bookingWindowEnd, bookingWindowStart) < 0) {
    errors.push('bookingWindowEnd must be on or after bookingWindowStart');
  }

  const inclusions = Array.isArray(input.inclusions)
    ? input.inclusions.map((s) => String(s).trim()).filter(Boolean)
    : [];

  const rawAccommodations = Array.isArray(input.accommodations) ? input.accommodations : [];
  if (rawAccommodations.length === 0) {
    errors.push('At least one accommodation pricing entry is required');
  }

  const seenKeys = new Set();
  const accommodations = [];
  rawAccommodations.forEach((row, index) => {
    const prefix = `accommodations[${index}]`;
    if (!row || typeof row !== 'object') {
      errors.push(`${prefix} must be an object`);
      return;
    }
    const accommodationKey =
      row.accommodationKey == null ? '' : String(row.accommodationKey).trim().toLowerCase();
    if (!accommodationKey) {
      errors.push(`${prefix}.accommodationKey is required`);
    } else if (seenKeys.has(accommodationKey)) {
      errors.push(`Duplicate accommodationKey: ${accommodationKey}`);
    } else {
      seenKeys.add(accommodationKey);
    }

    const entityType = row.entityType == null ? '' : String(row.entityType);
    if (!ENTITY_TYPES.includes(entityType)) {
      errors.push(`${prefix}.entityType must be cabin or cabinType`);
    }

    const pricingMethod = row.pricingMethod == null ? '' : String(row.pricingMethod);
    if (!PRICING_METHODS.includes(pricingMethod)) {
      errors.push(`${prefix}.pricingMethod is unsupported`);
    }

    const amounts = pricingFieldsForMethod(pricingMethod, row, prefix, errors);
    accommodations.push({
      accommodationKey,
      entityType,
      ...amounts
    });
  });

  if (errors.length) {
    return { ok: false, errors };
  }

  const value = {
    code: codeRaw,
    internalName,
    version,
    status,
    type,
    currency,
    arrivalWindowStart,
    arrivalWindowEnd,
    bookingWindowStart,
    bookingWindowEnd,
    minNights,
    packageArrivalDate,
    packageDepartureDate,
    inventoryMode,
    requiresFullPayment: Boolean(requiresFullPayment),
    cancellationPolicyCode,
    cancellationPolicyVersion,
    inclusions,
    accommodations
  };

  return { ok: true, value };
}

function planToPlain(plan) {
  if (!plan) return null;
  if (typeof plan.toObject === 'function') {
    return plan.toObject({ depopulate: true });
  }
  return plan;
}

function findAccommodationRow(plan, accommodationKey) {
  const key = String(accommodationKey || '')
    .trim()
    .toLowerCase();
  const rows = Array.isArray(plan.accommodations) ? plan.accommodations : [];
  return rows.find((r) => r.accommodationKey === key) || null;
}

/**
 * Confirm accommodation applicability.
 * @returns {{ ok: true, row } | { ok: false, code, message }}
 */
function confirmAccommodationApplicability(plan, accommodationKey) {
  const normalized = validateAndNormalizeRatePlan(planToPlain(plan));
  const source = normalized.ok ? normalized.value : planToPlain(plan);
  const row = findAccommodationRow(source, accommodationKey);
  if (!row) {
    return {
      ok: false,
      code: 'ACCOMMODATION_NOT_APPLICABLE',
      message: `Rate plan does not apply to accommodation "${accommodationKey}"`
    };
  }
  return { ok: true, row };
}

function assertSelectableStatus(plan) {
  if (plan.status !== 'active') {
    throw new RatePlanError(
      'RATE_PLAN_INACTIVE',
      `Rate plan ${plan.code}@v${plan.version} is not active (status=${plan.status})`
    );
  }
}

/**
 * Complete-stay seasonal date rule:
 * check-in on/after window start; check-out on/before day after window end
 * (every night of the stay falls within [start, end] inclusive).
 */
function seasonalStayFullyEligible(plan, checkIn, checkOut) {
  if (!plan.arrivalWindowStart || !plan.arrivalWindowEnd) return false;
  if (compareDateOnly(checkIn, plan.arrivalWindowStart) < 0) return false;
  const latestCheckout = addDays(plan.arrivalWindowEnd, 1);
  if (compareDateOnly(checkOut, latestCheckout) > 0) return false;
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < plan.minNights) return false;
  return true;
}

function buildResolvedSnapshot(plan, accommodationKey, stay, selection) {
  const applicability = confirmAccommodationApplicability(plan, accommodationKey);
  if (!applicability.ok) {
    throw new RatePlanError(applicability.code, applicability.message);
  }
  const row = applicability.row;
  const nights = nightsBetween(stay.checkIn, stay.checkOut);

  const pricing = freezeDeep({
    pricingMethod: row.pricingMethod,
    currency: plan.currency,
    nightlyPerUnitAmount: row.nightlyPerUnitAmount,
    includedGuests: row.includedGuests,
    additionalGuestNightlyAmount: row.additionalGuestNightlyAmount,
    fixedPerUnitAmount: row.fixedPerUnitAmount,
    adultPackageAmount: row.adultPackageAmount,
    childPackageAmount: row.childPackageAmount,
    infantPackageAmount: row.infantPackageAmount
  });

  const snapshot = {
    code: plan.code,
    version: plan.version,
    internalName: plan.internalName,
    type: plan.type,
    status: plan.status,
    currency: plan.currency,
    selection,
    dates: freezeDeep({
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights,
      arrivalWindowStart: plan.arrivalWindowStart,
      arrivalWindowEnd: plan.arrivalWindowEnd,
      packageArrivalDate: plan.packageArrivalDate,
      packageDepartureDate: plan.packageDepartureDate
    }),
    accommodation: freezeDeep({
      accommodationKey: row.accommodationKey,
      entityType: row.entityType
    }),
    pricing,
    payment: freezeDeep({
      requiresFullPayment: plan.requiresFullPayment === true
    }),
    inventoryMode: plan.inventoryMode,
    minNights: plan.minNights,
    inclusions: Object.freeze([...(plan.inclusions || [])]),
    cancellationPolicy: freezeDeep({
      code: plan.cancellationPolicyCode,
      version: plan.cancellationPolicyVersion
    })
  };

  return freezeDeep(snapshot);
}

function normalizeStayDates(checkIn, checkOut) {
  const errors = [];
  const inDate = normalizeDateOnly(checkIn, 'checkIn', errors);
  const outDate = normalizeDateOnly(checkOut, 'checkOut', errors);
  if (errors.length) {
    throw new RatePlanError('INVALID_STAY_DATES', errors.join('; '));
  }
  if (compareDateOnly(outDate, inDate) <= 0) {
    throw new RatePlanError('INVALID_STAY_DATES', 'checkOut must be after checkIn');
  }
  return { checkIn: inDate, checkOut: outDate, nights: nightsBetween(inDate, outDate) };
}

/**
 * Automatically select an active seasonal rate plan for a stay.
 * Fixed packages are never selected here.
 * Ambiguous matches fail clearly.
 *
 * @param {object} opts
 * @param {object[]} opts.plans - candidate rate plans (fixtures or DB docs)
 * @param {string} opts.checkIn
 * @param {string} opts.checkOut
 * @param {string} opts.accommodationKey
 * @param {object} [opts.clientInput] - ignored price fields stripped
 */
function selectSeasonalRatePlan(opts) {
  const { plans, checkIn, checkOut, accommodationKey } = opts || {};
  stripClientPriceOverrides(opts?.clientInput || opts || {});

  const stay = normalizeStayDates(checkIn, checkOut);
  const candidates = [];

  for (const raw of Array.isArray(plans) ? plans : []) {
    const normalized = validateAndNormalizeRatePlan(planToPlain(raw));
    if (!normalized.ok) continue;
    const plan = normalized.value;
    if (plan.type !== 'seasonal_stay') continue;
    if (plan.status !== 'active') continue;
    if (!seasonalStayFullyEligible(plan, stay.checkIn, stay.checkOut)) continue;
    const applicability = confirmAccommodationApplicability(plan, accommodationKey);
    if (!applicability.ok) continue;
    candidates.push(plan);
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'NO_SEASONAL_RATE_PLAN',
      message: 'No active seasonal rate plan matches the stay and accommodation'
    };
  }

  // Deterministic ordering before ambiguity check (stable by code then version).
  candidates.sort((a, b) => {
    const c = a.code.localeCompare(b.code);
    if (c !== 0) return c;
    return a.version - b.version;
  });

  if (candidates.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_SEASONAL_RATE_PLAN',
      message: 'Multiple active seasonal rate plans match this stay; selection is ambiguous',
      details: candidates.map((p) => ({ code: p.code, version: p.version }))
    };
  }

  const plan = candidates[0];
  const resolved = buildResolvedSnapshot(plan, accommodationKey, stay, {
    mode: 'seasonal_automatic',
    ratePlanCode: plan.code,
    ratePlanVersion: plan.version
  });

  return { ok: true, resolved, plan };
}

/**
 * Resolve an explicitly selected fixed package by code + version.
 * Never used for automatic seasonal selection.
 */
function resolveFixedPackage(opts) {
  const { plans, code, version, checkIn, checkOut, accommodationKey } = opts || {};
  stripClientPriceOverrides(opts?.clientInput || opts || {});

  if (code == null || String(code).trim() === '') {
    throw new RatePlanError('RATE_PLAN_CODE_REQUIRED', 'Fixed package requires an explicit rate plan code');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new RatePlanError('RATE_PLAN_VERSION_REQUIRED', 'Fixed package requires an explicit positive version');
  }

  const stay = normalizeStayDates(checkIn, checkOut);
  const wantedCode = String(code).trim().toLowerCase();

  let found = null;
  for (const raw of Array.isArray(plans) ? plans : []) {
    const normalized = validateAndNormalizeRatePlan(planToPlain(raw));
    if (!normalized.ok) continue;
    const plan = normalized.value;
    if (plan.code === wantedCode && plan.version === version) {
      found = plan;
      break;
    }
  }

  if (!found) {
    throw new RatePlanError(
      'RATE_PLAN_NOT_FOUND',
      `Rate plan ${wantedCode}@v${version} was not found`
    );
  }

  assertSelectableStatus(found);

  if (found.type !== 'fixed_package') {
    throw new RatePlanError(
      'NOT_FIXED_PACKAGE',
      `Rate plan ${found.code}@v${found.version} is not a fixed_package`
    );
  }

  if (
    found.packageArrivalDate !== stay.checkIn ||
    found.packageDepartureDate !== stay.checkOut
  ) {
    throw new RatePlanError(
      'PACKAGE_DATES_MISMATCH',
      `Stay dates must exactly match package ${found.packageArrivalDate} → ${found.packageDepartureDate}`
    );
  }

  const applicability = confirmAccommodationApplicability(found, accommodationKey);
  if (!applicability.ok) {
    throw new RatePlanError(applicability.code, applicability.message);
  }

  const resolved = buildResolvedSnapshot(found, accommodationKey, stay, {
    mode: 'fixed_package_explicit',
    ratePlanCode: found.code,
    ratePlanVersion: found.version
  });

  return { ok: true, resolved, plan: found };
}

module.exports = {
  RatePlanError,
  roundEuro,
  freezeDeep,
  stripClientPriceOverrides,
  validateAndNormalizeRatePlan,
  confirmAccommodationApplicability,
  selectSeasonalRatePlan,
  resolveFixedPackage,
  buildResolvedSnapshot,
  seasonalStayFullyEligible,
  normalizeStayDates,
  RATE_PLAN_STATUSES,
  RATE_PLAN_TYPES,
  RATE_PLAN_CURRENCIES,
  INVENTORY_MODES,
  PRICING_METHODS,
  ENTITY_TYPES
};
