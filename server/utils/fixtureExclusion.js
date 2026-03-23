/**
 * Names/emails created by server/scripts/validate*.js — hide from default guest/ops/admin lists until cleaned up.
 */
/** Matches cabins created by server/scripts/validate*.js (never guest-facing). */
const FIXTURE_CABIN_NAME_PATTERN =
  /^(SyncValidation Cabin|Batch4 Cabin|Batch3 Cabin|Scheduler Test Cabin|Phase1Integrity|Phase2Hardening)/i;
/** Matches fixture/test reservation emails created by sync/integration validation scripts. */
const FIXTURE_BOOKING_EMAIL_PATTERN = /^(sync-overlap-|batch4-|smoke-)/i;

function guestFacingCabinMatch() {
  return {
    isActive: true,
    name: { $not: FIXTURE_CABIN_NAME_PATTERN },
    $or: [{ archivedAt: null }, { archivedAt: { $exists: false } }]
  };
}

function isFixtureCabinName(name) {
  return FIXTURE_CABIN_NAME_PATTERN.test(String(name || ''));
}

function isFixtureBookingEmail(email) {
  return FIXTURE_BOOKING_EMAIL_PATTERN.test(String(email || ''));
}

module.exports = {
  FIXTURE_CABIN_NAME_PATTERN,
  FIXTURE_BOOKING_EMAIL_PATTERN,
  guestFacingCabinMatch,
  isFixtureCabinName,
  isFixtureBookingEmail
};
