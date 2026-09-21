/**
 * B8F1A — Authoritative accommodation checkout leases via night claims.
 * B8F4A — Irreversible claim promotion and lease-header tombstone under durable paid authority.
 *
 * Exclusivity: UnitNightClaim / CabinNightClaim unique {resource, night}.
 * AccommodationCheckoutLease: same-checkout acquisition fencing only.
 *
 * Inert: no PaymentIntent, routes, Booking finalization, facility or voucher wiring.
 */
'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const AccommodationCheckoutLease = require('../../models/AccommodationCheckoutLease');
const AvailabilityBlock = require('../../models/AvailabilityBlock');
const Booking = require('../../models/Booking');
const Cabin = require('../../models/Cabin');
const Unit = require('../../models/Unit');
const CabinType = require('../../models/CabinType');
const {
  isInventoryResourceReadyForArrival,
  evaluateNormalStayExclusivity,
  assertPackageOwnsExclusiveInventory,
  normalizeExclusivePackagePlans,
  RatePlanAvailabilityError,
  defaultLoadExclusiveFixedPackages
} = require('../ratePlanAvailabilityService');
const CheckoutSession = require('../../models/CheckoutSession');
const UnitNightClaim = require('../../models/UnitNightClaim');
const CabinNightClaim = require('../../models/CabinNightClaim');
const {
  acquireUnitCheckoutNights,
  compensateUnitCheckoutAcquisition,
  clearUnitCheckoutAcquisitionMarkers,
  clearUnitSealedLeaseLeftoverMarkers,
  verifyUnitCheckoutLeaseNights,
  releaseUnitCheckoutLeaseClaims,
  expireUnitCheckoutClaims,
  countUnitAcquisitionClaims,
  assertAuthoritativeUnitNightIndex,
  resolveOccupiedNightDates: resolveUnitNightDates,
  promoteUnitCheckoutClaimsToBooking,
  preflightUnitCheckoutClaimsForPromotion,
  PROMOTION_ERR: UNIT_PROMOTION_ERR,
  CHECKOUT_CLAIM_ERR: UNIT_CHECKOUT_ERR
} = require('../inventory/unitNightClaimService');
const {
  acquireCabinCheckoutNights,
  compensateCabinCheckoutAcquisition,
  clearCabinCheckoutAcquisitionMarkers,
  clearCabinSealedLeaseLeftoverMarkers,
  verifyCabinCheckoutLeaseNights,
  releaseCabinCheckoutLeaseClaims,
  expireCabinCheckoutClaims,
  countCabinAcquisitionClaims,
  assertAuthoritativeCabinNightIndex,
  resolveOccupiedNightDates: resolveCabinNightDates,
  promoteCabinCheckoutClaimsToBooking,
  preflightCabinCheckoutClaimsForPromotion,
  PROMOTION_ERR: CABIN_PROMOTION_ERR,
  CHECKOUT_CLAIM_ERR: CABIN_CHECKOUT_ERR
} = require('../inventory/cabinNightClaimService');
const { formatSofiaDateOnly, normalizeDateToSofiaDayStart } = require('../../utils/dateTime');
const { BLOCKING_BOOKING_STATUSES } = require('../calendar/blockingStatusConstants');
const { availabilityBlockUnitScopeClause } = require('../calendar/unitCalendarShared');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const {
  findEmbeddedOperation,
  assertTokenlessDualUnmarked,
  hasAcquisitionMarker
} = require('../giftVouchers/giftVoucherLedgerService');

const CHECKOUT_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;
const DEFAULT_ACCOMMODATION_HOLD_TTL_MS = 30 * 60 * 1000;
/** Max released headers processed per expireAccommodationCheckoutHolds recovery pass. */
const RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT = 100;
/** B8F5A — base backoff after a failed cleanup attempt (ms). */
const RELEASED_CLEANUP_RETRY_BASE_MS = 30 * 1000;
/** B8F5A — maximum backoff between cleanup attempts (ms). */
const RELEASED_CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;
/** Cap doubling exponent so integer delay stays bounded. */
const RELEASED_CLEANUP_RETRY_MAX_EXPONENT = 16;
const BOOKING_CONTEXTS = new Set(['normal', 'seasonal', 'fixed_package']);
const HARD_BLOCK_TYPES = ['external_hold', 'manual_block', 'maintenance', 'reservation'];

/**
 * B8F5A Correction 1 — module-private cleanup authority.
 * Exact Symbol identity only; never exported; not forgeable by value/description.
 */
const PRIVATE_RELEASED_CLEANUP_AUTHORITY = Symbol(
  'B8F5A_PRIVATE_RELEASED_CLEANUP_AUTHORITY'
);

/** Forbidden on public deps — non-null/non-undefined values are rejected. */
const FORBIDDEN_CLEANUP_AUTHORITY_DEP_KEYS = Object.freeze([
  'skipCleanupAttemptReservation',
  'ignoreCleanupNextAttemptAt',
  'cleanupAttemptAuthority',
  'cleanupReservationAuthority',
  'headerCleanupAuthority',
  'releasedHeaderCleanupAuthority'
]);

/**
 * Explicit allowlist of dependencies safe to pass into cleanup internals.
 * Model/now/test-hook injection only — no cleanup-authority controls.
 */
const SAFE_CLEANUP_DEP_KEYS = Object.freeze([
  'now',
  'AccommodationCheckoutLease',
  'Unit',
  'Cabin',
  'CabinType',
  'Booking',
  'AvailabilityBlock',
  'CheckoutSession',
  'GiftVoucher',
  'GiftVoucherRedemption',
  'onAfterHeaderReleasedBeforeClaimDelete',
  'onAfterCleanupAttemptReserved'
]);

class AccommodationCheckoutHoldError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AccommodationCheckoutHoldError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Reject caller-supplied cleanup-authority controls on exported entry points.
 * null/undefined values are ignored; every other value (incl. false) is rejected.
 */
function assertNoCallerCleanupAuthorityControls(deps) {
  if (deps == null) return;
  if (typeof deps !== 'object' || Array.isArray(deps)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_INJECTION',
      'Cleanup dependency bag must be a plain object'
    );
  }
  for (const key of FORBIDDEN_CLEANUP_AUTHORITY_DEP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(deps, key)) continue;
    const value = deps[key];
    if (value === undefined || value === null) continue;
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_INJECTION',
      'Caller cleanup-authority controls are not accepted',
      { key, valueType: typeof value }
    );
  }
}

function pickSafeCleanupDeps(deps = {}) {
  assertNoCallerCleanupAuthorityControls(deps);
  const out = {};
  for (const key of SAFE_CLEANUP_DEP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(deps, key) && deps[key] !== undefined) {
      out[key] = deps[key];
    }
  }
  return out;
}

function privateReleasedCleanupArgs(deps = {}, extras = {}) {
  return {
    deps: pickSafeCleanupDeps(deps),
    cleanupAuthority: PRIVATE_RELEASED_CLEANUP_AUTHORITY,
    ...extras
  };
}

function hasPrivateReleasedCleanupAuthority(cleanupArgs) {
  return (
    cleanupArgs != null &&
    cleanupArgs.cleanupAuthority === PRIVATE_RELEASED_CLEANUP_AUTHORITY
  );
}

/**
 * Normalize observed attempt counter before reservation.
 * missing/null/negative/non-numeric/non-finite → 0 (first reserved value = 1).
 * Positive decimals are floored (2.9 → 2, next reserved = 3).
 * Valid integers retain history (2 → next 3).
 */
function normalizePriorCleanupAttemptCount(raw) {
  if (raw === undefined || raw === null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** Exact-match CAS clause for the observed raw counter (concurrency-safe). */
function attemptCountExactMatchClause(raw) {
  if (raw === undefined || raw === null) {
    return {
      $or: [
        { checkoutClaimCleanupAttemptCount: { $exists: false } },
        { checkoutClaimCleanupAttemptCount: null }
      ]
    };
  }
  return { checkoutClaimCleanupAttemptCount: raw };
}

function newStrongId(prefix) {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function getNow(deps = {}) {
  if (deps.now != null) {
    const d = deps.now instanceof Date ? deps.now : new Date(deps.now);
    if (Number.isNaN(d.getTime())) {
      throw new AccommodationCheckoutHoldError('INVALID_RESOURCE_LEASE', 'Injected now is invalid');
    }
    return d;
  }
  return new Date();
}

function getLeaseModel(deps = {}) {
  return deps.AccommodationCheckoutLease || AccommodationCheckoutLease;
}

function getUnitModel(deps = {}) {
  return deps.Unit || Unit;
}

function getCabinModel(deps = {}) {
  return deps.Cabin || Cabin;
}

function getCabinTypeModel(deps = {}) {
  return deps.CabinType || CabinType;
}

function getBookingModel(deps = {}) {
  return deps.Booking || Booking;
}

function getAvailabilityBlockModel(deps = {}) {
  return deps.AvailabilityBlock || AvailabilityBlock;
}

function assertValidCheckoutId(checkoutId) {
  if (checkoutId == null || typeof checkoutId !== 'string') {
    throw new AccommodationCheckoutHoldError(
      'INVALID_CHECKOUT_ID',
      'checkoutId must be the public CheckoutSession.checkoutId string'
    );
  }
  const id = checkoutId.trim();
  if (!id || !CHECKOUT_ID_PATTERN.test(id)) {
    throw new AccommodationCheckoutHoldError('INVALID_CHECKOUT_ID', 'checkoutId format is invalid');
  }
  return id;
}

function assertBookingContext(bookingContext) {
  const ctx = bookingContext != null ? String(bookingContext).trim() : '';
  if (!BOOKING_CONTEXTS.has(ctx)) {
    throw new AccommodationCheckoutHoldError(
      'UNSUPPORTED_BOOKING_CONTEXT',
      'bookingContext must be normal, seasonal, or fixed_package'
    );
  }
  return ctx;
}

function isSalesReady(resource) {
  if (!resource || typeof resource !== 'object') return false;
  if (resource.isActive === false) return false;
  if (resource.archivedAt) return false;
  const status = resource.salesStatus == null ? 'ready' : String(resource.salesStatus);
  return status === 'ready';
}

function resolveLeaseExpiresAt(input, deps) {
  const now = getNow(deps);
  const ttl =
    input.ttlMs != null && Number.isFinite(Number(input.ttlMs))
      ? Math.max(1, Number(input.ttlMs))
      : DEFAULT_ACCOMMODATION_HOLD_TTL_MS;
  const expiresAt =
    input.expiresAt != null ? new Date(input.expiresAt) : new Date(now.getTime() + ttl);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new AccommodationCheckoutHoldError(
      'INVALID_RESOURCE_LEASE',
      'Lease expiry must be in the future'
    );
  }
  return { now, expiresAt };
}

function resolveStayDateOnlys(checkIn, checkOut) {
  const checkInDateOnly =
    typeof checkIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(checkIn.trim())
      ? checkIn.trim()
      : formatSofiaDateOnly(normalizeDateToSofiaDayStart(checkIn));
  const checkOutDateOnly =
    typeof checkOut === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(checkOut.trim())
      ? checkOut.trim()
      : formatSofiaDateOnly(normalizeDateToSofiaDayStart(checkOut));
  const startDate = normalizeDateToSofiaDayStart(`${checkInDateOnly}T12:00:00.000Z`);
  const endDate = normalizeDateToSofiaDayStart(`${checkOutDateOnly}T12:00:00.000Z`);
  if (!(startDate < endDate)) {
    throw new AccommodationCheckoutHoldError(
      'INVALID_STAY_DATES',
      'Stay must include at least one night'
    );
  }
  return { checkIn: checkInDateOnly, checkOut: checkOutDateOnly, startDate, endDate };
}

function isDuplicateKeyError(err) {
  if (!err) return false;
  if (err.code === 11000 || err.code === 11001) return true;
  return /E11000|duplicate key/i.test(String(err.message || ''));
}

const KNOWN_OCCUPANCY_CODES = new Set([
  UNIT_CHECKOUT_ERR.FOREIGN_OWNER,
  CABIN_CHECKOUT_ERR.FOREIGN_OWNER,
  'UNIT_NIGHT_CLAIM_FOREIGN_OWNER',
  'CABIN_NIGHT_CLAIM_FOREIGN_OWNER',
  'ACCOMMODATION_NIGHT_CONFLICT',
  'NO_ELIGIBLE_ACCOMMODATION'
]);

const AUTHORITY_CODES = new Set([
  UNIT_CHECKOUT_ERR.INDEX_MISSING,
  CABIN_CHECKOUT_ERR.INDEX_MISSING,
  'UNIT_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_WRONG',
  'ACCOMMODATION_CLAIM_AUTHORITY_UNAVAILABLE'
]);

const INTEGRITY_CODES = new Set([
  'CHECKOUT_NIGHT_CLAIM_INTEGRITY',
  UNIT_CHECKOUT_ERR.INTEGRITY,
  CABIN_CHECKOUT_ERR.INTEGRITY,
  UNIT_CHECKOUT_ERR.COMPENSATION_FAILED,
  CABIN_CHECKOUT_ERR.COMPENSATION_FAILED,
  'ACCOMMODATION_LEASE_INTEGRITY',
  'ACCOMMODATION_LEASE_COMPENSATION_FAILED',
  'ACCOMMODATION_LEASE_INTERNAL_ERROR',
  'ACCOMMODATION_LEASE_RELEASE_INCOMPLETE',
  'ACCOMMODATION_LEASE_ACQUISITION_IN_PROGRESS',
  'SAME_OWNER_ACQUISITION_IN_PROGRESS'
]);

const PROMOTION_IDENTITY_CODES = new Set([
  UNIT_PROMOTION_ERR.VALIDATION,
  UNIT_PROMOTION_ERR.IDENTITY,
  UNIT_PROMOTION_ERR.INCOMPLETE,
  CABIN_PROMOTION_ERR.VALIDATION,
  CABIN_PROMOTION_ERR.IDENTITY,
  CABIN_PROMOTION_ERR.INCOMPLETE,
  'ACCOMMODATION_PROMOTION_IDENTITY',
  'ACCOMMODATION_PROMOTION_INCOMPLETE',
  'ACCOMMODATION_TOMBSTONE_IDENTITY',
  'ACCOMMODATION_TOMBSTONE_INCOMPLETE'
]);

const PROMOTION_FOREIGN_CODES = new Set([
  UNIT_PROMOTION_ERR.FOREIGN,
  CABIN_PROMOTION_ERR.FOREIGN,
  'ACCOMMODATION_PROMOTION_FOREIGN'
]);

function mapClaimError(err) {
  if (!err) {
    return new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTERNAL_ERROR',
      'Claim operation failed without an error'
    );
  }
  if (err instanceof AccommodationCheckoutHoldError) return err;
  const code = err.code;
  if (PROMOTION_FOREIGN_CODES.has(code)) {
    return new AccommodationCheckoutHoldError('ACCOMMODATION_PROMOTION_FOREIGN', err.message, err.details);
  }
  if (PROMOTION_IDENTITY_CODES.has(code)) {
    if (String(code).includes('TOMBSTONE')) {
      return new AccommodationCheckoutHoldError(code, err.message, err.details);
    }
    if (String(code).includes('INCOMPLETE')) {
      return new AccommodationCheckoutHoldError('ACCOMMODATION_PROMOTION_INCOMPLETE', err.message, err.details);
    }
    return new AccommodationCheckoutHoldError('ACCOMMODATION_PROMOTION_IDENTITY', err.message, err.details);
  }
  if (KNOWN_OCCUPANCY_CODES.has(code) || code === UNIT_CHECKOUT_ERR.FOREIGN_OWNER || code === CABIN_CHECKOUT_ERR.FOREIGN_OWNER) {
    if (code === 'NO_ELIGIBLE_ACCOMMODATION' || code === 'ACCOMMODATION_NIGHT_CONFLICT') {
      return err instanceof AccommodationCheckoutHoldError
        ? err
        : new AccommodationCheckoutHoldError(code, err.message, err.details);
    }
    return new AccommodationCheckoutHoldError('ACCOMMODATION_NIGHT_CONFLICT', err.message, err.details);
  }
  if (AUTHORITY_CODES.has(code)) {
    return new AccommodationCheckoutHoldError(
      'ACCOMMODATION_CLAIM_AUTHORITY_UNAVAILABLE',
      err.message,
      err.details
    );
  }
  if (INTEGRITY_CODES.has(code) || code === 'CHECKOUT_NIGHT_CLAIM_INTEGRITY') {
    return new AccommodationCheckoutHoldError(
      code === UNIT_CHECKOUT_ERR.COMPENSATION_FAILED || code === CABIN_CHECKOUT_ERR.COMPENSATION_FAILED
        ? 'ACCOMMODATION_LEASE_COMPENSATION_FAILED'
        : code === 'CHECKOUT_NIGHT_CLAIM_INTEGRITY'
          ? 'CHECKOUT_NIGHT_CLAIM_INTEGRITY'
          : 'ACCOMMODATION_LEASE_INTEGRITY',
      err.message,
      err.details
    );
  }
  return new AccommodationCheckoutHoldError(
    'ACCOMMODATION_LEASE_INTERNAL_ERROR',
    err.message || 'Unexpected accommodation lease failure',
    { cause: err?.message || String(err), originalCode: code || null, details: err.details || null }
  );
}

function isOccupancyOrReadinessFailure(err) {
  if (!err) return false;
  if (err instanceof RatePlanAvailabilityError) return true;
  const mapped = err instanceof AccommodationCheckoutHoldError ? err : mapClaimError(err);
  return (
    mapped.code === 'ACCOMMODATION_NIGHT_CONFLICT' ||
    mapped.code === 'NO_ELIGIBLE_ACCOMMODATION'
  );
}

function toLeaseResult(header, { checkoutId, outcome, claims = [] }) {
  return {
    checkoutId: String(checkoutId),
    leaseId: String(header.leaseId),
    holdId: String(header.leaseId),
    generation: Number(header.generation),
    status: header.status,
    cabinId: header.cabinId != null ? String(header.cabinId) : null,
    unitId: header.unitId != null ? String(header.unitId) : null,
    entityType: header.entityType,
    checkIn: String(header.checkIn),
    checkOut: String(header.checkOut),
    expectedNightCount: Number(header.expectedNightCount),
    expiresAt: header.expiresAt ? new Date(header.expiresAt).toISOString() : null,
    outcome,
    claimIds: claims.map((c) => c.id || c._id).filter(Boolean).map(String)
  };
}

async function findLiveLease(checkoutId, deps = {}) {
  const Model = getLeaseModel(deps);
  return Model.findOne({ checkoutId: String(checkoutId), isLive: true }).lean();
}

async function findParentCabinForCabinTypeLocal(cabinTypeId, deps = {}) {
  if (typeof deps.findParentCabinForCabinType === 'function') {
    return deps.findParentCabinForCabinType(cabinTypeId);
  }
  const CabinModel = getCabinModel(deps);
  return CabinModel.findOne({
    isActive: true,
    $or: [{ cabinTypeId }, { cabinTypeRef: cabinTypeId }]
  })
    .select('_id')
    .lean();
}

async function assertFixedPackageMayUseInventory(input, accommodationKey, checkIn, checkOut, deps) {
  const ratePlan = input.ratePlan;
  if (!ratePlan) {
    throw new AccommodationCheckoutHoldError(
      'NO_ELIGIBLE_ACCOMMODATION',
      'fixed_package requires ratePlan'
    );
  }
  const load = deps.loadExclusiveFixedPackages || defaultLoadExclusiveFixedPackages;
  let raw;
  try {
    raw = await load();
  } catch (err) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTERNAL_ERROR',
      'Unable to load exclusive rate plans for package hold',
      { cause: err?.message || String(err) }
    );
  }
  let plans;
  try {
    plans = normalizeExclusivePackagePlans(raw);
  } catch (err) {
    if (err instanceof RatePlanAvailabilityError) {
      throw new AccommodationCheckoutHoldError(err.code, err.message, err.details);
    }
    throw mapClaimError(err);
  }
  const resolved = {
    code: String(ratePlan.code || '').trim(),
    version: Number(ratePlan.version),
    packageArrivalDate: formatSofiaDateOnly(checkIn),
    packageDepartureDate: formatSofiaDateOnly(checkOut),
    type: 'fixed_package',
    inventoryMode: 'exclusive'
  };
  try {
    assertPackageOwnsExclusiveInventory(resolved, plans, accommodationKey);
  } catch (err) {
    if (err instanceof RatePlanAvailabilityError) {
      throw new AccommodationCheckoutHoldError('NO_ELIGIBLE_ACCOMMODATION', err.message, err.details);
    }
    throw mapClaimError(err);
  }
}

