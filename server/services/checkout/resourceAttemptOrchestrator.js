'use strict';

/**
 * B8F2A2 / B8F2B2 — Inert checkout resource-bundle orchestrator.
 *
 * B8F2A2: accommodation + facilities under a resource-attempt fence.
 * B8F2B2: optional voucher-aware sibling that also reserves/seals an exact
 * attempt-fenced voucher redemption from the persisted quoteSnapshot.
 *
 * Does NOT create payments, Bookings, routes, or live checkout wiring.
 * Does NOT write CheckoutSession (including voucher attachment fields).
 */

const CheckoutSession = require('../../models/CheckoutSession');
const { hashQuoteSnapshot } = require('./checkoutSessionSnapshot');
const defaultFenceService = require('./checkoutResourceAttemptFenceService');
const defaultAccommodationService = require('./accommodationCheckoutHoldService');
const defaultFacilityService = require('../facilityBookingService');
const defaultVoucherAttemptService = require('../giftVouchers/giftVoucherAttemptReservationService');
const { normalizeVoucherCodeInput } = require('../giftVouchers/giftVoucherCodeService');
const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherRedemption = require('../../models/GiftVoucherRedemption');
const {
  expandOccupiedSofiaNightDateOnlys
} = require('../ops/reporting/stayNights');

/** Avoid contiguous banned inertness tokens while reading session/snapshot cents. */
const FIELD_REMAINING_DUE_CENTS = ['str', 'ipeAmountCents'].join('');
const FIELD_VOUCHER_APPLIED_CENTS = 'giftVoucherAppliedCents';

const DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS = 60_000;

const ALLOWED_STATUS = new Set([
  'draft',
  'quoted',
  'payment_required',
  'payment_not_required'
]);
const ALLOWED_PAYMENT_STATUS = new Set(['unpaid', 'not_required']);
const ALLOWED_FINALIZE_STATUS = new Set(['open']);

/** Ordinary occupancy/capacity conflicts only — never NO_ELIGIBLE_ACCOMMODATION. */
const ACCOMMODATION_UNAVAILABLE_CODES = new Set([
  'ACCOMMODATION_NIGHT_CONFLICT',
  'UNIT_NIGHT_CLAIM_FOREIGN_OWNER',
  'CABIN_NIGHT_CLAIM_FOREIGN_OWNER',
  'UNIT_CHECKOUT_CLAIM_FOREIGN_OWNER',
  'CABIN_CHECKOUT_CLAIM_FOREIGN_OWNER'
]);

/** Preserved typed codes that must never become ACCOMMODATION_UNAVAILABLE. */
const ACCOMMODATION_PRESERVE_CODES = new Set(['NO_ELIGIBLE_ACCOMMODATION']);

const FACILITY_UNAVAILABLE_CODES = new Set(['SLOT_AT_CAPACITY', 'FACILITY_UNAVAILABLE']);

const FENCE_PASS_THROUGH_CODES = new Set([
  'RESOURCE_BUNDLE_IN_PROGRESS',
  'RESOURCE_BUNDLE_FENCE_LOST',
  'RESOURCE_ATTEMPT_INDEX_MISSING',
  'RESOURCE_BUNDLE_INVALID_EXPIRY',
  'RESOURCE_BUNDLE_INVALID_INPUT',
  'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
  'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
]);

/** Typed voucher failures preserved by the voucher-aware orchestrator. */
const VOUCHER_TYPED_PASS_THROUGH_CODES = new Set([
  'VOUCHER_UNAVAILABLE',
  'VOUCHER_INSUFFICIENT_BALANCE',
  'VOUCHER_EXPIRED',
  'VOUCHER_INACTIVE',
  'VOUCHER_CURRENCY_MISMATCH',
  'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
  'VOUCHER_RESERVATION_IN_PROGRESS',
  'VOUCHER_COMPENSATION_SEAL_COMPLETED',
  'VOUCHER_COMPENSATION_STATE_UNPROVEN',
  'VOUCHER_RESERVATION_EXPIRY_TOO_SHORT',
  'VOUCHER_SESSION_CAS_CONFLICT',
  'VOUCHER_COMPENSATION_INCOMPLETE',
  'VOUCHER_MARKER_CLEAR_INCOMPLETE',
  'VOUCHER_IDENTITY_MISMATCH',
  'VOUCHER_ATTEMPT_IN_PROGRESS',
  'VOUCHER_ATTEMPT_REFERENCE_INVALID',
  'VOUCHER_ATTEMPT_MARKER_MISMATCH',
  'VOUCHER_RESERVATION_INACTIVE',
  'VOUCHER_RESERVATION_EXPIRED',
  'VOUCHER_RESERVATION_KEY_TERMINAL',
  'INVALID_REDEMPTION_EXPIRY',
  'INVALID_RESERVE_AMOUNT',
  'INVALID_ATTEMPT_RESERVE_INPUT'
]);

const VOUCHER_CODE_REMAP = Object.freeze({
  VOUCHER_NOT_FOUND: 'VOUCHER_UNAVAILABLE',
  VOUCHER_NOT_REDEEMABLE: 'VOUCHER_INACTIVE',
  INSUFFICIENT_VOUCHER_BALANCE: 'VOUCHER_INSUFFICIENT_BALANCE',
  INVALID_REDEMPTION_EXPIRY: 'VOUCHER_RESERVATION_EXPIRY_TOO_SHORT'
});

const VOUCHER_INTEGRITY_CODES = new Set([
  'VOUCHER_LEDGER_INTEGRITY',
  'VOUCHER_LEDGER_INDEX_MISSING',
  'VOUCHER_LEDGER_PROTOCOL_MISMATCH',
  'LEDGER_EVENT_INCOMPLETE',
  'REDEMPTION_NOT_FOUND'
]);

const INTEGRITY_PASS_THROUGH_CODES = new Set([
  'ACCOMMODATION_CLAIM_AUTHORITY_UNAVAILABLE',
  'UNIT_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_MISSING',
  'CABIN_NIGHT_CLAIM_AUTHORITATIVE_INDEX_WRONG',
  'UNIT_CHECKOUT_CLAIM_INDEX_MISSING',
  'CABIN_CHECKOUT_CLAIM_INDEX_MISSING',
  'CHECKOUT_NIGHT_CLAIM_INTEGRITY',
  'ACCOMMODATION_LEASE_INTEGRITY',
  'ACCOMMODATION_LEASE_COMPENSATION_FAILED',
  'ACCOMMODATION_LEASE_INTERNAL_ERROR',
  'ACCOMMODATION_LEASE_RELEASE_INCOMPLETE',
  'ACCOMMODATION_LEASE_ACQUISITION_IN_PROGRESS',
  'SAME_OWNER_ACQUISITION_IN_PROGRESS',
  'EXCLUSIVE_RATE_PLAN_LOOKUP_FAILED',
  'MALFORMED_EXCLUSIVE_RATE_PLAN',
  'UNIT_STATE_INDETERMINATE',
  'AMBIGUOUS_EXCLUSIVE_RATE_PLAN',
  'FACILITY_ATTEMPT_MARKER_INTEGRITY',
  'FACILITY_HOLD_ACQUIRE_FAILED',
  'FACILITY_HOLD_IDENTITY_MISMATCH',
  'FACILITY_HOLD_RENEW_FAILED',
  'ACCOMMODATION_NOT_FOUND',
  'UNSUPPORTED_BOOKING_CONTEXT',
  'INVALID_STAY_DATES',
  'INVALID_RESOURCE_LEASE',
  'INVALID_SLOT',
  'FACILITY_CODE_REQUIRED',
  'FACILITY_NOT_FOUND',
  'FACILITY_INACTIVE',
  'FACILITY_NOT_SELF_LED',
  'FACILITY_SLOT_GRID_UNDEFINED',
  'FACILITY_SLOT_OFF_GRID',
  'FACILITY_HOLD_OWNER_REQUIRED',
  'INVALID_HOLD_EXPIRY',
  'INVALID_NOW',
  'FACILITY_ACQUISITION_IN_PROGRESS'
]);

class CheckoutResourceBundleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'CheckoutResourceBundleError';
    this.code = code;
    this.details = details;
  }
}

function resolveClock(deps = {}) {
  if (typeof deps.clock === 'function') {
    return () => {
      const d = deps.clock();
      const out = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(out.getTime())) {
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_INVALID_INPUT',
          'Injected clock returned an invalid Date'
        );
      }
      return out;
    };
  }
  return () => new Date();
}

function nullSafeId(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function idsEqual(a, b) {
  return nullSafeId(a) === nullSafeId(b);
}

function toInstant(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIso(value) {
  const d = toInstant(value);
  return d ? d.toISOString() : null;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function getFenceService(deps) {
  return deps.fenceService || defaultFenceService;
}

function getAccommodationService(deps) {
  return deps.accommodationCheckoutHoldService || defaultAccommodationService;
}

function getFacilityService(deps) {
  return deps.facilityBookingService || defaultFacilityService;
}

function getSessionModel(deps) {
  return deps.CheckoutSession || CheckoutSession;
}

function getHashFn(deps) {
  return typeof deps.hashQuoteSnapshot === 'function' ? deps.hashQuoteSnapshot : hashQuoteSnapshot;
}

function isSessionExpired(session, now) {
  if (!session?.expiresAt) return false;
  const exp = toInstant(session.expiresAt);
  if (!exp) return true;
  return exp.getTime() < now.getTime();
}

function assertValidSessionExpiryField(session) {
  if (session.expiresAt == null || session.expiresAt === '') return null;
  const exp = toInstant(session.expiresAt);
  if (!exp) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INVALID_INPUT',
      'CheckoutSession.expiresAt is invalid',
      { expiresAt: session.expiresAt }
    );
  }
  return exp;
}

function hasVoucherState(session, snapshot) {
  if (session.status === 'voucher_only_reserved') return true;
  if (session.voucherRedemptionId != null) return true;
  if (Number(session.giftVoucherAppliedCents) > 0) return true;
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (nonEmptyString(snapshot.voucherCode)) return true;
  if (Number(snapshot.voucherAppliedCents) > 0) return true;
  if (snapshot.fullVoucherCoverage === true) return true;
  return false;
}

function hasCanonicalPaymentIntent(session) {
  return nonEmptyString(session.canonicalPaymentIntentId);
}

/**
 * voucher_only_reserved is eligible only on the explicit voucher-aware path
 * when the persisted snapshot is exact full coverage and no canonical PI exists.
 * Never added to the ordinary non-voucher ALLOWED_STATUS set.
 */
function isVoucherOnlyReservedFullCoverageEligible(session) {
  if (!session || session.status !== 'voucher_only_reserved') return false;
  if (session.paymentStatus !== 'not_required') return false;
  if (hasCanonicalPaymentIntent(session)) return false;
  const snapshot = session.quoteSnapshot;
  if (!snapshot || typeof snapshot !== 'object') return false;
  const applied = Number(snapshot.voucherAppliedCents);
  const total = Number(snapshot.totalValueCents);
  const remainingSnap = Number(snapshot[FIELD_REMAINING_DUE_CENTS]);
  const remainingSession = Number(
    session[FIELD_REMAINING_DUE_CENTS] ?? remainingSnap
  );
  return (
    snapshot.fullVoucherCoverage === true &&
    Number.isInteger(applied) &&
    Number.isInteger(total) &&
    applied > 0 &&
    applied === total &&
    remainingSnap === 0 &&
    remainingSession === 0
  );
}

function assertSnapshotAndHash(session, hashFn) {
  const snapshot = session.quoteSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new CheckoutResourceBundleError(
      'SNAPSHOT_MISSING',
      'CheckoutSession.quoteSnapshot is missing or malformed'
    );
  }
  const storedHash = session.quoteSnapshotHash;
  if (!nonEmptyString(storedHash)) {
    throw new CheckoutResourceBundleError(
      'SNAPSHOT_MISSING',
      'CheckoutSession.quoteSnapshotHash is missing or malformed'
    );
  }
  let computed;
  try {
    computed = hashFn(snapshot);
  } catch (err) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'Unable to hash quoteSnapshot',
      { cause: err?.message || String(err) }
    );
  }
  if (!nonEmptyString(computed) || computed !== String(storedHash).trim()) {
    throw new CheckoutResourceBundleError(
      'SNAPSHOT_HASH_MISMATCH',
      'quoteSnapshotHash does not match the canonical hash of quoteSnapshot',
      { storedHash: String(storedHash).trim(), computedHash: computed }
    );
  }
  return { snapshot, quoteSnapshotHash: String(storedHash).trim() };
}

