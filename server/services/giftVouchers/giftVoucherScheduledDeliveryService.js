const GiftVoucher = require('../../models/GiftVoucher');
const GiftVoucherEvent = require('../../models/GiftVoucherEvent');
const ManualReviewItem = require('../../models/ManualReviewItem');
const { appendVoucherEvent } = require('./giftVoucherEventService');
const {
  performLifecycleSend,
  appendEventOnce,
  lifecycleKey,
  openEmailFailureReview,
  EMAIL_FAILED_CATEGORY
} = require('./giftVoucherEmailService');
const {
  buildCardDownloadUrl,
  rotateCardAccessTokenForVoucher
} = require('./giftVoucherCardAccessService');
const {
  isScheduledDeliveryDue,
  isDeliveryDateOnOrAfterExpiry
} = require('./giftVoucherScheduledDeliveryDates');
const {
  MAX_SCHEDULED_DELIVERY_ATTEMPTS,
  SCHEDULED_DELIVERY_RETRY_BACKOFF_MS,
  DELIVERABLE_STATUSES
} = require('./giftVoucherScheduledDeliveryConstants');

const SCHEDULED_WORKER_ACTOR = 'scheduled_worker';
const SCHEDULED_WORKER_SOURCE = 'scheduled_worker';
const PAST_EXPIRY_SOURCE = 'scheduled_worker_past_expiry';

function pastExpiryLifecycleKey(giftVoucherId) {
  return `scheduled_delivery_date_past_expiry:${String(giftVoucherId)}`;
}

async function countScheduledAttemptFailures(giftVoucherId) {
  return GiftVoucherEvent.countDocuments({
    giftVoucherId,
    type: 'scheduled_delivery_attempt_failed'
  });
}

async function getLastScheduledAttemptFailed(giftVoucherId) {
  return GiftVoucherEvent.findOne({
    giftVoucherId,
    type: 'scheduled_delivery_attempt_failed'
  })
    .sort({ createdAt: -1 })
    .lean();
}

function isRetryBackoffElapsed(lastAttemptEvent, now = new Date()) {
  if (!lastAttemptEvent) return true;
  const elapsed = now.getTime() - new Date(lastAttemptEvent.createdAt).getTime();
  return elapsed >= SCHEDULED_DELIVERY_RETRY_BACKOFF_MS;
}

async function hasScheduledDeliveryExhausted(giftVoucherId) {
  const exhausted = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type: 'scheduled_delivery_exhausted'
  })
    .select('_id')
    .lean();
  return Boolean(exhausted);
}

async function hasScheduledDeliveryPastExpiryFlag(giftVoucherId) {
  const flagged = await GiftVoucherEvent.findOne({
    giftVoucherId,
    type: 'scheduled_delivery_date_past_expiry'
  })
    .select('_id')
    .lean();
  return Boolean(flagged);
}

async function hasOpenScheduledWorkerReview(giftVoucherId) {
  const review = await ManualReviewItem.findOne({
    entityType: 'GiftVoucher',
    entityId: giftVoucherId,
    status: 'open',
    category: EMAIL_FAILED_CATEGORY,
    'evidence.source': { $in: [SCHEDULED_WORKER_SOURCE, PAST_EXPIRY_SOURCE] }
  })
    .select('_id')
    .lean();
  return Boolean(review);
}

async function releaseScheduledDeliveryClaim(giftVoucherId) {
  await GiftVoucher.updateOne(
    { _id: giftVoucherId },
    {
      $unset: {
        scheduledDeliveryClaimedBy: 1,
        scheduledDeliveryClaimedAt: 1,
        scheduledDeliveryClaimExpiresAt: 1
      }
    }
  );
}

async function recordScheduledAttemptFailed({
  giftVoucherId,
  attemptNumber,
  recipientEmail,
  error,
  workerId,
  attemptedAt = new Date()
}) {
  const canonicalEmailLifecycleKey = lifecycleKey('recipient_voucher', giftVoucherId);
  const emailLifecycleKey = `${canonicalEmailLifecycleKey}:scheduled_attempt:${attemptNumber}`;
  await appendVoucherEvent({
    giftVoucherId,
    type: 'scheduled_delivery_attempt_failed',
    actor: SCHEDULED_WORKER_ACTOR,
    note: `scheduled recipient delivery attempt ${attemptNumber} failed`,
    createdAt: attemptedAt,
    metadata: {
      attemptNumber,
      emailLifecycleKey,
      canonicalEmailLifecycleKey,
      recipientEmail,
      error: error || 'unknown_send_failure',
      workerId: workerId || null
    }
  });
}

