#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the messaging scheduler worker.
 *
 * Allows the worker to run as a separate PM2 process (`driftdwells-worker`)
 * without code changes once D-13's worker-split is desired:
 *
 *   API process: MESSAGE_SCHEDULER_WORKER_ENABLED=0  (or unset)
 *   Worker PM2:  MESSAGE_SCHEDULER_WORKER_ENABLED=1  +  node scripts/runMessagingWorker.js
 *
 * Atomic-claim safety means the API and the worker can both run with the
 * flag enabled without producing duplicate claims; the leader rule is
 * defence-in-depth, not the primary safety.
 *
 * Batch 6 contract: claim-only. No sends. No MessageDispatch writes.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startSchedulerWorkerIfEnabled,
  stopSchedulerWorkerForTest
} = require('../services/messaging/schedulerWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[messaging-worker-standalone] ${signal} received; stopping worker.`);
  try {
    stopSchedulerWorkerForTest();
  } catch (err) {
    console.error('[messaging-worker-standalone] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
    console.log('[messaging-worker-standalone] mongoose disconnected.');
  } catch (err) {
    console.error('[messaging-worker-standalone] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[messaging-worker-standalone] mongoose connected.');

  const res = startSchedulerWorkerIfEnabled();
  if (!res.started) {
    console.log(
      '[messaging-worker-standalone] MESSAGE_SCHEDULER_WORKER_ENABLED is not "1"; exiting cleanly.'
    );
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });

  // Keep process alive for the timers.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[messaging-worker-standalone] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
