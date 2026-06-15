#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startOpsPushSchedulerWorkerIfEnabled,
  stopOpsPushSchedulerWorkerForTest
} = require('../services/ops/push/opsPushSchedulerWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[ops-push-worker-standalone] ${signal} received; stopping worker.`);
  try {
    stopOpsPushSchedulerWorkerForTest();
  } catch (err) {
    console.error('[ops-push-worker-standalone] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
    console.log('[ops-push-worker-standalone] mongoose disconnected.');
  } catch (err) {
    console.error('[ops-push-worker-standalone] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[ops-push-worker-standalone] connected to MongoDB.');

  const result = startOpsPushSchedulerWorkerIfEnabled();
  if (!result.started) {
    console.log('[ops-push-worker-standalone] worker not started (OPS_PUSH_SCHEDULER_WORKER_ENABLED != 1).');
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[ops-push-worker-standalone] fatal:', err?.message || err);
  process.exit(1);
});
