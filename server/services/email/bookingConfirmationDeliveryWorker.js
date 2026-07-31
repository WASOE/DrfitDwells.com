'use strict';

/**
 * Booking-confirmation EmailDeliveryState backlog worker.
 *
 * Batch 1: process-local readiness gating + authoritative send path.
 * Does not publish Mongo heartbeats (Batch 2).
 *
 * Flag: BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED (default off).
 */

const os = require('os');
const featureFlags = require('../../utils/featureFlags');
const { isNonEmptyEnvValue } = require('../../config/loadServerEnv');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const EmailDeliveryState = require('../../models/EmailDeliveryState');
require('../../models/Cabin');
require('../../models/CabinType');
require('../../models/Unit');
const bookingLifecycleEmailService = require('../bookingLifecycleEmailService');
const { normalizeRecipientEmail } = require('./emailDeliveryCorrelation');
const {
  reclaimStaleSendingConfirmationDeliveries,
  findDueConfirmationDeliveries,
  claimConfirmationDeliveryAttempt,
  sendClaimedConfirmationDelivery,
  finalizeAuthoritativeConfirmationDelivery,
  markConfirmationDeliveryAbandoned,
  isDefinitiveSentStatus,
  getVisibilityTimeoutMs,
  buildWorkerId
} = require('./bookingConfirmationDeliveryService');

const DEFAULT_TICK_MS = 30 * 1000;
const DEFAULT_SWEEPER_TICK_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_VERIFY_TIMEOUT_MS = 15 * 1000;
const DEFAULT_DEGRADED_REVERIFY_MS = 60 * 1000;
const DEFAULT_READY_REVERIFY_MS = 300 * 1000;

const CONFIRMATION_TEMPLATE_KEYS = [
  bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
  bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED
];

const READINESS = Object.freeze({
  STARTING: 'starting',
  CONFIGURED: 'configured',
  VERIFYING: 'verifying',
  READY: 'ready',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  STOPPED: 'stopped'
});

const state = {
  tickTimer: null,
  sweeperTimer: null,
  reverifyTimer: null,
  enabled: false,
  running: false,
  configured: false,
  bootstrapCompleted: false,
  mongoConnected: false,
  workerId: null,
  tickMs: DEFAULT_TICK_MS,
  sweeperTickMs: DEFAULT_SWEEPER_TICK_MS,
  batchSize: DEFAULT_BATCH_SIZE,
  readinessState: READINESS.STOPPED,
  stopping: false,
  smtpConfigured: false,
  smtpVerified: false,
  smtpVerifiedAt: null,
  lastVerifyAt: null,
  lastVerifyError: null,
  lastDegradedLogAt: null,
  lastTickAt: null,
  lastSuccessfulTickAt: null,
  lastSweepAt: null,
  lastErrorAt: null,
  lastError: null,
  lastTickError: null,
  lastSweepError: null,
  processedTotal: 0,
  succeededTotal: 0,
  retryableFailureTotal: 0,
  ambiguousTotal: 0,
  skippedTotal: 0,
  abandonedTotal: 0,
  lastTickProcessed: 0,
  lastTickSucceeded: 0,
  lastTickRetryable: 0,
  lastTickAmbiguous: 0,
  lastTickSkipped: 0,
  lastTickAbandoned: 0,
  sendFn: null,
  verifyFn: null,
  emailServiceRef: null,
  releaseId: null,
  readinessGeneration: 0
};

function bumpReadinessGeneration(reason) {
  state.readinessGeneration += 1;
  return state.readinessGeneration;
}

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function resolveWorkerId() {
  const explicit = String(process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ID || '').trim();
  if (explicit) return explicit;
  return buildWorkerId('confirmation-worker');
}

function isEmailDeliveryRequiredEnabled() {
  const v = process.env.EMAIL_DELIVERY_REQUIRED;
  if (!isNonEmptyEnvValue(v)) return false;
  const n = String(v).trim().toLowerCase();
  return n === '1' || n === 'true' || n === 'yes' || n === 'on';
}

function isSmtpConfiguredInEnv() {
  return (
    isNonEmptyEnvValue(process.env.SMTP_HOST) ||
    isNonEmptyEnvValue(process.env.SMTP_URL)
  );
}

