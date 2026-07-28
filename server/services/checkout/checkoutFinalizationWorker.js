'use strict';

/**
 * CheckoutFinalizationJob worker (Batch 5–6).
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md
 *
 * - Claims due jobs atomically; reclaims stale claimed jobs.
 * - Executes exclusively via finalizePaidCheckout (no Booking insert here).
 * - Confirmation send only when FINALIZE_WORKER_SEND_CONFIRMATION=1 (default off),
 *   via centralized checkoutFinalizeSideEffects (never duplicates Booking/payment).
 * - No gift-voucher execution; no refund; no new PaymentIntent.
 *
 * Feature flag: FINALIZE_JOB_EXECUTE=1 (default off).
 * Standalone PM2 entry: server/scripts/runCheckoutFinalizationWorker.js
 */

const os = require('os');
const Stripe = require('stripe');
const featureFlags = require('../../utils/featureFlags');
const CheckoutSession = require('../../models/CheckoutSession');
const {
  findDueCheckoutFinalizationJobIds,
  claimDueCheckoutFinalizationJob,
  reclaimStaleClaimedCheckoutFinalizationJobs,
  updateCheckoutFinalizationJobStage,
  markCheckoutFinalizationJobSucceeded,
  markCheckoutFinalizationJobFailedRetryable,
  markCheckoutFinalizationJobFailedPermanent,
  markCheckoutFinalizationJobCancelled,
  classifyFinalizeJobError,
  getFinalizeJobVisibilityTimeoutMs
} = require('./checkoutFinalizationJobService');
const { finalizePaidCheckout } = require('./finalizePaidCheckout');
const {
  runCheckoutFinalizeSideEffects
} = require('./checkoutFinalizeSideEffects');
const {
  recordPaidBookingResolutionIssueSafe,
  PAID_BOOKING_FINALIZATION_STAGES
} = require('../payments/paidBookingFinalizationObservability');
const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
const { createDefaultDependencies } = require('./executeBookingFinalizeWork');
const Booking = require('../../models/Booking');

const ENV_TICK_MS = 'FINALIZE_JOB_WORKER_TICK_MS';
const ENV_SWEEPER_TICK_MS = 'FINALIZE_JOB_WORKER_SWEEPER_TICK_MS';
const ENV_BATCH_SIZE = 'FINALIZE_JOB_WORKER_BATCH_SIZE';
const ENV_WORKER_ID = 'FINALIZE_JOB_WORKER_ID';

const DEFAULT_TICK_MS = 15_000;
const DEFAULT_SWEEPER_TICK_MS = 60_000;
const DEFAULT_BATCH_SIZE = 20;

const state = {
  tickTimer: null,
  sweeperTimer: null,
  enabled: false,
  workerId: null,
  startedAt: null,
  tickMs: DEFAULT_TICK_MS,
  sweeperTickMs: DEFAULT_SWEEPER_TICK_MS,
  batchSize: DEFAULT_BATCH_SIZE,
  visibilityTimeoutMs: getFinalizeJobVisibilityTimeoutMs(),
  lastTickAt: null,
  lastSweepAt: null,
  lastTickClaimedCount: 0,
  lastTickLostCount: 0,
  lastTickSucceededCount: 0,
  lastTickFailedRetryableCount: 0,
  lastTickFailedPermanentCount: 0,
  lastTickCancelledCount: 0,
  lastSweepRescheduledCount: 0,
  lastTickError: null,
  lastSweepError: null,
  lastEmailSendAttempted: false,
  lastRefundAttempted: false,
  lastPaymentIntentCreateAttempted: false
};

let awaitExecuteForTests = false;
let finalizePaidCheckoutImpl = finalizePaidCheckout;
let stripeClientOverride = null;

function setAwaitExecuteForTests(value) {
  awaitExecuteForTests = Boolean(value);
}

function __setFinalizePaidCheckoutForTesting(fn) {
  finalizePaidCheckoutImpl = typeof fn === 'function' ? fn : finalizePaidCheckout;
}

function __resetFinalizePaidCheckoutForTesting() {
  finalizePaidCheckoutImpl = finalizePaidCheckout;
}

function __setStripeClientForTesting(client) {
  stripeClientOverride = client;
}

function __resetStripeClientForTesting() {
  stripeClientOverride = null;
}

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function buildWorkerId() {
  const explicit = (process.env[ENV_WORKER_ID] || '').trim();
  if (explicit) return explicit;
  return `${os.hostname()}#${process.pid}#checkout-finalize#${Date.now().toString(36)}`;
}

function isExecuteEnabled() {
  return featureFlags.isFinalizeJobExecuteEnabled();
}

