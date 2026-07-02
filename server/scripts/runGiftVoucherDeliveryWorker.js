#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Standalone entrypoint for the gift voucher scheduled delivery worker.
 *
 *   API process: GIFT_VOUCHER_DELIVERY_WORKER_ENABLED=0 (or unset)
 *   Worker PM2:  GIFT_VOUCHER_DELIVERY_WORKER_ENABLED=1 + node scripts/runGiftVoucherDeliveryWorker.js
 *
 * Go-live order:
 *   1. Deploy worker with GIFT_VOUCHER_DELIVERY_WORKER_ENABLED=1, GIFT_VOUCHER_SCHEDULED_ENABLED=0
 *   2. Flip GIFT_VOUCHER_SCHEDULED_ENABLED=1 to accept scheduled purchases
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  startScheduledDeliveryWorkerIfEnabled,
  stopScheduledDeliveryWorkerForTest
} = require('../services/giftVouchers/giftVoucherScheduledDeliveryWorker');

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[gift-voucher-delivery-worker] ${signal} received; stopping worker.`);
  try {
    stopScheduledDeliveryWorkerForTest();
  } catch (err) {
    console.error('[gift-voucher-delivery-worker] stop error:', err?.message || err);
  }
  try {
    await mongoose.disconnect();
    console.log('[gift-voucher-delivery-worker] mongoose disconnected.');
  } catch (err) {
    console.error('[gift-voucher-delivery-worker] disconnect error:', err?.message || err);
  } finally {
    process.exit(0);
  }
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.log('[gift-voucher-delivery-worker] mongoose connected.');

  const res = startScheduledDeliveryWorkerIfEnabled();
  if (!res.started) {
    console.log(
      '[gift-voucher-delivery-worker] GIFT_VOUCHER_DELIVERY_WORKER_ENABLED is not "1"; exiting cleanly.'
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
  console.error('[gift-voucher-delivery-worker] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
