/**
 * Facility booking foundation (B6) + concurrency-safe holds (B8D).
 *
 * Self-led facilities + required firewood packs. B6 helpers stay injectable
 * and do not create holds from the quote path. B8D adds database-authoritative
 * holds via unique (facilityCode, slotStart, capacityLane) without transactions.
 *
 * Time intervals are half-open: [start, end).
 */
'use strict';

const {
  ADD_ON_STATUSES,
  ADD_ON_CURRENCIES,
  CHARGE_UNITS
} = require('../models/BookableAddOn');
const { FACILITY_STATUSES } = require('../models/Facility');

/** Valley-style inventory hold — not CheckoutSession 48h soft TTL. */
const DEFAULT_FACILITY_HOLD_TTL_MS = 30 * 60 * 1000;

class FacilityBookingError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'FacilityBookingError';
    this.code = code;
    this.details = details;
  }
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  const msg = String(err.message || '');
  return /E11000|duplicate key/i.test(msg);
}

function roundEuro(value) {
  return Math.round(Number(value) * 100) / 100;
}

function freezeDeep(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  Object.keys(value).forEach((k) => freezeDeep(value[k]));
  return Object.freeze(value);
}

function toInstant(input) {
  if (input == null) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Half-open overlap: [aStart, aEnd) overlaps [bStart, bEnd).
 */
function halfOpenOverlaps(aStart, aEnd, bStart, bEnd) {
  const aS = toInstant(aStart);
  const aE = toInstant(aEnd);
  const bS = toInstant(bStart);
  const bE = toInstant(bEnd);
  if (!aS || !aE || !bS || !bE) return false;
  return aS < bE && aE > bS;
}

function isValidEuroAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (value < 0) return false;
  return roundEuro(value) === value;
}

/**
 * Validate and normalize a BookableAddOn document/fixture.
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
function validateAndNormalizeBookableAddOn(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Add-on input is required'] };
  }

  const code =
    typeof input.code === 'string' ? input.code.trim().toLowerCase() : '';
  if (!code || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) {
    errors.push('code must be lowercase kebab-case');
  }

  const internalName =
    typeof input.internalName === 'string' ? input.internalName.trim() : '';
  if (!internalName) errors.push('internalName is required');

  const publicName =
    typeof input.publicName === 'string' ? input.publicName.trim() : '';
  if (!publicName) errors.push('publicName is required');

  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) {
    errors.push('version must be a positive integer');
  }

  const status = input.status != null ? String(input.status) : 'draft';
  if (!ADD_ON_STATUSES.includes(status)) {
    errors.push('status must be draft, active, or retired');
  }

  const currency = input.currency != null ? String(input.currency).toUpperCase() : 'EUR';
  if (!ADD_ON_CURRENCIES.includes(currency)) {
    errors.push('Unsupported currency');
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    errors.push('Price cannot be negative');
  } else if (!isValidEuroAmount(amount)) {
    errors.push('amount must be a euro Number with at most two decimals');
  }

  const chargeUnit = input.chargeUnit != null ? String(input.chargeUnit) : '';
  if (!CHARGE_UNITS.includes(chargeUnit)) {
    errors.push('Unsupported charge unit');
  }

  const includedItems = Array.isArray(input.includedItems)
    ? input.includedItems.map((s) => String(s).trim()).filter(Boolean)
    : [];

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      code,
      internalName,
      publicName,
      version,
      status,
      currency,
      amount: roundEuro(amount),
      chargeUnit,
      description: input.description != null ? String(input.description) : '',
      includedItems,
      validFrom: input.validFrom != null ? toInstant(input.validFrom) : null,
      validUntil: input.validUntil != null ? toInstant(input.validUntil) : null
    }
  };
}

function validateAndNormalizeFacility(input) {
  const errors = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Facility input is required'] };
  }

  const facilityCode =
    typeof input.facilityCode === 'string'
      ? input.facilityCode.trim().toLowerCase()
      : '';
  if (!facilityCode || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(facilityCode)) {
    errors.push('facilityCode must be lowercase kebab-case');
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.push('name is required');

  const status = input.status != null ? String(input.status) : 'draft';
  if (!FACILITY_STATUSES.includes(status)) {
    errors.push('Unsupported facility status');
  }

  const selfLed = input.selfLed !== false;

  const requiredAddOnCode =
    typeof input.requiredAddOnCode === 'string'
      ? input.requiredAddOnCode.trim().toLowerCase()
      : '';
  if (!requiredAddOnCode) errors.push('requiredAddOnCode is required');

  const requiredAddOnVersion = Number(input.requiredAddOnVersion);
  if (!Number.isInteger(requiredAddOnVersion) || requiredAddOnVersion < 1) {
    errors.push('requiredAddOnVersion must be a positive integer');
  }

  const slotDurationMinutes = Number(input.slotDurationMinutes);
  if (!Number.isInteger(slotDurationMinutes) || slotDurationMinutes < 1) {
    errors.push('slotDurationMinutes must be a positive integer');
  }

  const maxConcurrentBookings = Number(
    input.maxConcurrentBookings == null ? 1 : input.maxConcurrentBookings
  );
  if (!Number.isInteger(maxConcurrentBookings) || maxConcurrentBookings < 1) {
    errors.push('maxConcurrentBookings must be a positive integer');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      facilityCode,
      name,
      status,
      selfLed,
      requiredAddOnCode,
      requiredAddOnVersion,
      slotDurationMinutes,
      maxConcurrentBookings,
      operatingSchedule: input.operatingSchedule || null,
      unavailablePeriods: Array.isArray(input.unavailablePeriods)
        ? input.unavailablePeriods
        : []
    }
  };
}

/**
 * Whether a reservation currently blocks inventory.
 */
function reservationBlocksAvailability(reservation, now = new Date()) {
  if (!reservation || typeof reservation !== 'object') return false;
  const status = reservation.status;
  if (status === 'cancelled' || status === 'expired') return false;
  if (status === 'confirmed') return true;
  if (status === 'hold') {
    if (reservation.holdExpiresAt) {
      const exp = toInstant(reservation.holdExpiresAt);
      if (exp && exp <= now) return false;
    }
    return true;
  }
  return false;
}

function slotFitsOperatingSchedule(facility, startTime, endTime) {
  const schedule = facility && facility.operatingSchedule;
  if (!schedule) return true;
  const windows = Array.isArray(schedule.absoluteWindows)
    ? schedule.absoluteWindows
    : [];
  if (windows.length === 0) return true;

  const start = toInstant(startTime);
  const end = toInstant(endTime);
  if (!start || !end || !(start < end)) return false;

  return windows.some((w) => {
    const wStart = toInstant(w.start);
    const wEnd = toInstant(w.end);
    if (!wStart || !wEnd) return false;
    // Slot must be fully contained in a window (half-open).
    return start >= wStart && end <= wEnd;
  });
}

/**
 * Find the absolute operating window that fully contains [start, end).
 * @returns {{ start: Date, end: Date } | null}
 */
function findContainingAbsoluteWindow(facility, startTime, endTime) {
  const schedule = facility && facility.operatingSchedule;
  const windows = Array.isArray(schedule?.absoluteWindows)
    ? schedule.absoluteWindows
    : [];
  const start = toInstant(startTime);
  const end = toInstant(endTime);
  if (!start || !end || !(start < end)) return null;

  for (const w of windows) {
    const wStart = toInstant(w.start);
    const wEnd = toInstant(w.end);
    if (!wStart || !wEnd) continue;
    if (start >= wStart && end <= wEnd) {
      return { start: wStart, end: wEnd };
    }
  }
  return null;
}

/**
 * Exact configured slot grid: start = windowStart + N × slotDuration.
 * Rejects inventing a midnight grid when no absolute window covers the slot.
 */
function assertExactConfiguredSlotGrid(facility, startTime, endTime) {
  const start = toInstant(startTime);
  const end = toInstant(endTime);
  if (!start || !end || !(start < end)) {
    throw new FacilityBookingError(
      'INVALID_SLOT',
      'Facility slot start/end is invalid'
    );
  }

  const durationMs = Number(facility.slotDurationMinutes) * 60 * 1000;
  if (end.getTime() - start.getTime() !== durationMs) {
    throw new FacilityBookingError(
      'INVALID_SLOT_DURATION',
      'Requested slot duration does not match the facility configuration'
    );
  }

  const window = findContainingAbsoluteWindow(facility, start, end);
  if (!window) {
    throw new FacilityBookingError(
      'FACILITY_SLOT_GRID_UNDEFINED',
      'No absolute operating window defines a slot grid for the requested time'
    );
  }

  const offsetMs = start.getTime() - window.start.getTime();
  if (offsetMs < 0 || offsetMs % durationMs !== 0) {
    throw new FacilityBookingError(
      'FACILITY_SLOT_OFF_GRID',
      'Requested slot start is not aligned to the facility slot grid'
    );
  }

  // Ensure the full slot still ends within the same window (already checked by containment).
  return { window, slotStart: start, slotEnd: end };
}

function slotHitsUnavailablePeriod(facility, startTime, endTime) {
  const periods = (facility && facility.unavailablePeriods) || [];
  return periods.some((p) =>
    halfOpenOverlaps(startTime, endTime, p.start, p.end)
  );
}

/**
 * Count blocking reservations overlapping [start, end) for one facility.
 */
function countOverlappingBlockingReservations(
  reservations,
  facilityCode,
  startTime,
  endTime,
  now = new Date()
) {
  const code = String(facilityCode || '')
    .trim()
    .toLowerCase();
  let count = 0;
  for (const r of reservations || []) {
    if (
      String(r.facilityCode || '')
        .trim()
        .toLowerCase() !== code
    ) {
      continue;
    }
    if (!reservationBlocksAvailability(r, now)) continue;
    if (halfOpenOverlaps(startTime, endTime, r.startTime, r.endTime)) {
      count += 1;
    }
  }
  return count;
}

function assertSlotAvailable({
  facility,
  startTime,
  endTime,
  existingReservations = [],
  now = new Date()
}) {
  const start = toInstant(startTime);
  const end = toInstant(endTime);
  if (!start || !end || !(start < end)) {
    throw new FacilityBookingError(
      'INVALID_SLOT',
      'Facility slot start/end is invalid'
    );
  }

  if (!slotFitsOperatingSchedule(facility, start, end)) {
    throw new FacilityBookingError(
      'OUTSIDE_SCHEDULE',
      'Requested slot is outside the facility operating schedule'
    );
  }

  if (slotHitsUnavailablePeriod(facility, start, end)) {
    throw new FacilityBookingError(
      'FACILITY_UNAVAILABLE',
      'Requested slot overlaps a facility unavailable period'
    );
  }

  const overlapCount = countOverlappingBlockingReservations(
    existingReservations,
    facility.facilityCode,
    start,
    end,
    now
  );
  if (overlapCount >= facility.maxConcurrentBookings) {
    throw new FacilityBookingError(
      'SLOT_AT_CAPACITY',
      'Requested facility slot is at capacity',
      { overlapCount, maxConcurrentBookings: facility.maxConcurrentBookings }
    );
  }
}

/**
 * Resolve the required active firewood pack for a facility (server-owned).
 */
