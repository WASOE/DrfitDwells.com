'use strict';

/**
 * Arrival Communications V2 feature gates.
 * Default OFF — production activation is a separate owner decision.
 */

const ENV_ARRIVAL_EMAIL_V2 = 'ARRIVAL_EMAIL_V2';

function isArrivalEmailV2Enabled(env = process.env) {
  return String(env[ENV_ARRIVAL_EMAIL_V2] || '').trim() === '1';
}

module.exports = {
  ENV_ARRIVAL_EMAIL_V2,
  isArrivalEmailV2Enabled
};