async function resolveUnitCandidates(input, startDate, deps) {
  const CabinTypeModel = getCabinTypeModel(deps);
  const UnitModel = getUnitModel(deps);
  const cabinTypeId = input.cabinTypeId || input.accommodationId;
  if (!cabinTypeId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_NOT_FOUND',
      'cabinTypeId is required for multi-unit accommodation holds'
    );
  }
  if (input.unitId || input.assignedUnitId || input.clientUnitId || input.selectedUnitId) {
    throw new AccommodationCheckoutHoldError(
      'UNSUPPORTED_BOOKING_CONTEXT',
      'Client-selected physical units are not accepted'
    );
  }

  const cabinType = await CabinTypeModel.findById(cabinTypeId).lean();
  if (!cabinType) {
    throw new AccommodationCheckoutHoldError('ACCOMMODATION_NOT_FOUND', 'CabinType was not found');
  }
  const accommodationKey =
    (input.accommodationKey && String(input.accommodationKey).trim().toLowerCase()) ||
    (cabinType.slug ? String(cabinType.slug).trim().toLowerCase() : '');

  const parentCabin = await findParentCabinForCabinTypeLocal(cabinType._id, deps);
  if (!parentCabin) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_NOT_FOUND',
      'Parent cabin for cabin type was not found'
    );
  }

  const units = await UnitModel.find({ cabinTypeId: cabinType._id, isActive: true })
    .sort({ unitNumber: 1, _id: 1 })
    .lean();

  const arrival = formatSofiaDateOnly(startDate);
  const eligible = [];
  for (const unit of units) {
    if (!isSalesReady(unit)) continue;
    if (!isInventoryResourceReadyForArrival(unit, arrival)) continue;
    eligible.push({
      kind: 'unit',
      entityType: 'unit',
      cabinId: parentCabin._id,
      unitId: unit._id,
      unit,
      cabinTypeId: cabinType._id,
      accommodationKey
    });
  }
  return { kind: 'unit', accommodationKey, cabinType, parentCabin, eligible };
}

async function resolveCabinCandidate(input, startDate, deps) {
  const CabinModel = getCabinModel(deps);
  const cabinId = input.cabinId || input.accommodationId;
  if (!cabinId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_NOT_FOUND',
      'cabinId is required for single-cabin accommodation holds'
    );
  }
  if (input.unitId || input.assignedUnitId || input.clientUnitId || input.selectedUnitId) {
    throw new AccommodationCheckoutHoldError(
      'UNSUPPORTED_BOOKING_CONTEXT',
      'Client-selected physical units are not accepted'
    );
  }

  const cabin = await CabinModel.findById(cabinId).lean();
  if (!cabin) {
    throw new AccommodationCheckoutHoldError('ACCOMMODATION_NOT_FOUND', 'Cabin was not found');
  }
  if (!isSalesReady(cabin)) {
    throw new AccommodationCheckoutHoldError('NO_ELIGIBLE_ACCOMMODATION', 'Cabin is not sellable');
  }
  const arrival = formatSofiaDateOnly(startDate);
  if (!isInventoryResourceReadyForArrival(cabin, arrival)) {
    throw new AccommodationCheckoutHoldError(
      'NO_ELIGIBLE_ACCOMMODATION',
      'Cabin is not ready for the requested arrival'
    );
  }
  const accommodationKey =
    (input.accommodationKey && String(input.accommodationKey).trim().toLowerCase()) ||
    (cabin.slug ? String(cabin.slug).trim().toLowerCase() : '');

  return {
    kind: 'cabin',
    accommodationKey,
    eligible: [
      {
        kind: 'cabin',
        entityType: 'cabin',
        cabinId: cabin._id,
        unitId: null,
        cabin,
        accommodationKey
      }
    ]
  };
}

async function countHardBlocks(candidate, startDate, endDate, deps) {
  const Block = getAvailabilityBlockModel(deps);
  const filter = {
    status: 'active',
    blockType: { $in: HARD_BLOCK_TYPES },
    startDate: { $lt: endDate },
    endDate: { $gt: startDate },
    cabinId: candidate.cabinId
  };
  if (candidate.kind === 'unit') {
    Object.assign(filter, availabilityBlockUnitScopeClause(candidate.unitId));
  } else {
    filter.$and = [{ $or: [{ unitId: null }, { unitId: { $exists: false } }] }];
  }
  return Block.countDocuments(filter);
}

async function countBlockingBookings(candidate, startDate, endDate, deps) {
  const BookingModel = getBookingModel(deps);
  if (candidate.kind === 'unit') {
    return BookingModel.countDocuments({
      unitId: candidate.unitId,
      status: { $in: BLOCKING_BOOKING_STATUSES },
      checkIn: { $lt: endDate },
      checkOut: { $gt: startDate }
    });
  }
  return BookingModel.countDocuments({
    cabinId: candidate.cabinId,
    unitId: null,
    status: { $in: BLOCKING_BOOKING_STATUSES },
    checkIn: { $lt: endDate },
    checkOut: { $gt: startDate }
  });
}

async function candidateSoftAvailable(candidate, startDate, endDate, bookingContext, deps) {
  if (typeof deps.candidateSoftAvailable === 'function') {
    return deps.candidateSoftAvailable(candidate, startDate, endDate, bookingContext, deps);
  }
  const [bookingCount, blockCount] = await Promise.all([
    countBlockingBookings(candidate, startDate, endDate, deps),
    countHardBlocks(candidate, startDate, endDate, deps)
  ]);
  if (bookingCount > 0 || blockCount > 0) return false;

  if (bookingContext !== 'fixed_package' && candidate.accommodationKey) {
    try {
      await evaluateNormalStayExclusivity({
        accommodationKey: candidate.accommodationKey,
        checkIn: startDate,
        checkOut: endDate,
        loadExclusiveFixedPackages:
          deps.loadExclusiveFixedPackages || defaultLoadExclusiveFixedPackages
      });
    } catch (err) {
      if (err instanceof RatePlanAvailabilityError) {
        return false;
      }
      throw err;
    }
  }
  return true;
}

async function nextGeneration(checkoutId, deps) {
  const Model = getLeaseModel(deps);
  const latest = await Model.findOne({ checkoutId: String(checkoutId) })
    .sort({ generation: -1 })
    .select('generation')
    .lean();
  return latest && latest.generation != null ? Number(latest.generation) + 1 : 1;
}

async function createOpenLeaseHeader({
  checkoutId,
  entityType,
  checkIn,
  checkOut,
  expectedNightCount,
  expiresAt,
  deps
}) {
  const Model = getLeaseModel(deps);
  const generation = await nextGeneration(checkoutId, deps);
  const leaseId = newStrongId('acl');
  try {
    const created = await Model.create({
      leaseId,
      checkoutId,
      generation,
      status: 'open',
      isLive: true,
      entityType,
      unitId: null,
      cabinId: null,
      checkIn,
      checkOut,
      expectedNightCount,
      expiresAt,
      activeAcquisitionId: null,
      acquisitionStartedAt: null
    });
    return created.toObject ? created.toObject() : created;
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTERNAL_ERROR',
        'Unable to create lease header',
        { cause: err?.message || String(err) }
      );
    }
    const winner = await findLiveLease(checkoutId, deps);
    if (!winner) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Lease header create raced without a live winner'
      );
    }
    return winner;
  }
}

async function countCheckoutClaimsForLease(header) {
  const checkoutId = String(header.checkoutId);
  const leaseId = String(header.leaseId);
  if (header.entityType === 'unit') {
    const filter = {
      ownerType: 'checkout',
      checkoutId,
      leaseId
    };
    if (header.unitId != null) {
      filter.unitId = header.unitId;
    }
    return UnitNightClaim.countDocuments(filter);
  }
  const filter = {
    ownerType: 'checkout',
    checkoutId,
    leaseId
  };
  if (header.cabinId != null) {
    filter.cabinId = header.cabinId;
  }
  return CabinNightClaim.countDocuments(filter);
}

function releasedHeaderCleanupPendingFilter() {
  return {
    status: 'released',
    isLive: false,
    $or: [
      { checkoutClaimCleanupStatus: 'pending' },
      { checkoutClaimCleanupStatus: null },
      { checkoutClaimCleanupStatus: { $exists: false } }
    ]
  };
}

/**
 * Eligible-now selector for released-header claim cleanup (B8F5A).
 * Legacy missing nextAttemptAt → immediately eligible.
 * Deferred (nextAttemptAt > now) headers are excluded.
 */
function releasedHeaderCleanupEligibleFilter(now) {
  const dueAt = now instanceof Date ? now : new Date(now);
  return {
    ...releasedHeaderCleanupPendingFilter(),
    $and: [
      {
        $or: [
          { checkoutClaimCleanupNextAttemptAt: null },
          { checkoutClaimCleanupNextAttemptAt: { $exists: false } },
          { checkoutClaimCleanupNextAttemptAt: { $lte: dueAt } }
        ]
      }
    ]
  };
}

/**
 * Retry delay after attemptCount has already been incremented for this attempt.
 * Formula: min(MAX, BASE * 2^min(attemptCount-1, MAX_EXPONENT))
 * attemptCount=1 → 30s; doubles each failure; caps at 1 hour.
 */
function computeReleasedCleanupRetryDelayMs(attemptCountAfterIncrement) {
  const n = Number(attemptCountAfterIncrement);
  const attempts = Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
  const exponent = Math.min(Math.max(0, attempts - 1), RELEASED_CLEANUP_RETRY_MAX_EXPONENT);
  let delay = RELEASED_CLEANUP_RETRY_BASE_MS;
  for (let i = 0; i < exponent; i += 1) {
    if (delay >= RELEASED_CLEANUP_RETRY_MAX_MS) {
      return RELEASED_CLEANUP_RETRY_MAX_MS;
    }
    const next = delay * 2;
    if (next >= RELEASED_CLEANUP_RETRY_MAX_MS) {
      return RELEASED_CLEANUP_RETRY_MAX_MS;
    }
    delay = next;
  }
  return delay;
}

function releaseTransitionSet() {
  return {
    status: 'released',
    isLive: false,
    activeAcquisitionId: null,
    acquisitionStartedAt: null,
    checkoutClaimCleanupStatus: 'pending',
    checkoutClaimCleanupCompletedAt: null,
    checkoutClaimCleanupFailureCode: null,
    checkoutClaimCleanupAttemptCount: 0,
    checkoutClaimCleanupNextAttemptAt: null
  };
}

function safeCleanupFailureCode(err) {
  const code = err && err.code != null ? String(err.code).trim() : '';
  if (!code) return 'ACCOMMODATION_LEASE_CLEANUP_FAILED';
  return code.slice(0, 120);
}

function isCleanupPendingOrLegacy(header) {
  if (!header || header.status !== 'released' || header.isLive !== false) return false;
  const status = header.checkoutClaimCleanupStatus;
  return status == null || status === 'pending';
}

function bindReleasedHeaderIdentityFilter(header) {
  const filter = {
    leaseId: header.leaseId,
    checkoutId: header.checkoutId,
    generation: header.generation,
    status: 'released',
    isLive: false,
    entityType: header.entityType,
    $or: [
      { checkoutClaimCleanupStatus: 'pending' },
      { checkoutClaimCleanupStatus: null },
      { checkoutClaimCleanupStatus: { $exists: false } }
    ]
  };
  if (header.entityType === 'unit') {
    filter.unitId = header.unitId == null ? null : header.unitId;
  } else {
    filter.cabinId = header.cabinId == null ? null : header.cabinId;
  }
  return filter;
}

