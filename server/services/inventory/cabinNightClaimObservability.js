'use strict';

const SHADOW_EVENTS = Object.freeze({
  SHADOW_CLAIM_FAILED: 'shadow_claim_failed',
  SHADOW_FOREIGN_OWNER: 'shadow_foreign_owner',
  SHADOW_STAYCHANGE_CONFLICT: 'shadow_staychange_conflict',
  SHADOW_RELEASE_FAILED: 'shadow_release_failed',
  SHADOW_MIRROR_MISMATCH: 'shadow_mirror_mismatch',
  SHADOW_INVALID_BOOKING_SHAPE: 'shadow_invalid_booking_shape'
});

function emitCabinNightClaimShadowEvent(event, payload = {}) {
  const safe = {
    component: 'cabin_night_claim_shadow',
    event: String(event || 'shadow_unknown'),
    bookingId: payload.bookingId ? String(payload.bookingId) : null,
    cabinId: payload.cabinId ? String(payload.cabinId) : null,
    writer: payload.writer || payload.source || null,
    errorCode: payload.errorCode || null,
    outcome: payload.outcome || null,
    nightCount: Number.isFinite(payload.nightCount) ? payload.nightCount : null,
    night: payload.night || null,
    message: payload.message || null
  };
  console.error(JSON.stringify(safe));
}

module.exports = {
  SHADOW_EVENTS,
  emitCabinNightClaimShadowEvent
};
