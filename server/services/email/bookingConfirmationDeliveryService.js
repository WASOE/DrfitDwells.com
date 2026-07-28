'use strict';

/**
 * Batch 6 — Crash-safe booking confirmation delivery state machine.
 *
 * States: pending → sending → succeeded | failed | ambiguous
 * - confirmationEmailSentAt set ONLY on provider success
 * - stale sending without smtpAttemptStartedAt → pending (safe retry)
 * - stale sending with smtpAttemptStartedAt → ambiguous (no uncontrolled resend)
 * - two workers cannot claim the same correlationKey concurrently
 */

const os = require('os');
const EmailDeliveryState = require('../../models/EmailDeliveryState');
const {
  FAILURE_HISTORY_MAX,
  isDefinitiveSentStatus
} = require('../../models/EmailDeliveryState');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const {
  bookingLifecycleCorrelationKey,
  normalizeRecipientEmail
} = require('./emailDeliveryCorrelation');
const bookingLifecycleEmailService = require('../bookingLifecycleEmailService');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');

const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 10;
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_CAP_MS = 15 * 60 * 1000;

function normalizeNow(now) {
  return now instanceof Date ? now : new Date(now);
}

function getVisibilityTimeoutMs() {
  const raw = process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_VISIBILITY_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_VISIBILITY_TIMEOUT_MS;
  return Math.floor(n);
}

function computeBackoffMs(attemptCount, { random = Math.random } = {}) {
  const n = Math.max(1, Number(attemptCount) || 1);
  const exp = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, n - 1));
  const capped = Math.min(BACKOFF_CAP_MS, exp);
  const jitter = 0.8 + random() * 0.4;
  return Math.max(BACKOFF_BASE_MS, Math.floor(capped * jitter));
}

function redactSummary(value, max = 500) {
  let s = value == null ? '' : String(value);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  s = s.replace(/\bsk_(live|test)_[A-Za-z0-9]+\b/g, '[redacted-secret]');
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function appendFailureHistory(existingHistory, entry) {
  const prev = Array.isArray(existingHistory) ? existingHistory.slice() : [];
  prev.push({
    at: entry.at,
    errorCode: entry.errorCode || null,
    errorSummary: redactSummary(entry.errorSummary),
    attemptCount: entry.attemptCount != null ? entry.attemptCount : null,
    stage: entry.stage || null
  });
  if (prev.length > FAILURE_HISTORY_MAX) {
    return prev.slice(prev.length - FAILURE_HISTORY_MAX);
  }
  return prev;
}

function buildWorkerId(prefix = 'confirmation') {
  return `${os.hostname()}#${process.pid}#${prefix}#${Date.now().toString(36)}`;
}

function resolveConfirmationTemplateKey(booking) {
  if (String(booking?.status || '') === 'confirmed') {
    return bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED;
  }
  return bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED;
}

function resolveRecipient(booking) {
  return normalizeRecipientEmail(booking?.guestInfo?.email || '');
}

/**
 * Ensure a pending confirmation delivery row exists (idempotent).
 * Adopts definitive sent evidence without creating a resend.
 */
async function ensurePendingConfirmationDelivery({
  booking,
  session = null,
  templateKey = null,
  source = 'automatic',
  now = new Date()
} = {}) {
  if (!booking?._id) {
    throw new Error('booking is required');
  }
  const at = normalizeNow(now);
  const recipient = resolveRecipient(booking);
  if (!recipient) {
    return { ok: false, skipped: true, reason: 'missing_recipient' };
  }

  const keyTemplate = templateKey || resolveConfirmationTemplateKey(booking);
  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: keyTemplate,
    recipientEmail: recipient
  });

  const existing = await EmailDeliveryState.findOne({ correlationKey });
  if (existing && isDefinitiveSentStatus(existing.latestStatus)) {
    return {
      ok: true,
      correlationKey,
      status: existing.latestStatus,
      adoptedSent: true,
      state: existing
    };
  }

  if (booking.confirmationEmailSentAt) {
    const adopted = await EmailDeliveryState.findOneAndUpdate(
      { correlationKey },
      {
        $set: {
          correlationKey,
          domain: 'booking_lifecycle',
          bookingId: booking._id,
          checkoutId: session?.checkoutId || booking.checkoutId || null,
          templateKey: keyTemplate,
          recipient,
          latestStatus: 'succeeded',
          latestEventAt: booking.confirmationEmailSentAt,
          latestLifecycleSource: 'automatic',
          resolvedAt: booking.confirmationEmailSentAt,
          resolvedBy: 'adopt_existing_sent_evidence',
          resolutionNote: 'Adopted Booking.confirmationEmailSentAt',
          claimedBy: null,
          claimedAt: null,
          visibilityTimeoutAt: null,
          smtpAttemptStartedAt: null,
          nextAttemptAt: null
        },
        $setOnInsert: {
          attemptCount: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          failureHistory: []
        }
      },
      { upsert: true, new: true }
    );
    return {
      ok: true,
      correlationKey,
      status: 'succeeded',
      adoptedSent: true,
      state: adopted
    };
  }

  if (existing) {
    if (['ambiguous', 'sending', 'pending', 'failed'].includes(existing.latestStatus)) {
      return {
        ok: true,
        correlationKey,
        status: existing.latestStatus,
        adoptedSent: false,
        state: existing
      };
    }
  }

  try {
    const created = await EmailDeliveryState.create({
      correlationKey,
      domain: 'booking_lifecycle',
      bookingId: booking._id,
      checkoutId: session?.checkoutId || booking.checkoutId || null,
      templateKey: keyTemplate,
      recipient,
      latestStatus: 'pending',
      latestEventAt: at,
      latestLifecycleSource: source === 'manual_resend' ? 'manual_resend' : 'automatic',
      nextAttemptAt: at,
      attemptCount: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      failureHistory: []
    });
    return {
      ok: true,
      correlationKey,
      status: 'pending',
      adoptedSent: false,
      state: created
    };
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const raced = await EmailDeliveryState.findOne({ correlationKey });
    return {
      ok: true,
      correlationKey,
      status: raced?.latestStatus || 'pending',
      adoptedSent: isDefinitiveSentStatus(raced?.latestStatus),
      state: raced
    };
  }
}

