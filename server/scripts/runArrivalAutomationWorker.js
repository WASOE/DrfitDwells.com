#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Dedicated Arrival Automation V2 scheduler/dispatcher worker.
 *
 * Process-local flags (do not enable on the shared API process):
 *   ARRIVAL_AUTOMATION_WORKER_MODE=1          (always for this entrypoint)
 *   MESSAGE_DISPATCHER_ENABLED=0
 *   MESSAGE_ORCHESTRATOR_ENABLED=0
 *   ARRIVAL_EMAIL_V2=0|1                     (default 0 — park when off)
 *   ARRIVAL_AUTOMATION_V2=0|1                (default 0 — park when off)
 *   MESSAGE_SCHEDULER_WORKER_ENABLED=0|1     (default 0 — park when off)
 *   ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST=jose@driftdwells.com
 *     — required for active staff testing; omit only with
 *       ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS=1 after owner approval
 *
 * When any activation flag is OFF the process parks (no claim / no SMTP).
 * Active mode claims only Cabin/Valley T-3 jobs with arrivalAutomationV2 payload
 * and dispatches via arrivalAutoDispatchAdapter → sendArrivalEmailV2 (SMTP).
 *
 *   pm2 start ecosystem.config.cjs --only driftdwells-arrival-automation-worker --env production
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  assertArrivalWorkerEnv,
  ENV_WORKER_MODE
} = require('../services/messaging/arrival/arrivalWorkerClaimPolicy');
const {
  startSchedulerWorkerIfEnabled,
  stopSchedulerWorkerForTest,
  getSchedulerWorkerState
} = require('../services/messaging/schedulerWorker');

let shuttingDown = false;
let healthTimer = null;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[arrival-automation-worker] ${signal} received; stopping.`);
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  try {
    stopSchedulerWorkerForTest();
  } catch (err) {
    console.error('[arrival-automation-worker] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
    console.log('[arrival-automation-worker] mongoose disconnected.');
  } catch (err) {
    console.error('[arrival-automation-worker] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

function logHealth() {
  const s = getSchedulerWorkerState();
  console.log(
    JSON.stringify({
      source: 'arrival-automation-worker',
      phase: 'health',
      at: new Date().toISOString(),
      running: s.running,
      workerId: s.workerId,
      lastTickAt: s.lastTickAt,
      lastTickClaimedCount: s.lastTickClaimedCount,
      lastTickLostCount: s.lastTickLostCount,
      lastTickError: s.lastTickError,
      lastSweepAt: s.lastSweepAt,
      lastSweepRescheduledCount: s.lastSweepRescheduledCount,
      lastSweepFailedCount: s.lastSweepFailedCount,
      lastSweepError: s.lastSweepError
    })
  );
}

async function main() {
  // Force dedicated-worker mode even if dotenv omitted it.
  process.env[ENV_WORKER_MODE] = '1';

  let cfg;
  try {
    cfg = assertArrivalWorkerEnv(process.env);
  } catch (err) {
    console.error(`[arrival-automation-worker] refusing to start: ${err.message}`);
    process.exit(78);
    return;
  }

  console.log(
    JSON.stringify({
      source: 'arrival-automation-worker',
      phase: 'boot',
      dormant: Boolean(cfg.dormant),
      reason: cfg.reason || null,
      emailAllowlistSize: cfg.emailAllowlist ? cfg.emailAllowlist.size : 0,
      allowAllGuests: cfg.allowAllGuests,
      dispatcherEnabled: process.env.MESSAGE_DISPATCHER_ENABLED || null,
      orchestratorEnabled: process.env.MESSAGE_ORCHESTRATOR_ENABLED || null
    })
  );

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  if (cfg.dormant) {
    console.log(
      '[arrival-automation-worker] parked: activation OFF (no claim / no SMTP). ' +
        'Set ARRIVAL_EMAIL_V2=1 ARRIVAL_AUTOMATION_V2=1 MESSAGE_SCHEDULER_WORKER_ENABLED=1 to activate.'
    );
    // Keep process alive so PM2 does not thrash; never start the scheduler.
    setInterval(() => {}, 1 << 30);
    return;
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[arrival-automation-worker] mongoose connected.');

  const res = startSchedulerWorkerIfEnabled();
  if (!res.started) {
    console.error(
      '[arrival-automation-worker] MESSAGE_SCHEDULER_WORKER_ENABLED is not "1"; exiting.'
    );
    await mongoose.disconnect();
    process.exit(78);
    return;
  }

  healthTimer = setInterval(logHealth, 60_000);
  if (typeof healthTimer.unref === 'function') healthTimer.unref();
  logHealth();

  // Keep process alive for the timers.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[arrival-automation-worker] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