function resolveRequiredAddOn(facility, addOn) {
  if (!addOn) {
    throw new FacilityBookingError(
      'REQUIRED_ADDON_MISSING',
      'Required firewood pack was not found'
    );
  }
  const normalized = validateAndNormalizeBookableAddOn(addOn);
  if (!normalized.ok) {
    throw new FacilityBookingError(
      'MALFORMED_ADDON',
      'Required add-on data is invalid',
      normalized.errors
    );
  }
  const pack = normalized.value;
  if (pack.status !== 'active') {
    throw new FacilityBookingError(
      'ADDON_INACTIVE',
      'Required firewood pack is not active'
    );
  }
  if (pack.code !== facility.requiredAddOnCode) {
    throw new FacilityBookingError(
      'ADDON_MISMATCH',
      'Loaded add-on code does not match the facility requirement'
    );
  }
  if (pack.version !== facility.requiredAddOnVersion) {
    throw new FacilityBookingError(
      'ADDON_MISMATCH',
      'Loaded add-on version does not match the facility requirement'
    );
  }
  return pack;
}

/**
 * One facility selection = one required firewood pack (per_firing).
 * Client price / quantity / availability claims are ignored.
 */
function calculateFacilityAddOnTotal(selections) {
  let total = 0;
  for (const sel of selections || []) {
    total = roundEuro(total + Number(sel.priceSnapshot.amount));
  }
  return total;
}

function buildFacilitySelectionSnapshot({
  facility,
  addOn,
  startTime,
  endTime,
  ratePlanCode = null,
  ratePlanVersion = null
}) {
  const start = toInstant(startTime);
  const end = toInstant(endTime);
  const includedItems = [...(addOn.includedItems || [])];
  const snapshot = {
    facilityCode: facility.facilityCode,
    facilityName: facility.name,
    selfLed: facility.selfLed === true,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    // B8E: canonical slot start (equals startTime for exact configured slots).
    slotStart: start.toISOString(),
    addOn: {
      code: addOn.code,
      version: addOn.version,
      publicName: addOn.publicName,
      currency: addOn.currency,
      amount: addOn.amount,
      chargeUnit: addOn.chargeUnit,
      includedItems
    },
    // B6 flat fields retained for existing quote helpers / totals.
    addOnCode: addOn.code,
    addOnVersion: addOn.version,
    addOnPublicName: addOn.publicName,
    chargeUnit: addOn.chargeUnit,
    currency: addOn.currency,
    amount: addOn.amount,
    includedItems,
    priceSnapshot: {
      currency: addOn.currency,
      amount: addOn.amount,
      chargeUnit: addOn.chargeUnit,
      addOnCode: addOn.code,
      addOnVersion: addOn.version
    },
    ratePlanCode: ratePlanCode || null,
    ratePlanVersion: ratePlanVersion == null ? null : ratePlanVersion,
    holdCreated: false,
    reservationCreated: false
  };
  return freezeDeep(snapshot);
}

/**
 * Validate a single client facility selection against server fixtures/loaders.
 *
 * Client may supply: facilityCode, startTime, endTime (or start + duration).
 * Client may NOT supply authoritative price / availability / add-on snapshot.
 */
async function validateFacilitySelection(selection = {}, deps = {}) {
  void selection.price;
  void selection.amount;
  void selection.addOnPrice;
  void selection.firewoodQuantity;
  void selection.quantity;
  void selection.available;
  void selection.capacity;
  void selection.staffPrepared;
  void selection.addOnSnapshot;
  void selection.preparedSession;

  const facilityCode =
    typeof selection.facilityCode === 'string'
      ? selection.facilityCode.trim().toLowerCase()
      : '';
  if (!facilityCode) {
    throw new FacilityBookingError(
      'FACILITY_CODE_REQUIRED',
      'facilityCode is required'
    );
  }

  const loadFacility =
    deps.loadFacilityByCode ||
    (async () => {
      throw new Error('loadFacilityByCode is required');
    });
  const loadAddOn =
    deps.loadAddOnByCodeVersion ||
    (async () => {
      throw new Error('loadAddOnByCodeVersion is required');
    });
  const loadReservations =
    deps.loadReservationsForFacility || (async () => []);

  const rawFacility = await loadFacility(facilityCode);
  if (!rawFacility) {
    throw new FacilityBookingError('FACILITY_NOT_FOUND', 'Facility was not found');
  }
  const facilityNorm = validateAndNormalizeFacility(rawFacility);
  if (!facilityNorm.ok) {
    throw new FacilityBookingError(
      'MALFORMED_FACILITY',
      'Facility data is invalid',
      facilityNorm.errors
    );
  }
  const facility = facilityNorm.value;
  if (facility.status !== 'active') {
    throw new FacilityBookingError(
      'FACILITY_INACTIVE',
      'Facility is not active'
    );
  }
  if (facility.selfLed !== true) {
    throw new FacilityBookingError(
      'FACILITY_NOT_SELF_LED',
      'Only self-led facilities are supported'
    );
  }

  let start = toInstant(selection.slotStart || selection.startTime || selection.start);
  let end = toInstant(selection.endTime || selection.end);
  if (start && !end && selection.slotDurationMinutes == null) {
    end = new Date(start.getTime() + facility.slotDurationMinutes * 60 * 1000);
  }
  if (!start || !end) {
    throw new FacilityBookingError(
      'INVALID_SLOT',
      'Facility slot start/end is required'
    );
  }

  const expectedMs = facility.slotDurationMinutes * 60 * 1000;
  if (end.getTime() - start.getTime() !== expectedMs) {
    // Allow exact configured duration only (client cannot invent lengths).
    throw new FacilityBookingError(
      'INVALID_SLOT_DURATION',
      'Requested slot duration does not match the facility configuration'
    );
  }

  // B8E checkout quote preparation requires the B8D exact slot grid.
  // B6 foundation overlap fixtures may omit this (requireExactSlotGrid !== true).
  if (deps.requireExactSlotGrid === true) {
    if (!slotFitsOperatingSchedule(facility, start, end)) {
      throw new FacilityBookingError(
        'OUTSIDE_SCHEDULE',
        'Requested slot is outside the facility operating schedule'
      );
    }
    assertExactConfiguredSlotGrid(facility, start, end);
  }

  const now = deps.now ? toInstant(deps.now) : new Date();
  const existing = await loadReservations(facility.facilityCode, start, end);
  assertSlotAvailable({
    facility,
    startTime: start,
    endTime: end,
    existingReservations: existing,
    now
  });

  const rawAddOn = await loadAddOn(
    facility.requiredAddOnCode,
    facility.requiredAddOnVersion
  );
  const addOn = resolveRequiredAddOn(facility, rawAddOn);

  const snapshot = buildFacilitySelectionSnapshot({
    facility,
    addOn,
    startTime: start,
    endTime: end,
    ratePlanCode: selection.ratePlanCode || deps.ratePlanCode || null,
    ratePlanVersion:
      selection.ratePlanVersion != null
        ? selection.ratePlanVersion
        : deps.ratePlanVersion != null
          ? deps.ratePlanVersion
          : null
  });

  return {
    ok: true,
    facility,
    addOn,
    startTime: start,
    endTime: end,
    snapshot,
    priceSnapshot: snapshot.priceSnapshot
  };
}

/**
 * Add validated facility selections onto a quote without mutating the original.
 * Does not create holds or reservations. Does not discount firewood via lodging promo.
 */
async function applyFacilitySelectionsToQuote(quote, selections = [], deps = {}) {
  if (!quote || typeof quote !== 'object') {
    throw new FacilityBookingError('QUOTE_REQUIRED', 'A base quote is required');
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    return {
      ...quote,
      facilitySelections: [],
      facilityTotal: 0,
      facilityHoldCreated: false
    };
  }

  const validated = [];
  for (const sel of selections) {
    const result = await validateFacilitySelection(sel, deps);
    validated.push(result);
  }

  // Same facility overlapping within this request must respect concurrency.
  const tentative = [];
  for (const v of validated) {
    assertSlotAvailable({
      facility: v.facility,
      startTime: v.startTime,
      endTime: v.endTime,
      existingReservations: [
        ...(deps.existingReservationsForRequest || []),
        ...tentative.map((t) => ({
          facilityCode: t.facility.facilityCode,
          startTime: t.startTime,
          endTime: t.endTime,
          status: 'hold',
          holdExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
        }))
      ],
      now: deps.now ? toInstant(deps.now) : new Date()
    });
    tentative.push(v);
  }

  const facilitySelections = validated.map((v) => v.snapshot);
  const facilityTotal = calculateFacilityAddOnTotal(
    validated.map((v) => ({ priceSnapshot: v.priceSnapshot }))
  );

  const lodgingTotal = roundEuro(
    Number(
      quote.totalBeforePaymentCredits != null
        ? quote.totalBeforePaymentCredits
        : quote.subtotalPrice != null
          ? quote.subtotalPrice
          : quote.totalPrice
    ) || 0
  );
  // Preserve lodging/promo math: recompute final as (quote lodging+existing extras net) + firewood.
  // Prefer explicit lodging+extras if present so promo stays on lodging only.
  const baseLodging = roundEuro(Number(quote.baseLodgingPrice) || 0);
  const existingExtras = roundEuro(Number(quote.extrasTotal) || 0);
  const discountAmount = roundEuro(Number(quote.discountAmount) || 0);
  const lodgingNet = roundEuro(baseLodging - discountAmount);
  const hasBreakdown =
    quote.baseLodgingPrice != null || quote.extrasTotal != null;

  const newTotal = hasBreakdown
    ? roundEuro(lodgingNet + existingExtras + facilityTotal)
    : roundEuro(lodgingTotal + facilityTotal);

  const voucherAppliedCents = Number(quote.voucherAppliedCents) || 0;
  const remainingDueCents = Math.max(
    0,
    Math.round(newTotal * 100) - voucherAppliedCents
  );

  return {
    ...quote,
    facilitySelections,
    facilityTotal,
    facilityHoldCreated: false,
    facilityReservationCreated: false,
    // Separate line: do not fold into extrasTotal (lodging-promo scope).
    totalPrice: newTotal,
    remainingDueCents,
    // Preserve RatePlan / package snapshots by shallow copy of quote fields.
    ratePlan: quote.ratePlan ? { ...quote.ratePlan } : quote.ratePlan,
    packageSnapshot: quote.packageSnapshot
      ? { ...quote.packageSnapshot }
      : quote.packageSnapshot,
    ratePlanPricingBreakdown: quote.ratePlanPricingBreakdown
      ? { ...quote.ratePlanPricingBreakdown }
      : quote.ratePlanPricingBreakdown
  };
}

function getFacilityReservationModel(deps = {}) {
  return deps.FacilityReservation || require('../models/FacilityReservation');
}

function getCheckoutResourceAttemptModel(deps = {}) {
  return deps.CheckoutResourceAttempt || require('../models/CheckoutResourceAttempt');
}

/** Rows safe for tokenless legacy mutations (null or absent marker). */
function unmarkedMarkerFilter() {
  return {
    $or: [{ acquisitionAttemptId: null }, { acquisitionAttemptId: { $exists: false } }]
  };
}

function hasAcquisitionMarker(doc) {
  return (
    doc != null &&
    doc.acquisitionAttemptId != null &&
    String(doc.acquisitionAttemptId).trim() !== ''
  );
}

function markerString(doc) {
  return hasAcquisitionMarker(doc) ? String(doc.acquisitionAttemptId).trim() : null;
}

function resolveFencedAttemptId(deps = {}) {
  if (deps.acquisitionAttemptId == null) return null;
  const id = String(deps.acquisitionAttemptId).trim();
  return id || null;
}

/**
 * Resolve absolute hold expiry. Fenced path: must be > now and <= fence.bundleValidUntil.
 * Absolute wins over TTL when both supplied.
 */