/**
 * Reserve one cleanup attempt before destructive claim deletion (B8F5A / Correction 1).
 * Only the CAS winner may delete claims for this attempt.
 *
 * Semantics on win:
 * - Set checkoutClaimCleanupAttemptCount to normalize(prior)+1 (never unchecked $inc)
 * - set lastAttemptAt = now
 * - set nextAttemptAt = now + backoff(newCount) (defers poison headers even if
 *   later annotation fails)
 * - clear failureCode (fresh attempt; failure path may re-set a typed code)
 *
 * Counter normalization (stored → first reserved value when prior was that stored):
 *   missing/null/negative/non-numeric/non-finite → 1
 *   0 → 1; 2.9 → 3; 2 → 3
 * CAS binds the observed raw counter so concurrent workers cannot double-reserve.
 *
 * @param {object} options.ignoreNextAttemptAt — only with private cleanupAuthority
 *   (same-checkout resume that still reserves is unused; private skip uses finalize).
 */
async function reserveReleasedHeaderCleanupAttempt(header, deps = {}, options = {}) {
  const now = getNow(deps);
  const Model = getLeaseModel(deps);
  const filter = bindReleasedHeaderIdentityFilter(header);

  if (options.ignoreNextAttemptAt === true) {
    if (!hasPrivateReleasedCleanupAuthority(options)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_DENIED',
        'Ignoring cleanup nextAttemptAt requires module-private authority'
      );
    }
  } else {
    filter.$and = [
      {
        $or: [
          { checkoutClaimCleanupNextAttemptAt: null },
          { checkoutClaimCleanupNextAttemptAt: { $exists: false } },
          { checkoutClaimCleanupNextAttemptAt: { $lte: now } }
        ]
      }
    ];
  }

  // Pre-read for normalized delay + exact counter CAS; winners serialize on raw count.
  const current = await Model.findOne({
    leaseId: header.leaseId,
    checkoutId: header.checkoutId,
    generation: header.generation
  }).lean();
  if (!current) {
    return { won: false, header: null, nextAttemptAt: null, attemptCount: null };
  }

  const priorRaw = Object.prototype.hasOwnProperty.call(
    current,
    'checkoutClaimCleanupAttemptCount'
  )
    ? current.checkoutClaimCleanupAttemptCount
    : undefined;

  if (
    priorRaw !== undefined &&
    priorRaw !== null &&
    typeof priorRaw === 'number' &&
    !Number.isFinite(priorRaw)
  ) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_ATTEMPT_COUNT_INVALID',
      'Stored cleanup attempt count is non-finite',
      {
        checkoutId: header.checkoutId,
        leaseId: header.leaseId,
        generation: header.generation
      }
    );
  }

  const priorNormalized = normalizePriorCleanupAttemptCount(priorRaw);
  const nextCount = priorNormalized + 1;
  const delayMs = computeReleasedCleanupRetryDelayMs(nextCount);
  const nextAttemptAt = new Date(now.getTime() + delayMs);

  const countClause = attemptCountExactMatchClause(priorRaw);
  if (countClause.$or) {
    filter.$and = [...(filter.$and || []), { $or: countClause.$or }];
  } else {
    Object.assign(filter, countClause);
  }

  const setFields = {
    checkoutClaimCleanupAttemptCount: nextCount,
    checkoutClaimCleanupLastAttemptAt: now,
    checkoutClaimCleanupNextAttemptAt: nextAttemptAt,
    checkoutClaimCleanupFailureCode: null,
    // Normalize legacy null status to pending on first reserved attempt.
    checkoutClaimCleanupStatus: 'pending'
  };

  // Non-numeric stored counters must bypass Mongoose cast (which would turn
  // filter "nope" into NaN and fail the CAS). Native collection update keeps
  // exact-match concurrency on the observed raw value.
  const priorIsNonNumeric =
    priorRaw !== undefined &&
    priorRaw !== null &&
    typeof priorRaw !== 'number';

  let doc = null;
  if (priorIsNonNumeric) {
    const nativeResult = await Model.collection.findOneAndUpdate(
      filter,
      { $set: setFields },
      { returnDocument: 'after' }
    );
    doc = nativeResult && nativeResult.value !== undefined ? nativeResult.value : nativeResult;
  } else {
    const updated = await Model.findOneAndUpdate(filter, { $set: setFields }, { new: true });
    if (updated) {
      doc = updated.toObject ? updated.toObject() : updated;
    }
  }

  if (!doc) {
    return { won: false, header: null, nextAttemptAt: null, attemptCount: null };
  }
  const storedCount = Number(doc.checkoutClaimCleanupAttemptCount);
  return {
    won: true,
    header: doc,
    nextAttemptAt: doc.checkoutClaimCleanupNextAttemptAt,
    attemptCount: Number.isFinite(storedCount) ? storedCount : nextCount,
    delayMs
  };
}

/**
 * CAS released header cleanup to complete only after exact zero checkout claims.
 */
async function markReleasedHeaderCleanupComplete(header, deps = {}) {
  const now = getNow(deps);
  const Model = getLeaseModel(deps);
  const remaining = await countCheckoutClaimsForLease(header);
  if (remaining > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_INCOMPLETE',
      'Cannot mark cleanup complete while checkout claims remain',
      {
        checkoutId: header.checkoutId,
        leaseId: header.leaseId,
        generation: header.generation,
        remaining
      }
    );
  }

  const filter = bindReleasedHeaderIdentityFilter(header);

  const updated = await Model.findOneAndUpdate(
    filter,
    {
      $set: {
        checkoutClaimCleanupStatus: 'complete',
        checkoutClaimCleanupCompletedAt: now,
        checkoutClaimCleanupLastAttemptAt: now,
        checkoutClaimCleanupFailureCode: null,
        checkoutClaimCleanupNextAttemptAt: null
      }
    },
    { new: true }
  );

  if (updated) {
    return { ok: true, idempotent: false, header: updated.toObject ? updated.toObject() : updated };
  }

  const again = await Model.findOne({
    leaseId: header.leaseId,
    checkoutId: header.checkoutId
  }).lean();
  if (
    again &&
    again.status === 'released' &&
    again.isLive === false &&
    Number(again.generation) === Number(header.generation) &&
    again.checkoutClaimCleanupStatus === 'complete'
  ) {
    return { ok: true, idempotent: true, header: again };
  }

  throw new AccommodationCheckoutHoldError(
    'ACCOMMODATION_LEASE_CLEANUP_COMPLETE_CAS_FAILED',
    'Failed to CAS released-header cleanup status to complete',
    {
      checkoutId: header.checkoutId,
      leaseId: header.leaseId,
      generation: header.generation,
      status: again && again.status,
      cleanupStatus: again && again.checkoutClaimCleanupStatus
    }
  );
}

/**
 * Annotate failure after attempt reservation. Does not change nextAttemptAt
 * (already deferred by reservation) or attempt count.
 */
async function recordReleasedHeaderCleanupFailure(header, err, deps = {}) {
  const now = getNow(deps);
  const Model = getLeaseModel(deps);
  const failureCode = safeCleanupFailureCode(err);
  await Model.updateOne(
    {
      leaseId: header.leaseId,
      checkoutId: header.checkoutId,
      generation: header.generation,
      status: 'released',
      isLive: false,
      $or: [
        { checkoutClaimCleanupStatus: 'pending' },
        { checkoutClaimCleanupStatus: null },
        { checkoutClaimCleanupStatus: { $exists: false } }
      ]
    },
    {
      $set: {
        checkoutClaimCleanupLastAttemptAt: now,
        checkoutClaimCleanupFailureCode: failureCode
      }
    }
  );
  return { failureCode };
}

/**
 * Run authorized cleanup (or legacy zero-claim completion), verify zero, mark complete.
 *
 * Attempt reservation is required unless cleanupArgs.cleanupAuthority is the
 * exact module-private Symbol (post-release / same-checkout / post-reserve paths).
 * Boolean skip flags are never accepted. Fake/missing Symbol on an authority-
 * bearing args object fails closed.
 */
async function finalizeReleasedHeaderClaimCleanup(header, cleanupArgs = {}) {
  if (!header || header.status !== 'released' || header.isLive !== false) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_EXPIRY_UNAUTHORIZED',
      'Claim cleanup requires durable released non-live lease header',
      {
        leaseId: header && header.leaseId,
        status: header && header.status,
        isLive: header && header.isLive
      }
    );
  }

  if (
    cleanupArgs.cleanupAuthority !== undefined &&
    cleanupArgs.cleanupAuthority !== null &&
    cleanupArgs.cleanupAuthority !== PRIVATE_RELEASED_CLEANUP_AUTHORITY
  ) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_DENIED',
      'Immediate released-header cleanup requires module-private authority'
    );
  }

  // Defense in depth: never honor boolean skip / ignore flags on cleanup args.
  if (
    (cleanupArgs.skipCleanupAttemptReservation !== undefined &&
      cleanupArgs.skipCleanupAttemptReservation !== null) ||
    (cleanupArgs.ignoreCleanupNextAttemptAt !== undefined &&
      cleanupArgs.ignoreCleanupNextAttemptAt !== null)
  ) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_INJECTION',
      'Boolean cleanup-authority flags are not accepted on cleanup args'
    );
  }

  const deps = cleanupArgs.deps || {};
  const privateAuth = hasPrivateReleasedCleanupAuthority(cleanupArgs);

  let workingHeader = header;
  if (!privateAuth) {
    const reserved = await reserveReleasedHeaderCleanupAttempt(header, deps, {});
    if (!reserved.won) {
      return {
        skipped: true,
        deletedCount: 0,
        entityType: header.entityType,
        completed: false
      };
    }
    workingHeader = reserved.header || header;
  }

  const remainingBefore = await countCheckoutClaimsForLease(workingHeader);
  let deletedCount = 0;
  if (remainingBefore > 0) {
    const cleanup = await cleanupClaimsForReleasedHeader(workingHeader, deps);
    deletedCount = cleanup.deletedCount || 0;
  }

  const remainingAfter = await countCheckoutClaimsForLease(workingHeader);
  if (remainingAfter > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_EXPIRY_CLEANUP_INCOMPLETE',
      'Checkout claims remain after released-header cleanup',
      {
        checkoutId: workingHeader.checkoutId,
        leaseId: workingHeader.leaseId,
        generation: workingHeader.generation,
        remaining: remainingAfter
      }
    );
  }

  const marked = await markReleasedHeaderCleanupComplete(workingHeader, deps);
  return {
    deletedCount,
    entityType: workingHeader.entityType,
    completed: true,
    idempotentComplete: marked.idempotent === true,
    skipped: false
  };
}

async function countAllCheckoutClaimsForCheckout(checkoutId) {
  const id = String(checkoutId);
  const [unitCount, cabinCount] = await Promise.all([
    UnitNightClaim.countDocuments({ ownerType: 'checkout', checkoutId: id }),
    CabinNightClaim.countDocuments({ ownerType: 'checkout', checkoutId: id })
  ]);
  return unitCount + cabinCount;
}

/**
 * After durable header is released (non-live), delete exact checkout claims via
 * independently authorized Unit/Cabin expiry APIs. Null resource on header is
 * only allowed when zero checkout claims exist for the lease.
 */
async function cleanupClaimsForReleasedHeader(header, deps = {}) {
  if (!header || header.status !== 'released' || header.isLive !== false) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_EXPIRY_UNAUTHORIZED',
      'Claim cleanup requires durable released non-live lease header',
      {
        leaseId: header && header.leaseId,
        status: header && header.status,
        isLive: header && header.isLive
      }
    );
  }

  if (typeof deps.onAfterHeaderReleasedBeforeClaimDelete === 'function') {
    await deps.onAfterHeaderReleasedBeforeClaimDelete({
      header,
      checkoutId: header.checkoutId,
      leaseId: header.leaseId,
      generation: header.generation
    });
  }

  const base = {
    checkoutId: header.checkoutId,
    leaseId: header.leaseId,
    generation: header.generation
  };

  if (header.entityType === 'unit') {
    if (header.unitId == null) {
      const remaining = await countCheckoutClaimsForLease(header);
      if (remaining > 0) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_LEASE_ORPHAN_CLAIMS',
          'Released unit lease has checkout claims but header unitId is null',
          {
            checkoutId: header.checkoutId,
            leaseId: header.leaseId,
            remaining
          }
        );
      }
      return { deletedCount: 0, entityType: 'unit' };
    }
    const unitRes = await expireUnitCheckoutClaims({
      ...base,
      unitId: header.unitId
    });
    return { deletedCount: unitRes.deletedCount || 0, entityType: 'unit' };
  }

  if (header.entityType === 'cabin') {
    if (header.cabinId == null) {
      const remaining = await countCheckoutClaimsForLease(header);
      if (remaining > 0) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_LEASE_ORPHAN_CLAIMS',
          'Released cabin lease has checkout claims but header cabinId is null',
          {
            checkoutId: header.checkoutId,
            leaseId: header.leaseId,
            remaining
          }
        );
      }
      return { deletedCount: 0, entityType: 'cabin' };
    }
    const cabinRes = await expireCabinCheckoutClaims({
      ...base,
      cabinId: header.cabinId
    });
    return { deletedCount: cabinRes.deletedCount || 0, entityType: 'cabin' };
  }

  throw new AccommodationCheckoutHoldError(
    'ACCOMMODATION_LEASE_INTEGRITY',
    'Released lease header has unknown entityType',
    { leaseId: header.leaseId, entityType: header.entityType }
  );
}

/**
 * CAS a due open|sealed header to released, then clean claims.
 * Crash recovery: same-generation already-released header resumes cleanup.
 */
async function releaseDueHeaderThenCleanupClaims(header, now, deps = {}) {
  const Model = getLeaseModel(deps);
  const cas = await Model.findOneAndUpdate(
    {
      _id: header._id,
      leaseId: header.leaseId,
      checkoutId: header.checkoutId,
      generation: header.generation,
      isLive: true,
      status: { $in: ['open', 'sealed'] },
      expiresAt: { $lte: now }
    },
    {
      $set: releaseTransitionSet()
    },
    { new: true }
  );

  let releasedHeader = cas ? (cas.toObject ? cas.toObject() : cas) : null;
  let wonCas = Boolean(cas);
  if (!releasedHeader) {
    const again = await Model.findOne({
      leaseId: header.leaseId,
      checkoutId: header.checkoutId
    }).lean();
    if (again && again.status === 'converting' && again.isLive === true) {
      return { skippedConverting: true, expired: false, deletedCount: 0 };
    }
    if (
      again &&
      again.status === 'released' &&
      again.isLive === false &&
      Number(again.generation) === Number(header.generation)
    ) {
      releasedHeader = again;
      wonCas = false;
    } else {
      return { skipped: true, expired: false, deletedCount: 0 };
    }
  }

  const cleanup = await finalizeReleasedHeaderClaimCleanup(
    releasedHeader,
    privateReleasedCleanupArgs(deps)
  );
  return {
    skippedConverting: false,
    skipped: false,
    expired: wonCas,
    deletedCount: cleanup.deletedCount || 0,
    entityType: cleanup.entityType,
    header: releasedHeader,
    cleanupCompleted: cleanup.completed === true
  };
}

/**
 * Resume claim cleanup for already-released headers belonging to this checkout.
 * Same-checkout recovery uses module-private authority so orphan claims cannot
 * block a new generation indefinitely (skips deferred nextAttemptAt).
 */
async function resumeReleasedHeaderClaimCleanup(checkoutId, deps = {}) {
  const Model = getLeaseModel(deps);
  const released = await Model.find({
    checkoutId: String(checkoutId),
    status: 'released',
    isLive: false,
    $or: [
      { checkoutClaimCleanupStatus: 'pending' },
      { checkoutClaimCleanupStatus: null },
      { checkoutClaimCleanupStatus: { $exists: false } }
    ]
  }).lean();

  for (const header of released) {
    await finalizeReleasedHeaderClaimCleanup(header, privateReleasedCleanupArgs(deps));
  }
}

async function assertNoCheckoutClaimsBlockingNewGeneration(checkoutId) {
  const remaining = await countAllCheckoutClaimsForCheckout(checkoutId);
  if (remaining > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_ORPHAN_CLAIMS',
      'Cannot create a new live lease generation while checkout claims remain',
      { checkoutId: String(checkoutId), remaining }
    );
  }
}

/**
 * Acquire-path: never perform header-only release. CAS due open|sealed headers
 * to released, clean exact claims, resume prior released cleanup, then continue.
 * Converting headers are left untouched.
 */
