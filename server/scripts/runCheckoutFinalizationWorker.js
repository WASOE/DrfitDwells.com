#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the paid checkout finalization worker (Batch 5).
 *
 * PM2 pattern (mirrors runMessagingWorker / runOpsPushWorker):
 *   API process: FINALIZE_JOB_EXECUTE=0 (or unset)
 *   Worker PM2:  FINALIZE_JOB_EXECUTE=1 + node server/scripts/runCheckoutFinalizationWorker.js
 *
 * Atomic claim means API + worker can both enable the flag safely; prefer
 * one executor node in production.
 *
 * Batch 5 contract: finalize via finalizePaidCheckout only. No email send.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startCheckoutFinalizationWorkerIfEnabled,
  stopCheckoutFinalizationWorkerForTest
} = require('../services/checkout/checkoutFinalizationWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[checkout-finalization-worker-standalone] ${signal} received; stopping worker.`);
  try {
    stopCheckoutFinalizationWorkerForTest();
  } catch (err) {
    console.error(
      '[checkout-finalization-worker-standalone] stop error:',
      err?.message || err
    );
  }
  try {
    await mongoose.disconnect();
    console.log('[checkout-finalization-worker-standalone] mongoose disconnected.');
  } catch (err) {
    console.error(
      '[checkout-finalization-worker-standalone] disconnect error:',
      err?.message || err
    );
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[checkout-finalization-worker-standalone] mongoose connected.');

  const res = startCheckoutFinalizationWorkerIfEnabled();
  if (!res.started) {
    console.log(
      '[checkout-finalization-worker-standalone] FINALIZE_JOB_EXECUTE is not enabled; exiting cleanly.'
    );
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // Keep process alive for the timers.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(
    '[checkout-finalization-worker-standalone] fatal:',
    err?.stack || err?.message || err
  );
  process.exit(1);
});
