#!/usr/bin/env node
'use strict';

/**
 * Cabin priority-list email retry worker (bounded, explicit enablement).
 * Sends only guests with active consent; never emails historical subscribers.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const CabinPriorityList = require('../models/CabinPriorityList');
const {
  MAX_ATTEMPTS,
  deliverGuestEmail,
  deliverAdminEmail
} = require('../services/cabinPriorityList/deliveryService');

const ENV_FLAG = 'CABIN_PRIORITY_EMAIL_WORKER_ENABLED';
const TICK_MS = 60_000;
const BATCH = 20;

function enabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function dueClause(field, now) {
  return {
    [`${field}.status`]: { $in: ['pending', 'failed'] },
    [`${field}.attempts`]: { $lt: MAX_ATTEMPTS },
    $or: [
      { [`${field}.nextAttemptAt`]: null },
      { [`${field}.nextAttemptAt`]: { $exists: false } },
      { [`${field}.nextAttemptAt`]: { $lte: now } }
    ]
  };
}

async function runOnce() {
  const now = new Date();
  const candidates = await CabinPriorityList.find({
    $or: [dueClause('guestEmail', now), dueClause('emailDelivery', now)]
  })
    .select('_id guestEmail.status emailDelivery.status')
    .limit(BATCH)
    .lean();

  let guest = 0;
  let admin = 0;
  for (const row of candidates) {
    if (row.guestEmail?.status === 'pending' || row.guestEmail?.status === 'failed') {
      const result = await deliverGuestEmail(row._id);
      if (result.status === 'sent') guest += 1;
    }
    if (row.emailDelivery?.status === 'pending' || row.emailDelivery?.status === 'failed') {
      const result = await deliverAdminEmail(row._id);
      if (result.status === 'sent') admin += 1;
    }
  }
  return { scanned: candidates.length, guestSent: guest, adminSent: admin };
}

async function main() {
  if (!enabled()) {
    console.log(`[cabin-priority-email-worker] disabled (${ENV_FLAG} != 1)`);
    process.exit(0);
  }
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri);
  console.log('[cabin-priority-email-worker] connected; interval 60s');
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runOnce();
      if (result.scanned) console.log('[cabin-priority-email-worker] tick', JSON.stringify(result));
    } catch (error) {
      console.error('[cabin-priority-email-worker] tick failed', error?.message || error);
    } finally {
      running = false;
    }
  };
  await tick();
  const timer = setInterval(tick, TICK_MS);
  const shutdown = async () => {
    clearInterval(timer);
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[cabin-priority-email-worker] fatal', error?.message || error);
    process.exit(1);
  });
}

module.exports = { runOnce, enabled, dueClause };
