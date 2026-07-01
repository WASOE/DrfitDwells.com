'use strict';

/**
 * Source-of-truth access credentials for GMA guest access emails (email-only).
 * Not exposed via public guide API or client guide pages.
 */

const { STAY_SLUGS } = require('../utils/staySlug');

/** The Cabin final approach — matches client arrivalConstants.js */
const CABIN_GOOGLE_EARTH_URL =
  'https://earth.google.com/earth/d/1RFPJPeRiITrb_9UEYLtQSpqxX8CtNWm7?usp=sharing';

const CABIN_LOCK_CODE = '2727';

const VALLEY_LOCK_CODES = Object.freeze({
  [STAY_SLUGS.LUX_CABIN]: '0707',
  [STAY_SLUGS.STONE_HOUSE]: '9797'
});

/** A-Frame unit index (2 or 3) → lock code. A-Frame 1 is not built / not automated. */
const A_FRAME_LOCK_CODES_BY_UNIT_INDEX = Object.freeze({
  2: '2727',
  3: '3737'
});

const STONE_HOUSE_WIFI_NETWORK = 'Drift&Dwells';

const VALLEY_TRANSFER_OFFER_NOTE = '€20';

const GUEST_ACCESS_RULE_KEYS = Object.freeze([
  'check_in_access_day_before_cabin',
  'check_in_access_day_before_valley'
]);

const GUEST_ACCESS_RULE_KEY_SET = new Set(GUEST_ACCESS_RULE_KEYS);

function isGuestAccessRuleKey(ruleKey) {
  return GUEST_ACCESS_RULE_KEY_SET.has(ruleKey);
}

module.exports = {
  CABIN_GOOGLE_EARTH_URL,
  CABIN_LOCK_CODE,
  VALLEY_LOCK_CODES,
  A_FRAME_LOCK_CODES_BY_UNIT_INDEX,
  STONE_HOUSE_WIFI_NETWORK,
  VALLEY_TRANSFER_OFFER_NOTE,
  GUEST_ACCESS_RULE_KEYS,
  GUEST_ACCESS_RULE_KEY_SET,
  isGuestAccessRuleKey
};