async function releaseExpiredHeaderIfNeeded(header, now, deps) {
  const checkoutId = header && header.checkoutId != null ? String(header.checkoutId) : null;

  if (header && header.isLive && header.status === 'converting') {
    if (checkoutId) {
      await resumeReleasedHeaderClaimCleanup(checkoutId, deps);
    }
    return header;
  }

  if (
    header &&
    header.isLive &&
    (header.status === 'open' || header.status === 'sealed')
  ) {
    if (header.expiresAt && new Date(header.expiresAt).getTime() > now.getTime()) {
      if (checkoutId) {
        await resumeReleasedHeaderClaimCleanup(checkoutId, deps);
      }
      return header;
    }
    const result = await releaseDueHeaderThenCleanupClaims(header, now, deps);
    if (result.skippedConverting) {
      const Model = getLeaseModel(deps);
      const again = await Model.findOne({
        leaseId: header.leaseId,
        checkoutId: header.checkoutId
      }).lean();
      if (checkoutId) {
        await resumeReleasedHeaderClaimCleanup(checkoutId, deps);
      }
      return again;
    }
    if (result.skipped) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_EXPIRY_CLEANUP_INCOMPLETE',
        'Unable to release expired lease header for acquire-time cleanup',
        {
          checkoutId: header.checkoutId,
          leaseId: header.leaseId,
          generation: header.generation
        }
      );
    }
  } else if (header && header.status === 'released' && header.isLive === false) {
    if (isCleanupPendingOrLegacy(header)) {
      // Durable released non-live proof: private authority for immediate cleanup.
      await finalizeReleasedHeaderClaimCleanup(header, privateReleasedCleanupArgs(deps));
    }
  }

  if (checkoutId) {
    await resumeReleasedHeaderClaimCleanup(checkoutId, deps);
  }

  return null;
}

async function beginAcquisition(header, acquisitionId, now, deps) {
  const Model = getLeaseModel(deps);
  const updated = await Model.findOneAndUpdate(
    {
      leaseId: header.leaseId,
      isLive: true,
      status: 'open',
      activeAcquisitionId: null,
      expiresAt: { $gt: now }
    },
    {
      $set: {
        activeAcquisitionId: String(acquisitionId),
        acquisitionStartedAt: now,
        status: 'open'
      }
    },
    { new: true }
  );
  if (!updated) {
    throw new AccommodationCheckoutHoldError(
      'SAME_OWNER_ACQUISITION_IN_PROGRESS',
      'Another acquisition already owns this live lease header'
    );
  }
  return updated.toObject ? updated.toObject() : updated;
}

async function markHeaderFailed(header, acquisitionId, deps) {
  const Model = getLeaseModel(deps);
  await Model.updateOne(
    {
      leaseId: header.leaseId,
      activeAcquisitionId: String(acquisitionId),
      isLive: true
    },
    {
      $set: {
        status: 'failed',
        isLive: false,
        activeAcquisitionId: null,
        acquisitionStartedAt: null
      }
    }
  );
}

async function sealHeader({ header, acquisitionId, candidate, expiresAt, now, deps }) {
  const Model = getLeaseModel(deps);
  const set = {
    status: 'sealed',
    isLive: true,
    activeAcquisitionId: null,
    acquisitionStartedAt: null,
    entityType: candidate.entityType || candidate.kind,
    cabinId: candidate.cabinId,
    unitId: candidate.kind === 'unit' ? candidate.unitId : null
  };
  const updated = await Model.findOneAndUpdate(
    {
      leaseId: header.leaseId,
      isLive: true,
      status: 'open',
      activeAcquisitionId: String(acquisitionId),
      expiresAt: { $gt: now }
    },
    {
      $set: set,
      $max: { expiresAt }
    },
    { new: true }
  );
  if (!updated) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTEGRITY',
      'Failed to seal lease header under current acquisition fence'
    );
  }
  return updated.toObject ? updated.toObject() : updated;
}

async function extendSealedLease(header, expiresAt, deps) {
  const Model = getLeaseModel(deps);
  await Model.updateOne(
    { leaseId: header.leaseId, isLive: true, status: 'sealed' },
    { $max: { expiresAt } }
  );
  const refreshed = await Model.findOne({ leaseId: header.leaseId }).lean();
  return refreshed || header;
}

async function verifySealedLeaseIntact(header, now) {
  if (header.entityType === 'unit') {
    if (!header.unitId) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Sealed unit lease is missing unitId'
      );
    }
    const verified = await verifyUnitCheckoutLeaseNights({
      unitId: header.unitId,
      checkoutId: header.checkoutId,
      leaseId: header.leaseId,
      checkIn: header.checkIn,
      checkOut: header.checkOut,
      now,
      skipIndexAssert: false
    });
    if (!verified.ok) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Sealed unit lease nights are incomplete or expired',
        verified
      );
    }
    return verified;
  }

  if (!header.cabinId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTEGRITY',
      'Sealed cabin lease is missing cabinId'
    );
  }
  const verified = await verifyCabinCheckoutLeaseNights({
    cabinId: header.cabinId,
    checkoutId: header.checkoutId,
    leaseId: header.leaseId,
    checkIn: header.checkIn,
    checkOut: header.checkOut,
    now,
    skipIndexAssert: false
  });
  if (!verified.ok) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTEGRITY',
      'Sealed cabin lease nights are incomplete or expired',
      verified
    );
  }
  return verified;
}

async function acquireCandidateNights({
  candidate,
  checkoutId,
  leaseId,
  acquisitionId,
  checkIn,
  checkOut,
  expiresAt,
  now
}) {
  if (candidate.kind === 'unit') {
    return acquireUnitCheckoutNights({
      unitId: candidate.unitId,
      checkoutId,
      leaseId,
      acquisitionId,
      checkIn,
      checkOut,
      expiresAt,
      now
    });
  }
  return acquireCabinCheckoutNights({
    cabinId: candidate.cabinId,
    checkoutId,
    leaseId,
    acquisitionId,
    checkIn,
    checkOut,
    expiresAt,
    now
  });
}

async function compensateCandidate({ candidate, leaseId, acquisitionId, newlyAcquired }) {
  const claimIds = (newlyAcquired || []).map((c) => c.id);
  if (candidate.kind === 'unit') {
    return compensateUnitCheckoutAcquisition({
      leaseId,
      acquisitionId,
      claimIds,
      unitId: candidate.unitId,
      nights: (newlyAcquired || []).map((c) => c.night)
    });
  }
  return compensateCabinCheckoutAcquisition({
    leaseId,
    acquisitionId,
    claimIds,
    cabinId: candidate.cabinId,
    nights: (newlyAcquired || []).map((c) => c.night)
  });
}

async function assertZeroAcquisitionRows({ candidate, leaseId, acquisitionId }) {
  const remaining =
    candidate.kind === 'unit'
      ? await countUnitAcquisitionClaims({ leaseId, acquisitionId })
      : await countCabinAcquisitionClaims({ leaseId, acquisitionId });
  if (remaining > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_COMPENSATION_FAILED',
      'Acquisition-tagged claims remain after compensation',
      { leaseId, acquisitionId, remaining }
    );
  }
}

/**
 * Idempotent backstop before trying another candidate.
 */
async function compensateCandidateBackstop({ candidate, leaseId, acquisitionId, newlyAcquired }) {
  await compensateCandidate({ candidate, leaseId, acquisitionId, newlyAcquired });
  await assertZeroAcquisitionRows({ candidate, leaseId, acquisitionId });
}

async function clearAcquisitionMarkers(
  { candidate, leaseId, acquisitionId, newlyAcquired },
  deps = {}
) {
  if (typeof deps.clearAcquisitionMarkers === 'function') {
    return deps.clearAcquisitionMarkers({
      candidate,
      leaseId,
      acquisitionId,
      newlyAcquired
    });
  }
  const claimIds = (newlyAcquired || []).map((c) => c.id);
  if (candidate.kind === 'unit') {
    return clearUnitCheckoutAcquisitionMarkers({ leaseId, acquisitionId, claimIds });
  }
  return clearCabinCheckoutAcquisitionMarkers({ leaseId, acquisitionId, claimIds });
}

async function acquireAccommodationCheckoutHold(input = {}, deps = {}) {
  assertNoCallerCleanupAuthorityControls(deps);
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const bookingContext = assertBookingContext(input.bookingContext);
  const { now, expiresAt } = resolveLeaseExpiresAt(input, deps);
  const stay = resolveStayDateOnlys(input.checkIn, input.checkOut);

  if (input.unitId || input.assignedUnitId || input.clientUnitId || input.selectedUnitId) {
    throw new AccommodationCheckoutHoldError(
      'UNSUPPORTED_BOOKING_CONTEXT',
      'Client-selected physical units are not accepted'
    );
  }

  const entityHint =
    input.entityType != null
      ? String(input.entityType).trim()
      : input.cabinTypeId
        ? 'cabinType'
        : input.cabinId
          ? 'cabin'
          : '';

  if (entityHint !== 'cabin' && entityHint !== 'cabinType') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_NOT_FOUND',
      'entityType must be cabin or cabinType'
    );
  }

  const nightDates =
    entityHint === 'cabinType'
      ? resolveUnitNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut })
      : resolveCabinNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut });
  const expectedNightCount = nightDates.length;
  if (expectedNightCount < 1) {
    throw new AccommodationCheckoutHoldError('INVALID_STAY_DATES', 'Stay must include at least one night');
  }

  try {
    if (entityHint === 'cabinType') {
      await assertAuthoritativeUnitNightIndex();
    } else {
      await assertAuthoritativeCabinNightIndex();
    }
  } catch (err) {
    throw mapClaimError(err);
  }

  let live = await findLiveLease(checkoutId, deps);
  live = await releaseExpiredHeaderIfNeeded(live, now, deps);

  // Crash recovery: released headers with leftover claims (no live row) must clean
  // before any new generation is created.
  if (!live) {
    await resumeReleasedHeaderClaimCleanup(checkoutId, deps);
  }

  if (live && live.status === 'converting') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CONVERSION_IN_PROGRESS',
      'Cannot acquire or renew while accommodation lease conversion is in progress',
      { checkoutId, leaseId: live.leaseId, conversionBookingId: live.conversionBookingId }
    );
  }

  if (
    live &&
    live.status === 'sealed' &&
    String(live.checkIn) === stay.checkIn &&
    String(live.checkOut) === stay.checkOut &&
    ((entityHint === 'cabinType' && live.entityType === 'unit') ||
      (entityHint === 'cabin' && live.entityType === 'cabin'))
  ) {
    const verified = await verifySealedLeaseIntact(live, now);
    // Safe leftover marker repair on sealed retry.
    if (live.entityType === 'unit') {
      await clearUnitSealedLeaseLeftoverMarkers({
        checkoutId,
        leaseId: live.leaseId
      });
    } else {
      await clearCabinSealedLeaseLeftoverMarkers({
        checkoutId,
        leaseId: live.leaseId
      });
    }
    const renewed = await extendSealedLease(live, expiresAt, deps);
    const verifiedAfter = await verifySealedLeaseIntact(renewed, now);
    return toLeaseResult(renewed, {
      checkoutId,
      outcome: 'renewed',
      claims: verifiedAfter.claims
    });
  }

  if (live && live.status === 'sealed') {
    await releaseAccommodationCheckoutHold(checkoutId, { leaseId: live.leaseId }, deps);
    live = null;
  }

  if (!live) {
    await assertNoCheckoutClaimsBlockingNewGeneration(checkoutId);
    live = await createOpenLeaseHeader({
      checkoutId,
      entityType: entityHint === 'cabinType' ? 'unit' : 'cabin',
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      expectedNightCount,
      expiresAt,
      deps
    });
  } else if (live.status === 'open') {
    if (
      String(live.checkIn) !== stay.checkIn ||
      String(live.checkOut) !== stay.checkOut ||
      (entityHint === 'cabinType' && live.entityType !== 'unit') ||
      (entityHint === 'cabin' && live.entityType !== 'cabin')
    ) {
      await releaseAccommodationCheckoutHold(checkoutId, { leaseId: live.leaseId }, deps);
      await assertNoCheckoutClaimsBlockingNewGeneration(checkoutId);
      live = await createOpenLeaseHeader({
        checkoutId,
        entityType: entityHint === 'cabinType' ? 'unit' : 'cabin',
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        expectedNightCount,
        expiresAt,
        deps
      });
    }
  }

  const acquisitionId = newStrongId('acq');
  let fenced;
  try {
    fenced = await beginAcquisition(live, acquisitionId, now, deps);
  } catch (err) {
    if (err instanceof AccommodationCheckoutHoldError && err.code === 'SAME_OWNER_ACQUISITION_IN_PROGRESS') {
      const again = await findLiveLease(checkoutId, deps);
      if (
        again &&
        again.status === 'sealed' &&
        String(again.checkIn) === stay.checkIn &&
        String(again.checkOut) === stay.checkOut
      ) {
        const verified = await verifySealedLeaseIntact(again, now);
        const renewed = await extendSealedLease(again, expiresAt, deps);
        return toLeaseResult(renewed, {
          checkoutId,
          outcome: 'reused',
          claims: verified.claims
        });
      }
    }
    throw err;
  }

  let resolved;
  try {
    resolved =
      entityHint === 'cabinType'
        ? await resolveUnitCandidates(input, stay.startDate, deps)
        : await resolveCabinCandidate(input, stay.startDate, deps);
  } catch (err) {
    await markHeaderFailed(fenced, acquisitionId, deps);
    throw err instanceof AccommodationCheckoutHoldError ? err : mapClaimError(err);
  }

  if (bookingContext === 'fixed_package') {
    try {
      await assertFixedPackageMayUseInventory(
        input,
        resolved.accommodationKey,
        stay.startDate,
        stay.endDate,
        deps
      );
    } catch (err) {
      await markHeaderFailed(fenced, acquisitionId, deps);
      throw err;
    }
  } else if (resolved.accommodationKey) {
    try {
      await evaluateNormalStayExclusivity({
        accommodationKey: resolved.accommodationKey,
        checkIn: stay.startDate,
        checkOut: stay.endDate,
        loadExclusiveFixedPackages:
          deps.loadExclusiveFixedPackages || defaultLoadExclusiveFixedPackages
      });
    } catch (err) {
      await markHeaderFailed(fenced, acquisitionId, deps);
      if (err instanceof RatePlanAvailabilityError) {
        throw new AccommodationCheckoutHoldError(err.code, err.message, err.details);
      }
      throw mapClaimError(err);
    }
  }

  if (!resolved.eligible.length) {
    await markHeaderFailed(fenced, acquisitionId, deps);
    throw new AccommodationCheckoutHoldError(
      'NO_ELIGIBLE_ACCOMMODATION',
      'No sellable accommodation candidates'
    );
  }

  let lastOccupancyConflict = null;
  for (const candidate of resolved.eligible) {
    let softOk;
    try {
      softOk = await candidateSoftAvailable(
        candidate,
        stay.startDate,
        stay.endDate,
        bookingContext,
        deps
      );
    } catch (err) {
      await markHeaderFailed(fenced, acquisitionId, deps);
      throw mapClaimError(err);
    }
    if (!softOk) continue;

    let acquired = { newlyAcquired: [], reused: [], claims: [] };
    try {
      acquired = await acquireCandidateNights({
        candidate,
        checkoutId,
        leaseId: fenced.leaseId,
        acquisitionId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        expiresAt,
        now
      });
    } catch (err) {
      const mapped = mapClaimError(err);
      try {
        await compensateCandidateBackstop({
          candidate,
          leaseId: fenced.leaseId,
          acquisitionId,
          newlyAcquired: acquired.newlyAcquired
        });
      } catch (compErr) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapClaimError(compErr);
      }

      if (!isOccupancyOrReadinessFailure(mapped)) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapped;
      }
      lastOccupancyConflict = mapped;
      continue;
    }

    let verified;
    try {
      if (candidate.kind === 'unit') {
        verified = await verifyUnitCheckoutLeaseNights({
          unitId: candidate.unitId,
          checkoutId,
          leaseId: fenced.leaseId,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          now,
          skipIndexAssert: true
        });
      } else {
        verified = await verifyCabinCheckoutLeaseNights({
          cabinId: candidate.cabinId,
          checkoutId,
          leaseId: fenced.leaseId,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          now,
          skipIndexAssert: true
        });
      }
    } catch (err) {
      try {
        await compensateCandidateBackstop({
          candidate,
          leaseId: fenced.leaseId,
          acquisitionId,
          newlyAcquired: acquired.newlyAcquired
        });
      } catch (compErr) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapClaimError(compErr);
      }
      const mapped = mapClaimError(err);
      if (!isOccupancyOrReadinessFailure(mapped)) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapped;
      }
      lastOccupancyConflict = mapped;
      continue;
    }

    if (!verified.ok || verified.foundNightCount !== expectedNightCount) {
      try {
        await compensateCandidateBackstop({
          candidate,
          leaseId: fenced.leaseId,
          acquisitionId,
          newlyAcquired: acquired.newlyAcquired
        });
      } catch (compErr) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapClaimError(compErr);
      }
      lastOccupancyConflict = new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Incomplete claim set before seal'
      );
      await markHeaderFailed(fenced, acquisitionId, deps);
      throw lastOccupancyConflict;
    }

    let sealed;
    try {
      sealed = await sealHeader({
        header: fenced,
        acquisitionId,
        candidate,
        expiresAt,
        now,
        deps
      });
    } catch (err) {
      try {
        await compensateCandidateBackstop({
          candidate,
          leaseId: fenced.leaseId,
          acquisitionId,
          newlyAcquired: acquired.newlyAcquired
        });
      } catch (compErr) {
        await markHeaderFailed(fenced, acquisitionId, deps);
        throw mapClaimError(compErr);
      }
      await markHeaderFailed(fenced, acquisitionId, deps);
      throw err instanceof AccommodationCheckoutHoldError ? err : mapClaimError(err);
    }

    try {
      await clearAcquisitionMarkers(
        {
          candidate,
          leaseId: fenced.leaseId,
          acquisitionId,
          newlyAcquired: acquired.newlyAcquired
        },
        deps
      );
    } catch (err) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Lease sealed but clearing acquisition markers failed',
        { cause: err?.message || String(err), leaseId: sealed.leaseId }
      );
    }

    return toLeaseResult(sealed, {
      checkoutId,
      outcome: 'created',
      claims: verified.claims
    });
  }

  await markHeaderFailed(fenced, acquisitionId, deps);
  if (lastOccupancyConflict) throw lastOccupancyConflict;
  throw new AccommodationCheckoutHoldError(
    'NO_ELIGIBLE_ACCOMMODATION',
    'No accommodation candidate could be leased'
  );
}

