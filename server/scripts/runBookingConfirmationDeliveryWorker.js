#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the booking-confirmation EmailDeliveryState backlog worker.
 *
 * PM2 pattern (mirrors gift-voucher / checkout finalization workers):
 *   API process: BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED=0 (or unset)
 *   Worker PM2:  BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED=1
 *                + node server/scripts/runBookingConfirmationDeliveryWorker.js
 *
 * Process name: driftdwells-confirmation-worker
 *
 * Does not create PaymentIntents, refunds, or bookings. Uses the existing
 * bookingConfirmationDeliveryService state machine only.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startBookingConfirmationDeliveryWorkerIfEnabled,
  stopBookingConfirmationDeliveryWorkerForTest
} = require('../services/email/bookingConfirmationDeliveryWorker');

let shuttingDown = false;

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
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[booking-confirmation-delivery-worker] mongoose connected.');

  const res = startBookingConfirmationDeliveryWorkerIfEnabled();
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

  console.log(
    JSON.stringify({
      event: 'booking_confirmation_worker_started',
      source: 'booking-confirmation-delivery-worker-standalone',
      workerId: res.workerId
    })
  );

  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });

  // Keep process alive for interval timers.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error(
    '[booking-confirmation-delivery-worker] fatal:',
    err?.stack || err?.message || err
  );
  process.exit(1);
});
