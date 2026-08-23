'use strict';

/**
 * Code-capability registry for S1.2 integrated CabinNightClaim writers.
 * Does NOT prove live process deployment readiness.
 */

const CABIN_NIGHT_CLAIM_S1_WRITERS = Object.freeze([
  'finalize',
  'legacy_create',
  'manual_reservation',
  'location_child',
  'date_edit',
  'reassign',
  'status_release'
]);

function listCabinNightClaimS1Writers() {
  return [...CABIN_NIGHT_CLAIM_S1_WRITERS];
}

function isKnownCabinNightClaimS1Writer(writerKey) {
  return CABIN_NIGHT_CLAIM_S1_WRITERS.includes(String(writerKey || '').trim());
}

module.exports = {
  CABIN_NIGHT_CLAIM_S1_WRITERS,
  listCabinNightClaimS1Writers,
  isKnownCabinNightClaimS1Writer
};
