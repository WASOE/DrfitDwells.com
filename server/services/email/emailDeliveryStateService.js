'use strict';

const EmailDeliveryState = require('../../models/EmailDeliveryState');
const {
  openEmailDeliveryManualReview,
  resolveEmailDeliveryManualReviews
} = require('../ops/ingestion/manualReviewService');

const BOOKING_LIFECYCLE_EMAIL_FAILED = 'booking_lifecycle_email_failed';
const GIFT_VOUCHER_EMAIL_FAILED = 'gift_voucher_email_failed';

const EMAIL_FAILURE_CATEGORIES = [BOOKING_LIFECYCLE_EMAIL_FAILED, GIFT_VOUCHER_EMAIL_FAILED];

function normalizeString(value) {
  if (value == null) return null;
  const next = String(value).trim();
  return next || null;
}

function resolveManualReviewCategory(domain) {
  return domain === 'gift_voucher' ? GIFT_VOUCHER_EMAIL_FAILED : BOOKING_LIFECYCLE_EMAIL_FAILED;
}

function buildManualReviewTitle({ domain, templateKey, templateKind, recipient }) {
  if (domain === 'gift_voucher') {
    return `Gift voucher email failed (${templateKind || 'delivery'})`;
  }
  return `Guest email failed (${templateKey || 'lifecycle'})`;
}

function buildManualReviewDetails({ errorMessage, templateKey, templateKind, recipient }) {
  const label = templateKey || templateKind || 'email';
  const err = errorMessage ? `: ${errorMessage}` : '';
  return `${label} to ${recipient || 'unknown'} could not be delivered${err}`;
}

async function applyEmailDeliveryAttempt({
  correlationKey,
  domain,
  bookingId = null,
  giftVoucherId = null,
  templateKey = null,
  templateKind = null,
  recipient,
  sendStatus,
  lifecycleSource = null,
  emailEventId = null,
  errorMessage = null,
  actorId = null,
  actorRole = null,
  skipManualReview = false
}) {
  if (!correlationKey || !domain || !recipient || !sendStatus) {
    throw new Error('applyEmailDeliveryAttempt requires correlationKey, domain, recipient, and sendStatus');
  }

  const now = new Date();
  const existing = await EmailDeliveryState.findOne({ correlationKey }).lean();
  const entityType = domain === 'gift_voucher' ? 'GiftVoucher' : 'Booking';
  const entityId = domain === 'gift_voucher' ? giftVoucherId : bookingId;
  const category = resolveManualReviewCategory(domain);

  let latestStatus = sendStatus;
  if (sendStatus === 'skipped' && existing?.latestStatus === 'failed') {
    latestStatus = 'failed';
  }
  // Normalize definitive success onto legacy `success` for existing dashboards,
  // unless the row is already on the Batch 6 confirmation SM (`succeeded`).
  if (sendStatus === 'success' && existing?.latestStatus === 'succeeded') {
    latestStatus = 'succeeded';
  }
  if (sendStatus === 'succeeded') {
    latestStatus = 'succeeded';
  }

  const stateUpdate = {
    correlationKey,
    domain,
    bookingId: bookingId || undefined,
    giftVoucherId: giftVoucherId || undefined,
    templateKey: templateKey || undefined,
    templateKind: templateKind || undefined,
    recipient,
    latestStatus,
    latestEventAt: now,
    latestEmailEventId: emailEventId || undefined,
    latestLifecycleSource: lifecycleSource || undefined,
    latestErrorMessage: sendStatus === 'failed' ? errorMessage || undefined : undefined
  };

  if (sendStatus === 'failed' || sendStatus === 'ambiguous') {
    // A new active failure reopens dashboard attention even if previously dismissed/resolved.
    stateUpdate.resolvedAt = null;
    stateUpdate.resolvedBy = null;
    stateUpdate.resolutionNote = null;
  }

  if (sendStatus === 'success' || sendStatus === 'succeeded') {
    stateUpdate.resolvedAt = now;
    stateUpdate.resolvedBy = actorId || actorRole || 'system';
    stateUpdate.resolutionNote =
      lifecycleSource === 'manual_resend' ? 'Resolved by manual resend' : 'Resolved by successful send';
  }

  const state = await EmailDeliveryState.findOneAndUpdate(
    { correlationKey },
    { $set: stateUpdate },
    { upsert: true, new: true }
  );

  if (skipManualReview) {
    return state;
  }

  if (sendStatus === 'failed') {
    await openEmailDeliveryManualReview({
      category,
      severity: 'high',
      entityType,
      entityId,
      title: buildManualReviewTitle({ domain, templateKey, templateKind, recipient }),
      details: buildManualReviewDetails({ errorMessage, templateKey, templateKind, recipient }),
      provenance: {
        source: domain === 'gift_voucher' ? 'gift_voucher_email' : 'booking_lifecycle_email'
      },
      evidence: {
        deliveryCorrelationKey: correlationKey,
        bookingId: bookingId ? String(bookingId) : null,
        giftVoucherId: giftVoucherId ? String(giftVoucherId) : null,
        templateKey: templateKey || null,
        templateKind: templateKind || null,
        recipient,
        errorMessage: errorMessage || null
      }
    });
  } else if (sendStatus === 'success' || sendStatus === 'succeeded') {
    await resolveEmailDeliveryManualReviews({
      deliveryCorrelationKey: correlationKey,
      categories: EMAIL_FAILURE_CATEGORIES,
      resolvedBy: actorId || actorRole || 'system',
      note:
        lifecycleSource === 'manual_resend'
          ? 'Auto-resolved: email delivered via manual resend.'
          : 'Auto-resolved: email delivered successfully.'
    });
  }

  return state;
}

