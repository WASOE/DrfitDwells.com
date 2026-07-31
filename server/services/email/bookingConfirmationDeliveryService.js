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
const {
  classifyEmailDeliveryResult
} = require('./emailDeliveryResultContract');

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

function sanitizePersistenceError(err) {
  const message = String(err?.message || err || 'persistence_error').slice(0, 300);
  return { message, code: err?.code ? String(err.code).slice(0, 80) : null };
}

function emptyFinalizeResult(extra = {}) {
  return {
    definitiveSucceeded: false,
    ambiguous: false,
    repaired: false,
    state: null,
    bookingStamped: false,
    sessionStamped: false,
    jobStamped: false,
    providerMessageIdPersisted: false,
    emailEventLinked: false,
    errorCode: null,
    error: null,
    ...extra
  };
}

/**
 * Atomic EDS → succeeded. Never clears non-null providerMessageId / latestEmailEventId.
 * Returns { state, missing } — state may be null without throw if filter misses.
 */
async function transitionEmailDeliveryStateToSucceeded({
  correlationKey,
  providerMessageId = null,
  emailEventId = null,
  now = new Date(),
  resolutionNote = 'Provider accepted confirmation email'
} = {}) {
  const at = normalizeNow(now);
  const current = await EmailDeliveryState.findOne({ correlationKey });
  if (!current) {
    return { state: null, missing: true };
  }

  const $set = {
    latestStatus: 'succeeded',
    latestEventAt: at,
    resolvedAt: at,
    resolvedBy: 'confirmation_delivery',
    resolutionNote: redactSummary(resolutionNote),
    claimedBy: null,
    claimedAt: null,
    visibilityTimeoutAt: null,
    smtpAttemptStartedAt: null,
    nextAttemptAt: null,
    ambiguousAt: null,
    ambiguousReason: null,
    latestErrorMessage: null,
    lastErrorCode: null
  };

  const msg =
    providerMessageId != null && String(providerMessageId).trim()
      ? String(providerMessageId).trim().slice(0, 500)
      : null;
  if (msg && !current.providerMessageId) {
    $set.providerMessageId = msg;
  }
  if (emailEventId && !current.latestEmailEventId) {
    $set.latestEmailEventId = emailEventId;
  }

  const state = await EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey,
      latestStatus: {
        $in: ['sending', 'pending', 'failed', 'ambiguous', 'success', 'succeeded']
      }
    },
    { $set },
    { new: true }
  );
  return { state, missing: false };
}