async function getActiveAccommodationCheckoutHold(checkoutId, deps = {}) {
  const id = assertValidCheckoutId(checkoutId);
  const now = getNow(deps);
  const live = await findLiveLease(id, deps);
  if (!live || live.status !== 'sealed') return null;
  if (live.expiresAt && new Date(live.expiresAt).getTime() <= now.getTime()) return null;
  try {
    const verified = await verifySealedLeaseIntact(live, now);
    return toLeaseResult(live, { checkoutId: id, outcome: 'reused', claims: verified.claims });
  } catch {
    return null;
  }
}

async function assertAccommodationCheckoutHoldActive(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const now = getNow(deps);
  const stay = resolveStayDateOnlys(input.checkIn, input.checkOut);
  const live = await findLiveLease(checkoutId, deps);
  if (!live || live.status !== 'sealed') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_HOLD_NOT_ACTIVE',
      'Accommodation checkout hold is not active'
    );
  }
  if (String(live.checkIn) !== stay.checkIn || String(live.checkOut) !== stay.checkOut) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_HOLD_NOT_ACTIVE',
      'Hold dates do not match the requested stay'
    );
  }
  if (live.expiresAt && new Date(live.expiresAt).getTime() <= now.getTime()) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_HOLD_NOT_ACTIVE',
      'Accommodation checkout hold has expired'
    );
  }
  if (input.cabinId && live.cabinId && String(live.cabinId) !== String(input.cabinId)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_HOLD_NOT_ACTIVE',
      'Hold cabin does not match'
    );
  }
  if (input.unitId !== undefined) {
    const expected = input.unitId == null ? null : String(input.unitId);
    const actual = live.unitId == null ? null : String(live.unitId);
    if (expected !== actual) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_HOLD_NOT_ACTIVE',
        'Hold unit does not match'
      );
    }
  }
  const verified = await verifySealedLeaseIntact(live, now);
  return toLeaseResult(live, { checkoutId, outcome: 'reused', claims: verified.claims });
}

async function releaseAccommodationCheckoutHold(checkoutId, options = {}, deps = {}) {
  assertNoCallerCleanupAuthorityControls(deps);
  const id = assertValidCheckoutId(checkoutId);
  const Model = getLeaseModel(deps);
  const filter = {
    checkoutId: id,
    isLive: true,
    activeAcquisitionId: null,
    status: { $in: ['open', 'sealed'] }
  };
  if (options.leaseId) {
    filter.leaseId = String(options.leaseId);
  }

  // Detect active acquisition for exact lease/checkout before mutating.
  const blocked = await Model.find({
    checkoutId: id,
    isLive: true,
    activeAcquisitionId: { $ne: null },
    ...(options.leaseId ? { leaseId: String(options.leaseId) } : {})
  }).lean();
  if (blocked.length > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_ACQUISITION_IN_PROGRESS',
      'Cannot release lease while an acquisition fence is active',
      { checkoutId: id, leaseIds: blocked.map((h) => h.leaseId) }
    );
  }

  const converting = await Model.find({
    checkoutId: id,
    isLive: true,
    status: 'converting',
    ...(options.leaseId ? { leaseId: String(options.leaseId) } : {})
  }).lean();
  if (converting.length > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_CONVERSION_PROTECTED',
      'Cannot release accommodation lease while conversion is in progress',
      {
        checkoutId: id,
        leaseIds: converting.map((h) => h.leaseId),
        conversionBookingIds: converting.map((h) =>
          h.conversionBookingId != null ? String(h.conversionBookingId) : null
        )
      }
    );
  }

  const headers = await Model.find(filter).lean();
  // Resume cleanup for already-released pending/legacy headers (crash recovery).
  const releasedNeedingCleanup = await Model.find({
    checkoutId: id,
    ...releasedHeaderCleanupPendingFilter(),
    ...(options.leaseId ? { leaseId: String(options.leaseId) } : {})
  }).lean();

  if (headers.length === 0 && releasedNeedingCleanup.length === 0) {
    return { checkoutId: id, releasedCount: 0 };
  }

  let releasedCount = 0;

  async function cleanupReleasedClaims(releasedHeader) {
    if (typeof deps.onAfterHeaderReleasedBeforeClaimDelete === 'function') {
      await deps.onAfterHeaderReleasedBeforeClaimDelete({
        header: releasedHeader,
        checkoutId: releasedHeader.checkoutId,
        leaseId: releasedHeader.leaseId,
        generation: releasedHeader.generation,
        path: 'release'
      });
    }

    const base = {
      checkoutId: releasedHeader.checkoutId,
      leaseId: releasedHeader.leaseId,
      generation: releasedHeader.generation
    };

    if (releasedHeader.entityType === 'unit') {
      if (releasedHeader.unitId == null) {
        const remaining = await countCheckoutClaimsForLease(releasedHeader);
        if (remaining > 0) {
          throw new AccommodationCheckoutHoldError(
            'ACCOMMODATION_LEASE_ORPHAN_CLAIMS',
            'Released unit lease has checkout claims but header unitId is null',
            {
              checkoutId: releasedHeader.checkoutId,
              leaseId: releasedHeader.leaseId,
              remaining
            }
          );
        }
        return { deletedCount: 0, remaining: 0, ok: true };
      }
      return releaseUnitCheckoutLeaseClaims({
        ...base,
        unitId: releasedHeader.unitId
      });
    }

    if (releasedHeader.entityType === 'cabin') {
      if (releasedHeader.cabinId == null) {
        const remaining = await countCheckoutClaimsForLease(releasedHeader);
        if (remaining > 0) {
          throw new AccommodationCheckoutHoldError(
            'ACCOMMODATION_LEASE_ORPHAN_CLAIMS',
            'Released cabin lease has checkout claims but header cabinId is null',
            {
              checkoutId: releasedHeader.checkoutId,
              leaseId: releasedHeader.leaseId,
              remaining
            }
          );
        }
        return { deletedCount: 0, remaining: 0, ok: true };
      }
      return releaseCabinCheckoutLeaseClaims({
        ...base,
        cabinId: releasedHeader.cabinId
      });
    }

    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_INTEGRITY',
      'Released lease header has unknown entityType',
      { leaseId: releasedHeader.leaseId, entityType: releasedHeader.entityType }
    );
  }

  for (const header of headers) {
    const cas = await Model.findOneAndUpdate(
      {
        _id: header._id,
        checkoutId: id,
        leaseId: header.leaseId,
        generation: header.generation,
        isLive: true,
        status: { $in: ['open', 'sealed'] },
        activeAcquisitionId: null
      },
      {
        $set: releaseTransitionSet()
      },
      { new: true }
    );

    let releasedHeader = cas ? (cas.toObject ? cas.toObject() : cas) : null;
    if (!releasedHeader) {
      const again = await Model.findOne({
        checkoutId: id,
        leaseId: header.leaseId
      }).lean();
      if (
        again &&
        again.status === 'released' &&
        again.isLive === false &&
        Number(again.generation) === Number(header.generation)
      ) {
        releasedHeader = again;
      } else if (again && again.status === 'converting' && again.isLive === true) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_LEASE_CONVERSION_PROTECTED',
          'Cannot release accommodation lease while conversion is in progress',
          {
            checkoutId: id,
            leaseId: header.leaseId,
            conversionBookingId:
              again.conversionBookingId != null ? String(again.conversionBookingId) : null
          }
        );
      } else {
        continue;
      }
    } else {
      releasedCount += 1;
    }

    const claimRelease = await cleanupReleasedClaims(releasedHeader);
    if (!claimRelease.ok || (claimRelease.remaining != null && claimRelease.remaining > 0)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_RELEASE_INCOMPLETE',
        'Checkout claims remain after released-header cleanup',
        {
          checkoutId: id,
          leaseId: releasedHeader.leaseId,
          remaining: claimRelease.remaining,
          deletedCount: claimRelease.deletedCount
        }
      );
    }
    const remaining = await countCheckoutClaimsForLease(releasedHeader);
    if (remaining > 0) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_RELEASE_INCOMPLETE',
        'Checkout claims remain after released-header cleanup',
        {
          checkoutId: id,
          leaseId: releasedHeader.leaseId,
          remaining
        }
      );
    }
    await markReleasedHeaderCleanupComplete(releasedHeader, pickSafeCleanupDeps(deps));
  }

  for (const header of releasedNeedingCleanup) {
    const safeDeps = pickSafeCleanupDeps(deps);
    if (typeof deps.onAfterHeaderReleasedBeforeClaimDelete === 'function') {
      safeDeps.onAfterHeaderReleasedBeforeClaimDelete = async (payload) =>
        deps.onAfterHeaderReleasedBeforeClaimDelete({ ...payload, path: 'release' });
    }
    await finalizeReleasedHeaderClaimCleanup(header, {
      deps: safeDeps,
      cleanupAuthority: PRIVATE_RELEASED_CLEANUP_AUTHORITY
    });
  }

  return { checkoutId: id, releasedCount };
}

async function expireAccommodationCheckoutHolds(deps = {}) {
  assertNoCallerCleanupAuthorityControls(deps);
  const safeDeps = pickSafeCleanupDeps(deps);
  const now = getNow(safeDeps);
  const Model = getLeaseModel(safeDeps);
  const dueHeaders = await Model.find({
    isLive: true,
    status: { $in: ['open', 'sealed'] },
    expiresAt: { $lte: now }
  }).lean();

  let expiredCount = 0;
  let expiredUnitClaims = 0;
  let expiredCabinClaims = 0;
  let skippedConverting = 0;

  for (const header of dueHeaders) {
    const result = await releaseDueHeaderThenCleanupClaims(header, now, safeDeps);
    if (result.skippedConverting) {
      skippedConverting += 1;
      continue;
    }
    if (result.skipped) {
      continue;
    }
    if (result.expired) {
      expiredCount += 1;
    }
    if (result.entityType === 'unit') {
      expiredUnitClaims += result.deletedCount || 0;
    } else if (result.entityType === 'cabin') {
      expiredCabinClaims += result.deletedCount || 0;
    }
  }

  // Crash recovery: released headers with pending/legacy cleanup that are due now.
  // Completed and future-deferred headers leave the eligible selector so batches advance.
  const eligibleFilter = releasedHeaderCleanupEligibleFilter(now);
  const releasedDue = await Model.find(eligibleFilter)
    .sort({ checkoutClaimCleanupNextAttemptAt: 1, leaseId: 1 })
    .limit(RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT)
    .lean();

  let releasedCleanupSelected = releasedDue.length;
  let releasedCleanupAttempted = 0;
  let releasedCleanupCompleted = 0;
  let releasedCleanupFailed = 0;
  let releasedCleanupDeferred = 0;
  let releasedCleanupAnnotationFailed = 0;
  const releasedCleanupFailedIdentities = [];
  const releasedCleanupAnnotationFailedIdentities = [];
  let releasedCleanupNextRetryAt = null;

  for (const header of releasedDue) {
    let reserved;
    try {
      reserved = await reserveReleasedHeaderCleanupAttempt(header, safeDeps);
    } catch (reserveErr) {
      releasedCleanupFailed += 1;
      releasedCleanupFailedIdentities.push({
        checkoutId: header.checkoutId,
        leaseId: header.leaseId,
        generation: header.generation,
        failureCode: safeCleanupFailureCode(reserveErr)
      });
      continue;
    }

    if (!reserved.won) {
      // Another worker reserved, or header left eligibility between select and CAS.
      releasedCleanupDeferred += 1;
      continue;
    }

    releasedCleanupAttempted += 1;
    const reservedNext = reserved.nextAttemptAt
      ? new Date(reserved.nextAttemptAt)
      : null;

    try {
      if (typeof safeDeps.onAfterCleanupAttemptReserved === 'function') {
        await safeDeps.onAfterCleanupAttemptReserved({
          header: reserved.header || header,
          leaseId: header.leaseId,
          checkoutId: header.checkoutId,
          generation: header.generation,
          attemptCount: reserved.attemptCount,
          nextAttemptAt: reserved.nextAttemptAt
        });
      }
      // Already reserved: private authority skips a second reservation.
      const cleanup = await finalizeReleasedHeaderClaimCleanup(
        reserved.header || header,
        privateReleasedCleanupArgs(safeDeps)
      );
      if (cleanup.skipped) {
        releasedCleanupDeferred += 1;
        continue;
      }
      releasedCleanupCompleted += 1;
      if (cleanup.entityType === 'unit') {
        expiredUnitClaims += cleanup.deletedCount || 0;
      } else if (cleanup.entityType === 'cabin') {
        expiredCabinClaims += cleanup.deletedCount || 0;
      }
    } catch (err) {
      releasedCleanupFailed += 1;
      const identity = {
        checkoutId: header.checkoutId,
        leaseId: header.leaseId,
        generation: header.generation,
        failureCode: safeCleanupFailureCode(err)
      };
      releasedCleanupFailedIdentities.push(identity);
      if (
        reservedNext &&
        (!releasedCleanupNextRetryAt || reservedNext.getTime() < releasedCleanupNextRetryAt.getTime())
      ) {
        releasedCleanupNextRetryAt = reservedNext;
      }
      try {
        const recorded = await recordReleasedHeaderCleanupFailure(
          reserved.header || header,
          err,
          safeDeps
        );
        identity.failureCode = recorded.failureCode;
      } catch (annotationErr) {
        releasedCleanupAnnotationFailed += 1;
        releasedCleanupAnnotationFailedIdentities.push({
          checkoutId: header.checkoutId,
          leaseId: header.leaseId,
          generation: header.generation,
          failureCode: safeCleanupFailureCode(annotationErr)
        });
        // Reservation already deferred nextAttemptAt — continue the batch.
      }
    }
  }

  const releasedCleanupEligibleRemaining = await Model.countDocuments(eligibleFilter);
  const releasedCleanupPendingTotal = await Model.countDocuments(
    releasedHeaderCleanupPendingFilter()
  );
  const releasedCleanupEligibleHasMore = releasedCleanupEligibleRemaining > 0;

  // Earliest future retry among still-pending deferred headers (for schedulers).
  if (!releasedCleanupNextRetryAt) {
    const nextDeferred = await Model.findOne({
      ...releasedHeaderCleanupPendingFilter(),
      checkoutClaimCleanupNextAttemptAt: { $gt: now }
    })
      .sort({ checkoutClaimCleanupNextAttemptAt: 1 })
      .select({ checkoutClaimCleanupNextAttemptAt: 1 })
      .lean();
    if (nextDeferred && nextDeferred.checkoutClaimCleanupNextAttemptAt) {
      releasedCleanupNextRetryAt = new Date(nextDeferred.checkoutClaimCleanupNextAttemptAt);
    }
  }

  return {
    expiredCount,
    expiredUnitClaims,
    expiredCabinClaims,
    skippedConverting,
    releasedCleanupSelected,
    releasedCleanupAttempted,
    releasedCleanupCompleted,
    releasedCleanupFailed,
    releasedCleanupDeferred,
    releasedCleanupAnnotationFailed,
    releasedCleanupFailedIdentities,
    /** @deprecated alias — prefer releasedCleanupFailedIdentities */
    failedCleanupIdentities: releasedCleanupFailedIdentities,
    releasedCleanupAnnotationFailedIdentities,
    releasedCleanupEligibleHasMore,
    /** @deprecated alias — eligible-now only (not deferred) */
    releasedCleanupHasMore: releasedCleanupEligibleHasMore,
    releasedCleanupPendingTotal,
    /** @deprecated alias — includes deferred pending work */
    releasedCleanupPending: releasedCleanupPendingTotal,
    releasedCleanupNextRetryAt,
    releasedCleanupBatchLimit: RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT
  };
}