function readEnvConfig() {
  return {
    enabled: featureFlags.isBookingConfirmationDeliveryWorkerEnabled(),
    workerId: resolveWorkerId(),
    tickMs: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_DELIVERY_WORKER_TICK_MS',
      DEFAULT_TICK_MS
    ),
    sweeperTickMs: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_DELIVERY_WORKER_SWEEPER_TICK_MS',
      DEFAULT_SWEEPER_TICK_MS
    ),
    batchSize: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_DELIVERY_WORKER_BATCH_SIZE',
      DEFAULT_BATCH_SIZE
    ),
    verifyTimeoutMs: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_SMTP_VERIFY_TIMEOUT_MS',
      DEFAULT_VERIFY_TIMEOUT_MS
    ),
    degradedReverifyMs: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_SMTP_REVERIFY_MS',
      DEFAULT_DEGRADED_REVERIFY_MS
    ),
    readyReverifyMs: parsePositiveIntEnv(
      'BOOKING_CONFIRMATION_SMTP_READY_REVERIFY_MS',
      DEFAULT_READY_REVERIFY_MS
    )
  };
}

function logEvent(event, fields = {}) {
  console.log(
    JSON.stringify({
      event,
      source: 'booking-confirmation-delivery-worker',
      workerId: state.workerId,
      readinessState: state.readinessState,
      ...fields
    })
  );
}

function setLastError(err) {
  state.lastErrorAt = new Date();
  state.lastError = err?.message || String(err);
  state.lastTickError = state.lastError;
}

function isBookingConfirmationDeliveryReady() {
  return (
    state.enabled === true &&
    state.readinessState === READINESS.READY &&
    state.stopping !== true &&
    state.mongoConnected === true &&
    state.bootstrapCompleted === true &&
    state.smtpConfigured === true &&
    state.smtpVerified === true &&
    featureFlags.isBookingConfirmationDeliveryWorkerEnabled()
  );
}

function getEmailService() {
  if (state.emailServiceRef) return state.emailServiceRef;
  // Lazy require — entrypoint must load env before first call.
  // eslint-disable-next-line global-require
  state.emailServiceRef = require('../emailService');
  return state.emailServiceRef;
}

async function runSmtpVerificationOnce({ reason = 'periodic' } = {}) {
  if (state.stopping || state.readinessState === READINESS.STOPPED) {
    return { ok: false, reason: 'stopped' };
  }

  state.smtpConfigured = isSmtpConfiguredInEnv();
  if (!state.smtpConfigured) {
    state.smtpVerified = false;
    state.readinessState = READINESS.DEGRADED;
    state.lastVerifyError = 'SMTP transport not configured';
    logEvent('booking_confirmation_worker_degraded', {
      reason: 'smtp_not_configured',
      verifyReason: reason
    });
    return { ok: false, configured: false };
  }

  state.readinessState =
    state.readinessState === READINESS.READY
      ? READINESS.READY
      : READINESS.VERIFYING;

  const cfg = readEnvConfig();
  let result;
  try {
    if (typeof state.verifyFn === 'function') {
      result = await state.verifyFn({ timeoutMs: cfg.verifyTimeoutMs });
    } else {
      const emailService = getEmailService();
      result = await emailService.verifyTransportReady({
        timeoutMs: cfg.verifyTimeoutMs
      });
    }
  } catch (err) {
    result = {
      ok: false,
      configured: true,
      verified: false,
      error: err?.message || String(err),
      errorCode: 'SMTP_VERIFY_THREW'
    };
  }

  state.lastVerifyAt = new Date();
  state.smtpConfigured = result.configured !== false && state.smtpConfigured;

  if (result.ok && result.verified) {
    const wasReady = state.readinessState === READINESS.READY;
    state.smtpVerified = true;
    state.smtpVerifiedAt = new Date();
    state.lastVerifyError = null;
    state.readinessState = READINESS.READY;
    if (!wasReady) {
      logEvent('booking_confirmation_worker_smtp_verified', {
        verifyReason: reason,
        readinessGeneration: state.readinessGeneration
      });
    }
    scheduleReverify(cfg.readyReverifyMs);
    return { ok: true, result };
  }

  const wasReady = state.readinessState === READINESS.READY;
  state.smtpVerified = false;
  state.lastVerifyError = result.error || 'SMTP verify failed';
  state.readinessState = READINESS.DEGRADED;
  if (wasReady) {
    bumpReadinessGeneration('smtp_verify_failed');
  }
  const now = Date.now();
  if (
    !state.lastDegradedLogAt ||
    now - state.lastDegradedLogAt >= cfg.degradedReverifyMs
  ) {
    state.lastDegradedLogAt = now;
    logEvent('booking_confirmation_worker_degraded', {
      verifyReason: reason,
      errorCode: result.errorCode || null,
      error: state.lastVerifyError
    });
  }
  scheduleReverify(cfg.degradedReverifyMs);
  return { ok: false, result };
}