function resolveRequestedHoldExpiresAt(input = {}, deps = {}, fenceBundleValidUntil = null) {
  const now = deps.now ? toInstant(deps.now) : new Date();
  if (!now) {
    throw new FacilityBookingError('INVALID_NOW', 'now must be a valid instant');
  }

  const absoluteRaw =
    input.holdExpiresAt != null
      ? input.holdExpiresAt
      : deps.holdExpiresAt != null
        ? deps.holdExpiresAt
        : null;

  let requested;
  if (absoluteRaw != null) {
    requested = toInstant(absoluteRaw);
    if (!requested) {
      throw new FacilityBookingError(
        'INVALID_HOLD_EXPIRY',
        'holdExpiresAt must be a valid Date'
      );
    }
  } else {
    const ttlMs =
      deps.holdTtlMs != null ? Number(deps.holdTtlMs) : DEFAULT_FACILITY_HOLD_TTL_MS;
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      throw new FacilityBookingError('INVALID_HOLD_EXPIRY', 'holdTtlMs is invalid');
    }
    requested = new Date(now.getTime() + ttlMs);
  }

  if (requested.getTime() <= now.getTime()) {
    throw new FacilityBookingError(
      'INVALID_HOLD_EXPIRY',
      'holdExpiresAt must be greater than now'
    );
  }

  if (fenceBundleValidUntil) {
    const ceiling = toInstant(fenceBundleValidUntil);
    if (!ceiling) {
      throw new FacilityBookingError(
        'INVALID_HOLD_EXPIRY',
        'Owning fence bundleValidUntil is invalid'
      );
    }
    if (requested.getTime() > ceiling.getTime()) {
      throw new FacilityBookingError(
        'INVALID_HOLD_EXPIRY',
        'holdExpiresAt must not exceed owning fence bundleValidUntil',
        { holdExpiresAt: requested, bundleValidUntil: ceiling }
      );
    }
  }

  return { now, holdExpiresAt: requested };
}

function holdIdentityMatches(row, { start, end, addOn }) {
  if (!row || !start || !end || !addOn) return false;
  const rowStart = toInstant(row.startTime || row.slotStart);
  const rowEnd = toInstant(row.endTime);
  if (!rowStart || !rowEnd) return false;
  if (rowStart.getTime() !== start.getTime()) return false;
  if (rowEnd.getTime() !== end.getTime()) return false;
  if (String(row.addOnCode || '').toLowerCase() !== String(addOn.code || '').toLowerCase()) {
    return false;
  }
  if (Number(row.addOnVersion) !== Number(addOn.version)) return false;
  return true;
}

function withOutcome(doc, outcome) {
  if (!doc) return doc;
  if (typeof doc === 'object') {
    doc.outcome = outcome;
  }
  return doc;
}

/**
 * Prove referenced acquisition attempt exists, is well-formed, same-checkout,
 * and definitively non-live (terminal status + isLive false).
 */
async function assertReferencedAttemptNonLive(
  acquisitionAttemptId,
  checkoutSessionId,
  deps = {}
) {
  const attemptId = String(acquisitionAttemptId || '').trim();
  const owner = String(checkoutSessionId || '').trim();
  if (!attemptId) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'acquisitionAttemptId marker is missing or malformed'
    );
  }
  if (!owner) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'checkoutSessionId is required to validate a stale acquisition marker'
    );
  }
  const Model = getCheckoutResourceAttemptModel(deps);
  let row;
  try {
    row = await Model.findOne({ attemptId }).lean();
  } catch (err) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'Unable to load referenced resource attempt',
      { acquisitionAttemptId: attemptId, cause: err?.message || String(err) }
    );
  }
  if (!row) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'Referenced resource attempt is missing',
      { acquisitionAttemptId: attemptId }
    );
  }
  if (
    typeof row.attemptId !== 'string' ||
    !row.attemptId.trim() ||
    typeof row.checkoutId !== 'string' ||
    !row.checkoutId.trim() ||
    typeof row.isLive !== 'boolean' ||
    !row.status
  ) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'Referenced resource attempt is malformed',
      { acquisitionAttemptId: attemptId }
    );
  }
  if (String(row.checkoutId) !== owner) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'Referenced resource attempt belongs to a different checkout',
      {
        acquisitionAttemptId: attemptId,
        referencedCheckoutId: row.checkoutId,
        checkoutSessionId: owner
      }
    );
  }
  if (row.isLive === true || row.status === 'open') {
    throw new FacilityBookingError(
      'FACILITY_ACQUISITION_IN_PROGRESS',
      'Facility hold is owned by another live resource attempt',
      { acquisitionAttemptId: attemptId, status: row.status, isLive: row.isLive }
    );
  }
  const terminal = new Set(['released', 'failed', 'expired']);
  if (!terminal.has(String(row.status)) || row.isLive !== false) {
    throw new FacilityBookingError(
      'FACILITY_ATTEMPT_MARKER_INTEGRITY',
      'Referenced resource attempt has inconsistent terminal state',
      {
        acquisitionAttemptId: attemptId,
        status: row.status,
        isLive: row.isLive
      }
    );
  }
  return row;
}

async function listCurrentAttemptMarkedHoldIds(checkoutSessionId, attemptId, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  const acquisitionAttemptId = String(attemptId || '').trim();
  if (!owner || !acquisitionAttemptId) return [];
  const rows = await FacilityReservation.find({
    checkoutSessionId: owner,
    status: 'hold',
    acquisitionAttemptId
  })
    .select('_id')
    .lean();
  return rows.map((r) => r._id);
}

async function assertLiveFenceForFacilityMutation(deps = {}) {
  const attemptId = resolveFencedAttemptId(deps);
  if (!attemptId) return null;
  const checkoutId =
    deps.checkoutSessionId != null
      ? String(deps.checkoutSessionId).trim()
      : deps.checkoutId != null
        ? String(deps.checkoutId).trim()
        : '';
  if (!checkoutId) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId is required for fenced facility mutations'
    );
  }
  const fenceService =
    deps.fenceService || require('./checkout/checkoutResourceAttemptFenceService');
  const fenceAssertInput = { checkoutId, attemptId };
  if (deps.quoteSnapshotHash != null) {
    fenceAssertInput.quoteSnapshotHash = deps.quoteSnapshotHash;
  }
  const fence = await fenceService.assertCheckoutResourceAttemptFence(
    fenceAssertInput,
    deps
  );
  return fence;
}

/**
 * Tests must create the unique contention index explicitly (no production migration).
 */
async function ensureFacilityReservationUniqueIndexForTests(deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const spec =
    FacilityReservation.AUTHORITATIVE_UNIQUE_INDEX_SPEC ||
    require('../models/FacilityReservation').AUTHORITATIVE_UNIQUE_INDEX_SPEC;
  // Contention authority — required before concurrency assertions.
  await FacilityReservation.collection.createIndex(spec.keys, { ...spec.options });
  // Secondary indexes: create if missing; ignore "already exists with different name".
  const secondary = [
    [{ checkoutSessionId: 1, status: 1 }, { name: 'facilityReservation_checkout_status' }],
    [{ status: 1, holdExpiresAt: 1 }, { name: 'facilityReservation_status_holdExpiresAt' }],
    [{ bookingId: 1 }, { name: 'facilityReservation_bookingId' }],
    [{ facilityCode: 1, slotStart: 1, status: 1 }, { name: 'facilityReservation_facility_slot_status' }],
    [
      { acquisitionAttemptId: 1 },
      { sparse: true, name: 'facilityReservation_acquisitionAttemptId_sparse' }
    ]
  ];
  for (const [keys, options] of secondary) {
    try {
      await FacilityReservation.collection.createIndex(keys, options);
    } catch (err) {
      if (err && (err.code === 85 || err.code === 86)) continue;
      throw err;
    }
  }
  return spec;
}

function buildHoldDocFields({
  facility,
  addOn,
  start,
  end,
  capacityLane,
  checkoutSessionId,
  holdExpiresAt,
  ratePlanCode,
  ratePlanVersion,
  acquisitionAttemptId = null
}) {
  return {
    facilityCode: facility.facilityCode,
    slotStart: start,
    capacityLane,
    startTime: start,
    endTime: end,
    status: 'hold',
    checkoutSessionId,
    bookingId: null,
    holdExpiresAt,
    addOnCode: addOn.code,
    addOnVersion: addOn.version,
    priceSnapshot: {
      currency: addOn.currency,
      amount: addOn.amount,
      chargeUnit: addOn.chargeUnit,
      addOnCode: addOn.code,
      addOnVersion: addOn.version
    },
    ratePlanCode: ratePlanCode || null,
    ratePlanVersion: ratePlanVersion == null ? null : ratePlanVersion,
    acquisitionAttemptId: acquisitionAttemptId || null
  };
}

function isActiveHold(doc, now) {
  if (!doc || doc.status !== 'hold') return false;
  const exp = toInstant(doc.holdExpiresAt);
  if (!exp) return false;
  return exp > now;
}

function isReclaimableLane(doc, now) {
  if (!doc) return false;
  if (doc.status === 'cancelled' || doc.status === 'expired') return true;
  if (doc.status === 'hold') {
    const exp = toInstant(doc.holdExpiresAt);
    return !exp || exp <= now;
  }
  return false;
}

async function resolveFacilityAndAddOnForHold(input, deps) {
  void input.price;
  void input.amount;
  void input.addOnPrice;
  void input.clientPrice;
  void input.priceSnapshot;

  const facilityCode =
    typeof input.facilityCode === 'string'
      ? input.facilityCode.trim().toLowerCase()
      : input.facility && input.facility.facilityCode
        ? String(input.facility.facilityCode).trim().toLowerCase()
        : '';
  if (!facilityCode) {
    throw new FacilityBookingError(
      'FACILITY_CODE_REQUIRED',
      'facilityCode is required'
    );
  }

  let facility = input.facility;
  if (!facility) {
    const loadFacility =
      deps.loadFacilityByCode ||
      (async () => {
        throw new Error('loadFacilityByCode is required');
      });
    const raw = await loadFacility(facilityCode);
    if (!raw) {
      throw new FacilityBookingError('FACILITY_NOT_FOUND', 'Facility was not found');
    }
    const facilityNorm = validateAndNormalizeFacility(raw);
    if (!facilityNorm.ok) {
      throw new FacilityBookingError(
        'MALFORMED_FACILITY',
        'Facility data is invalid',
        facilityNorm.errors
      );
    }
    facility = facilityNorm.value;
  } else {
    const facilityNorm = validateAndNormalizeFacility(facility);
    if (!facilityNorm.ok) {
      throw new FacilityBookingError(
        'MALFORMED_FACILITY',
        'Facility data is invalid',
        facilityNorm.errors
      );
    }
    facility = facilityNorm.value;
  }

  if (facility.status !== 'active') {
    throw new FacilityBookingError('FACILITY_INACTIVE', 'Facility is not active');
  }
  if (facility.selfLed !== true) {
    throw new FacilityBookingError(
      'FACILITY_NOT_SELF_LED',
      'Only self-led facilities are supported'
    );
  }

  let start = toInstant(input.slotStart || input.startTime || input.start);
  let end = toInstant(input.endTime || input.end);
  if (start && !end) {
    end = new Date(start.getTime() + facility.slotDurationMinutes * 60 * 1000);
  }
  if (!start || !end) {
    throw new FacilityBookingError(
      'INVALID_SLOT',
      'Facility slot start/end is required'
    );
  }

  if (!slotFitsOperatingSchedule(facility, start, end)) {
    throw new FacilityBookingError(
      'OUTSIDE_SCHEDULE',
      'Requested slot is outside the facility operating schedule'
    );
  }

  assertExactConfiguredSlotGrid(facility, start, end);

  if (slotHitsUnavailablePeriod(facility, start, end)) {
    throw new FacilityBookingError(
      'FACILITY_UNAVAILABLE',
      'Requested slot overlaps a facility unavailable period'
    );
  }

  let addOn = input.addOn;
  if (!addOn) {
    const loadAddOn =
      deps.loadAddOnByCodeVersion ||
      (async () => {
        throw new Error('loadAddOnByCodeVersion is required');
      });
    const rawAddOn = await loadAddOn(
      facility.requiredAddOnCode,
      facility.requiredAddOnVersion
    );
    addOn = resolveRequiredAddOn(facility, rawAddOn);
  } else {
    addOn = resolveRequiredAddOn(facility, addOn);
  }

  return { facility, addOn, start, end };
}

