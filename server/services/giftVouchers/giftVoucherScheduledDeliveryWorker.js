'use strict';

const os = require('os');
const GiftVoucher = require('../../models/GiftVoucher');
const {
  SCHEDULED_DELIVERY_WORKER_ENV_FLAG,
  SCHEDULED_DELIVERY_WORKER_TICK_MS_ENV,
  SCHEDULED_DELIVERY_WORKER_SWEEPER_TICK_MS_ENV,
  SCHEDULED_DELIVERY_WORKER_BATCH_SIZE_ENV,
  SCHEDULED_DELIVERY_WORKER_VISIBILITY_TIMEOUT_MS_ENV,
  SCHEDULED_DELIVERY_WORKER_ID_ENV,
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_VISIBILITY_TIMEOUT_MS,
  DELIVERABLE_STATUSES
} = require('./giftVoucherScheduledDeliveryConstants');
const {
  deliverScheduledRecipientVoucher,
  evaluateScheduledVoucherEligibility,
  releaseScheduledDeliveryClaim
} = require('./giftVoucherScheduledDeliveryService');
const { isScheduledDeliveryDue } = require('./giftVoucherScheduledDeliveryDates');

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
  lastTickSentCount: 0,
  lastTickSkippedCount: 0,
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
  const explicit = (process.env[SCHEDULED_DELIVERY_WORKER_ID_ENV] || '').trim();
  if (explicit) return explicit;
  return `${os.hostname()}#${process.pid}#${Date.now().toString(36)}`;
}

function isFlagEnabled() {
  return String(process.env[SCHEDULED_DELIVERY_WORKER_ENV_FLAG] || '').trim() === '1';
}

function readEnvConfig() {
  return {
    enabled: isFlagEnabled(),
    workerId: buildWorkerId(),
    tickMs: parsePositiveIntEnv(SCHEDULED_DELIVERY_WORKER_TICK_MS_ENV, DEFAULT_TICK_MS),
    sweeperTickMs: parsePositiveIntEnv(
      SCHEDULED_DELIVERY_WORKER_SWEEPER_TICK_MS_ENV,
      DEFAULT_SWEEPER_TICK_MS
    ),
    batchSize: parsePositiveIntEnv(SCHEDULED_DELIVERY_WORKER_BATCH_SIZE_ENV, DEFAULT_BATCH_SIZE),
    visibilityTimeoutMs: parsePositiveIntEnv(
      SCHEDULED_DELIVERY_WORKER_VISIBILITY_TIMEOUT_MS_ENV,
      DEFAULT_VISIBILITY_TIMEOUT_MS
    )
  };
}