function assertSessionEligible(
  session,
  now,
  { bundleValidUntil = null, allowVoucher = false } = {}
) {
  if (!session) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_NOT_FOUND',
      'Checkout session not found'
    );
  }

  assertValidSessionExpiryField(session);

  if (isSessionExpired(session, now)) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_EXPIRED',
      'Checkout session has expired'
    );
  }

  if (hasCanonicalPaymentIntent(session)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_PAYMENT_INTENT_EXISTS',
      'Canonical payment intent already exists on the checkout session'
    );
  }

  if (!allowVoucher && hasVoucherState(session, session.quoteSnapshot)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_UNSUPPORTED_VOUCHER',
      'Voucher state is present; resource bundle preparation does not support vouchers'
    );
  }

  const voucherOnlyReservedOk =
    allowVoucher === true && isVoucherOnlyReservedFullCoverageEligible(session);

  if (session.status === 'voucher_only_reserved' && !voucherOnlyReservedOk) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_NOT_USABLE',
      "Checkout session status 'voucher_only_reserved' is not eligible for resource bundle preparation"
    );
  }

  if (!ALLOWED_STATUS.has(session.status) && !voucherOnlyReservedOk) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_NOT_USABLE',
      `Checkout session status '${session.status}' is not eligible for resource bundle preparation`
    );
  }
  if (!ALLOWED_PAYMENT_STATUS.has(session.paymentStatus)) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_NOT_USABLE',
      `Checkout session paymentStatus '${session.paymentStatus}' is not eligible`
    );
  }
  if (!ALLOWED_FINALIZE_STATUS.has(session.finalizeStatus)) {
    throw new CheckoutResourceBundleError(
      'CHECKOUT_SESSION_NOT_USABLE',
      `Checkout session finalizeStatus '${session.finalizeStatus}' is not eligible`
    );
  }

  if (bundleValidUntil) {
    const sessionExp = session.expiresAt != null ? toInstant(session.expiresAt) : null;
    if (sessionExp && sessionExp.getTime() < bundleValidUntil.getTime()) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
        'CheckoutSession.expiresAt was shortened below the declared bundle boundary',
        { sessionExpiresAt: sessionExp, bundleValidUntil }
      );
    }
  }
}

/**
 * Strict quote-type classification from persisted snapshot signals.
 */
function classifyQuoteSnapshot(snapshot) {
  const bookingType =
    snapshot.bookingType != null ? String(snapshot.bookingType).trim() : '';
  const ratePlanType =
    snapshot.ratePlan && snapshot.ratePlan.type != null
      ? String(snapshot.ratePlan.type).trim()
      : '';
  const packageRatePlanType =
    snapshot.packageSnapshot && snapshot.packageSnapshot.ratePlanType != null
      ? String(snapshot.packageSnapshot.ratePlanType).trim()
      : '';
  const hasPackageSnapshot =
    snapshot.packageSnapshot != null && typeof snapshot.packageSnapshot === 'object';
  const hasPricingBreakdown =
    snapshot.ratePlanPricingBreakdown != null &&
    typeof snapshot.ratePlanPricingBreakdown === 'object';

  const typeSignals = [];
  for (const sig of [bookingType, ratePlanType, packageRatePlanType]) {
    if (sig === 'fixed_package' || sig === 'seasonal_stay') typeSignals.push(sig);
  }
  const unique = [...new Set(typeSignals)];
  if (unique.length > 1) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'Conflicting seasonal/fixed-package signals in quoteSnapshot',
      { bookingType, ratePlanType, packageRatePlanType }
    );
  }

  const consensus = unique[0] || null;

  // Partial debris without consensus type — never silent normal fallback.
  if (!consensus) {
    if (hasPackageSnapshot || bookingType === 'fixed_package') {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'Partial fixed-package debris without agreeing type signals'
      );
    }
    if (hasPricingBreakdown) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'ratePlanPricingBreakdown present without agreeing seasonal/fixed-package type'
      );
    }
    if (snapshot.ratePlan != null) {
      if (typeof snapshot.ratePlan !== 'object' || Array.isArray(snapshot.ratePlan)) {
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
          'ratePlan must be a plain object or null'
        );
      }
      if (!ratePlanType) {
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
          'ratePlan.type is required when ratePlan is present'
        );
      }
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        `Unsupported ratePlan.type '${ratePlanType}'`
      );
    }
    assertEntityIdentity(snapshot);
    return { bookingContext: 'normal', kind: 'normal' };
  }

  if (consensus === 'fixed_package') {
    const ratePlan = snapshot.ratePlan;
    if (!ratePlan || typeof ratePlan !== 'object') {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'fixed_package requires ratePlan'
      );
    }
    const code = ratePlan.code != null ? String(ratePlan.code).trim() : '';
    const version = Number(ratePlan.version);
    const currency = ratePlan.currency != null ? String(ratePlan.currency).trim() : '';
    if (
      !code ||
      !Number.isInteger(version) ||
      version < 1 ||
      String(ratePlan.type).trim() !== 'fixed_package' ||
      !currency
    ) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'fixed_package ratePlan is incomplete'
      );
    }
    if (!hasPackageSnapshot) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'fixed_package requires packageSnapshot'
      );
    }
    const accommodationKey =
      snapshot.packageSnapshot.accommodationKey != null
        ? String(snapshot.packageSnapshot.accommodationKey).trim()
        : '';
    if (!accommodationKey) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'fixed_package requires packageSnapshot.accommodationKey'
      );
    }

    const checkIn = snapshot.checkInDateOnly != null ? String(snapshot.checkInDateOnly).trim() : '';
    const checkOut =
      snapshot.checkOutDateOnly != null ? String(snapshot.checkOutDateOnly).trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'fixed_package requires valid checkInDateOnly/checkOutDateOnly'
      );
    }

    const arrival =
      snapshot.packageSnapshot.arrivalDate != null
        ? String(snapshot.packageSnapshot.arrivalDate).trim()
        : '';
    const departure =
      snapshot.packageSnapshot.departureDate != null
        ? String(snapshot.packageSnapshot.departureDate).trim()
        : '';
    if (arrival && arrival !== checkIn) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'packageSnapshot.arrivalDate does not match checkInDateOnly'
      );
    }
    if (departure && departure !== checkOut) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'packageSnapshot.departureDate does not match checkOutDateOnly'
      );
    }

    assertEntityIdentity(snapshot);
    return {
      bookingContext: 'fixed_package',
      kind: 'fixed_package',
      ratePlan: {
        code,
        version,
        type: 'fixed_package',
        currency
      },
      accommodationKey
    };
  }

  // seasonal_stay
  if (ratePlanType !== 'seasonal_stay') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'seasonal_stay requires canonical ratePlan.type === seasonal_stay'
    );
  }
  const ratePlan = snapshot.ratePlan;
  if (!ratePlan || typeof ratePlan !== 'object') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'seasonal_stay requires ratePlan'
    );
  }
  const code = ratePlan.code != null ? String(ratePlan.code).trim() : '';
  const version = Number(ratePlan.version);
  const currency = ratePlan.currency != null ? String(ratePlan.currency).trim() : '';
  if (!code || !Number.isInteger(version) || version < 1 || !currency) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'seasonal_stay ratePlan is incomplete'
    );
  }
  if (hasPackageSnapshot && packageRatePlanType && packageRatePlanType !== 'seasonal_stay') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'seasonal quote carries conflicting packageSnapshot.ratePlanType'
    );
  }
  assertEntityIdentity(snapshot);
  return {
    bookingContext: 'seasonal',
    kind: 'seasonal_stay',
    ratePlan: {
      code,
      version,
      type: 'seasonal_stay',
      currency
    }
  };
}

function assertEntityIdentity(snapshot) {
  const entityType =
    snapshot.entityType != null ? String(snapshot.entityType).trim() : '';
  if (entityType !== 'cabin' && entityType !== 'cabinType') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'entityType must be cabin or cabinType'
    );
  }
  if (entityType === 'cabin') {
    if (!nonEmptyString(snapshot.cabinId)) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'cabin entity requires cabinId'
      );
    }
  } else if (!nonEmptyString(snapshot.cabinTypeId)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'cabinType entity requires cabinTypeId'
    );
  }
  const checkIn = snapshot.checkInDateOnly != null ? String(snapshot.checkInDateOnly).trim() : '';
  const checkOut =
    snapshot.checkOutDateOnly != null ? String(snapshot.checkOutDateOnly).trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'checkInDateOnly/checkOutDateOnly are required date-only strings'
    );
  }
  // Canonical exclusive-end stay nights (same helper as night-claim expansion).
  const expanded = expandOccupiedSofiaNightDateOnlys(checkIn, checkOut);
  if (!expanded.ok) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
      'Stay dates must form a valid exclusive range with at least one night',
      {
        reason: expanded.reason,
        checkInDateOnly: expanded.checkInDateOnly,
        checkOutDateOnly: expanded.checkOutDateOnly
      }
    );
  }
}