async function tryConditionalTakeover({
  FacilityReservation,
  existing,
  facility,
  addOn,
  start,
  end,
  checkoutSessionId,
  holdExpiresAt,
  ratePlanCode,
  ratePlanVersion,
  now,
  acquisitionAttemptId = null
}) {
  if (!isReclaimableLane(existing, now)) return null;

  const filter = {
    _id: existing._id,
    facilityCode: facility.facilityCode,
    slotStart: start,
    capacityLane: existing.capacityLane,
    $or: [
      { status: { $in: ['cancelled', 'expired'] } },
      { status: 'hold', holdExpiresAt: { $lte: now } }
    ]
  };

  const update = {
    $set: buildHoldDocFields({
      facility,
      addOn,
      start,
      end,
      capacityLane: existing.capacityLane,
      checkoutSessionId,
      holdExpiresAt,
      ratePlanCode,
      ratePlanVersion,
      acquisitionAttemptId
    })
  };

  return FacilityReservation.findOneAndUpdate(filter, update, { new: true });
}

/**
 * Same-owner renew/reuse with optional stale-marker clear (fenced) or tokenless block.
 */
async function renewOrReuseSameOwnerHold({
  FacilityReservation,
  row,
  facility,
  addOn,
  start,
  end,
  checkoutSessionId,
  holdExpiresAt,
  now,
  fencedAttemptId,
  deps
}) {
  if (!holdIdentityMatches(row, { start, end, addOn })) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_IDENTITY_MISMATCH',
      'Active same-owner hold does not match requested facility identity',
      {
        reservationId: String(row._id),
        facilityCode: facility.facilityCode
      }
    );
  }

  const existingMarker = markerString(row);

  if (!fencedAttemptId) {
    if (existingMarker) {
      throw new FacilityBookingError(
        'FACILITY_ACQUISITION_IN_PROGRESS',
        'Active facility hold is owned by a live resource attempt',
        { reservationId: String(row._id), acquisitionAttemptId: existingMarker }
      );
    }
    const existingExp = toInstant(row.holdExpiresAt);
    const needsRenew =
      !existingExp || existingExp.getTime() < holdExpiresAt.getTime();
    if (!needsRenew) {
      return withOutcome(row, 'reused');
    }
    const renewed = await FacilityReservation.findOneAndUpdate(
      {
        _id: row._id,
        checkoutSessionId,
        status: 'hold',
        holdExpiresAt: { $gt: now },
        ...unmarkedMarkerFilter()
      },
      { $max: { holdExpiresAt } },
      { new: true }
    );
    if (!renewed) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_RENEW_FAILED',
        'Unable to renew unmarked same-owner facility hold'
      );
    }
    return withOutcome(renewed, 'renewed');
  }

  // Fenced path: never retag to current attempt on renew/reuse.
  if (existingMarker && existingMarker !== fencedAttemptId) {
    await assertReferencedAttemptNonLive(existingMarker, checkoutSessionId, deps);
  }

  const filter = {
    _id: row._id,
    checkoutSessionId,
    status: 'hold',
    holdExpiresAt: { $gt: now },
    facilityCode: facility.facilityCode,
    slotStart: start,
    endTime: end,
    addOnCode: addOn.code,
    addOnVersion: addOn.version
  };
  if (existingMarker && existingMarker !== fencedAttemptId) {
    filter.acquisitionAttemptId = existingMarker;
  }

  const existingExp = toInstant(row.holdExpiresAt);
  const needsRenew =
    !existingExp || existingExp.getTime() < holdExpiresAt.getTime();

  const update = {
    $max: { holdExpiresAt }
  };
  if (existingMarker && existingMarker !== fencedAttemptId) {
    update.$set = { acquisitionAttemptId: null };
  } else if (existingMarker === fencedAttemptId) {
    // Hold still marked by current attempt (retry mid-flight) — leave marker.
  } else {
    // unmarked completed hold — leave null
  }

  const updated = await FacilityReservation.findOneAndUpdate(filter, update, {
    new: true
  });
  if (!updated) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_RENEW_FAILED',
      'Unable to renew/reuse same-owner facility hold under fence'
    );
  }
  return withOutcome(updated, needsRenew ? 'renewed' : 'reused');
}

/**
 * Acquire one concurrency-safe facility hold for a checkoutSessionId.
 * Unique index + conditional takeover; no Mongo transactions.
 * Optional fenced path via deps.acquisitionAttemptId + fence assert.
 */
async function acquireFacilityHold(input = {}, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const fencedAttemptId = resolveFencedAttemptId(deps);

  const checkoutSessionId =
    typeof input.checkoutSessionId === 'string'
      ? input.checkoutSessionId.trim()
      : deps.checkoutSessionId
        ? String(deps.checkoutSessionId).trim()
        : '';
  if (!checkoutSessionId) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId is required to acquire a facility hold'
    );
  }

  let fenceBundleValidUntil = null;
  if (fencedAttemptId) {
    const fence = await assertLiveFenceForFacilityMutation({
      ...deps,
      checkoutSessionId,
      acquisitionAttemptId: fencedAttemptId
    });
    fenceBundleValidUntil = fence.bundleValidUntil;
  }

  const { now, holdExpiresAt } = resolveRequestedHoldExpiresAt(
    input,
    deps,
    fenceBundleValidUntil
  );

  const { facility, addOn, start, end } = await resolveFacilityAndAddOnForHold(
    input,
    deps
  );
  const ratePlanCode = input.ratePlanCode || deps.ratePlanCode || null;
  const ratePlanVersion =
    input.ratePlanVersion != null
      ? input.ratePlanVersion
      : deps.ratePlanVersion != null
        ? deps.ratePlanVersion
        : null;

  const maxLanes = Number(facility.maxConcurrentBookings) || 1;
  const createMarker = fencedAttemptId || null;

  // Same-owner existing row for this facility+slot (any lane).
  const owned = await FacilityReservation.find({
    facilityCode: facility.facilityCode,
    slotStart: start,
    checkoutSessionId
  })
    .sort({ capacityLane: 1 })
    .lean(false);

  for (const row of owned) {
    if (row.status === 'confirmed') {
      if (!holdIdentityMatches(row, { start, end, addOn })) {
        throw new FacilityBookingError(
          'FACILITY_HOLD_IDENTITY_MISMATCH',
          'Confirmed same-owner reservation does not match requested identity'
        );
      }
      return withOutcome(row, 'reused');
    }
    if (isActiveHold(row, now)) {
      return renewOrReuseSameOwnerHold({
        FacilityReservation,
        row,
        facility,
        addOn,
        start,
        end,
        checkoutSessionId,
        holdExpiresAt,
        now,
        fencedAttemptId,
        deps
      });
    }
    if (row.status === 'hold' && !isActiveHold(row, now)) {
      const renewed = await FacilityReservation.findOneAndUpdate(
        {
          _id: row._id,
          facilityCode: facility.facilityCode,
          slotStart: start,
          capacityLane: row.capacityLane,
          status: 'hold',
          holdExpiresAt: { $lte: now },
          checkoutSessionId
        },
        {
          $set: buildHoldDocFields({
            facility,
            addOn,
            start,
            end,
            capacityLane: row.capacityLane,
            checkoutSessionId,
            holdExpiresAt,
            ratePlanCode,
            ratePlanVersion,
            acquisitionAttemptId: createMarker
          })
        },
        { new: true }
      );
      if (renewed) return withOutcome(renewed, 'taken_over');
    }
    if (isReclaimableLane(row, now)) {
      const taken = await tryConditionalTakeover({
        FacilityReservation,
        existing: row,
        facility,
        addOn,
        start,
        end,
        checkoutSessionId,
        holdExpiresAt,
        ratePlanCode,
        ratePlanVersion,
        now,
        acquisitionAttemptId: createMarker
      });
      if (taken) return withOutcome(taken, 'taken_over');
    }
  }

  for (let lane = 0; lane < maxLanes; lane += 1) {
    const payload = buildHoldDocFields({
      facility,
      addOn,
      start,
      end,
      capacityLane: lane,
      checkoutSessionId,
      holdExpiresAt,
      ratePlanCode,
      ratePlanVersion,
      acquisitionAttemptId: createMarker
    });

    try {
      const created = await FacilityReservation.create(payload);
      return withOutcome(created, 'created');
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }

    const existing = await FacilityReservation.findOne({
      facilityCode: facility.facilityCode,
      slotStart: start,
      capacityLane: lane
    });

    if (!existing) {
      continue;
    }

    if (
      existing.checkoutSessionId === checkoutSessionId &&
      existing.status === 'confirmed'
    ) {
      if (!holdIdentityMatches(existing, { start, end, addOn })) {
        throw new FacilityBookingError(
          'FACILITY_HOLD_IDENTITY_MISMATCH',
          'Confirmed same-owner reservation does not match requested identity'
        );
      }
      return withOutcome(existing, 'reused');
    }
    if (
      existing.checkoutSessionId === checkoutSessionId &&
      isActiveHold(existing, now)
    ) {
      return renewOrReuseSameOwnerHold({
        FacilityReservation,
        row: existing,
        facility,
        addOn,
        start,
        end,
        checkoutSessionId,
        holdExpiresAt,
        now,
        fencedAttemptId,
        deps
      });
    }

    if (existing.status === 'confirmed') {
      continue;
    }

    if (isActiveHold(existing, now)) {
      continue;
    }

    const taken = await tryConditionalTakeover({
      FacilityReservation,
      existing,
      facility,
      addOn,
      start,
      end,
      checkoutSessionId,
      holdExpiresAt,
      ratePlanCode,
      ratePlanVersion,
      now,
      acquisitionAttemptId: createMarker
    });
    if (taken) return withOutcome(taken, 'taken_over');
  }

  throw new FacilityBookingError(
    'SLOT_AT_CAPACITY',
    'Requested facility slot is at capacity',
    { facilityCode: facility.facilityCode, slotStart: start.toISOString() }
  );
}

function selectionIdentity(sel) {
  const facilityCode = String(sel.facilityCode || '')
    .trim()
    .toLowerCase();
  const start = toInstant(sel.slotStart || sel.startTime || sel.start);
  return {
    facilityCode,
    slotStartMs: start ? start.getTime() : null,
    key: `${facilityCode}|${start ? start.toISOString() : ''}`
  };
}

/**
 * Acquire multiple facility holds in deterministic order with compensation.
 */
