'use strict';

const { RECOVERY_ELIGIBILITY_REASONS } = require('./savedQuoteConstants');

function normalizeEmail(email) {
  if (!email) return null;
  const value = String(email).trim().toLowerCase();
  return value || null;
}

function isExpired(doc, now = new Date()) {
  if (!doc?.expiresAt) return false;
  return new Date(doc.expiresAt).getTime() <= now.getTime();
}

function isCheckoutStillActive(doc, now = new Date()) {
  if (!doc?.checkoutId) return false;
  if (doc.status === 'converted' || doc.bookingId) return false;
  if (isExpired(doc, now)) return false;
  // Soft: if checkout linked and quote not expired, treat as still-active for recovery.
  return doc.status === 'checkout_started';
}

/**
 * Pure eligibility evaluation. Never sends messages.
 * Batch 4A: marketingConsent and transactionalContinuationEligible default false
 * (no approved capture UX). Having an email alone is not consent.
 */
function evaluateRecoveryEligibility(doc, { now = new Date() } = {}) {
  const evaluatedAt = now;

  if (!doc || !doc.quotedTotalCents || doc.quotedTotalCents < 0) {
    return { eligible: false, reason: 'invalid_quote', evaluatedAt };
  }

  if (doc.isTest) {
    return { eligible: false, reason: 'test_or_internal', evaluatedAt };
  }

  if (doc.status === 'converted' || doc.bookingId || doc.convertedAt) {
    return { eligible: false, reason: 'already_converted', evaluatedAt };
  }

  if (doc.recoveryState?.suppressedAt || doc.recoveryState?.suppressionReason) {
    return { eligible: false, reason: 'suppressed', evaluatedAt };
  }

  if (Number(doc.recoveryState?.sendCount || 0) > 0) {
    return { eligible: false, reason: 'already_recovered', evaluatedAt };
  }

  if (isExpired(doc, now)) {
    return { eligible: false, reason: 'quote_expired_too_long', evaluatedAt };
  }

  if (isCheckoutStillActive(doc, now)) {
    return { eligible: false, reason: 'checkout_still_active', evaluatedAt };
  }

  const email = normalizeEmail(doc.emailNormalized || doc.email);
  if (!email) {
    return { eligible: false, reason: 'missing_email', evaluatedAt };
  }

  // Batch 4A: do not treat analytics consent or email presence as send permission.
  if (doc.marketingConsent === true) {
    return { eligible: true, reason: 'eligible_marketing', evaluatedAt };
  }

  if (doc.transactionalContinuationEligible === true) {
    return { eligible: true, reason: 'eligible_transactional_continuation', evaluatedAt };
  }

  return { eligible: false, reason: 'no_valid_consent', evaluatedAt };
}

function resolveDisplayStatus(doc, now = new Date()) {
  if (!doc) return 'ineligible';
  if (doc.status === 'converted' || doc.bookingId) return 'converted';
  if (doc.status === 'superseded' || doc.status === 'ineligible') return doc.status;
  if (isExpired(doc, now)) return 'expired';
  if (doc.status === 'checkout_started' || doc.checkoutId) return 'checkout_started';
  return 'quoted';
}

module.exports = {
  RECOVERY_ELIGIBILITY_REASONS,
  normalizeEmail,
  isExpired,
  evaluateRecoveryEligibility,
  resolveDisplayStatus
};
