'use strict';

const QUOTE_TTL_MS = 48 * 60 * 60 * 1000; // Quote commercial expiry (not checkout hold expiry)
const CHECKOUT_SOFT_TTL_MS = 48 * 60 * 60 * 1000; // Cabin CheckoutSession soft expiry
const RETENTION_DAYS = 180;

const SAVED_QUOTE_STATUSES = Object.freeze([
  'quoted',
  'checkout_started',
  'converted',
  'expired',
  'superseded',
  'ineligible'
]);

const RECOVERY_ELIGIBILITY_REASONS = Object.freeze([
  'quote_delivery_requested',
  'booking_reminder_consent',
  'marketing_consent',
  'no_valid_consent',
  'consent_withdrawn',
  'globally_suppressed',
  'already_converted',
  'missing_email',
  'expired',
  'quote_expired_too_long',
  'checkout_still_active',
  'already_recovered',
  'suppressed',
  'invalid_quote',
  'test_or_internal',
  'property_unavailable',
  'unknown'
]);

const CONSENT_TYPES = Object.freeze([
  'quote_delivery',
  'booking_reminder',
  'marketing'
]);

const SAVED_QUOTE_SCHEMA_VERSION = 2;

/** Stable ObjectId namespace for location-level entities (Valley buyout). */
const LOCATION_ENTITY_OBJECT_IDS = Object.freeze({
  valley: 'a11ce0000000000000000001'
});

module.exports = {
  QUOTE_TTL_MS,
  CHECKOUT_SOFT_TTL_MS,
  RETENTION_DAYS,
  SAVED_QUOTE_STATUSES,
  RECOVERY_ELIGIBILITY_REASONS,
  CONSENT_TYPES,
  SAVED_QUOTE_SCHEMA_VERSION,
  LOCATION_ENTITY_OBJECT_IDS
};
