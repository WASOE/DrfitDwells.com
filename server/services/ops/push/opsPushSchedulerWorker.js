'use strict';

const os = require('os');
const OpsPushScheduledJob = require('../../../models/OpsPushScheduledJob');
const { claimDueJob, rescheduleStaleClaimedJob, failStaleClaimedJob } = require('./opsPushScheduledJobService');
const { executeOpsPushScheduledJob } = require('./opsPushScheduledNotifications');

const ENV_FLAG = 'OPS_PUSH_SCHEDULER_WORKER_ENABLED';
const ENV_TICK_MS = 'OPS_PUSH_SCHEDULER_WORKER_TICK_MS';
const ENV_SWEEPER_TICK_MS = 'OPS_PUSH_SCHEDULER_WORKER_SWEEPER_TICK_MS';
const ENV_BATCH_SIZE = 'OPS_PUSH_SCHEDULER_WORKER_BATCH_SIZE';
const ENV_VISIBILITY_TIMEOUT_MS = 'OPS_PUSH_SCHEDULER_WORKER_VISIBILITY_TIMEOUT_MS';
const ENV_WORKER_ID = 'OPS_PUSH_SCHEDULER_WORKER_ID';
const ENV_MAX_DELIVERY_AGE_MS = 'OPS_PUSH_SCHEDULER_MAX_DELIVERY_AGE_MS';

const DEFAULT_TICK_MS = 60_000;
const DEFAULT_SWEEPER_TICK_MS = 120_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_VISIBILITY_TIMEOUT_MS = 5 * 60_000;
// Scheduled Ops pushes are time-sensitive ("arrival tomorrow", "checkout today").
// Anything older than this is obsolete and must never be delivered, especially
// after a restart that replays a backlog.
const DEFAULT_MAX_DELIVERY_AGE_MS = 6 * 60 * 60_000;
const OBSOLETE_JOB_REASON = 'scheduled_for_expired';
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

const state = {
  tickTimer: null,
  sweeperTimer: null,
  enabled: false,
  workerId: null,
  startedAt: null,
  tickMs: DEFAULT_TICK_MS,
  sweeperTickMs: DEFAULT_SWEEPER_TICK_MS,
  batchSize: DEFAULT_BATCH_SIZE,
  visibilityTimeoutMs: DEFAULT_VISIBILITY_TIMEOUT_MS,
  maxDeliveryAgeMs: DEFAULT_MAX_DELIVERY_AGE_MS,
  lastTickAt: null,
  lastSweepAt: null,
  lastTickClaimedCount: 0,
  lastTickExpiredCount: 0,
  lastTickLostCount: 0,
  lastSweepRescheduledCount: 0,
  lastSweepFailedCount: 0,
  lastTickError: null,
  lastSweepError: null
};

let awaitExecuteForTests = false;

function setAwaitExecuteForTests(value) {
  awaitExecuteForTests = Boolean(value);
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
  return `${os.hostname()}#${process.pid}#ops-push#${Date.now().toString(36)}`;
}

function isFlagEnabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function readEnvConfig() {
  return {
    enabled: isFlagEnabled(),
    workerId: buildWorkerId(),
    tickMs: parsePositiveIntEnv(ENV_TICK_MS, DEFAULT_TICK_MS),
    sweeperTickMs: parsePositiveIntEnv(ENV_SWEEPER_TICK_MS, DEFAULT_SWEEPER_TICK_MS),
    batchSize: parsePositiveIntEnv(ENV_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    visibilityTimeoutMs: parsePositiveIntEnv(ENV_VISIBILITY_TIMEOUT_MS, DEFAULT_VISIBILITY_TIMEOUT_MS),
    maxDeliveryAgeMs: parsePositiveIntEnv(ENV_MAX_DELIVERY_AGE_MS, DEFAULT_MAX_DELIVERY_AGE_MS)
  };
}

function ensureWorkerId() {
  if (!state.workerId) state.workerId = buildWorkerId();
  return state.workerId;
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'ops-push-worker',
    phase,
    workerId: state.workerId,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else console.log(payload);
}

function computeBackoffMs(nextAttempt) {
  const expIdx = Math.max(0, nextAttempt - 1);
  const exp = BACKOFF_BASE_MS * Math.pow(2, expIdx);
  return Math.min(BACKOFF_CAP_MS, exp);
}

async function executeClaimedJob(job) {
  try {
    return await executeOpsPushScheduledJob(job);
  } catch (err) {
    logLine('error', 'execute_failed', {
      jobId: String(job._id),
      error: err?.message || String(err)
    });
    return { ok: false, error: err?.message || String(err) };
  }
}

async function tickOnce({ now = new Date() } = {}) {
  const result = { candidatesCount: 0, claimed: 0, lost: 0, errors: 0, expired: 0 };
  const workerId = ensureWorkerId();
  const cutoff = new Date(now.getTime() - state.maxDeliveryAgeMs);
  try {
    // Terminal suppression, never delivery: a restart must not replay a backlog.
    // Rows stay in the collection for audit, so notification history is preserved.
    const expiredResult = await OpsPushScheduledJob.updateMany(
      { status: 'scheduled', scheduledFor: { $lte: cutoff } },
      {
        $set: {
          status: 'suppressed',
          lastError: OBSOLETE_JOB_REASON,
          lastResult: { suppressed: true, reason: OBSOLETE_JOB_REASON },
          claimedBy: null,
          claimedAt: null,
          visibilityTimeoutAt: null
        }
      }
    );
    result.expired = expiredResult.modifiedCount || 0;
    if (result.expired > 0) {
      logLine('log', 'obsolete_backlog_suppressed', {
        count: result.expired,
        cutoff: cutoff.toISOString(),
        maxDeliveryAgeMs: state.maxDeliveryAgeMs
      });
    }

    const candidates = await OpsPushScheduledJob.find({
      status: 'scheduled',
      scheduledFor: { $lte: now }
    })
      .sort({ scheduledFor: 1 })
      .limit(state.batchSize)
      .lean();

    result.candidatesCount = candidates.length;

    for (const cand of candidates) {
      // Defense in depth against a race with the bulk suppression above.
      if (cand.scheduledFor && cand.scheduledFor <= cutoff) {
        result.expired += 1;
        continue;
      }
      try {
        const claimed = await claimDueJob({
          jobId: cand._id,
          workerId,
          now,
          visibilityTimeoutMs: state.visibilityTimeoutMs
        });
        if (!claimed) {
          result.lost += 1;
          continue;
        }
        result.claimed += 1;
        const execPromise = executeClaimedJob(claimed);
        if (awaitExecuteForTests) {
          await execPromise;
        } else {
          void execPromise.catch((err) => {
            logLine('error', 'execute_async_failed', {
              jobId: String(claimed._id),
              error: err?.message || String(err)
            });
          });
        }
      } catch (err) {
        result.errors += 1;
        logLine('error', 'claim_error', {
          jobId: String(cand._id),
          error: err?.message || String(err)
        });
      }
    }

    state.lastTickAt = now;
    state.lastTickClaimedCount = result.claimed;
    state.lastTickExpiredCount = result.expired;
    state.lastTickLostCount = result.lost;
    state.lastTickError = null;
  } catch (err) {
    state.lastTickError = err?.message || String(err);
    logLine('error', 'tick_error', { error: state.lastTickError });
  }
  return result;
}

async function sweepStaleClaimedOnce({ now = new Date() } = {}) {
  const result = { staleCount: 0, rescheduled: 0, failed: 0, lost: 0, errors: 0 };
  ensureWorkerId();
  try {
    const stale = await OpsPushScheduledJob.find({
      status: 'claimed',
      visibilityTimeoutAt: { $lte: now }
    })
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
          const ok = await failStaleClaimedJob({ jobId: job._id, nextAttempt });
          if (ok) result.failed += 1;
          else result.lost += 1;
        } else {
          const backoffMs = computeBackoffMs(nextAttempt);
          const nextScheduledFor = new Date(now.getTime() + backoffMs);
          const ok = await rescheduleStaleClaimedJob({
            jobId: job._id,
            nextAttempt,
            nextScheduledFor,
            now
          });
          if (ok) result.rescheduled += 1;
          else result.lost += 1;
        }
      } catch (err) {
        result.errors += 1;
        logLine('error', 'sweep_error', {
          jobId: String(job._id),
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

function startOpsPushSchedulerWorkerIfEnabled() {
  const cfg = readEnvConfig();
  state.enabled = cfg.enabled;
  state.workerId = cfg.workerId;
  state.tickMs = cfg.tickMs;
  state.sweeperTickMs = cfg.sweeperTickMs;
  state.batchSize = cfg.batchSize;
  state.visibilityTimeoutMs = cfg.visibilityTimeoutMs;
  state.maxDeliveryAgeMs = cfg.maxDeliveryAgeMs;

  if (!cfg.enabled) {
    state.startedAt = null;
    logLine('log', 'disabled', {
      reason: `${ENV_FLAG} is not '1'`
    });
    return { started: false };
  }

  if (state.tickTimer || state.sweeperTimer) {
    logLine('log', 'already_started', {});
    return { started: true, alreadyStarted: true };
  }

  logLine('log', 'start', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs,
    maxDeliveryAgeMs: state.maxDeliveryAgeMs
  });

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

  state.startedAt = new Date();

  return { started: true };
}

function stopOpsPushSchedulerWorkerForTest() {
  if (state.tickTimer) {
    clearInterval(state.tickTimer);
    state.tickTimer = null;
  }
  if (state.sweeperTimer) {
    clearInterval(state.sweeperTimer);
    state.sweeperTimer = null;
  }
  state.startedAt = null;
}

function getOpsPushSchedulerWorkerState() {
  return {
    enabled: Boolean(state.enabled),
    running: Boolean(state.tickTimer && state.sweeperTimer),
    workerId: state.workerId,
    startedAt: state.startedAt,
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs,
    maxDeliveryAgeMs: state.maxDeliveryAgeMs,
    lastTickAt: state.lastTickAt,
    lastSweepAt: state.lastSweepAt,
    lastTickClaimedCount: state.lastTickClaimedCount,
    lastTickExpiredCount: state.lastTickExpiredCount,
    lastTickLostCount: state.lastTickLostCount,
    lastSweepRescheduledCount: state.lastSweepRescheduledCount,
    lastSweepFailedCount: state.lastSweepFailedCount,
    lastTickError: state.lastTickError,
    lastSweepError: state.lastSweepError
  };
}

module.exports = {
  startOpsPushSchedulerWorkerIfEnabled,
  stopOpsPushSchedulerWorkerForTest,
  getOpsPushSchedulerWorkerState,
  tickOnce,
  sweepStaleClaimedOnce,
  executeClaimedJob,
  computeBackoffMs,
  setAwaitExecuteForTests,
  ENV_FLAG,
  ENV_MAX_DELIVERY_AGE_MS,
  OBSOLETE_JOB_REASON,
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_VISIBILITY_TIMEOUT_MS,
  DEFAULT_MAX_DELIVERY_AGE_MS
};