async function acquireFacilityHolds(selections = [], deps = {}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return {
      ok: true,
      holds: [],
      outcomes: [],
      order: [],
      newlyAcquiredIds: [],
      compensableHoldIds: []
    };
  }

  const identities = selections.map(selectionIdentity);
  const seen = new Set();
  for (const id of identities) {
    if (!id.facilityCode || id.slotStartMs == null) {
      throw new FacilityBookingError(
        'INVALID_SLOT',
        'Each facility selection requires facilityCode and slot start'
      );
    }
    if (seen.has(id.key)) {
      throw new FacilityBookingError(
        'DUPLICATE_FACILITY_SELECTION',
        'Duplicate facility slot selections are not allowed',
        { key: id.key }
      );
    }
    seen.add(id.key);
  }

  const indexed = selections.map((sel, originalIndex) => ({
    sel,
    originalIndex,
    ...selectionIdentity(sel)
  }));
  indexed.sort((a, b) => {
    if (a.facilityCode < b.facilityCode) return -1;
    if (a.facilityCode > b.facilityCode) return 1;
    return a.slotStartMs - b.slotStartMs;
  });

  const newlyAcquiredIds = [];
  const compensableHoldIds = [];
  const compensableSeen = new Set();
  const addCompensable = (id) => {
    if (id == null) return;
    const key = String(id);
    if (compensableSeen.has(key)) return;
    compensableSeen.add(key);
    compensableHoldIds.push(id);
  };
  const holdByOriginalIndex = new Array(selections.length);
  const outcomeByOriginalIndex = new Array(selections.length);
  const fencedAttemptId = resolveFencedAttemptId(deps);

  const checkoutSessionId =
    typeof selections[0].checkoutSessionId === 'string'
      ? selections[0].checkoutSessionId.trim()
      : deps.checkoutSessionId
        ? String(deps.checkoutSessionId).trim()
        : '';

  if (fencedAttemptId) {
    await assertLiveFenceForFacilityMutation({
      ...deps,
      checkoutSessionId,
      acquisitionAttemptId: fencedAttemptId
    });
    const seeded = await listCurrentAttemptMarkedHoldIds(
      checkoutSessionId,
      fencedAttemptId,
      deps
    );
    for (const id of seeded) addCompensable(id);
  }

  try {
    for (const item of indexed) {
      const input = {
        ...item.sel,
        checkoutSessionId: item.sel.checkoutSessionId || checkoutSessionId
      };
      if (!input.checkoutSessionId) {
        throw new FacilityBookingError(
          'FACILITY_HOLD_OWNER_REQUIRED',
          'checkoutSessionId is required to acquire a facility hold'
        );
      }

      const FacilityReservation = getFacilityReservationModel(deps);
      const now = deps.now ? toInstant(deps.now) : new Date();
      const before = await FacilityReservation.findOne({
        facilityCode: item.facilityCode,
        slotStart: toInstant(item.sel.slotStart || item.sel.startTime || item.sel.start),
        checkoutSessionId: input.checkoutSessionId,
        $or: [
          { status: 'confirmed' },
          {
            status: 'hold',
            holdExpiresAt: { $gt: now }
          }
        ]
      }).lean();

      const hold = await acquireFacilityHold(input, {
        ...deps,
        checkoutSessionId: input.checkoutSessionId
      });
      const outcome = hold.outcome || 'created';
      holdByOriginalIndex[item.originalIndex] = hold;
      outcomeByOriginalIndex[item.originalIndex] = outcome;

      if (outcome === 'created' || outcome === 'taken_over') {
        newlyAcquiredIds.push(hold._id);
        addCompensable(hold._id);
      } else if (!fencedAttemptId) {
        // Legacy journaling: treat brand-new id as newly acquired when outcome absent.
        if (!(before && String(before._id) === String(hold._id))) {
          if (outcome !== 'renewed' && outcome !== 'reused') {
            newlyAcquiredIds.push(hold._id);
          }
        }
      }
      // Same-attempt renewed/reused rows keep markers and remain in compensableHoldIds via seed.
    }

    return {
      ok: true,
      holds: holdByOriginalIndex,
      outcomes: outcomeByOriginalIndex,
      acquisitionOrder: indexed.map((i) => i.originalIndex),
      newlyAcquiredIds,
      compensableHoldIds: [...compensableHoldIds]
    };
  } catch (err) {
    const owner =
      checkoutSessionId ||
      (selections[0] && selections[0].checkoutSessionId) ||
      '';
    let idsForCompensate = newlyAcquiredIds;
    if (fencedAttemptId) {
      const durable = await listCurrentAttemptMarkedHoldIds(
        owner,
        fencedAttemptId,
        deps
      );
      for (const id of durable) addCompensable(id);
      idsForCompensate = [...compensableHoldIds];
    }
    const compensation = await compensateFacilityHolds(owner, idsForCompensate, deps);
    if (err instanceof FacilityBookingError) {
      err.details = {
        ...(err.details || {}),
        compensation,
        compensableHoldIds: idsForCompensate.map(String)
      };
      throw err;
    }
    const wrapped = new FacilityBookingError(
      'FACILITY_HOLD_ACQUIRE_FAILED',
      err.message || 'Facility hold acquisition failed',
      { compensation, compensableHoldIds: idsForCompensate.map(String) }
    );
    throw wrapped;
  }
}

/**
 * Cancel holds for this checkout only (never confirmed / never other owners).
 * Token-aware: requires exact acquisitionAttemptId match.
 * Tokenless: unmarked rows only.
 */
async function compensateFacilityHolds(checkoutSessionId, holdIds = [], deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  const ids = (holdIds || []).filter(Boolean);
  const cancelledIds = [];
  const remainingHoldIds = [];
  const skipped = [];
  const attemptId = resolveFencedAttemptId(deps);

  if (!owner) {
    return {
      ok: false,
      cancelledIds,
      remainingHoldIds: ids.map(String),
      skipped,
      code: 'FACILITY_HOLD_OWNER_REQUIRED'
    };
  }

  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const id = ids[i];
    try {
      const doc = await FacilityReservation.findById(id);
      if (!doc) {
        skipped.push({ id: String(id), reason: 'missing' });
        continue;
      }
      if (doc.checkoutSessionId !== owner) {
        skipped.push({ id: String(id), reason: 'foreign_owner' });
        remainingHoldIds.push(String(id));
        continue;
      }
      if (doc.status === 'confirmed') {
        skipped.push({ id: String(id), reason: 'confirmed' });
        remainingHoldIds.push(String(id));
        continue;
      }
      if (doc.status === 'cancelled' || doc.status === 'expired') {
        skipped.push({ id: String(id), reason: 'already_terminal' });
        continue;
      }
      if (doc.status !== 'hold') {
        skipped.push({ id: String(id), reason: `status_${doc.status}` });
        remainingHoldIds.push(String(id));
        continue;
      }

      if (attemptId) {
        if (markerString(doc) !== attemptId) {
          skipped.push({ id: String(id), reason: 'marker_mismatch' });
          remainingHoldIds.push(String(id));
          continue;
        }
      } else if (hasAcquisitionMarker(doc)) {
        skipped.push({ id: String(id), reason: 'marker_owned' });
        remainingHoldIds.push(String(id));
        continue;
      }

      const filter = {
        _id: id,
        checkoutSessionId: owner,
        status: 'hold'
      };
      if (attemptId) {
        filter.acquisitionAttemptId = attemptId;
      } else {
        Object.assign(filter, unmarkedMarkerFilter());
      }

      const updated = await FacilityReservation.findOneAndUpdate(
        filter,
        { $set: { status: 'cancelled' } },
        { new: true }
      );
      if (updated) {
        cancelledIds.push(String(id));
      } else {
        remainingHoldIds.push(String(id));
        skipped.push({ id: String(id), reason: 'update_lost_race' });
      }
    } catch (err) {
      remainingHoldIds.push(String(id));
      skipped.push({
        id: String(id),
        reason: 'error',
        message: err.message || String(err)
      });
    }
  }

  return {
    ok: remainingHoldIds.length === 0,
    cancelledIds,
    remainingHoldIds,
    skipped
  };
}

/**
 * Owner-scoped release of holds → cancelled (idempotent). Does not touch confirmed.
 * Tokenless: unmarked only. Token-aware when options.acquisitionAttemptId or deps set.
 */
async function releaseFacilityHolds(checkoutSessionId, options = {}, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  if (!owner) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId is required to release facility holds'
    );
  }

  const attemptId =
    options.acquisitionAttemptId != null
      ? String(options.acquisitionAttemptId).trim()
      : resolveFencedAttemptId(deps);

  const filter = {
    checkoutSessionId: owner,
    status: 'hold'
  };
  if (Array.isArray(options.holdIds) && options.holdIds.length) {
    filter._id = { $in: options.holdIds };
  }
  if (options.facilityCode) {
    filter.facilityCode = String(options.facilityCode).trim().toLowerCase();
  }
  if (options.slotStart) {
    filter.slotStart = toInstant(options.slotStart);
  }
  if (attemptId) {
    filter.acquisitionAttemptId = attemptId;
  } else {
    Object.assign(filter, unmarkedMarkerFilter());
  }

  const result = await FacilityReservation.updateMany(filter, {
    $set: { status: 'cancelled' }
  });

  return {
    ok: true,
    matchedCount: result.matchedCount ?? result.n,
    modifiedCount: result.modifiedCount ?? result.nModified
  };
}

/**
 * Soft-expired holds → status expired. Safe to repeat. Never touches confirmed.
 * Marker does not prevent expiry when holdExpiresAt <= now.
 */
async function expireFacilityHolds(deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const now = deps.now ? toInstant(deps.now) : new Date();
  const result = await FacilityReservation.updateMany(
    {
      status: 'hold',
      holdExpiresAt: { $lte: now }
    },
    { $set: { status: 'expired' } }
  );
  return {
    ok: true,
    matchedCount: result.matchedCount ?? result.n,
    modifiedCount: result.modifiedCount ?? result.nModified
  };
}

/**
 * Confirm owner's active holds for a booking. Idempotent for same bookingId.
 * Only unmarked holds may be confirmed. Preflight all targets before any mutation.
 */
async function confirmFacilityHolds(checkoutSessionId, bookingId, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  if (!owner) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId is required to confirm facility holds'
    );
  }
  if (!bookingId) {
    throw new FacilityBookingError(
      'BOOKING_ID_REQUIRED',
      'bookingId is required to confirm facility holds'
    );
  }

  const now = deps.now ? toInstant(deps.now) : new Date();
  const rows = await FacilityReservation.find({ checkoutSessionId: owner });

  const relevant = rows.filter(
    (row) => row.status === 'hold' || row.status === 'confirmed'
  );

  if (!relevant.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_MISSING',
      'No facility reservations found for this checkout'
    );
  }

  const alreadyConfirmed = [];
  const holdTargets = [];

  for (const row of relevant) {
    if (row.status === 'confirmed') {
      if (String(row.bookingId) === String(bookingId)) {
        alreadyConfirmed.push(row);
        continue;
      }
      throw new FacilityBookingError(
        'FACILITY_HOLD_BOOKING_CONFLICT',
        'Facility reservation is already confirmed for a different booking',
        { reservationId: String(row._id) }
      );
    }

    // status === 'hold' — validate before any mutation
    if (hasAcquisitionMarker(row)) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'In-flight facility hold with acquisition marker cannot be confirmed',
        {
          reservationId: String(row._id),
          acquisitionAttemptId: markerString(row)
        }
      );
    }

    if (!isActiveHold(row, now)) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_EXPIRED',
        'Facility hold has expired and cannot be confirmed',
        { reservationId: String(row._id) }
      );
    }

    holdTargets.push(row);
  }

  if (!holdTargets.length) {
    return { ok: true, reservations: alreadyConfirmed };
  }

  const targetIds = holdTargets.map((r) => r._id);
  const result = await FacilityReservation.updateMany(
    {
      _id: { $in: targetIds },
      checkoutSessionId: owner,
      status: 'hold',
      holdExpiresAt: { $gt: now },
      ...unmarkedMarkerFilter()
    },
    {
      $set: {
        status: 'confirmed',
        bookingId,
        holdExpiresAt: null
      }
    }
  );

  const matched = result.matchedCount ?? result.n ?? 0;
  if (matched !== targetIds.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Facility hold confirmation did not match the complete expected target set',
      {
        expectedCount: targetIds.length,
        matchedCount: matched
      }
    );
  }

  const confirmedRows = await FacilityReservation.find({
    _id: { $in: targetIds },
    checkoutSessionId: owner,
    status: 'confirmed',
    bookingId
  });

  if (confirmedRows.length !== targetIds.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Facility hold confirmation could not be verified for every target',
      {
        expectedCount: targetIds.length,
        confirmedCount: confirmedRows.length
      }
    );
  }

  return { ok: true, reservations: [...alreadyConfirmed, ...confirmedRows] };
}

