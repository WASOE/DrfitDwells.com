'use strict';

const { RECOVERY_ELIGIBILITY_REASONS } = require('./savedQuoteConstants');
const { resolveGuestContactStatus, normalizeEmail } = require('./contactPreferenceResolutionService');

function isQuoteExpired(doc, now = new Date()) {
  if (!doc?.expiresAt) return false;
  return new Date(doc.expiresAt).getTime() <= now.getTime();
}

function isCheckoutExpired(doc, now = new Date()) {
  if (!doc?.checkoutExpiresAt) return false;
  return new Date(doc.checkoutExpiresAt).getTime() <= now.getTime();
}

function isCheckoutStillActive(doc, now = new Date()) {
  if (!doc?.checkoutId) return false;
  if (doc.status === 'converted' || doc.bookingId || doc.locationBookingId) return false;
  if (isQuoteExpired(doc, now)) return false;
  if (isCheckoutExpired(doc, now)) return false;
  return doc.status === 'checkout_started' || Boolean(doc.checkoutId);
}

/**
 * Pure-ish eligibility evaluation. Never sends messages.
 * Uses live contact preference resolution when contactStatus is not provided.
 */
async function evaluateRecoveryEligibility(doc, { now = new Date(), contactStatus = undefined } = {}) {
  const evaluatedAt = now;

  if (!doc || !doc.quotedTotalCents || doc.quotedTotalCents < 0) {
    return { eligible: false, reason: 'invalid_quote', evaluatedAt };
  }

  if (doc.isTest) {
    return { eligible: false, reason: 'test_or_internal', evaluatedAt };
  }

  if (doc.status === 'converted' || doc.bookingId || doc.locationBookingId || doc.convertedAt) {
    return { eligible: false, reason: 'already_converted', evaluatedAt };
  }

  if (doc.status === 'superseded' || doc.status === 'ineligible') {
    return { eligible: false, reason: doc.status === 'superseded' ? 'already_converted' : 'invalid_quote', evaluatedAt };
  }

  if (doc.recoveryState?.suppressedAt || doc.recoveryState?.suppressionReason) {
    return { eligible: false, reason: 'suppressed', evaluatedAt };
  }

  if (Number(doc.recoveryState?.sendCount || 0) > 0) {
    return { eligible: false, reason: 'already_recovered', evaluatedAt };
  }

  if (isQuoteExpired(doc, now)) {
    return { eligible: false, reason: 'expired', evaluatedAt };
  }

  if (isCheckoutStillActive(doc, now)) {
    return { eligible: false, reason: 'checkout_still_active', evaluatedAt };
  }

  const email = normalizeEmail(doc.emailNormalized || doc.email);
  if (!email) {
    return { eligible: false, reason: 'missing_email', evaluatedAt };
  }

  const status =
    contactStatus === undefined
      ? await resolveGuestContactStatus(email, { now })
      : contactStatus;

  if (!status || !status.emailNormalized) {
    return { eligible: false, reason: 'missing_email', evaluatedAt };
  }

  if (status.globallySuppressed) {
    return { eligible: false, reason: 'globally_suppressed', evaluatedAt };
  }

  // Snapshot may still show granted while live preference was withdrawn.
  const snapshotReminder =
    doc.bookingReminderConsent === true || doc.transactionalContinuationEligible === true;
  const snapshotQuoteDelivery = doc.quoteDeliveryRequested === true;
  const snapshotMarketing = doc.marketingConsent === true;

  if (
    (snapshotReminder || snapshotQuoteDelivery || snapshotMarketing) &&
    !status.bookingReminderAllowed &&
    !status.quoteDeliveryAllowed &&
    !status.marketingAllowed
  ) {
    // Had journey consent once but current preference blocks all optional sends.
    if (
      status.bookingReminderState === 'denied' ||
      status.quoteDeliveryState === 'denied' ||
      status.marketingState === 'denied'
    ) {
      return { eligible: false, reason: 'consent_withdrawn', evaluatedAt };
    }
  }

  // Quote delivery alone does NOT authorize repeated abandoned reminders.
  if (status.bookingReminderAllowed) {
    return { eligible: true, reason: 'booking_reminder_consent', evaluatedAt };
  }

  if (status.marketingAllowed) {
    return { eligible: true, reason: 'marketing_consent', evaluatedAt };
  }

  if (status.quoteDeliveryAllowed) {
    // Eligible only for one-shot quote delivery (Batch 4B), not reminder drip.
    return { eligible: true, reason: 'quote_delivery_requested', evaluatedAt };
  }

  return { eligible: false, reason: 'no_valid_consent', evaluatedAt };
}

function resolveDisplayStatus(doc, now = new Date()) {
  if (!doc) return 'ineligible';
  if (doc.status === 'converted' || doc.bookingId || doc.locationBookingId) return 'converted';
  if (doc.status === 'superseded' || doc.status === 'ineligible') return doc.status;
  if (isQuoteExpired(doc, now)) return 'expired';
  if (doc.status === 'checkout_started' || doc.checkoutId) return 'checkout_started';
  return 'quoted';
}

module.exports = {
  RECOVERY_ELIGIBILITY_REASONS,
  normalizeEmail,
  isQuoteExpired,
  isCheckoutExpired,
  isCheckoutStillActive,
  evaluateRecoveryEligibility,
  resolveDisplayStatus
};