function readEnvConfig() {
  return {
    enabled: isExecuteEnabled(),
    workerId: buildWorkerId(),
    tickMs: parsePositiveIntEnv(ENV_TICK_MS, DEFAULT_TICK_MS),
    sweeperTickMs: parsePositiveIntEnv(ENV_SWEEPER_TICK_MS, DEFAULT_SWEEPER_TICK_MS),
    batchSize: parsePositiveIntEnv(ENV_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    visibilityTimeoutMs: getFinalizeJobVisibilityTimeoutMs()
  };
}

function ensureWorkerId() {
  if (!state.workerId) state.workerId = buildWorkerId();
  return state.workerId;
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'checkout-finalization-worker',
    phase,
    workerId: state.workerId,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else console.log(payload);
}

function getStripeClient() {
  if (stripeClientOverride) return stripeClientOverride;
  if (!process.env.STRIPE_SECRET_KEY) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

/**
 * Confirmation SMTP only when FINALIZE_WORKER_SEND_CONFIRMATION is on.
 * Default off: never send.
 */
function maybeRunWorkerConfirmationSideEffects({
  booking,
  session,
  jobId,
  adoptedExisting,
  now
}) {
  const sendConfirmation = featureFlags.isFinalizeWorkerSendConfirmationEnabled();
  if (!sendConfirmation && !featureFlags.isFinalizeSideEffectsEnabled()) {
    state.lastEmailSendAttempted = false;
    return Promise.resolve({ skipped: true, reason: 'side_effects_and_send_off' });
  }

  state.lastEmailSendAttempted = sendConfirmation === true;
  return runCheckoutFinalizeSideEffects({
    booking,
    session,
    source: 'webhook_worker',
    adoptedExisting: adoptedExisting === true,
    jobId,
    sendConfirmation,
    workerId: ensureWorkerId(),
    now
  });
}

async function executeClaimedJob(job, { now = new Date() } = {}) {
  state.lastEmailSendAttempted = false;
  state.lastRefundAttempted = false;
  state.lastPaymentIntentCreateAttempted = false;

  const jobId = job._id;
  const at = now instanceof Date ? now : new Date(now);

  const exclusion = await isGiftVoucherOrNonAccommodationJob(job);
  if (exclusion.excluded) {
    const cancelled = await markCheckoutFinalizationJobCancelled({
      jobId,
      errorCode: exclusion.reason,
      errorSummary: `Excluded from paid checkout finalization worker: ${exclusion.reason}`,
      now: at
    });
    return {
      ok: false,
      cancelled: true,
      job: cancelled,
      errorCode: exclusion.reason
    };
  }

  await updateCheckoutFinalizationJobStage({ jobId, stage: 'verify_payment' });

  try {
    const result = await finalizePaidCheckoutImpl({
      checkoutId: job.checkoutId,
      paymentIntentId: job.paymentIntentId,
      source: 'webhook_worker',
      now: at,
      dependencies: buildWorkerDependencies({ job })
    });

    if (!result?.ok || !result.bookingId) {
      const failed = await markCheckoutFinalizationJobFailedPermanent({
        jobId,
        errorCode: 'FINALIZE_MISSING_BOOKING_ID',
        errorSummary: 'finalizePaidCheckout returned without bookingId',
        stage: 'finalize_session',
        now: at
      });
      return { ok: false, permanent: true, job: failed };
    }

    await updateCheckoutFinalizationJobStage({ jobId, stage: 'finalize_session' });

    const succeeded = await markCheckoutFinalizationJobSucceeded({
      jobId,
      bookingId: result.bookingId,
      now: at,
      sessionFinalizedAt:
        result.session?.finalizedAt instanceof Date
          ? result.session.finalizedAt
          : at,
      paymentLinkedAt: at
    });

    const bookingDoc =
      result.booking ||
      (await Booking.findById(result.bookingId).catch(() => null));

    let sideEffects = null;
    try {
      sideEffects = await maybeRunWorkerConfirmationSideEffects({
        booking: bookingDoc,
        session: result.session,
        jobId,
        adoptedExisting: result.adoptedExisting === true,
        now: at
      });
    } catch (sideErr) {
      // Email / quote / alert failures must never fail the paid finalize job.
      logLine('error', 'side_effects_failed', {
        jobId: String(jobId),
        bookingId: String(result.bookingId),
        error: sideErr?.message || String(sideErr)
      });
      sideEffects = {
        ok: false,
        error: sideErr?.message || String(sideErr),
        refundAttempted: false,
        paymentIntentCreateAttempted: false
      };
    }

    return {
      ok: true,
      job: succeeded,
      bookingId: String(result.bookingId),
      adoptedExisting: result.adoptedExisting === true,
      idempotentReplay: result.idempotentReplay === true,
      sideEffects,
      emailSendAttempted: state.lastEmailSendAttempted,
      refundAttempted: false,
      paymentIntentCreateAttempted: false
    };
  } catch (err) {
    const classified = classifyFinalizeJobError(err);
    logLine('error', 'execute_failed', {
      jobId: String(jobId),
      checkoutId: job.checkoutId,
      paymentIntentId: job.paymentIntentId,
      errorCode: classified.errorCode,
      permanent: classified.permanent,
      stage: classified.stage,
      message: classified.summary
    });

    if (classified.permanent) {
      const failed = await markCheckoutFinalizationJobFailedPermanent({
        jobId,
        errorCode: classified.errorCode,
        errorSummary: classified.summary,
        stage: classified.stage,
        safeDetails: classified.safeDetails,
        now: at,
        bookingId: err?.bookingId || null
      });
      return { ok: false, permanent: true, job: failed, errorCode: classified.errorCode };
    }

    const failed = await markCheckoutFinalizationJobFailedRetryable({
      jobId,
      errorCode: classified.errorCode,
      errorSummary: classified.summary,
      stage: classified.stage,
      safeDetails: classified.safeDetails,
      now: at,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts
    });
    return {
      ok: false,
      permanent: false,
      retryable: true,
      job: failed,
      errorCode: classified.errorCode
    };
  }
}

async function isGiftVoucherOrNonAccommodationJob(job) {
  const session = await CheckoutSession.findOne({ checkoutId: job.checkoutId })
    .select('flowVersion')
    .lean();
  if (session && session.flowVersion !== 'v2') {
    return { excluded: true, reason: 'NOT_V2_ACCOMMODATION_FLOW' };
  }

  // Heuristic: gift-voucher PIs are never enqueued for V2 accommodation, but defend in depth.
  const stripe = getStripeClient();
  if (stripe?.paymentIntents?.retrieve && job.paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(String(job.paymentIntentId));
      if (pi?.metadata?.type === 'gift_voucher') {
        return { excluded: true, reason: 'GIFT_VOUCHER_EXCLUDED' };
      }
    } catch {
      // Retrieve failure is handled by domain finalize; do not exclude here.
    }
  }
  return { excluded: false };
}

function buildWorkerDependencies({ job }) {
  const stripe = getStripeClient();
  return {
    ...createDefaultDependencies(),
    stripe,
    recordPaidBookingResolutionIssue: (params) =>
      recordPaidBookingResolutionIssueSafe({
        ...params,
        paymentIntentId: params.paymentIntentId || job.paymentIntentId,
        checkoutId: params.checkoutId || job.checkoutId,
        finalizationStage: params.finalizationStage || PAID_BOOKING_FINALIZATION_STAGES.UNKNOWN,
        failureSource: 'checkout_finalization_worker',
        stripePaymentVerified: true
      }),
    openManualReviewItem
  };
}

async function tickOnce({ now = new Date() } = {}) {
  const result = {
    candidatesCount: 0,
    claimed: 0,
    lost: 0,
    succeeded: 0,
    failedRetryable: 0,
    failedPermanent: 0,
    cancelled: 0,
    errors: 0,
    emailSendAttempted: false,
    refundAttempted: false,
    paymentIntentCreateAttempted: false
  };

  if (!isExecuteEnabled()) {
    state.lastTickAt = now instanceof Date ? now : new Date(now);
    state.lastTickError = null;
    state.lastTickClaimedCount = 0;
    return result;
  }

  const workerId = ensureWorkerId();
  const at = now instanceof Date ? now : new Date(now);

  try {
    const dueIds = await findDueCheckoutFinalizationJobIds({
      now: at,
      limit: state.batchSize
    });
    result.candidatesCount = dueIds.length;

    for (const jobId of dueIds) {
      try {
        const claimed = await claimDueCheckoutFinalizationJob({
          jobId,
          workerId,
          now: at,
          visibilityTimeoutMs: state.visibilityTimeoutMs
        });
        if (!claimed) {
          result.lost += 1;
          continue;
        }
        result.claimed += 1;

        const execPromise = executeClaimedJob(claimed, { now: at });
        const settle = async (execResult) => {
          if (execResult?.cancelled) result.cancelled += 1;
          else if (execResult?.ok) result.succeeded += 1;
          else if (execResult?.permanent) result.failedPermanent += 1;
          else if (execResult?.retryable) result.failedRetryable += 1;
        };

        if (awaitExecuteForTests) {
          await settle(await execPromise);
        } else {
          void execPromise
            .then(settle)
            .catch((err) => {
              result.errors += 1;
              logLine('error', 'execute_async_failed', {
                jobId: String(claimed._id),
                error: err?.message || String(err)
              });
            });
        }
      } catch (err) {
        result.errors += 1;
        logLine('error', 'claim_loop_error', {
          jobId: String(jobId),
          error: err?.message || String(err)
        });
      }
    }

    state.lastTickError = null;
  } catch (err) {
    state.lastTickError = err?.message || String(err);
    result.errors += 1;
    logLine('error', 'tick_failed', { error: state.lastTickError });
  }

  result.emailSendAttempted = state.lastEmailSendAttempted;
  result.refundAttempted = state.lastRefundAttempted;
  result.paymentIntentCreateAttempted = state.lastPaymentIntentCreateAttempted;

  state.lastTickAt = at;
  state.lastTickClaimedCount = result.claimed;
  state.lastTickLostCount = result.lost;
  state.lastTickSucceededCount = result.succeeded;
  state.lastTickFailedRetryableCount = result.failedRetryable;
  state.lastTickFailedPermanentCount = result.failedPermanent;
  state.lastTickCancelledCount = result.cancelled;

  return result;
}

async function sweepStaleClaimedOnce({ now = new Date() } = {}) {
  const result = { reclaimed: 0, errors: 0 };
  if (!isExecuteEnabled()) {
    state.lastSweepAt = now instanceof Date ? now : new Date(now);
    state.lastSweepRescheduledCount = 0;
    state.lastSweepError = null;
    return result;
  }

  const at = now instanceof Date ? now : new Date(now);
  try {
    const rows = await reclaimStaleClaimedCheckoutFinalizationJobs({
      now: at,
      limit: state.batchSize
    });
    result.reclaimed = rows.length;
    state.lastSweepError = null;
  } catch (err) {
    result.errors += 1;
    state.lastSweepError = err?.message || String(err);
    logLine('error', 'sweep_failed', { error: state.lastSweepError });
  }

  state.lastSweepAt = at;
  state.lastSweepRescheduledCount = result.reclaimed;
  return result;
}

function startCheckoutFinalizationWorkerIfEnabled() {
  const cfg = readEnvConfig();
  if (!cfg.enabled) {
    return { started: false, reason: 'FINALIZE_JOB_EXECUTE_disabled' };
  }
  if (state.tickTimer) {
    return { started: true, alreadyRunning: true, workerId: state.workerId };
  }

  state.enabled = true;
  state.workerId = cfg.workerId;
  state.tickMs = cfg.tickMs;
  state.sweeperTickMs = cfg.sweeperTickMs;
  state.batchSize = cfg.batchSize;
  state.visibilityTimeoutMs = cfg.visibilityTimeoutMs;
  state.startedAt = new Date();

  state.tickTimer = setInterval(() => {
    void tickOnce().catch((err) => {
      logLine('error', 'tick_timer_error', { error: err?.message || String(err) });
    });
  }, state.tickMs);
  if (typeof state.tickTimer.unref === 'function') state.tickTimer.unref();

  state.sweeperTimer = setInterval(() => {
    void sweepStaleClaimedOnce().catch((err) => {
      logLine('error', 'sweep_timer_error', { error: err?.message || String(err) });
    });
  }, state.sweeperTickMs);
  if (typeof state.sweeperTimer.unref === 'function') state.sweeperTimer.unref();

  logLine('info', 'worker_started', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs
  });

  return { started: true, workerId: state.workerId };
}

function stopCheckoutFinalizationWorkerForTest() {
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  if (state.sweeperTimer) {
    clearInterval(state.sweeperTimer);
    state.sweeperTimer = null;
  }
  state.enabled = false;
}

function getCheckoutFinalizationWorkerState() {
  return { ...state };
}

module.exports = {
  ENV_TICK_MS,
  ENV_SWEEPER_TICK_MS,
  ENV_BATCH_SIZE,
  ENV_WORKER_ID,
  tickOnce,
  sweepStaleClaimedOnce,
  executeClaimedJob,
  startCheckoutFinalizationWorkerIfEnabled,
  stopCheckoutFinalizationWorkerForTest,
  getCheckoutFinalizationWorkerState,
  setAwaitExecuteForTests,
  __setFinalizePaidCheckoutForTesting,
  __resetFinalizePaidCheckoutForTesting,
  __setStripeClientForTesting,
  __resetStripeClientForTesting,
  buildWorkerId,
  isExecuteEnabled
};
