'use strict';

const SavedBookingQuote = require('../../models/SavedBookingQuote');
const { RETENTION_DAYS } = require('./savedQuoteConstants');

/**
 * Operational retention: anonymize old non-essential PII while preserving
 * suppression protection and converted booking linkage.
 *
 * Never deletes suppression-required records. Dry-run by default at script layer.
 */
async function purgeSavedBookingQuotes({
  dryRun = true,
  batchSize = 200,
  cutoff = null,
  now = new Date()
} = {}) {
  const retentionMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffDate =
    cutoff instanceof Date
      ? cutoff
      : cutoff
        ? new Date(cutoff)
        : new Date(now.getTime() - retentionMs);

  if (!Number.isFinite(cutoffDate.getTime())) {
    throw new Error('Invalid cutoff date');
  }

  const limit = Math.min(Math.max(Number(batchSize) || 200, 1), 1000);

  // Eligible: expired quote commercial window, not already anonymized, older than cutoff.
  // Keep recoveryState.suppressionReason when present.
  const match = {
    anonymizedAt: null,
    quotedAt: { $lt: cutoffDate },
    $or: [
      { expiresAt: { $lt: now } },
      { status: { $in: ['expired', 'superseded', 'ineligible', 'converted'] } }
    ]
  };

  const candidates = await SavedBookingQuote.find(match)
    .sort({ quotedAt: 1 })
    .limit(limit)
    .select(
      '_id status email emailNormalized sessionKey visitorKey bookingId locationBookingId recoveryState quotedAt expiresAt'
    )
    .lean();

  const summary = {
    dryRun: Boolean(dryRun),
    cutoff: cutoffDate.toISOString(),
    scanned: candidates.length,
    wouldAnonymize: 0,
    anonymized: 0,
    retainedForSuppression: 0,
    convertedKeptBookingLink: 0,
    skipped: 0
  };

  for (const doc of candidates) {
    const hasSuppression =
      Boolean(doc.recoveryState?.suppressedAt) || Boolean(doc.recoveryState?.suppressionReason);
    const isConverted = doc.status === 'converted' || doc.bookingId || doc.locationBookingId;

    // Always anonymize identity; never drop suppression marker or booking refs.
    summary.wouldAnonymize += 1;
    if (hasSuppression) summary.retainedForSuppression += 1;
    if (isConverted) summary.convertedKeptBookingLink += 1;

    if (dryRun) continue;

    const update = {
      $set: {
        email: null,
        emailNormalized: null,
        sessionKey: null,
        visitorKey: null,
        anonymizedAt: now,
        attribution: { source: null, medium: null, campaign: null }
      }
    };

    // Preserve recoveryState entirely (suppression protection).
    await SavedBookingQuote.updateOne({ _id: doc._id }, update);
    summary.anonymized += 1;
  }

  return summary;
}

module.exports = {
  purgeSavedBookingQuotes,
  RETENTION_DAYS
};
