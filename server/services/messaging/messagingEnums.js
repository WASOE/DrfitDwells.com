'use strict';

/**
 * messagingEnums
 *
 * Pure constants module for the guest message automation system. No model
 * imports. No side effects. No runtime logic. Models and (future) services
 * import the tuples below so enum strings stay consistent across the
 * codebase.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §11–§16.
 */

const MESSAGE_TEMPLATE_CHANNELS = Object.freeze(['email', 'whatsapp']);
const MESSAGE_TEMPLATE_LOCALES = Object.freeze(['en', 'bg']);
const MESSAGE_TEMPLATE_PROPERTY_KINDS = Object.freeze(['cabin', 'valley', 'any']);
const MESSAGE_TEMPLATE_STATUSES = Object.freeze(['draft', 'approved', 'disabled']);

const AUTOMATION_RULE_TRIGGER_TYPES = Object.freeze([
  'time_relative_to_check_in',
  'time_relative_to_check_out',
  'booking_status_change',
  'manual'
]);
const AUTOMATION_RULE_PROPERTY_SCOPES = Object.freeze(['cabin', 'valley', 'any']);
const AUTOMATION_RULE_CHANNEL_STRATEGIES = Object.freeze([
  'whatsapp_only',
  'email_only',
  'whatsapp_first_email_fallback',
  'both'
]);
const AUTOMATION_RULE_REQUIRES_CONSENT = Object.freeze(['transactional', 'marketing']);
const AUTOMATION_RULE_MODES = Object.freeze(['auto', 'shadow', 'manual_approve']);
const AUTOMATION_RULE_AUDIENCES = Object.freeze(['guest', 'ops']);

const SCHEDULED_JOB_STATUSES = Object.freeze([
  'scheduled',
  'claimed',
  'sent',
  'failed',
  'cancelled',
  'suppressed',
  'skipped_status_guard',
  'skipped_no_consent'
]);

const MESSAGE_DISPATCH_CHANNELS = Object.freeze(['whatsapp', 'email']);
const MESSAGE_DISPATCH_LIFECYCLE_SOURCES = Object.freeze([
  'automatic',
  'manual_first_send',
  'manual_resend'
]);
const MESSAGE_DISPATCH_STATUSES = Object.freeze([
  // Batch 9: `pending` is reserved for the real-provider outbox pattern. A
  // dispatch row is created in `pending` BEFORE the external provider call,
  // then transitioned to `accepted` on success or `failed` on any error.
  // Shadow providers skip the `pending` phase entirely.
  'pending',
  'accepted',
  'failed',
  'skipped_suppressed',
  'skipped_no_consent',
  'skipped_no_recipient',
  'skipped_status_guard',
  'skipped_wrong_property'
]);
const MESSAGE_DISPATCH_PROVIDERS = Object.freeze([
  'meta_whatsapp',
  'twilio_whatsapp',
  'three_sixty_dialog',
  'postmark',
  'internal'
]);

const DELIVERY_EVENT_PROVIDERS = MESSAGE_DISPATCH_PROVIDERS;
const DELIVERY_EVENT_CHANNELS = MESSAGE_DISPATCH_CHANNELS;
const DELIVERY_EVENT_TYPES = Object.freeze([
  'accepted',
  'sent',
  'delivered',
  'read',
  'failed',
  'bounced',
  'spam_complaint',
  'opened',
  'clicked'
]);

const CONTACT_RECIPIENT_TYPES = Object.freeze(['email', 'whatsapp_phone']);
const CONTACT_PHONE_STATUSES = Object.freeze(['valid', 'invalid', 'unknown']);
const CONTACT_CONSENT_STATES = Object.freeze(['granted', 'denied', 'unknown']);
const CONTACT_SUPPRESSION_REASONS = Object.freeze([
  'hard_bounce',
  'spam_complaint',
  'user_optout_stop',
  'provider_failure',
  'manual'
]);

module.exports = {
  MESSAGE_TEMPLATE_CHANNELS,
  MESSAGE_TEMPLATE_LOCALES,
  MESSAGE_TEMPLATE_PROPERTY_KINDS,
  MESSAGE_TEMPLATE_STATUSES,
  AUTOMATION_RULE_TRIGGER_TYPES,
  AUTOMATION_RULE_PROPERTY_SCOPES,
  AUTOMATION_RULE_CHANNEL_STRATEGIES,
  AUTOMATION_RULE_REQUIRES_CONSENT,
  AUTOMATION_RULE_MODES,
  AUTOMATION_RULE_AUDIENCES,
  SCHEDULED_JOB_STATUSES,
  MESSAGE_DISPATCH_CHANNELS,
  MESSAGE_DISPATCH_LIFECYCLE_SOURCES,
  MESSAGE_DISPATCH_STATUSES,
  MESSAGE_DISPATCH_PROVIDERS,
  DELIVERY_EVENT_PROVIDERS,
  DELIVERY_EVENT_CHANNELS,
  DELIVERY_EVENT_TYPES,
  CONTACT_RECIPIENT_TYPES,
  CONTACT_PHONE_STATUSES,
  CONTACT_CONSENT_STATES,
  CONTACT_SUPPRESSION_REASONS
};
