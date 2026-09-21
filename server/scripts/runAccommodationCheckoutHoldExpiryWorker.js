#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * B8F5B — Accommodation checkout-hold expiry worker (standalone).
 *
 * Process name: driftdwells-accommodation-hold-expiry-worker
 *
 * Execution flag (exact accepted true value = "1"):
 *   ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE
 *
 * Disabled by default. Independent of CHECKOUT_RESOURCE_LEASE_ENABLED so durable
 * released-header cleanup remains recoverable after public acquisition is off.
 *
 * Importing this module does not connect to MongoDB, start timers, or call expiry.
 * Startup occurs only via `require.main === module` or explicit exported start APIs.
 *
 * PM2 (ecosystem.config.cjs): leave ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE unset/0.
 */
'use strict';

const EXECUTE_ENV_FLAG = 'ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE';
/** Exact accepted true value — anything else (including "true") is disabled. */
const EXECUTE_ACCEPTED_TRUE = '1';

const REQUIRED_INDEX_NAME = 'accommodationCheckoutLease_released_cleanup_v2';
const REQUIRED_INDEX_KEY_ORDER = Object.freeze([
  ['status', 1],
  ['isLive', 1],
  ['checkoutClaimCleanupStatus', 1],
  ['checkoutClaimCleanupNextAttemptAt', 1],
  ['leaseId', 1]
]);

/**
 * Scheduling constants (server-controlled; not env-tunable in this batch).
 * - DRAIN_YIELD_MS: bounded yield between eligible drain passes
 * - IDLE_POLL_MS: wake to discover newly expired / due headers
 * - ERROR_RETRY_MS: backoff after top-level batch failure
 * - MIN_DELAY_MS: floor so past/invalid nextRetryAt cannot busy-loop
 * - MAX_DELAY_MS: cap aligned with cleanup max backoff (1h)
 */
const DRAIN_YIELD_MS = 250;
const IDLE_POLL_MS = 30_000;
const ERROR_RETRY_MS = 15_000;
const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 60 * 60 * 1000;

const WORKER_SOURCE = 'accommodation-checkout-hold-expiry-worker';

function isExecuteEnabled(env = process.env) {
  return String(env[EXECUTE_ENV_FLAG] || '').trim() === EXECUTE_ACCEPTED_TRUE;
}

function logEvent(event, fields = {}, level = 'info') {
  const payload = JSON.stringify({
    event,
    source: WORKER_SOURCE,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else console.log(payload);
}

function indexKeyMatchesRequired(indexKey) {
  if (!indexKey || typeof indexKey !== 'object') return false;
  const keys = Object.keys(indexKey);
  if (keys.length !== REQUIRED_INDEX_KEY_ORDER.length) return false;
  for (let i = 0; i < REQUIRED_INDEX_KEY_ORDER.length; i += 1) {
    const [name, direction] = REQUIRED_INDEX_KEY_ORDER[i];
    if (keys[i] !== name) return false;
    if (Number(indexKey[name]) !== direction) return false;
  }
  return true;
}

/**
 * Read-only readiness check. Never createIndex / syncIndexes.
 * @returns {{ ok: true, indexName: string } | { ok: false, reason: string, detail?: object }}
 */
async function assertReleasedCleanupIndexReady(collection) {
  if (!collection || typeof collection.indexes !== 'function') {
    return { ok: false, reason: 'index_collection_unavailable' };
  }
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch (err) {
    return {
      ok: false,
      reason: 'index_list_failed',
      detail: { code: err && err.code != null ? String(err.code) : 'INDEX_LIST_FAILED' }
    };
  }
  const match = (indexes || []).find((idx) => idx && idx.name === REQUIRED_INDEX_NAME);
  if (!match) {
    return { ok: false, reason: 'required_index_missing', detail: { name: REQUIRED_INDEX_NAME } };
  }
  if (!indexKeyMatchesRequired(match.key)) {
    return {
      ok: false,
      reason: 'required_index_key_mismatch',
      detail: { name: REQUIRED_INDEX_NAME, key: match.key }
    };
  }
  return { ok: true, indexName: REQUIRED_INDEX_NAME };
}

/**
 * Compute next wake delay from expireAccommodationCheckoutHolds result metadata.
 *
 * Successful-batch rules (B8F5B Correction 1):
 *   eligibleHasMore → DRAIN_YIELD_MS
 *   valid future nextRetryAt → min(IDLE_POLL_MS, clamp(delta, MIN_DELAY_MS, MAX_DELAY_MS))
 *   missing / invalid / past / equal → IDLE_POLL_MS
 *
 * Distant deferred retries must never suppress the idle discovery poll.
 * Never returns 0, negative, or NaN.
 */
function computeNextDelayMs(result, now = new Date()) {
  const hasMore =
    result &&
    (result.releasedCleanupEligibleHasMore === true || result.releasedCleanupHasMore === true);
  if (hasMore) {
    return DRAIN_YIELD_MS;
  }

  const nextRaw = result && result.releasedCleanupNextRetryAt;
  if (nextRaw != null) {
    const t =
      nextRaw instanceof Date ? nextRaw.getTime() : new Date(nextRaw).getTime();
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (Number.isFinite(t) && Number.isFinite(nowMs)) {
      const delta = t - nowMs;
      if (delta > 0) {
        const clamped = Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, delta));
        return Math.min(IDLE_POLL_MS, clamped);
      }
    }
  }
  return IDLE_POLL_MS;
}

