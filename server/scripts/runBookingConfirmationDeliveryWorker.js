#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the booking-confirmation EmailDeliveryState backlog worker.
 *
 * Process name: driftdwells-confirmation-worker
 *
 * Import order (locked):
 *   1) loadServerEnv
 *   2) mongoose / dbDefaults / release id
 *   3) worker module (transitively emailService) AFTER env
 */
'use strict';

const { loadServerEnv, resolveReleaseId, isNonEmptyEnvValue } = require('../config/loadServerEnv');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');

const envLoad = loadServerEnv();
const releaseId = resolveReleaseId(process.env);

console.log(
  JSON.stringify({
    event: 'booking_confirmation_worker_env_loaded',
    source: 'booking-confirmation-delivery-worker-standalone',
    loaded: envLoad.loaded,
    missing: envLoad.missing,
    sourceKind: envLoad.source,
    keysLoaded: envLoad.keysLoaded,
    smtpHostPresent: envLoad.presence.smtpHostPresent,
    smtpUrlPresent: envLoad.presence.smtpUrlPresent,
    mongoUriPresent: envLoad.presence.mongoUriPresent,
    mongoUriSource: envLoad.presence.mongoUriSource,
    emailDeliveryRequiredPresent: envLoad.presence.emailDeliveryRequiredPresent,
    releaseId
  })
);

const mongoose = require('mongoose');

// Deferred: email stack initializes only after env bootstrap.
const {
  startBookingConfirmationDeliveryWorkerIfEnabled,
  stopBookingConfirmationDeliveryWorkerForTest,
  setMongoConnectedForWorker,
  assertProductionWorkerConfigOrThrow,
  runSmtpVerificationOnce,
  isBookingConfirmationDeliveryReady
} = require('../services/email/bookingConfirmationDeliveryWorker');

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
      event: 'booking_confirmation_worker_stopped',
      source: 'booking-confirmation-delivery-worker-standalone',
      signal
    })
  );
  try {
    stopBookingConfirmationDeliveryWorkerForTest();
  } catch (err) {
    console.error(
      '[booking-confirmation-delivery-worker] stop error:',
      err?.message || err
    );
  }
  try {
    await mongoose.disconnect();
    console.log('[booking-confirmation-delivery-worker] mongoose disconnected.');
  } catch (err) {
    console.error(
      '[booking-confirmation-delivery-worker] disconnect error:',
      err?.message || err
    );
  } finally {
    process.exit(0);
  }
}

async function main() {
  const nodeEnv = String(process.env.NODE_ENV || '');
  const mongo = resolveMongoUri();

  if (nodeEnv === 'production') {
    if (mongo.source === 'default') {
      const allow =
        String(process.env.ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION || '').trim() === '1';
      if (!allow) {
        console.error(
          JSON.stringify({
            event: 'booking_confirmation_worker_fatal',
            reason: 'mongo_uri_missing_or_default',
            mongoUriSource: mongo.source
          })
        );
        process.exit(1);
        return;
      }
    }
    if (mongo.uri === DEFAULT_MONGO_URI) {
      const allow =
        String(process.env.ALLOW_DEFAULT_LOCAL_MONGO_IN_PRODUCTION || '').trim() === '1';
      if (!allow) {
        console.error(
          JSON.stringify({
            event: 'booking_confirmation_worker_fatal',
            reason: 'mongo_uri_is_dev_default'
          })
        );
        process.exit(1);
        return;
      }
    }
  }

  try {
    assertProductionWorkerConfigOrThrow({ nodeEnv });
  } catch (err) {
    if (err?.fatal) {
      console.error(
        JSON.stringify({
          event: 'booking_confirmation_worker_fatal',
          reason: err.code || 'config',
          message: err.message
        })
      );
      process.exit(1);
      return;
    }
    throw err;
  }

  await mongoose.connect(mongo.uri);
  setMongoConnectedForWorker(true);
  console.log(
    JSON.stringify({
      event: 'booking_confirmation_worker_mongo_connected',
      source: 'booking-confirmation-delivery-worker-standalone',
      mongoUriSource: mongo.source
    })
  );

  const res = startBookingConfirmationDeliveryWorkerIfEnabled({
    releaseId,
    mongoConnected: true,
    bootstrapCompleted: true,
    skipImmediateTick: true
  });

  if (!res.started) {
    console.log(
      JSON.stringify({
        event: 'booking_confirmation_worker_disabled',
        source: 'booking-confirmation-delivery-worker-standalone',
        reason: res.reason || 'flag_off'
      })
    );
    await mongoose.disconnect();
    process.exit(0);
    return;
  }

  // Initial verify before first claim tick.
  await runSmtpVerificationOnce({ reason: 'startup' });

  console.log(
    JSON.stringify({
      event: 'booking_confirmation_worker_started',
      source: 'booking-confirmation-delivery-worker-standalone',
      workerId: res.workerId,
      releaseId,
      ready: isBookingConfirmationDeliveryReady()
    })
  );

  // Drain immediately if ready after verify.
  if (isBookingConfirmationDeliveryReady()) {
    const {
      runConfirmationDeliveryTickOnce
    } = require('../services/email/bookingConfirmationDeliveryWorker');
    runConfirmationDeliveryTickOnce().catch((err) => {
      console.error(
        '[booking-confirmation-delivery-worker] initial tick error:',
        err?.message || err
      );
    });
  }

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
}

main().catch((err) => {
  console.error(
    '[booking-confirmation-delivery-worker] fatal:',
    err?.stack || err?.message || err
  );
  process.exit(1);
});
