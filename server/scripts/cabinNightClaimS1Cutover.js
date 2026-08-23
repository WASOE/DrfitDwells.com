'use strict';

/**
 * REBOOK-S1 CabinNightClaim controlled cutover CLI.
 *
 * S1.3: READ-ONLY VERIFY ONLY.
 *
 * Usage:
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js --verify
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js --report-json /tmp/s1.json
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js --prior-fingerprint <hex>
 *
 * Mutation flags (--backfill, --create-unique-index) are REFUSED in S1.3
 * with refuseCode NOT_IMPLEMENTED_IN_S1_3. No stubs that mutate.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  runCabinNightClaimS1Preflight,
  CUTOVER_BATCH
} = require('../services/inventory/cabinNightClaimS1PreflightService');

const REFUSE_CODE = 'NOT_IMPLEMENTED_IN_S1_3';

function parseArgs(argv) {
  const args = {
    verify: false,
    backfill: false,
    createUniqueIndex: false,
    reportJson: null,
    priorFingerprint: null,
    batchSize: 200,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--verify') args.verify = true;
    else if (a === '--backfill') args.backfill = true;
    else if (a === '--create-unique-index') args.createUniqueIndex = true;
    else if (a === '--report-json') args.reportJson = argv[++i];
    else if (a.startsWith('--report-json=')) args.reportJson = a.slice('--report-json='.length);
    else if (a === '--prior-fingerprint') args.priorFingerprint = argv[++i];
    else if (a.startsWith('--prior-fingerprint=')) {
      args.priorFingerprint = a.slice('--prior-fingerprint='.length);
    } else if (a === '--batch-size') args.batchSize = Number(argv[++i]);
    else if (a.startsWith('--batch-size=')) args.batchSize = Number(a.slice('--batch-size='.length));
    else if (a.startsWith('--mongo=')) args.mongoUri = a.slice('--mongo='.length);
  }
  return args;
}

function resolveGitSha() {
  const fromEnv =
    process.env.GIT_SHA ||
    process.env.SOURCE_VERSION ||
    process.env.HEROKU_SLUG_COMMIT ||
    process.env.COMMIT_SHA ||
    null;
  if (fromEnv) return String(fromEnv).trim() || null;
  try {
    return execSync('git rev-parse HEAD', {
      cwd: path.join(root, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {
    return null;
  }
}

async function readMongoServerVersion() {
  try {
    const info = await mongoose.connection.db.admin().command({ buildInfo: 1 });
    return info && info.version ? String(info.version) : null;
  } catch (_) {
    return null;
  }
}

function buildRefusedReport({ mode, reason }) {
  return {
    mode,
    cutoverBatch: CUTOVER_BATCH,
    scanCompleteness: 'none',
    gitSha: resolveGitSha(),
    mongoVersion: null,
    collectionExists: null,
    documentCount: null,
    existingIndexes: [],
    authoritativeUniquePresent: null,
    authoritativeUniqueExact: null,
    counts: {},
    remainingBlockers: {},
    provenanceCounts: {},
    writerReadiness: {},
    fingerprint: null,
    readyForBackfill: false,
    readyForStableVerification: false,
    readyForUniqueIndex: false,
    readyForUniqueIndexProvisional: false,
    refused: true,
    refuseReason: reason,
    refuseCode: REFUSE_CODE,
    toolFailure: false,
    samples: {}
  };
}

function exitCodeForReport(report) {
  if (!report) return 1;
  if (report.toolFailure) return 1;
  if (report.refused) return 2;
  if (report.readyForBackfill === true) return 0;
  return 2;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.backfill) {
    const report = buildRefusedReport({
      mode: 'backfill',
      reason: 'CabinNightClaim backfill is not implemented in S1.3 (authorized in S1.4)'
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return exitCodeForReport(report);
  }

  if (args.createUniqueIndex) {
    const report = buildRefusedReport({
      mode: 'create-unique-index',
      reason:
        'CabinNightClaim unique-index cutover is not implemented in S1.3 (authorized in S1.6)'
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return exitCodeForReport(report);
  }

  const mongoUri = args.mongoUri || DEFAULT_MONGO_URI;
  let connectedHere = false;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
    connectedHere = true;
  }

  let report;
  try {
    const preflight = await runCabinNightClaimS1Preflight({
      batchSize: args.batchSize,
      priorFingerprint: args.priorFingerprint
    });
    report = {
      ...preflight,
      gitSha: resolveGitSha(),
      mongoVersion: await readMongoServerVersion()
    };
  } catch (err) {
    report = {
      mode: 'verify',
      cutoverBatch: CUTOVER_BATCH,
      scanCompleteness: 'failed',
      gitSha: resolveGitSha(),
      mongoVersion: await readMongoServerVersion().catch(() => null),
      readyForBackfill: false,
      readyForStableVerification: false,
      readyForUniqueIndex: false,
      readyForUniqueIndexProvisional: false,
      refused: false,
      refuseReason: null,
      refuseCode: null,
      toolFailure: true,
      toolFailureMessage: err?.message || String(err),
      fingerprint: null,
      counts: {},
      samples: {}
    };
  } finally {
    if (connectedHere) {
      try {
        await mongoose.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
  }

  const json = `${JSON.stringify(report)}\n`;
  process.stdout.write(json);
  if (args.reportJson) {
    fs.writeFileSync(path.resolve(args.reportJson), json, 'utf8');
  }
  return exitCodeForReport(report);
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      process.stderr.write(
        `${JSON.stringify({
          event: 'cabin_night_claim_s1_cutover_fatal',
          message: err?.message || String(err)
        })}\n`
      );
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  main,
  exitCodeForReport,
  buildRefusedReport,
  REFUSE_CODE
};
