'use strict';

/**
 * Dedicated BuildEnquiry email retry worker.
 *
 * Isolated from booking-confirmation and gift-voucher delivery workers.
 * Uses BuildEnquiry lane claim helpers only — never EmailDeliveryState /
 * MessageDispatch / GiftVoucher delivery paths.
 *
 * At-least-once: SMTP success then crash before status=succeeded can still
 * cause a duplicate send after lease expiry (documented on claim helper).
 */

const os = require('os');
const BuildEnquiry = require('../../models/BuildEnquiry');
const {
  EMAIL_LANES,
  EMAIL_VISIBILITY_TIMEOUT_MS,
  BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG,
  BUILD_ENQUIRY_EMAIL_WORKER_TICK_MS_ENV,
  BUILD_ENQUIRY_EMAIL_WORKER_BATCH_SIZE_ENV,
  BUILD_ENQUIRY_EMAIL_WORKER_ID_ENV,
  BUILD_ENQUIRY_EMAIL_WORKER_VISIBILITY_TIMEOUT_MS_ENV,
  DEFAULT_WORKER_TICK_MS,
  DEFAULT_WORKER_BATCH_SIZE
} = require('./buildEnquiryConstants');
const {
  attemptBuildEnquiryEmailLane,
  findDueBuildEnquiryEmailCandidates,
  findExhaustedExpiredSendingLanes,
  markBuildEnquiryEmailNeedsManual,
  __setEmailServiceForTesting
} = require('./buildEnquiryEmailService');

const state = {
  tickTimer: null,
  enabled: false,
  stopping: false,
  tickInFlight: null,
  workerId: null,
  tickMs: DEFAULT_WORKER_TICK_MS,
  batchSize: DEFAULT_WORKER_BATCH_SIZE,
  visibilityTimeoutMs: EMAIL_VISIBILITY_TIMEOUT_MS,
  lastTickAt: null,
  lastTickError: null,
  emailService: null
};

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function buildWorkerId() {
  const explicit = (process.env[BUILD_ENQUIRY_EMAIL_WORKER_ID_ENV] || '').trim();
  if (explicit) return explicit;
  return `build-enquiry-email#${os.hostname()}#${process.pid}#${Date.now().toString(36)}`;
}

function isFlagEnabled() {
  return String(process.env[BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG] || '').trim() === '1';
}

function readEnvConfig() {
  return {
    enabled: isFlagEnabled(),
    workerId: buildWorkerId(),
    tickMs: parsePositiveIntEnv(
      BUILD_ENQUIRY_EMAIL_WORKER_TICK_MS_ENV,
      DEFAULT_WORKER_TICK_MS
    ),
    batchSize: parsePositiveIntEnv(
      BUILD_ENQUIRY_EMAIL_WORKER_BATCH_SIZE_ENV,
      DEFAULT_WORKER_BATCH_SIZE
    ),
    visibilityTimeoutMs: parsePositiveIntEnv(
      BUILD_ENQUIRY_EMAIL_WORKER_VISIBILITY_TIMEOUT_MS_ENV,
      EMAIL_VISIBILITY_TIMEOUT_MS
    )
  };
}

