'use strict';

/**
 * Booking-confirmation EmailDeliveryState backlog worker.
 *
 * Checkout finalization may enqueue pending rows with send=false. This worker
 * drains overdue pending/failed confirmation states using the existing
 * bookingConfirmationDeliveryService state machine.
 *
 * Flag: BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED (default off).
 * Never creates PaymentIntents, refunds, or deletes bookings.
 */

const os = require('os');
const featureFlags = require('../../utils/featureFlags');
const Booking = require('../../models/Booking');
const CheckoutSession = require('../../models/CheckoutSession');
const EmailDeliveryState = require('../../models/EmailDeliveryState');
// Register models used by lifecycle email template entity loading.
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
  markConfirmationDeliverySucceeded,
  markConfirmationDeliveryAbandoned,
  isDefinitiveSentStatus,
  getVisibilityTimeoutMs,
  buildWorkerId
} = require('./bookingConfirmationDeliveryService');

const DEFAULT_TICK_MS = 30 * 1000;
const DEFAULT_SWEEPER_TICK_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 20;

const CONFIRMATION_TEMPLATE_KEYS = [
  bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_CONFIRMED,
  bookingLifecycleEmailService.TEMPLATE_KEYS.BOOKING_RECEIVED
];

const state = {
  tickTimer: null,
  sweeperTimer: null,
  enabled: false,
  running: false,
  configured: false,
  workerId: null,
  tickMs: DEFAULT_TICK_MS,
  sweeperTickMs: DEFAULT_SWEEPER_TICK_MS,
  batchSize: DEFAULT_BATCH_SIZE,
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
  sendFn: null
};

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
    )
  };
}

function logEvent(event, fields = {}) {
  console.log(
    JSON.stringify({
      event,
      source: 'booking-confirmation-delivery-worker',
      workerId: state.workerId,
      ...fields
    })
  );
}

function setLastError(err) {
  state.lastErrorAt = new Date();
  state.lastError = err?.message || String(err);
  state.lastTickError = state.lastError;
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

async function processDueRow(stateRow, { now, sendFn } = {}) {
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
    const adopted = await markConfirmationDeliverySucceeded({
      correlationKey: stateRow.correlationKey,
      bookingId: booking._id,
      checkoutSessionId: booking.checkoutSessionId || null,
      providerMessageId: stateRow.providerMessageId || null,
      emailEventId: stateRow.latestEmailEventId || null,
      now: at
    });
    state.succeededTotal += 1;
    state.lastTickSucceeded += 1;
    logEvent('booking_confirmation_worker_succeeded', {
      outcome: 'adopted_sent',
      correlationKey: stateRow.correlationKey,
      bookingId: String(booking._id)
    });
    return { outcome: 'adopted_sent', state: adopted };
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

async function runConfirmationDeliveryTickOnce({ now = new Date(), sendFn = null } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  state.lastTickProcessed = 0;
  state.lastTickSucceeded = 0;
  state.lastTickRetryable = 0;
  state.lastTickAmbiguous = 0;
  state.lastTickSkipped = 0;
  state.lastTickAbandoned = 0;
  state.lastTickAt = new Date();

  try {
    await runConfirmationDeliverySweepOnce({ now: at });

    const due = await findDueConfirmationDeliveries({
      now: at,
      limit: state.batchSize,
      templateKeys: CONFIRMATION_TEMPLATE_KEYS
    });

    const results = [];
    for (const row of due) {
      state.processedTotal += 1;
      state.lastTickProcessed += 1;
      // Re-load lean→document for claim path; findDue returns mongoose docs.
      const fresh = await EmailDeliveryState.findById(row._id);
      if (!fresh) continue;
      const result = await processDueRow(fresh, { now: at, sendFn });
      results.push({ correlationKey: fresh.correlationKey, ...result });
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
      ambiguous: state.lastTickAmbiguous
    });
    return { dueCount: due.length, results };
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
}

function startBookingConfirmationDeliveryWorker(options = {}) {
  const cfg = readEnvConfig();
  state.configured = true;
  state.enabled = cfg.enabled;
  state.workerId = options.workerId || cfg.workerId;
  state.tickMs = options.tickMs || cfg.tickMs;
  state.sweeperTickMs = options.sweeperTickMs || cfg.sweeperTickMs;
  state.batchSize = options.batchSize || cfg.batchSize;
  if (typeof options.sendFn === 'function') {
    state.sendFn = options.sendFn;
  }

  if (!cfg.enabled && options.force !== true) {
    state.running = false;
    return { started: false, reason: 'BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED_disabled' };
  }

  clearTimers();
  state.running = true;
  state.enabled = true;

  const tick = () => {
    runConfirmationDeliveryTickOnce({ sendFn: state.sendFn }).catch(() => {});
  };
  const sweep = () => {
    runConfirmationDeliverySweepOnce().catch(() => {});
  };

  state.tickTimer = setInterval(tick, state.tickMs);
  state.sweeperTimer = setInterval(sweep, state.sweeperTickMs);
  if (state.tickTimer.unref) state.tickTimer.unref();
  if (state.sweeperTimer.unref) state.sweeperTimer.unref();

  logEvent('booking_confirmation_worker_started', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: getVisibilityTimeoutMs(),
    hostname: os.hostname()
  });

  // Immediate drain on start (covers overdue backlog after deploy).
  if (options.skipImmediateTick !== true) {
    tick();
  }

  return { started: true, workerId: state.workerId };
}

function startBookingConfirmationDeliveryWorkerIfEnabled(options = {}) {
  return startBookingConfirmationDeliveryWorker(options);
}

function stopBookingConfirmationDeliveryWorkerForTest() {
  clearTimers();
  const wasRunning = state.running;
  state.running = false;
  if (wasRunning) {
    logEvent('booking_confirmation_worker_stopped', {});
  }
  return { stopped: true };
}

function __setConfirmationDeliverySendFnForTesting(fn) {
  state.sendFn = typeof fn === 'function' ? fn : null;
}

function __resetConfirmationDeliveryWorkerStateForTesting() {
  stopBookingConfirmationDeliveryWorkerForTest();
  state.enabled = false;
  state.configured = false;
  state.workerId = null;
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
}

function getBookingConfirmationDeliveryWorkerState() {
  return {
    configured: state.configured,
    enabled: state.enabled,
    running: state.running,
    workerId: state.workerId,
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    lastTickAt: state.lastTickAt,
    lastSuccessfulTickAt: state.lastSuccessfulTickAt,
    lastSweepAt: state.lastSweepAt,
    lastErrorAt: state.lastErrorAt,
    lastError: state.lastError,
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
    lastTickAbandoned: state.lastTickAbandoned
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
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  DEFAULT_BATCH_SIZE,
  startBookingConfirmationDeliveryWorker,
  startBookingConfirmationDeliveryWorkerIfEnabled,
  stopBookingConfirmationDeliveryWorkerForTest,
  runConfirmationDeliveryTickOnce,
  runConfirmationDeliverySweepOnce,
  getBookingConfirmationDeliveryWorkerState,
  countConfirmationDeliveryBacklog,
  __setConfirmationDeliverySendFnForTesting,
  __resetConfirmationDeliveryWorkerStateForTesting
};
