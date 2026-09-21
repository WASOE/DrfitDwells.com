'use strict';

/**
 * B8F1B — checkout-night claim visibility for availability / capacity / OPS.
 *
 * Inventory authority is the claim row (UnitNightClaim / CabinNightClaim).
 * AccommodationCheckoutLease is never joined for visibility decisions.
 *
 * Coarse Mongo query selects ownerType+resource+night overlap only; classification
 * (active / expired / malformed) happens in JavaScript so malformed rows cannot
 * disappear through an active-only filter.
 *
 * Concurrency note: claim collections and AvailabilityBlock are separate.
 * Pre-write visibility checks are best-effort; claim unique indexes prevent
 * claim-versus-claim overlap only. B8F1B does not provide authoritative
 * claim-versus-AvailabilityBlock mutual exclusion (TOCTOU remains).
 */

const UnitNightClaim = require('../../models/UnitNightClaim');
const CabinNightClaim = require('../../models/CabinNightClaim');
const { normalizeExclusiveDateRange, formatSofiaDateOnly } = require('../../utils/dateTime');

const CLASSIFICATION = Object.freeze({
  ACTIVE: 'active_checkout_claim',
  EXPIRED: 'expired_checkout_claim',
  MALFORMED: 'malformed_checkout_claim',
  NOT_CHECKOUT: 'not_checkout_claim',
  BOOKING_OWNED: 'booking_owned_claim'
});

function isNonEmptyString(value) {
  return value != null && String(value).trim() !== '';
}

function isValidExpiresAt(value) {
  if (value == null) return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return !Number.isNaN(d.getTime());
  }
  return false;
}

function normalizeStayBounds(startDate, endDate) {
  return normalizeExclusiveDateRange(startDate, endDate);
}

