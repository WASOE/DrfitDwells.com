'use strict';

/**
 * I4 shadow UnitNightClaim terminal / delete release helper.
 *
 * Binding: docs/stay-change-implementation-plan.md — I4 release semantics.
 * Claims remain SHADOW / non-authoritative.
 * Failure never rolls back a valid cancel/complete/delete decision.
 */

const {
  releaseUnitNights
} = require('./unitNightClaimService');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const {
  MRI_CATEGORY,
  MRI_SOURCE
} = require('./ensureUnitNightClaimsShadow');

const LIFECYCLE_SOURCES = Object.freeze({
  CANCEL: 'cancel',
  COMPLETE: 'complete',
  BOOKING_DELETE: 'booking_delete',
  LOCATION_ROLLBACK: 'location_rollback',
  FINALIZE_CLEANUP: 'finalize_cleanup',
  MAINTENANCE_DELETE: 'maintenance_delete',
  // Reserved for I5 — not an I4 writer.
  REPAIR: 'repair'
});

const RELEASE_OUTCOMES = Object.freeze({
  RELEASED: 'released',
  ALREADY_EMPTY: 'already_empty',
  WRITE_FAILURE: 'write_failure',
  INVALID_BOOKING_ID: 'invalid_booking_id'
});

function outcomeBase(partial) {
  return {
    ok: false,
    outcome: RELEASE_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    lifecycleSource: null,
    deletedCount: 0,
    errorCode: null,
    errorMessage: null,
    manualReviewItemId: null,
    ...partial
  };
}

function resolveLifecycleSource(raw) {
  const s = String(raw || '').trim();
  const values = Object.values(LIFECYCLE_SOURCES);
  if (values.includes(s)) return s;
  return s || LIFECYCLE_SOURCES.BOOKING_DELETE;
}

async function recordReleaseFailureMri({
  bookingId,
  lifecycleSource,
  errorCode,
  errorSummary,
  details = {},
  openManualReviewItemFn
}) {
  try {
    const sourceReference = bookingId ? `${String(bookingId)}:release` : null;
    const mri = await openManualReviewItemFn({
      category: MRI_CATEGORY,
      severity: 'high',
      entityType: 'Booking',
      entityId: bookingId,
      title: 'UnitNightClaim shadow release failed',
      details: errorSummary || 'Shadow UnitNightClaim release failed after canonical lifecycle',
      provenance: {
        source: MRI_SOURCE,
        sourceReference
      },
      evidence: {
        operation: 'release',
        lifecycleSource,
        bookingId,
        errorCode: errorCode || null,
        ...details
      }
    });
    return mri?._id ? String(mri._id) : null;
  } catch {
    return null;
  }
}

/**
 * Release ALL UnitNightClaims owned by bookingId (terminal / delete lifecycle).
 * Never throws for claim/MRI failures — returns a structured outcome.
 */
async function ensureUnitNightClaimsReleasedShadow({
  booking = null,
  bookingId = null,
  lifecycleSource,
  releaseUnitNightsFn = releaseUnitNights,
  openManualReviewItemFn = openManualReviewItem
} = {}) {
  const id =
    bookingId != null && String(bookingId).trim()
      ? String(bookingId).trim()
      : booking?._id
        ? String(booking._id)
        : null;
  const source = resolveLifecycleSource(lifecycleSource);

  if (!id) {
    return outcomeBase({
      outcome: RELEASE_OUTCOMES.INVALID_BOOKING_ID,
      lifecycleSource: source,
      errorCode: 'UNIT_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'bookingId is required'
    });
  }

  try {
    const released = await releaseUnitNightsFn({ bookingId: id });
    const deletedCount = Number(released.deletedCount || 0);
    return outcomeBase({
      ok: true,
      outcome: deletedCount > 0 ? RELEASE_OUTCOMES.RELEASED : RELEASE_OUTCOMES.ALREADY_EMPTY,
      bookingId: id,
      lifecycleSource: source,
      deletedCount
    });
  } catch (err) {
    const code = err?.code || 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE';
    const manualReviewItemId = await recordReleaseFailureMri({
      bookingId: id,
      lifecycleSource: source,
      errorCode: code,
      errorSummary: err?.message || 'Shadow UnitNightClaim release failed',
      details: {
        conflicts: err?.details?.conflicts || null
      },
      openManualReviewItemFn
    });
    return outcomeBase({
      outcome: RELEASE_OUTCOMES.WRITE_FAILURE,
      bookingId: id,
      lifecycleSource: source,
      errorCode: code,
      errorMessage: err?.message || String(err),
      manualReviewItemId
    });
  }
}

module.exports = {
  ensureUnitNightClaimsReleasedShadow,
  LIFECYCLE_SOURCES,
  RELEASE_OUTCOMES,
  MRI_CATEGORY,
  MRI_SOURCE
};
