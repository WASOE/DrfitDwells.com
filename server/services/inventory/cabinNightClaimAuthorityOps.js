'use strict';

/**
 * REBOOK-S1.7 mode-aware CabinNightClaim orchestration helpers.
 * Binding: docs/stay-change-implementation-plan.md — §24.44
 *
 * Pre-canonical acquire only when authoritative.
 * Shadow post-canonical mirror remains ensureCabinNightClaimsShadow.
 * Release runs for shadow + authoritative once Booking is non-owning.
 */

const {
  claimCabinNights,
  releaseCabinNights,
  compensateCabinClaimAttempt,
  assertAuthoritativeCabinNightIndex,
  assertBookingOwnsCabinNights,
  ERR: CLAIM_ERR,
  ACQUISITION_MODES
} = require('./cabinNightClaimService');
const {
  getCabinNightClaimMode,
  isCabinNightClaimAuthoritativeEnabled,
  isCabinNightClaimShadowEnabled,
  isCabinNightClaimWritesEnabled,
  MODES
} = require('./cabinNightClaimMode');
const {
  shouldBookingOwnCabinNightClaims,
  isValidSingleCabinCommercialShape,
  describeBookingClaimShape
} = require('./cabinNightClaimQualification');
const {
  AUTHORITY_EVENTS,
  emitCabinNightClaimAuthorityEvent
} = require('./cabinNightClaimObservability');
const { ensureCabinNightClaimsShadow } = require('./ensureCabinNightClaimsShadow');
const { ensureCabinNightClaimsReleasedShadow } = require('./ensureCabinNightClaimsReleasedShadow');

function idish(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

function emptyAcquireSkipped(reason) {
  return {
    ok: true,
    skipped: true,
    reason,
    insertedCount: 0,
    alreadyOwnedCount: 0,
    insertedNightsThisAttempt: [],
    insertedClaimIdsThisAttempt: [],
    nights: []
  };
}

/**
 * Pre-canonical target acquisition for CREATE (finalize/legacy/manual/location).
 * Authoritative only. Shadow/off return skipped (caller must not claim-first).
 */
async function preAcquireCabinNightsForCreate({
  bookingId,
  cabinId,
  checkIn,
  checkOut,
  nights = null,
  source,
  mode = null,
  claimCabinNightsFn = claimCabinNights
} = {}) {
  if (!isCabinNightClaimAuthoritativeEnabled(mode)) {
    return emptyAcquireSkipped(
      isCabinNightClaimShadowEnabled(mode) ? 'shadow_post_canonical' : 'off'
    );
  }

  const bookingOid = idish(bookingId);
  const cabinOid = idish(cabinId);
  if (!bookingOid || !cabinOid) {
    const err = new Error('bookingId and cabinId are required for authoritative pre-acquire');
    err.code = CLAIM_ERR.VALIDATION;
    throw err;
  }

  try {
    const result = await claimCabinNightsFn({
      cabinId: cabinOid,
      bookingId: bookingOid,
      checkIn,
      checkOut,
      nights,
      source,
      acquisitionMode: ACQUISITION_MODES.AUTHORITATIVE
    });
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_ACQUIRED, {
      bookingId: bookingOid,
      cabinId: cabinOid,
      writer: source,
      insertedCount: result.insertedCount,
      alreadyOwnedCount: result.alreadyOwnedCount,
      nightCount: (result.nights || []).length
    });
    return {
      ok: true,
      skipped: false,
      ...result
    };
  } catch (err) {
    const code = err?.code || CLAIM_ERR.INTEGRITY;
    if (code === CLAIM_ERR.FOREIGN_OWNER || code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT) {
      emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_CONFLICT, {
        bookingId: bookingOid,
        cabinId: cabinOid,
        writer: source,
        errorCode: code,
        message: err?.message || String(err)
      });
    } else if (code === CLAIM_ERR.INDEX_MISSING || code === CLAIM_ERR.INDEX_WRONG) {
      emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_INDEX_UNAVAILABLE, {
        bookingId: bookingOid,
        cabinId: cabinOid,
        writer: source,
        errorCode: code,
        message: err?.message || String(err)
      });
    }
    throw err;
  }
}

/**
 * Authoritative acquire of specific nights (date-edit newOnly / reassign target).
 */
