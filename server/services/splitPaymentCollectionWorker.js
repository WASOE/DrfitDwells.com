/**
 * SP6 — split-payment collection maintenance worker.
 * Internally: invoice provisioning, reminders, grace/cancellation-review.
 * Does NOT charge. Stripe charges after scheduled invoice finalization.
 * Independent of SPLIT_PAYMENT_ENABLED.
 */
'use strict';

const os = require('os');
const featureFlags = require('../utils/featureFlags');
const Booking = require('../models/Booking');
const BookingInstallment = require('../models/BookingInstallment');
const {
  findDueUnprovisionedInstallments,
  claimInstallmentForProvisioning,
  provisionInstallmentInvoice,
  reclaimStaleProvisioningClaims,
  SplitInvoiceProvisioningError,
  PROVISION_CODES
} = require('./splitPaymentInvoiceProvisioningService');
const {
  processDueInstallmentReminders
} = require('./splitPaymentCollectionEmailService');
const {
  reconcileExpiredGraceInstallments,
  reconcileRetryExhaustionCandidates
} = require('./splitPaymentGraceService');

const ENV_TICK_MS = 'SPLIT_PAYMENT_COLLECTION_WORKER_TICK_MS';
const ENV_SWEEPER_TICK_MS = 'SPLIT_PAYMENT_COLLECTION_WORKER_SWEEPER_TICK_MS';
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_SWEEPER_TICK_MS = 60_000;
const DEFAULT_BATCH = 20;

const state = {
  tickTimer: null,
  sweeperTimer: null,
  running: false,
  workerId: null
};

function parsePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function logSafe(event, fields = {}) {
  console.info(
    JSON.stringify({
      event,
      ts: new Date().toISOString(),
      workerId: state.workerId,
      ...fields
    })
  );
}

async function runProvisioningPass({ limit = DEFAULT_BATCH, stripe = null } = {}) {
  const due = await findDueUnprovisionedInstallments({ limit });
  const results = [];
  for (const row of due) {
    const claimed = await claimInstallmentForProvisioning({
      installmentId: row._id,
      workerId: state.workerId || `split-collection:${os.hostname()}`
    });
    if (!claimed) {
      results.push({ installmentId: String(row._id), skipped: true, reason: 'not_claimed' });
      continue;
    }
    try {
      const booking = await Booking.findById(claimed.bookingId);
      const outcome = await provisionInstallmentInvoice({
        installment: claimed,
        booking,
        stripe
      });
      results.push({
        installmentId: String(claimed._id),
        ok: true,
        skipped: outcome.skipped === true,
        reason: outcome.reason || null,
        invoiceId: outcome.invoice?.id || null
      });
    } catch (err) {
      const code = err?.code || err?.name || 'PROVISION_FAILED';
      if (claimed.provisioningState === 'provisioning') {
        const nextState =
          code === PROVISION_CODES.PAST_DUE ? 'past_due_needs_review' : 'failed';
        await BookingInstallment.updateOne(
          { _id: claimed._id },
          {
            $set: {
              provisioningState: nextState,
              provisioningClaimedBy: null,
              provisioningVisibilityTimeoutAt: null,
              lastFailureCode: String(code).slice(0, 120),
              lastFailureMessage: String(err.message || err).slice(0, 500)
            }
          }
        );
      }
      results.push({
        installmentId: String(claimed._id),
        ok: false,
        errorCode: code,
        message: err.message || String(err)
      });
      if (!(err instanceof SplitInvoiceProvisioningError)) {
        logSafe('split_collection_provision_unexpected_error', {
          installmentId: String(claimed._id),
          errorCode: code
        });
      }
    }
  }
  return results;
}

async function tickOnce({ stripe = null } = {}) {
  const provision = await runProvisioningPass({ stripe });
  const reminders = await processDueInstallmentReminders({ limit: DEFAULT_BATCH });
  const retryExhaustion = await reconcileRetryExhaustionCandidates({
    limit: DEFAULT_BATCH,
    stripe
  });
  const grace = await reconcileExpiredGraceInstallments({ limit: DEFAULT_BATCH });
  logSafe('split_collection_tick', {
    provisioned: provision.filter((r) => r.ok && !r.skipped).length,
    provisionErrors: provision.filter((r) => r.ok === false).length,
    remindersSent: reminders.filter((r) => r.sent).length,
    retryExhausted: retryExhaustion.filter((r) => r.outcome === 'retry_exhausted').length,
    graceOpened: grace.filter((r) => r.opened).length
  });
  return { provision, reminders, retryExhaustion, grace };
}

async function sweeperOnce() {
  const reclaimed = await reclaimStaleProvisioningClaims();
  logSafe('split_collection_sweeper', reclaimed);
  return reclaimed;
}

function startSplitPaymentCollectionWorkerIfEnabled({ stripe = null } = {}) {
  if (!featureFlags.isSplitPaymentCollectionWorkerEnabled()) {
    return { started: false, reason: 'flag_disabled' };
  }
  if (state.running) {
    return { started: false, reason: 'already_running' };
  }
  state.running = true;
  state.workerId = `split-collection:${os.hostname()}:${process.pid}`;
  const tickMs = parsePositiveIntEnv(ENV_TICK_MS, DEFAULT_TICK_MS);
  const sweeperMs = parsePositiveIntEnv(ENV_SWEEPER_TICK_MS, DEFAULT_SWEEPER_TICK_MS);

  const runTick = () => {
    tickOnce({ stripe }).catch((err) => {
      logSafe('split_collection_tick_error', { message: err.message || String(err) });
    });
  };
  const runSweeper = () => {
    sweeperOnce().catch((err) => {
      logSafe('split_collection_sweeper_error', { message: err.message || String(err) });
    });
  };

  state.tickTimer = setInterval(runTick, tickMs);
  state.sweeperTimer = setInterval(runSweeper, sweeperMs);
  if (typeof state.tickTimer.unref === 'function') state.tickTimer.unref();
  if (typeof state.sweeperTimer.unref === 'function') state.sweeperTimer.unref();

  runTick();
  logSafe('split_collection_worker_started', { tickMs, sweeperMs });
  return { started: true, workerId: state.workerId, tickMs, sweeperMs };
}

function stopSplitPaymentCollectionWorkerForTest() {
  if (state.tickTimer) clearInterval(state.tickTimer);
  if (state.sweeperTimer) clearInterval(state.sweeperTimer);
  state.tickTimer = null;
  state.sweeperTimer = null;
  state.running = false;
  state.workerId = null;
}

module.exports = {
  ENV_TICK_MS,
  ENV_SWEEPER_TICK_MS,
  DEFAULT_TICK_MS,
  DEFAULT_SWEEPER_TICK_MS,
  startSplitPaymentCollectionWorkerIfEnabled,
  stopSplitPaymentCollectionWorkerForTest,
  tickOnce,
  sweeperOnce,
  runProvisioningPass
};
