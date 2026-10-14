'use strict';

const path = require('path');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const {
  preflightCleaningRecordIndexes,
  applyCleaningRecordIndexMigration
} = require('../services/cleaning/cleaningRecordIndexMigration');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  if (argv.some((arg) => arg !== '--apply')) {
    throw new Error('Usage: node scripts/migrateCleaningRecordIndexes.cjs [--apply]');
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');

  await mongoose.connect(uri, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15000
  });

  try {
    const CleaningRecord = require('../models/CleaningRecord');
    const collection = CleaningRecord.collection;
    const preflight = await preflightCleaningRecordIndexes(collection);
    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      preflight
    }, null, 2));

    if (!preflight.safe) {
      process.exitCode = 1;
      return;
    }
    if (!apply) return;

    const result = await applyCleaningRecordIndexMigration(collection, preflight);
    console.log(JSON.stringify({ applied: true, ...result }));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`CleaningRecord index migration failed: ${err?.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