async function preAcquireCabinNightsForMutation({
  bookingId,
  cabinId,
  nights,
  source,
  mode = null,
  claimCabinNightsFn = claimCabinNights
} = {}) {
  if (!isCabinNightClaimAuthoritativeEnabled(mode)) {
    return emptyAcquireSkipped(
      isCabinNightClaimShadowEnabled(mode) ? 'shadow_post_canonical' : 'off'
    );
  }
  if (!Array.isArray(nights) || nights.length === 0) {
    return emptyAcquireSkipped('no_new_nights');
  }
  return preAcquireCabinNightsForCreate({
    bookingId,
    cabinId,
    nights,
    source,
    mode,
    claimCabinNightsFn
  });
}

async function compensateCreateAttemptClaims({
  attempt,
  writer,
  bookingId = null,
  cabinId = null,
  compensateFn = compensateCabinClaimAttempt,
  openManualReviewItemFn = null
} = {}) {
  const ids = attempt?.insertedClaimIdsThisAttempt || [];
  if (!ids.length) {
    return { ok: true, deletedCount: 0, compensated: false };
  }
  try {
    const result = await compensateFn({ insertedClaimIdsThisAttempt: ids });
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_COMPENSATED, {
      bookingId,
      cabinId,
      writer,
      insertedCount: ids.length,
      nightCount: (attempt.insertedNightsThisAttempt || []).length
    });
    return { ok: true, compensated: true, ...result };
  } catch (err) {
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_COMPENSATION_FAILED, {
      bookingId,
      cabinId,
      writer,
      errorCode: err?.code || CLAIM_ERR.COMPENSATION_FAILED,
      needsReconciliation: true,
      message: err?.message || String(err)
    });
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED, {
      bookingId,
      cabinId,
      writer,
      errorCode: err?.code || CLAIM_ERR.COMPENSATION_FAILED,
      needsReconciliation: true,
      message: 'Compensation failed after pre-canonical claim; conservative claims retained'
    });
    if (typeof openManualReviewItemFn === 'function' && bookingId) {
      try {
        await openManualReviewItemFn({
          category: 'cabin_night_claim_authority_failure',
          severity: 'critical',
          entityType: 'Booking',
          entityId: String(bookingId),
          title: 'CabinNightClaim compensation failed',
          details: err?.message || 'Compensation failed after Booking persist failure',
          provenance: {
            source: 'cabin_night_claim_authority',
            sourceReference: `${String(bookingId)}:${writer || 'compensate'}`
          },
          evidence: {
            operation: 'compensate',
            errorCode: err?.code || null,
            cabinId: cabinId ? String(cabinId) : null,
            insertedClaimIdsThisAttempt: ids
          }
        });
      } catch {
        /* MRI best-effort */
      }
    }
    return {
      ok: false,
      compensated: false,
      needsReconciliation: true,
      error: err
    };
  }
}

/**
 * Post-canonical shadow mirror. No-op in authoritative (claims already acquired)
 * and off.
 */
async function postMirrorCabinNightsAfterCanonical({
  booking,
  source,
  mode = null,
  throwOnFailure = false
} = {}) {
  if (isCabinNightClaimAuthoritativeEnabled(mode)) {
    return {
      ok: true,
      skipped: true,
      reason: 'authoritative_preclaimed',
      outcome: 'skipped_authoritative'
    };
  }
  return ensureCabinNightClaimsShadow({
    booking,
    source,
    mode,
    throwOnFailure
  });
}

/**
 * Release after Booking is durably non-owning.
 * Shadow: best-effort non-throwing.
 * Authoritative: attempts release; on failure emits recon evidence (never reopens Booking).
 */
