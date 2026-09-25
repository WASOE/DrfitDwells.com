#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
const { loadServerEnv } = require('../config/loadServerEnv');
const { loadWinterVillageCommercialReadiness } = require('../services/winterVillageCommercialReadinessService');

async function main() {
  loadServerEnv();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');
  await mongoose.connect(uri, { readPreference: 'primaryPreferred' });
  try {
    const result = await loadWinterVillageCommercialReadiness();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