/** Process exit codes (PM2 stop_exit_codes includes 0 and 78). */
const EXIT_DISABLED = 0;
const EXIT_READINESS_STOP = 78;
const EXIT_UNEXPECTED = 1;

function safeErrorCode(err) {
  if (!err) return 'ACCOMMODATION_HOLD_EXPIRY_WORKER_FAILED';
  if (err.code != null && String(err.code).trim()) {
    return String(err.code).trim().slice(0, 120);
  }
  return 'ACCOMMODATION_HOLD_EXPIRY_WORKER_FAILED';
}

/**
 * Create a non-overlapping recursive setTimeout worker.
 *
 * @param {object} options
 * @param {() => Date} [options.getNow] — production entrypoint always uses () => new Date()
 * @param {Function} options.expireFn — expireAccommodationCheckoutHolds
 * @param {Function} [options.setTimeoutFn]
 * @param {Function} [options.clearTimeoutFn]
 * @param {Function} [options.log] — (event, fields, level?) => void
 */
function createAccommodationCheckoutHoldExpiryWorker(options = {}) {
  const getNow =
    typeof options.getNow === 'function' ? options.getNow : () => new Date();
  const expireFn = options.expireFn;
  if (typeof expireFn !== 'function') {
    throw new Error('expireFn is required');
  }
  const setTimeoutFn =
    typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout;
  const clearTimeoutFn =
    typeof options.clearTimeoutFn === 'function' ? options.clearTimeoutFn : clearTimeout;
  const log = typeof options.log === 'function' ? options.log : logEvent;

  const state = {
    started: false,
    stopping: false,
    inFlight: false,
    timer: null,
    lastDelayMs: null,
    lastResult: null,
    tickCount: 0,
    errorCount: 0
  };

  function clearTimer() {
    if (state.timer != null) {
      clearTimeoutFn(state.timer);
      state.timer = null;
    }
  }

  function schedule(delayMs) {
    if (state.stopping || !state.started) return;
    let delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay < 0) delay = IDLE_POLL_MS;
    // Drain yield may be below MIN_DELAY_MS; all other paths are floored.
    if (delay !== DRAIN_YIELD_MS && delay < MIN_DELAY_MS) {
      delay = MIN_DELAY_MS;
    }
    if (delay > MAX_DELAY_MS) delay = MAX_DELAY_MS;
    state.lastDelayMs = delay;
    clearTimer();
    state.timer = setTimeoutFn(() => {
      state.timer = null;
      runTick().catch((err) => {
        log(
          'accommodation_hold_expiry_tick_unhandled',
          { errorCode: safeErrorCode(err) },
          'error'
        );
        if (!state.stopping && state.started) {
          schedule(ERROR_RETRY_MS);
        }
      });
    }, delay);
  }

  async function runTick() {
    if (state.stopping || !state.started) return;
    if (state.inFlight) {
      // Non-overlap: never start a second invocation in this process.
      return;
    }
    state.inFlight = true;
    state.tickCount += 1;
    const startedAt = getNow();
    let delay = IDLE_POLL_MS;
    try {
      // Trusted server clock only — fresh plain deps object (no spread of caller bags).
      const now = getNow();
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw Object.assign(new Error('Worker clock must return a valid Date'), {
          code: 'ACCOMMODATION_HOLD_EXPIRY_INVALID_CLOCK'
        });
      }
      const result = await expireFn({ now });
      state.lastResult = result;
      const finishedAt = getNow();
      const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      log('accommodation_hold_expiry_batch', {
        selected: result && result.releasedCleanupSelected,
        attempted: result && result.releasedCleanupAttempted,
        completed: result && result.releasedCleanupCompleted,
        failed: result && result.releasedCleanupFailed,
        deferred: result && result.releasedCleanupDeferred,
        annotationFailed: result && result.releasedCleanupAnnotationFailed,
        eligibleHasMore:
          result &&
          (result.releasedCleanupEligibleHasMore === true ||
            result.releasedCleanupHasMore === true),
        pendingTotal: result && result.releasedCleanupPendingTotal,
        nextRetryAt:
          result && result.releasedCleanupNextRetryAt
            ? new Date(result.releasedCleanupNextRetryAt).toISOString()
            : null,
        expiredCount: result && result.expiredCount,
        durationMs
      });
      delay = computeNextDelayMs(result, now);
    } catch (err) {
      state.errorCount += 1;
      delay = ERROR_RETRY_MS;
      log(
        'accommodation_hold_expiry_batch_error',
        {
          errorCode: safeErrorCode(err),
          durationMs: Math.max(0, getNow().getTime() - startedAt.getTime())
        },
        'error'
      );
    } finally {
      state.inFlight = false;
      if (!state.stopping && state.started) {
        schedule(delay);
      }
    }
  }

  function start() {
    if (state.started) return { started: true, already: true };
    state.started = true;
    state.stopping = false;
    log('accommodation_hold_expiry_worker_started', {
      drainYieldMs: DRAIN_YIELD_MS,
      idlePollMs: IDLE_POLL_MS,
      errorRetryMs: ERROR_RETRY_MS,
      minDelayMs: MIN_DELAY_MS,
      maxDelayMs: MAX_DELAY_MS
    });
    // Immediate first tick via schedule(0) is forbidden (busy-loop guard) —
    // use drain yield as the initial kick so timers are still used.
    schedule(DRAIN_YIELD_MS);
    return { started: true, already: false };
  }

  async function stop({ waitForInFlight = true, waitMs = 10_000 } = {}) {
    state.stopping = true;
    clearTimer();
    if (waitForInFlight && state.inFlight) {
      const deadline = Date.now() + waitMs;
      while (state.inFlight && Date.now() < deadline) {
        await new Promise((r) => setTimeoutFn(r, 25));
      }
    }
    state.started = false;
    log('accommodation_hold_expiry_worker_stopped', {
      tickCount: state.tickCount,
      errorCount: state.errorCount,
      inFlight: state.inFlight
    });
    return { stopped: true, inFlight: state.inFlight };
  }

  function getState() {
    return {
      started: state.started,
      stopping: state.stopping,
      inFlight: state.inFlight,
      lastDelayMs: state.lastDelayMs,
      tickCount: state.tickCount,
      errorCount: state.errorCount,
      hasTimer: state.timer != null
    };
  }

  return {
    start,
    stop,
    getState,
    /** Test-only: run one tick without scheduling (still non-overlapping). */
    runTickOnceForTest: runTick,
    scheduleForTest: schedule
  };
}