function scheduleReverify(ms) {
  if (state.reverifyTimer) {
    clearTimeout(state.reverifyTimer);
    state.reverifyTimer = null;
  }
  if (state.stopping || !state.running) return;
  state.reverifyTimer = setTimeout(() => {
    runSmtpVerificationOnce({ reason: 'reverify' }).catch(() => {});
  }, ms);
  if (state.reverifyTimer.unref) state.reverifyTimer.unref();
}

/**
 * Production fatal checks for enabled worker. Throws Error with .fatal = true.
 */
function assertProductionWorkerConfigOrThrow({ nodeEnv = process.env.NODE_ENV } = {}) {
  if (String(nodeEnv) !== 'production') return;
  if (!featureFlags.isBookingConfirmationDeliveryWorkerEnabled()) return;

  if (!isSmtpConfiguredInEnv()) {
    const err = new Error(
      'BOOKING_CONFIRMATION_DELIVERY_WORKER fatal: SMTP_HOST or SMTP_URL required in production'
    );
    err.code = 'SMTP_NOT_CONFIGURED';
    err.fatal = true;
    throw err;
  }
  if (!isEmailDeliveryRequiredEnabled()) {
    const err = new Error(
      'BOOKING_CONFIRMATION_DELIVERY_WORKER fatal: EMAIL_DELIVERY_REQUIRED=1 required in production'
    );
    err.code = 'EMAIL_DELIVERY_REQUIRED_MISSING';
    err.fatal = true;
    throw err;
  }
}

async function openAbandonManualReview({ stateRow, errorCode, details }) {
  try {
    const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
    await openManualReviewItem({
      category: 'booking_lifecycle_email_failed',
      severity: 'high',
      entityType: 'EmailDeliveryState',
      entityId: stateRow?._id ? String(stateRow._id) : null,
      title: 'Booking confirmation delivery abandoned',
      details: details || errorCode,
      provenance: {
        source: 'booking_confirmation_delivery_worker',
        sourceReference: stateRow?.correlationKey || null
      },
      evidence: {
        correlationId: stateRow?.correlationKey || null,
        bookingId: stateRow?.bookingId ? String(stateRow.bookingId) : null,
        templateKey: stateRow?.templateKey || null,
        failedInvariant: errorCode,
        recipientPresent: Boolean(stateRow?.recipient)
      }
    });
  } catch {
    /* non-fatal */
  }
}

async function abandonRow(stateRow, errorCode, errorSummary, now) {
  const updated = await markConfirmationDeliveryAbandoned({
    correlationKey: stateRow.correlationKey,
    errorCode,
    errorSummary,
    now
  });
  await openAbandonManualReview({
    stateRow,
    errorCode,
    details: errorSummary
  });
  state.abandonedTotal += 1;
  state.lastTickAbandoned += 1;
  logEvent('booking_confirmation_worker_skipped', {
    outcome: 'abandoned',
    correlationKey: stateRow.correlationKey,
    bookingId: stateRow.bookingId ? String(stateRow.bookingId) : null,
    errorCode
  });
  return { outcome: 'abandoned', state: updated, errorCode };
}

function isClaimReadinessGateOpen({ expectedGeneration, forceReady = false } = {}) {
  if (forceReady === true) return true;
  if (state.stopping) return false;
  if (!isBookingConfirmationDeliveryReady()) return false;
  if (
    expectedGeneration != null &&
    state.readinessGeneration !== expectedGeneration
  ) {
    return false;
  }
  return true;
}

