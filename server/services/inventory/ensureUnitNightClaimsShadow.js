'use strict';

/**
 * I2 shadow dual-write helper for UnitNightClaim.
 *
 * Binding: docs/stay-change-implementation-plan.md — I2 shadow semantics.
 * Claims are NOT authoritative. Failure never rolls back a surviving Booking.
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

const SHADOW_OUTCOMES = Object.freeze({
  CLAIMED: 'claimed',
  ALREADY_OWNED: 'already_owned',
  SKIPPED_NOT_MULTI_UNIT: 'skipped_not_multi_unit',
  SKIPPED_UNALLOCATED: 'skipped_unallocated',
  FOREIGN_OWNER: 'foreign_owner',
  INVALID_ALLOCATION: 'invalid_allocation',
  WRITE_FAILURE: 'write_failure',
  INTEGRITY_CABIN_TYPE_MISMATCH: 'integrity_cabin_type_mismatch'
});

const MRI_CATEGORY = 'unit_night_claim_shadow_failure';
const MRI_SOURCE = 'unit_night_claim_shadow';

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
  // Canonical finalize entry points (frontend / worker / reconcile / manual).
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
    outcome: SHADOW_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    unitId: null,
    cabinTypeId: null,
    source: null,
    nights: [],
    insertedCount: 0,
    alreadyOwnedCount: 0,
    errorCode: null,
    errorMessage: null,
    manualReviewItemId: null,
    paymentResolutionIssueId: null,
    ...partial
  };
}

async function recordShadowFailureSignals({
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
  const unitId = booking?.unitId ? String(booking.unitId) : null;
  const cabinTypeId = booking?.cabinTypeId ? String(booking.cabinTypeId) : null;
  const sourceReference =
    (checkoutId && String(checkoutId).trim()) ||
    (booking?.checkoutId && String(booking.checkoutId).trim()) ||
    bookingId;

  let manualReviewItemId = null;
  try {
    const mri = await openManualReviewItemFn({
      category: MRI_CATEGORY,
      severity: 'high',
      entityType: 'Booking',
      entityId: bookingId,
      title: 'UnitNightClaim shadow dual-write failed',
      details: errorSummary || 'Shadow UnitNightClaim write failed after canonical Booking allocation',
      provenance: {
        source: MRI_SOURCE,
        sourceReference: sourceReference || null
      },
      evidence: {
        errorCode: errorCode || null,
        unitId,
        cabinTypeId,
        checkIn: booking?.checkIn || null,
        checkOut: booking?.checkOut || null,
        claimSource,
        checkoutId: checkoutId ? String(checkoutId) : booking?.checkoutId || null,
        paymentIntentId: paymentIntentId ? String(paymentIntentId) : null,
        ...details
      }
    });
    manualReviewItemId = mri?._id ? String(mri._id) : null;
  } catch {
    /* MRI must never fail the caller */
  }

  let paymentResolutionIssueId = null;
  if (paymentIntentId && typeof recordPriFn === 'function') {
    try {
      const issue = await recordPriFn({
        issueType: 'paid_booking_unknown_failure',
        errorCode: errorCode || 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE',
        errorSummary: errorSummary || 'UnitNightClaim shadow dual-write failed',
        paymentIntentId: String(paymentIntentId).trim(),
        checkoutId:
          (checkoutId && String(checkoutId).trim()) ||
          (booking?.checkoutId ? String(booking.checkoutId) : null),
        bookingId,
        unitId,
        finalizationStage: PAID_BOOKING_FINALIZATION_STAGES.UNIT_NIGHT_CLAIM_SHADOW,
        failureSource: MRI_SOURCE,
        // Only assert verified when the caller explicitly verified payment.
        stripePaymentVerified:
          stripePaymentVerified == null ? null : Boolean(stripePaymentVerified)
      });
      paymentResolutionIssueId = issue?._id ? String(issue._id) : null;
    } catch {
      /* PRI must never fail the caller */
    }
  }

  return { manualReviewItemId, paymentResolutionIssueId };
}