async function repairSecondaryConfirmationStamps({
  correlationKey,
  bookingId = null,
  checkoutSessionId = null,
  jobId = null,
  providerMessageId = null,
  emailEventId = null,
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  let repaired = false;
  let bookingStamped = false;
  let sessionStamped = false;
  let jobStamped = false;
  let providerMessageIdPersisted = false;
  let emailEventLinked = false;
  const errors = [];

  const msg =
    providerMessageId != null && String(providerMessageId).trim()
      ? String(providerMessageId).trim().slice(0, 500)
      : null;

  if (msg) {
    try {
      const r = await EmailDeliveryState.updateOne(
        {
          correlationKey,
          $or: [{ providerMessageId: null }, { providerMessageId: { $exists: false } }]
        },
        { $set: { providerMessageId: msg } }
      );
      if (r.modifiedCount > 0) {
        repaired = true;
        providerMessageIdPersisted = true;
      }
    } catch (err) {
      errors.push(sanitizePersistenceError(err).message);
    }
  }

  if (emailEventId) {
    try {
      const r = await EmailDeliveryState.updateOne(
        {
          correlationKey,
          $or: [{ latestEmailEventId: null }, { latestEmailEventId: { $exists: false } }]
        },
        { $set: { latestEmailEventId: emailEventId } }
      );
      if (r.modifiedCount > 0) {
        repaired = true;
        emailEventLinked = true;
      }
    } catch (err) {
      errors.push(sanitizePersistenceError(err).message);
    }
  }

  async function stampBooking() {
    if (!bookingId) return;
    const r = await Booking.updateOne(
      {
        _id: bookingId,
        $or: [
          { confirmationEmailSentAt: { $exists: false } },
          { confirmationEmailSentAt: null }
        ]
      },
      { $set: { confirmationEmailSentAt: at } }
    );
    if (r.modifiedCount > 0 || r.matchedCount === 0) {
      /* matchedCount 0 = missing booking; modified 0 may already stamped */
    }
    const b = await Booking.findById(bookingId).select('confirmationEmailSentAt').lean();
    bookingStamped = Boolean(b?.confirmationEmailSentAt);
    if (r.modifiedCount > 0) repaired = true;
  }

  async function stampSession() {
    if (!checkoutSessionId) return;
    const r = await CheckoutSession.updateOne(
      {
        _id: checkoutSessionId,
        $or: [
          { confirmationEmailSentAt: { $exists: false } },
          { confirmationEmailSentAt: null }
        ]
      },
      { $set: { confirmationEmailSentAt: at } }
    );
    const s = await CheckoutSession.findById(checkoutSessionId)
      .select('confirmationEmailSentAt')
      .lean();
    sessionStamped = Boolean(s?.confirmationEmailSentAt);
    if (r.modifiedCount > 0) repaired = true;
  }

  async function stampJob() {
    if (!jobId) return;
    const r = await CheckoutFinalizationJob.updateOne(
      { _id: jobId },
      { $set: { confirmationSentAt: at } }
    );
    const j = await CheckoutFinalizationJob.findById(jobId).select('confirmationSentAt').lean();
    jobStamped = Boolean(j?.confirmationSentAt);
    if (r.modifiedCount > 0) repaired = true;
  }

  for (const fn of [stampBooking, stampSession, stampJob]) {
    try {
      await fn();
    } catch (err) {
      errors.push(sanitizePersistenceError(err).message);
      try {
        await fn();
      } catch (err2) {
        errors.push(sanitizePersistenceError(err2).message);
      }
    }
  }

  const fresh = await EmailDeliveryState.findOne({ correlationKey });
  if (fresh?.providerMessageId) providerMessageIdPersisted = true;
  if (fresh?.latestEmailEventId) emailEventLinked = true;

  let errorCode = null;
  let error = null;
  if (bookingId && !bookingStamped) {
    errorCode = 'SECONDARY_STAMP_REPAIR_INCOMPLETE';
    error = 'Booking.confirmationEmailSentAt missing after repair';
  } else if (checkoutSessionId && !sessionStamped) {
    errorCode = 'SECONDARY_STAMP_REPAIR_INCOMPLETE';
    error = 'CheckoutSession.confirmationEmailSentAt missing after repair';
  } else if (jobId && !jobStamped) {
    errorCode = 'SECONDARY_STAMP_REPAIR_INCOMPLETE';
    error = 'CheckoutFinalizationJob.confirmationSentAt missing after repair';
  } else if (errors.length) {
    errorCode = 'SECONDARY_STAMP_REPAIR_ERROR';
    error = errors.join('; ').slice(0, 300);
  }

  return {
    repaired,
    bookingStamped,
    sessionStamped,
    jobStamped,
    providerMessageIdPersisted,
    emailEventLinked,
    state: fresh,
    errorCode,
    error
  };
}

/**
 * R2.1 — single owner of post-provider success persistence and repair.
 * mode: 'provider_sent' | 'adopt_prior'
 */
async function finalizeAuthoritativeConfirmationDelivery({
  correlationKey,
  bookingId = null,
  checkoutSessionId = null,
  jobId = null,
  providerMessageId = null,
  emailEventId = null,
  now = new Date(),
  mode = 'provider_sent'
} = {}) {
  const at = normalizeNow(now);
  const evidenceMsg =
    mode === 'adopt_prior'
      ? null
      : providerMessageId != null && String(providerMessageId).trim()
        ? String(providerMessageId).trim().slice(0, 500)
        : null;
  const evidenceEventId = mode === 'adopt_prior' ? emailEventId || null : emailEventId || null;
  const adoptMsg =
    mode === 'adopt_prior' && providerMessageId != null && String(providerMessageId).trim()
      ? String(providerMessageId).trim().slice(0, 500)
      : null;
  const msgForWrite = evidenceMsg || adoptMsg;

  const resolutionNote =
    mode === 'adopt_prior'
      ? 'Adopted prior definitive confirmation delivery'
      : 'Provider accepted confirmation email';

  let transitionError = null;
  let transition = null;
  try {
    transition = await transitionEmailDeliveryStateToSucceeded({
      correlationKey,
      providerMessageId: msgForWrite,
      emailEventId: evidenceEventId,
      now: at,
      resolutionNote
    });
  } catch (err) {
    transitionError = err;
  }

  const needsReadBack =
    Boolean(transitionError) ||
    !transition ||
    transition.missing === true ||
    transition.state == null;

  async function readBack() {
    return EmailDeliveryState.findOne({ correlationKey });
  }

  let stateAfter = transition?.state || null;
  if (needsReadBack) {
    stateAfter = await readBack();
  }

  if (!stateAfter) {
    const sanitized = sanitizePersistenceError(
      transitionError || new Error('EmailDeliveryState missing after provider acceptance')
    );
    return emptyFinalizeResult({
      ambiguous: true,
      errorCode: 'EDS_MISSING_AFTER_PROVIDER_SENT',
      error: sanitized.message
    });
  }

  async function asDefinitive(stateDoc, stampError = null) {
    let repair;
    try {
      repair = await repairSecondaryConfirmationStamps({
        correlationKey,
        bookingId,
        checkoutSessionId,
        jobId,
        providerMessageId: msgForWrite,
        emailEventId: evidenceEventId,
        now: at
      });
    } catch (stampErr) {
      const rb = await readBack();
      if (rb && isDefinitiveSentStatus(rb.latestStatus)) {
        repair = await repairSecondaryConfirmationStamps({
          correlationKey,
          bookingId,
          checkoutSessionId,
          jobId,
          providerMessageId: msgForWrite,
          emailEventId: evidenceEventId,
          now: at
        });
        stampError = sanitizePersistenceError(stampErr).message;
      } else {
        throw stampErr;
      }
    }
    return {
      definitiveSucceeded: true,
      ambiguous: false,
      repaired: repair.repaired,
      state: repair.state || stateDoc,
      bookingStamped: repair.bookingStamped,
      sessionStamped: repair.sessionStamped,
      jobStamped: repair.jobStamped,
      providerMessageIdPersisted: repair.providerMessageIdPersisted,
      emailEventLinked: repair.emailEventLinked,
      errorCode: repair.errorCode || (stampError ? 'SECONDARY_STAMP_ERROR' : null),
      error: repair.error || stampError
    };
  }

  if (isDefinitiveSentStatus(stateAfter.latestStatus)) {
    return asDefinitive(stateAfter);
  }

  if (stateAfter.latestStatus === 'ambiguous') {
    await markConfirmationDeliveryAmbiguous({
      correlationKey,
      reason: 'PERSISTENCE_AFTER_PROVIDER_SENT',
      now: at,
      providerMessageId: msgForWrite,
      emailEventId: evidenceEventId,
      allowedStatuses: ['ambiguous']
    });
    const fresh = await readBack();
    return emptyFinalizeResult({
      ambiguous: true,
      state: fresh,
      providerMessageIdPersisted: Boolean(fresh?.providerMessageId),
      emailEventLinked: Boolean(fresh?.latestEmailEventId),
      errorCode: 'ALREADY_AMBIGUOUS_AFTER_PROVIDER_SENT',
      error: 'EmailDeliveryState already ambiguous after provider acceptance'
    });
  }

  if (stateAfter.latestStatus === 'sending') {
    const updated = await markConfirmationDeliveryAmbiguous({
      correlationKey,
      reason: 'PERSISTENCE_AFTER_PROVIDER_SENT',
      now: at,
      providerMessageId: msgForWrite,
      emailEventId: evidenceEventId,
      allowedStatuses: ['sending']
    });
    return emptyFinalizeResult({
      ambiguous: true,
      state: updated,
      providerMessageIdPersisted: Boolean(updated?.providerMessageId),
      emailEventLinked: Boolean(updated?.latestEmailEventId),
      errorCode: 'PERSISTENCE_AFTER_PROVIDER_SENT',
      error: transitionError
        ? sanitizePersistenceError(transitionError).message
        : 'EDS remained sending after provider acceptance'
    });
  }

  // Unexpected non-definitive (pending/failed/etc.) — fail closed to ambiguous
  const updated = await markConfirmationDeliveryAmbiguous({
    correlationKey,
    reason: 'UNEXPECTED_STATE_AFTER_PROVIDER_SENT',
    now: at,
    providerMessageId: msgForWrite,
    emailEventId: evidenceEventId,
    allowedStatuses: ['sending', 'pending', 'failed']
  });
  const fresh = updated || (await readBack());
  return emptyFinalizeResult({
    ambiguous: true,
    state: fresh,
    providerMessageIdPersisted: Boolean(fresh?.providerMessageId),
    emailEventLinked: Boolean(fresh?.latestEmailEventId),
    errorCode: 'UNEXPECTED_STATE_AFTER_PROVIDER_SENT',
    error: `Unexpected EDS status ${stateAfter.latestStatus} after provider acceptance`
  });
}

/**
 * @deprecated Prefer finalizeAuthoritativeConfirmationDelivery for provider-sent paths.
 * Kept for tests that call the low-level helper directly.
 */
async function markConfirmationDeliverySucceeded({
  correlationKey,
  bookingId,
  checkoutSessionId = null,
  jobId = null,
  providerMessageId = null,
  emailEventId = null,
  now = new Date()
} = {}) {
  const result = await finalizeAuthoritativeConfirmationDelivery({
    correlationKey,
    bookingId,
    checkoutSessionId,
    jobId,
    providerMessageId,
    emailEventId,
    now,
    mode: 'provider_sent'
  });
  return result.state;
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
  now = new Date(),
  providerMessageId = null,
  emailEventId = null,
  allowedStatuses = ['sending']
} = {}) {
  const at = normalizeNow(now);
  const current = await EmailDeliveryState.findOne({ correlationKey });
  if (!current) return null;

  const statuses = Array.isArray(allowedStatuses) && allowedStatuses.length
    ? allowedStatuses
    : ['sending'];

  // Additive evidence only when already ambiguous
  if (current.latestStatus === 'ambiguous' && statuses.includes('ambiguous')) {
    const $set = { latestEventAt: at };
    const msg =
      providerMessageId != null && String(providerMessageId).trim()
        ? String(providerMessageId).trim().slice(0, 500)
        : null;
    if (msg && !current.providerMessageId) $set.providerMessageId = msg;
    if (emailEventId && !current.latestEmailEventId) $set.latestEmailEventId = emailEventId;
    if (Object.keys($set).length === 1) return current;
    return EmailDeliveryState.findOneAndUpdate(
      { correlationKey, latestStatus: 'ambiguous' },
      { $set },
      { new: true }
    );
  }

  if (isDefinitiveSentStatus(current.latestStatus)) {
    return current;
  }

  if (!statuses.includes(current.latestStatus)) {
    return null;
  }

  const history = appendFailureHistory(current.failureHistory, {
    at,
    errorCode: reason,
    errorSummary: redactSummary(
      reason === 'AMBIGUOUS_SMTP_RETRY'
        ? 'Sending lease expired after SMTP attempt started; outcome ambiguous'
        : `Ambiguous confirmation delivery: ${reason}`
    ),
    attemptCount: current.attemptCount,
    stage:
      reason === 'AMBIGUOUS_SMTP_RETRY' ? 'visibility_reclaim' : 'persistence_after_provider'
  });

  const $set = {
    latestStatus: 'ambiguous',
    latestEventAt: at,
    ambiguousAt: current.ambiguousAt || at,
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
    // smtpAttemptStartedAt intentionally preserved
  };

  const msg =
    providerMessageId != null && String(providerMessageId).trim()
      ? String(providerMessageId).trim().slice(0, 500)
      : null;
  if (msg && !current.providerMessageId) $set.providerMessageId = msg;
  if (emailEventId && !current.latestEmailEventId) $set.latestEmailEventId = emailEventId;

  return EmailDeliveryState.findOneAndUpdate(
    { correlationKey, latestStatus: { $in: statuses.filter((s) => s !== 'ambiguous') } },
    { $set },
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

  const templateKey =
    state.templateKey || resolveConfirmationTemplateKey(booking);

  const hasDefinitivePriorDelivery = Boolean(
    booking?.confirmationEmailSentAt || isDefinitiveSentStatus(state.latestStatus)
  );

  let providerAttemptStarted = false;
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
      skipDeliveryStateApply: true,
      hasDefinitivePriorDelivery,
      onProviderAttemptStarted: async () => {
        const updated = await markSmtpAttemptStarted({
          correlationKey: state.correlationKey,
          now: at
        });
        if (!updated) {
          const err = new Error('Failed to record SMTP attempt boundary');
          err.code = 'PROVIDER_ATTEMPT_CALLBACK_FAILED';
          throw err;
        }
        providerAttemptStarted = true;
      }
    });
  } catch (err) {
    if (providerAttemptStarted || err?.providerAccepted === true) {
      await markConfirmationDeliveryAmbiguous({
        correlationKey: state.correlationKey,
        reason: err?.code || 'AMBIGUOUS_SEND_THROW',
        now: at
      });
      return {
        ok: false,
        retryable: false,
        ambiguous: true,
        errorCode: err?.code || 'AMBIGUOUS_SEND_THROW',
        error: err?.message || String(err)
      };
    }
    await markConfirmationDeliveryFailedRetryable({
      correlationKey: state.correlationKey,
      errorCode: err?.code || 'PRE_PROVIDER_FAILURE',
      errorSummary: err?.message || 'Confirmation send failed before provider attempt',
      now: at
    });
    return {
      ok: false,
      retryable: true,
      errorCode: err?.code || 'PRE_PROVIDER_FAILURE',
      error: err?.message || String(err)
    };
  }

  const classified = classifyEmailDeliveryResult(outcome, {
    hasDefinitivePriorDelivery
  });

  if (classified.authoritativeDelivered) {
    const finalized = await finalizeAuthoritativeConfirmationDelivery({
      correlationKey: state.correlationKey,
      bookingId: booking._id,
      checkoutSessionId,
      jobId,
      providerMessageId: classified.providerMessageId,
      emailEventId: outcome?.emailEvent?._id || null,
      now: at,
      mode: 'provider_sent'
    });
    if (finalized.definitiveSucceeded) {
      return {
        ok: true,
        sent: true,
        state: finalized.state,
        finalized,
        classification: classified
      };
    }
    return {
      ok: false,
      retryable: false,
      ambiguous: true,
      errorCode: finalized.errorCode || 'PERSISTENCE_AFTER_PROVIDER_SENT',
      error: finalized.error,
      state: finalized.state,
      finalized,
      classification: classified
    };
  }

  if (classified.adoptPriorDelivery === true && hasDefinitivePriorDelivery) {
    const finalized = await finalizeAuthoritativeConfirmationDelivery({
      correlationKey: state.correlationKey,
      bookingId: booking._id,
      checkoutSessionId,
      jobId,
      providerMessageId: state.providerMessageId || null,
      emailEventId: outcome?.emailEvent?._id || state.latestEmailEventId || null,
      now: at,
      mode: 'adopt_prior'
    });
    if (finalized.definitiveSucceeded) {
      return {
        ok: true,
        sent: true,
        skippedDuplicate: true,
        state: finalized.state,
        finalized,
        classification: classified
      };
    }
    return {
      ok: false,
      retryable: false,
      ambiguous: true,
      errorCode: finalized.errorCode || 'ADOPT_PRIOR_PERSISTENCE_FAILED',
      error: finalized.error,
      state: finalized.state,
      finalized,
      classification: classified
    };
  }

  if (classified.ambiguous) {
    await markConfirmationDeliveryAmbiguous({
      correlationKey: state.correlationKey,
      reason: classified.reason || 'AMBIGUOUS_SEND_OUTCOME',
      now: at
    });
    return {
      ok: false,
      retryable: false,
      ambiguous: true,
      errorCode: classified.classification,
      error: classified.reason,
      classification: classified
    };
  }

  const errorCode =
    classified.classification === 'logged_fallback'
      ? 'LOGGED_FALLBACK'
      : classified.classification === 'unavailable'
        ? 'SMTP_UNAVAILABLE'
        : classified.classification === 'skipped_duplicate'
          ? 'SKIPPED_WITHOUT_EVIDENCE'
          : 'SMTP_FAILURE';

  await markConfirmationDeliveryFailedRetryable({
    correlationKey: state.correlationKey,
    errorCode,
    errorSummary: classified.reason || errorCode,
    now: at
  });
  return {
    ok: false,
    retryable: true,
    errorCode,
    error: classified.reason,
    classification: classified
  };
}