async function processDueRow(
  stateRow,
  { now, sendFn, expectedGeneration = null, forceReady = false } = {}
) {
  const at = now instanceof Date ? now : new Date(now);

  if (isDefinitiveSentStatus(stateRow.latestStatus)) {
    state.skippedTotal += 1;
    state.lastTickSkipped += 1;
    logEvent('booking_confirmation_worker_skipped', {
      outcome: 'already_succeeded',
      correlationKey: stateRow.correlationKey
    });
    return { outcome: 'already_succeeded' };
  }

  if (stateRow.latestStatus === 'ambiguous') {
    state.ambiguousTotal += 1;
    state.lastTickAmbiguous += 1;
    logEvent('booking_confirmation_worker_ambiguous', {
      correlationKey: stateRow.correlationKey,
      reason: 'row_already_ambiguous'
    });
    return { outcome: 'ambiguous' };
  }

  let booking = null;
  if (stateRow.bookingId) {
    booking = await Booking.findById(stateRow.bookingId);
  }
  if (!booking) {
    return abandonRow(
      stateRow,
      'BOOKING_MISSING',
      'Booking missing for confirmation delivery state',
      at
    );
  }

  const status = String(booking.status || '');
  if (status === 'cancelled') {
    return abandonRow(
      stateRow,
      'BOOKING_CANCELLED',
      'Booking cancelled; confirmation will not be sent',
      at
    );
  }

  if (
    stateRow.templateKey === bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED &&
    status !== 'confirmed'
  ) {
    return abandonRow(
      stateRow,
      'BOOKING_NOT_CONFIRMED',
      `Booking status ${status} is not confirmed for booking_confirmed template`,
      at
    );
  }

  const bookingRecipient = normalizeRecipientEmail(booking.guestInfo?.email || '');
  const stateRecipient = normalizeRecipientEmail(stateRow.recipient || '');
  if (!bookingRecipient || !stateRecipient || bookingRecipient !== stateRecipient) {
    return abandonRow(
      stateRow,
      'BOOKING_RECIPIENT_MISMATCH',
      'Booking email does not match confirmation delivery recipient',
      at
    );
  }

  if (booking.confirmationEmailSentAt) {
    const finalized = await finalizeAuthoritativeConfirmationDelivery({
      correlationKey: stateRow.correlationKey,
      bookingId: booking._id,
      checkoutSessionId: booking.checkoutSessionId || null,
      providerMessageId: stateRow.providerMessageId || null,
      emailEventId: stateRow.latestEmailEventId || null,
      now: at,
      mode: 'adopt_prior'
    });
    if (finalized.definitiveSucceeded) {
      state.succeededTotal += 1;
      state.lastTickSucceeded += 1;
      logEvent('booking_confirmation_worker_succeeded', {
        outcome: 'adopted_sent',
        correlationKey: stateRow.correlationKey,
        bookingId: String(booking._id)
      });
      return { outcome: 'adopted_sent', state: finalized.state, finalized };
    }
    state.ambiguousTotal += 1;
    state.lastTickAmbiguous += 1;
    logEvent('booking_confirmation_worker_ambiguous', {
      outcome: 'adopt_prior_persistence',
      correlationKey: stateRow.correlationKey,
      errorCode: finalized.errorCode || null
    });
    return { outcome: 'ambiguous', finalized };
  }

  // R2.2: final synchronous readiness gate — no await between check and claim invoke.
  if (!isClaimReadinessGateOpen({ expectedGeneration, forceReady })) {
    return { outcome: 'not_ready', stoppedEarly: true };
  }
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: stateRow.correlationKey,
    workerId: state.workerId,
    now: at,
    visibilityTimeoutMs: getVisibilityTimeoutMs()
  });

  if (!claimed) {
    state.skippedTotal += 1;
    state.lastTickSkipped += 1;
    logEvent('booking_confirmation_worker_skipped', {
      outcome: 'claim_lost',
      correlationKey: stateRow.correlationKey
    });
    return { outcome: 'claim_lost' };
  }

  logEvent('booking_confirmation_worker_claimed', {
    correlationKey: claimed.correlationKey,
    bookingId: String(booking._id),
    attemptCount: claimed.attemptCount
  });

  let session = null;
  if (booking.checkoutId) {
    session = await CheckoutSession.findOne({ checkoutId: booking.checkoutId }).lean();
  } else if (booking.checkoutSessionId) {
    session = await CheckoutSession.findById(booking.checkoutSessionId).lean();
  }

  const sendResult = await sendClaimedConfirmationDelivery({
    state: claimed,
    booking,
    entity: null,
    checkoutSessionId: session?._id || booking.checkoutSessionId || null,
    now: at,
    sendFn: sendFn || state.sendFn
  });

  if (sendResult.ok && sendResult.sent) {
    state.succeededTotal += 1;
    state.lastTickSucceeded += 1;
    logEvent('booking_confirmation_worker_succeeded', {
      correlationKey: claimed.correlationKey,
      bookingId: String(booking._id),
      providerMessageIdPresent: Boolean(sendResult.state?.providerMessageId)
    });
    return { outcome: 'succeeded', sendResult };
  }

  if (sendResult.ambiguous) {
    state.ambiguousTotal += 1;
    state.lastTickAmbiguous += 1;
    logEvent('booking_confirmation_worker_ambiguous', {
      correlationKey: claimed.correlationKey,
      bookingId: String(booking._id),
      errorCode: sendResult.errorCode || null
    });
    return { outcome: 'ambiguous', sendResult };
  }

  if (sendResult.retryable) {
    state.retryableFailureTotal += 1;
    state.lastTickRetryable += 1;
    logEvent('booking_confirmation_worker_retry_scheduled', {
      correlationKey: claimed.correlationKey,
      bookingId: String(booking._id),
      errorCode: sendResult.errorCode || null
    });
    return { outcome: 'retry_scheduled', sendResult };
  }

  state.skippedTotal += 1;
  state.lastTickSkipped += 1;
  logEvent('booking_confirmation_worker_skipped', {
    outcome: sendResult.reason || 'send_not_ok',
    correlationKey: claimed.correlationKey
  });
  return { outcome: 'skipped', sendResult };
}

