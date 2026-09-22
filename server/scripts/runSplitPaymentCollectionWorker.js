#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone SP6 split-payment collection worker.
 *
 * Independent of SPLIT_PAYMENT_ENABLED — continues collecting existing obligations
 * even when new split sales are disabled.
 *
 *   SPLIT_PAYMENT_COLLECTION_WORKER_ENABLED=1
 *   node server/scripts/runSplitPaymentCollectionWorker.js
 */
'use strict';

const { loadServerEnv } = require('../config/loadServerEnv');
loadServerEnv();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startSplitPaymentCollectionWorkerIfEnabled,
  stopSplitPaymentCollectionWorkerForTest
} = require('../services/splitPaymentCollectionWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[split-payment-collection-worker] ${signal} received; stopping.`);
  try {
    stopSplitPaymentCollectionWorkerForTest();
  } catch (err) {
    console.error('[split-payment-collection-worker] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
  } catch (err) {
    console.error('[split-payment-collection-worker] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[split-payment-collection-worker] mongoose connected.');

  const started = startSplitPaymentCollectionWorkerIfEnabled();
  if (!started.started) {
    console.log(
      `[split-payment-collection-worker] not started (${started.reason}). Exiting.`
    );
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  console.log('[split-payment-collection-worker] running', started.workerId);
}

main().catch((err) => {
  console.error('[split-payment-collection-worker] fatal:', err?.message || err);
  process.exit(1);
});