/**
 * Terminal abandon without SMTP — missing/cancelled booking, recipient mismatch, etc.
 * Leaves latestStatus=failed with nextAttemptAt=null so the backlog worker will not loop.
 */
async function markConfirmationDeliveryAbandoned({
  correlationKey,
  errorCode = 'CONFIRMATION_ABANDONED',
  errorSummary = 'Confirmation delivery abandoned',
  now = new Date()
} = {}) {
  const at = normalizeNow(now);
  const current = await EmailDeliveryState.findOne({ correlationKey });
  if (!current) return null;
  if (isDefinitiveSentStatus(current.latestStatus) || current.latestStatus === 'ambiguous') {
    return current;
  }

  const history = appendFailureHistory(current.failureHistory, {
    at,
    errorCode,
    errorSummary,
    attemptCount: current.attemptCount,
    stage: 'abandon'
  });

  return EmailDeliveryState.findOneAndUpdate(
    {
      correlationKey,
      latestStatus: { $in: ['pending', 'failed', 'sending'] }
    },
    {
      $set: {
        latestStatus: 'failed',
        latestEventAt: at,
        lastErrorCode: errorCode,
        latestErrorMessage: redactSummary(errorSummary),
        failureHistory: history,
        nextAttemptAt: null,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        smtpAttemptStartedAt: null,
        resolvedAt: at,
        resolvedBy: 'confirmation_delivery_worker',
        resolutionNote: redactSummary(errorSummary)
      }
    },
    { new: true }
  );
}

