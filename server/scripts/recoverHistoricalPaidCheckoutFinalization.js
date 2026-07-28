#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Batch 8 — Controlled historical paid-checkout recovery CLI.
 *
 * Built on Batch 7 reconcilePaidCheckoutSubject. Allowlist-only. No unbounded scan.
 *
 * Dry-run (default):
 *   node server/scripts/recoverHistoricalPaidCheckoutFinalization.js \
 *     --allowlist=docs/checkout-payment-architecture/examples/historical-recovery-allowlist.example.json
 *
 * Execute (all three required):
 *   FINALIZE_RECONCILE_HISTORICAL=1 node server/scripts/recoverHistoricalPaidCheckoutFinalization.js \
 *     --execute \
 *     --allowlist=/secure/path/ops-approved-allowlist.json \
 *     --limit=25
 *
 * Resume:
 *   ... --offset=25 --limit=25
 *   ... --checkpoint=/tmp/historical-recovery.checkpoint.json
 *
 * Docs: docs/checkout-payment-architecture/03_HISTORICAL_RECOVERY_CLI.md
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  recoverHistoricalPaidCheckouts,
  HistoricalRecoveryError,
  DEFAULT_HISTORICAL_LIMIT
} = require('../services/checkout/historicalPaidCheckoutRecovery');

function printHelp() {
  console.log(`Usage: node server/scripts/recoverHistoricalPaidCheckoutFinalization.js --allowlist=<file> [options]

Required:
  --allowlist=<file>   JSON array of { checkoutId?, paymentIntentId?, reason? }
                       At least one of checkoutId / paymentIntentId per row.

Options:
  --dry-run            No writes (default)
  --execute            Apply safe repairs (requires FINALIZE_RECONCILE_HISTORICAL=1)
  --limit=<n>          Max allowlist entries this run (default ${DEFAULT_HISTORICAL_LIMIT}, max 200)
  --offset=<n>         Skip first N validated allowlist entries (resume)
  --checkpoint=<file>  Write nextOffset checkpoint JSON after the run
  --report=<file>      Write full redacted JSON report to file (also prints summary)
  --help               Show this help

Flags:
  FINALIZE_RECONCILE_HISTORICAL=1  Required together with --execute for mutations

Hard bans:
  no refunds, no PaymentIntent create/replace, no ambiguous email resend,
  no gift voucher / location recovery, no unbounded historical scan,
  no inventing missing hashes/checkout data.

See: docs/checkout-payment-architecture/03_HISTORICAL_RECOVERY_CLI.md
`);
}

function parseArgs(argv) {
  const out = {
    execute: false,
    allowlist: null,
    limit: DEFAULT_HISTORICAL_LIMIT,
    offset: 0,
    checkpoint: null,
    report: null,
    help: false
  };

  for (const token of argv.slice(2)) {
    if (token === '--help' || token === '-h') {
      out.help = true;
      continue;
    }
    if (token === '--execute' || token === '--apply') {
      out.execute = true;
      continue;
    }
    if (token === '--dry-run') {
      out.execute = false;
      continue;
    }
    if (token.startsWith('--allowlist=')) {
      out.allowlist = token.slice('--allowlist='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--limit=')) {
      const n = parseInt(token.split('=')[1], 10);
      if (Number.isFinite(n) && n > 0) out.limit = n;
      continue;
    }
    if (token.startsWith('--offset=')) {
      const n = parseInt(token.split('=')[1], 10);
      if (Number.isFinite(n) && n >= 0) out.offset = n;
      continue;
    }
    if (token.startsWith('--checkpoint=')) {
      out.checkpoint = token.slice('--checkpoint='.length).trim() || null;
      continue;
    }
    if (token.startsWith('--report=')) {
      out.report = token.slice('--report='.length).trim() || null;
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
    const summary = await recoverHistoricalPaidCheckouts({
      allowlistPath: args.allowlist,
      execute: args.execute,
      limit: args.limit,
      offset: args.offset,
      checkpointPath: args.checkpoint
    });

    if (args.report) {
      const reportPath = path.resolve(args.report);
      fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      summary.reportPath = reportPath;
    }

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    if (err instanceof HistoricalRecoveryError) {
      console.error(
        JSON.stringify(
          {
            ok: false,
            code: err.code,
            error: err.message,
            details: err.details || null
          },
          null,
          2
        )
      );
      process.exit(2);
    }
    throw err;
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
