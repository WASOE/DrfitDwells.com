#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const { loadServerEnv } = require('../config/loadServerEnv');

loadServerEnv();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  reconcilePaidCheckoutFinalization
} = require('../services/checkout/reconcilePaidCheckoutFinalization');

const TICK_MS = positiveInt(process.env.PAID_CHECKOUT_RECONCILE_TICK_MS, 60_000);
const BATCH_SIZE = positiveInt(process.env.PAID_CHECKOUT_RECONCILE_BATCH_SIZE, 50);
let stopped = false;
let active = false;
let timer = null;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function reconcileOnce() {
  if (active || stopped) return;
  active = true;
  try {
    const summary = await reconcilePaidCheckoutFinalization({
      limit: BATCH_SIZE,
      execute: true,
      automatic: true
    });
    console.info(JSON.stringify({
      source: 'paid-checkout-reconciler',
      phase: 'tick_complete',
      scanned: summary.scanned,
      byClassification: summary.byClassification,
      dryRun: summary.dryRun
    }));
  } catch (err) {
    console.error(JSON.stringify({
      source: 'paid-checkout-reconciler',
      phase: 'tick_failed',
      error: err?.message || String(err)
    }));
  } finally {
    active = false;
    if (!stopped) timer = setTimeout(reconcileOnce, TICK_MS);
  }
}

async function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  console.info(`[paid-checkout-reconciler] ${signal} received; stopping.`);
  if (active) {
    await new Promise((resolve) => {
      const wait = setInterval(() => {
        if (!active) {
          clearInterval(wait);
          resolve();
        }
      }, 50);
    });
  }
  await mongoose.disconnect();
  process.exit(0);
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  console.info('[paid-checkout-reconciler] mongoose connected.');
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  await reconcileOnce();
}

main().catch((err) => {
  console.error('[paid-checkout-reconciler] fatal:', err?.stack || err?.message || err);
  process.exit(1);
});