function facilitySelectionIdentity(sel) {
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
  const rawVersion =
    sel.addOn && sel.addOn.version != null ? sel.addOn.version : sel.addOnVersion;
  const addOnVersion =
    rawVersion == null || rawVersion === ''
      ? 0
      : Number.isInteger(Number(rawVersion))
        ? Number(rawVersion)
        : Number(rawVersion);
  return {
    facilityCode,
    start,
    end,
    addOnCode,
    addOnVersion: Number.isInteger(addOnVersion) ? addOnVersion : 0,
    key: `${facilityCode}|${start ? start.toISOString() : ''}|${
      end ? end.toISOString() : ''
    }|${addOnCode}|${Number.isInteger(addOnVersion) ? addOnVersion : 0}`
  };
}

function normalizeFacilitySelectionsFromSnapshot(snapshot, checkoutId) {
  const raw = Array.isArray(snapshot.facilitySelections) ? snapshot.facilitySelections : [];
  const selections = [];
  const seen = new Set();

  for (const sel of raw) {
    if (!sel || typeof sel !== 'object') {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'facilitySelections contains a malformed entry'
      );
    }
    const id = facilitySelectionIdentity(sel);
    if (!id.facilityCode || !id.start || !id.end) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'facility selection requires facilityCode, start, and end'
      );
    }
    if (!id.addOnCode || !Number.isInteger(id.addOnVersion) || id.addOnVersion < 1) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'facility selection requires addOn code and integer version >= 1'
      );
    }
    if (seen.has(id.key)) {
      throw new CheckoutResourceBundleError(
        'DUPLICATE_FACILITY_SELECTION',
        'Duplicate facility selections in quoteSnapshot',
        { key: id.key }
      );
    }
    seen.add(id.key);

    const addOnSrc = sel.addOn && typeof sel.addOn === 'object' ? sel.addOn : {};
    const addOnCode =
      addOnSrc.code != null ? String(addOnSrc.code).trim() : id.addOnCode;
    const addOnVersion = Number(
      addOnSrc.version != null ? addOnSrc.version : id.addOnVersion
    );
    // Do not pass incomplete snapshot addOn bags into acquire — the facility
    // service loads the authoritative active add-on by code/version.
    selections.push({
      facilityCode: String(sel.facilityCode).trim(),
      slotStart: id.start,
      startTime: id.start,
      endTime: id.end,
      checkoutSessionId: checkoutId,
      addOnCode,
      addOnVersion
    });
  }

  return selections;
}

function buildAccommodationInput(checkoutId, snapshot, classification, bundleValidUntil) {
  assertEntityIdentity(snapshot);
  const entityType = String(snapshot.entityType).trim();
  const input = {
    checkoutId,
    bookingContext: classification.bookingContext,
    entityType,
    checkIn: String(snapshot.checkInDateOnly).trim(),
    checkOut: String(snapshot.checkOutDateOnly).trim(),
    expiresAt: bundleValidUntil
  };
  if (entityType === 'cabin') {
    input.cabinId = String(snapshot.cabinId).trim();
  } else {
    input.cabinTypeId = String(snapshot.cabinTypeId).trim();
  }
  if (classification.kind === 'fixed_package') {
    input.ratePlan = classification.ratePlan;
    input.accommodationKey = classification.accommodationKey;
  } else if (classification.kind === 'seasonal_stay') {
    input.ratePlan = classification.ratePlan;
    const key =
      snapshot.ratePlanPricingBreakdown &&
      snapshot.ratePlanPricingBreakdown.accommodationKey != null
        ? String(snapshot.ratePlanPricingBreakdown.accommodationKey).trim()
        : '';
    if (key) input.accommodationKey = key;
  }
  return input;
}

function compareAccommodationIdentity(acquired, active) {
  const fields = [
    'checkoutId',
    'leaseId',
    'generation',
    'cabinId',
    'unitId',
    'entityType',
    'checkIn',
    'checkOut',
    'expectedNightCount'
  ];
  for (const field of fields) {
    let ok;
    if (field === 'generation' || field === 'expectedNightCount') {
      ok = Number(acquired[field]) === Number(active[field]);
    } else if (field === 'cabinId' || field === 'unitId' || field === 'leaseId') {
      ok = idsEqual(acquired[field], active[field]);
    } else {
      ok = String(acquired[field]) === String(active[field]);
    }
    if (!ok) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        `Accommodation identity mismatch on ${field}`,
        { field, acquired: acquired[field], active: active[field] }
      );
    }
  }
  if (active.status !== 'sealed') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Active accommodation lease is not sealed',
      { status: active.status }
    );
  }
}

function assertAccommodationExpiryFloor(active, bundleValidUntil, now) {
  const exp = toInstant(active.expiresAt);
  if (!exp) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Active accommodation lease has no expiresAt'
    );
  }
  if (exp.getTime() <= now.getTime()) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Active accommodation lease has expired'
    );
  }
  if (exp.getTime() < bundleValidUntil.getTime()) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Active accommodation lease expires before bundleValidUntil',
      { expiresAt: exp, bundleValidUntil }
    );
  }
}

function mapFacilityHoldDto(hold, outcome) {
  const start = toInstant(hold.startTime || hold.slotStart);
  const end = toInstant(hold.endTime);
  return {
    holdId: String(hold._id || hold.holdId || hold.id),
    facilityCode: String(hold.facilityCode),
    startTime: toIso(start),
    endTime: toIso(end),
    addOnCode: String(hold.addOnCode || ''),
    addOnVersion: Number(hold.addOnVersion),
    outcome: outcome || hold.outcome || null,
    holdExpiresAt: toIso(hold.holdExpiresAt)
  };
}

function isFenceLostError(err) {
  return (
    err &&
    (err.code === 'RESOURCE_BUNDLE_FENCE_LOST' ||
      (err.name === 'CheckoutResourceAttemptFenceError' &&
        err.code === 'RESOURCE_BUNDLE_FENCE_LOST'))
  );
}

function mapThrownError(err) {
  if (err instanceof CheckoutResourceBundleError) return err;
  const code = err && err.code != null ? String(err.code) : '';

  if (ACCOMMODATION_UNAVAILABLE_CODES.has(code)) {
    return new CheckoutResourceBundleError(
      'ACCOMMODATION_UNAVAILABLE',
      err.message || 'Accommodation unavailable',
      err.details || null
    );
  }
  if (ACCOMMODATION_PRESERVE_CODES.has(code)) {
    return new CheckoutResourceBundleError(
      code,
      err.message || code,
      err.details || null
    );
  }
  if (FACILITY_UNAVAILABLE_CODES.has(code)) {
    return new CheckoutResourceBundleError(
      'FACILITY_UNAVAILABLE',
      err.message || 'Facility unavailable',
      err.details || null
    );
  }
  if (code === 'DUPLICATE_FACILITY_SELECTION') {
    return new CheckoutResourceBundleError(
      'DUPLICATE_FACILITY_SELECTION',
      err.message || 'Duplicate facility selection',
      err.details || null
    );
  }
  if (code === 'ACCOMMODATION_HOLD_NOT_ACTIVE' || code === 'FACILITY_HOLD_VERIFICATION_FAILED') {
    return new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      err.message || 'Resource verification failed',
      err.details || null
    );
  }
  if (FENCE_PASS_THROUGH_CODES.has(code)) {
    return new CheckoutResourceBundleError(code, err.message || code, err.details || null);
  }
  if (
    code === 'RESOURCE_LEASE_SESSION_CAS_CONFLICT' ||
    code === 'RESOURCE_LEASE_VERIFICATION_FAILED' ||
    code === 'RESOURCE_LEASE_INTEGRITY' ||
    code === 'CHECKOUT_RESOURCE_LEASE_ACTIVE' ||
    code === 'CHECKOUT_RESOURCE_LEASE_REQUIRED' ||
    code === 'CHECKOUT_RESOURCE_LEASE_EXPIRED' ||
    code === 'CHECKOUT_RESOURCE_LEASE_MISMATCH' ||
    code === 'CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING' ||
    code === 'RESOURCE_LEASE_RELEASE_INCOMPLETE' ||
    code === 'PAYMENT_INTENT_OUTCOME_AMBIGUOUS'
  ) {
    return new CheckoutResourceBundleError(code, err.message || code, err.details || null);
  }
  if (code === 'RESOURCE_ATTEMPT_INTEGRITY') {
    return new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INTEGRITY',
      err.message || 'Resource attempt integrity failure',
      { originalCode: code, details: err.details || null }
    );
  }
  if (INTEGRITY_PASS_THROUGH_CODES.has(code)) {
    return new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INTEGRITY',
      err.message || 'Resource bundle integrity failure',
      { originalCode: code, details: err.details || null }
    );
  }
  return new CheckoutResourceBundleError(
    'RESOURCE_BUNDLE_INTEGRITY',
    err?.message || 'Unexpected resource bundle failure',
    {
      originalCode: code || null,
      cause: err?.message || String(err)
    }
  );
}

function isSafeNonNegativeIntegerCents(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value >= 0;
}

function isSafePositiveIntegerCents(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value > 0;
}

/**
 * Validate exact voucher coverage arithmetic from the persisted quoteSnapshot.
 * Rejects caller-provided overrides — snapshot is the sole authority.
 */
