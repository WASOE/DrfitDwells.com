'use strict';

const QUOTE_TTL_MS = 48 * 60 * 60 * 1000; // Align with CheckoutSession soft expiry
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
  'eligible_transactional_continuation',
  'eligible_marketing',
  'missing_email',
  'no_valid_consent',
  'already_converted',
  'quote_expired_too_long',
  'checkout_still_active',
  'already_recovered',
  'suppressed',
  'invalid_quote',
  'test_or_internal',
  'property_unavailable',
  'unknown'
]);

const SAVED_QUOTE_SCHEMA_VERSION = 1;

module.exports = {
  QUOTE_TTL_MS,
  RETENTION_DAYS,
  SAVED_QUOTE_STATUSES,
  RECOVERY_ELIGIBILITY_REASONS,
  SAVED_QUOTE_SCHEMA_VERSION
};