/**
 * Atomic claim: pending|failed (due) → sending.
 */
async function claimConfirmationDeliveryAttempt({
  correlationKey,
  workerId,
  now = new Date(),
  visibilityTimeoutMs = getVisibilityTimeoutMs()
} = {}) {
  const at = normalizeNow(now);
  const wid = String(workerId || '').trim() || buildWorkerId();
  const vt = new Date(at.getTime() + visibilityTimeoutMs);

  return EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey,
      latestStatus: { $in: ['pending', 'failed'] },
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }]
    },
    {
      $set: {
        latestStatus: 'sending',
        latestEventAt: at,
        claimedBy: wid,
        claimedAt: at,
        visibilityTimeoutAt: vt,
        smtpAttemptStartedAt: null
      },
      $inc: { attemptCount: 1 }
    },
    { new: true }
  );
}

async function markSmtpAttemptStarted({ correlationKey, now = new Date() } = {}) {
  const at = normalizeNow(now);
  return EmailDeliveryState.findOneAndUpdate(
    { correlationKey, latestStatus: 'sending', smtpAttemptStartedAt: null },
    { $set: { smtpAttemptStartedAt: at, latestEventAt: at } },
    { new: true }
  );
}

async function markConfirmationDeliverySucceeded({
  correlationKey,
  bookingId,
  checkoutSessionId = null,
  jobId = null,
  providerMessageId = null,
  emailEventId = null,
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  const state = await EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey,
      latestStatus: {
        $in: ['sending', 'pending', 'failed', 'ambiguous', 'success', 'succeeded']
      }
    },
    {
      $set: {
        latestStatus: 'succeeded',
        latestEventAt: at,
        resolvedAt: at,
        resolvedBy: 'confirmation_delivery',
        resolutionNote: 'Provider accepted confirmation email',
        providerMessageId: providerMessageId ? String(providerMessageId).slice(0, 500) : null,
        latestEmailEventId: emailEventId || undefined,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        smtpAttemptStartedAt: null,
        nextAttemptAt: null,
        ambiguousAt: null,
        ambiguousReason: null,
        latestErrorMessage: null,
        lastErrorCode: null
      }
    },
    { new: true }
  );

  if (bookingId) {
    await Booking.updateOne(
      {
        _id: bookingId,
        $or: [
          { confirmationEmailSentAt: { $exists: false } },
          { confirmationEmailSentAt: null }
        ]
      },
      { $set: { confirmationEmailSentAt: at } }
    );
  }

  if (checkoutSessionId) {
    await CheckoutSession.updateOne(
      {
        _id: checkoutSessionId,
        $or: [
          { confirmationEmailSentAt: { $exists: false } },
          { confirmationEmailSentAt: null }
        ]
      },
      { $set: { confirmationEmailSentAt: at } }
    );
  }

  if (jobId) {
    await CheckoutFinalizationJob.updateOne(
      { _id: jobId },
      { $set: { confirmationSentAt: at } }
    );
  }

  return state;
}

