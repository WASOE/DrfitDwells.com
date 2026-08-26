'use strict';

/**
 * REBOOK-S1.8 CabinNightClaim post-cutover reconciliation CLI.
 *
 * Usage:
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Reconcile.js
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Reconcile.js --verify
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Reconcile.js \
 *     --repair --apply-safe-repairs
 *
 * Default / --verify: ZERO Mongo writes.
 * Mutation requires BOTH --repair and --apply-safe-repairs.
 * Never creates/drops indexes. Never runs against production from this script
 * unless the operator intentionally points MONGO at production (separately authorized).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  runCabinNightClaimS1Reconciliation,
  exitCodeForReport
} = require('../services/inventory/cabinNightClaimS1ReconciliationService');

function parseArgs(argv) {
  const args = {
    verify: false,
    repair: false,
    applySafeRepairs: false,
    openMri: true,
    reportJson: null,
    batchSize: 200,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--verify') args.verify = true;
    else if (a === '--repair') args.repair = true;
    else if (a === '--apply-safe-repairs') args.applySafeRepairs = true;
    else if (a === '--no-mri') args.openMri = false;
    else if (a === '--report-json') args.reportJson = argv[++i];
    else if (a.startsWith('--report-json=')) args.reportJson = a.slice('--report-json='.length);
    else if (a === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (a.startsWith('--batch-size=')) args.batchSize = Number(a.slice('--batch-size='.length));
    else if (a.startsWith('--mongo=')) args.mongoUri = a.slice('--mongo='.length);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.repair && args.verify) {
    console.error('[cabinNightClaimS1Reconcile] Rejected: use either --verify or --repair');
    process.exitCode = 1;
    return null;
  }
  if (args.repair && !args.applySafeRepairs) {
    console.error(
      '[cabinNightClaimS1Reconcile] Rejected: --repair requires --apply-safe-repairs'
    );
    process.exitCode = 1;
    return null;
  }
  if (args.applySafeRepairs && !args.repair) {
    console.error(
      '[cabinNightClaimS1Reconcile] Rejected: --apply-safe-repairs requires --repair'
    );
    process.exitCode = 1;
    return null;
  }

  const mode = args.repair ? 'repair' : 'verify';

  let connectedHere = false;
  if (require.main === module) {
    const uri = args.mongoUri || DEFAULT_MONGO_URI;
    if (!uri) {
      console.error('MONGODB_URI / MONGO_URI required (or --mongo=...)');
      process.exitCode = 1;
      return null;
    }
    await mongoose.connect(uri);
    connectedHere = true;
  }

  try {
    const report = await runCabinNightClaimS1Reconciliation({
      mode,
      applySafeRepairs: args.applySafeRepairs,
      openMri: args.openMri,
      batchSize: args.batchSize
    });

    if (args.reportJson) {
      fs.writeFileSync(args.reportJson, JSON.stringify(report, null, 2), 'utf8');
    }

    if (require.main === module) {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = exitCodeForReport(report);
    }
    return report;
  } finally {
    if (connectedHere) {
      await mongoose.disconnect();
    }
  }
}

module.exports = {
  main,
  parseArgs
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
