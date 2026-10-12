#!/usr/bin/env node
'use strict';

require('dotenv').config();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const { applyManualBlockConversionIndex } = require('../services/ops/domain/manualBlockConversionIndexService');

async function run({ apply = process.argv.includes('--apply') } = {}) {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  try {
    const report = await applyManualBlockConversionIndex({ collection: Booking.collection, apply });
    console.log(JSON.stringify(report));
    return report;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[manual-block-conversion-index] ${error?.message || 'failed'}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