function logEvent(level, event, fields = {}) {
  const payload = JSON.stringify({
    source: 'build-enquiry-email-worker',
    event,
    workerId: state.workerId,
    ts: new Date().toISOString(),
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

function ensureWorkerId() {
  if (!state.workerId) state.workerId = buildWorkerId();
  return state.workerId;
}

/**
 * One poll cycle across both lanes independently.
 */
async function tickOnce({ now = new Date(), emailService = null } = {}) {
  if (state.stopping) {
    return { skipped: true, reason: 'stopping' };
  }

  const workerId = ensureWorkerId();
  const svc = emailService || state.emailService || null;
  const summary = {
    lanes: {},
    errors: 0
  };

  for (const lane of EMAIL_LANES) {
    const laneStats = {
      lane,
      exhaustedMarked: 0,
      claimed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      exhaustedAfterSend: 0,
      errors: 0
    };

    try {
      const exhausted = await findExhaustedExpiredSendingLanes(lane, {
        now,
        limit: state.batchSize
      });
      for (const row of exhausted) {
        try {
          const marked = await markBuildEnquiryEmailNeedsManual({
            enquiryId: row._id,
            lane,
            error: 'expired_lease_exhausted',
            now
          });
          if (marked) {
            laneStats.exhaustedMarked += 1;
            logEvent('warn', 'build_enquiry_email_exhausted_lease', {
              enquiryId: String(row._id),
              projectReference: row.projectReference,
              lane,
              outcome: 'needs_manual'
            });
          }
        } catch (err) {
          laneStats.errors += 1;
          summary.errors += 1;
          logEvent('error', 'build_enquiry_email_worker_error', {
            phase: 'mark_needs_manual',
            enquiryId: String(row._id),
            lane,
            error: err?.message || String(err)
          });
        }
      }

      const candidates = await findDueBuildEnquiryEmailCandidates(lane, {
        now,
        limit: state.batchSize
      });

      for (const row of candidates) {
        if (state.stopping) break;
        try {
          const result = await attemptBuildEnquiryEmailLane(row._id, lane, {
            emailService: svc,
            workerId
          });

          if (result.skipped) {
            laneStats.skipped += 1;
            continue;
          }

          laneStats.claimed += 1;
          if (result.status === 'succeeded') {
            laneStats.succeeded += 1;
            logEvent('info', 'build_enquiry_email_send_success', {
              enquiryId: String(row._id),
              projectReference: row.projectReference,
              lane,
              method: result.sendResult?.method || null
            });
          } else if (result.status === 'failed') {
            laneStats.failed += 1;
            const fresh = await BuildEnquiry.findById(row._id)
              .select('emails projectReference')
              .lean();
            const laneState = fresh?.emails?.[lane] || {};
            const attemptCount = Number(laneState.attemptCount) || 0;
            const maxAttempts = Number(laneState.maxAttempts) || 10;
            const exhausted = attemptCount >= maxAttempts;
            if (exhausted) {
              laneStats.exhaustedAfterSend += 1;
              logEvent('warn', 'build_enquiry_email_exhausted', {
                enquiryId: String(row._id),
                projectReference: row.projectReference || fresh?.projectReference,
                lane,
                attemptCount,
                maxAttempts,
                error: result.sendResult?.error || result.sendResult?.method || 'send_failed'
              });
            } else {
              logEvent('warn', 'build_enquiry_email_send_retry', {
                enquiryId: String(row._id),
                projectReference: row.projectReference || fresh?.projectReference,
                lane,
                attemptCount,
                maxAttempts,
                nextAttemptAt: laneState.nextAttemptAt || null,
                error: result.sendResult?.error || result.sendResult?.method || 'send_failed'
              });
            }
          } else if (result.status === 'persistence_failed') {
            laneStats.errors += 1;
            summary.errors += 1;
            logEvent('error', 'build_enquiry_email_worker_error', {
              phase: 'status_persist',
              enquiryId: String(row._id),
              lane,
              error: result.persistenceError
            });
          }
        } catch (err) {
          laneStats.errors += 1;
          summary.errors += 1;
          logEvent('error', 'build_enquiry_email_worker_error', {
            phase: 'attempt_lane',
            enquiryId: String(row._id),
            lane,
            error: err?.message || String(err)
          });
        }
      }
    } catch (err) {
      laneStats.errors += 1;
      summary.errors += 1;
      logEvent('error', 'build_enquiry_email_worker_error', {
        phase: 'scan_lane',
        lane,
        error: err?.message || String(err)
      });
    }

    summary.lanes[lane] = laneStats;
  }

  state.lastTickAt = now;
  state.lastTickError = summary.errors ? 'tick_had_errors' : null;
  logEvent('info', 'build_enquiry_email_worker_tick', {
    summary
  });
  return summary;
}

async function runTickSafe(opts = {}) {
  if (state.tickInFlight) {
    return state.tickInFlight;
  }
  state.tickInFlight = Promise.resolve()
    .then(() => tickOnce(opts))
    .catch((err) => {
      state.lastTickError = err?.message || String(err);
      logEvent('error', 'build_enquiry_email_worker_error', {
        phase: 'tick',
        error: state.lastTickError
      });
      return { errors: 1, fatal: state.lastTickError };
    })
    .finally(() => {
      state.tickInFlight = null;
    });
  return state.tickInFlight;
}

function startBuildEnquiryEmailWorker(overrides = {}) {
  const cfg = { ...readEnvConfig(), ...overrides };
  if (!cfg.enabled && overrides.enabled !== true) {
    return { started: false, reason: 'disabled' };
  }

  stopBuildEnquiryEmailWorkerForTest();

  state.enabled = true;
  state.stopping = false;
  state.workerId = cfg.workerId || buildWorkerId();
  state.tickMs = cfg.tickMs || DEFAULT_WORKER_TICK_MS;
  state.batchSize = cfg.batchSize || DEFAULT_WORKER_BATCH_SIZE;
  state.visibilityTimeoutMs = cfg.visibilityTimeoutMs || EMAIL_VISIBILITY_TIMEOUT_MS;
  if (overrides.emailService) {
    state.emailService = overrides.emailService;
    __setEmailServiceForTesting(overrides.emailService);
  }

  logEvent('info', 'build_enquiry_email_worker_started', {
    tickMs: state.tickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs
  });

  const schedule = () => {
    state.tickTimer = setTimeout(() => {
      runTickSafe({})
        .catch(() => {})
        .finally(() => {
          if (state.enabled && !state.stopping) schedule();
        });
    }, state.tickMs);
    if (typeof state.tickTimer.unref === 'function') state.tickTimer.unref();
  };

  // Immediate first tick, then interval-style reschedule.
  runTickSafe({})
    .catch(() => {})
    .finally(() => {
      if (state.enabled && !state.stopping) schedule();
    });

  return { started: true, workerId: state.workerId };
}

function startBuildEnquiryEmailWorkerIfEnabled(overrides = {}) {
  if (!isFlagEnabled() && overrides.enabled !== true) {
    return { started: false, reason: 'disabled' };
  }
  return startBuildEnquiryEmailWorker({ ...overrides, enabled: true });
}

async function stopBuildEnquiryEmailWorkerForTest() {
  state.stopping = true;
  state.enabled = false;
  if (state.tickTimer) {
    clearTimeout(state.tickTimer);
    state.tickTimer = null;
  }
  if (state.tickInFlight) {
    try {
      await state.tickInFlight;
    } catch {
      /* ignore */
    }
  }
  state.emailService = null;
  __setEmailServiceForTesting(null);
  state.stopping = false;
}

function getBuildEnquiryEmailWorkerStateForTest() {
  return {
    enabled: state.enabled,
    stopping: state.stopping,
    workerId: state.workerId,
    tickMs: state.tickMs,
    batchSize: state.batchSize,
    lastTickAt: state.lastTickAt,
    lastTickError: state.lastTickError,
    tickInFlight: Boolean(state.tickInFlight)
  };
}

module.exports = {
  tickOnce,
  runTickSafe,
  startBuildEnquiryEmailWorker,
  startBuildEnquiryEmailWorkerIfEnabled,
  stopBuildEnquiryEmailWorkerForTest,
  getBuildEnquiryEmailWorkerStateForTest,
  isFlagEnabled,
  readEnvConfig,
  BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG
};
