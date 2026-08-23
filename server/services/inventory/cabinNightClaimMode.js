'use strict';

/**
 * CabinNightClaim runtime mode (REBOOK-S1.2).
 * Binding: docs/stay-change-implementation-plan.md — §24.16.
 *
 * off     — no CabinNightClaim writes
 * shadow  — dual-write; Booking remains canonical
 * authoritative — NOT implemented until S1.7 (rejected if requested)
 */

const MODES = Object.freeze({
  OFF: 'off',
  SHADOW: 'shadow',
  AUTHORITATIVE: 'authoritative'
});

const SUPPORTED_MODES = new Set([MODES.OFF, MODES.SHADOW]);

function normalizeMode(raw) {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!value || value === MODES.OFF) return MODES.OFF;
  if (value === MODES.SHADOW) return MODES.SHADOW;
  if (value === MODES.AUTHORITATIVE) {
    const err = new Error(
      'CabinNightClaim authoritative mode is not enabled until S1.7 cutover'
    );
    err.code = 'CABIN_NIGHT_CLAIM_MODE_UNSUPPORTED';
    err.requestedMode = MODES.AUTHORITATIVE;
    throw err;
  }
  const err = new Error(`Unsupported CABIN_NIGHT_CLAIM_MODE: ${value}`);
  err.code = 'CABIN_NIGHT_CLAIM_MODE_INVALID';
  err.requestedMode = value;
  throw err;
}

function readConfiguredMode() {
  return normalizeMode(process.env.CABIN_NIGHT_CLAIM_MODE);
}

function isCabinNightClaimShadowEnabled(mode = null) {
  const resolved = mode == null ? readConfiguredMode() : normalizeMode(mode);
  return resolved === MODES.SHADOW;
}

function isCabinNightClaimWritesEnabled(mode = null) {
  return isCabinNightClaimShadowEnabled(mode);
}

module.exports = {
  MODES,
  SUPPORTED_MODES,
  normalizeMode,
  readConfiguredMode,
  isCabinNightClaimShadowEnabled,
  isCabinNightClaimWritesEnabled
};