function resolveNow(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  if (now != null) {
    const d = new Date(now);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function asIdList(single, plural) {
  const out = [];
  if (single != null && single !== '') out.push(single);
  if (Array.isArray(plural)) {
    for (const id of plural) {
      if (id != null && id !== '') out.push(id);
    }
  }
  return [...new Set(out.map((id) => String(id)))];
}

function exclusionPair(excludeCheckoutId, excludeLeaseId) {
  const checkoutId = isNonEmptyString(excludeCheckoutId) ? String(excludeCheckoutId).trim() : '';
  const leaseId = isNonEmptyString(excludeLeaseId) ? String(excludeLeaseId).trim() : '';
  if (!checkoutId || !leaseId) return null;
  return { checkoutId, leaseId };
}

function exclusionBookingId(excludeBookingId) {
  if (excludeBookingId == null || excludeBookingId === '') return null;
  return String(excludeBookingId);
}

/**
 * @param {object|null} row
 * @param {{ now?: Date, excludeCheckoutId?: string|null, excludeLeaseId?: string|null, resourceField?: 'unitId'|'cabinId' }} [opts]
 */
function classifyCheckoutClaimVisibility(row, opts = {}) {
  const now = resolveNow(opts.now);
  const resourceField =
    opts.resourceField ||
    (row && row.unitId != null ? 'unitId' : row && row.cabinId != null ? 'cabinId' : null);

  const base = {
    classification: CLASSIFICATION.NOT_CHECKOUT,
    blocking: false,
    integrity: false,
    excluded: false,
    resourceField,
    resourceId: resourceField && row && row[resourceField] != null ? String(row[resourceField]) : null,
    night: row && row.night != null ? formatSofiaDateOnly(row.night) : null,
    checkoutId: null,
    leaseId: null,
    expiresAt: null,
    claimId: row && row._id != null ? String(row._id) : null
  };

  if (!row || row.ownerType !== 'checkout') {
    return base;
  }

  const checkoutRaw = row.checkoutId;
  const leaseRaw = row.leaseId;
  const checkoutId = checkoutRaw != null ? String(checkoutRaw).trim() : '';
  const leaseId = leaseRaw != null ? String(leaseRaw).trim() : '';
  base.checkoutId = isNonEmptyString(checkoutRaw) ? checkoutId : checkoutRaw == null ? null : '';
  base.leaseId = isNonEmptyString(leaseRaw) ? leaseId : leaseRaw == null ? null : '';

  const expiresValid = isValidExpiresAt(row.expiresAt);
  if (expiresValid) {
    base.expiresAt = new Date(row.expiresAt).toISOString();
  } else if (row.expiresAt != null) {
    base.expiresAt = row.expiresAt instanceof Date ? null : String(row.expiresAt);
  }

  if (!isNonEmptyString(checkoutRaw) || !isNonEmptyString(leaseRaw) || !expiresValid) {
    return {
      ...base,
      classification: CLASSIFICATION.MALFORMED,
      blocking: true,
      integrity: true,
      excluded: false
    };
  }

  const expiresMs = new Date(row.expiresAt).getTime();
  if (expiresMs <= now.getTime()) {
    return {
      ...base,
      classification: CLASSIFICATION.EXPIRED,
      blocking: false,
      integrity: false,
      excluded: false
    };
  }

  const pair = exclusionPair(opts.excludeCheckoutId, opts.excludeLeaseId);
  const excluded = Boolean(pair && pair.checkoutId === checkoutId && pair.leaseId === leaseId);

  return {
    ...base,
    classification: CLASSIFICATION.ACTIVE,
    blocking: !excluded,
    integrity: false,
    excluded
  };
}

function buildCoarseFilter(resourceField, resourceIds, startDate, endDate) {
  const ids = resourceIds.map((id) => id);
  const resourceClause =
    ids.length === 1 ? { [resourceField]: ids[0] } : { [resourceField]: { $in: ids } };
  return {
    ownerType: 'checkout',
    ...resourceClause,
    night: { $gte: startDate, $lt: endDate }
  };
}

async function findCoarseCheckoutClaims(ClaimModel, resourceField, resourceIds, startDate, endDate) {
  if (!resourceIds.length) return [];
  return ClaimModel.find(buildCoarseFilter(resourceField, resourceIds, startDate, endDate)).lean();
}

function toBlockingResults(rows, resourceField, opts) {
  const blocking = [];
  for (const row of rows) {
    const classified = classifyCheckoutClaimVisibility(row, { ...opts, resourceField });
    if (classified.blocking) blocking.push(classified);
  }
  return blocking;
}

/**
 * Blocking Unit checkout claims (active or malformed). Expired omitted.
 */
async function listBlockingUnitCheckoutClaims({
  unitId = null,
  unitIds = null,
  startDate,
  endDate,
  now = null,
  excludeCheckoutId = null,
  excludeLeaseId = null
} = {}) {
  const ids = asIdList(unitId, unitIds);
  const bounds = normalizeStayBounds(startDate, endDate);
  const rows = await findCoarseCheckoutClaims(
    UnitNightClaim,
    'unitId',
    ids,
    bounds.startDate,
    bounds.endDate
  );
  return toBlockingResults(rows, 'unitId', { now, excludeCheckoutId, excludeLeaseId });
}

/**
 * Blocking Cabin checkout claims (active or malformed). Expired omitted.
 */
async function listBlockingCabinCheckoutClaims({
  cabinId = null,
  cabinIds = null,
  startDate,
  endDate,
  now = null,
  excludeCheckoutId = null,
  excludeLeaseId = null
} = {}) {
  const ids = asIdList(cabinId, cabinIds);
  const bounds = normalizeStayBounds(startDate, endDate);
  const rows = await findCoarseCheckoutClaims(
    CabinNightClaim,
    'cabinId',
    ids,
    bounds.startDate,
    bounds.endDate
  );
  return toBlockingResults(rows, 'cabinId', { now, excludeCheckoutId, excludeLeaseId });
}

function toConflictDto(classified) {
  return {
    kind:
      classified.classification === CLASSIFICATION.MALFORMED
        ? 'malformed_checkout_claim'
        : 'checkout_night_claim',
    unitId: classified.resourceField === 'unitId' ? classified.resourceId : null,
    cabinId: classified.resourceField === 'cabinId' ? classified.resourceId : null,
    night: classified.night,
    checkoutId: classified.checkoutId,
    leaseId: classified.leaseId,
    expiresAt: classified.expiresAt,
    integrity: classified.integrity === true,
    claimId: classified.claimId
  };
}

/**
 * Hard-conflict DTOs for OPS conflict assembly.
 */
async function listBlockingCheckoutClaimConflicts({
  unitIds = [],
  cabinIds = [],
  startDate,
  endDate,
  now = null,
  excludeCheckoutId = null,
  excludeLeaseId = null
} = {}) {
  const opts = { now, excludeCheckoutId, excludeLeaseId, startDate, endDate };
  const [unitBlocking, cabinBlocking] = await Promise.all([
    listBlockingUnitCheckoutClaims({ unitIds, ...opts }),
    listBlockingCabinCheckoutClaims({ cabinIds, ...opts })
  ]);
  return [...unitBlocking, ...cabinBlocking].map(toConflictDto);
}

/**
 * Classify a booking-owned night claim for guest-capacity blocking.
 * Self-exclusion: excludeBookingId skips the same Booking's own claims.
 */
function classifyBookingOwnedClaimVisibility(row, opts = {}) {
  const resourceField =
    opts.resourceField ||
    (row && row.unitId != null ? 'unitId' : row && row.cabinId != null ? 'cabinId' : null);
  const base = {
    classification: CLASSIFICATION.BOOKING_OWNED,
    blocking: false,
    integrity: false,
    excluded: false,
    resourceField,
    resourceId: resourceField && row && row[resourceField] != null ? String(row[resourceField]) : null,
    night: row && row.night != null ? formatSofiaDateOnly(row.night) : null,
    bookingId: row && row.bookingId != null ? String(row.bookingId) : null,
    claimId: row && row._id != null ? String(row._id) : null,
    checkoutId: null,
    leaseId: null,
    expiresAt: null
  };
  if (!row || row.ownerType === 'checkout') {
    return { ...base, classification: CLASSIFICATION.NOT_CHECKOUT, bookingId: null };
  }
  if (row.bookingId == null) {
    return { ...base, blocking: true, integrity: true };
  }
  const excludedId = exclusionBookingId(opts.excludeBookingId);
  const excluded = Boolean(excludedId && excludedId === String(row.bookingId));
  return {
    ...base,
    blocking: !excluded,
    excluded
  };
}

function buildCoarseBookingOwnedFilter(resourceField, resourceIds, startDate, endDate) {
  const ids = resourceIds.map((id) => id);
  const resourceClause =
    ids.length === 1 ? { [resourceField]: ids[0] } : { [resourceField]: { $in: ids } };
  return {
    ownerType: { $ne: 'checkout' },
    bookingId: { $ne: null },
    ...resourceClause,
    night: { $gte: startDate, $lt: endDate }
  };
}

async function findCoarseBookingOwnedClaims(
  ClaimModel,
  resourceField,
  resourceIds,
  startDate,
  endDate
) {
  if (!resourceIds.length) return [];
  return ClaimModel.find(
    buildCoarseBookingOwnedFilter(resourceField, resourceIds, startDate, endDate)
  ).lean();
}

function toBlockingBookingResults(rows, resourceField, opts) {
  const blocking = [];
  for (const row of rows) {
    const classified = classifyBookingOwnedClaimVisibility(row, { ...opts, resourceField });
    if (classified.blocking) blocking.push(classified);
  }
  return blocking;
}

/**
 * Blocking booking-owned Unit night claims (guest capacity authority).
 * Not a checkout-lease conflict list.
 */
async function listBlockingUnitBookingOwnedClaims({
  unitId = null,
  unitIds = null,
  startDate,
  endDate,
  excludeBookingId = null
} = {}) {
  const ids = asIdList(unitId, unitIds);
  const bounds = normalizeStayBounds(startDate, endDate);
  const rows = await findCoarseBookingOwnedClaims(
    UnitNightClaim,
    'unitId',
    ids,
    bounds.startDate,
    bounds.endDate
  );
  return toBlockingBookingResults(rows, 'unitId', { excludeBookingId });
}

/**
 * Blocking booking-owned Cabin night claims (guest capacity authority).
 */
async function listBlockingCabinBookingOwnedClaims({
  cabinId = null,
  cabinIds = null,
  startDate,
  endDate,
  excludeBookingId = null
} = {}) {
  const ids = asIdList(cabinId, cabinIds);
  const bounds = normalizeStayBounds(startDate, endDate);
  const rows = await findCoarseBookingOwnedClaims(
    CabinNightClaim,
    'cabinId',
    ids,
    bounds.startDate,
    bounds.endDate
  );
  return toBlockingBookingResults(rows, 'cabinId', { excludeBookingId });
}

module.exports = {
  CLASSIFICATION,
  classifyCheckoutClaimVisibility,
  classifyBookingOwnedClaimVisibility,
  listBlockingUnitCheckoutClaims,
  listBlockingCabinCheckoutClaims,
  listBlockingUnitBookingOwnedClaims,
  listBlockingCabinBookingOwnedClaims,
  listBlockingCheckoutClaimConflicts,
  normalizeStayBounds
};
