/**
 * Names created by server/scripts/validate*.js — hide from guest APIs and OPS lists until cleaned up.
 */
/** Matches cabins created by server/scripts/validate*.js (never guest-facing). */
const FIXTURE_CABIN_NAME_PATTERN =
  /^(SyncValidation Cabin|Batch4 Cabin|Batch3 Cabin|Scheduler Test Cabin|Phase1Integrity|Phase2Hardening)/i;

function guestFacingCabinMatch() {
  return {
    isActive: true,
    name: { $not: FIXTURE_CABIN_NAME_PATTERN }
  };
}

function isFixtureCabinName(name) {
  return FIXTURE_CABIN_NAME_PATTERN.test(String(name || ''));
}

module.exports = {
  FIXTURE_CABIN_NAME_PATTERN,
  guestFacingCabinMatch,
  isFixtureCabinName
};
