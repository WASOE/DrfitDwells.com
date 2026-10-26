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
 *
 * Import order (locked):
 *   1) loadServerEnv
 *   2) mongoose / dbDefaults
 *   3) worker module (transitively emailService) AFTER env
 */
'use strict';

const { loadServerEnv, isNonEmptyEnvValue } = require('../config/loadServerEnv');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');

const envLoad = loadServerEnv();

console.log(
  JSON.stringify({
    event: 'build_enquiry_email_worker_env_loaded',
    source: 'build-enquiry-email-worker-standalone',
    loaded: envLoad.loaded,
    missing: envLoad.missing,
    sourceKind: envLoad.source,
    keysLoaded: envLoad.keysLoaded,
    smtpHostPresent: envLoad.presence.smtpHostPresent,
    smtpUrlPresent: envLoad.presence.smtpUrlPresent,
    mongoUriPresent: envLoad.presence.mongoUriPresent,
    mongoUriSource: envLoad.presence.mongoUriSource
  })
);

const mongoose = require('mongoose');
const {
  startBuildEnquiryEmailWorkerIfEnabled,
  stopBuildEnquiryEmailWorkerForTest,
  BUILD_ENQUIRY_EMAIL_WORKER_ENV_FLAG
} = require('../services/buildEnquiries/buildEnquiryEmailWorker');

let shuttingDown = false;

function resolveMongoUri() {
  if (isNonEmptyEnvValue(process.env.MONGODB_URI)) {
    return { uri: String(process.env.MONGODB_URI).trim(), source: 'MONGODB_URI' };
  }
  if (isNonEmptyEnvValue(process.env.MONGO_URI)) {
    return { uri: String(process.env.MONGO_URI).trim(), source: 'MONGO_URI' };
  }
  return { uri: DEFAULT_MONGO_URI, source: 'default' };
}

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
  const nodeEnv = String(process.env.NODE_ENV || '');
  const mongo = resolveMongoUri();

  if (nodeEnv === 'production') {
    const allowDefault =
      String(process.env.ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION || '').trim() === '1';
    if (mongo.source === 'default' && !allowDefault) {
      console.error(
        JSON.stringify({
          event: 'build_enquiry_email_worker_fatal',
          reason: 'mongo_uri_missing_or_default',
          mongoUriSource: mongo.source
        })
      );
      process.exit(1);
      return;
    }
    if (mongo.uri === DEFAULT_MONGO_URI && !allowDefault) {
      console.error(
        JSON.stringify({
          event: 'build_enquiry_email_worker_fatal',
          reason: 'mongo_uri_is_dev_default'
        })
      );
      process.exit(1);
      return;
    }
  }

  await mongoose.connect(mongo.uri);
  console.log(
    JSON.stringify({
      source: 'build-enquiry-email-worker-standalone',
      event: 'mongoose_connected',
      mongoUriSource: mongo.source,
      ts: new Date().toISOString()
    })
  );

  const res = await startBuildEnquiryEmailWorkerIfEnabled();
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
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[build-enquiry-email-worker] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