async function runConfirmationDeliverySweepOnce({ now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  try {
    const reclaim = await reclaimStaleSendingConfirmationDeliveries({
      now: at,
      limit: Math.max(state.batchSize, 50)
    });
    state.lastSweepAt = new Date();
    state.lastSweepError = null;
    if (reclaim.markedAmbiguous > 0) {
      state.ambiguousTotal += reclaim.markedAmbiguous;
      logEvent('booking_confirmation_worker_ambiguous', {
        markedAmbiguous: reclaim.markedAmbiguous,
        reclaimedPending: reclaim.reclaimedPending
      });
    }
    return reclaim;
  } catch (err) {
    state.lastSweepError = err?.message || String(err);
    setLastError(err);
    logEvent('booking_confirmation_worker_error', {
      phase: 'sweep',
      error: state.lastSweepError
    });
    throw err;
  }
}

async function runConfirmationDeliveryTickOnce({
  now = new Date(),
  sendFn = null,
  forceReady = false
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  state.lastTickProcessed = 0;
  state.lastTickSucceeded = 0;
  state.lastTickRetryable = 0;
  state.lastTickAmbiguous = 0;
  state.lastTickSkipped = 0;
  state.lastTickAbandoned = 0;
  state.lastTickAt = new Date();

  try {
    // Reclaim is allowed while degraded (SM lease safety).
    await runConfirmationDeliverySweepOnce({ now: at });

    const ready = forceReady === true || isBookingConfirmationDeliveryReady();
    if (!ready) {
      logEvent('booking_confirmation_worker_tick', {
        dueCount: 0,
        skippedReason: 'not_ready',
        readinessState: state.readinessState
      });
      return { dueCount: 0, results: [], skippedReason: 'not_ready' };
    }

    const expectedGeneration = state.readinessGeneration;

    const due = await findDueConfirmationDeliveries({
      now: at,
      limit: state.batchSize,
      templateKeys: CONFIRMATION_TEMPLATE_KEYS
    });

    const results = [];
    let stoppedEarly = false;
    for (const row of due) {
      if (
        !forceReady &&
        (!isBookingConfirmationDeliveryReady() ||
          state.readinessGeneration !== expectedGeneration)
      ) {
        stoppedEarly = true;
        logEvent('booking_confirmation_worker_tick', {
          phase: 'batch_stopped',
          reason: 'readiness_changed',
          readinessState: state.readinessState,
          readinessGeneration: state.readinessGeneration,
          expectedGeneration
        });
        break;
      }
      state.processedTotal += 1;
      state.lastTickProcessed += 1;
      const fresh = await EmailDeliveryState.findById(row._id);
      if (!fresh) continue;
      const result = await processDueRow(fresh, {
        now: at,
        sendFn,
        expectedGeneration,
        forceReady
      });
      results.push({ correlationKey: fresh.correlationKey, ...result });
      if (result?.outcome === 'not_ready' || result?.stoppedEarly === true) {
        stoppedEarly = true;
        logEvent('booking_confirmation_worker_tick', {
          phase: 'batch_stopped',
          reason: 'pre_claim_gate',
          readinessState: state.readinessState,
          readinessGeneration: state.readinessGeneration,
          expectedGeneration
        });
        break;
      }
    }

    state.lastSuccessfulTickAt = new Date();
    state.lastTickError = null;
    logEvent('booking_confirmation_worker_tick', {
      dueCount: due.length,
      processed: state.lastTickProcessed,
      succeeded: state.lastTickSucceeded,
      retryable: state.lastTickRetryable,
      abandoned: state.lastTickAbandoned,
      skipped: state.lastTickSkipped,
      ambiguous: state.lastTickAmbiguous,
      stoppedEarly
    });
    return { dueCount: due.length, results, stoppedEarly };
  } catch (err) {
    setLastError(err);
    logEvent('booking_confirmation_worker_error', {
      phase: 'tick',
      error: err?.message || String(err)
    });
    throw err;
  }
}

function clearTimers() {
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  if (state.sweeperTimer) {
    clearInterval(state.sweeperTimer);
    state.sweeperTimer = null;
  }
  if (state.reverifyTimer) {
    clearTimeout(state.reverifyTimer);
    state.reverifyTimer = null;
  }
}

function startBookingConfirmationDeliveryWorker(options = {}) {
  const cfg = readEnvConfig();
  state.configured = true;
  state.bootstrapCompleted = options.bootstrapCompleted !== false;
  state.mongoConnected = options.mongoConnected === true || state.mongoConnected;
  state.enabled = cfg.enabled;
  state.workerId = options.workerId || cfg.workerId;
  state.tickMs = options.tickMs || cfg.tickMs;
  state.sweeperTickMs = options.sweeperTickMs || cfg.sweeperTickMs;
  state.batchSize = options.batchSize || cfg.batchSize;
  state.releaseId = options.releaseId || state.releaseId;
  state.stopping = false;

  if (typeof options.sendFn === 'function') {
    state.sendFn = options.sendFn;
  }
  if (typeof options.verifyFn === 'function') {
    state.verifyFn = options.verifyFn;
  }

  if (!cfg.enabled && options.force !== true) {
    state.running = false;
    state.readinessState = READINESS.STOPPED;
    return { started: false, reason: 'BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED_disabled' };
  }

  if (options.skipProductionFatalCheck !== true) {
    assertProductionWorkerConfigOrThrow({
      nodeEnv: options.nodeEnv != null ? options.nodeEnv : process.env.NODE_ENV
    });
  }

  clearTimers();
  state.running = true;
  state.enabled = true;
  state.readinessState = READINESS.STARTING;
  state.smtpConfigured = isSmtpConfiguredInEnv();

  if (options.skipSmtpVerifyForTest === true) {
    state.smtpConfigured = true;
    state.smtpVerified = true;
    state.smtpVerifiedAt = new Date();
    state.mongoConnected = true;
    state.bootstrapCompleted = true;
    state.readinessState = READINESS.READY;
  } else {
    state.readinessState = state.smtpConfigured
      ? READINESS.CONFIGURED
      : READINESS.DEGRADED;
  }

  const tick = () => {
    runConfirmationDeliveryTickOnce({ sendFn: state.sendFn }).catch(() => {});
  };
  const sweep = () => {
    runConfirmationDeliverySweepOnce().catch(() => {});
  };

  state.tickTimer = setInterval(tick, state.tickMs);
  state.sweeperTimer = setInterval(sweep, state.sweeperTickMs);
  // Keep timers referenced so the process stays alive without a fake busy loop.
  // (Entrypoint may still attach signal handlers.)

  logEvent('booking_confirmation_worker_started', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: getVisibilityTimeoutMs(),
    hostname: os.hostname(),
    releaseId: state.releaseId || null
  });

  const afterVerify = () => {
    if (options.skipImmediateTick !== true && isBookingConfirmationDeliveryReady()) {
      tick();
    }
  };

  if (options.skipSmtpVerifyForTest === true) {
    afterVerify();
    scheduleReverify(cfg.readyReverifyMs);
  } else {
    // Initial verify before first claim tick (async).
    runSmtpVerificationOnce({ reason: 'startup' })
      .then(afterVerify)
      .catch(() => {});
  }

  return { started: true, workerId: state.workerId };
}

function startBookingConfirmationDeliveryWorkerIfEnabled(options = {}) {
  return startBookingConfirmationDeliveryWorker(options);
}

function stopBookingConfirmationDeliveryWorkerForTest() {
  const wasReady = state.readinessState === READINESS.READY;
  state.stopping = true;
  state.readinessState = READINESS.STOPPING;
  if (wasReady) bumpReadinessGeneration('stopping');
  clearTimers();
  const wasRunning = state.running;
  state.running = false;
  state.readinessState = READINESS.STOPPED;
  state.stopping = false;
  if (wasRunning) {
    logEvent('booking_confirmation_worker_stopped', {});
  }
  return { stopped: true };
}

/** Test helper: force degrade and bump generation (mid-batch safety). */
function __degradeConfirmationDeliveryWorkerForTesting(reason = 'test_degrade') {
  if (state.readinessState === READINESS.READY) {
    bumpReadinessGeneration(reason);
  }
  state.smtpVerified = false;
  state.readinessState = READINESS.DEGRADED;
  state.lastVerifyError = reason;
}

function __setConfirmationDeliverySendFnForTesting(fn) {
  state.sendFn = typeof fn === 'function' ? fn : null;
}

function __setConfirmationDeliveryVerifyFnForTesting(fn) {
  state.verifyFn = typeof fn === 'function' ? fn : null;
}

function __setConfirmationDeliveryWorkerReadyForTesting(ready = true) {
  state.bootstrapCompleted = true;
  state.mongoConnected = true;
  state.enabled = true;
  state.stopping = false;
  state.smtpConfigured = true;
  state.smtpVerified = Boolean(ready);
  state.smtpVerifiedAt = ready ? new Date() : null;
  state.readinessState = ready ? READINESS.READY : READINESS.DEGRADED;
  state.running = true;
  state.configured = true;
  if (!state.workerId) state.workerId = resolveWorkerId();
}

function __resetConfirmationDeliveryWorkerStateForTesting() {
  stopBookingConfirmationDeliveryWorkerForTest();
  state.enabled = false;
  state.configured = false;
  state.bootstrapCompleted = false;
  state.mongoConnected = false;
  state.workerId = null;
  state.readinessState = READINESS.STOPPED;
  state.stopping = false;
  state.smtpConfigured = false;
  state.smtpVerified = false;
  state.smtpVerifiedAt = null;
  state.lastVerifyAt = null;
  state.lastVerifyError = null;
  state.lastDegradedLogAt = null;
  state.lastTickAt = null;
  state.lastSuccessfulTickAt = null;
  state.lastSweepAt = null;
  state.lastErrorAt = null;
  state.lastError = null;
  state.lastTickError = null;
  state.lastSweepError = null;
  state.processedTotal = 0;
  state.succeededTotal = 0;
  state.retryableFailureTotal = 0;
  state.ambiguousTotal = 0;
  state.skippedTotal = 0;
  state.abandonedTotal = 0;
  state.sendFn = null;
  state.verifyFn = null;
  state.releaseId = null;
  state.readinessGeneration = 0;
}

function setMongoConnectedForWorker(connected) {
  state.mongoConnected = Boolean(connected);
}

function getBookingConfirmationDeliveryWorkerState() {
  return {
    configured: state.configured,
    enabled: state.enabled,
    running: state.running,
    readinessState: state.readinessState,
    ready: isBookingConfirmationDeliveryReady(),
    bootstrapCompleted: state.bootstrapCompleted,
    mongoConnected: state.mongoConnected,
    smtpConfigured: state.smtpConfigured,
    smtpVerified: state.smtpVerified,
    smtpVerifiedAt: state.smtpVerifiedAt,
    workerId: state.workerId,
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    lastTickAt: state.lastTickAt,
    lastSuccessfulTickAt: state.lastSuccessfulTickAt,
    lastSweepAt: state.lastSweepAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
    lastVerifyError: state.lastVerifyError,
    processedTotal: state.processedTotal,
    succeededTotal: state.succeededTotal,
    retryableFailureTotal: state.retryableFailureTotal,
    ambiguousTotal: state.ambiguousTotal,
    skippedTotal: state.skippedTotal,
    abandonedTotal: state.abandonedTotal,
    lastTickProcessed: state.lastTickProcessed,
    lastTickSucceeded: state.lastTickSucceeded,
    lastTickRetryable: state.lastTickRetryable,
    lastTickAmbiguous: state.lastTickAmbiguous,
    lastTickSkipped: state.lastTickSkipped,
    lastTickAbandoned: state.lastTickAbandoned,
    releaseId: state.releaseId,
    readinessGeneration: state.readinessGeneration
  };
}

async function countConfirmationDeliveryBacklog({ now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const base = {
    domain: 'booking_lifecycle',
    templateKey: { $in: CONFIRMATION_TEMPLATE_KEYS }
  };

  const [
    pendingDueCount,
    totalPendingCount,
    sendingCount,
    failedCount,
    ambiguousCount,
    oldestDue
  ] = await Promise.all([
    EmailDeliveryState.countDocuments({
      ...base,
      latestStatus: { $in: ['pending', 'failed'] },
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }]
    }),
    EmailDeliveryState.countDocuments({
      ...base,
      latestStatus: 'pending'
    }),
    EmailDeliveryState.countDocuments({
      ...base,
      latestStatus: 'sending'
    }),
    EmailDeliveryState.countDocuments({
      ...base,
      latestStatus: 'failed'
    }),
    EmailDeliveryState.countDocuments({
      ...base,
      latestStatus: 'ambiguous'
    }),
    EmailDeliveryState.findOne({
      ...base,
      latestStatus: { $in: ['pending', 'failed'] },
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: at } }]
    })
      .sort({ nextAttemptAt: 1, latestEventAt: 1 })
      .select({ nextAttemptAt: 1, latestEventAt: 1 })
      .lean()
  ]);

  return {
    pendingDueCount,
    totalPendingCount,
    sendingCount,
    failedCount,
    ambiguousCount,
    oldestDueAt: oldestDue?.nextAttemptAt || oldestDue?.latestEventAt || null
  };
}

module.exports = {
  CONFIRMATION_TEMPLATE_KEYS,
  READINESS,
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  DEFAULT_BATCH_SIZE,
  startBookingConfirmationDeliveryWorker,
  startBookingConfirmationDeliveryWorkerIfEnabled,
  stopBookingConfirmationDeliveryWorkerForTest,
  runConfirmationDeliveryTickOnce,
  runConfirmationDeliverySweepOnce,
  runSmtpVerificationOnce,
  isBookingConfirmationDeliveryReady,
  assertProductionWorkerConfigOrThrow,
  getBookingConfirmationDeliveryWorkerState,
  countConfirmationDeliveryBacklog,
  setMongoConnectedForWorker,
  __setConfirmationDeliverySendFnForTesting,
  __setConfirmationDeliveryVerifyFnForTesting,
  __setConfirmationDeliveryWorkerReadyForTesting,
  __degradeConfirmationDeliveryWorkerForTesting,
  __resetConfirmationDeliveryWorkerStateForTesting
};
