'use strict';

/**
 * I5 UnitNightClaim reconciliation CLI.
 *
 * Usage:
 *   cd server && node scripts/unitNightClaimReconcile.js
 *   cd server && node scripts/unitNightClaimReconcile.js --verify
 *   cd server && node scripts/unitNightClaimReconcile.js --apply-safe
 *   cd server && node scripts/unitNightClaimReconcile.js --booking-id <id>
 *   cd server && node scripts/unitNightClaimReconcile.js --report-json /tmp/i5.json
 *
 * Default / --verify: ZERO Mongo writes.
 * --apply-safe: explicit safe mutations (+ conflict MRI).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const {
  runUnitNightClaimReconciliation,
  exitCodeForReport
} = require('../services/inventory/unitNightClaimReconciliationService');

function parseArgs(argv) {
  const args = {
    applySafe: false,
    verify: false,
    bookingId: null,
    reportJson: null,
    batchSize: 200,
    limit: null,
    priorFingerprint: null,
    requireStable: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply-safe') args.applySafe = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--require-stable') args.requireStable = true;
    else if (a === '--booking-id') args.bookingId = argv[++i];
    else if (a.startsWith('--booking-id=')) args.bookingId = a.slice('--booking-id='.length);
    else if (a === '--report-json') args.reportJson = argv[++i];
    else if (a.startsWith('--report-json=')) args.reportJson = a.slice('--report-json='.length);
    else if (a === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (a.startsWith('--batch-size=')) args.batchSize = Number(a.slice('--batch-size='.length));
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice('--limit='.length));
    else if (a === '--prior-fingerprint') args.priorFingerprint = argv[++i];
    else if (a.startsWith('--prior-fingerprint=')) {
      args.priorFingerprint = a.slice('--prior-fingerprint='.length);
    } else if (a.startsWith('--mongo=')) args.mongoUri = a.slice('--mongo='.length);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.applySafe && args.limit != null) {
    console.error('[unitNightClaimReconcile] Rejected: --apply-safe cannot combine with --limit');
    process.exitCode = 1;
    return null;
  }
  if (args.applySafe && args.verify) {
    console.error('[unitNightClaimReconcile] Rejected: use either --apply-safe or --verify');
    process.exitCode = 1;
    return null;
  }

  let mode = 'classify';
  if (args.applySafe) mode = 'apply-safe';
  else if (args.verify) mode = 'verify';

  let connectedHere = false;
  if (require.main === module) {
    if (!args.mongoUri) {
      console.error('MONGODB_URI / MONGO_URI required (or --mongo=...)');
      process.exitCode = 1;
      return null;
    }
    await mongoose.connect(args.mongoUri);
    connectedHere = true;
  }

  try {
    const report = await runUnitNightClaimReconciliation({
      mode,
      bookingId: args.bookingId,
      batchSize: args.batchSize,
      limit: args.limit,
      priorFingerprint: args.priorFingerprint,
      requireStable: args.requireStable || Boolean(args.priorFingerprint)
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
