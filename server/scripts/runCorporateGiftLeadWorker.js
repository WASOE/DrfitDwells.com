#!/usr/bin/env node
'use strict';

const { loadServerEnv } = require('../config/loadServerEnv');
loadServerEnv();
const mongoose = require('mongoose');
const { retryDueDeliveries } = require('../services/corporateGiftLeads/service');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');
  await mongoose.connect(uri, { autoIndex: false });
  let stopping = false;
  let timer;
  async function tick() {
    try {
      await retryDueDeliveries();
    } catch (error) {
      console.error('[corporate-gift-leads-worker] tick failed', error.message);
    }
    if (!stopping) timer = setTimeout(tick, 60 * 1000);
  }
  const shutdown = async () => {
    stopping = true;
    clearTimeout(timer);
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await tick();
}

main().catch((error) => {
  console.error('[corporate-gift-leads-worker] fatal', error.message);
  process.exitCode = 1;
});
