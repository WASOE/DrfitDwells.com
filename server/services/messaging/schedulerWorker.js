'use strict';

/**
 * Messaging scheduler worker.
 *
 * Originally shipped in Batch 6 as claim-only. Batch 8 adds an OPTIONAL,
 * fire-and-forget invocation of the MessageDispatcher after a successful
 * claim. The dispatcher invocation is gated behind
 * `MESSAGE_DISPATCHER_ENABLED=1` so the Batch 6 contract (claim-only) is
 * preserved by default.
 *
 * Responsibilities:
 *   - Find `ScheduledMessageJob` rows where `status='scheduled'` and
 *     `scheduledFor <= now`.
 *   - Atomically claim each one via `findOneAndUpdate({_id, status:'scheduled'},
 *     {$set:{status:'claimed', claimedBy, claimedAt, visibilityTimeoutAt}})`.
 *   - If `MESSAGE_DISPATCHER_ENABLED=1`, hand the claimed `_id` to
 *     `messageDispatcher.processClaimedJob` for shadow-mode processing.
 *   - Reclaim stuck `claimed` rows past their `visibilityTimeoutAt` back to
 *     `scheduled` with incremented `attemptCount` and exponential backoff.
 *   - Mark jobs `failed` (terminal) when `attemptCount` would reach
 *     `maxAttempts`.
 *
 * What the worker MUST NOT do:
 *   - It MUST NOT mark any job `sent` directly. Only the dispatcher writes
 *     `sent`, and only when a MessageDispatch row was actually accepted
 *     (Batch 8: shadow accepted = `providerName='internal'`,
 *     `details.shadow=true`).
 *   - It MUST NOT write any `MessageDispatch` row. The dispatcher owns
 *     shadow-vs-real branching.
 *   - It MUST NOT call any provider, render any template, or read any rule.
 *   - It MUST NOT run booking-lifecycle hooks. Those live in the Batch 7
 *     orchestrator.
 *
 * Atomicity / single-leader safety:
 *   - The only concurrency lock is the MongoDB atomic update with the
 *     `status:'scheduled'` precondition. Two ticks (in one process or two
 *     PM2 processes) racing the same row will both attempt the update; at
 *     most one returns the document. The other gets `null` and reports
 *     `lost`. No in-memory lock, no advisory lock, no Redis.
 *   - Visibility-timeout reclaim uses the same atomic primitive with the
 *     `status:'claimed'` precondition.
 *
 * Feature flag (default off):
 *   - `MESSAGE_SCHEDULER_WORKER_ENABLED='1'` → worker starts.
 *   - Anything else (unset, `'0'`, `'true'`, `'TRUE'`, etc.) → worker does
 *     not start, no timer, no Mongo query.
 *
 * See:
 *   - docs/guest-message-automation/02_V1_SPEC.md §18 (worker)
 *   - docs/guest-message-automation/02_V1_SPEC.md §31 (idempotency)
 *   - docs/guest-message-automation/03_IMPLEMENTATION_BATCHES.md Batch 6
 *   - ChatGPT review correction: claim-only; no `sent`, no `MessageDispatch`.
 */

const os = require('os');
const ScheduledMessageJob = require('../../models/ScheduledMessageJob');

const ENV_FLAG = 'MESSAGE_SCHEDULER_WORKER_ENABLED';
const ENV_DISPATCHER_FLAG = 'MESSAGE_DISPATCHER_ENABLED';
const ENV_TICK_MS = 'MESSAGE_SCHEDULER_WORKER_TICK_MS';
const ENV_SWEEPER_TICK_MS = 'MESSAGE_SCHEDULER_WORKER_SWEEPER_TICK_MS';
const ENV_BATCH_SIZE = 'MESSAGE_SCHEDULER_WORKER_BATCH_SIZE';
const ENV_VISIBILITY_TIMEOUT_MS = 'MESSAGE_SCHEDULER_WORKER_VISIBILITY_TIMEOUT_MS';
const ENV_WORKER_ID = 'MESSAGE_SCHEDULER_WORKER_ID';

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_SWEEPER_TICK_MS = 120_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

/**
 * Module-level singleton. Holds timers + last-tick diagnostics. Timers
 * never become a concurrency primitive — MongoDB atomic updates are.
 */