// ---------------------------------------------------------------------------
// B8F4A — irreversible promotion / tombstone under durable paid authority
// ---------------------------------------------------------------------------

function getCheckoutSessionModel(deps = {}) {
  return deps.CheckoutSession || CheckoutSession;
}

function assertObjectIdString(value, fieldName) {
  if (value == null || value === '') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      `${fieldName} is required`,
      { field: fieldName }
    );
  }
  const s = String(value);
  if (!mongoose.Types.ObjectId.isValid(s)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      `${fieldName} is invalid`,
      { field: fieldName, value: s }
    );
  }
  return s;
}

function assertNonEmptyString(value, fieldName, code = 'ACCOMMODATION_PROMOTION_IDENTITY') {
  if (value == null || typeof value !== 'string' || !value.trim()) {
    throw new AccommodationCheckoutHoldError(code, `${fieldName} is required`, { field: fieldName });
  }
  return value.trim();
}

function assertPositiveGeneration(value, code = 'ACCOMMODATION_PROMOTION_IDENTITY') {
  const generation = Number(value);
  if (!Number.isInteger(generation) || generation < 1) {
    throw new AccommodationCheckoutHoldError(code, 'generation must be a positive integer', {
      generation: value
    });
  }
  return generation;
}

function snapshotRemainingDueCents(session) {
  const snap = session && session.quoteSnapshot && typeof session.quoteSnapshot === 'object'
    ? session.quoteSnapshot
    : null;
  if (snap && snap.remainingDueCents != null && Number.isFinite(Number(snap.remainingDueCents))) {
    return Number(snap.remainingDueCents);
  }
  if (session && session.stripeAmountCents != null) {
    return Number(session.stripeAmountCents);
  }
  return null;
}

function snapshotTotalCents(session) {
  const snap = session && session.quoteSnapshot && typeof session.quoteSnapshot === 'object'
    ? session.quoteSnapshot
    : null;
  if (snap && snap.totalCents != null && Number.isFinite(Number(snap.totalCents))) {
    return Number(snap.totalCents);
  }
  if (snap && snap.totalPrice != null && Number.isFinite(Number(snap.totalPrice))) {
    return Math.round(Number(snap.totalPrice) * 100);
  }
  return null;
}

function assertExactNonNegativeIntegerCents(value, fieldName) {
  if (value == null || value === '') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      `${fieldName} is required`,
      { field: fieldName }
    );
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        `${fieldName} must be an exact non-negative integer`,
        { field: fieldName, value }
      );
    }
    return value;
  }
  if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim())) {
    return Number(value.trim());
  }
  throw new AccommodationCheckoutHoldError(
    'ACCOMMODATION_PROMOTION_IDENTITY',
    `${fieldName} must be an exact non-negative integer`,
    { field: fieldName, value }
  );
}

function assertExactPositiveIntegerCents(value, fieldName) {
  const n = assertExactNonNegativeIntegerCents(value, fieldName);
  if (n <= 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      `${fieldName} must be a positive integer`,
      { field: fieldName, value }
    );
  }
  return n;
}

/**
 * Prove durable sealed full-voucher payment authority from CheckoutSession + redemption + ledger.
 */
async function proveFullVoucherPaidAuthority(session, resourceLease, checkoutId, deps = {}) {
  const RedemptionModel = deps.GiftVoucherRedemption || GiftVoucherRedemption;
  const VoucherModel = deps.GiftVoucher || GiftVoucher;

  const paymentStatus = String(session.paymentStatus || '');
  if (paymentStatus !== 'not_required') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires paymentStatus not_required',
      { checkoutId, paymentStatus }
    );
  }

  const snap =
    session.quoteSnapshot && typeof session.quoteSnapshot === 'object' ? session.quoteSnapshot : null;
  if (!snap) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires quoteSnapshot',
      { checkoutId }
    );
  }

  const totalCents = assertExactPositiveIntegerCents(snap.totalCents, 'quoteSnapshot.totalCents');
  const remainingDueCents = assertExactNonNegativeIntegerCents(
    snap.remainingDueCents,
    'quoteSnapshot.remainingDueCents'
  );
  const giftVoucherAppliedCents = assertExactPositiveIntegerCents(
    session.giftVoucherAppliedCents,
    'giftVoucherAppliedCents'
  );

  if (remainingDueCents !== 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires remainingDueCents === 0',
      { checkoutId, remainingDueCents }
    );
  }
  if (giftVoucherAppliedCents !== totalCents) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires giftVoucherAppliedCents === quoteSnapshot.totalCents',
      { checkoutId, giftVoucherAppliedCents, totalCents }
    );
  }

  if (session.stripeAmountCents == null) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires stripeAmountCents === 0',
      { checkoutId }
    );
  }
  const stripeAmount = assertExactNonNegativeIntegerCents(
    session.stripeAmountCents,
    'stripeAmountCents'
  );
  if (stripeAmount !== 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires stripeAmountCents === 0',
      { checkoutId, stripeAmountCents: stripeAmount }
    );
  }

  const sessionRedemptionId =
    session.voucherRedemptionId != null && String(session.voucherRedemptionId).trim()
      ? String(session.voucherRedemptionId).trim()
      : null;
  if (!sessionRedemptionId || !mongoose.Types.ObjectId.isValid(sessionRedemptionId)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Full-voucher promotion requires durable voucherRedemptionId',
      { checkoutId }
    );
  }
  const leaseRedemptionId =
    resourceLease.voucherRedemptionId != null && String(resourceLease.voucherRedemptionId).trim()
      ? String(resourceLease.voucherRedemptionId).trim()
      : null;
  if (!leaseRedemptionId || leaseRedemptionId !== sessionRedemptionId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Session voucherRedemptionId must match resourceLease.voucherRedemptionId',
      { checkoutId, sessionRedemptionId, leaseRedemptionId }
    );
  }

  const redemption = await RedemptionModel.findById(sessionRedemptionId).lean();
  if (!redemption) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Durable GiftVoucherRedemption is required',
      { checkoutId, voucherRedemptionId: sessionRedemptionId }
    );
  }
  if (String(redemption.checkoutId || '') !== checkoutId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption checkoutId does not match',
      { checkoutId, redemptionCheckoutId: redemption.checkoutId || null }
    );
  }
  if (Number(redemption.amountAppliedCents) !== totalCents) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption amount must equal quote total',
      {
        checkoutId,
        amountAppliedCents: redemption.amountAppliedCents,
        totalCents
      }
    );
  }
  if (String(redemption.currency || '') !== 'EUR') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption currency must be EUR',
      { checkoutId, currency: redemption.currency || null }
    );
  }

  const status = String(redemption.status || '');
  if (status !== 'reserved' && status !== 'confirmed') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption must be reserved (sealed) or confirmed',
      { checkoutId, status }
    );
  }
  if (hasAcquisitionMarker(redemption.acquisitionAttemptId)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption attempt markers must be clear after sealing',
      { checkoutId, status, acquisitionAttemptId: redemption.acquisitionAttemptId }
    );
  }

  const operationId =
    redemption.operationId != null && String(redemption.operationId).trim()
      ? String(redemption.operationId).trim()
      : null;
  if (!operationId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher redemption operationId is required',
      { checkoutId }
    );
  }
  const leaseOperationId =
    resourceLease.voucherOperationId != null && String(resourceLease.voucherOperationId).trim()
      ? String(resourceLease.voucherOperationId).trim()
      : null;
  if (!leaseOperationId || leaseOperationId !== operationId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.voucherOperationId must match redemption.operationId',
      { checkoutId, leaseOperationId, operationId }
    );
  }

  const voucher = await VoucherModel.findById(redemption.giftVoucherId).lean();
  if (!voucher) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Durable GiftVoucher is required for full-voucher proof',
      { checkoutId, giftVoucherId: redemption.giftVoucherId }
    );
  }
  const operation = findEmbeddedOperation(voucher, {
    operationId,
    redemptionId: sessionRedemptionId
  });
  if (!operation) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Durable ledger operation is required',
      { checkoutId, operationId, voucherRedemptionId: sessionRedemptionId }
    );
  }
  if (String(operation.state || '') === 'restored') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher ledger operation must not be restored',
      { checkoutId, operationId, state: operation.state }
    );
  }
  if (String(operation.state || '') === 'voided') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher ledger operation must not be voided',
      { checkoutId, operationId, state: operation.state }
    );
  }
  if (String(operation.state || '') !== 'debited') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher ledger operation must remain durably debited',
      { checkoutId, operationId, state: operation.state }
    );
  }
  if (Number(operation.amountCents) !== totalCents) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Ledger operation amount must equal quote total',
      { checkoutId, operationAmountCents: operation.amountCents, totalCents }
    );
  }
  if (String(operation.currency || '') !== 'EUR') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Ledger operation currency must be EUR',
      { checkoutId, currency: operation.currency || null }
    );
  }
  try {
    assertTokenlessDualUnmarked({ redemption, operation });
  } catch (err) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Voucher attempt markers must be clear after sealing',
      {
        checkoutId,
        cause: err?.message || String(err),
        reason: err?.details?.reason || err?.code || null
      }
    );
  }

  return {
    paymentMode: 'full_voucher',
    voucherRedemptionId: sessionRedemptionId,
    voucherOperationId: operationId,
    totalCents,
    giftVoucherAppliedCents,
    remainingDueCents
  };
}

/**
 * Load durable CheckoutSession and prove paid-finalization authority for promotion.
 */
async function loadDurablePaidFinalizationAuthority(input = {}, deps = {}) {
  const checkoutId = assertValidCheckoutId(input.checkoutId);
  const bookingId = assertObjectIdString(input.bookingId, 'bookingId');
  const leaseId = assertNonEmptyString(input.leaseId || input.holdId, 'leaseId');
  const generation = assertPositiveGeneration(input.generation);
  const attemptId = assertNonEmptyString(input.attemptId, 'attemptId');
  const quoteSnapshotHash = assertNonEmptyString(input.quoteSnapshotHash, 'quoteSnapshotHash');

  const SessionModel = getCheckoutSessionModel(deps);
  const session = await SessionModel.findOne({ checkoutId }).lean();
  if (!session) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Durable CheckoutSession is required for promotion',
      { checkoutId }
    );
  }
  if (String(session.finalizeStatus || '') !== 'in_progress') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'CheckoutSession finalizeStatus must be in_progress',
      { checkoutId, finalizeStatus: session.finalizeStatus }
    );
  }
  if (session.bookingId == null || String(session.bookingId) !== bookingId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'CheckoutSession bookingId must match the promotion target',
      {
        checkoutId,
        sessionBookingId: session.bookingId != null ? String(session.bookingId) : null,
        bookingId
      }
    );
  }
  if (String(session.quoteSnapshotHash || '') !== quoteSnapshotHash) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'quoteSnapshotHash does not match durable CheckoutSession',
      {
        checkoutId,
        expected: quoteSnapshotHash,
        actual: session.quoteSnapshotHash != null ? String(session.quoteSnapshotHash) : null
      }
    );
  }

  const rl = session.resourceLease;
  if (!rl || typeof rl !== 'object') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'CheckoutSession.resourceLease is required',
      { checkoutId }
    );
  }
  if (String(rl.status || '') !== 'paid') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.status must be paid',
      { checkoutId, resourceLeaseStatus: rl.status }
    );
  }
  if (Number(rl.generation) !== generation) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.generation does not match',
      { checkoutId, expected: generation, actual: rl.generation }
    );
  }
  if (String(rl.attemptId || '') !== attemptId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.attemptId does not match',
      { checkoutId, expected: attemptId, actual: rl.attemptId }
    );
  }
  if (String(rl.quoteSnapshotHash || '') !== quoteSnapshotHash) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.quoteSnapshotHash does not match',
      { checkoutId, expected: quoteSnapshotHash, actual: rl.quoteSnapshotHash }
    );
  }

  const acc = rl.accommodation;
  if (!acc || typeof acc !== 'object') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation is required',
      { checkoutId }
    );
  }
  const accLeaseId = String(acc.leaseId || acc.holdId || '').trim();
  if (accLeaseId !== leaseId) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation lease ID does not match',
      { checkoutId, expected: leaseId, actual: accLeaseId || null }
    );
  }
  if (acc.generation != null && Number(acc.generation) !== generation) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation.generation does not match',
      { checkoutId, expected: generation, actual: acc.generation }
    );
  }

  const stripeAmount = Number(session.stripeAmountCents || 0);
  const paymentStatus = String(session.paymentStatus || '');
  const canonicalPi =
    session.canonicalPaymentIntentId != null && String(session.canonicalPaymentIntentId).trim()
      ? String(session.canonicalPaymentIntentId).trim()
      : null;
  const leasePi =
    rl.paymentIntentId != null && String(rl.paymentIntentId).trim()
      ? String(rl.paymentIntentId).trim()
      : null;

  let paymentMode = null;
  if (stripeAmount > 0 || paymentStatus === 'paid' || canonicalPi || leasePi) {
    if (paymentStatus !== 'paid') {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Stripe-paid promotion requires paymentStatus paid',
        { checkoutId, paymentStatus }
      );
    }
    if (!canonicalPi || !leasePi || canonicalPi !== leasePi) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Stripe-paid promotion requires matching canonical and lease PaymentIntent IDs',
        { checkoutId, canonicalPaymentIntentId: canonicalPi, leasePaymentIntentId: leasePi }
      );
    }
    if (input.canonicalPaymentIntentId != null) {
      const expectedPi = assertNonEmptyString(input.canonicalPaymentIntentId, 'canonicalPaymentIntentId');
      if (expectedPi !== canonicalPi) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_IDENTITY',
          'Caller PaymentIntent does not match durable canonical PaymentIntent',
          { checkoutId, expected: expectedPi, actual: canonicalPi }
        );
      }
    }
    paymentMode = 'stripe';
  } else {
    const voucherProof = await proveFullVoucherPaidAuthority(session, rl, checkoutId, deps);
    paymentMode = voucherProof.paymentMode;
  }

  return {
    checkoutId,
    bookingId,
    leaseId,
    generation,
    attemptId,
    quoteSnapshotHash,
    session,
    resourceLease: rl,
    accommodation: acc,
    paymentMode,
    canonicalPaymentIntentId: canonicalPi
  };
}

