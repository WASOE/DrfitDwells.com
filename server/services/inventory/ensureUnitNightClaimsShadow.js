'use strict';

/**
 * Authoritative UnitNightClaim ensure for allocated multi-unit Bookings (I6).
 *
 * Prefer claim-before-Booking at writers. This helper acquires/repairs claims for
 * an already-identified bookingId+allocation and FAILS CLOSED on claim failure
 * (MRI recorded, then throws). Not a nonfatal shadow path.
 */

const Unit = require('../../models/Unit');
const {
  claimUnitNights,
  ERR: CLAIM_ERR
} = require('./unitNightClaimService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES
} = require('../payments/paidBookingFinalizationObservability');

const CLAIM_OUTCOMES = Object.freeze({
  CLAIMED: 'claimed',
  ALREADY_OWNED: 'already_owned',
  SKIPPED_NOT_MULTI_UNIT: 'skipped_not_multi_unit',
  SKIPPED_UNALLOCATED: 'skipped_unallocated',
  FOREIGN_OWNER: 'foreign_owner',
  INVALID_ALLOCATION: 'invalid_allocation',
  WRITE_FAILURE: 'write_failure',
  INTEGRITY_CABIN_TYPE_MISMATCH: 'integrity_cabin_type_mismatch'
});

// Historical MRI category retained for dedupe compatibility.
const MRI_CATEGORY = 'unit_night_claim_shadow_failure';
const MRI_SOURCE = 'unit_night_claim_authoritative';

const I2_SOURCES = Object.freeze({
  FINALIZE: 'finalize',
  LEGACY_CREATE: 'legacy_create',
  LOCATION_CHILD: 'location_child',
  MULTI_UNIT_RECOVERY: 'multi_unit_recovery'
});

function resolveClaimSource(source) {
  const raw = String(source || '').trim();
  if (raw === I2_SOURCES.LEGACY_CREATE) return I2_SOURCES.LEGACY_CREATE;
  if (raw === I2_SOURCES.LOCATION_CHILD) return I2_SOURCES.LOCATION_CHILD;
  if (raw === I2_SOURCES.MULTI_UNIT_RECOVERY) return I2_SOURCES.MULTI_UNIT_RECOVERY;
  if (raw === 'multi_unit_paid_orphan_recovery') return I2_SOURCES.MULTI_UNIT_RECOVERY;
  if (raw === I2_SOURCES.FINALIZE) return I2_SOURCES.FINALIZE;
  if (
    raw === 'frontend' ||
    raw === 'webhook_worker' ||
    raw === 'reconcile' ||
    raw === 'manual' ||
    raw === ''
  ) {
    return I2_SOURCES.FINALIZE;
  }
  return raw || I2_SOURCES.FINALIZE;
}

function outcomeBase(partial) {
  return {
    ok: false,
    outcome: CLAIM_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    unitId: null,
    cabinTypeId: null,
    source: null,
    nights: [],
    insertedCount: 0,
    alreadyOwnedCount: 0,
    insertedNightsThisAttempt: [],
    errorCode: null,
    errorMessage: null,
    manualReviewItemId: null,
    paymentResolutionIssueId: null,
    ...partial
  };
}

