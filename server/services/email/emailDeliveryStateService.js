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

  if (sendStatus === 'success') {
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
  } else if (sendStatus === 'success') {
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
  return EmailDeliveryState.countDocuments({ latestStatus: 'failed' });
}

async function listActiveFailedDeliveryStates({ limit = 50 } = {}) {
  return EmailDeliveryState.find({ latestStatus: 'failed' })
    .sort({ latestEventAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = {
  BOOKING_LIFECYCLE_EMAIL_FAILED,
  GIFT_VOUCHER_EMAIL_FAILED,
  EMAIL_FAILURE_CATEGORIES,
  applyEmailDeliveryAttempt,
  countActiveFailedDeliveryStates,
  listActiveFailedDeliveryStates
};
