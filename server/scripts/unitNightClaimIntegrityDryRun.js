'use strict';

/**
 * Inventory Integrity I1 — READ-ONLY dry-run (shared I5 projection).
 *
 * Usage:
 *   cd server && node scripts/unitNightClaimIntegrityDryRun.js
 *   cd server && node scripts/unitNightClaimIntegrityDryRun.js --json
 *
 * Default mode NEVER writes UnitNightClaim or Booking documents.
 * Prefer unitNightClaimReconcile.js for I5 classify/apply/verify.
 */

const path = require('path');
const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const UnitNightClaim = require('../models/UnitNightClaim');
const {
  projectUnitNightClaimIntegrity,
  buildScanFilter
} = require('../services/inventory/unitNightClaimProjection');

function parseArgs(argv) {
  const args = {
    json: false,
    apply: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (const a of argv) {
    if (a === '--json') args.json = true;
    if (a === '--apply' || a === '--bootstrap') args.apply = true;
    if (a.startsWith('--mongo=')) args.mongoUri = a.slice('--mongo='.length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.apply) {
    console.error(
      '[unitNightClaimIntegrityDryRun] --apply/--bootstrap is NOT authorized here. Use unitNightClaimReconcile.js --apply-safe.'
    );
    process.exitCode = 2;
    return;
  }

  if (!args.mongoUri && !mongoose.connection.readyState) {
    if (require.main !== module) return;
  }

  let connectedHere = false;
  if (require.main === module) {
    if (!args.mongoUri) {
      console.error('MONGODB_URI / MONGO_URI required (or --mongo=...)');
      process.exitCode = 1;
      return;
    }
    await mongoose.connect(args.mongoUri);
    connectedHere = true;
  }

  try {
    const beforeClaims = await UnitNightClaim.countDocuments();
    const report = await projectUnitNightClaimIntegrity();
    const afterClaims = await UnitNightClaim.countDocuments();

    if (beforeClaims !== afterClaims) {
      throw new Error('Dry-run mutated UnitNightClaim collection unexpectedly');
    }

    report.claimCollectionCountUnchanged = true;
    report.unitNightClaimCount = afterClaims;

    if (args.json || require.main === module) {
      console.log(JSON.stringify(report, null, 2));
    }
    return report;
  } finally {
    if (connectedHere) {
      await mongoose.disconnect();
    }
  }
}

module.exports = {
  projectUnitNightClaimIntegrity,
  buildScanFilter,
  main
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
