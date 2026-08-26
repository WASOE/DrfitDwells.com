'use strict';

/**
 * REBOOK-S1 CabinNightClaim controlled cutover CLI.
 *
 * S1.3: READ-ONLY VERIFY (default / --verify)
 * S1.4: --backfill INSERT-ONLY
 * S1.6: --create-unique-index (explicit, gated; does NOT enable writer authority)
 *
 * Usage:
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js --verify
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js --backfill
 *   cd server && node -r dotenv/config scripts/cabinNightClaimS1Cutover.js \
 *     --create-unique-index \
 *     --prior-fingerprint <hex> \
 *     --live-writers-verified
 *
 * CLI does NOT inspect PM2. --live-writers-verified is operator acknowledgement only.
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
const {
  runCabinNightClaimS1Backfill,
  normalizeBatchSize,
  REFUSE: BACKFILL_REFUSE
} = require('../services/inventory/cabinNightClaimS1BackfillService');
const {
  runCabinNightClaimS1UniqueIndexCutover,
  REFUSE: UNIQUE_REFUSE
} = require('../services/inventory/cabinNightClaimS1UniqueIndexCutoverService');

const REFUSE_CODE = 'NOT_IMPLEMENTED_IN_S1_3';

function parseArgs(argv) {
  const args = {
    verify: false,
    backfill: false,
    createUniqueIndex: false,
    liveWritersVerified: false,
    reportJson: null,
    priorFingerprint: null,
    batchSize: null,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--verify') args.verify = true;
    else if (a === '--backfill') args.backfill = true;
    else if (a === '--create-unique-index') args.createUniqueIndex = true;
    else if (a === '--live-writers-verified') args.liveWritersVerified = true;
    else if (a === '--report-json') args.reportJson = argv[++i];
    else if (a.startsWith('--report-json=')) args.reportJson = a.slice('--report-json='.length);
    else if (a === '--prior-fingerprint') args.priorFingerprint = argv[++i];
    else if (a.startsWith('--prior-fingerprint=')) {
      args.priorFingerprint = a.slice('--prior-fingerprint='.length);
    } else if (a === '--batch-size') args.batchSize = argv[++i];
    else if (a.startsWith('--batch-size=')) args.batchSize = a.slice('--batch-size='.length);
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

function buildRefusedReport({ mode, reason, refuseCode = REFUSE_CODE }) {
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
    refuseCode,
    toolFailure: false,
    samples: {},
    liveWriterProcessInspectedByCli: false
  };
}

/**
 * Exit codes:
 *   0 — successful verify / complete backfill / unique cutover success
 *   2 — deliberate refusal / incomplete / needsReview
 *   1 — tool/runtime failure
 */
function exitCodeForReport(report) {
  if (!report) return 1;
  if (report.toolFailure) return 1;
  if (report.refused) return 2;
  if (report.mode === 'create-unique-index') {
    if (report.needsReview) return 2;
    if (report.postVerificationClean === true && report.authoritativeUniqueExact === true) {
      return 0;
    }
    return 2;
  }
  if (report.mode === 'backfill') {
    if ((report.failed || 0) > 0) return 1;
    if ((report.foreignConflicts || 0) > 0) return 2;
    if ((report.stayChangeConflicts || 0) > 0) return 2;
    if (report.readyForStableVerification === true) return 0;
    return 2;
  }
  // verify / default: clean parity (incl. post-authority EXACT) OR pre-authority backfill-ready
  if (report.readyForStableVerification === true) return 0;
  if (report.readyForBackfill === true) return 0;
  return 2;
}

function emitDiag(event, payload = {}) {
  process.stderr.write(
    `${JSON.stringify({
      component: 'cabin_night_claim_s1_cutover',
      event,
      ...payload
    })}\n`
  );
}

async function withMongo(mongoUri, fn) {
  let connectedHere = false;
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri);
    connectedHere = true;
  }
  try {
    return await fn();
  } finally {
    if (connectedHere) {
      try {
        await mongoose.disconnect();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.backfill && args.createUniqueIndex) {
    const report = buildRefusedReport({
      mode: 'backfill',
      reason: 'Cannot combine --backfill with --create-unique-index',
      refuseCode: BACKFILL_REFUSE.INVALID_FLAG_COMBINATION
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return exitCodeForReport(report);
  }

  if (args.backfill && args.batchSize != null) {
    const norm = normalizeBatchSize(args.batchSize);
    if (!norm.ok) {
      const report = buildRefusedReport({
        mode: 'backfill',
        reason: norm.reason,
        refuseCode: BACKFILL_REFUSE.INVALID_BATCH_SIZE
      });
      process.stdout.write(`${JSON.stringify(report)}\n`);
      return exitCodeForReport(report);
    }
  }

  const mongoUri = args.mongoUri || DEFAULT_MONGO_URI;

  let report;
  try {
    report = await withMongo(mongoUri, async () => {
      if (args.createUniqueIndex) {
        emitDiag('unique_index_cutover_started', {
          liveWritersVerified: args.liveWritersVerified,
          priorFingerprintPresent: Boolean(args.priorFingerprint),
          note: 'CLI does not inspect PM2; --live-writers-verified is operator acknowledgement only'
        });
        const cutover = await runCabinNightClaimS1UniqueIndexCutover({
          priorFingerprint: args.priorFingerprint,
          liveWritersVerified: args.liveWritersVerified
        });
        emitDiag('unique_index_cutover_finished', {
          created: cutover.created,
          alreadyPresent: cutover.alreadyPresent,
          refused: cutover.refused,
          refuseCode: cutover.refuseCode,
          postVerificationClean: cutover.postVerificationClean,
          needsReview: cutover.needsReview
        });
        return {
          ...cutover,
          gitSha: resolveGitSha(),
          mongoVersion: await readMongoServerVersion(),
          liveWriterProcessInspectedByCli: false
        };
      }

      if (args.backfill) {
        emitDiag('backfill_started', {
          batchSize: args.batchSize != null ? Number(args.batchSize) : null
        });
        const backfill = await runCabinNightClaimS1Backfill({
          batchSize: args.batchSize
        });
        emitDiag('backfill_post_verify', {
          inserted: backfill.inserted,
          skippedAlreadyOwned: backfill.skippedAlreadyOwned,
          foreignConflicts: backfill.foreignConflicts,
          failed: backfill.failed,
          readyForStableVerification: backfill.readyForStableVerification,
          refused: backfill.refused
        });
        return {
          ...backfill,
          gitSha: resolveGitSha(),
          mongoVersion: await readMongoServerVersion()
        };
      }

      // Default / --verify: read-only
      const preflight = await runCabinNightClaimS1Preflight({
        priorFingerprint: args.priorFingerprint
      });
      return {
        ...preflight,
        gitSha: resolveGitSha(),
        mongoVersion: await readMongoServerVersion()
      };
    });
  } catch (err) {
    report = {
      mode: args.createUniqueIndex
        ? 'create-unique-index'
        : args.backfill
          ? 'backfill'
          : 'verify',
      cutoverBatch: CUTOVER_BATCH,
      scanCompleteness: 'failed',
      gitSha: resolveGitSha(),
      mongoVersion: null,
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
      samples: {},
      liveWriterProcessInspectedByCli: false
    };
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
  REFUSE_CODE,
  UNIQUE_REFUSE
};