async function recordScheduledDeliveryExhausted({ giftVoucherId, attemptCount, recipientEmail }) {
  const canonicalEmailLifecycleKey = lifecycleKey('recipient_voucher', giftVoucherId);
  const emailLifecycleKey = `scheduled_delivery_exhausted:${String(giftVoucherId)}`;
  await appendEventOnce({
    giftVoucherId,
    type: 'scheduled_delivery_exhausted',
    actor: SCHEDULED_WORKER_ACTOR,
    note: 'scheduled recipient delivery exhausted retries',
    metadata: {
      emailLifecycleKey,
      canonicalEmailLifecycleKey,
      attemptCount,
      recipientEmail,
      reason: 'max_scheduled_delivery_attempts'
    }
  });
}

async function handleScheduledDeliveryPastExpiry({ voucher, now = new Date() }) {
  const key = pastExpiryLifecycleKey(voucher._id);
  const inserted = await appendEventOnce({
    giftVoucherId: voucher._id,
    type: 'scheduled_delivery_date_past_expiry',
    actor: SCHEDULED_WORKER_ACTOR,
    note: 'scheduled delivery date is on or after voucher expiry',
    metadata: {
      emailLifecycleKey: key,
      deliveryDate: voucher.deliveryDate ? new Date(voucher.deliveryDate).toISOString() : null,
      expiresAt: voucher.expiresAt ? new Date(voucher.expiresAt).toISOString() : null,
      reason: 'delivery_date_past_expiry'
    }
  });

  if (!inserted.inserted) {
    return { ok: true, skipped: true, reason: 'already_flagged_past_expiry' };
  }

  await openEmailFailureReview({
    voucher,
    title: 'Scheduled gift voucher cannot be delivered — delivery date past expiry',
    details:
      'The scheduled delivery date is on or after the voucher expiry date. This voucher will not be sent automatically.',
    templateKind: 'recipient_voucher',
    recipientEmail: voucher.recipientEmail,
    evidence: {
      source: PAST_EXPIRY_SOURCE,
      reason: 'delivery_date_past_expiry',
      deliveryDate: voucher.deliveryDate ? new Date(voucher.deliveryDate).toISOString() : null,
      expiresAt: voucher.expiresAt ? new Date(voucher.expiresAt).toISOString() : null
    }
  });

  return { ok: true, status: 'past_expiry_flagged' };
}

async function evaluateScheduledVoucherEligibility(voucher, { now = new Date() } = {}) {
  if (voucher.deliveryOption !== 'scheduled') {
    return { eligible: false, reason: 'not_scheduled' };
  }
  if (!DELIVERABLE_STATUSES.includes(voucher.status)) {
    return { eligible: false, reason: 'status_not_deliverable' };
  }
  if (voucher.sentAt) {
    return { eligible: false, reason: 'already_sent' };
  }
  if (!voucher.recipientEmail) {
    return { eligible: false, reason: 'missing_recipient_email' };
  }
  if (!isScheduledDeliveryDue(voucher.deliveryDate, now)) {
    return { eligible: false, reason: 'not_due' };
  }
  if (await hasScheduledDeliveryExhausted(voucher._id)) {
    return { eligible: false, reason: 'exhausted' };
  }
  if (await hasOpenScheduledWorkerReview(voucher._id)) {
    return { eligible: false, reason: 'open_manual_review' };
  }
  if (isDeliveryDateOnOrAfterExpiry(voucher.deliveryDate, voucher.expiresAt)) {
    if (!(await hasScheduledDeliveryPastExpiryFlag(voucher._id))) {
      await handleScheduledDeliveryPastExpiry({ voucher, now });
    }
    return { eligible: false, reason: 'delivery_date_past_expiry' };
  }

  const priorFailures = await countScheduledAttemptFailures(voucher._id);
  if (priorFailures >= MAX_SCHEDULED_DELIVERY_ATTEMPTS) {
    return { eligible: false, reason: 'exhausted' };
  }

  const lastAttempt = await getLastScheduledAttemptFailed(voucher._id);
  if (!isRetryBackoffElapsed(lastAttempt, now)) {
    return { eligible: false, reason: 'retry_backoff' };
  }

  return { eligible: true, priorFailures, lastAttempt };
}