const state = {
  tickTimer: null,
  sweeperTimer: null,
  enabled: false,
  workerId: null,
  tickMs: DEFAULT_TICK_MS,
  sweeperTickMs: DEFAULT_SWEEPER_TICK_MS,
  batchSize: DEFAULT_BATCH_SIZE,
  visibilityTimeoutMs: DEFAULT_VISIBILITY_TIMEOUT_MS,
  lastTickAt: null,
  lastSweepAt: null,
  lastTickClaimedCount: 0,
  lastTickLostCount: 0,
  lastSweepRescheduledCount: 0,
  lastSweepFailedCount: 0,
  lastTickError: null,
  lastSweepError: null
};

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
  const host = os.hostname();
  return `${host}#${process.pid}#${Date.now().toString(36)}`;
}

function isFlagEnabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function isDispatcherEnabled() {
  return String(process.env[ENV_DISPATCHER_FLAG] || '').trim() === '1';
}

// Test-only knob: when true, `tickOnce` awaits the dispatcher invocation
// before returning, making per-test assertions deterministic. Production
// callers MUST NOT set this; the dispatcher must run fire-and-forget so a
// slow provider can never block the worker tick.
let awaitDispatcherForTests = false;
function setAwaitDispatcherForTests(value) {
  awaitDispatcherForTests = Boolean(value);
}

