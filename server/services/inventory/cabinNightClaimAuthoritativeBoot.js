'use strict';

/**
 * REBOOK-S1.7 read-only CabinNightClaim authority boot gate.
 * Binding: §24.44.4 / §24.44.24
 *
 * When CABIN_NIGHT_CLAIM_MODE=authoritative, inventory-writing processes must
 * assert the exact unique index before serving mutations.
 * Never create/drop/sync indexes here.
 */

const {
  isCabinNightClaimAuthoritativeEnabled,
  getCabinNightClaimMode,
  MODES
} = require('./cabinNightClaimMode');
const {
  assertAuthoritativeCabinNightIndex,
  ERR: CLAIM_ERR
} = require('./cabinNightClaimService');
const {
  AUTHORITY_EVENTS,
  emitCabinNightClaimAuthorityEvent
} = require('./cabinNightClaimObservability');

/**
 * @param {object} [opts]
 * @param {string} [opts.processName]
 * @param {string|null} [opts.mode]
 * @param {object} [opts.env]
 * @returns {Promise<{ required: boolean, ok: boolean, mode: string, index?: object }>}
 */
async function assertCabinNightClaimAuthoritativeBootReady(opts = {}) {
  const env = opts.env || process.env;
  const mode = getCabinNightClaimMode(opts.mode, env);
  const processName = opts.processName || 'unknown';

  if (mode !== MODES.AUTHORITATIVE) {
    return { required: false, ok: true, mode };
  }

  try {
    const result = await assertAuthoritativeCabinNightIndex();
    return {
      required: true,
      ok: true,
      mode,
      index: result.index || null,
      processName
    };
  } catch (err) {
    emitCabinNightClaimAuthorityEvent(AUTHORITY_EVENTS.AUTHORITY_INDEX_UNAVAILABLE, {
      writer: processName,
      errorCode: err?.code || CLAIM_ERR.INDEX_MISSING,
      message: err?.message || String(err)
    });
    const bootErr = new Error(
      `CabinNightClaim authoritative boot failed for ${processName}: ${err?.message || err}`
    );
    bootErr.code = err?.code || CLAIM_ERR.INDEX_MISSING;
    bootErr.cause = err;
    throw bootErr;
  }
}

module.exports = {
  assertCabinNightClaimAuthoritativeBootReady,
  isCabinNightClaimAuthoritativeEnabled
};
