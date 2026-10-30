'use strict';

/**
 * Arrival Communications V2 feature gates.
 * Default OFF — production activation is a separate owner decision.
 *
 * ARRIVAL_EMAIL_V2 — manual Send/Resend + confirmation prep (PR1).
 * ARRIVAL_AUTOMATION_V2 — automatic T-3 scheduling/dispatch (PR2); requires
 * ARRIVAL_EMAIL_V2=1 as well at dispatch time.
 */

const ENV_ARRIVAL_EMAIL_V2 = 'ARRIVAL_EMAIL_V2';
const ENV_ARRIVAL_AUTOMATION_V2 = 'ARRIVAL_AUTOMATION_V2';

/** Allowlisted automatic arrival rule keys (email-only). Day-before access excluded. */
const ARRIVAL_AUTOMATION_RULE_KEYS = Object.freeze([
  'arrival_instructions_pre_arrival_cabin',
  'arrival_instructions_pre_arrival_valley'
]);

const ARRIVAL_AUTOMATION_RULE_KEY_SET = new Set(ARRIVAL_AUTOMATION_RULE_KEYS);

function isArrivalEmailV2Enabled(env = process.env) {
  return String(env[ENV_ARRIVAL_EMAIL_V2] || '').trim() === '1';
}

function isArrivalAutomationV2Enabled(env = process.env) {
  return String(env[ENV_ARRIVAL_AUTOMATION_V2] || '').trim() === '1';
}

function isArrivalAutomationAuthorized(env = process.env) {
  return isArrivalAutomationV2Enabled(env) && isArrivalEmailV2Enabled(env);
}

function isArrivalAutomationRuleKey(ruleKey) {
  return ARRIVAL_AUTOMATION_RULE_KEY_SET.has(String(ruleKey || ''));
}

module.exports = {
  ENV_ARRIVAL_EMAIL_V2,
  ENV_ARRIVAL_AUTOMATION_V2,
  ARRIVAL_AUTOMATION_RULE_KEYS,
  isArrivalEmailV2Enabled,
  isArrivalAutomationV2Enabled,
  isArrivalAutomationAuthorized,
  isArrivalAutomationRuleKey
};