/**
 * Production standalone entry. Checks execute flag before any Mongo work.
 */
async function runStandaloneEntrypoint(runtime = {}) {
  const env = runtime.env || process.env;
  const exitFn = typeof runtime.exit === 'function' ? runtime.exit : (code) => process.exit(code);
  const connectMongo =
    typeof runtime.connectMongo === 'function' ? runtime.connectMongo : null;
  const disconnectMongo =
    typeof runtime.disconnectMongo === 'function' ? runtime.disconnectMongo : null;
  const getLeaseCollection =
    typeof runtime.getLeaseCollection === 'function' ? runtime.getLeaseCollection : null;
  const expireFn = runtime.expireFn || null;
  const getNow =
    typeof runtime.getNow === 'function' ? runtime.getNow : () => new Date();

  if (!isExecuteEnabled(env)) {
    logEvent('accommodation_hold_expiry_worker_disabled', {
      reason: 'ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE_not_enabled',
      flag: EXECUTE_ENV_FLAG
    });
    exitFn(EXIT_DISABLED);
    return { started: false, reason: 'disabled', exitCode: EXIT_DISABLED };
  }

  // Lazy requires only after execute enabled — still no connect until connectMongo().
  const mongoose = runtime.mongoose || require('mongoose');
  const { DEFAULT_MONGO_URI } = runtime.dbDefaults || require('../config/dbDefaults');
  const AccommodationCheckoutLease =
    runtime.AccommodationCheckoutLease ||
    require('../models/AccommodationCheckoutLease');
  const {
    expireAccommodationCheckoutHolds
  } =
    runtime.holdService ||
    require('../services/checkout/accommodationCheckoutHoldService');

  const mongoUri =
    (env.MONGODB_URI && String(env.MONGODB_URI).trim()) ||
    (env.MONGO_URI && String(env.MONGO_URI).trim()) ||
    DEFAULT_MONGO_URI;

  let shuttingDown = false;
  let worker = null;
  let exitCode = EXIT_UNEXPECTED;

  async function disconnectOnce() {
    try {
      if (disconnectMongo) await disconnectMongo();
      else await mongoose.disconnect();
      logEvent('accommodation_hold_expiry_worker_mongo_disconnected', {});
    } catch (err) {
      logEvent(
        'accommodation_hold_expiry_worker_disconnect_error',
        { errorCode: safeErrorCode(err) },
        'error'
      );
    }
  }

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('accommodation_hold_expiry_worker_signal', { signal });
    try {
      if (worker) await worker.stop({ waitForInFlight: true });
    } catch (err) {
      logEvent(
        'accommodation_hold_expiry_worker_stop_error',
        { errorCode: safeErrorCode(err) },
        'error'
      );
    }
    await disconnectOnce();
    exitFn(EXIT_DISABLED);
  }

  try {
    if (connectMongo) {
      await connectMongo(mongoUri);
    } else {
      await mongoose.connect(mongoUri);
    }
  } catch (err) {
    logEvent(
      'accommodation_hold_expiry_worker_mongo_connect_failed',
      { errorCode: safeErrorCode(err) },
      'error'
    );
    exitFn(EXIT_UNEXPECTED);
    return { started: false, reason: 'mongo_connect_failed', exitCode: EXIT_UNEXPECTED };
  }
  logEvent('accommodation_hold_expiry_worker_mongo_connected', {});

  const collection =
    (getLeaseCollection && getLeaseCollection()) ||
    AccommodationCheckoutLease.collection;
  const indexReady = await assertReleasedCleanupIndexReady(collection);
  if (!indexReady.ok) {
    logEvent(
      'accommodation_hold_expiry_worker_index_not_ready',
      {
        reason: indexReady.reason,
        requiredIndex: REQUIRED_INDEX_NAME,
        detail: indexReady.detail || null
      },
      'error'
    );
    await disconnectOnce();
    exitFn(EXIT_READINESS_STOP);
    return {
      started: false,
      reason: indexReady.reason,
      exitCode: EXIT_READINESS_STOP
    };
  }

  worker = createAccommodationCheckoutHoldExpiryWorker({
    getNow,
    expireFn: expireFn || expireAccommodationCheckoutHolds,
    log: logEvent,
    setTimeoutFn:
      typeof runtime.setTimeoutFn === 'function' ? runtime.setTimeoutFn : setTimeout,
    clearTimeoutFn:
      typeof runtime.clearTimeoutFn === 'function' ? runtime.clearTimeoutFn : clearTimeout
  });
  worker.start();
  exitCode = EXIT_DISABLED; // graceful signal shutdown uses 0

  if (runtime.skipSignalHandlers !== true) {
    process.on('SIGTERM', () => {
      shutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
      shutdown('SIGINT');
    });
  }

  logEvent('accommodation_hold_expiry_worker_ready', {
    indexName: REQUIRED_INDEX_NAME,
    checkoutResourceLeaseEnabled: env.CHECKOUT_RESOURCE_LEASE_ENABLED != null
      ? String(env.CHECKOUT_RESOURCE_LEASE_ENABLED)
      : null
  });

  return { started: true, worker, shutdown, exitCode };
}