function readEnvConfig() {
  return {
    enabled: isFlagEnabled(),
    workerId: buildWorkerId(),
    tickMs: parsePositiveIntEnv(ENV_TICK_MS, DEFAULT_TICK_MS),
    sweeperTickMs: parsePositiveIntEnv(ENV_SWEEPER_TICK_MS, DEFAULT_SWEEPER_TICK_MS),
    batchSize: parsePositiveIntEnv(ENV_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    visibilityTimeoutMs: parsePositiveIntEnv(ENV_VISIBILITY_TIMEOUT_MS, DEFAULT_VISIBILITY_TIMEOUT_MS)
  };
}

function ensureWorkerId() {
  if (!state.workerId) state.workerId = buildWorkerId();
  return state.workerId;
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'messaging-worker',
    phase,
    workerId: state.workerId,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

function computeBackoffMs(nextAttempt) {
  // 5min, 10min, 20min, capped at 30min. Matches spec §18.
  const expIdx = Math.max(0, nextAttempt - 1);
  const exp = BACKOFF_BASE_MS * Math.pow(2, expIdx);
  return Math.min(BACKOFF_CAP_MS, exp);
}

/**
 * Run one claim tick. Exported for tests; also called by `setInterval`.
 *
 * Behaviour:
 *   - Selects up to `state.batchSize` rows with `status:'scheduled'` and
 *     `scheduledFor <= now`, ordered by `scheduledFor` ascending.
 *   - For each, attempts an atomic `findOneAndUpdate` with the
 *     `status:'scheduled'` precondition. Wins → `claimed`. Loses → skipped.
 *   - DOES NOT mark any job `sent` directly. DOES NOT write `MessageDispatch`.
 *   - DOES NOT increment `attemptCount` at claim time. `attemptCount`
 *     advances only on reclaim/failure (see `sweepStaleClaimedOnce`).
 *   - When `MESSAGE_DISPATCHER_ENABLED=1`, after a successful claim the
 *     claimed `_id` is passed to `messageDispatcher.processClaimedJob`
 *     fire-and-forget. The dispatcher owns the terminal job status (or
 *     reschedules for retry).
 */
async function tickOnce({ now = new Date() } = {}) {
  const result = { candidatesCount: 0, claimed: 0, lost: 0, errors: 0 };
  const workerId = ensureWorkerId();
  try {
    const candidates = await ScheduledMessageJob
      .find({ status: 'scheduled', scheduledFor: { $lte: now } })
      .sort({ scheduledFor: 1 })
      .limit(state.batchSize)
      .select('_id')
      .lean();
    result.candidatesCount = candidates.length;

    const visibilityTimeoutAt = new Date(now.getTime() + state.visibilityTimeoutMs);

    for (const cand of candidates) {
      try {
        const claimed = await ScheduledMessageJob.findOneAndUpdate(
          { _id: cand._id, status: 'scheduled' },
          {
            $set: {
              status: 'claimed',
              claimedBy: workerId,
              claimedAt: now,
              visibilityTimeoutAt
            }
          },
          { new: true }
        );
        if (claimed) {
          result.claimed += 1;
          // Batch 8: if the dispatcher flag is on, hand the claim to the
          // dispatcher. Lazy `require` avoids a circular import and keeps
          // the Batch 6 claim-only path import-free when the flag is off.
          if (isDispatcherEnabled()) {
            try {
              const { processClaimedJob } = require('./messageDispatcher');
              const dispatchPromise = Promise.resolve()
                .then(() => processClaimedJob(claimed._id))
                .catch((err) => logLine('error', 'dispatcher_invocation_failed', {
                  _id: String(claimed._id),
                  error: err?.message || String(err)
                }));
              // Tests can opt-in to awaiting the dispatcher via `awaitDispatcher`.
              if (awaitDispatcherForTests) {
                await dispatchPromise;
              }
            } catch (err) {
              logLine('error', 'dispatcher_require_failed', {
                _id: String(claimed._id),
                error: err?.message || String(err)
              });
            }
          }
        } else {
          result.lost += 1;
        }
      } catch (err) {
        result.errors += 1;
        logLine('error', 'claim_error', {
          _id: String(cand._id),
          error: err?.message || String(err)
        });
      }
    }

    state.lastTickAt = now;
    state.lastTickClaimedCount = result.claimed;
    state.lastTickLostCount = result.lost;
    state.lastTickError = null;
  } catch (err) {
    state.lastTickError = err?.message || String(err);
    logLine('error', 'tick_error', { error: state.lastTickError });
  }
  return result;
}

/**
 * Run one visibility-timeout sweep. Exported for tests; also called by
 * `setInterval`.
 *
 * Behaviour:
 *   - Selects up to `state.batchSize` rows where `status='claimed'` and
 *     `visibilityTimeoutAt <= now`.
 *   - For each, computes `nextAttempt = (attemptCount||0) + 1`.
 *   - If `nextAttempt >= maxAttempts` → terminal `failed` with
 *     `lastError='visibility_timeout_terminal'`.
 *   - Else → back to `scheduled`, increment `attemptCount`, push
 *     `scheduledFor = now + backoff(nextAttempt)`, `lastError =
 *     'visibility_timeout_reclaim'`.
 *   - Each transition is atomic on `(_id, status:'claimed')`.
 *   - DOES NOT mark any job `sent`. DOES NOT write `MessageDispatch`.
 */
async function sweepStaleClaimedOnce({ now = new Date() } = {}) {
  const result = { staleCount: 0, rescheduled: 0, failed: 0, lost: 0, errors: 0 };
  ensureWorkerId();
  try {
    const stale = await ScheduledMessageJob
      .find({ status: 'claimed', visibilityTimeoutAt: { $lte: now } })
      .limit(state.batchSize)
      .select('_id attemptCount maxAttempts')
      .lean();
    result.staleCount = stale.length;

    for (const job of stale) {
      try {
        const currentAttempt = Number.isFinite(job.attemptCount) ? job.attemptCount : 0;
        const cap = Number.isFinite(job.maxAttempts) && job.maxAttempts > 0 ? job.maxAttempts : 3;
        const nextAttempt = currentAttempt + 1;

        if (nextAttempt >= cap) {
          const r = await ScheduledMessageJob.updateOne(
            { _id: job._id, status: 'claimed' },
            {
              $set: {
                status: 'failed',
                attemptCount: nextAttempt,
                lastError: 'visibility_timeout_terminal',
                claimedBy: null,
                claimedAt: null,
                visibilityTimeoutAt: null
              }
            }
          );
          if (r.modifiedCount === 1) result.failed += 1;
          else result.lost += 1;
        } else {
          const backoffMs = computeBackoffMs(nextAttempt);
          const nextScheduledFor = new Date(now.getTime() + backoffMs);
          const r = await ScheduledMessageJob.updateOne(
            { _id: job._id, status: 'claimed' },
            {
              $set: {
                status: 'scheduled',
                attemptCount: nextAttempt,
                scheduledFor: nextScheduledFor,
                lastError: 'visibility_timeout_reclaim',
                claimedBy: null,
                claimedAt: null,
                visibilityTimeoutAt: null
              }
            }
          );
          if (r.modifiedCount === 1) result.rescheduled += 1;
          else result.lost += 1;
        }
      } catch (err) {
        result.errors += 1;
        logLine('error', 'sweep_error', {
          _id: String(job._id),
          error: err?.message || String(err)
        });
      }
    }

    state.lastSweepAt = now;
    state.lastSweepRescheduledCount = result.rescheduled;
    state.lastSweepFailedCount = result.failed;
    state.lastSweepError = null;
  } catch (err) {
    state.lastSweepError = err?.message || String(err);
    logLine('error', 'sweep_sweep_error', { error: state.lastSweepError });
  }
  return result;
}

/**
 * Start the worker only if the env flag is set. Idempotent: a second call
 * while running returns `{ started: true, alreadyStarted: true }`.
 *
 * IMPORTANT: emits a loud warning when enabled, because Batch 6 is
 * claim-only — running it against a populated production job table would
 * cause real jobs to get stuck in `claimed` until reclaimed (and never
 * dispatched, because no dispatcher exists yet).
 */
function startSchedulerWorkerIfEnabled() {
  const cfg = readEnvConfig();
  state.enabled = cfg.enabled;
  state.workerId = cfg.workerId;
  state.tickMs = cfg.tickMs;
  state.sweeperTickMs = cfg.sweeperTickMs;
  state.batchSize = cfg.batchSize;
  state.visibilityTimeoutMs = cfg.visibilityTimeoutMs;

  if (!cfg.enabled) {
    logLine('log', 'disabled', {
      reason: `${ENV_FLAG} is not '1'`,
      note: 'set MESSAGE_SCHEDULER_WORKER_ENABLED=1 to start'
    });
    return { started: false };
  }

  if (state.tickTimer || state.sweeperTimer) {
    logLine('log', 'already_started', {});
    return { started: true, alreadyStarted: true };
  }

  if (!isDispatcherEnabled()) {
    // Same loud warning as Batch 6 — when the dispatcher flag is OFF, the
    // worker is still claim-only and will silently consume real jobs.
    console.warn(
      '[messaging-worker] WARNING: scheduler is in CLAIM-ONLY mode (MESSAGE_DISPATCHER_ENABLED != "1"). '
      + 'Claimed jobs are not dispatched. Do not enable in production with real jobs.'
    );
  } else {
    // Batch 8 dispatcher is shadow-only. Producing shadow dispatches in
    // production would mark real jobs as sent without sending anything.
    console.warn(
      '[messaging-worker] WARNING: MESSAGE_DISPATCHER_ENABLED=1 but Batch 8 dispatcher is SHADOW-ONLY. '
      + 'It does NOT send real WhatsApp or email. Keep disabled in production with real jobs.'
    );
  }

  logLine('log', 'start', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs,
    dispatcherEnabled: isDispatcherEnabled()
  });

  // Kick off one immediate pass (non-blocking; errors swallowed by tickOnce).
  Promise.resolve()
    .then(() => tickOnce({ now: new Date() }))
    .catch((err) => logLine('error', 'tick_immediate_error', { error: err?.message || String(err) }));
  Promise.resolve()
    .then(() => sweepStaleClaimedOnce({ now: new Date() }))
    .catch((err) => logLine('error', 'sweep_immediate_error', { error: err?.message || String(err) }));

  state.tickTimer = setInterval(() => {
    tickOnce({ now: new Date() }).catch((err) => {
      logLine('error', 'tick_interval_error', { error: err?.message || String(err) });
    });
  }, state.tickMs);
  if (typeof state.tickTimer.unref === 'function') state.tickTimer.unref();

  state.sweeperTimer = setInterval(() => {
    sweepStaleClaimedOnce({ now: new Date() }).catch((err) => {
      logLine('error', 'sweep_interval_error', { error: err?.message || String(err) });
    });
  }, state.sweeperTickMs);
  if (typeof state.sweeperTimer.unref === 'function') state.sweeperTimer.unref();

  return { started: true };
}

/**
 * Stop both timers. Idempotent. Does NOT roll back in-flight `claimed`
 * jobs — those stay `claimed` and will be reclaimed by the next worker
 * (or this one on restart) once their `visibilityTimeoutAt` expires.
 *
 * Named `*ForTest` to match the iCal scheduler convention; also used by
 * the production graceful-shutdown hook.
 */
function stopSchedulerWorkerForTest() {
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  if (state.sweeperTimer) {
    clearInterval(state.sweeperTimer);
    state.sweeperTimer = null;
  }
}

function getSchedulerWorkerState() {
  return {
    enabled: Boolean(state.enabled),
    running: Boolean(state.tickTimer && state.sweeperTimer),
    workerId: state.workerId,
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs,
    lastTickAt: state.lastTickAt,
    lastSweepAt: state.lastSweepAt,
    lastTickClaimedCount: state.lastTickClaimedCount,
    lastTickLostCount: state.lastTickLostCount,
    lastSweepRescheduledCount: state.lastSweepRescheduledCount,
    lastSweepFailedCount: state.lastSweepFailedCount,
    lastTickError: state.lastTickError,
    lastSweepError: state.lastSweepError
  };
}

module.exports = {
  // Public entrypoints.
  startSchedulerWorkerIfEnabled,
  stopSchedulerWorkerForTest,
  getSchedulerWorkerState,
  // Exposed for tests.
  tickOnce,
  sweepStaleClaimedOnce,
  computeBackoffMs,
  setAwaitDispatcherForTests,
  isDispatcherEnabled,
  // Exposed for diagnostics / tooling.
  ENV_FLAG,
  ENV_DISPATCHER_FLAG,
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_VISIBILITY_TIMEOUT_MS
};