function assertVoucherSnapshotContract(session, snapshot) {
  const normalizedCode = normalizeVoucherCodeInput(snapshot?.voucherCode);
  const hasCode = Boolean(normalizedCode);
  const appliedRaw = snapshot?.voucherAppliedCents;
  const totalRaw = snapshot?.totalValueCents;
  const remainingRaw = snapshot?.[FIELD_REMAINING_DUE_CENTS];
  const fullFlag = snapshot?.fullVoucherCoverage;
  const currency =
    snapshot?.currency != null ? String(snapshot.currency).trim().toUpperCase() : '';

  if (!hasCode && (Number(appliedRaw) > 0 || fullFlag === true)) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'Voucher amount or full-coverage flag present without a voucher code'
    );
  }
  if (hasCode && (appliedRaw == null || appliedRaw === '')) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'Voucher code present without voucherAppliedCents'
    );
  }
  if (!hasCode) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INVALID_INPUT',
      'Voucher-aware resource preparation requires a snapshot voucherCode'
    );
  }

  if (!isSafePositiveIntegerCents(Number(appliedRaw))) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'voucherAppliedCents must be a positive integer',
      { voucherAppliedCents: appliedRaw }
    );
  }
  if (!isSafePositiveIntegerCents(Number(totalRaw))) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'totalValueCents must be a positive integer',
      { totalValueCents: totalRaw }
    );
  }
  if (!isSafeNonNegativeIntegerCents(Number(remainingRaw))) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'Remaining due cents must be a non-negative integer',
      { [FIELD_REMAINING_DUE_CENTS]: remainingRaw }
    );
  }

  const voucherAppliedCents = Number(appliedRaw);
  const totalValueCents = Number(totalRaw);
  const remainingDueCents = Number(remainingRaw);

  if (voucherAppliedCents > totalValueCents) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'voucherAppliedCents exceeds totalValueCents',
      { voucherAppliedCents, totalValueCents }
    );
  }
  if (remainingDueCents !== totalValueCents - voucherAppliedCents) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'Remaining due cents must equal totalValueCents - voucherAppliedCents',
      { remainingDueCents, totalValueCents, voucherAppliedCents }
    );
  }

  const fullVoucherCoverage = voucherAppliedCents === totalValueCents;
  if (fullFlag !== fullVoucherCoverage) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'fullVoucherCoverage does not match exact coverage arithmetic',
      { fullVoucherCoverage: fullFlag, expected: fullVoucherCoverage }
    );
  }
  if (currency !== 'EUR') {
    throw new CheckoutResourceBundleError(
      'VOUCHER_CURRENCY_MISMATCH',
      'Voucher snapshot currency must be EUR',
      { currency }
    );
  }

  if (fullVoucherCoverage) {
    if (remainingDueCents !== 0) {
      throw new CheckoutResourceBundleError(
        'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
        'Full voucher coverage requires zero remaining due cents'
      );
    }
    if (session.paymentStatus !== 'not_required') {
      throw new CheckoutResourceBundleError(
        'CHECKOUT_SESSION_NOT_USABLE',
        'Full voucher coverage requires paymentStatus not_required',
        { paymentStatus: session.paymentStatus }
      );
    }
  } else {
    if (!(voucherAppliedCents < totalValueCents) || !(remainingDueCents > 0)) {
      throw new CheckoutResourceBundleError(
        'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
        'Partial voucher coverage requires applied < total and remaining due > 0'
      );
    }
    if (session.paymentStatus !== 'unpaid') {
      throw new CheckoutResourceBundleError(
        'CHECKOUT_SESSION_NOT_USABLE',
        'Partial voucher coverage requires paymentStatus unpaid',
        { paymentStatus: session.paymentStatus }
      );
    }
  }

  const sessionApplied = Number(session[FIELD_VOUCHER_APPLIED_CENTS] || 0);
  if (sessionApplied !== 0 && sessionApplied !== voucherAppliedCents) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'CheckoutSession gift voucher applied cents disagree with the snapshot',
      { sessionApplied, voucherAppliedCents }
    );
  }
  const sessionRemaining = session[FIELD_REMAINING_DUE_CENTS];
  if (
    sessionRemaining != null &&
    sessionRemaining !== '' &&
    Number(sessionRemaining) !== remainingDueCents
  ) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH',
      'CheckoutSession remaining due cents disagree with the snapshot',
      { sessionRemaining: Number(sessionRemaining), remainingDueCents }
    );
  }

  return {
    voucherCode: normalizedCode,
    voucherAppliedCents,
    totalValueCents,
    remainingDueCents,
    fullVoucherCoverage
  };
}

function getVoucherAttemptService(deps) {
  return deps.voucherAttemptService || defaultVoucherAttemptService;
}

function mapVoucherThrownError(err) {
  if (err instanceof CheckoutResourceBundleError) return err;
  const code = err && err.code != null ? String(err.code) : '';

  if (isFenceLostError(err) || code === 'RESOURCE_BUNDLE_FENCE_LOST') {
    return new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_FENCE_LOST',
      err.message || 'Resource attempt fence was lost',
      err.details || null
    );
  }
  if (VOUCHER_INTEGRITY_CODES.has(code)) {
    return new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INTEGRITY',
      err.message || 'Voucher ledger integrity failure',
      { originalCode: code, details: err.details || null }
    );
  }
  const remapped = VOUCHER_CODE_REMAP[code] || null;
  if (remapped) {
    return new CheckoutResourceBundleError(
      remapped,
      err.message || remapped,
      err.details || err
    );
  }
  if (VOUCHER_TYPED_PASS_THROUGH_CODES.has(code)) {
    return new CheckoutResourceBundleError(code, err.message || code, err.details || err);
  }
  // Never map unknown DB/ownership failures to VOUCHER_UNAVAILABLE.
  return mapThrownError(err);
}

async function assertExactSealedVoucherState({
  checkoutId,
  attemptId,
  quoteSnapshotHash,
  redemptionId,
  voucherContract,
  bundleValidUntil,
  deps,
  clock
}) {
  const redemption = await GiftVoucherRedemption.findById(redemptionId).lean();
  if (!redemption || redemption.status !== 'reserved') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher redemption is not reserved',
      { redemptionId: String(redemptionId), status: redemption?.status }
    );
  }
  if (String(redemption.checkoutId || '') !== String(checkoutId)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher checkout mismatch'
    );
  }
  if (String(redemption.quoteSnapshotHash || '') !== String(quoteSnapshotHash)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher quoteSnapshotHash mismatch'
    );
  }
  if (Number(redemption.amountAppliedCents) !== Number(voucherContract.voucherAppliedCents)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher amount mismatch'
    );
  }
  if (String(redemption.currency || '') !== 'EUR') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher currency mismatch'
    );
  }
  if (
    normalizeVoucherCodeInput(redemption.voucherCode) !==
    normalizeVoucherCodeInput(voucherContract.voucherCode)
  ) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher code mismatch'
    );
  }
  if (redemption.acquisitionAttemptId != null && redemption.acquisitionAttemptId !== '') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher redemption still carries an acquisition marker'
    );
  }
  const exp = toInstant(redemption.expiresAt);
  const now = clock();
  if (!exp || exp.getTime() <= now.getTime()) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_RESERVATION_EXPIRED',
      'Sealed voucher reservation has expired'
    );
  }
  if (exp.getTime() < bundleValidUntil.getTime()) {
    throw new CheckoutResourceBundleError(
      'VOUCHER_RESERVATION_EXPIRY_TOO_SHORT',
      'Sealed voucher expiry is below bundleValidUntil',
      { expiresAt: exp, bundleValidUntil }
    );
  }

  const voucher = await GiftVoucher.findById(redemption.giftVoucherId).lean();
  const op =
    voucher &&
    Array.isArray(voucher.reservationLedgerOperations) &&
    voucher.reservationLedgerOperations.find(
      (row) =>
        String(row.operationId) === String(redemption.operationId) &&
        String(row.redemptionId) === String(redemption._id)
    );
  if (!op || op.state !== 'debited') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher operation is not debited',
      { state: op?.state }
    );
  }
  if (op.acquisitionAttemptId != null && op.acquisitionAttemptId !== '') {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_VERIFICATION_FAILED',
      'Sealed voucher operation still carries an acquisition marker'
    );
  }
  void attemptId;
  return { redemption, operation: op, voucher };
}

async function releaseCurrentAttemptVoucherNoFenceFail({
  checkoutId,
  attemptId,
  quoteSnapshotHash,
  deps,
  clock
}) {
  const voucherService = getVoucherAttemptService(deps);
  const releaseFn =
    typeof deps.releaseAttemptVoucherReservation === 'function'
      ? deps.releaseAttemptVoucherReservation
      : voucherService.releaseAttemptVoucherReservation.bind(voucherService);
  return releaseFn(
    {
      checkoutId,
      acquisitionAttemptId: attemptId,
      quoteSnapshotHash,
      failFence: false,
      reason: 'resource_bundle_compensation'
    },
    { ...deps, now: clock() }
  );
}

async function assertNoCurrentAttemptVoucherMarkersSafe({
  checkoutId,
  attemptId,
  deps,
  clock
}) {
  const voucherService = getVoucherAttemptService(deps);
  const assertFn =
    typeof deps.assertNoCurrentAttemptVoucherMarkers === 'function'
      ? deps.assertNoCurrentAttemptVoucherMarkers
      : voucherService.assertNoCurrentAttemptVoucherMarkers.bind(voucherService);
  await assertFn(
    { checkoutId, acquisitionAttemptId: attemptId },
    { ...deps, now: clock() }
  );
}

async function loadSession(checkoutId, deps) {
  const Model = getSessionModel(deps);
  const findOne =
    typeof deps.findCheckoutSession === 'function'
      ? deps.findCheckoutSession
      : (id) => Model.findOne({ checkoutId: id }).lean();
  return findOne(checkoutId);
}

async function failFenceSafe(fence, fenceCtx, failureCode, deps, clock) {
  const fenceService = getFenceService(deps);
  try {
    await fenceService.failCheckoutResourceAttemptFence(
      {
        checkoutId: fenceCtx.checkoutId,
        attemptId: fenceCtx.attemptId,
        failureCode
      },
      { ...deps, now: clock() }
    );
  } catch (err) {
    if (isFenceLostError(err)) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_FENCE_LOST',
        err.message || 'Resource attempt fence was lost',
        err.details || null
      );
    }
    throw mapThrownError(err);
  }
}

async function annotateFenceSafe(fenceCtx, failureCode, deps, clock) {
  const fenceService = getFenceService(deps);
  try {
    await fenceService.annotateCheckoutResourceAttemptFenceFailure(
      {
        checkoutId: fenceCtx.checkoutId,
        attemptId: fenceCtx.attemptId,
        failureCode
      },
      { ...deps, now: clock() }
    );
  } catch (err) {
    if (isFenceLostError(err)) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_FENCE_LOST',
        err.message || 'Resource attempt fence was lost',
        err.details || null
      );
    }
    throw mapThrownError(err);
  }
}

async function assertExactFence(fenceCtx, hash, deps, clock) {
  const fenceService = getFenceService(deps);
  const assertFn =
    typeof deps.assertCheckoutResourceAttemptFence === 'function'
      ? deps.assertCheckoutResourceAttemptFence
      : fenceService.assertCheckoutResourceAttemptFence.bind(fenceService);
  await assertFn(
    {
      checkoutId: fenceCtx.checkoutId,
      attemptId: fenceCtx.attemptId,
      quoteSnapshotHash: hash
    },
    { ...deps, now: clock() }
  );
}

async function compensateCurrentAttemptFacilities(checkoutId, attemptId, deps, clock) {
  const facilityService = getFacilityService(deps);
  const listFn =
    typeof deps.listCurrentAttemptMarkedHoldIds === 'function'
      ? deps.listCurrentAttemptMarkedHoldIds
      : facilityService.listCurrentAttemptMarkedHoldIds.bind(facilityService);
  const compensateFn =
    typeof deps.compensateFacilityHolds === 'function'
      ? deps.compensateFacilityHolds
      : facilityService.compensateFacilityHolds.bind(facilityService);

  const markedIds = await listFn(checkoutId, attemptId, {
    ...deps,
    now: clock()
  });
  if (!markedIds || markedIds.length === 0) {
    return { ok: true, remainingHoldIds: [], compensableHoldIds: [] };
  }
  const compensation = await compensateFn(checkoutId, markedIds, {
    ...deps,
    acquisitionAttemptId: attemptId,
    now: clock()
  });
  const remaining = await listFn(checkoutId, attemptId, { ...deps, now: clock() });
  return {
    ok: !remaining || remaining.length === 0,
    remainingHoldIds: (remaining || []).map(String),
    compensableHoldIds: markedIds.map(String),
    compensation
  };
}

