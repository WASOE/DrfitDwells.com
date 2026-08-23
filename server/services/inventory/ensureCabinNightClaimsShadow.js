'use strict';

/**
 * REBOOK-S1.2 CabinNightClaim shadow mirror (post-canonical Booking survival).
 * Booking remains canonical; shadow failures never throw by default.
 */

const {
  claimCabinNights,
  ERR: CLAIM_ERR,
  ACQUISITION_MODES
} = require('./cabinNightClaimService');
const { isCabinNightClaimShadowEnabled } = require('./cabinNightClaimMode');
const {
  shouldBookingOwnCabinNightClaims,
  describeBookingClaimShape
} = require('./cabinNightClaimQualification');
const {
  SHADOW_EVENTS,
  emitCabinNightClaimShadowEvent
} = require('./cabinNightClaimObservability');

const SHADOW_OUTCOMES = Object.freeze({
  SKIPPED_OFF: 'skipped_off',
  SKIPPED_NOT_QUALIFIED: 'skipped_not_qualified',
  MIRRORED: 'mirrored',
  ALREADY_OWNED: 'already_owned',
  FOREIGN_OWNER: 'foreign_owner',
  STAY_CHANGE_CONFLICT: 'stay_change_conflict',
  WRITE_FAILURE: 'write_failure',
  INVALID_BOOKING: 'invalid_booking'
});

const S1_SOURCES = Object.freeze({
  FINALIZE: 'finalize',
  LEGACY_CREATE: 'legacy_create',
  MANUAL_RESERVATION: 'manual_reservation',
  LOCATION_CHILD: 'location_child',
  RECOVERY: 'recovery'
});

function outcomeBase(partial) {
  return {
    ok: false,
    outcome: SHADOW_OUTCOMES.WRITE_FAILURE,
    bookingId: null,
    cabinId: null,
    source: null,
    nights: [],
    insertedCount: 0,
    alreadyOwnedCount: 0,
    errorCode: null,
    errorMessage: null,
    ...partial
  };
}

function resolveMirrorSource(source) {
  const raw = String(source || '').trim();
  if (raw === S1_SOURCES.LEGACY_CREATE) return S1_SOURCES.LEGACY_CREATE;
  if (raw === S1_SOURCES.MANUAL_RESERVATION) return S1_SOURCES.MANUAL_RESERVATION;
  if (raw === S1_SOURCES.LOCATION_CHILD) return S1_SOURCES.LOCATION_CHILD;
  if (raw === S1_SOURCES.RECOVERY || raw === 'multi_unit_recovery') return S1_SOURCES.RECOVERY;
  if (
    raw === 'frontend' ||
    raw === 'webhook_worker' ||
    raw === 'reconcile' ||
    raw === 'manual' ||
    raw === S1_SOURCES.FINALIZE ||
    raw === ''
  ) {
    return S1_SOURCES.FINALIZE;
  }
  return raw || S1_SOURCES.FINALIZE;
}

function idish(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object' && value._id != null) return String(value._id);
  return String(value);
}

async function ensureCabinNightClaimsShadow({
  booking,
  source = S1_SOURCES.FINALIZE,
  claimCabinNightsFn = claimCabinNights,
  mode = null,
  throwOnFailure = false
} = {}) {
  if (!isCabinNightClaimShadowEnabled(mode)) {
    return outcomeBase({
      ok: true,
      outcome: SHADOW_OUTCOMES.SKIPPED_OFF,
      source: resolveMirrorSource(source)
    });
  }

  const claimSource = resolveMirrorSource(source);

  if (!booking || !booking._id) {
    const out = outcomeBase({
      outcome: SHADOW_OUTCOMES.INVALID_BOOKING,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
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
  const cabinId = idish(booking.cabinId);

  if (!shouldBookingOwnCabinNightClaims(booking)) {
    return outcomeBase({
      ok: true,
      outcome: SHADOW_OUTCOMES.SKIPPED_NOT_QUALIFIED,
      bookingId,
      cabinId,
      source: claimSource,
      errorCode: 'SKIPPED',
      errorMessage: describeBookingClaimShape(booking)
    });
  }

  if (!booking.checkIn || !booking.checkOut) {
    emitCabinNightClaimShadowEvent(SHADOW_EVENTS.SHADOW_INVALID_BOOKING_SHAPE, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      message: 'Missing checkIn/checkOut for shadow mirror'
    });
    const out = outcomeBase({
      outcome: SHADOW_OUTCOMES.INVALID_BOOKING,
      bookingId,
      cabinId,
      source: claimSource,
      errorCode: CLAIM_ERR.VALIDATION,
      errorMessage: 'Missing checkIn/checkOut'
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
    const result = await claimCabinNightsFn({
      cabinId,
      bookingId,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      source: claimSource,
      acquisitionMode: ACQUISITION_MODES.SHADOW
    });
    const already =
      Number(result.insertedCount || 0) === 0 && Number(result.alreadyOwnedCount || 0) > 0;
    return outcomeBase({
      ok: true,
      outcome: already ? SHADOW_OUTCOMES.ALREADY_OWNED : SHADOW_OUTCOMES.MIRRORED,
      bookingId,
      cabinId,
      source: claimSource,
      nights: result.nights || [],
      insertedCount: result.insertedCount || 0,
      alreadyOwnedCount: result.alreadyOwnedCount || 0
    });
  } catch (err) {
    const code = err?.code || 'CABIN_NIGHT_CLAIM_SHADOW_FAILURE';
    let outcome = SHADOW_OUTCOMES.WRITE_FAILURE;
    let event = SHADOW_EVENTS.SHADOW_CLAIM_FAILED;
    if (code === CLAIM_ERR.FOREIGN_OWNER) {
      outcome = SHADOW_OUTCOMES.FOREIGN_OWNER;
      event = SHADOW_EVENTS.SHADOW_FOREIGN_OWNER;
    } else if (code === CLAIM_ERR.STAY_CHANGE_OWNERSHIP_CONFLICT) {
      outcome = SHADOW_OUTCOMES.STAY_CHANGE_CONFLICT;
      event = SHADOW_EVENTS.SHADOW_STAYCHANGE_CONFLICT;
    }
    emitCabinNightClaimShadowEvent(event, {
      bookingId,
      cabinId,
      writer: claimSource,
      errorCode: code,
      outcome,
      message: err?.message || String(err)
    });
    const out = outcomeBase({
      outcome,
      bookingId,
      cabinId,
      source: claimSource,
      errorCode: code,
      errorMessage: err?.message || String(err)
    });
    if (throwOnFailure) {
      err.claimOutcome = out;
      throw err;
    }
    return out;
  }
}

module.exports = {
  ensureCabinNightClaimsShadow,
  SHADOW_OUTCOMES,
  S1_SOURCES,
  resolveMirrorSource
};