/**
 * Ensure shadow UnitNightClaims for a Booking that has already survived canonical allocation.
 * Never throws for claim/MRI/PRI failures — returns a structured outcome instead.
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
  loadUnitFn = null
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
    return outcomeBase({
      outcome: SHADOW_OUTCOMES.INVALID_ALLOCATION,
      source: claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'Booking is required'
    });
  }

  const bookingId = String(booking._id);
  const cabinTypeId = booking.cabinTypeId ? String(booking.cabinTypeId) : null;
  const unitId = booking.unitId ? String(booking.unitId) : null;

  if (!cabinTypeId) {
    return outcomeBase({
      ok: true,
      outcome: SHADOW_OUTCOMES.SKIPPED_NOT_MULTI_UNIT,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!unitId) {
    return outcomeBase({
      ok: true,
      outcome: SHADOW_OUTCOMES.SKIPPED_UNALLOCATED,
      bookingId,
      unitId: null,
      cabinTypeId,
      source: claimSource
    });
  }

  if (!booking.checkIn || !booking.checkOut) {
    const signals = await recordShadowFailureSignals({
      booking,
      claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorSummary: 'Allocated multi-unit Booking missing checkIn/checkOut for shadow claims',
      ...signalOpts
    });
    return outcomeBase({
      outcome: SHADOW_OUTCOMES.INVALID_ALLOCATION,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'Missing checkIn/checkOut',
      ...signals
    });
  }

  // Soft integrity: Unit must belong to Booking.cabinTypeId (nonfatal).
  let cabinTypeMismatch = false;
  try {
    const loadUnit =
      loadUnitFn ||
      (async (id) => Unit.findById(id).select('cabinTypeId').lean());
    const unitDoc = await loadUnit(unitId);
    if (
      unitDoc?.cabinTypeId &&
      String(unitDoc.cabinTypeId) !== String(cabinTypeId)
    ) {
      cabinTypeMismatch = true;
    }
  } catch {
    /* unit lookup failure is nonfatal; claim attempt may still proceed */
  }

  if (cabinTypeMismatch) {
    const signals = await recordShadowFailureSignals({
      booking,
      claimSource,
      errorCode: 'UNIT_CABIN_TYPE_MISMATCH',
      errorSummary: 'Booking.unitId does not belong to Booking.cabinTypeId (shadow integrity)',
      details: { integrity: 'cabin_type_mismatch' },
      ...signalOpts
    });
    // Still attempt claim — Booking is canonical; claims are shadow evidence.
    try {
      const result = await claimUnitNightsFn({
        bookingId,
        unitId,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        source: claimSource
      });
      return outcomeBase({
        ok: true,
        outcome: SHADOW_OUTCOMES.INTEGRITY_CABIN_TYPE_MISMATCH,
        bookingId,
        unitId,
        cabinTypeId,
        source: claimSource,
        nights: result.nights || [],
        insertedCount: result.insertedCount || 0,
        alreadyOwnedCount: result.alreadyOwnedCount || 0,
        errorCode: 'UNIT_CABIN_TYPE_MISMATCH',
        errorMessage: 'Unit cabinType mismatch with Booking',
        ...signals
      });
    } catch (claimErr) {
      const code = claimErr?.code || 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE';
      const extra = await recordShadowFailureSignals({
        booking,
        claimSource,
        errorCode: code,
        errorSummary: claimErr?.message || 'Shadow claim failed after cabinType mismatch',
        details: {
          integrity: 'cabin_type_mismatch',
          conflicts: claimErr?.details?.conflicts || null
        },
        ...signalOpts
      });
      return outcomeBase({
        outcome:
          code === CLAIM_ERR.FOREIGN_OWNER
            ? SHADOW_OUTCOMES.FOREIGN_OWNER
            : code === CLAIM_ERR.VALIDATION
              ? SHADOW_OUTCOMES.INVALID_ALLOCATION
              : SHADOW_OUTCOMES.WRITE_FAILURE,
        bookingId,
        unitId,
        cabinTypeId,
        source: claimSource,
        errorCode: code,
        errorMessage: claimErr?.message || String(claimErr),
        manualReviewItemId: extra.manualReviewItemId || signals.manualReviewItemId,
        paymentResolutionIssueId:
          extra.paymentResolutionIssueId || signals.paymentResolutionIssueId
      });
    }
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
      outcome: already ? SHADOW_OUTCOMES.ALREADY_OWNED : SHADOW_OUTCOMES.CLAIMED,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      nights: result.nights || [],
      insertedCount: result.insertedCount || 0,
      alreadyOwnedCount: result.alreadyOwnedCount || 0
    });
  } catch (err) {
    const code = err?.code || 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE';
    let outcome = SHADOW_OUTCOMES.WRITE_FAILURE;
    if (code === CLAIM_ERR.FOREIGN_OWNER) outcome = SHADOW_OUTCOMES.FOREIGN_OWNER;
    else if (code === CLAIM_ERR.VALIDATION) outcome = SHADOW_OUTCOMES.INVALID_ALLOCATION;

    const signals = await recordShadowFailureSignals({
      booking,
      claimSource,
      errorCode: code,
      errorSummary: err?.message || 'UnitNightClaim shadow dual-write failed',
      details: {
        conflicts: err?.details?.conflicts || null
      },
      ...signalOpts
    });

    return outcomeBase({
      outcome,
      bookingId,
      unitId,
      cabinTypeId,
      source: claimSource,
      errorCode: code,
      errorMessage: err?.message || String(err),
      ...signals
    });
  }
}

/**
 * Ensure shadow claims for many Bookings (e.g. location children). Failures are isolated.
 */
async function ensureUnitNightClaimsShadowForBookings(bookings, options = {}) {
  const results = [];
  for (const booking of bookings || []) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await ensureUnitNightClaimsShadow({ ...options, booking }));
  }
  return results;
}

module.exports = {
  ensureUnitNightClaimsShadow,
  ensureUnitNightClaimsShadowForBookings,
  resolveClaimSource,
  SHADOW_OUTCOMES,
  I2_SOURCES,
  MRI_CATEGORY,
  MRI_SOURCE
};