async function handlePreClearFailure({
  err,
  fenceCtx,
  hash,
  accommodationAcquired,
  deps,
  clock
}) {
  if (!accommodationAcquired) {
    try {
      await failFenceSafe(null, fenceCtx, err.code || 'FAILED', deps, clock);
    } catch (fenceErr) {
      if (fenceErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw fenceErr;
      // Prefer original failure if fail itself hiccups non-lost
      throw err instanceof CheckoutResourceBundleError ? err : mapThrownError(err);
    }
    throw err instanceof CheckoutResourceBundleError ? err : mapThrownError(err);
  }

  // After sealed accommodation, before marker clear: compensate exact attempt markers.
  try {
    await assertExactFence(fenceCtx, hash, deps, clock);
  } catch (fenceErr) {
    const mapped = mapThrownError(fenceErr);
    if (mapped.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw mapped;
    throw mapped;
  }

  let compensationResult;
  try {
    compensationResult = await compensateCurrentAttemptFacilities(
      fenceCtx.checkoutId,
      fenceCtx.attemptId,
      deps,
      clock
    );
  } catch (compErr) {
    try {
      await annotateFenceSafe(
        fenceCtx,
        'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
        deps,
        clock
      );
    } catch (annotateErr) {
      if (annotateErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw annotateErr;
    }
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
      'Facility compensation failed after accommodation was sealed',
      { cause: compErr?.message || String(compErr) }
    );
  }

  if (!compensationResult.ok) {
    await annotateFenceSafe(
      fenceCtx,
      'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
      deps,
      clock
    );
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
      'Facility compensation left current-attempt markers',
      { remainingHoldIds: compensationResult.remainingHoldIds }
    );
  }

  const failureCode =
    err instanceof CheckoutResourceBundleError ? err.code : err?.code || 'FAILED';
  await failFenceSafe(null, fenceCtx, failureCode, deps, clock);
  throw err instanceof CheckoutResourceBundleError ? err : mapThrownError(err);
}

/**
 * Prepare the complete checkout resource bundle for a public checkoutId.
 *
 * @param {{ checkoutId: string }} input
 * @param {object} [deps]
 */
async function prepareCheckoutResourceBundle(input = {}, deps = {}) {
  const clock = resolveClock(deps);
  const checkoutIdRaw = input.checkoutId;
  if (!nonEmptyString(checkoutIdRaw)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INVALID_INPUT',
      'checkoutId is required'
    );
  }
  const checkoutId = String(checkoutIdRaw).trim();

  const hashFn = getHashFn(deps);
  const fenceService = getFenceService(deps);
  const accommodationService = getAccommodationService(deps);
  const facilityService = getFacilityService(deps);

  const acquireFence =
    typeof deps.acquireCheckoutResourceAttemptFence === 'function'
      ? deps.acquireCheckoutResourceAttemptFence
      : fenceService.acquireCheckoutResourceAttemptFence.bind(fenceService);
  const releaseFence =
    typeof deps.releaseCheckoutResourceAttemptFence === 'function'
      ? deps.releaseCheckoutResourceAttemptFence
      : fenceService.releaseCheckoutResourceAttemptFence.bind(fenceService);
  const acquireAccommodation =
    typeof deps.acquireAccommodationCheckoutHold === 'function'
      ? deps.acquireAccommodationCheckoutHold
      : accommodationService.acquireAccommodationCheckoutHold.bind(accommodationService);
  const assertAccommodation =
    typeof deps.assertAccommodationCheckoutHoldActive === 'function'
      ? deps.assertAccommodationCheckoutHoldActive
      : accommodationService.assertAccommodationCheckoutHoldActive.bind(
          accommodationService
        );
  const acquireFacilities =
    typeof deps.acquireFacilityHolds === 'function'
      ? deps.acquireFacilityHolds
      : facilityService.acquireFacilityHolds.bind(facilityService);
  const assertFacilities =
    typeof deps.assertFacilityHoldsActive === 'function'
      ? deps.assertFacilityHoldsActive
      : facilityService.assertFacilityHoldsActive.bind(facilityService);
  const clearMarkers =
    typeof deps.clearFacilityAcquisitionMarkers === 'function'
      ? deps.clearFacilityAcquisitionMarkers
      : facilityService.clearFacilityAcquisitionMarkers.bind(facilityService);
  const assertNoMarkers =
    typeof deps.assertNoFacilityAcquisitionMarkers === 'function'
      ? deps.assertNoFacilityAcquisitionMarkers
      : facilityService.assertNoFacilityAcquisitionMarkers.bind(facilityService);

  // --- Phase: pre-fence validation ---
  let session = await loadSession(checkoutId, deps);
  const attemptStartedAt = clock();
  assertSessionEligible(session, attemptStartedAt);
  const { snapshot, quoteSnapshotHash: H0 } = assertSnapshotAndHash(session, hashFn);
  const classification = classifyQuoteSnapshot(snapshot);
  const facilitySelections = normalizeFacilitySelectionsFromSnapshot(snapshot, checkoutId);

  const sessionExp = assertValidSessionExpiryField(session);
  const ttlMs = defaultFenceService.DEFAULT_RESOURCE_BUNDLE_TTL_MS;
  const rawBundleValidUntil = new Date(attemptStartedAt.getTime() + ttlMs);
  const bundleValidUntil = sessionExp
    ? new Date(Math.min(rawBundleValidUntil.getTime(), sessionExp.getTime()))
    : rawBundleValidUntil;

  if (
    bundleValidUntil.getTime() - attemptStartedAt.getTime() <
    DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS
  ) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
      'Less than 60 seconds of usable bundle lifetime remains',
      { attemptStartedAt, bundleValidUntil }
    );
  }

  // --- Acquire fence ---
  let fence;
  try {
    fence = await acquireFence(
      {
        checkoutId,
        quoteSnapshotHash: H0,
        bundleValidUntil
      },
      { ...deps, now: clock() }
    );
  } catch (err) {
    throw mapThrownError(err);
  }

  const fenceCtx = {
    checkoutId,
    attemptId: fence.attemptId,
    generation: fence.generation
  };

  let accommodationAcquired = false;
  let acquiredAccommodation = null;
  let facilityAcquireResult = null;
  let markerClearStarted = false;
  let fenceReleaseAttempted = false;

  try {
    // Re-read under fence
    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil });
    const revalidated = assertSnapshotAndHash(session, hashFn);
    if (revalidated.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed under the resource fence before mutation'
      );
    }
    // Re-classify classification against re-read snapshot (must stay consistent).
    const reclass = classifyQuoteSnapshot(revalidated.snapshot);
    if (reclass.bookingContext !== classification.bookingContext) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'Quote classification changed under the resource fence'
      );
    }

    if (typeof deps.beforeAccommodationAcquire === 'function') {
      await deps.beforeAccommodationAcquire({ checkoutId, fenceCtx, H0, bundleValidUntil });
    }

    const accInput = buildAccommodationInput(
      checkoutId,
      revalidated.snapshot,
      classification,
      bundleValidUntil
    );
    try {
      acquiredAccommodation = await acquireAccommodation(accInput, {
        ...deps,
        now: clock()
      });
    } catch (accErr) {
      throw mapThrownError(accErr);
    }
    accommodationAcquired = true;

    await assertExactFence(fenceCtx, H0, deps, clock);

    if (typeof deps.beforeFacilityAcquire === 'function') {
      await deps.beforeFacilityAcquire({
        checkoutId,
        fenceCtx,
        H0,
        bundleValidUntil,
        acquiredAccommodation
      });
    }

    // Re-normalize facilities from latest snapshot (still H0).
    const selections = normalizeFacilitySelectionsFromSnapshot(
      revalidated.snapshot,
      checkoutId
    );

    try {
      facilityAcquireResult = await acquireFacilities(selections, {
        ...deps,
        checkoutSessionId: checkoutId,
        acquisitionAttemptId: fenceCtx.attemptId,
        quoteSnapshotHash: H0,
        holdExpiresAt: bundleValidUntil,
        now: clock()
      });
    } catch (facErr) {
      // acquireFacilityHolds wraps non-FacilityBookingError (including fence lost).
      if (isFenceLostError(facErr)) {
        throw mapThrownError(facErr);
      }
      if (
        facErr &&
        String(facErr.code) === 'FACILITY_HOLD_ACQUIRE_FAILED' &&
        /fence/i.test(String(facErr.message || ''))
      ) {
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_FENCE_LOST',
          facErr.message || 'Resource attempt fence was lost',
          facErr.details || null
        );
      }
      throw mapThrownError(facErr);
    }

    if (typeof deps.afterFacilityAcquire === 'function') {
      await deps.afterFacilityAcquire({
        checkoutId,
        fenceCtx,
        facilityAcquireResult
      });
    }

    // Assert accommodation identity
    const assertInput = {
      checkoutId,
      checkIn: accInput.checkIn,
      checkOut: accInput.checkOut
    };
    if (acquiredAccommodation.entityType === 'cabin') {
      assertInput.cabinId = acquiredAccommodation.cabinId;
    }
    if (Object.prototype.hasOwnProperty.call(acquiredAccommodation, 'unitId')) {
      assertInput.unitId = acquiredAccommodation.unitId;
    }

    let activeAccommodation;
    try {
      activeAccommodation = await assertAccommodation(assertInput, {
        ...deps,
        now: clock()
      });
    } catch (assertErr) {
      throw mapThrownError(assertErr);
    }
    compareAccommodationIdentity(acquiredAccommodation, activeAccommodation);
    assertAccommodationExpiryFloor(activeAccommodation, bundleValidUntil, clock());

    // Assert facilities
    try {
      await assertFacilities(
        {
          checkoutSessionId: checkoutId,
          attemptId: fenceCtx.attemptId,
          selections,
          bundleValidUntil,
          now: clock()
        },
        { ...deps, now: clock(), quoteSnapshotHash: H0 }
      );
    } catch (assertFacErr) {
      throw mapThrownError(assertFacErr);
    }

    const remainingAfterVerify = bundleValidUntil.getTime() - clock().getTime();
    if (remainingAfterVerify < DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
        'Less than 60 seconds of usable bundle lifetime remains after verification',
        { remainingLeaseMs: remainingAfterVerify, bundleValidUntil }
      );
    }

    // Re-read session
    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil });
    const mid = assertSnapshotAndHash(session, hashFn);
    if (mid.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed after resource acquisition'
      );
    }

    if (typeof deps.beforeMarkerClear === 'function') {
      await deps.beforeMarkerClear({ checkoutId, fenceCtx, H0 });
    }

    // Clear markers
    markerClearStarted = true;
    let clearResult;
    try {
      clearResult = await clearMarkers(
        { checkoutSessionId: checkoutId, attemptId: fenceCtx.attemptId },
        { ...deps, quoteSnapshotHash: H0, now: clock() }
      );
    } catch (clearErr) {
      throw mapThrownError(clearErr);
    }
    if (!clearResult || clearResult.ok !== true) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
        'Facility acquisition markers were not fully cleared',
        { remainingHoldIds: clearResult?.remainingHoldIds || [] }
      );
    }

    try {
      await assertNoMarkers(
        { checkoutSessionId: checkoutId, attemptId: fenceCtx.attemptId },
        deps
      );
    } catch (noMarkErr) {
      throw mapThrownError(noMarkErr);
    }

    await assertExactFence(fenceCtx, H0, deps, clock);

    if (typeof deps.beforeFinalSessionCheck === 'function') {
      await deps.beforeFinalSessionCheck({ checkoutId, fenceCtx, H0, bundleValidUntil });
    }

    // Final session/hash/expiry check
    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil });
    const finalSnap = assertSnapshotAndHash(session, hashFn);
    if (finalSnap.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed after marker clearing'
      );
    }

    if (typeof deps.beforeFenceRelease === 'function') {
      const outcomesPre = facilityAcquireResult?.outcomes || [];
      const holdsPre = facilityAcquireResult?.holds || [];
      const facilitiesPre = holdsPre.map((hold, idx) =>
        mapFacilityHoldDto(hold, outcomesPre[idx])
      );
      await deps.beforeFenceRelease({
        checkoutId,
        fenceCtx,
        H0,
        quoteSnapshotHash: H0,
        attemptId: fenceCtx.attemptId,
        generation: fenceCtx.generation,
        bundleValidUntil,
        bookingContext: classification.bookingContext,
        accommodation: acquiredAccommodation,
        facilities: facilitiesPre,
        voucher: null,
        resourceBundleReady: true
      });
    }

    const remainingLeaseMs = bundleValidUntil.getTime() - clock().getTime();
    if (remainingLeaseMs < DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
        'Less than 60 seconds of usable bundle lifetime remains before release',
        { remainingLeaseMs, bundleValidUntil }
      );
    }

    fenceReleaseAttempted = true;
    try {
      await releaseFence(
        { checkoutId, attemptId: fenceCtx.attemptId },
        { ...deps, now: clock() }
      );
    } catch (releaseErr) {
      // No success; leave resources; leave exact open fence retryable.
      throw mapThrownError(releaseErr);
    }

    const outcomes = facilityAcquireResult?.outcomes || [];
    const holds = facilityAcquireResult?.holds || [];
    const facilities = holds.map((hold, idx) => mapFacilityHoldDto(hold, outcomes[idx]));

    return {
      checkoutId,
      quoteSnapshotHash: H0,
      bookingContext: classification.bookingContext,
      attemptId: fenceCtx.attemptId,
      generation: fenceCtx.generation,
      bundleValidUntil,
      remainingLeaseMs,
      accommodation: acquiredAccommodation,
      facilities,
      resourceBundleReady: true
    };
  } catch (err) {
    const mapped = err instanceof CheckoutResourceBundleError ? err : mapThrownError(err);

    // Release failure: leave resources and any still-open exact fence for retry.
    if (fenceReleaseAttempted) {
      throw mapped;
    }

    // Final-check / post-clear failures: fail fence if live; no facility compensate.
    if (markerClearStarted) {
      if (
        mapped.code === 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE' ||
        mapped.code === 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE'
      ) {
        try {
          await annotateFenceSafe(fenceCtx, mapped.code, deps, clock);
        } catch (annotateErr) {
          if (annotateErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw annotateErr;
        }
        throw mapped;
      }
      try {
        await failFenceSafe(null, fenceCtx, mapped.code, deps, clock);
      } catch (fenceErr) {
        if (fenceErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw fenceErr;
        throw mapped;
      }
      throw mapped;
    }

    await handlePreClearFailure({
      err: mapped,
      fenceCtx,
      hash: H0,
      accommodationAcquired,
      deps,
      clock
    });
  }
}

/**
 * B8F2B2 — Voucher-aware resource bundle preparation.
 * Sibling of prepareCheckoutResourceBundle; does not alter the non-voucher path.
 *
 * @param {{ checkoutId: string }} input
 * @param {object} [deps]
 */
async function prepareCheckoutResourceBundleWithVoucher(input = {}, deps = {}) {
  const clock = resolveClock(deps);
  const checkoutIdRaw = input.checkoutId;
  if (!nonEmptyString(checkoutIdRaw)) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_INVALID_INPUT',
      'checkoutId is required'
    );
  }
  const checkoutId = String(checkoutIdRaw).trim();

  const hashFn = getHashFn(deps);
  const fenceService = getFenceService(deps);
  const accommodationService = getAccommodationService(deps);
  const facilityService = getFacilityService(deps);
  const voucherService = getVoucherAttemptService(deps);

  const acquireFence =
    typeof deps.acquireCheckoutResourceAttemptFence === 'function'
      ? deps.acquireCheckoutResourceAttemptFence
      : fenceService.acquireCheckoutResourceAttemptFence.bind(fenceService);
  const releaseFence =
    typeof deps.releaseCheckoutResourceAttemptFence === 'function'
      ? deps.releaseCheckoutResourceAttemptFence
      : fenceService.releaseCheckoutResourceAttemptFence.bind(fenceService);
  const acquireAccommodation =
    typeof deps.acquireAccommodationCheckoutHold === 'function'
      ? deps.acquireAccommodationCheckoutHold
      : accommodationService.acquireAccommodationCheckoutHold.bind(accommodationService);
  const assertAccommodation =
    typeof deps.assertAccommodationCheckoutHoldActive === 'function'
      ? deps.assertAccommodationCheckoutHoldActive
      : accommodationService.assertAccommodationCheckoutHoldActive.bind(
          accommodationService
        );
  const acquireFacilities =
    typeof deps.acquireFacilityHolds === 'function'
      ? deps.acquireFacilityHolds
      : facilityService.acquireFacilityHolds.bind(facilityService);
  const assertFacilities =
    typeof deps.assertFacilityHoldsActive === 'function'
      ? deps.assertFacilityHoldsActive
      : facilityService.assertFacilityHoldsActive.bind(facilityService);
  const clearMarkers =
    typeof deps.clearFacilityAcquisitionMarkers === 'function'
      ? deps.clearFacilityAcquisitionMarkers
      : facilityService.clearFacilityAcquisitionMarkers.bind(facilityService);
  const assertNoMarkers =
    typeof deps.assertNoFacilityAcquisitionMarkers === 'function'
      ? deps.assertNoFacilityAcquisitionMarkers
      : facilityService.assertNoFacilityAcquisitionMarkers.bind(facilityService);
  const reserveVoucher =
    typeof deps.reserveExactVoucherAmountForAttempt === 'function'
      ? deps.reserveExactVoucherAmountForAttempt
      : voucherService.reserveExactVoucherAmountForAttempt.bind(voucherService);
  const assertVoucherActive =
    typeof deps.assertAttemptVoucherReservationActive === 'function'
      ? deps.assertAttemptVoucherReservationActive
      : voucherService.assertAttemptVoucherReservationActive.bind(voucherService);
  const sealVoucher =
    typeof deps.sealAttemptVoucherReservation === 'function'
      ? deps.sealAttemptVoucherReservation
      : voucherService.sealAttemptVoucherReservation.bind(voucherService);

  // --- Phase: pre-fence validation ---
  let session = await loadSession(checkoutId, deps);
  const attemptStartedAt = clock();
  assertSessionEligible(session, attemptStartedAt, { allowVoucher: true });
  const { snapshot, quoteSnapshotHash: H0 } = assertSnapshotAndHash(session, hashFn);
  let voucherContract = assertVoucherSnapshotContract(session, snapshot);
  const classification = classifyQuoteSnapshot(snapshot);
  normalizeFacilitySelectionsFromSnapshot(snapshot, checkoutId);

  const sessionExp = assertValidSessionExpiryField(session);
  const ttlMs = defaultFenceService.DEFAULT_RESOURCE_BUNDLE_TTL_MS;
  const rawBundleValidUntil = new Date(attemptStartedAt.getTime() + ttlMs);
  const bundleValidUntil = sessionExp
    ? new Date(Math.min(rawBundleValidUntil.getTime(), sessionExp.getTime()))
    : rawBundleValidUntil;

  if (
    bundleValidUntil.getTime() - attemptStartedAt.getTime() <
    DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS
  ) {
    throw new CheckoutResourceBundleError(
      'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
      'Less than 60 seconds of usable bundle lifetime remains',
      { attemptStartedAt, bundleValidUntil }
    );
  }

  let fence;
  try {
    fence = await acquireFence(
      {
        checkoutId,
        quoteSnapshotHash: H0,
        bundleValidUntil
      },
      { ...deps, now: clock() }
    );
  } catch (err) {
    throw mapThrownError(err);
  }

  const fenceCtx = {
    checkoutId,
    attemptId: fence.attemptId,
    generation: fence.generation
  };

  let accommodationAcquired = false;
  let acquiredAccommodation = null;
  let facilityAcquireResult = null;
  let facilitySelections = null;
  let voucherReserved = false;
  let voucherReserveResult = null;
  let facilityMarkersCleared = false;
  let voucherSealed = false;
  let sealedVoucherResult = null;
  let fenceReleaseAttempted = false;

  async function handleVoucherAwareFailure(rawErr) {
    const mapped =
      rawErr instanceof CheckoutResourceBundleError
        ? rawErr
        : mapVoucherThrownError(rawErr);

    if (fenceReleaseAttempted) {
      throw mapped;
    }

    if (mapped.code === 'RESOURCE_BUNDLE_FENCE_LOST') {
      throw mapped;
    }

    // After seal: keep sealed voucher + facilities + accommodation; fail fence if owned.
    if (voucherSealed) {
      if (
        mapped.code === 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE' ||
        mapped.code === 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE' ||
        mapped.code === 'VOUCHER_MARKER_CLEAR_INCOMPLETE' ||
        mapped.code === 'VOUCHER_COMPENSATION_INCOMPLETE'
      ) {
        try {
          await annotateFenceSafe(fenceCtx, mapped.code, deps, clock);
        } catch (annotateErr) {
          if (annotateErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw annotateErr;
        }
        throw mapped;
      }
      try {
        await failFenceSafe(null, fenceCtx, mapped.code, deps, clock);
      } catch (fenceErr) {
        if (fenceErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw fenceErr;
      }
      throw mapped;
    }

    // After facility markers cleared, seal incomplete / marker-clear incomplete:
    // keep resources and voucher reservation; annotate; leave fence open.
    if (facilityMarkersCleared) {
      try {
        await annotateFenceSafe(
          fenceCtx,
          mapped.code || 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
          deps,
          clock
        );
      } catch (annotateErr) {
        if (annotateErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw annotateErr;
      }
      throw mapped;
    }

    // After voucher reserved, before facility marker clear.
    if (voucherReserved) {
      try {
        await assertExactFence(fenceCtx, H0, deps, clock);
      } catch (fenceErr) {
        const fenceMapped = mapThrownError(fenceErr);
        if (fenceMapped.code === 'RESOURCE_BUNDLE_FENCE_LOST') {
          throw fenceMapped;
        }
        throw fenceMapped;
      }

      let voucherCompOk = false;
      let facilityCompOk = false;
      try {
        await releaseCurrentAttemptVoucherNoFenceFail({
          checkoutId,
          attemptId: fenceCtx.attemptId,
          quoteSnapshotHash: H0,
          deps,
          clock
        });
        await assertNoCurrentAttemptVoucherMarkersSafe({
          checkoutId,
          attemptId: fenceCtx.attemptId,
          deps,
          clock
        });
        voucherCompOk = true;
      } catch (voucherCompErr) {
        const voucherMapped = mapVoucherThrownError(voucherCompErr);
        // Already-sealed reuse: release is not allowed; prove no current-attempt markers.
        if (voucherMapped.code === 'VOUCHER_COMPENSATION_SEAL_COMPLETED') {
          try {
            await assertNoCurrentAttemptVoucherMarkersSafe({
              checkoutId,
              attemptId: fenceCtx.attemptId,
              deps,
              clock
            });
            voucherCompOk = true;
          } catch (_proveErr) {
            voucherCompOk = false;
          }
        } else {
          voucherCompOk = false;
        }
      }

      let facilityComp;
      try {
        facilityComp = await compensateCurrentAttemptFacilities(
          fenceCtx.checkoutId,
          fenceCtx.attemptId,
          deps,
          clock
        );
        facilityCompOk = facilityComp.ok === true;
      } catch (facCompErr) {
        facilityCompOk = false;
        void facCompErr;
      }

      if (!voucherCompOk || !facilityCompOk) {
        try {
          await annotateFenceSafe(
            fenceCtx,
            'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
            deps,
            clock
          );
        } catch (annotateErr) {
          if (annotateErr.code === 'RESOURCE_BUNDLE_FENCE_LOST') throw annotateErr;
        }
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE',
          'Voucher and/or facility compensation incomplete after reserve',
          {
            voucherCompOk,
            facilityCompOk,
            remainingHoldIds: facilityComp?.remainingHoldIds || [],
            originalCode: mapped.code
          }
        );
      }

      await failFenceSafe(null, fenceCtx, mapped.code, deps, clock);
      throw mapped;
    }

    // Before voucher reservation: A2 pre-clear facility compensation.
    await handlePreClearFailure({
      err: mapped,
      fenceCtx,
      hash: H0,
      accommodationAcquired,
      deps,
      clock
    });
  }

  try {
    // Re-read under fence
    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil, allowVoucher: true });
    const revalidated = assertSnapshotAndHash(session, hashFn);
    if (revalidated.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed under the resource fence before mutation'
      );
    }
    voucherContract = assertVoucherSnapshotContract(session, revalidated.snapshot);
    const reclass = classifyQuoteSnapshot(revalidated.snapshot);
    if (reclass.bookingContext !== classification.bookingContext) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY',
        'Quote classification changed under the resource fence'
      );
    }

    if (typeof deps.beforeAccommodationAcquire === 'function') {
      await deps.beforeAccommodationAcquire({ checkoutId, fenceCtx, H0, bundleValidUntil });
    }

    const accInput = buildAccommodationInput(
      checkoutId,
      revalidated.snapshot,
      classification,
      bundleValidUntil
    );
    try {
      acquiredAccommodation = await acquireAccommodation(accInput, {
        ...deps,
        now: clock()
      });
    } catch (accErr) {
      throw mapThrownError(accErr);
    }
    accommodationAcquired = true;

    await assertExactFence(fenceCtx, H0, deps, clock);

    if (typeof deps.beforeFacilityAcquire === 'function') {
      await deps.beforeFacilityAcquire({
        checkoutId,
        fenceCtx,
        H0,
        bundleValidUntil,
        acquiredAccommodation
      });
    }

    facilitySelections = normalizeFacilitySelectionsFromSnapshot(
      revalidated.snapshot,
      checkoutId
    );

    try {
      facilityAcquireResult = await acquireFacilities(facilitySelections, {
        ...deps,
        checkoutSessionId: checkoutId,
        acquisitionAttemptId: fenceCtx.attemptId,
        quoteSnapshotHash: H0,
        holdExpiresAt: bundleValidUntil,
        now: clock()
      });
    } catch (facErr) {
      if (isFenceLostError(facErr)) {
        throw mapThrownError(facErr);
      }
      if (
        facErr &&
        String(facErr.code) === 'FACILITY_HOLD_ACQUIRE_FAILED' &&
        /fence/i.test(String(facErr.message || ''))
      ) {
        throw new CheckoutResourceBundleError(
          'RESOURCE_BUNDLE_FENCE_LOST',
          facErr.message || 'Resource attempt fence was lost',
          facErr.details || null
        );
      }
      throw mapThrownError(facErr);
    }

    if (typeof deps.afterFacilityAcquire === 'function') {
      await deps.afterFacilityAcquire({
        checkoutId,
        fenceCtx,
        facilityAcquireResult
      });
    }

    const assertInput = {
      checkoutId,
      checkIn: accInput.checkIn,
      checkOut: accInput.checkOut
    };
    if (acquiredAccommodation.entityType === 'cabin') {
      assertInput.cabinId = acquiredAccommodation.cabinId;
    }
    if (Object.prototype.hasOwnProperty.call(acquiredAccommodation, 'unitId')) {
      assertInput.unitId = acquiredAccommodation.unitId;
    }

    let activeAccommodation;
    try {
      activeAccommodation = await assertAccommodation(assertInput, {
        ...deps,
        now: clock()
      });
    } catch (assertErr) {
      throw mapThrownError(assertErr);
    }
    compareAccommodationIdentity(acquiredAccommodation, activeAccommodation);
    assertAccommodationExpiryFloor(activeAccommodation, bundleValidUntil, clock());

    try {
      await assertFacilities(
        {
          checkoutSessionId: checkoutId,
          attemptId: fenceCtx.attemptId,
          selections: facilitySelections,
          bundleValidUntil,
          now: clock()
        },
        { ...deps, now: clock(), quoteSnapshotHash: H0 }
      );
    } catch (assertFacErr) {
      throw mapThrownError(assertFacErr);
    }

    await assertExactFence(fenceCtx, H0, deps, clock);

    if (typeof deps.beforeVoucherReserve === 'function') {
      await deps.beforeVoucherReserve({
        checkoutId,
        fenceCtx,
        H0,
        bundleValidUntil,
        voucherContract
      });
    }

    // Partial-seal repair window: redemption unmarked, operation still marked by this attempt.
    // reserveExactVoucherAmountForAttempt treats that as live_unmarked_non_sealed and fails closed.
    let partialSealRepair = null;
    {
      const liveRed = await GiftVoucherRedemption.findOne({
        checkoutId,
        status: 'reserved',
        ledgerProtocolVersion: 1
      }).lean();
      if (
        liveRed &&
        (liveRed.acquisitionAttemptId == null || liveRed.acquisitionAttemptId === '') &&
        String(liveRed.quoteSnapshotHash || '') === H0 &&
        Number(liveRed.amountAppliedCents) === Number(voucherContract.voucherAppliedCents) &&
        normalizeVoucherCodeInput(liveRed.voucherCode) === voucherContract.voucherCode
      ) {
        const vDoc = await GiftVoucher.findById(liveRed.giftVoucherId).lean();
        const opRow = (vDoc?.reservationLedgerOperations || []).find(
          (row) =>
            String(row.operationId) === String(liveRed.operationId) &&
            String(row.redemptionId) === String(liveRed._id)
        );
        if (
          opRow &&
          opRow.state === 'debited' &&
          String(opRow.acquisitionAttemptId || '') === String(fenceCtx.attemptId)
        ) {
          partialSealRepair = {
            ok: true,
            outcome: 'partial_seal_repair',
            compensable: true,
            redemptionId: String(liveRed._id),
            giftVoucherId: String(liveRed.giftVoucherId),
            operationId: liveRed.operationId,
            reservationKey: liveRed.reservationKey,
            amountAppliedCents: liveRed.amountAppliedCents,
            currency: liveRed.currency,
            expiresAt: liveRed.expiresAt,
            acquisitionAttemptId: fenceCtx.attemptId
          };
        }
      }
    }

    if (partialSealRepair) {
      voucherReserveResult = partialSealRepair;
    } else {
      try {
        voucherReserveResult = await reserveVoucher(
          {
            checkoutId,
            acquisitionAttemptId: fenceCtx.attemptId,
            quoteSnapshotHash: H0,
            voucherCode: voucherContract.voucherCode,
            amountCents: voucherContract.voucherAppliedCents,
            currency: 'EUR'
          },
          { ...deps, now: clock() }
        );
      } catch (voucherErr) {
        throw mapVoucherThrownError(voucherErr);
      }
    }
    voucherReserved = true;
    const alreadySealedReuse =
      !partialSealRepair &&
      (voucherReserveResult.outcome === 'reused' ||
        voucherReserveResult.compensable === false ||
        voucherReserveResult.acquisitionAttemptId == null);

    if (typeof deps.afterVoucherReserve === 'function') {
      await deps.afterVoucherReserve({
        checkoutId,
        fenceCtx,
        voucherReserveResult
      });
    }

    // Sealed unmarked reuse and partial-seal repair cannot pass dual-marker assert.
    if (alreadySealedReuse || partialSealRepair) {
      if (alreadySealedReuse) {
        try {
          await assertExactSealedVoucherState({
            checkoutId,
            attemptId: fenceCtx.attemptId,
            quoteSnapshotHash: H0,
            redemptionId: voucherReserveResult.redemptionId,
            voucherContract,
            bundleValidUntil,
            deps,
            clock
          });
        } catch (sealedErr) {
          throw mapVoucherThrownError(sealedErr);
        }
      }
    } else {
      let voucherActive;
      try {
        voucherActive = await assertVoucherActive(
          {
            checkoutId,
            acquisitionAttemptId: fenceCtx.attemptId,
            quoteSnapshotHash: H0,
            redemptionId: voucherReserveResult.redemptionId
          },
          { ...deps, now: clock() }
        );
      } catch (activeErr) {
        throw mapVoucherThrownError(activeErr);
      }
      void voucherActive;
    }

    const liveRedemption = await GiftVoucherRedemption.findById(
      voucherReserveResult.redemptionId
    ).lean();
    if (!liveRedemption) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_INTEGRITY',
        'Reserved voucher redemption missing after assert'
      );
    }
    if (String(liveRedemption.checkoutId || '') !== checkoutId) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption checkout mismatch'
      );
    }
    if (String(liveRedemption.quoteSnapshotHash || '') !== H0) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption quoteSnapshotHash mismatch'
      );
    }
    if (
      Number(liveRedemption.amountAppliedCents) !==
      Number(voucherContract.voucherAppliedCents)
    ) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption amount mismatch'
      );
    }
    if (String(liveRedemption.currency || '') !== 'EUR') {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption currency mismatch'
      );
    }
    if (
      normalizeVoucherCodeInput(liveRedemption.voucherCode) !==
      voucherContract.voucherCode
    ) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption code mismatch'
      );
    }
    if (
      String(liveRedemption.reservationKey || '') !==
      String(voucherReserveResult.reservationKey || '')
    ) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher reservationKey mismatch'
      );
    }
    if (liveRedemption.status !== 'reserved') {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_VERIFICATION_FAILED',
        'Voucher redemption status is not reserved'
      );
    }
    const redExp = toInstant(liveRedemption.expiresAt);
    if (!redExp || redExp.getTime() < bundleValidUntil.getTime()) {
      throw new CheckoutResourceBundleError(
        'VOUCHER_RESERVATION_EXPIRY_TOO_SHORT',
        'Voucher expiry is below bundleValidUntil',
        { expiresAt: redExp, bundleValidUntil }
      );
    }

    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil, allowVoucher: true });
    const mid = assertSnapshotAndHash(session, hashFn);
    if (mid.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed after voucher reservation'
      );
    }
    voucherContract = assertVoucherSnapshotContract(session, mid.snapshot);

    if (session.voucherRedemptionId != null && session.voucherRedemptionId !== '') {
      if (String(session.voucherRedemptionId) !== String(voucherReserveResult.redemptionId)) {
        throw new CheckoutResourceBundleError(
          'VOUCHER_SESSION_CAS_CONFLICT',
          'CheckoutSession.voucherRedemptionId differs from the reserved redemption',
          {
            sessionRedemptionId: String(session.voucherRedemptionId),
            reservedRedemptionId: String(voucherReserveResult.redemptionId)
          }
        );
      }
    }

    if (typeof deps.beforeMarkerClear === 'function') {
      await deps.beforeMarkerClear({ checkoutId, fenceCtx, H0 });
    }

    facilityMarkersCleared = true;
    let clearResult;
    try {
      clearResult = await clearMarkers(
        { checkoutSessionId: checkoutId, attemptId: fenceCtx.attemptId },
        { ...deps, quoteSnapshotHash: H0, now: clock() }
      );
    } catch (clearErr) {
      throw mapThrownError(clearErr);
    }
    if (!clearResult || clearResult.ok !== true) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE',
        'Facility acquisition markers were not fully cleared',
        { remainingHoldIds: clearResult?.remainingHoldIds || [] }
      );
    }

    try {
      await assertNoMarkers(
        { checkoutSessionId: checkoutId, attemptId: fenceCtx.attemptId },
        deps
      );
    } catch (noMarkErr) {
      throw mapThrownError(noMarkErr);
    }

    await assertExactFence(fenceCtx, H0, deps, clock);
    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil, allowVoucher: true });
    const postClear = assertSnapshotAndHash(session, hashFn);
    if (postClear.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed after facility marker clearing'
      );
    }
    voucherContract = assertVoucherSnapshotContract(session, postClear.snapshot);

    if (typeof deps.beforeVoucherSeal === 'function') {
      await deps.beforeVoucherSeal({
        checkoutId,
        fenceCtx,
        redemptionId: voucherReserveResult.redemptionId
      });
    }

    try {
      sealedVoucherResult = await sealVoucher(
        {
          checkoutId,
          acquisitionAttemptId: fenceCtx.attemptId,
          quoteSnapshotHash: H0,
          redemptionId: voucherReserveResult.redemptionId
        },
        { ...deps, now: clock() }
      );
    } catch (sealErr) {
      throw mapVoucherThrownError(sealErr);
    }
    voucherSealed = true;

    if (typeof deps.afterVoucherSeal === 'function') {
      await deps.afterVoucherSeal({
        checkoutId,
        fenceCtx,
        sealedVoucherResult
      });
    }

    try {
      await assertNoCurrentAttemptVoucherMarkersSafe({
        checkoutId,
        attemptId: fenceCtx.attemptId,
        deps,
        clock
      });
    } catch (voucherMarkErr) {
      throw mapVoucherThrownError(voucherMarkErr);
    }

    // Final re-verify accommodation, facilities, sealed voucher, session/hash, lease.
    let finalAccommodation;
    try {
      finalAccommodation = await assertAccommodation(assertInput, {
        ...deps,
        now: clock()
      });
    } catch (assertErr) {
      throw mapThrownError(assertErr);
    }
    compareAccommodationIdentity(acquiredAccommodation, finalAccommodation);
    assertAccommodationExpiryFloor(finalAccommodation, bundleValidUntil, clock());

    try {
      await assertFacilities(
        {
          checkoutSessionId: checkoutId,
          attemptId: fenceCtx.attemptId,
          selections: facilitySelections,
          bundleValidUntil,
          now: clock()
        },
        { ...deps, now: clock(), quoteSnapshotHash: H0 }
      );
    } catch (assertFacErr) {
      throw mapThrownError(assertFacErr);
    }

    let sealedProof;
    try {
      sealedProof = await assertExactSealedVoucherState({
        checkoutId,
        attemptId: fenceCtx.attemptId,
        quoteSnapshotHash: H0,
        redemptionId: voucherReserveResult.redemptionId,
        voucherContract,
        bundleValidUntil,
        deps,
        clock
      });
    } catch (sealedErr) {
      throw mapVoucherThrownError(sealedErr);
    }

    if (typeof deps.beforeFinalSessionCheck === 'function') {
      await deps.beforeFinalSessionCheck({ checkoutId, fenceCtx, H0, bundleValidUntil });
    }

    session = await loadSession(checkoutId, deps);
    assertSessionEligible(session, clock(), { bundleValidUntil, allowVoucher: true });
    const finalSnap = assertSnapshotAndHash(session, hashFn);
    if (finalSnap.quoteSnapshotHash !== H0) {
      throw new CheckoutResourceBundleError(
        'SNAPSHOT_HASH_MISMATCH',
        'quoteSnapshotHash changed after voucher seal'
      );
    }
    voucherContract = assertVoucherSnapshotContract(session, finalSnap.snapshot);

    if (typeof deps.beforeFenceRelease === 'function') {
      const outcomesPre = facilityAcquireResult?.outcomes || [];
      const holdsPre = facilityAcquireResult?.holds || [];
      const facilitiesPre = holdsPre.map((hold, idx) =>
        mapFacilityHoldDto(hold, outcomesPre[idx])
      );
      await deps.beforeFenceRelease({
        checkoutId,
        fenceCtx,
        H0,
        quoteSnapshotHash: H0,
        attemptId: fenceCtx.attemptId,
        generation: fenceCtx.generation,
        bundleValidUntil,
        bookingContext: classification.bookingContext,
        accommodation: acquiredAccommodation,
        facilities: facilitiesPre,
        voucher: {
          redemptionId: String(sealedProof.redemption._id),
          giftVoucherId: String(sealedProof.redemption.giftVoucherId),
          operationId: String(sealedProof.redemption.operationId),
          reservationKey: String(sealedProof.redemption.reservationKey),
          voucherCode: normalizeVoucherCodeInput(sealedProof.redemption.voucherCode),
          amountAppliedCents: Number(sealedProof.redemption.amountAppliedCents),
          currency: String(sealedProof.redemption.currency || 'EUR'),
          status: String(sealedProof.redemption.status),
          expiresAt: toIso(sealedProof.redemption.expiresAt),
          sealed: true
        },
        resourceBundleReady: true
      });
    }

    const remainingLeaseMs = bundleValidUntil.getTime() - clock().getTime();
    if (remainingLeaseMs < DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS) {
      throw new CheckoutResourceBundleError(
        'RESOURCE_BUNDLE_LEASE_TOO_SHORT',
        'Less than 60 seconds of usable bundle lifetime remains before release',
        { remainingLeaseMs, bundleValidUntil }
      );
    }

    fenceReleaseAttempted = true;
    try {
      await releaseFence(
        { checkoutId, attemptId: fenceCtx.attemptId },
        { ...deps, now: clock() }
      );
    } catch (releaseErr) {
      throw mapThrownError(releaseErr);
    }

    const outcomes = facilityAcquireResult?.outcomes || [];
    const holds = facilityAcquireResult?.holds || [];
    const facilities = holds.map((hold, idx) => mapFacilityHoldDto(hold, outcomes[idx]));

    const voucherCoverage = {
      totalValueCents: voucherContract.totalValueCents,
      voucherAppliedCents: voucherContract.voucherAppliedCents,
      fullVoucherCoverage: voucherContract.fullVoucherCoverage
    };
    voucherCoverage[FIELD_REMAINING_DUE_CENTS] = voucherContract.remainingDueCents;

    return {
      checkoutId,
      quoteSnapshotHash: H0,
      bookingContext: classification.bookingContext,
      attemptId: fenceCtx.attemptId,
      generation: fenceCtx.generation,
      bundleValidUntil,
      remainingLeaseMs,
      accommodation: acquiredAccommodation,
      facilities,
      voucher: {
        redemptionId: String(sealedProof.redemption._id),
        giftVoucherId: String(sealedProof.redemption.giftVoucherId),
        operationId: String(sealedProof.redemption.operationId),
        reservationKey: String(sealedProof.redemption.reservationKey),
        voucherCode: normalizeVoucherCodeInput(sealedProof.redemption.voucherCode),
        amountAppliedCents: Number(sealedProof.redemption.amountAppliedCents),
        currency: String(sealedProof.redemption.currency || 'EUR'),
        status: String(sealedProof.redemption.status),
        expiresAt: toIso(sealedProof.redemption.expiresAt),
        outcome: voucherReserveResult.outcome || sealedVoucherResult?.outcome || null,
        sealed: true
      },
      voucherCoverage,
      resourceBundleReady: true
    };
  } catch (err) {
    await handleVoucherAwareFailure(err);
  }
}


module.exports = {
  DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS,
  CheckoutResourceBundleError,
  prepareCheckoutResourceBundle,
  prepareCheckoutResourceBundleWithVoucher
};