async function deliverScheduledRecipientVoucher(voucher, { workerId, now = new Date() } = {}) {
  const fresh = await GiftVoucher.findById(voucher._id);
  if (!fresh) {
    return { ok: false, code: 'GIFT_VOUCHER_NOT_FOUND' };
  }

  const eligibility = await evaluateScheduledVoucherEligibility(fresh, { now });
  if (!eligibility.eligible) {
    await releaseScheduledDeliveryClaim(fresh._id);
    return { ok: true, skipped: true, reason: eligibility.reason };
  }

  const recipientEmail = String(fresh.recipientEmail || '').trim().toLowerCase();
  const priorFailures = eligibility.priorFailures || 0;
  const allowRetryAfterFailure = priorFailures > 0;

  let rawToken;
  try {
    const rotated = await rotateCardAccessTokenForVoucher(fresh._id);
    rawToken = rotated.rawToken;
  } catch (err) {
    await releaseScheduledDeliveryClaim(fresh._id);
    return { ok: false, code: err.code || 'CARD_ACCESS_ROTATION_FAILED' };
  }

  const cardDownloadUrl = buildCardDownloadUrl(rawToken);
  const sendResult = await performLifecycleSend({
    voucher: fresh,
    recipientEmail,
    templateKind: 'recipient_voucher',
    actor: SCHEDULED_WORKER_ACTOR,
    cardDownloadUrl,
    allowRetryAfterFailure,
    lifecycleSource: SCHEDULED_WORKER_SOURCE
  });

  if (sendResult.status === 'sent') {
    await releaseScheduledDeliveryClaim(fresh._id);
    return {
      ok: true,
      status: 'sent',
      giftVoucherId: String(fresh._id),
      recipientEmail,
      rotatedToken: true
    };
  }

  if (sendResult.skipped) {
    await releaseScheduledDeliveryClaim(fresh._id);
    return { ok: true, skipped: true, reason: sendResult.reason };
  }

  const attemptNumber = priorFailures + 1;
  const errorMessage = sendResult.code || 'EMAIL_SEND_FAILED';
  await recordScheduledAttemptFailed({
    giftVoucherId: fresh._id,
    attemptNumber,
    recipientEmail,
    error: errorMessage,
    workerId,
    attemptedAt: now
  });

  if (attemptNumber >= MAX_SCHEDULED_DELIVERY_ATTEMPTS) {
    await recordScheduledDeliveryExhausted({
      giftVoucherId: fresh._id,
      attemptCount: attemptNumber,
      recipientEmail
    });
    await openEmailFailureReview({
      voucher: fresh,
      title: 'Scheduled gift voucher delivery failed after 3 attempts',
      details: 'Worker exhausted retries for scheduled recipient_voucher send',
      templateKind: 'recipient_voucher',
      recipientEmail,
      evidence: {
        source: SCHEDULED_WORKER_SOURCE,
        attemptCount: attemptNumber,
        reason: 'max_scheduled_delivery_attempts'
      }
    });
  }

  await releaseScheduledDeliveryClaim(fresh._id);
  return {
    ok: false,
    status: 'failed',
    attemptNumber,
    exhausted: attemptNumber >= MAX_SCHEDULED_DELIVERY_ATTEMPTS
  };
}

module.exports = {
  SCHEDULED_WORKER_ACTOR,
  SCHEDULED_WORKER_SOURCE,
  PAST_EXPIRY_SOURCE,
  countScheduledAttemptFailures,
  getLastScheduledAttemptFailed,
  isRetryBackoffElapsed,
  evaluateScheduledVoucherEligibility,
  deliverScheduledRecipientVoucher,
  releaseScheduledDeliveryClaim,
  handleScheduledDeliveryPastExpiry,
  hasScheduledDeliveryExhausted,
  hasScheduledDeliveryPastExpiryFlag,
  hasOpenScheduledWorkerReview,
  SCHEDULED_DELIVERY_RETRY_BACKOFF_MS,
  MAX_SCHEDULED_DELIVERY_ATTEMPTS
};
