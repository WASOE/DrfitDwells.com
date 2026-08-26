'use strict';

/**
 * CabinNightClaim runtime mode (REBOOK-S1.2 / S1.7).
 * Binding: docs/stay-change-implementation-plan.md — §24.16 / §24.44.3.
 *
 * off          — no CabinNightClaim writes
 * shadow       — dual-write; Booking remains canonical (S1.2)
 * authoritative — claim-first hard barrier (S1.7)
 */

const MODES = Object.freeze({
  OFF: 'off',
  SHADOW: 'shadow',
  AUTHORITATIVE: 'authoritative'
});

const SUPPORTED_MODES = new Set([MODES.OFF, MODES.SHADOW, MODES.AUTHORITATIVE]);

function normalizeMode(raw) {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!value || value === MODES.OFF) return MODES.OFF;
  if (value === MODES.SHADOW) return MODES.SHADOW;
  if (value === MODES.AUTHORITATIVE) return MODES.AUTHORITATIVE;
  const err = new Error(`Unsupported CABIN_NIGHT_CLAIM_MODE: ${value}`);
  err.code = 'CABIN_NIGHT_CLAIM_MODE_INVALID';
  err.requestedMode = value;
  throw err;
}

function readConfiguredMode(env = process.env) {
  return normalizeMode(env.CABIN_NIGHT_CLAIM_MODE);
}

function getCabinNightClaimMode(mode = null, env = process.env) {
  return mode == null ? readConfiguredMode(env) : normalizeMode(mode);
}

function isCabinNightClaimOff(mode = null, env = process.env) {
  return getCabinNightClaimMode(mode, env) === MODES.OFF;
}

function isCabinNightClaimShadowEnabled(mode = null, env = process.env) {
  return getCabinNightClaimMode(mode, env) === MODES.SHADOW;
}

function isCabinNightClaimAuthoritativeEnabled(mode = null, env = process.env) {
  return getCabinNightClaimMode(mode, env) === MODES.AUTHORITATIVE;
}

/** True when claim acquire/release side effects should run (shadow or authoritative). */
function isCabinNightClaimWritesEnabled(mode = null, env = process.env) {
  const resolved = getCabinNightClaimMode(mode, env);
  return resolved === MODES.SHADOW || resolved === MODES.AUTHORITATIVE;
}

module.exports = {
  MODES,
  SUPPORTED_MODES,
  normalizeMode,
  readConfiguredMode,
  getCabinNightClaimMode,
  isCabinNightClaimOff,
  isCabinNightClaimShadowEnabled,
  isCabinNightClaimAuthoritativeEnabled,
  isCabinNightClaimWritesEnabled
};