module.exports = {
  EXECUTE_ENV_FLAG,
  EXECUTE_ACCEPTED_TRUE,
  REQUIRED_INDEX_NAME,
  REQUIRED_INDEX_KEY_ORDER,
  DRAIN_YIELD_MS,
  IDLE_POLL_MS,
  ERROR_RETRY_MS,
  MIN_DELAY_MS,
  MAX_DELAY_MS,
  EXIT_DISABLED,
  EXIT_READINESS_STOP,
  EXIT_UNEXPECTED,
  isExecuteEnabled,
  indexKeyMatchesRequired,
  assertReleasedCleanupIndexReady,
  computeNextDelayMs,
  createAccommodationCheckoutHoldExpiryWorker,
  runStandaloneEntrypoint,
  safeErrorCode
};

if (require.main === module) {
  // Env bootstrap after module load (mirrors other standalone workers).
  try {
    require('../config/loadServerEnv').loadServerEnv();
  } catch (_e) {
    try {
      require('dotenv').config();
    } catch (_e2) {
      /* optional */
    }
  }

  // Recursive setTimeout in the worker keeps the enabled process alive.
  // No unconditional keep-alive interval (disabled/readiness paths exit cleanly).
  runStandaloneEntrypoint().catch(async (err) => {
    console.error(
      JSON.stringify({
        event: 'accommodation_hold_expiry_worker_fatal',
        source: WORKER_SOURCE,
        errorCode: safeErrorCode(err),
        message: err && err.message ? String(err.message).slice(0, 200) : 'fatal'
      })
    );
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch (_e) {
      /* ignore */
    }
    process.exit(EXIT_UNEXPECTED);
  });
}