function ensureWorkerId() {
  if (!state.workerId) state.workerId = buildWorkerId();
  return state.workerId;
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'gift-voucher-delivery-worker',
    phase,
    workerId: state.workerId,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

async function claimScheduledVoucher({ giftVoucherId, workerId, now, visibilityTimeoutMs }) {
  const claimExpiresAt = new Date(now.getTime() + visibilityTimeoutMs);
  return GiftVoucher.findOneAndUpdate(
    {
      _id: giftVoucherId,
      deliveryOption: 'scheduled',
      sentAt: null,
      status: { $in: DELIVERABLE_STATUSES },
      $or: [
        { scheduledDeliveryClaimExpiresAt: null },
        { scheduledDeliveryClaimExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: {
        scheduledDeliveryClaimedBy: workerId,
        scheduledDeliveryClaimedAt: now,
        scheduledDeliveryClaimExpiresAt: claimExpiresAt
      }
    },
    { new: true }
  ).lean();
}

async function sweepStaleClaimsOnce({ now = new Date() } = {}) {
  const result = { cleared: 0, errors: 0 };
  try {
    const stale = await GiftVoucher.find({
      deliveryOption: 'scheduled',
      sentAt: null,
      scheduledDeliveryClaimExpiresAt: { $lte: now, $ne: null }
    })
      .select('_id')
      .limit(state.batchSize)
      .lean();

    for (const row of stale) {
      try {
        const updated = await GiftVoucher.updateOne(
          {
            _id: row._id,
            scheduledDeliveryClaimExpiresAt: { $lte: now }
          },
          {
            $unset: {
              scheduledDeliveryClaimedBy: 1,
              scheduledDeliveryClaimedAt: 1,
              scheduledDeliveryClaimExpiresAt: 1
            }
          }
        );
        if (updated.modifiedCount === 1) result.cleared += 1;
      } catch (err) {
        result.errors += 1;
        logLine('error', 'sweep_claim_error', {
          giftVoucherId: String(row._id),
          error: err?.message || String(err)
        });
      }
    }
    state.lastSweepAt = now;
    state.lastSweepError = null;
  } catch (err) {
    state.lastSweepError = err?.message || String(err);
    logLine('error', 'sweep_error', { error: state.lastSweepError });
  }
  return result;
}

async function tickOnce({ now = new Date() } = {}) {
  const result = {
    candidatesCount: 0,
    claimed: 0,
    lost: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: 0
  };
  const workerId = ensureWorkerId();

  try {
    const candidates = await GiftVoucher.find({
      deliveryOption: 'scheduled',
      sentAt: null,
      status: { $in: DELIVERABLE_STATUSES },
      $or: [
        { scheduledDeliveryClaimExpiresAt: null },
        { scheduledDeliveryClaimExpiresAt: { $lte: now } }
      ]
    })
      .sort({ deliveryDate: 1 })
      .limit(state.batchSize)
      .lean();

    const dueCandidates = candidates.filter((v) => isScheduledDeliveryDue(v.deliveryDate, now));
    result.candidatesCount = dueCandidates.length;

    for (const candidate of dueCandidates) {
      try {
        const eligibility = await evaluateScheduledVoucherEligibility(candidate, { now });
        if (!eligibility.eligible) {
          result.skipped += 1;
          continue;
        }

        const claimed = await claimScheduledVoucher({
          giftVoucherId: candidate._id,
          workerId,
          now,
          visibilityTimeoutMs: state.visibilityTimeoutMs
        });
        if (!claimed) {
          result.lost += 1;
          continue;
        }
        result.claimed += 1;

        const outcome = await deliverScheduledRecipientVoucher(claimed, { workerId, now });
        if (outcome.status === 'sent') result.sent += 1;
        else if (outcome.skipped) result.skipped += 1;
        else if (outcome.status === 'failed') result.failed += 1;
      } catch (err) {
        result.errors += 1;
        await releaseScheduledDeliveryClaim(candidate._id);
        logLine('error', 'tick_voucher_error', {
          giftVoucherId: String(candidate._id),
          error: err?.message || String(err)
        });
      }
    }

    state.lastTickAt = now;
    state.lastTickClaimedCount = result.claimed;
    state.lastTickLostCount = result.lost;
    state.lastTickSentCount = result.sent;
    state.lastTickSkippedCount = result.skipped;
    state.lastTickError = null;
  } catch (err) {
    state.lastTickError = err?.message || String(err);
    logLine('error', 'tick_error', { error: state.lastTickError });
  }

  return result;
}

function startScheduledDeliveryWorkerIfEnabled() {
  const cfg = readEnvConfig();
  state.enabled = cfg.enabled;
  state.workerId = cfg.workerId;
  state.tickMs = cfg.tickMs;
  state.sweeperTickMs = cfg.sweeperTickMs;
  state.batchSize = cfg.batchSize;
  state.visibilityTimeoutMs = cfg.visibilityTimeoutMs;

  if (!cfg.enabled) {
    logLine('log', 'disabled', {
      reason: `${SCHEDULED_DELIVERY_WORKER_ENV_FLAG} is not '1'`
    });
    return { started: false };
  }

  if (state.tickTimer || state.sweeperTimer) {
    return { started: true, alreadyStarted: true };
  }

  logLine('log', 'start', {
    tickMs: state.tickMs,
    sweeperTickMs: state.sweeperTickMs,
    batchSize: state.batchSize,
    visibilityTimeoutMs: state.visibilityTimeoutMs
  });

  state.tickTimer = setInterval(() => {
    tickOnce().catch((err) => {
      logLine('error', 'tick_interval_error', { error: err?.message || String(err) });
    });
  }, state.tickMs);

  state.sweeperTimer = setInterval(() => {
    sweepStaleClaimsOnce().catch((err) => {
      logLine('error', 'sweep_interval_error', { error: err?.message || String(err) });
    });
  }, state.sweeperTickMs);

  if (typeof state.tickTimer.unref === 'function') state.tickTimer.unref();
  if (typeof state.sweeperTimer.unref === 'function') state.sweeperTimer.unref();

  return { started: true };
}

function stopScheduledDeliveryWorkerForTest() {
  if (state.tickTimer) clearInterval(state.tickTimer);
  if (state.sweeperTimer) clearInterval(state.sweeperTimer);
  state.tickTimer = null;
  state.sweeperTimer = null;
  state.enabled = false;
}

function getScheduledDeliveryWorkerState() {
  return { ...state };
}

module.exports = {
  tickOnce,
  sweepStaleClaimsOnce,
  claimScheduledVoucher,
  startScheduledDeliveryWorkerIfEnabled,
  stopScheduledDeliveryWorkerForTest,
  getScheduledDeliveryWorkerState,
  isFlagEnabled
};
