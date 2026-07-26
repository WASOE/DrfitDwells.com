'use strict';

const crypto = require('crypto');
const featureFlags = require('../../utils/featureFlags');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const RecoveryMessageDelivery = require('../../models/RecoveryMessageDelivery');
const { resolveGuestContactStatus, normalizeEmail } = require('./contactPreferenceResolutionService');
const {
  isQuoteExpired,
  isCheckoutExpired,
  isCheckoutStillActive
} = require('./recoveryEligibilityService');

function hashRecipient(emailNormalized) {
  return crypto.createHash('sha256').update(String(emailNormalized), 'utf8').digest('hex');
}

function recipientDomain(emailNormalized) {
  const at = String(emailNormalized).indexOf('@');
  return at > 0 ? String(emailNormalized).slice(at + 1) : null;
}

function buildIdempotencyKey({ savedQuoteId, messagePurpose, templateVersion, sequence = 1 }) {
  return `recovery:${savedQuoteId}:${messagePurpose}:${templateVersion}:${sequence}`;
}

/**
 * Final send-time gate. Never sends. Must be re-evaluated immediately before any future send.
 */
async function evaluateRecoveryDeliveryGate({
  savedQuoteId,
  messagePurpose,
  templateVersion = 'v1',
  sequence = 1,
  now = new Date()
} = {}) {
  const evaluatedAt = now;

  if (!savedQuoteId || !['quote_delivery', 'booking_reminder'].includes(messagePurpose)) {
    return {
      allowed: false,
      reason: 'invalid_record',
      consentBasis: null,
      evaluatedAt
    };
  }

  const doc = await SavedBookingQuote.findById(savedQuoteId).lean();
  if (!doc) {
    return { allowed: false, reason: 'invalid_record', consentBasis: null, evaluatedAt };
  }

  if (doc.isTest) {
    return { allowed: false, reason: 'test_or_internal', consentBasis: null, evaluatedAt };
  }
  if (doc.anonymizedAt) {
    return { allowed: false, reason: 'anonymized', consentBasis: null, evaluatedAt };
  }
  if (doc.status === 'converted' || doc.bookingId || doc.locationBookingId || doc.convertedAt) {
    return { allowed: false, reason: 'already_converted', consentBasis: null, evaluatedAt };
  }

  const email = normalizeEmail(doc.emailNormalized || doc.email);
  if (!email) {
    return { allowed: false, reason: 'missing_email', consentBasis: null, evaluatedAt };
  }

  const contact = await resolveGuestContactStatus(email, { now });
  if (contact.globallySuppressed) {
    return {
      allowed: false,
      reason: 'globally_suppressed',
      consentBasis: null,
      evaluatedAt,
      globallySuppressed: true
    };
  }

  let consentBasis = null;
  if (messagePurpose === 'quote_delivery') {
    if (!contact.quoteDeliveryAllowed) {
      const reason =
        contact.quoteDeliveryState === 'denied' ? 'consent_withdrawn' : 'missing_consent';
      return { allowed: false, reason, consentBasis: null, evaluatedAt };
    }
    consentBasis = 'quote_delivery';
  } else if (messagePurpose === 'booking_reminder') {
    if (!contact.bookingReminderAllowed) {
      const reason =
        contact.bookingReminderState === 'denied' ? 'consent_withdrawn' : 'missing_consent';
      return { allowed: false, reason, consentBasis: null, evaluatedAt };
    }
    consentBasis = 'booking_reminder';
  }

  if (isQuoteExpired(doc, now)) {
    return { allowed: false, reason: 'quote_expired', consentBasis, evaluatedAt };
  }

  if (messagePurpose === 'booking_reminder' && isCheckoutStillActive(doc, now)) {
    return { allowed: false, reason: 'checkout_active', consentBasis, evaluatedAt };
  }

  const templateKey =
    messagePurpose === 'quote_delivery' ? 'quote_delivery_v1' : 'booking_reminder_v1';
  const version = templateVersion || 'v1';
  const idempotencyKey = buildIdempotencyKey({
    savedQuoteId: String(doc._id),
    messagePurpose,
    templateVersion: `${templateKey}:${version}`,
    sequence
  });

  const existing = await RecoveryMessageDelivery.findOne({
    idempotencyKey,
    status: { $in: ['prepared', 'sent', 'delivered'] },
    isPreview: { $ne: true }
  }).lean();
  if (existing) {
    return {
      allowed: false,
      reason: 'already_sent',
      consentBasis,
      evaluatedAt,
      idempotencyKey,
      existingDeliveryId: String(existing._id)
    };
  }

  const sentCount = await RecoveryMessageDelivery.countDocuments({
    savedQuoteId: doc._id,
    messagePurpose,
    status: { $in: ['sent', 'delivered'] },
    isPreview: { $ne: true }
  });
  const maxCount = 1;
  if (sentCount >= maxCount) {
    return { allowed: false, reason: 'already_sent', consentBasis, evaluatedAt, idempotencyKey };
  }

  // Feature flags checked after consent/lifecycle so preparation can still record candidates.
  if (messagePurpose === 'quote_delivery' && !featureFlags.isRecoveryQuoteDeliveryEnabled()) {
    return {
      allowed: false,
      reason: 'feature_disabled',
      consentBasis,
      evaluatedAt,
      idempotencyKey,
      recipientHash: hashRecipient(email),
      recipientDomain: recipientDomain(email),
      templateKey,
      templateVersion: version
    };
  }
  if (messagePurpose === 'booking_reminder' && !featureFlags.isRecoveryBookingReminderEnabled()) {
    return {
      allowed: false,
      reason: 'feature_disabled',
      consentBasis,
      evaluatedAt,
      idempotencyKey,
      recipientHash: hashRecipient(email),
      recipientDomain: recipientDomain(email),
      templateKey,
      templateVersion: version
    };
  }
  if (!featureFlags.isRecoveryEmailProviderEnabled()) {
    return {
      allowed: false,
      reason: 'feature_disabled',
      consentBasis,
      evaluatedAt,
      idempotencyKey,
      providerDisabled: true,
      recipientHash: hashRecipient(email),
      recipientDomain: recipientDomain(email),
      templateKey,
      templateVersion: version
    };
  }

  return {
    allowed: true,
    reason: 'allowed',
    consentBasis,
    evaluatedAt,
    idempotencyKey,
    globallySuppressed: false,
    recipientHash: hashRecipient(email),
    recipientDomain: recipientDomain(email),
    templateKey,
    templateVersion: version
  };
}

module.exports = {
  evaluateRecoveryDeliveryGate,
  buildIdempotencyKey,
  hashRecipient,
  recipientDomain
};
