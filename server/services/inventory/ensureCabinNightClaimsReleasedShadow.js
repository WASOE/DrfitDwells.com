'use strict';

/**
 * REBOOK-S1.2 CabinNightClaim shadow release helper.
 * Never throws — structured outcome + low-PII log on failure.
 */

const { releaseCabinNights } = require('./cabinNightClaimService');
const { isCabinNightClaimShadowEnabled } = require('./cabinNightClaimMode');
const {
  SHADOW_EVENTS,
  emitCabinNightClaimShadowEvent
} = require('./cabinNightClaimObservability');

const RELEASE_OUTCOMES = Object.freeze({
  SKIPPED_OFF: 'skipped_off',
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
    ...partial
  };
}

async function ensureCabinNightClaimsReleasedShadow({
  booking = null,
  bookingId = null,
  lifecycleSource = 'status_release',
  releaseCabinNightsFn = releaseCabinNights,
  mode = null
} = {}) {
  if (!isCabinNightClaimShadowEnabled(mode)) {
    return outcomeBase({
      ok: true,
      outcome: RELEASE_OUTCOMES.SKIPPED_OFF,
      lifecycleSource
    });
  }

  const id =
    bookingId != null && String(bookingId).trim()
      ? String(bookingId).trim()
      : booking?._id
        ? String(booking._id)
        : null;
  const source = String(lifecycleSource || 'status_release').trim() || 'status_release';

  if (!id) {
    return outcomeBase({
      outcome: RELEASE_OUTCOMES.INVALID_BOOKING_ID,
      lifecycleSource: source,
      errorCode: 'CABIN_NIGHT_CLAIM_VALIDATION',
      errorMessage: 'bookingId is required'
    });
  }

  try {
    const released = await releaseCabinNightsFn({ bookingId: id });
    const deletedCount = Number(released.deletedCount || 0);
    return outcomeBase({
      ok: true,
      outcome: deletedCount > 0 ? RELEASE_OUTCOMES.RELEASED : RELEASE_OUTCOMES.ALREADY_EMPTY,
      bookingId: id,
      lifecycleSource: source,
      deletedCount
    });
  } catch (err) {
    const code = err?.code || 'CABIN_NIGHT_CLAIM_SHADOW_RELEASE_FAILURE';
    emitCabinNightClaimShadowEvent(SHADOW_EVENTS.SHADOW_RELEASE_FAILED, {
      bookingId: id,
      writer: source,
      errorCode: code,
      message: err?.message || String(err)
    });
    return outcomeBase({
      outcome: RELEASE_OUTCOMES.WRITE_FAILURE,
      bookingId: id,
      lifecycleSource: source,
      errorCode: code,
      errorMessage: err?.message || String(err)
    });
  }
}

module.exports = {
  ensureCabinNightClaimsReleasedShadow,
  RELEASE_OUTCOMES
};
