'use strict';

const featureFlags = require('../../utils/featureFlags');
const SavedBookingQuote = require('../../models/SavedBookingQuote');
const RecoveryMessageDelivery = require('../../models/RecoveryMessageDelivery');
const {
  evaluateRecoveryDeliveryGate,
  buildIdempotencyKey
} = require('./recoveryDeliveryGateService');
const { getTemplateDefinition } = require('./recoveryTemplateService');

/**
 * Cancel unsent prepared deliveries for a quote (conversion / suppression).
 */
async function cancelUnsentDeliveriesForQuote(savedQuoteId, reason) {
  const result = await RecoveryMessageDelivery.updateMany(
    {
      savedQuoteId,
      status: { $in: ['prepared', 'blocked'] },
      isPreview: { $ne: true },
      sentAt: null
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelReason: reason || 'cancelled'
      }
    }
  );
  return { modified: result.modifiedCount || 0 };
}

async function cancelUnsentDeliveriesForEmail(emailNormalized, reason) {
  if (!emailNormalized) return { modified: 0 };
  const quotes = await SavedBookingQuote.find({ emailNormalized }).select('_id').lean();
  let modified = 0;
  for (const q of quotes) {
    const r = await cancelUnsentDeliveriesForQuote(q._id, reason);
    modified += r.modified;
  }
  return { modified };
}

/**
 * Prepare a delivery ledger row. Never sends. Never sets status `sent`.
 * Duplicate prepare with same idempotency key returns the existing row.
 */
async function prepareRecoveryDelivery({
  savedQuoteId,
  messagePurpose,
  templateVersion = 'v1',
  sequence = 1,
  scheduledFor = null,
  isPreview = false
} = {}) {
  const definition = getTemplateDefinition(messagePurpose, templateVersion);
  if (!definition) {
    return { ok: false, reason: 'unknown_template' };
  }

  const gate = await evaluateRecoveryDeliveryGate({
    savedQuoteId,
    messagePurpose,
    templateVersion: definition.version,
    sequence
  });

  const quote = await SavedBookingQuote.findById(savedQuoteId).lean();
  if (!quote) return { ok: false, reason: 'invalid_record' };

  const idempotencyKey =
    gate.idempotencyKey ||
    buildIdempotencyKey({
      savedQuoteId: String(savedQuoteId),
      messagePurpose,
      templateVersion: `${definition.key}:${definition.version}`,
      sequence
    });

  if (isPreview) {
    const previewKey = `${idempotencyKey}:preview:${Date.now()}`;
    const doc = await RecoveryMessageDelivery.create({
      savedQuoteId,
      bookingId: quote.bookingId || null,
      locationBookingId: quote.locationBookingId || null,
      checkoutSessionId: quote.checkoutId || null,
      propertyKind: quote.propertyKind,
      messagePurpose,
      templateKey: definition.key,
      templateVersion: definition.version,
      recipientHash: gate.recipientHash || null,
      recipientDomain: gate.recipientDomain || null,
      status: 'prepared_preview',
      eligibilitySnapshot: {
        eligible: gate.allowed,
        reason: gate.reason,
        evaluatedAt: gate.evaluatedAt,
        consentBasis: gate.consentBasis,
        globallySuppressed: Boolean(gate.globallySuppressed)
      },
      idempotencyKey: previewKey,
      sequence,
      preparedAt: new Date(),
      isPreview: true
    });
    return { ok: true, delivery: doc, gate, isPreview: true };
  }

  const existing = await RecoveryMessageDelivery.findOne({ idempotencyKey }).lean();
  if (existing) {
    return { ok: true, delivery: existing, gate, deduped: true };
  }

  // When only provider/purpose flags block, still allow a prepared row for dry-run ops,
  // but mark blocked if consent/conversion/etc. fail.
  const finalStatus =
    ['feature_disabled'].includes(gate.reason) && gate.consentBasis
      ? 'prepared'
      : gate.allowed
        ? 'prepared'
        : 'blocked';

  const doc = await RecoveryMessageDelivery.create({
    savedQuoteId,
    bookingId: quote.bookingId || null,
    locationBookingId: quote.locationBookingId || null,
    checkoutSessionId: quote.checkoutId || null,
    propertyKind: quote.propertyKind,
    messagePurpose,
    templateKey: definition.key,
    templateVersion: definition.version,
    recipientHash: gate.recipientHash || null,
    recipientDomain: gate.recipientDomain || null,
    status: finalStatus,
    eligibilitySnapshot: {
      eligible: gate.allowed,
      reason: gate.reason,
      evaluatedAt: gate.evaluatedAt,
      consentBasis: gate.consentBasis,
      globallySuppressed: Boolean(gate.globallySuppressed)
    },
    idempotencyKey,
    sequence,
    preparedAt: new Date(),
    scheduledFor: scheduledFor || null,
    isPreview: false
  });

  return { ok: true, delivery: doc, gate, deduped: false };
}

/**
 * Pure candidate discovery. No cron, no queue, no provider.
 * Feature flags default false — returns empty when disabled.
 */
async function findQuoteDeliveryCandidates({ limit = 50, now = new Date() } = {}) {
  if (!featureFlags.isRecoveryQuoteDeliveryEnabled()) {
    return { candidates: [], featureDisabled: true };
  }
  const docs = await SavedBookingQuote.find({
    quoteDeliveryRequested: true,
    status: { $in: ['quoted', 'checkout_started'] },
    bookingId: null,
    locationBookingId: null,
    anonymizedAt: null,
    isTest: { $ne: true },
    emailNormalized: { $type: 'string' },
    expiresAt: { $gt: now }
  })
    .sort({ quotedAt: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  const candidates = [];
  for (const doc of docs) {
    const gate = await evaluateRecoveryDeliveryGate({
      savedQuoteId: doc._id,
      messagePurpose: 'quote_delivery'
    });
    if (gate.allowed || gate.reason === 'feature_disabled') {
      candidates.push({ savedQuoteId: String(doc._id), gate });
    }
  }
  return { candidates, featureDisabled: false };
}

async function findBookingReminderCandidates({ limit = 50, now = new Date() } = {}) {
  if (!featureFlags.isRecoveryBookingReminderEnabled()) {
    return { candidates: [], featureDisabled: true };
  }
  const docs = await SavedBookingQuote.find({
    bookingReminderConsent: true,
    status: { $in: ['quoted', 'checkout_started', 'expired'] },
    bookingId: null,
    locationBookingId: null,
    anonymizedAt: null,
    isTest: { $ne: true },
    emailNormalized: { $type: 'string' }
  })
    .sort({ quotedAt: -1 })
    .limit(Math.min(limit, 100))
    .lean();

  const candidates = [];
  for (const doc of docs) {
    const gate = await evaluateRecoveryDeliveryGate({
      savedQuoteId: doc._id,
      messagePurpose: 'booking_reminder'
    });
    if (gate.allowed || gate.reason === 'feature_disabled') {
      candidates.push({ savedQuoteId: String(doc._id), gate });
    }
  }
  return { candidates, featureDisabled: false };
}

module.exports = {
  prepareRecoveryDelivery,
  findQuoteDeliveryCandidates,
  findBookingReminderCandidates,
  cancelUnsentDeliveriesForQuote,
  cancelUnsentDeliveriesForEmail
};