/**
 * Exact-set facility confirmation under durable paid CheckoutSession authority (B8F4B).
 * Confirms only the provided reservation IDs; extra same-checkout holds remain untouched.
 *
 * Production authority always loads the canonical CheckoutSession document by checkoutId.
 * Never accepts a caller-supplied session document as authority. `deps.CheckoutSession`
 * may override the model constructor for tests only.
 */
/**
 * B8F4B Correction 2 — commercial identity key for quote selection ↔ reservation.
 * Capacity lane is intentionally excluded (not durable on quoteSnapshot).
 */
function facilityCommercialIdentityKeyFromSelection(sel) {
  if (!sel || typeof sel !== 'object') {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility selection must be an object'
    );
  }
  const facilityCode =
    sel.facilityCode != null ? String(sel.facilityCode).trim().toLowerCase() : '';
  const start = toInstant(sel.slotStart || sel.startTime || sel.start);
  const end = toInstant(sel.endTime || sel.end);
  const addOnSrc = sel.addOn && typeof sel.addOn === 'object' ? sel.addOn : {};
  const addOnCode =
    addOnSrc.code != null
      ? String(addOnSrc.code).trim().toLowerCase()
      : sel.addOnCode != null
        ? String(sel.addOnCode).trim().toLowerCase()
        : sel.priceSnapshot && sel.priceSnapshot.addOnCode != null
          ? String(sel.priceSnapshot.addOnCode).trim().toLowerCase()
          : '';
  const addOnVersion = Number(
    addOnSrc.version != null
      ? addOnSrc.version
      : sel.addOnVersion != null
        ? sel.addOnVersion
        : sel.priceSnapshot && sel.priceSnapshot.addOnVersion
  );
  const amountRaw =
    addOnSrc.amount != null
      ? addOnSrc.amount
      : sel.amount != null
        ? sel.amount
        : sel.priceSnapshot && sel.priceSnapshot.amount;
  const amount = Number(amountRaw);
  const chargeUnit =
    addOnSrc.chargeUnit != null
      ? String(addOnSrc.chargeUnit).trim().toLowerCase()
      : sel.chargeUnit != null
        ? String(sel.chargeUnit).trim().toLowerCase()
        : sel.priceSnapshot && sel.priceSnapshot.chargeUnit != null
          ? String(sel.priceSnapshot.chargeUnit).trim().toLowerCase()
          : '';

  if (!facilityCode || !start || !end) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility selection is missing facilityCode, slot start, or endTime'
    );
  }
  if (!addOnCode || !Number.isInteger(addOnVersion) || addOnVersion < 1) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility selection is missing add-on identity or version'
    );
  }
  if (!Number.isFinite(amount) || amount < 0 || !chargeUnit) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility selection is missing add-on amount or chargeUnit'
    );
  }
  if (end.getTime() <= start.getTime()) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility selection endTime must be after start'
    );
  }

  return [
    facilityCode,
    String(start.getTime()),
    String(end.getTime()),
    addOnCode,
    String(addOnVersion),
    String(amount),
    chargeUnit
  ].join('|');
}

function facilityCommercialIdentityKeyFromReservation(row) {
  if (!row || typeof row !== 'object') {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility reservation is required for identity comparison'
    );
  }
  const facilityCode =
    row.facilityCode != null ? String(row.facilityCode).trim().toLowerCase() : '';
  const start = toInstant(row.slotStart || row.startTime);
  const end = toInstant(row.endTime);
  const addOnCode =
    row.addOnCode != null
      ? String(row.addOnCode).trim().toLowerCase()
      : row.priceSnapshot && row.priceSnapshot.addOnCode != null
        ? String(row.priceSnapshot.addOnCode).trim().toLowerCase()
        : '';
  const addOnVersion = Number(
    row.addOnVersion != null
      ? row.addOnVersion
      : row.priceSnapshot && row.priceSnapshot.addOnVersion
  );
  const amount = Number(
    row.priceSnapshot && row.priceSnapshot.amount != null
      ? row.priceSnapshot.amount
      : row.amount
  );
  const chargeUnit =
    row.priceSnapshot && row.priceSnapshot.chargeUnit != null
      ? String(row.priceSnapshot.chargeUnit).trim().toLowerCase()
      : row.chargeUnit != null
        ? String(row.chargeUnit).trim().toLowerCase()
        : '';

  if (!facilityCode || !start || !end || !addOnCode || !Number.isInteger(addOnVersion)) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility reservation is missing durable commercial identity fields'
    );
  }
  if (!Number.isFinite(amount) || amount < 0 || !chargeUnit) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_IDENTITY',
      'Facility reservation is missing priceSnapshot amount or chargeUnit'
    );
  }

  return [
    facilityCode,
    String(start.getTime()),
    String(end.getTime()),
    addOnCode,
    String(addOnVersion),
    String(amount),
    chargeUnit
  ].join('|');
}

function normalizeQuoteFacilitySelections(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new FacilityBookingError(
      'FACILITY_SELECTION_SHAPE',
      'quoteSnapshot.facilitySelections must be an array when present'
    );
  }
  return raw;
}

function normalizeLeaseFacilityHoldIds(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_ID_SHAPE',
      'resourceLease.facilityHoldIds must be an array when present'
    );
  }
  return raw.map((id) => String(id == null ? '' : id).trim());
}

function assertNoDuplicateStrings(values, code, message) {
  const seen = new Set();
  for (const v of values) {
    if (seen.has(v)) {
      throw new FacilityBookingError(code, message, { duplicate: v });
    }
    seen.add(v);
  }
}

function assertMultisetEqual(leftKeys, rightKeys, details = {}) {
  if (leftKeys.length !== rightKeys.length) {
    throw new FacilityBookingError(
      'FACILITY_QUOTE_LEASE_MISMATCH',
      'Quote facility selections and leased facility holds do not agree in count',
      { ...details, quoteCount: leftKeys.length, leaseCount: rightKeys.length }
    );
  }
  const bag = new Map();
  for (const k of leftKeys) {
    bag.set(k, (bag.get(k) || 0) + 1);
  }
  for (const k of rightKeys) {
    const n = bag.get(k) || 0;
    if (n < 1) {
      throw new FacilityBookingError(
        'FACILITY_QUOTE_LEASE_MISMATCH',
        'Leased facility hold commercial identity is not present in quote selections',
        { ...details, identityKey: k }
      );
    }
    bag.set(k, n - 1);
  }
  for (const [k, n] of bag.entries()) {
    if (n !== 0) {
      throw new FacilityBookingError(
        'FACILITY_QUOTE_LEASE_MISMATCH',
        'Quote facility selection commercial identity is not covered by leased holds',
        { ...details, identityKey: k, remaining: n }
      );
    }
  }
}

/**
 * Prove immutable quote facilitySelections ↔ resourceLease.facilityHoldIds
 * one-to-one commercial agreement before any facility mutation.
 * Skip only when both collections are empty.
 */
async function assertQuoteLeaseFacilityConsistency(session, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const checkoutId = session && session.checkoutId != null ? String(session.checkoutId) : '';
  if (!checkoutId) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutId is required for quote-to-lease facility consistency'
    );
  }

  const snap =
    session.quoteSnapshot && typeof session.quoteSnapshot === 'object'
      ? session.quoteSnapshot
      : {};
  const rl =
    session.resourceLease && typeof session.resourceLease === 'object'
      ? session.resourceLease
      : {};

  const selections = normalizeQuoteFacilitySelections(snap.facilitySelections);
  const leaseIdsRaw = normalizeLeaseFacilityHoldIds(rl.facilityHoldIds);

  if (leaseIdsRaw.some((id) => !id)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_ID_SHAPE',
      'resourceLease.facilityHoldIds contains a malformed empty id'
    );
  }
  assertNoDuplicateStrings(
    leaseIdsRaw,
    'DUPLICATE_FACILITY_HOLD_ID',
    'Duplicate facility hold IDs are not allowed on the resource lease'
  );

  const selectionKeys = [];
  for (const sel of selections) {
    selectionKeys.push(facilityCommercialIdentityKeyFromSelection(sel));
  }
  assertNoDuplicateStrings(
    selectionKeys,
    'DUPLICATE_FACILITY_SELECTION',
    'Duplicate quote facility selections are not allowed'
  );

  if (selectionKeys.length === 0 && leaseIdsRaw.length === 0) {
    return {
      ok: true,
      skip: true,
      facilityReservationIds: [],
      facilitySelections: []
    };
  }

  if (selectionKeys.length === 0 || leaseIdsRaw.length === 0) {
    throw new FacilityBookingError(
      'FACILITY_QUOTE_LEASE_XOR',
      'Quote facility selections and lease facility hold IDs must both be empty or both be non-empty',
      {
        checkoutId,
        quoteSelectionCount: selectionKeys.length,
        leaseHoldCount: leaseIdsRaw.length
      }
    );
  }

  const rows = await FacilityReservation.find({ _id: { $in: leaseIdsRaw } });
  if (rows.length !== leaseIdsRaw.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_MISSING',
      'One or more leased facility reservation IDs could not be loaded',
      {
        checkoutId,
        expectedCount: leaseIdsRaw.length,
        foundCount: rows.length
      }
    );
  }

  const reservationKeys = [];
  for (const row of rows) {
    if (String(row.checkoutSessionId || '') !== checkoutId) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Leased facility reservation belongs to a different checkout',
        { reservationId: String(row._id), checkoutSessionId: row.checkoutSessionId }
      );
    }
    if (row.status !== 'hold' && row.status !== 'confirmed') {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Leased facility reservation is not in a confirmable status',
        { reservationId: String(row._id), status: row.status }
      );
    }
    reservationKeys.push(facilityCommercialIdentityKeyFromReservation(row));
  }

  assertMultisetEqual(selectionKeys, reservationKeys, { checkoutId });

  const sortedIds = [...leaseIdsRaw].sort();
  return {
    ok: true,
    skip: false,
    facilityReservationIds: sortedIds,
    facilitySelections: selections
  };
}