async function releaseCabinNightsAfterCanonicalNonOwning({
  booking = null,
  bookingId = null,
  lifecycleSource = 'status_release',
  mode = null,
  throwOnFailure = false,
  openManualReviewItemFn = null
} = {}) {
  const resolved = getCabinNightClaimMode(mode);
  if (resolved === MODES.OFF) {
    return {
      ok: true,
      outcome: 'skipped_off',
      deletedCount: 0
    };
  }

  if (resolved === MODES.SHADOW) {
    return ensureCabinNightClaimsReleasedShadow({
      booking,
      bookingId,
      lifecycleSource,
      mode
    });
  }

  // authoritative
  const id =
    bookingId != null && String(bookingId).trim()
      ? String(bookingId).trim()
      : booking?._id
        ? String(booking._id)
        : null;
  const source = String(lifecycleSource || 'status_release').trim() || 'status_release';
  if (!id) {
    return {
      ok: false,
      outcome: 'invalid_booking_id',
      deletedCount: 0,
      errorCode: CLAIM_ERR.VALIDATION
    };
  }

  try {
    const released = await releaseCabinNights({ bookingId: id });
    return {
      ok: true,
      outcome: Number(released.deletedCount || 0) > 0 ? 'released' : 'already_empty',
      bookingId: id,
      lifecycleSource: source,
      deletedCount: Number(released.deletedCount || 0),
      needsReconciliation: false
    };
  } catch (err) {
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_RELEASE_FAILED, {
      bookingId: id,
      writer: source,
      errorCode: err?.code || CLAIM_ERR.INTEGRITY,
      needsReconciliation: true,
      message: err?.message || String(err)
    });
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED, {
      bookingId: id,
      writer: source,
      errorCode: err?.code || CLAIM_ERR.INTEGRITY,
      needsReconciliation: true,
      message: 'Claim release failed after canonical non-owning transition'
    });
    if (typeof openManualReviewItemFn === 'function') {
      try {
        await openManualReviewItemFn({
          category: 'cabin_night_claim_authority_failure',
          severity: 'critical',
          entityType: 'Booking',
          entityId: id,
          title: 'CabinNightClaim release failed after terminal/archive',
          details: err?.message || 'Owner-scoped release failed',
          provenance: {
            source: 'cabin_night_claim_authority',
            sourceReference: `${id}:${source}`
          },
          evidence: {
            operation: 'release',
            errorCode: err?.code || null,
            lifecycleSource: source
          }
        });
      } catch {
        /* MRI best-effort */
      }
    }
    const out = {
      ok: false,
      outcome: 'write_failure',
      bookingId: id,
      lifecycleSource: source,
      deletedCount: 0,
      needsReconciliation: true,
      errorCode: err?.code || CLAIM_ERR.INTEGRITY,
      errorMessage: err?.message || String(err)
    };
    if (throwOnFailure) {
      const e = new Error(out.errorMessage);
      e.code = out.errorCode;
      e.needsReconciliation = true;
      e.releaseOutcome = out;
      throw e;
    }
    return out;
  }
}

async function releaseSurplusCabinNightsAuthoritative({
  bookingId,
  cabinId,
  nights,
  writer = 'date_edit',
  mode = null
} = {}) {
  if (!isCabinNightClaimAuthoritativeEnabled(mode)) {
    return { ok: true, skipped: true, deletedCount: 0 };
  }
  if (!Array.isArray(nights) || nights.length === 0) {
    return { ok: true, skipped: true, deletedCount: 0 };
  }
  try {
    const released = await releaseCabinNights({
      bookingId,
      cabinId,
      nights
    });
    return { ok: true, deletedCount: Number(released.deletedCount || 0) };
  } catch (err) {
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_CLAIM_RELEASE_FAILED, {
      bookingId: idish(bookingId),
      cabinId: idish(cabinId),
      writer,
      errorCode: err?.code || CLAIM_ERR.INTEGRITY,
      needsReconciliation: true,
      nightCount: nights.length,
      message: err?.message || String(err)
    });
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_RECONCILIATION_REQUIRED, {
      bookingId: idish(bookingId),
      cabinId: idish(cabinId),
      writer,
      needsReconciliation: true,
      message: 'Surplus claim release failed; Booking remains on target ownership'
    });
    return {
      ok: false,
      needsReconciliation: true,
      deletedCount: 0,
      error: err
    };
  }
}

function bookingQualifiesForSingleCabinAuthority(booking) {
  return shouldBookingOwnCabinNightClaims(booking);
}

function bookingIsValidSingleCabinShape(booking) {
  return isValidSingleCabinCommercialShape(booking);
}

module.exports = {
  preAcquireCabinNightsForCreate,
  preAcquireCabinNightsForMutation,
  compensateCreateAttemptClaims,
  postMirrorCabinNightsAfterCanonical,
  releaseCabinNightsAfterCanonicalNonOwning,
  releaseSurplusCabinNightsAuthoritative,
  bookingQualifiesForSingleCabinAuthority,
  bookingIsValidSingleCabinShape,
  describeBookingClaimShape,
  assertBookingOwnsCabinNights,
  assertAuthoritativeCabinNightIndex,
  CLAIM_ERR,
  ACQUISITION_MODES,
  isCabinNightClaimAuthoritativeEnabled,
  isCabinNightClaimShadowEnabled,
  isCabinNightClaimWritesEnabled,
  getCabinNightClaimMode
};
