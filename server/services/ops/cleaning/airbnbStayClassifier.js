/**
 * Classify Airbnb/iCal external_hold rows as real occupied stays vs host blocks.
 * Cleaning must only create tasks for real stays.
 *
 * Airbnb typically emits SUMMARY "Reserved" for guest bookings and phrases like
 * "Airbnb (Not available)" / "Blocked" for host unavailability.
 */

const EXTERNAL_HOLD_CLEANING_SOURCES = Object.freeze(['airbnb_ical']);

const BLOCK_SUMMARY_RE =
  /not\s*available|unavailable|\bblocked\b|owner\s*block|maintenance|\bclosed\b|calendar\s*block/i;

const STAY_SUMMARY_RE = /^reserved$|reservation|\bbooked\b|\bguest\b/i;

const SYSTEM_TITLE_RE = /^(airbnb(\s*\(.*\))?|hold|sync|import)\s*$/i;

function normalizeSummary(summary) {
  return String(summary || '').trim();
}

/**
 * @param {string|null|undefined} summary
 * @returns {boolean}
 */
function isAirbnbStaySummary(summary) {
  const raw = normalizeSummary(summary);
  if (!raw) return false;
  if (BLOCK_SUMMARY_RE.test(raw)) return false;
  if (STAY_SUMMARY_RE.test(raw)) return true;
  if (SYSTEM_TITLE_RE.test(raw)) return false;
  // Guest-named SUMMARY (common on Airbnb) — treat as stay when not a block phrase.
  return true;
}

/**
 * @param {object} block lean AvailabilityBlock
 * @returns {boolean}
 */
function isExternalHoldEligibleForCleaning(block) {
  if (!block || block.blockType !== 'external_hold') return false;
  if (block.status !== 'active') return false;
  if (!EXTERNAL_HOLD_CLEANING_SOURCES.includes(block.source)) return false;
  const summary = block.metadata?.summary ?? block.summary ?? null;
  return isAirbnbStaySummary(summary);
}

module.exports = {
  EXTERNAL_HOLD_CLEANING_SOURCES,
  isAirbnbStaySummary,
  isExternalHoldEligibleForCleaning
};
