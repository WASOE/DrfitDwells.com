'use strict';

/**
 * Dry-run by default:
 *   node server/scripts/purgeSavedBookingQuotes.cjs
 * Execute:
 *   node server/scripts/purgeSavedBookingQuotes.cjs --execute --batch-size=200
 * Cutoff override (ISO date):
 *   node server/scripts/purgeSavedBookingQuotes.cjs --cutoff=2026-01-01 --execute
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const { purgeSavedBookingQuotes } = require('../services/savedQuotes/savedQuoteRetentionService');

function parseArgs(argv) {
  const opts = { dryRun: true, batchSize: 200, cutoff: null };
  for (const arg of argv) {
    if (arg === '--execute') opts.dryRun = false;
    if (arg === '--dry-run') opts.dryRun = true;
    if (arg.startsWith('--batch-size=')) {
      opts.batchSize = Number.parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--cutoff=')) {
      opts.cutoff = arg.split('=')[1];
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const result = await purgeSavedBookingQuotes(opts);
    // Counts only — never log guest PII.
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[purgeSavedBookingQuotes] failed', err?.message || err);
  process.exit(1);
});