async function confirmExactFacilityHoldsForPaidCheckout(
  {
    checkoutId,
    bookingId,
    facilityReservationIds,
    generation,
    attemptId,
    quoteSnapshotHash
  },
  deps = {}
) {
  // Production path: require('../models/CheckoutSession'). deps.CheckoutSession is test-only.
  const CheckoutSession = deps.CheckoutSession || require('../models/CheckoutSession');
  const FacilityReservation = getFacilityReservationModel(deps);

  const owner = String(checkoutId || '').trim();
  if (!owner) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutId is required to confirm exact facility holds'
    );
  }
  if (!bookingId) {
    throw new FacilityBookingError(
      'BOOKING_ID_REQUIRED',
      'bookingId is required to confirm exact facility holds'
    );
  }

  const rawIds = Array.isArray(facilityReservationIds) ? facilityReservationIds : [];
  const normalized = rawIds.map((id) => String(id == null ? '' : id).trim());
  if (normalized.length === 0 || normalized.some((id) => !id)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_MISSING',
      'Exact facility reservation ID set must be non-empty',
      { facilityReservationIds: rawIds }
    );
  }
  const seen = new Set();
  for (const id of normalized) {
    if (seen.has(id)) {
      throw new FacilityBookingError(
        'DUPLICATE_FACILITY_SELECTION',
        'Duplicate facility reservation IDs are not allowed',
        { reservationId: id }
      );
    }
    seen.add(id);
  }
  const exactIds = [...normalized];
  const exactSet = new Set(exactIds);

  const session = await CheckoutSession.findOne({ checkoutId: owner }).lean();
  if (!session) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Durable CheckoutSession is required for exact facility confirmation',
      { checkoutId: owner }
    );
  }
  if (String(session.flowVersion || '') !== 'v2') {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Exact facility confirmation requires flowVersion v2',
      { checkoutId: owner, flowVersion: session.flowVersion }
    );
  }
  if (String(session.finalizeStatus || '') !== 'in_progress') {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Exact facility confirmation requires finalizeStatus in_progress',
      { checkoutId: owner, finalizeStatus: session.finalizeStatus }
    );
  }
  if (session.bookingId == null || String(session.bookingId) !== String(bookingId)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'CheckoutSession bookingId must match confirmation target',
      {
        checkoutId: owner,
        sessionBookingId: session.bookingId != null ? String(session.bookingId) : null,
        bookingId: String(bookingId)
      }
    );
  }

  const rl = session.resourceLease;
  if (!rl || typeof rl !== 'object') {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'CheckoutSession.resourceLease is required',
      { checkoutId: owner }
    );
  }
  if (String(rl.status || '') !== 'paid') {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'resourceLease.status must be paid',
      { checkoutId: owner, resourceLeaseStatus: rl.status }
    );
  }
  if (Number(rl.generation) !== Number(generation)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'resourceLease.generation does not match',
      { checkoutId: owner, expected: Number(generation), actual: rl.generation }
    );
  }
  if (String(rl.attemptId || '') !== String(attemptId)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'resourceLease.attemptId does not match',
      { checkoutId: owner, expected: String(attemptId), actual: rl.attemptId }
    );
  }
  if (String(rl.quoteSnapshotHash || '') !== String(quoteSnapshotHash)) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'resourceLease.quoteSnapshotHash does not match',
      {
        checkoutId: owner,
        expected: String(quoteSnapshotHash),
        actual: rl.quoteSnapshotHash
      }
    );
  }

  const sessionFacilityIds = Array.isArray(rl.facilityHoldIds)
    ? rl.facilityHoldIds
        .map((id) => String(id == null ? '' : id).trim())
        .filter(Boolean)
    : [];
  const sessionSet = new Set(sessionFacilityIds);
  if (
    sessionSet.size !== exactSet.size ||
    [...exactSet].some((id) => !sessionSet.has(id))
  ) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Exact facility reservation set must equal resourceLease.facilityHoldIds',
      {
        checkoutId: owner,
        expected: [...sessionSet].sort(),
        actual: [...exactSet].sort()
      }
    );
  }

  // Quote ↔ lease commercial consistency before any mutation.
  const consistency = await assertQuoteLeaseFacilityConsistency(session, deps);
  if (consistency.skip === true) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_MISSING',
      'Exact facility confirmation requires a non-empty consistent facility set'
    );
  }

  const rows = await FacilityReservation.find({ _id: { $in: exactIds } });
  if (rows.length !== exactIds.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_MISSING',
      'One or more exact facility reservation IDs are missing',
      {
        expectedCount: exactIds.length,
        foundCount: rows.length,
        foundIds: rows.map((r) => String(r._id))
      }
    );
  }

  const holdTargets = [];
  for (const row of rows) {
    if (String(row.checkoutSessionId || '') !== owner) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Facility reservation belongs to a different checkout',
        {
          reservationId: String(row._id),
          checkoutSessionId: row.checkoutSessionId
        }
      );
    }
    if (row.status === 'confirmed') {
      if (String(row.bookingId) !== String(bookingId)) {
        throw new FacilityBookingError(
          'FACILITY_HOLD_BOOKING_CONFLICT',
          'Facility reservation is already confirmed for a different booking',
          { reservationId: String(row._id) }
        );
      }
      continue;
    }
    if (row.status !== 'hold') {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Facility reservation is not in a confirmable status',
        { reservationId: String(row._id), status: row.status }
      );
    }
    if (hasAcquisitionMarker(row)) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'In-flight facility hold with acquisition marker cannot be confirmed',
        {
          reservationId: String(row._id),
          acquisitionAttemptId: markerString(row)
        }
      );
    }
    holdTargets.push(row);
  }

  if (holdTargets.length) {
    const targetIds = holdTargets.map((r) => r._id);
    // Paid lease ownership alone is enough for expiry — do not filter holdExpiresAt.
    // Still require unmarked acquisition markers (same as legacy confirmFacilityHolds).
    const result = await FacilityReservation.updateMany(
      {
        _id: { $in: targetIds },
        checkoutSessionId: owner,
        status: 'hold',
        ...unmarkedMarkerFilter()
      },
      {
        $set: {
          status: 'confirmed',
          bookingId,
          holdExpiresAt: null
        }
      }
    );
    const matched = result.matchedCount ?? result.n ?? 0;
    if (matched !== targetIds.length) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Exact facility hold confirmation did not match the complete expected target set',
        {
          expectedCount: targetIds.length,
          matchedCount: matched
        }
      );
    }
  }

  const confirmedRows = await FacilityReservation.find({
    _id: { $in: exactIds }
  });
  if (confirmedRows.length !== exactIds.length) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_NOT_CONFIRMABLE',
      'Exact facility confirmation could not reload every reservation',
      {
        expectedCount: exactIds.length,
        foundCount: confirmedRows.length
      }
    );
  }
  for (const row of confirmedRows) {
    if (row.status !== 'confirmed' || String(row.bookingId) !== String(bookingId)) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_NOT_CONFIRMABLE',
        'Exact facility reservation is not confirmed for the bound booking',
        {
          reservationId: String(row._id),
          status: row.status,
          bookingId: row.bookingId != null ? String(row.bookingId) : null
        }
      );
    }
  }

  const sortedIds = [...exactIds].sort();
  const byId = new Map(confirmedRows.map((r) => [String(r._id), r]));
  return {
    ok: true,
    reservationIds: sortedIds,
    reservations: sortedIds.map((id) => byId.get(id))
  };
}

async function clearFacilityAcquisitionMarkers(
  { checkoutSessionId, attemptId },
  deps = {}
) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  const acquisitionAttemptId = String(attemptId || '').trim();
  if (!owner || !acquisitionAttemptId) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId and attemptId are required to clear markers'
    );
  }

  await assertLiveFenceForFacilityMutation({
    ...deps,
    checkoutSessionId: owner,
    acquisitionAttemptId
  });

  const result = await FacilityReservation.updateMany(
    {
      checkoutSessionId: owner,
      acquisitionAttemptId
    },
    { $set: { acquisitionAttemptId: null } }
  );

  const remaining = await FacilityReservation.find({
    checkoutSessionId: owner,
    acquisitionAttemptId
  })
    .select('_id')
    .lean();
  const remainingHoldIds = remaining.map((r) => String(r._id));

  return {
    ok: remainingHoldIds.length === 0,
    modifiedCount: result.modifiedCount ?? result.nModified ?? 0,
    remainingHoldIds
  };
}

async function assertNoFacilityAcquisitionMarkers(
  { checkoutSessionId, attemptId },
  deps = {}
) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(checkoutSessionId || '').trim();
  const acquisitionAttemptId = String(attemptId || '').trim();
  const remaining = await FacilityReservation.find({
    checkoutSessionId: owner,
    acquisitionAttemptId
  })
    .select('_id')
    .lean();
  if (remaining.length) {
    throw new FacilityBookingError(
      'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
      'Facility acquisition markers remain for this attempt',
      {
        remainingHoldIds: remaining.map((r) => String(r._id)),
        attemptId: acquisitionAttemptId,
        checkoutId: owner
      }
    );
  }
  return { ok: true, remainingHoldIds: [] };
}

function selectionMatchKey(sel) {
  const facilityCode = String(sel.facilityCode || '')
    .trim()
    .toLowerCase();
  const start = toInstant(sel.slotStart || sel.startTime || sel.start);
  const end = toInstant(sel.endTime || sel.end);
  const addOnCode = String(
    (sel.addOn && sel.addOn.code) || sel.addOnCode || ''
  )
    .trim()
    .toLowerCase();
  const addOnVersion = Number(
    (sel.addOn && sel.addOn.version) != null
      ? sel.addOn.version
      : sel.addOnVersion
  );
  return {
    facilityCode,
    start,
    end,
    addOnCode,
    addOnVersion,
    key: `${facilityCode}|${start ? start.toISOString() : ''}|${
      end ? end.toISOString() : ''
    }|${addOnCode}|${addOnVersion}`
  };
}

/**
 * Verify every expected selection has exactly one usable hold.
 */
async function assertFacilityHoldsActive(input = {}, deps = {}) {
  const FacilityReservation = getFacilityReservationModel(deps);
  const owner = String(input.checkoutSessionId || '').trim();
  const attemptId = String(input.attemptId || '').trim();
  const selections = Array.isArray(input.selections) ? input.selections : [];
  const bundleValidUntil = toInstant(input.bundleValidUntil);
  const now = input.now != null ? toInstant(input.now) : deps.now ? toInstant(deps.now) : new Date();

  if (!owner) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'checkoutSessionId is required'
    );
  }
  if (!attemptId) {
    throw new FacilityBookingError(
      'FACILITY_HOLD_OWNER_REQUIRED',
      'attemptId is required for hold verification'
    );
  }
  if (!bundleValidUntil) {
    throw new FacilityBookingError(
      'INVALID_HOLD_EXPIRY',
      'bundleValidUntil is required for hold verification'
    );
  }
  if (!now) {
    throw new FacilityBookingError('INVALID_NOW', 'now must be a valid instant');
  }

  await assertLiveFenceForFacilityMutation({
    ...deps,
    checkoutSessionId: owner,
    acquisitionAttemptId: attemptId,
    now
  });

  const AttemptModel = getCheckoutResourceAttemptModel(deps);
  const rows = await FacilityReservation.find({
    checkoutSessionId: owner,
    status: 'hold'
  }).lean();

  const matchedIds = new Set();
  const holds = [];
  const extraHoldIds = [];

  for (const sel of selections) {
    const id = selectionMatchKey(sel);
    if (!id.facilityCode || !id.start || !id.end || !id.addOnCode || !Number.isInteger(id.addOnVersion)) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Selection identity is incomplete',
        { selection: id }
      );
    }

    const matches = rows.filter((row) => {
      const rowStart = toInstant(row.startTime || row.slotStart);
      const rowEnd = toInstant(row.endTime);
      return (
        String(row.facilityCode) === id.facilityCode &&
        rowStart &&
        rowEnd &&
        rowStart.getTime() === id.start.getTime() &&
        rowEnd.getTime() === id.end.getTime() &&
        String(row.addOnCode) === id.addOnCode &&
        Number(row.addOnVersion) === id.addOnVersion
      );
    });

    if (matches.length === 0) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Missing facility hold for expected selection',
        { selection: id.key }
      );
    }
    if (matches.length > 1) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Duplicate facility holds match expected selection',
        { selection: id.key, count: matches.length }
      );
    }

    const row = matches[0];
    if (String(row.checkoutSessionId) !== owner) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Facility hold owner mismatch',
        { reservationId: String(row._id) }
      );
    }
    const exp = toInstant(row.holdExpiresAt);
    if (!exp || exp.getTime() <= now.getTime()) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Facility hold is expired',
        { reservationId: String(row._id) }
      );
    }
    if (exp.getTime() < bundleValidUntil.getTime()) {
      throw new FacilityBookingError(
        'FACILITY_HOLD_VERIFICATION_FAILED',
        'Facility hold expires before bundleValidUntil',
        { reservationId: String(row._id), holdExpiresAt: exp, bundleValidUntil }
      );
    }

    const marker = markerString(row);
    if (marker && marker !== attemptId) {
      const ref = await AttemptModel.findOne({ attemptId: marker }).lean();
      if (!ref) {
        throw new FacilityBookingError(
          'FACILITY_ATTEMPT_MARKER_INTEGRITY',
          'Hold marker references missing attempt',
          { reservationId: String(row._id), acquisitionAttemptId: marker }
        );
      }
      if (ref.isLive === true || ref.status === 'open') {
        throw new FacilityBookingError(
          'FACILITY_ACQUISITION_IN_PROGRESS',
          'Hold carries another live attempt marker',
          { reservationId: String(row._id), acquisitionAttemptId: marker }
        );
      }
    }

    matchedIds.add(String(row._id));
    holds.push(row);
  }

  for (const row of rows) {
    if (!matchedIds.has(String(row._id))) {
      extraHoldIds.push(String(row._id));
    }
  }

  return {
    ok: true,
    holds,
    extraHoldIds
  };
}