function assertHeaderResourceIdentity(header, input, code = 'ACCOMMODATION_PROMOTION_IDENTITY') {
  if (header.entityType === 'unit') {
    if (!header.unitId || !header.cabinId) {
      throw new AccommodationCheckoutHoldError(code, 'Sealed unit lease is missing cabinId/unitId', {
        leaseId: header.leaseId
      });
    }
    if (input.unitId == null || String(input.unitId) !== String(header.unitId)) {
      throw new AccommodationCheckoutHoldError(code, 'Unit identity does not match sealed lease', {
        leaseId: header.leaseId,
        expectedUnitId: String(header.unitId),
        actualUnitId: input.unitId != null ? String(input.unitId) : null
      });
    }
    if (input.cabinId != null && String(input.cabinId) !== String(header.cabinId)) {
      throw new AccommodationCheckoutHoldError(code, 'Cabin identity does not match sealed unit lease', {
        leaseId: header.leaseId,
        expectedCabinId: String(header.cabinId),
        actualCabinId: String(input.cabinId)
      });
    }
    return { entityType: 'unit', unitId: String(header.unitId), cabinId: String(header.cabinId) };
  }

  if (header.entityType === 'cabin') {
    if (!header.cabinId) {
      throw new AccommodationCheckoutHoldError(code, 'Sealed cabin lease is missing cabinId', {
        leaseId: header.leaseId
      });
    }
    if (header.unitId != null) {
      throw new AccommodationCheckoutHoldError(code, 'Single-cabin lease must have unitId null', {
        leaseId: header.leaseId,
        unitId: String(header.unitId)
      });
    }
    if (input.cabinId == null || String(input.cabinId) !== String(header.cabinId)) {
      throw new AccommodationCheckoutHoldError(code, 'Cabin identity does not match sealed lease', {
        leaseId: header.leaseId,
        expectedCabinId: String(header.cabinId),
        actualCabinId: input.cabinId != null ? String(input.cabinId) : null
      });
    }
    if (input.unitId !== undefined && input.unitId !== null) {
      throw new AccommodationCheckoutHoldError(code, 'Single-cabin promotion requires unitId null', {
        leaseId: header.leaseId,
        unitId: String(input.unitId)
      });
    }
    return { entityType: 'cabin', unitId: null, cabinId: String(header.cabinId) };
  }

  throw new AccommodationCheckoutHoldError(code, 'Unsupported lease entityType', {
    leaseId: header.leaseId,
    entityType: header.entityType
  });
}

function assertSessionAccommodationMatchesHeader(authority, header, resource) {
  const acc = authority.accommodation;
  if (acc.entityType != null && String(acc.entityType) !== String(header.entityType)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation.entityType does not match header',
      { expected: header.entityType, actual: acc.entityType }
    );
  }
  if (acc.cabinId != null && String(acc.cabinId) !== String(header.cabinId)) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation.cabinId does not match header',
      { expected: String(header.cabinId), actual: String(acc.cabinId) }
    );
  }
  const accUnit = acc.unitId == null || acc.unitId === '' ? null : String(acc.unitId);
  const headerUnit = header.unitId == null ? null : String(header.unitId);
  if (accUnit !== headerUnit) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'resourceLease.accommodation.unitId does not match header',
      { expected: headerUnit, actual: accUnit }
    );
  }
  if (resource.entityType === 'unit' && String(resource.unitId) !== headerUnit) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Caller unit identity does not match durable accommodation',
      { expected: headerUnit, actual: resource.unitId }
    );
  }
}

function headerMatchesExactConversion(header, authority) {
  if (!header) return false;
  if (String(header.checkoutId) !== authority.checkoutId) return false;
  if (String(header.leaseId) !== authority.leaseId) return false;
  if (Number(header.generation) !== authority.generation) return false;
  if (String(header.conversionBookingId || '') !== authority.bookingId) return false;
  if (String(header.conversionAttemptId || '') !== authority.attemptId) return false;
  if (String(header.conversionQuoteSnapshotHash || '') !== authority.quoteSnapshotHash) {
    return false;
  }
  return true;
}

async function claimHeaderConverting(authority, input, deps = {}) {
  const stay = resolveStayDateOnlys(input.checkIn, input.checkOut);
  const Model = getLeaseModel(deps);
  const header = await Model.findOne({
    leaseId: authority.leaseId,
    checkoutId: authority.checkoutId
  }).lean();
  if (!header) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Accommodation lease header not found',
      { checkoutId: authority.checkoutId, leaseId: authority.leaseId }
    );
  }
  if (Number(header.generation) !== authority.generation) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Lease generation does not match',
      {
        expected: authority.generation,
        actual: Number(header.generation)
      }
    );
  }
  if (String(header.checkIn) !== stay.checkIn || String(header.checkOut) !== stay.checkOut) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Lease dates do not match',
      {
        expectedCheckIn: stay.checkIn,
        expectedCheckOut: stay.checkOut,
        actualCheckIn: header.checkIn,
        actualCheckOut: header.checkOut
      }
    );
  }

  const nightDates =
    header.entityType === 'unit'
      ? resolveUnitNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut })
      : resolveCabinNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut });
  if (Number(header.expectedNightCount) !== nightDates.length) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Lease expectedNightCount does not match stay nights',
      {
        expectedNightCount: Number(header.expectedNightCount),
        derivedNightCount: nightDates.length
      }
    );
  }

  const resource = assertHeaderResourceIdentity(header, input);
  assertSessionAccommodationMatchesHeader(authority, header, resource);

  if (header.status === 'converting' && header.isLive === true) {
    if (!headerMatchesExactConversion(header, authority)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_FOREIGN',
        'Lease header is converting for a different conversion identity',
        {
          leaseId: header.leaseId,
          conversionBookingId:
            header.conversionBookingId != null ? String(header.conversionBookingId) : null,
          expectedBookingId: authority.bookingId
        }
      );
    }
    return { header, stay, nightDates, resource, resumed: true };
  }

  if (header.status === 'converted') {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Lease header is already converted; use tombstone replay path',
      { leaseId: header.leaseId }
    );
  }

  if (header.status !== 'sealed' || header.isLive !== true) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_IDENTITY',
      'Accommodation lease header is not an active sealed hold',
      { leaseId: header.leaseId, status: header.status, isLive: header.isLive }
    );
  }
  if (header.activeAcquisitionId != null) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_LEASE_ACQUISITION_IN_PROGRESS',
      'Cannot promote while an acquisition fence is active',
      { leaseId: header.leaseId }
    );
  }

  const now = getNow(deps);
  const conversionStartedAt = now;
  const updated = await Model.findOneAndUpdate(
    {
      _id: header._id,
      checkoutId: authority.checkoutId,
      leaseId: authority.leaseId,
      generation: authority.generation,
      status: 'sealed',
      isLive: true,
      activeAcquisitionId: null,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      expectedNightCount: nightDates.length,
      entityType: header.entityType,
      ...(header.entityType === 'unit'
        ? { unitId: header.unitId, cabinId: header.cabinId }
        : { cabinId: header.cabinId, unitId: null })
    },
    {
      $set: {
        status: 'converting',
        isLive: true,
        conversionBookingId: new mongoose.Types.ObjectId(authority.bookingId),
        conversionAttemptId: authority.attemptId,
        conversionQuoteSnapshotHash: authority.quoteSnapshotHash,
        conversionStartedAt,
        convertedAt: null,
        conversionFailureCode: null
      }
    },
    { new: true }
  );

  if (!updated) {
    const again = await Model.findOne({
      leaseId: authority.leaseId,
      checkoutId: authority.checkoutId
    }).lean();
    if (again && again.status === 'converting' && headerMatchesExactConversion(again, authority)) {
      return {
        header: again,
        stay,
        nightDates,
        resource: assertHeaderResourceIdentity(again, input),
        resumed: true
      };
    }
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_PROMOTION_FOREIGN',
      'Failed to CAS lease header into converting; release/expiry or foreign conversion won',
      {
        leaseId: authority.leaseId,
        status: again && again.status,
        conversionBookingId:
          again && again.conversionBookingId != null ? String(again.conversionBookingId) : null
      }
    );
  }

  return {
    header: updated.toObject ? updated.toObject() : updated,
    stay,
    nightDates,
    resource,
    resumed: false
  };
}

/**
 * Promote exact checkout-owned night claims under durable paid finalization authority.
 * Two-stage preflight: sealed read-only preflight → converting CAS → protected preflight → mutate.
 * Promotion is irreversible.
 */
async function promoteAccommodationCheckoutHoldToBooking(input = {}, deps = {}) {
  try {
    if (Object.prototype.hasOwnProperty.call(input, 'allowExpiredPaidOverride')) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'allowExpiredPaidOverride is not accepted; durable paid CheckoutSession authority is required'
      );
    }
    if (input.resourceLeaseAuthority != null) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Caller resourceLeaseAuthority is not accepted; durable CheckoutSession authority is required'
      );
    }

    const authority = await loadDurablePaidFinalizationAuthority(input, deps);
    const Model = getLeaseModel(deps);
    const headerBefore = await Model.findOne({
      leaseId: authority.leaseId,
      checkoutId: authority.checkoutId
    }).lean();
    if (!headerBefore) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Accommodation lease header not found',
        { leaseId: authority.leaseId, checkoutId: authority.checkoutId }
      );
    }

    const stay = {
      checkIn: String(headerBefore.checkIn),
      checkOut: String(headerBefore.checkOut)
    };
    if (input.checkIn != null && String(input.checkIn).trim() !== stay.checkIn) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Caller checkIn does not match lease header',
        { expected: stay.checkIn, actual: input.checkIn }
      );
    }
    if (input.checkOut != null && String(input.checkOut).trim() !== stay.checkOut) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Caller checkOut does not match lease header',
        { expected: stay.checkOut, actual: input.checkOut }
      );
    }

    const nightDates =
      headerBefore.entityType === 'unit'
        ? resolveUnitNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut })
        : resolveCabinNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut });
    if (Number(headerBefore.expectedNightCount) !== nightDates.length) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Lease expectedNightCount does not match stay nights',
        {
          expectedNightCount: Number(headerBefore.expectedNightCount),
          derivedNightCount: nightDates.length
        }
      );
    }

    const resource = assertHeaderResourceIdentity(headerBefore, input);
    assertSessionAccommodationMatchesHeader(authority, headerBefore, resource);

    const preflightOpts = {
      checkoutId: authority.checkoutId,
      leaseId: authority.leaseId,
      bookingId: authority.bookingId,
      generation: authority.generation,
      attemptId: authority.attemptId,
      quoteSnapshotHash: authority.quoteSnapshotHash,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      unitId: resource.unitId,
      cabinId: resource.cabinId
    };

    const runPreflight = async () => {
      if (resource.entityType === 'unit') {
        return preflightUnitCheckoutClaimsForPromotion(preflightOpts);
      }
      return preflightCabinCheckoutClaimsForPromotion(preflightOpts);
    };

    let claimed;
    if (headerBefore.status === 'converting' && headerBefore.isLive === true) {
      if (!headerMatchesExactConversion(headerBefore, authority)) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_FOREIGN',
          'Lease header is converting for a different conversion identity',
          {
            leaseId: headerBefore.leaseId,
            conversionBookingId:
              headerBefore.conversionBookingId != null
                ? String(headerBefore.conversionBookingId)
                : null,
            expectedBookingId: authority.bookingId
          }
        );
      }
      claimed = {
        header: headerBefore,
        stay,
        nightDates,
        resource,
        resumed: true
      };
    } else if (headerBefore.status === 'converted') {
      // Idempotent promote replay after successful tombstone (crash before finalize succeed).
      // Never mutate and never rewind converted → converting.
      if (headerBefore.isLive !== false) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_IDENTITY',
          'Converted lease header must be non-live for idempotent promote replay',
          {
            leaseId: headerBefore.leaseId,
            status: headerBefore.status,
            isLive: headerBefore.isLive
          }
        );
      }

      let replayStay = stay;
      if (input.checkIn != null || input.checkOut != null) {
        replayStay = resolveStayDateOnlys(
          input.checkIn != null ? input.checkIn : headerBefore.checkIn,
          input.checkOut != null ? input.checkOut : headerBefore.checkOut
        );
        if (
          String(headerBefore.checkIn) !== replayStay.checkIn ||
          String(headerBefore.checkOut) !== replayStay.checkOut
        ) {
          throw new AccommodationCheckoutHoldError(
            'ACCOMMODATION_PROMOTION_IDENTITY',
            'Caller stay dates do not match converted lease header',
            {
              expectedCheckIn: headerBefore.checkIn,
              expectedCheckOut: headerBefore.checkOut,
              actualCheckIn: replayStay.checkIn,
              actualCheckOut: replayStay.checkOut
            }
          );
        }
      }

      if (
        !headerMatchesExactConversion(headerBefore, authority) ||
        String(headerBefore.checkoutId) !== authority.checkoutId ||
        String(headerBefore.leaseId) !== authority.leaseId ||
        Number(headerBefore.generation) !== Number(authority.generation) ||
        String(headerBefore.conversionAttemptId || '') !== authority.attemptId ||
        String(headerBefore.conversionQuoteSnapshotHash || '') !==
          authority.quoteSnapshotHash
      ) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_FOREIGN',
          'Converted lease header does not match paid finalization authority',
          {
            leaseId: headerBefore.leaseId,
            conversionBookingId:
              headerBefore.conversionBookingId != null
                ? String(headerBefore.conversionBookingId)
                : null,
            expectedBookingId: authority.bookingId
          }
        );
      }

      // Entity/unit/cabin identity already proven via assertHeaderResourceIdentity +
      // assertSessionAccommodationMatchesHeader above.

      const BookingModel = getBookingModel(deps);
      const booking = await BookingModel.findById(authority.bookingId).lean();
      if (!booking || String(booking._id) !== String(authority.bookingId)) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_IDENTITY',
          'Durable Booking with exact _id is required for converted-header promote replay',
          { bookingId: authority.bookingId }
        );
      }
      if (
        booking.checkoutId == null ||
        String(booking.checkoutId).trim() === '' ||
        String(booking.checkoutId) !== authority.checkoutId
      ) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_PROMOTION_IDENTITY',
          'Booking checkoutId does not match converted lease checkout',
          {
            bookingId: authority.bookingId,
            bookingCheckoutId:
              booking.checkoutId != null ? String(booking.checkoutId) : null,
            checkoutId: authority.checkoutId
          }
        );
      }

      let claimIds;
      try {
        claimIds = await assertPromotedClaimsOwnedByBooking({
          header: headerBefore,
          bookingId: authority.bookingId,
          stay: replayStay,
          authority
        });
      } catch (claimErr) {
        if (claimErr instanceof AccommodationCheckoutHoldError) {
          const code = String(claimErr.code || '');
          if (code === 'ACCOMMODATION_TOMBSTONE_INCOMPLETE') {
            throw new AccommodationCheckoutHoldError(
              'ACCOMMODATION_PROMOTION_INCOMPLETE',
              claimErr.message,
              claimErr.details
            );
          }
          if (
            code === 'ACCOMMODATION_TOMBSTONE_IDENTITY' ||
            code === 'ACCOMMODATION_TOMBSTONE_FOREIGN'
          ) {
            throw new AccommodationCheckoutHoldError(
              code.includes('FOREIGN')
                ? 'ACCOMMODATION_PROMOTION_FOREIGN'
                : 'ACCOMMODATION_PROMOTION_IDENTITY',
              claimErr.message,
              claimErr.details
            );
          }
        }
        throw claimErr;
      }

      return {
        ok: true,
        checkoutId: authority.checkoutId,
        leaseId: authority.leaseId,
        holdId: authority.leaseId,
        generation: authority.generation,
        attemptId: authority.attemptId,
        quoteSnapshotHash: authority.quoteSnapshotHash,
        bookingId: authority.bookingId,
        paymentMode: authority.paymentMode,
        canonicalPaymentIntentId: authority.canonicalPaymentIntentId,
        entityType: resource.entityType,
        unitId: resource.unitId,
        cabinId: resource.cabinId,
        checkIn: replayStay.checkIn,
        checkOut: replayStay.checkOut,
        expectedNightCount: nightDates.length,
        headerStatus: 'converted',
        headerIsLive: false,
        idempotentConvertedReplay: true,
        resumedHeader: false,
        promotedCount: 0,
        alreadyOwnedCount: claimIds.length,
        claimIds,
        claims: []
      };
    } else if (headerBefore.status !== 'sealed' || headerBefore.isLive !== true) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_PROMOTION_IDENTITY',
        'Accommodation lease header is not an active sealed hold',
        {
          leaseId: headerBefore.leaseId,
          status: headerBefore.status,
          isLive: headerBefore.isLive
        }
      );
    } else {
      // Stage 1: complete-set preflight while still sealed — do not CAS on failure.
      try {
        await runPreflight();
      } catch (preErr) {
        throw mapClaimError(preErr);
      }

      if (typeof deps.onAfterInitialPreflight === 'function') {
        await deps.onAfterInitialPreflight({
          header: headerBefore,
          checkoutId: authority.checkoutId,
          bookingId: authority.bookingId,
          leaseId: authority.leaseId
        });
      }

      claimed = await claimHeaderConverting(authority, input, deps);
    }

    const { header, stay: stay2, nightDates: nights2, resource: resource2 } = claimed;

    if (typeof deps.onAfterHeaderConverting === 'function') {
      await deps.onAfterHeaderConverting({
        header,
        checkoutId: authority.checkoutId,
        bookingId: authority.bookingId,
        leaseId: authority.leaseId
      });
    }

    // Stage 2: protected preflight under converting before first claim mutation.
    try {
      await runPreflight();
    } catch (preErr) {
      const failureCode =
        preErr && preErr.code ? String(preErr.code) : 'ACCOMMODATION_PROMOTION_PREFLIGHT';
      const failedAt = getNow(deps);
      await Model.updateOne(
        {
          leaseId: authority.leaseId,
          checkoutId: authority.checkoutId,
          status: 'converting',
          isLive: true,
          conversionBookingId: new mongoose.Types.ObjectId(authority.bookingId)
        },
        {
          $set: {
            conversionFailureCode: failureCode.slice(0, 200),
            conversionFailedAt: failedAt
          }
        }
      );
      throw mapClaimError(preErr);
    }

    const promoteOpts = {
      checkoutId: authority.checkoutId,
      leaseId: authority.leaseId,
      bookingId: authority.bookingId,
      generation: authority.generation,
      attemptId: authority.attemptId,
      quoteSnapshotHash: authority.quoteSnapshotHash,
      checkIn: stay2.checkIn,
      checkOut: stay2.checkOut,
      onAfterClaimPromoted: deps.onAfterClaimPromoted || null
    };

    const claimResult =
      resource2.entityType === 'unit'
        ? await promoteUnitCheckoutClaimsToBooking({
            ...promoteOpts,
            unitId: resource2.unitId
          })
        : await promoteCabinCheckoutClaimsToBooking({
            ...promoteOpts,
            cabinId: resource2.cabinId
          });

    const headerAfter = await Model.findOne({
      leaseId: authority.leaseId,
      checkoutId: authority.checkoutId
    }).lean();
    if (
      !headerAfter ||
      headerAfter.status !== 'converting' ||
      headerAfter.isLive !== true ||
      !headerMatchesExactConversion(headerAfter, authority)
    ) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_LEASE_INTEGRITY',
        'Lease header did not remain converting with exact conversion identity after claim promotion',
        {
          checkoutId: authority.checkoutId,
          leaseId: authority.leaseId,
          status: headerAfter && headerAfter.status
        }
      );
    }

    if (headerAfter.conversionFailureCode != null || headerAfter.conversionFailedAt != null) {
      await Model.updateOne(
        {
          leaseId: authority.leaseId,
          checkoutId: authority.checkoutId,
          status: 'converting',
          isLive: true
        },
        { $set: { conversionFailureCode: null, conversionFailedAt: null } }
      );
    }

    return {
      ok: true,
      checkoutId: authority.checkoutId,
      leaseId: authority.leaseId,
      holdId: authority.leaseId,
      generation: authority.generation,
      attemptId: authority.attemptId,
      quoteSnapshotHash: authority.quoteSnapshotHash,
      bookingId: authority.bookingId,
      paymentMode: authority.paymentMode,
      canonicalPaymentIntentId: authority.canonicalPaymentIntentId,
      entityType: resource2.entityType,
      unitId: resource2.unitId,
      cabinId: resource2.cabinId,
      checkIn: stay2.checkIn,
      checkOut: stay2.checkOut,
      expectedNightCount: nights2.length,
      headerStatus: 'converting',
      headerIsLive: true,
      resumedHeader: claimed.resumed === true,
      promotedCount: claimResult.promotedCount,
      alreadyOwnedCount: claimResult.alreadyOwnedCount,
      claimIds: claimResult.claimIds,
      claims: claimResult.claims
    };
  } catch (err) {
    if (err instanceof AccommodationCheckoutHoldError) throw err;
    throw mapClaimError(err);
  }
}

