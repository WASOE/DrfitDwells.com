'use strict';

/**
 * Code-capability registry for S1 CabinNightClaim writers.
 * S1.7: represents AUTHORITATIVE path readiness (shadow paths also present).
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

/** Archive is covered under status_release (canonical non-owning then release). */
const STATUS_RELEASE_COVERS = Object.freeze(['cancel', 'complete', 'archive', 'maintenance_delete']);

function listCabinNightClaimS1Writers() {
  return [...CABIN_NIGHT_CLAIM_S1_WRITERS];
}

function isKnownCabinNightClaimS1Writer(writerKey) {
  return CABIN_NIGHT_CLAIM_S1_WRITERS.includes(String(writerKey || '').trim());
}

function listStatusReleaseCoverage() {
  return [...STATUS_RELEASE_COVERS];
}

module.exports = {
  CABIN_NIGHT_CLAIM_S1_WRITERS,
  STATUS_RELEASE_COVERS,
  listCabinNightClaimS1Writers,
  isKnownCabinNightClaimS1Writer,
  listStatusReleaseCoverage
};