/**
 * B8F2A1 phase-fenced facility completion helper (not B8F2A2 resource bundle prep).
 */
async function completeFencedFacilityAcquisition(input = {}, deps = {}) {
  const fenceService =
    deps.fenceService || require('./checkout/checkoutResourceAttemptFenceService');
  const checkoutId = String(input.checkoutId || input.checkoutSessionId || '').trim();
  const attemptId = String(input.attemptId || '').trim();
  const selections = Array.isArray(input.selections) ? input.selections : [];
  const quoteSnapshotHash = input.quoteSnapshotHash;

  const phaseDeps = {
    ...deps,
    checkoutSessionId: checkoutId,
    checkoutId,
    acquisitionAttemptId: attemptId,
    quoteSnapshotHash
  };

  const assertExactFence = async () =>
    fenceService.assertCheckoutResourceAttemptFence(
      { checkoutId, attemptId, quoteSnapshotHash },
      phaseDeps
    );

  const isFenceLostError = (err) =>
    err &&
    (err.code === 'RESOURCE_BUNDLE_FENCE_LOST' ||
      err.name === 'CheckoutResourceAttemptFenceError');

  const wrapFenceLost = (err) => {
    if (err instanceof FacilityBookingError && err.code === 'RESOURCE_BUNDLE_FENCE_LOST') {
      return err;
    }
    return new FacilityBookingError(
      'RESOURCE_BUNDLE_FENCE_LOST',
      err?.message || 'Resource attempt fence is no longer live for this attempt',
      {
        attemptId,
        checkoutId,
        cause: err
      }
    );
  };

  /** Failure after acquire, before marker clearing: compensate then fail fence. */
  const handlePreClearFailure = async (originalErr) => {
    let fence;
    try {
      fence = await assertExactFence();
    } catch (fenceErr) {
      throw wrapFenceLost(fenceErr);
    }

    const durableIds = await listCurrentAttemptMarkedHoldIds(
      checkoutId,
      attemptId,
      phaseDeps
    );
    const compensation = await compensateFacilityHolds(
      checkoutId,
      durableIds,
      phaseDeps
    );
    const remaining = await listCurrentAttemptMarkedHoldIds(
      checkoutId,
      attemptId,
      phaseDeps
    );

    if (remaining.length > 0) {
      await fenceService.annotateCheckoutResourceAttemptFenceFailure(
        {
          checkoutId,
          attemptId,
          failureCode: 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE'
        },
        phaseDeps
      );
      throw new FacilityBookingError(
        'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
        'Facility compensation incomplete after post-acquire failure',
        {
          failureCode: 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
          remainingHoldIds: remaining.map(String),
          attemptId,
          checkoutId,
          bundleValidUntil: fence.bundleValidUntil,
          compensation,
          cause: originalErr
        }
      );
    }

    await fenceService.failCheckoutResourceAttemptFence(
      {
        checkoutId,
        attemptId,
        failureCode:
          (originalErr && originalErr.code) || 'RESOURCE_BUNDLE_VERIFICATION_FAILED'
      },
      phaseDeps
    );

    throw new FacilityBookingError(
      (originalErr && originalErr.code) || 'FACILITY_HOLD_VERIFICATION_FAILED',
      originalErr?.message || 'Fenced facility acquisition failed after acquire',
      {
        attemptId,
        checkoutId,
        bundleValidUntil: fence.bundleValidUntil,
        compensation,
        cause: originalErr
      }
    );
  };

  // 1. Before acquisition
  await assertExactFence();

  let acquired;
  try {
    acquired = await acquireFacilityHolds(
      selections.map((s) => ({ ...s, checkoutSessionId: checkoutId })),
      phaseDeps
    );
  } catch (err) {
    if (isFenceLostError(err)) throw wrapFenceLost(err);
    const remainingHoldIds =
      (err.details &&
        err.details.compensation &&
        err.details.compensation.remainingHoldIds) ||
      [];
    if (remainingHoldIds.length) {
      try {
        await assertExactFence();
        await fenceService.annotateCheckoutResourceAttemptFenceFailure(
          {
            checkoutId,
            attemptId,
            failureCode: 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE'
          },
          phaseDeps
        );
      } catch (fenceErr) {
        throw wrapFenceLost(fenceErr);
      }
      throw new FacilityBookingError(
        'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
        'Facility compensation incomplete after acquisition failure',
        {
          failureCode: 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
          remainingHoldIds,
          attemptId,
          checkoutId,
          cause: err
        }
      );
    }
    // Acquisition compensated fully (or no markers) — fail the fence if still live.
    try {
      await assertExactFence();
      await fenceService.failCheckoutResourceAttemptFence(
        {
          checkoutId,
          attemptId,
          failureCode: (err && err.code) || 'FACILITY_HOLD_ACQUIRE_FAILED'
        },
        phaseDeps
      );
    } catch (fenceErr) {
      if (isFenceLostError(fenceErr)) throw wrapFenceLost(fenceErr);
      throw err;
    }
    throw err;
  }

  // 2. Before verification
  let fence;
  try {
    fence = await assertExactFence();
    const assertActive =
      typeof deps.assertFacilityHoldsActiveFn === 'function'
        ? deps.assertFacilityHoldsActiveFn
        : assertFacilityHoldsActive;
    await assertActive(
      {
        checkoutSessionId: checkoutId,
        selections,
        bundleValidUntil: fence.bundleValidUntil,
        attemptId,
        now: phaseDeps.now
      },
      phaseDeps
    );
  } catch (err) {
    if (isFenceLostError(err)) throw wrapFenceLost(err);
    await handlePreClearFailure(err);
  }

  // 3. Before marker clearing
  try {
    fence = await assertExactFence();
  } catch (err) {
    if (isFenceLostError(err)) throw wrapFenceLost(err);
    await handlePreClearFailure(err);
  }

  const clearFn =
    typeof deps.clearFacilityAcquisitionMarkersFn === 'function'
      ? deps.clearFacilityAcquisitionMarkersFn
      : clearFacilityAcquisitionMarkers;

  let cleared;
  try {
    cleared = await clearFn(
      { checkoutSessionId: checkoutId, attemptId },
      phaseDeps
    );
  } catch (err) {
    // Treat thrown clear failures like partial clear: annotate, keep fence open.
    const remaining = await listCurrentAttemptMarkedHoldIds(
      checkoutId,
      attemptId,
      phaseDeps
    );
    try {
      await assertExactFence();
      await fenceService.annotateCheckoutResourceAttemptFenceFailure(
        {
          checkoutId,
          attemptId,
          failureCode: 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
        },
        phaseDeps
      );
    } catch (fenceErr) {
      throw wrapFenceLost(fenceErr);
    }
    throw new FacilityBookingError(
      'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
      'Facility marker clearing incomplete',
      {
        failureCode: 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
        remainingHoldIds: remaining.map(String),
        attemptId,
        checkoutId,
        bundleValidUntil: fence.bundleValidUntil,
        cause: err
      }
    );
  }

  if (!cleared || !cleared.ok) {
    const remainingHoldIds =
      (cleared && cleared.remainingHoldIds) ||
      (await listCurrentAttemptMarkedHoldIds(checkoutId, attemptId, phaseDeps)).map(
        String
      );
    try {
      await assertExactFence();
      await fenceService.annotateCheckoutResourceAttemptFenceFailure(
        {
          checkoutId,
          attemptId,
          failureCode: 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
        },
        phaseDeps
      );
    } catch (fenceErr) {
      throw wrapFenceLost(fenceErr);
    }
    throw new FacilityBookingError(
      'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
      'Facility marker clearing incomplete',
      {
        failureCode: 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
        remainingHoldIds: remainingHoldIds.map(String),
        attemptId,
        checkoutId,
        bundleValidUntil: fence.bundleValidUntil
      }
    );
  }

  // 4. After marker clearing
  await assertNoFacilityAcquisitionMarkers(
    { checkoutSessionId: checkoutId, attemptId },
    phaseDeps
  );
  await assertExactFence();

  // 5. Immediately before release
  await assertExactFence();

  await fenceService.releaseCheckoutResourceAttemptFence(
    { checkoutId, attemptId },
    phaseDeps
  );

  return {
    ok: true,
    attemptId,
    checkoutId,
    bundleValidUntil: fence.bundleValidUntil,
    holds: acquired.holds,
    outcomes: acquired.outcomes,
    newlyAcquiredIds: acquired.newlyAcquiredIds,
    compensableHoldIds: acquired.compensableHoldIds
  };
}

module.exports = {
  FacilityBookingError,
  DEFAULT_FACILITY_HOLD_TTL_MS,
  roundEuro,
  freezeDeep,
  halfOpenOverlaps,
  validateAndNormalizeBookableAddOn,
  validateAndNormalizeFacility,
  reservationBlocksAvailability,
  slotFitsOperatingSchedule,
  findContainingAbsoluteWindow,
  assertExactConfiguredSlotGrid,
  slotHitsUnavailablePeriod,
  countOverlappingBlockingReservations,
  assertSlotAvailable,
  resolveRequiredAddOn,
  calculateFacilityAddOnTotal,
  buildFacilitySelectionSnapshot,
  validateFacilitySelection,
  applyFacilitySelectionsToQuote,
  ensureFacilityReservationUniqueIndexForTests,
  acquireFacilityHold,
  acquireFacilityHolds,
  compensateFacilityHolds,
  releaseFacilityHolds,
  expireFacilityHolds,
  confirmFacilityHolds,
  confirmExactFacilityHoldsForPaidCheckout,
  assertQuoteLeaseFacilityConsistency,
  facilityCommercialIdentityKeyFromSelection,
  facilityCommercialIdentityKeyFromReservation,
  clearFacilityAcquisitionMarkers,
  assertNoFacilityAcquisitionMarkers,
  assertFacilityHoldsActive,
  completeFencedFacilityAcquisition,
  listCurrentAttemptMarkedHoldIds,
  unmarkedMarkerFilter,
  isDuplicateKeyError,
  isActiveHold
};
