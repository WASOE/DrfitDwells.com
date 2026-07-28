#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch 7 — Paid checkout reconciliation CLI.
 *
 * Default: dry-run (no writes).
 * Mutations require BOTH:
 *   FINALIZE_RECONCILE_ENQUEUE=1
 *   --execute
 *
 * Examples:
 *   node server/scripts/reconcilePaidCheckoutFinalization.js --limit=20
 *   node server/scripts/reconcilePaidCheckoutFinalization.js --checkoutId=chk_...
 *   node server/scripts/reconcilePaidCheckoutFinalization.js --paymentIntentId=pi_...
 *   node server/scripts/reconcilePaidCheckoutFinalization.js --since=2026-07-01 --until=2026-07-28 --limit=50
 *   FINALIZE_RECONCILE_ENQUEUE=1 node server/scripts/reconcilePaidCheckoutFinalization.js --execute --checkoutId=chk_...
 *
 * Does not implement Batch 8 historical recovery.
 * Do not wire into server startup.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  reconcilePaidCheckoutFinalization,
  DEFAULT_LIMIT
} = require('../services/checkout/reconcilePaidCheckoutFinalization');

function printHelp() {
  console.log(`Usage: node server/scripts/reconcilePaidCheckoutFinalization.js [options]

Options:
  --dry-run                 No writes (default)
  --execute                 Apply safe repairs (requires FINALIZE_RECONCILE_ENQUEUE=1)
  --checkoutId=<id>         Filter to one checkout
  --paymentIntentId=<id>    Filter to one PaymentIntent
  --since=<ISO|YYYY-MM-DD>  Lower bound on createdAt
  --until=<ISO|YYYY-MM-DD>  Upper bound on createdAt
  --limit=<n>               Max subjects (default ${DEFAULT_LIMIT}, max 200)
  --help                    Show this help

Flags:
  FINALIZE_RECONCILE_ENQUEUE=1  Allow mutations when --execute is set (default off)
`);
}

function parseArgs(argv) {
  const out = {
    execute: false,
    dryRun: true,
    checkoutId: null,
    paymentIntentId: null,
    since: null,
    until: null,
    limit: DEFAULT_LIMIT,
    help: false
  };

  for (const token of argv.slice(2)) {
    if (token === '--help' || token === '-h') {
      out.help = true;
      continue;
    }
    if (token === '--execute' || token === '--apply') {
      out.execute = true;
      out.dryRun = false;
      continue;
    }
    if (token === '--dry-run') {
      out.execute = false;
      out.dryRun = true;
      continue;
    }
    if (token.startsWith('--checkoutId=')) {
      out.checkoutId = token.slice('--checkoutId='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--paymentIntentId=')) {
      out.paymentIntentId = token.slice('--paymentIntentId='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--since=')) {
      out.since = token.slice('--since='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--until=')) {
      out.until = token.slice('--until='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const n = parseInt(token.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) out.limit = n;
      continue;
    }
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    const summary = await reconcilePaidCheckoutFinalization({
      checkoutId: args.checkoutId,
      paymentIntentId: args.paymentIntentId,
      since: args.since,
      until: args.until,
      limit: args.limit,
      execute: args.execute
    });

    console.log(
      JSON.stringify(
        {
          ...summary,
          cli: {
            execute: args.execute,
            checkoutId: args.checkoutId,
            paymentIntentId: args.paymentIntentId,
            since: args.since,
            until: args.until,
            limit: args.limit
          }
        },
        null,
        2
      )
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: err?.message || String(err)
    })
  );
  process.exit(1);
});