/**
 * Due confirmation rows for the backlog worker (pending/failed with nextAttemptAt due).
 */
async function findDueConfirmationDeliveries({
  now = new Date(),
  limit = 20,
  templateKeys = null
} = {}) {
  const at = normalizeNow(now);
  const keys = Array.isArray(templateKeys) && templateKeys.length
    ? templateKeys
    : [
        bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
        bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED
      ];
  const batch = Math.min(100, Math.max(1, Number(limit) || 20));
  return EmailDeliveryState.find({
    domain: 'booking_lifecycle',
    templateKey: { $in: keys },
    latestStatus: { $in: ['pending', 'failed'] },
    $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }]
  })
    .sort({ nextAttemptAt: 1, latestEventAt: 1 })
    .limit(batch);
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
  finalizeAuthoritativeConfirmationDelivery,
  transitionEmailDeliveryStateToSucceeded,
  repairSecondaryConfirmationStamps,
  markConfirmationDeliveryFailedRetryable,
  markConfirmationDeliveryAmbiguous,
  markConfirmationDeliveryAbandoned,
  reclaimStaleSendingConfirmationDeliveries,
  findDueConfirmationDeliveries,
  sendClaimedConfirmationDelivery,
  processBookingConfirmationDelivery,
  resolveConfirmationTemplateKey,
  computeBackoffMs,
  getVisibilityTimeoutMs,
  buildWorkerId,
  isDefinitiveSentStatus
};
