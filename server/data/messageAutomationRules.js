'use strict';

/**
 * V1 automation rule definitions seeded by Batch 5.
 *
 * All 5 rules ship inert: `enabled: false, mode: 'shadow'`.
 *   - 2 guest-facing rules (Cabin / Valley): T-72h before check-in,
 *     Sofia 17:00, channel `whatsapp_first_email_fallback`,
 *     `requirePaidIfStripe: true`, `requiredBookingStatus: ['confirmed']`.
 *   - 3 OPS alert rules (email-only, audience `ops`, propertyScope `any`):
 *     `requiredBookingStatus: ['confirmed', 'in_house']`.
 *
 * Recipient address is NOT stored here; the dispatcher resolves
 * `EMAIL_TO_INTERNAL` for OPS alerts at send time (Batch 8/12).
 *
 * Spec references:
 *   - 02_V1_SPEC.md §12 (rule fields)
 *   - 02_V1_SPEC.md §23 (rule definitions, V1)
 *   - 03_IMPLEMENTATION_BATCHES.md Batch 5 (`enabled=false, mode='shadow'`)
 */

const GUEST_SOFIA_HOUR = 17; // §23.A working default. OPS may re-tune on the rule row without re-seeding.

const arrivalInstructionsPreArrivalCabinRule = Object.freeze({
  ruleKey: 'arrival_instructions_pre_arrival_cabin',
  description: 'Arrival instructions for The Cabin, T-72h before check-in (Europe/Sofia).',
  triggerType: 'time_relative_to_check_in',
  triggerConfig: { offsetHours: -72, sofiaHour: GUEST_SOFIA_HOUR, sofiaMinute: 0 },
  propertyScope: 'cabin',
  channelStrategy: 'whatsapp_first_email_fallback',
  templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' },
  requiresConsent: 'transactional',
  enabled: false,
  mode: 'shadow',
  audience: 'guest',
  requiredBookingStatus: ['confirmed'],
  requirePaidIfStripe: true
});

const arrivalInstructionsPreArrivalValleyRule = Object.freeze({
  ruleKey: 'arrival_instructions_pre_arrival_valley',
  description: 'Arrival instructions for The Valley, T-72h before check-in (Europe/Sofia).',
  triggerType: 'time_relative_to_check_in',
  triggerConfig: { offsetHours: -72, sofiaHour: GUEST_SOFIA_HOUR, sofiaMinute: 0 },
  propertyScope: 'valley',
  channelStrategy: 'whatsapp_first_email_fallback',
  templateKeyByChannel: { whatsapp: 'arrival_3d_the_valley', email: 'arrival_3d_the_valley' },
  requiresConsent: 'transactional',
  enabled: false,
  mode: 'shadow',
  audience: 'guest',
  requiredBookingStatus: ['confirmed'],
  requirePaidIfStripe: true
});

const opsAlertGuestArrivingIn8DaysRule = Object.freeze({
  ruleKey: 'ops_alert_guest_arriving_in_8_days',
  description: 'Internal OPS alert: guest arriving in 8 days (Sofia 09:00).',
  triggerType: 'time_relative_to_check_in',
  triggerConfig: { offsetHours: -192, sofiaHour: 9, sofiaMinute: 0 },
  propertyScope: 'any',
  channelStrategy: 'email_only',
  templateKeyByChannel: { email: 'ops_alert_arriving_8d' },
  requiresConsent: 'transactional',
  enabled: false,
  mode: 'shadow',
  audience: 'ops',
  requiredBookingStatus: ['confirmed', 'in_house'],
  requirePaidIfStripe: false
});

const opsAlertGuestCheckInTomorrowRule = Object.freeze({
  ruleKey: 'ops_alert_guest_check_in_tomorrow',
  description: 'Internal OPS alert: guest check-in tomorrow (Sofia 09:00).',
  triggerType: 'time_relative_to_check_in',
  triggerConfig: { offsetHours: -24, sofiaHour: 9, sofiaMinute: 0 },
  propertyScope: 'any',
  channelStrategy: 'email_only',
  templateKeyByChannel: { email: 'ops_alert_check_in_tomorrow' },
  requiresConsent: 'transactional',
  enabled: false,
  mode: 'shadow',
  audience: 'ops',
  requiredBookingStatus: ['confirmed', 'in_house'],
  requirePaidIfStripe: false
});

const opsAlertGuestCheckoutTodayRule = Object.freeze({
  ruleKey: 'ops_alert_guest_checkout_today',
  description: 'Internal OPS alert: guest checkout today (Sofia 08:00).',
  triggerType: 'time_relative_to_check_out',
  triggerConfig: { offsetHours: 0, sofiaHour: 8, sofiaMinute: 0 },
  propertyScope: 'any',
  channelStrategy: 'email_only',
  templateKeyByChannel: { email: 'ops_alert_checkout_today' },
  requiresConsent: 'transactional',
  enabled: false,
  mode: 'shadow',
  audience: 'ops',
  requiredBookingStatus: ['confirmed', 'in_house'],
  requirePaidIfStripe: false
});

const MESSAGE_AUTOMATION_RULES = Object.freeze([
  arrivalInstructionsPreArrivalCabinRule,
  arrivalInstructionsPreArrivalValleyRule,
  opsAlertGuestArrivingIn8DaysRule,
  opsAlertGuestCheckInTomorrowRule,
  opsAlertGuestCheckoutTodayRule
]);

module.exports = {
  MESSAGE_AUTOMATION_RULES,
  arrivalInstructionsPreArrivalCabinRule,
  arrivalInstructionsPreArrivalValleyRule,
  opsAlertGuestArrivingIn8DaysRule,
  opsAlertGuestCheckInTomorrowRule,
  opsAlertGuestCheckoutTodayRule
};