/** Accept raw ObjectId, string, or populated doc. */
function idish(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

async function recordClaimFailureSignals({
  booking,
  claimSource,
  paymentIntentId,
  checkoutId,
  errorCode,
  errorSummary,
  details = {},
  openManualReviewItemFn,
  recordPriFn,
  stripePaymentVerified = null
}) {
  const bookingId = booking?._id ? String(booking._id) : null;
  const unitId = idish(booking?.unitId);
  const cabinTypeId = idish(booking?.cabinTypeId);
  const baseSourceReference =
    (checkoutId && String(checkoutId).trim()) ||
    (booking?.checkoutId && String(booking.checkoutId).trim()) ||
    bookingId;
  const sourceReference = baseSourceReference
    ? `${baseSourceReference}:claim`
    : null;

  let manualReviewItemId = null;
  try {
    const mri = await openManualReviewItemFn({
      category: MRI_CATEGORY,
      severity: 'critical',
      entityType: 'Booking',
      entityId: bookingId,
      title: 'UnitNightClaim authoritative acquisition failed',
      details: errorSummary || 'Authoritative UnitNightClaim write failed',
      provenance: {
        source: MRI_SOURCE,
        sourceReference
      },
      evidence: {
        operation: 'claim',
        errorCode: errorCode || null,
        unitId,
        cabinTypeId,
        claimSource,
        ...details
      }
    });
    manualReviewItemId = mri?._id ? String(mri._id) : null;
  } catch {
    /* MRI best-effort */
  }

  let paymentResolutionIssueId = null;
  if (paymentIntentId && typeof recordPriFn === 'function') {
    try {
      const pri = await recordPriFn({
        issueType: 'paid_booking_unknown_failure',
        errorCode: errorCode || 'UNIT_NIGHT_CLAIM_FAILURE',
        errorSummary: errorSummary || 'Authoritative UnitNightClaim failed',
        paymentIntentId,
        finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNIT_NIGHT_CLAIM_SHADOW,
        checkoutId,
        bookingId,
        stripePaymentVerified
      });
      paymentResolutionIssueId = pri?._id ? String(pri._id) : null;
    } catch {
      /* PRI best-effort */
    }
  }

  return { manualReviewItemId, paymentResolutionIssueId };
}

/**
 * Authoritative claim ensure. Throws on claim failure after recording MRI.
 * Skip outcomes (single-cabin / unallocated) return ok without throwing.
 */
async function ensureUnitNightClaimsShadow({
  booking,
  source = I2_SOURCES.FINALIZE,
  paymentIntentId = null,
  checkoutId = null,
  stripePaymentVerified = null,
  claimUnitNightsFn = claimUnitNights,
  openManualReviewItemFn = openManualReviewItem,
  recordPaidBookingResolutionIssueFn = recordPaidBookingResolutionIssueSafe,
  loadUnitFn = null,
  throwOnFailure = true
} = {}) {
  const claimSource = resolveClaimSource(source);
  const signalOpts = {
    paymentIntentId,
    checkoutId,
    openManualReviewItemFn,
    recordPriFn: recordPaidBookingResolutionIssueFn,
    stripePaymentVerified
  };

  if (!booking || !booking._id) {
    const out = outcomeBase({
      outcome: CLAIM_OUTCOMES.INVALID_ALLOCATION,
      source: claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'Booking is required'
    });
    if (throwOnFailure) {
      const err = new Error(out.errorMessage);
      err.code = out.errorCode;
      err.claimOutcome = out;
      throw err;
    }
    return out;
  }

  const bookingId = String(booking._id);
  const cabinTypeId = idish(booking.cabinTypeId);
  const unitId = idish(booking.unitId);

  if (!cabinTypeId) {
    return outcomeBase({
      ok: true,
      outcome: CLAIM_OUTCOMES.SKIPPED_NOT_MULTI_UNIT,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!unitId) {
    return outcomeBase({
      ok: true,
      outcome: CLAIM_OUTCOMES.SKIPPED_UNALLOCATED,
      bookingId,
      unitId: null,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!booking.checkIn || !booking.checkOut) {
    const signals = await recordClaimFailureSignals({
      booking,
      claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorSummary: 'Allocated multi-unit Booking missing checkIn/checkOut for claims',
      ...signalOpts
    });
    const out = outcomeBase({
      outcome: CLAIM_OUTCOMES.INVALID_ALLOCATION,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'Missing checkIn/checkOut',
      ...signals
    });
    if (throwOnFailure) {
      const err = new Error(out.errorMessage);
      err.code = out.errorCode;
      err.claimOutcome = out;
      throw err;
    }
    return out;
  }

  try {
    const loadUnit =
      loadUnitFn ||
      (async (id) => Unit.findById(id).select('cabinTypeId').lean());
    const unitDoc = await loadUnit(unitId);
    if (
      unitDoc?.cabinTypeId &&
      String(unitDoc.cabinTypeId) !== String(cabinTypeId)
    ) {
      const signals = await recordClaimFailureSignals({
        booking,
        claimSource,
        errorCode: 'UNIT_CABIN_TYPE_MISMATCH',
        errorSummary: 'Booking.unitId does not belong to Booking.cabinTypeId',
        details: { integrity: 'cabin_type_mismatch' },
        ...signalOpts
      });
      const out = outcomeBase({
        outcome: CLAIM_OUTCOMES.INTEGRITY_CABIN_TYPE_MISMATCH,
        bookingId,
        unitId,
        cabinTypeId,
        source: claimSource,
        errorCode: 'UNIT_CABIN_TYPE_MISMATCH',
        errorMessage: 'Unit cabinType mismatch with Booking',
        ...signals
      });
      if (throwOnFailure) {
        const err = new Error(out.errorMessage);
        err.code = out.errorCode;
        err.claimOutcome = out;
        throw err;
      }
      return out;
    }
  } catch (err) {
    if (err?.claimOutcome) throw err;
    /* unit lookup soft — proceed to claim */
  }

  try {
    const result = await claimUnitNightsFn({
      bookingId,
      unitId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      source: claimSource
    });

    const already =
      Number(result.insertedCount || 0) === 0 &&
      Number(result.alreadyOwnedCount || 0) > 0;

    return outcomeBase({
      ok: true,
      outcome: already ? CLAIM_OUTCOMES.ALREADY_OWNED : CLAIM_OUTCOMES.CLAIMED,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      nights: result.nights || [],
      insertedCount: result.insertedCount || 0,
      alreadyOwnedCount: result.alreadyOwnedCount || 0,
      insertedNightsThisAttempt: result.insertedNightsThisAttempt || []
    });
  } catch (err) {
    const code = err?.code || 'UNIT_NIGHT_CLAIM_FAILURE';
    let outcome = CLAIM_OUTCOMES.WRITE_FAILURE;
    if (code === CLAIM_ERR.FOREIGN_OWNER) outcome = CLAIM_OUTCOMES.FOREIGN_OWNER;
    else if (code === CLAIM_ERR.VALIDATION) outcome = CLAIM_OUTCOMES.INVALID_ALLOCATION;

    const signals = await recordClaimFailureSignals({
      booking,
      claimSource,
      errorCode: code,
      errorSummary: err?.message || 'UnitNightClaim authoritative acquisition failed',
      details: {
        conflicts: err?.details?.conflicts || null
      },
      ...signalOpts
    });

    const out = outcomeBase({
      outcome,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: code,
      errorMessage: err?.message || String(err),
      ...signals
    });

    if (throwOnFailure) {
      err.claimOutcome = out;
      throw err;
    }
    return out;
  }
}

async function ensureUnitNightClaimsShadowForBookings(bookings, options = {}) {
  const results = [];
  for (const booking of bookings || []) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await ensureUnitNightClaimsShadow({ ...options, booking }));
  }
  return results;
}

/** @deprecated name — use ensureUnitNightClaimsShadow (now authoritative). */
const ensureUnitNightClaimsAuthoritative = ensureUnitNightClaimsShadow;

module.exports = {
  ensureUnitNightClaimsShadow,
  ensureUnitNightClaimsAuthoritative,
  ensureUnitNightClaimsShadowForBookings,
  SHADOW_OUTCOMES: CLAIM_OUTCOMES,
  CLAIM_OUTCOMES,
  I2_SOURCES,
  MRI_CATEGORY,
  MRI_SOURCE,
  resolveClaimSource
};