async function assertPromotedClaimsOwnedByBooking({
  header,
  bookingId,
  stay,
  authority
}) {
  const UnitNightClaim = require('../../models/UnitNightClaim');
  const CabinNightClaim = require('../../models/CabinNightClaim');
  const nightDates =
    header.entityType === 'unit'
      ? resolveUnitNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut })
      : resolveCabinNightDates({ checkIn: stay.checkIn, checkOut: stay.checkOut });

  const provenance = {
    checkoutId: authority.checkoutId,
    leaseId: authority.leaseId,
    generation: authority.generation,
    attemptId: authority.attemptId,
    quoteSnapshotHash: authority.quoteSnapshotHash
  };

  function matchesProvenance(row) {
    return (
      row &&
      row.ownerType !== 'checkout' &&
      String(row.bookingId) === String(bookingId) &&
      String(row.convertedFromCheckoutId || '') === provenance.checkoutId &&
      String(row.convertedFromLeaseId || '') === provenance.leaseId &&
      Number(row.convertedFromGeneration) === Number(provenance.generation) &&
      String(row.convertedFromAttemptId || '') === provenance.attemptId &&
      String(row.convertedFromQuoteSnapshotHash || '') === provenance.quoteSnapshotHash
    );
  }

  if (header.entityType === 'unit') {
    const rows = await UnitNightClaim.find({
      unitId: header.unitId,
      night: { $in: nightDates }
    }).lean();
    if (rows.length !== nightDates.length) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_INCOMPLETE',
        'Cannot tombstone: promoted unit-night set is incomplete',
        { leaseId: header.leaseId, expectedNightCount: nightDates.length, foundNightCount: rows.length }
      );
    }
    for (const row of rows) {
      if (!matchesProvenance(row)) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_TOMBSTONE_IDENTITY',
          'Cannot tombstone: unit-night lacks exact conversion provenance',
          {
            leaseId: header.leaseId,
            claimId: String(row._id),
            holderBookingId: row.bookingId != null ? String(row.bookingId) : null
          }
        );
      }
    }
    const extra = await UnitNightClaim.countDocuments({
      ownerType: 'checkout',
      checkoutId: provenance.checkoutId,
      leaseId: provenance.leaseId
    });
    if (extra > 0) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_INCOMPLETE',
        'Cannot tombstone: checkout-owned lease nights remain',
        { leaseId: header.leaseId, remaining: extra }
      );
    }
    return rows.map((r) => String(r._id));
  }

  const rows = await CabinNightClaim.find({
    cabinId: header.cabinId,
    night: { $in: nightDates }
  }).lean();
  if (rows.length !== nightDates.length) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_TOMBSTONE_INCOMPLETE',
      'Cannot tombstone: promoted cabin-night set is incomplete',
      { leaseId: header.leaseId, expectedNightCount: nightDates.length, foundNightCount: rows.length }
    );
  }
  for (const row of rows) {
    if (!matchesProvenance(row)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Cannot tombstone: cabin-night lacks exact conversion provenance',
        {
          leaseId: header.leaseId,
          claimId: String(row._id),
          holderBookingId: row.bookingId != null ? String(row.bookingId) : null
        }
      );
    }
  }
  const extra = await CabinNightClaim.countDocuments({
    ownerType: 'checkout',
    checkoutId: provenance.checkoutId,
    leaseId: provenance.leaseId
  });
  if (extra > 0) {
    throw new AccommodationCheckoutHoldError(
      'ACCOMMODATION_TOMBSTONE_INCOMPLETE',
      'Cannot tombstone: checkout-owned lease nights remain',
      { leaseId: header.leaseId, remaining: extra }
    );
  }
  return rows.map((r) => String(r._id));
}

/**
 * Tombstone converting header after durable Booking + complete claim promotion.
 * Does not mutate Booking-owned night claims.
 */
async function tombstonePromotedAccommodationCheckoutHold(input = {}, deps = {}) {
  try {
    const authority = await loadDurablePaidFinalizationAuthority(input, deps);
    const stay = resolveStayDateOnlys(input.checkIn, input.checkOut);
    const BookingModel = getBookingModel(deps);
    const booking = await BookingModel.findById(authority.bookingId).lean();
    if (!booking) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Durable Booking is required before lease-header tombstone',
        { bookingId: authority.bookingId }
      );
    }
    if (booking.checkoutId == null || String(booking.checkoutId).trim() === '') {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Booking checkoutId must be present and match the lease checkout',
        { bookingId: authority.bookingId }
      );
    }
    if (String(booking.checkoutId) !== authority.checkoutId) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Booking checkoutId does not match lease checkout',
        {
          bookingId: authority.bookingId,
          bookingCheckoutId: String(booking.checkoutId),
          checkoutId: authority.checkoutId
        }
      );
    }

    const Model = getLeaseModel(deps);
    const header = await Model.findOne({
      leaseId: authority.leaseId,
      checkoutId: authority.checkoutId
    }).lean();
    if (!header) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Accommodation lease header not found',
        { checkoutId: authority.checkoutId, leaseId: authority.leaseId }
      );
    }
    if (Number(header.generation) !== authority.generation) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Lease generation does not match',
        { expected: authority.generation, actual: Number(header.generation) }
      );
    }
    if (String(header.checkIn) !== stay.checkIn || String(header.checkOut) !== stay.checkOut) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Lease dates do not match',
        { checkoutId: authority.checkoutId, leaseId: authority.leaseId }
      );
    }
    assertHeaderResourceIdentity(header, input, 'ACCOMMODATION_TOMBSTONE_IDENTITY');

    if (header.status === 'converted' && header.isLive === false) {
      if (!headerMatchesExactConversion(header, authority)) {
        throw new AccommodationCheckoutHoldError(
          'ACCOMMODATION_TOMBSTONE_IDENTITY',
          'Converted header belongs to a different conversion identity',
          {
            leaseId: header.leaseId,
            conversionBookingId:
              header.conversionBookingId != null ? String(header.conversionBookingId) : null
          }
        );
      }
      const claimIds = await assertPromotedClaimsOwnedByBooking({
        header,
        bookingId: authority.bookingId,
        stay,
        authority
      });
      return {
        ok: true,
        idempotent: true,
        checkoutId: authority.checkoutId,
        leaseId: authority.leaseId,
        holdId: authority.leaseId,
        generation: authority.generation,
        attemptId: authority.attemptId,
        quoteSnapshotHash: authority.quoteSnapshotHash,
        bookingId: authority.bookingId,
        headerStatus: 'converted',
        headerIsLive: false,
        convertedAt: header.convertedAt ? new Date(header.convertedAt).toISOString() : null,
        claimIds
      };
    }

    if (header.status !== 'converting' || header.isLive !== true) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Lease header is not converting for tombstone',
        { checkoutId: authority.checkoutId, leaseId: authority.leaseId, status: header.status }
      );
    }
    if (!headerMatchesExactConversion(header, authority)) {
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Converting header identity does not match tombstone target',
        {
          leaseId: header.leaseId,
          conversionBookingId:
            header.conversionBookingId != null ? String(header.conversionBookingId) : null
        }
      );
    }

    const claimIds = await assertPromotedClaimsOwnedByBooking({
      header,
      bookingId: authority.bookingId,
      stay,
      authority
    });

    const convertedAt = getNow(deps);
    const updated = await Model.findOneAndUpdate(
      {
        _id: header._id,
        checkoutId: authority.checkoutId,
        leaseId: authority.leaseId,
        generation: authority.generation,
        status: 'converting',
        isLive: true,
        conversionBookingId: new mongoose.Types.ObjectId(authority.bookingId),
        conversionAttemptId: authority.attemptId,
        conversionQuoteSnapshotHash: authority.quoteSnapshotHash
      },
      {
        $set: {
          status: 'converted',
          isLive: false,
          convertedAt,
          activeAcquisitionId: null,
          acquisitionStartedAt: null
        }
      },
      { new: true }
    );

    if (!updated) {
      const again = await Model.findOne({
        leaseId: authority.leaseId,
        checkoutId: authority.checkoutId
      }).lean();
      if (
        again &&
        again.status === 'converted' &&
        again.isLive === false &&
        headerMatchesExactConversion(again, authority)
      ) {
        await assertPromotedClaimsOwnedByBooking({
          header: again,
          bookingId: authority.bookingId,
          stay,
          authority
        });
        return {
          ok: true,
          idempotent: true,
          checkoutId: authority.checkoutId,
          leaseId: authority.leaseId,
          holdId: authority.leaseId,
          generation: authority.generation,
          attemptId: authority.attemptId,
          quoteSnapshotHash: authority.quoteSnapshotHash,
          bookingId: authority.bookingId,
          headerStatus: 'converted',
          headerIsLive: false,
          convertedAt: again.convertedAt ? new Date(again.convertedAt).toISOString() : null,
          claimIds
        };
      }
      throw new AccommodationCheckoutHoldError(
        'ACCOMMODATION_TOMBSTONE_IDENTITY',
        'Failed to CAS lease header to converted',
        { checkoutId: authority.checkoutId, leaseId: authority.leaseId, status: again && again.status }
      );
    }

    const finalHeader = updated.toObject ? updated.toObject() : updated;
    const claimIdsAfter = await assertPromotedClaimsOwnedByBooking({
      header: finalHeader,
      bookingId: authority.bookingId,
      stay,
      authority
    });

    return {
      ok: true,
      idempotent: false,
      checkoutId: authority.checkoutId,
      leaseId: authority.leaseId,
      holdId: authority.leaseId,
      generation: authority.generation,
      attemptId: authority.attemptId,
      quoteSnapshotHash: authority.quoteSnapshotHash,
      bookingId: authority.bookingId,
      headerStatus: 'converted',
      headerIsLive: false,
      convertedAt: finalHeader.convertedAt
        ? new Date(finalHeader.convertedAt).toISOString()
        : convertedAt.toISOString(),
      claimIds: claimIdsAfter
    };
  } catch (err) {
    throw mapClaimError(err);
  }
}

async function ensureLeaseIndexesForTests(deps = {}) {
  const Model = getLeaseModel(deps);
  await Model.collection.createIndex({ leaseId: 1 }, { unique: true });
  await Model.collection.createIndex({ checkoutId: 1, generation: 1 }, { unique: true });
  await Model.collection.createIndex(
    { checkoutId: 1 },
    {
      unique: true,
      partialFilterExpression: { isLive: true },
      name: 'accommodationCheckoutLease_checkoutId_live_unique'
    }
  );
  await Model.collection.createIndex({ expiresAt: 1 });
  await Model.collection.createIndex({ conversionBookingId: 1 });
  await Model.collection.createIndex(
    {
      status: 1,
      isLive: 1,
      checkoutClaimCleanupStatus: 1,
      checkoutClaimCleanupNextAttemptAt: 1,
      leaseId: 1
    },
    { name: 'accommodationCheckoutLease_released_cleanup_v2' }
  );
}

module.exports = {
  DEFAULT_ACCOMMODATION_HOLD_TTL_MS,
  RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT,
  RELEASED_CLEANUP_RETRY_BASE_MS,
  RELEASED_CLEANUP_RETRY_MAX_MS,
  RELEASED_CLEANUP_RETRY_MAX_EXPONENT,
  AccommodationCheckoutHoldError,
  computeReleasedCleanupRetryDelayMs,
  releasedHeaderCleanupEligibleFilter,
  acquireAccommodationCheckoutHold,
  getActiveAccommodationCheckoutHold,
  assertAccommodationCheckoutHoldActive,
  releaseAccommodationCheckoutHold,
  expireAccommodationCheckoutHolds,
  proveFullVoucherPaidAuthority,
  promoteAccommodationCheckoutHoldToBooking,
  tombstonePromotedAccommodationCheckoutHold,
  ensureLeaseIndexesForTests
};