async function markConfirmationDeliveryFailedRetryable({
  correlationKey,
  errorCode = 'SMTP_FAILURE',
  errorSummary = 'Confirmation email send failed',
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  const current = await EmailDeliveryState.findOne({ correlationKey });
  if (!current || current.latestStatus !== 'sending') {
    return null;
  }

  const attempts = Number(current.attemptCount) || 0;
  const max = Number(current.maxAttempts) > 0 ? Number(current.maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  const history = appendFailureHistory(current.failureHistory, {
    at,
    errorCode,
    errorSummary,
    attemptCount: attempts,
    stage: 'smtp_send'
  });

  if (attempts >= max) {
    return EmailDeliveryState.findOneAndUpdate(
      { correlationKey, latestStatus: 'sending' },
      {
        $set: {
          latestStatus: 'failed',
          latestEventAt: at,
          latestErrorMessage: redactSummary(errorSummary),
          lastErrorCode: errorCode,
          failureHistory: history,
          claimedBy: null,
          claimedAt: null,
          visibilityTimeoutAt: null,
          smtpAttemptStartedAt: null,
          nextAttemptAt: null
        }
      },
      { new: true }
    );
  }

  const backoff = computeBackoffMs(attempts);
  return EmailDeliveryState.findOneAndUpdate(
    { correlationKey, latestStatus: 'sending' },
    {
      $set: {
        latestStatus: 'failed',
        latestEventAt: at,
        latestErrorMessage: redactSummary(errorSummary),
        lastErrorCode: errorCode,
        failureHistory: history,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        smtpAttemptStartedAt: null,
        nextAttemptAt: new Date(at.getTime() + backoff)
      }
    },
    { new: true }
  );
}

async function markConfirmationDeliveryAmbiguous({
  correlationKey,
  reason = 'AMBIGUOUS_SMTP_RETRY',
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  const current = await EmailDeliveryState.findOne({ correlationKey });
  if (!current) return null;

  const history = appendFailureHistory(current.failureHistory, {
    at,
    errorCode: reason,
    errorSummary: 'Sending lease expired after SMTP attempt started; outcome ambiguous',
    attemptCount: current.attemptCount,
    stage: 'visibility_reclaim'
  });

  return EmailDeliveryState.findOneAndUpdate(
    { correlationKey, latestStatus: 'sending' },
    {
      $set: {
        latestStatus: 'ambiguous',
        latestEventAt: at,
        ambiguousAt: at,
        ambiguousReason: redactSummary(reason),
        lastErrorCode: reason,
        latestErrorMessage: redactSummary(
          'Confirmation may have been accepted by provider; suppressed automatic resend'
        ),
        failureHistory: history,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        nextAttemptAt: null
      }
    },
    { new: true }
  );
}

/**
 * Reclaim stale sending leases.
 * - no smtpAttemptStartedAt → pending (crash before SMTP)
 * - smtpAttemptStartedAt set → ambiguous (do not uncontrolled resend)
 */
async function reclaimStaleSendingConfirmationDeliveries({
  now = new Date(),
  limit = 50
} = {}) {
  const at = normalizeNow(now);
  const stale = await EmailDeliveryState.find({
    latestStatus: 'sending',
    visibilityTimeoutAt: { $lte: at }
  })
    .sort({ visibilityTimeoutAt: 1 })
    .limit(Math.min(100, Math.max(1, limit)))
    .lean();

  const results = { reclaimedPending: 0, markedAmbiguous: 0, rows: [] };

  for (const row of stale) {
    if (row.smtpAttemptStartedAt) {
      console.warn(
        JSON.stringify({
          event: 'AMBIGUOUS_SMTP_RETRY',
          correlationKey: row.correlationKey,
          bookingId: row.bookingId ? String(row.bookingId) : null,
          attemptCount: row.attemptCount
        })
      );
      const updated = await markConfirmationDeliveryAmbiguous({
        correlationKey: row.correlationKey,
        now: at
      });
      if (updated) {
        results.markedAmbiguous += 1;
        results.rows.push(updated);
      }
      continue;
    }

    const updated = await EmailDeliveryState.findOneAndUpdate(
      {
        _id: row._id,
        latestStatus: 'sending',
        visibilityTimeoutAt: { $lte: at },
        smtpAttemptStartedAt: null
      },
      {
        $set: {
          latestStatus: 'pending',
          latestEventAt: at,
          claimedBy: null,
          claimedAt: null,
          visibilityTimeoutAt: null,
          nextAttemptAt: at,
          lastErrorCode: 'SENDING_VISIBILITY_TIMEOUT',
          latestErrorMessage: 'Sending lease expired before SMTP attempt; requeued pending'
        }
      },
      { new: true }
    );
    if (updated) {
      results.reclaimedPending += 1;
      results.rows.push(updated);
    }
  }

  return results;
}

/**
 * Send confirmation for a claimed delivery row. Never rolls back Booking.
 */
async function sendClaimedConfirmationDelivery({
  state,
  booking,
  entity = null,
  checkoutSessionId = null,
  jobId = null,
  now = new Date(),
  sendFn = null
} = {}) {
  if (!state || state.latestStatus !== 'sending') {
    return { ok: false, reason: 'not_sending' };
  }
  if (isDefinitiveSentStatus(state.latestStatus)) {
    return { ok: true, alreadySent: true };
  }

  const at = normalizeNow(now);
  await markSmtpAttemptStarted({ correlationKey: state.correlationKey, now: at });

  const templateKey =
    state.templateKey || resolveConfirmationTemplateKey(booking);

  let outcome;
  try {
    const runner =
      typeof sendFn === 'function'
        ? sendFn
        : bookingLifecycleEmailService.sendBookingLifecycleEmail.bind(
            bookingLifecycleEmailService
          );
    outcome = await runner({
      booking,
      templateKey,
      overrideRecipient: null,
      lifecycleSource: 'automatic',
      actorContext: null,
      entity,
      skipDeliveryStateApply: true
    });
  } catch (err) {
    await markConfirmationDeliveryFailedRetryable({
      correlationKey: state.correlationKey,
      errorCode: err?.code || 'SMTP_FAILURE',
      errorSummary: err?.message || 'Confirmation send threw',
      now: at
    });
    return {
      ok: false,
      retryable: true,
      errorCode: err?.code || 'SMTP_FAILURE',
      error: err?.message || String(err)
    };
  }

  if (outcome?.success || outcome?.sendStatus === 'success') {
    const succeeded = await markConfirmationDeliverySucceeded({
      correlationKey: state.correlationKey,
      bookingId: booking._id,
      checkoutSessionId,
      jobId,
      providerMessageId: outcome?.sendResult?.messageId || outcome?.messageId || null,
      emailEventId: outcome?.emailEvent?._id || null,
      now: at
    });
    return { ok: true, sent: true, state: succeeded };
  }

  // skipped-duplicate from in-memory window: treat as success if already delivered
  if (outcome?.sendStatus === 'skipped') {
    const succeeded = await markConfirmationDeliverySucceeded({
      correlationKey: state.correlationKey,
      bookingId: booking._id,
      checkoutSessionId,
      jobId,
      providerMessageId: null,
      emailEventId: outcome?.emailEvent?._id || null,
      now: at
    });
    return { ok: true, sent: true, skippedDuplicate: true, state: succeeded };
  }

  await markConfirmationDeliveryFailedRetryable({
    correlationKey: state.correlationKey,
    errorCode: 'SMTP_FAILURE',
    errorSummary: outcome?.sendResult?.error || outcome?.method || 'SMTP send failed',
    now: at
  });
  return {
    ok: false,
    retryable: true,
    errorCode: 'SMTP_FAILURE',
    error: outcome?.sendResult?.error || 'SMTP send failed'
  };
}

/**
 * High-level: ensure pending, optionally claim+send.
 * Never creates PaymentIntent, refunds, or deletes Booking.
 */
async function processBookingConfirmationDelivery({
  booking,
  session = null,
  source = 'frontend',
  send = false,
  workerId = null,
  jobId = null,
  entity = null,
  now = new Date(),
  sendFn = null
} = {}) {
  const ensured = await ensurePendingConfirmationDelivery({
    booking,
    session,
    source,
    now
  });

  if (ensured.adoptedSent || isDefinitiveSentStatus(ensured.status)) {
    if (jobId) {
      await CheckoutFinalizationJob.updateOne(
        { _id: jobId, confirmationQueuedAt: null },
        { $set: { confirmationQueuedAt: normalizeNow(now) } }
      ).catch(() => {});
      if (booking.confirmationEmailSentAt || ensured.adoptedSent) {
        await CheckoutFinalizationJob.updateOne(
          { _id: jobId },
          {
            $set: {
              confirmationSentAt: booking.confirmationEmailSentAt || normalizeNow(now)
            }
          }
        ).catch(() => {});
      }
    }
    return {
      ok: true,
      sent: true,
      adoptedSent: true,
      correlationKey: ensured.correlationKey,
      status: ensured.status,
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
  }

  if (jobId) {
    await CheckoutFinalizationJob.updateOne(
      { _id: jobId },
      { $set: { confirmationQueuedAt: normalizeNow(now) } }
    ).catch(() => {});
  }

  if (!send) {
    return {
      ok: true,
      sent: false,
      queued: true,
      correlationKey: ensured.correlationKey,
      status: ensured.status,
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
  }

  if (ensured.status === 'ambiguous') {
    return {
      ok: true,
      sent: false,
      ambiguous: true,
      correlationKey: ensured.correlationKey,
      status: 'ambiguous',
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
  }

  await reclaimStaleSendingConfirmationDeliveries({ now, limit: 5 });

  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: workerId || buildWorkerId(source),
    now
  });

  if (!claimed) {
    const current = await EmailDeliveryState.findOne({
      correlationKey: ensured.correlationKey
    }).lean();
    return {
      ok: true,
      sent: isDefinitiveSentStatus(current?.latestStatus),
      claimLost: true,
      correlationKey: ensured.correlationKey,
      status: current?.latestStatus || ensured.status,
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
  }

  const sendResult = await sendClaimedConfirmationDelivery({
    state: claimed,
    booking,
    entity,
    checkoutSessionId: session?._id || booking.checkoutSessionId || null,
    jobId,
    now,
    sendFn
  });

  return {
    ...sendResult,
    correlationKey: ensured.correlationKey,
    refundAttempted: false,
    paymentIntentCreateAttempted: false
  };
}

module.exports = {
  DEFAULT_VISIBILITY_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  ensurePendingConfirmationDelivery,
  claimConfirmationDeliveryAttempt,
  markSmtpAttemptStarted,
  markConfirmationDeliverySucceeded,
  markConfirmationDeliveryFailedRetryable,
  markConfirmationDeliveryAmbiguous,
  reclaimStaleSendingConfirmationDeliveries,
  sendClaimedConfirmationDelivery,
  processBookingConfirmationDelivery,
  resolveConfirmationTemplateKey,
  computeBackoffMs,
  getVisibilityTimeoutMs,
  buildWorkerId,
  isDefinitiveSentStatus
};