async function countActiveFailedDeliveryStates() {
  return EmailDeliveryState.countDocuments({
    latestStatus: { $in: ['failed', 'ambiguous'] },
    $or: [{ resolvedAt: null }, { resolvedAt: { $exists: false } }]
  });
}

async function listActiveFailedDeliveryStates({ limit = 50 } = {}) {
  return EmailDeliveryState.find({
    latestStatus: { $in: ['failed', 'ambiguous'] },
    $or: [{ resolvedAt: null }, { resolvedAt: { $exists: false } }]
  })
    .sort({ latestEventAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Operator dismiss for a failed delivery without a successful resend.
 * Keeps latestStatus/history intact; clears dashboard via resolvedAt.
 */
async function dismissFailedEmailDeliveryState({
  correlationKey = null,
  resolvedBy = 'operator',
  resolutionNote = null,
  now = new Date()
} = {}) {
  const key = normalizeString(correlationKey);
  if (!key) {
    return { updated: false, reason: 'invalid_input' };
  }
  const at = now instanceof Date ? now : new Date(now);
  const updated = await EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey: key,
      latestStatus: { $in: ['failed', 'ambiguous'] },
      $or: [{ resolvedAt: null }, { resolvedAt: { $exists: false } }]
    },
    {
      $set: {
        resolvedAt: at,
        resolvedBy: normalizeString(resolvedBy) || 'operator',
        resolutionNote:
          normalizeString(resolutionNote) || 'Dismissed by operator (no successful resend)'
      }
    },
    { new: true }
  );
  if (!updated) {
    const existing = await EmailDeliveryState.findOne({ correlationKey: key }).lean();
    if (!existing) return { updated: false, reason: 'not_found' };
    if (existing.resolvedAt) return { updated: false, reason: 'already_resolved', state: existing };
    return { updated: false, reason: 'not_active_failure', state: existing };
  }
  return { updated: true, reason: null, state: updated };
}

module.exports = {
  BOOKING_LIFECYCLE_EMAIL_FAILED,
  GIFT_VOUCHER_EMAIL_FAILED,
  EMAIL_FAILURE_CATEGORIES,
  applyEmailDeliveryAttempt,
  countActiveFailedDeliveryStates,
  listActiveFailedDeliveryStates,
  dismissFailedEmailDeliveryState
};
