#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the BuildEnquiry email retry worker.
 *
 * Process naming (PM2): driftdwells-build-enquiry-email-worker
 *
 *   API process: BUILD_ENQUIRY_EMAIL_WORKER_ENABLED=0 (or unset)
 *   Worker PM2:  BUILD_ENQUIRY_EMAIL_WORKER_ENABLED=1
 *                + node scripts/runBuildEnquiryEmailWorker.js
 *
 * Isolated from booking-confirmation and gift-voucher delivery workers.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startBuildEnquiryEmailWorkerIfEnabled,
  stopBuildEnquiryEmailWorkerForTest,
  BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG
} = require('../services/buildEnquiries/buildEnquiryEmailWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    JSON.stringify({
      source: 'build-enquiry-email-worker-standalone',
      event: 'shutdown',
      signal,
      ts: new Date().toISOString()
    })
  );
  try {
    await stopBuildEnquiryEmailWorkerForTest();
  } catch (err) {
    console.error('[build-enquiry-email-worker] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
    console.log('[build-enquiry-email-worker] mongoose disconnected.');
  } catch (err) {
    console.error('[build-enquiry-email-worker] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log(
    JSON.stringify({
      source: 'build-enquiry-email-worker-standalone',
      event: 'mongoose_connected',
      ts: new Date().toISOString()
    })
  );

  const res = startBuildEnquiryEmailWorkerIfEnabled();
  if (!res.started) {
    console.log(
      JSON.stringify({
        source: 'build-enquiry-email-worker-standalone',
        event: 'disabled_exit',
        flag: BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG,
        ts: new Date().toISOString()
      })
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

  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[build-enquiry-email-worker] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
