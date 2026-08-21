'use strict';

/**
 * I6 UnitNightClaim authoritative unique-index cutover CLI.
 *
 * Usage:
 *   cd server && node scripts/unitNightClaimI6Cutover.js
 *   cd server && node scripts/unitNightClaimI6Cutover.js --verify
 *   cd server && node scripts/unitNightClaimI6Cutover.js --create-unique-index
 *   cd server && node scripts/unitNightClaimI6Cutover.js --report-json /tmp/i6.json
 *
 * Default / --verify: ZERO Mongo writes (read-only preflight).
 * --create-unique-index: create named unique index only when preflight is ready.
 * Never drops indexes, never syncIndexes, never mutates bookings/claims.
 */

try {
  // Optional — present in most ops environments; ignore if unavailable.
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config();
} catch (_) {
  // dotenv not installed
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const UnitNightClaim = require('../models/UnitNightClaim');
const { AUTHORITATIVE_UNIQUE_INDEX_SPEC } = require('../models/UnitNightClaim');
const {
  runUnitNightClaimReconciliation,
  precheckUniqueIndexDuplicates
} = require('../services/inventory/unitNightClaimReconciliationService');

const LEGACY_COMPOUND_NAME =
  AUTHORITATIVE_UNIQUE_INDEX_SPEC.legacyNonUniqueName || 'unitId_1_night_1';
const AUTHORITATIVE_NAME = AUTHORITATIVE_UNIQUE_INDEX_SPEC.options.name;
const AUTHORITATIVE_KEYS = AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys;

function parseArgs(argv) {
  const args = {
    createUniqueIndex: false,
    verify: false,
    reportJson: null,
    batchSize: 200,
    limit: null,
    bookingId: null,
    priorFingerprint: null,
    requireStable: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGO_URI || null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--create-unique-index') args.createUniqueIndex = true;
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

function sameIndexKeys(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function summarizeIndex(ix) {
  if (!ix) return null;
  return {
    name: ix.name,
    key: ix.key,
    unique: ix.unique === true
  };
}

function findIndexByName(indexes, name) {
  return (indexes || []).find((ix) => ix && ix.name === name) || null;
}

function isAuthoritativeUniqueExact(ix) {
  return (
    Boolean(ix) &&
    ix.name === AUTHORITATIVE_NAME &&
    sameIndexKeys(ix.key, AUTHORITATIVE_KEYS) &&
    ix.unique === true
  );
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

async function readExistingIndexes() {
  const indexes = await UnitNightClaim.collection.indexes();
  return indexes || [];
}

function mapCountsFromI5(i5Report) {
  const s = (i5Report && i5Report.summary) || {};
  return {
    expected: s.expectedUnitNightClaims || 0,
    actual: s.actualUnitNightClaimRows || 0,
    missing: s.missing || 0,
    stale: s.safeStale || 0,
    orphan: s.orphans || 0,
    wrongUnit: s.wrongUnit || 0,
    outsideRange: s.outsideRange || 0,
    sameOwnerDuplicates: s.sameOwnerDuplicates || 0,
    foreignOwnerDuplicates: s.foreignOwnerDuplicates || 0,
    duplicates: s.uniqueIndexDuplicateKeys || 0,
    canonicalCollisions: s.canonicalCollisions || 0,
    foreignClaimConflicts: s.foreignClaimConflicts || 0,
    claimsForSingleInventory: s.claimsForSingleInventory || 0,
    claimsForExcludedBooking: s.claimsForExcludedBooking || 0,
    malformedAllocations: s.malformedAllocations || 0,
    invalidAllocations: s.invalidAllocations || 0,
    unallocatedBlocking: s.unallocatedBlocking || 0,
    repairFailures: s.repairFailures || 0,
    remainingBlockers: s.remainingBlockers || 0,
    blockingBookingsScanned: s.blockingBookingsScanned || 0,
    validAllocatedMultiUnitBookings: s.validAllocatedMultiUnitBookings || 0
  };
}

function computeReadyForUniqueIndex({
  scanCompleteness,
  counts,
  duplicates,
  readyForI6,
  readyForI6Provisional,
  authoritativeUniqueExact
}) {
  // Already cut over with exact unique → ready (idempotent success path).
  if (authoritativeUniqueExact) return true;

  if (scanCompleteness !== 'full') return false;

  const dupCount = Array.isArray(duplicates) ? duplicates.length : Number(duplicates) || 0;
  const zeros =
    (counts.remainingBlockers || 0) === 0 &&
    (counts.duplicates || 0) === 0 &&
    dupCount === 0 &&
    (counts.missing || 0) === 0 &&
    (counts.stale || 0) === 0 &&
    (counts.orphan || 0) === 0 &&
    (counts.wrongUnit || 0) === 0 &&
    (counts.outsideRange || 0) === 0 &&
    (counts.sameOwnerDuplicates || 0) === 0 &&
    (counts.foreignOwnerDuplicates || 0) === 0 &&
    (counts.canonicalCollisions || 0) === 0 &&
    (counts.foreignClaimConflicts || 0) === 0 &&
    (counts.claimsForSingleInventory || 0) === 0 &&
    (counts.claimsForExcludedBooking || 0) === 0 &&
    (counts.malformedAllocations || 0) === 0 &&
    (counts.invalidAllocations || 0) === 0 &&
    (counts.repairFailures || 0) === 0;

  const i5Ready =
    readyForI6 === true || readyForI6Provisional === true || zeros;

  return Boolean(i5Ready && zeros);
}

function exitCodeForI6Report(report) {
  if (!report) return 1;
  if (report.toolFailure) return 1;
  if (report.refused) return 2;
  if (report.mode === 'create-unique-index') {
    if (report.indexCreate?.status === 'created' || report.indexCreate?.status === 'already-present') {
      return 0;
    }
    if (report.indexCreate?.status === 'failed') return 1;
    return 2;
  }
  // verify / default read-only
  if (report.readyForUniqueIndex === true) return 0;
  return 2;
}

async function buildPreflightReport({ mode, args }) {
  const i5Report = await runUnitNightClaimReconciliation({
    mode: 'verify',
    bookingId: args.bookingId,
    batchSize: args.batchSize,
    limit: args.limit,
    priorFingerprint: args.priorFingerprint,
    requireStable: args.requireStable || Boolean(args.priorFingerprint)
  });

  const existingIndexes = await readExistingIndexes();
  const legacyIx = findIndexByName(existingIndexes, LEGACY_COMPOUND_NAME);
  const authIx = findIndexByName(existingIndexes, AUTHORITATIVE_NAME);
  const authoritativeUniqueExact = isAuthoritativeUniqueExact(authIx);
  const authoritativeUniquePresent = Boolean(authIx) && authIx.unique === true;
  const legacyCompoundPresent = Boolean(legacyIx);

  let duplicates = Array.isArray(i5Report.uniqueIndexPrecheck)
    ? i5Report.uniqueIndexPrecheck
    : null;
  if (!duplicates) {
    duplicates = await precheckUniqueIndexDuplicates(UnitNightClaim);
  }

  const counts = mapCountsFromI5(i5Report);
  const scanCompleteness = i5Report.scanCompleteness;
  const readyForUniqueIndex = computeReadyForUniqueIndex({
    scanCompleteness,
    counts,
    duplicates,
    readyForI6: i5Report.readyForI6,
    readyForI6Provisional: i5Report.readyForI6Provisional,
    authoritativeUniqueExact
  });

  const mongoServerVersion = await readMongoServerVersion();
  const gitSha = resolveGitSha();

  return {
    mode,
    cutoverBatch: AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch || 'I6',
    scanCompleteness,
    readyForI6: i5Report.readyForI6 === true,
    readyForI6Provisional: i5Report.readyForI6Provisional === true,
    fingerprint: i5Report.fingerprint || null,
    counts,
    duplicates,
    existingIndexes: existingIndexes.map(summarizeIndex),
    legacyCompoundPresent,
    authoritativeUniquePresent,
    authoritativeUniqueExact,
    authoritativeIndexSpec: {
      name: AUTHORITATIVE_NAME,
      keys: { ...AUTHORITATIVE_KEYS },
      unique: true
    },
    readyForUniqueIndex,
    mongoServerVersion,
    gitSha,
    i5: {
      mode: i5Report.mode,
      passId: i5Report.passId,
      detectedAt: i5Report.detectedAt,
      stableVerification: i5Report.stableVerification || null,
      summary: i5Report.summary
    },
    refused: false,
    refuseReason: null,
    toolFailure: false,
    indexCreate: null
  };
}

async function createAuthoritativeUniqueIndex() {
  const name = await UnitNightClaim.collection.createIndex(
    { ...AUTHORITATIVE_KEYS },
    {
      unique: true,
      name: AUTHORITATIVE_NAME
    }
  );
  return name;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.createUniqueIndex && args.verify) {
    console.error('[unitNightClaimI6Cutover] Rejected: use either --create-unique-index or --verify');
    process.exitCode = 1;
    return null;
  }
  if (args.createUniqueIndex && args.limit != null) {
    console.error('[unitNightClaimI6Cutover] Rejected: --create-unique-index cannot combine with --limit');
    process.exitCode = 1;
    return null;
  }
  if (args.createUniqueIndex && args.bookingId) {
    console.error(
      '[unitNightClaimI6Cutover] Rejected: --create-unique-index cannot combine with --booking-id'
    );
    process.exitCode = 1;
    return null;
  }

  const mode = args.createUniqueIndex ? 'create-unique-index' : 'verify';

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
    const report = await buildPreflightReport({ mode, args });

    if (mode === 'create-unique-index') {
      // 4. Exact unique already present → idempotent PASS (no mutation).
      if (report.authoritativeUniqueExact) {
        report.indexCreate = {
          status: 'already-present',
          name: AUTHORITATIVE_NAME,
          mutated: false
        };
        report.readyForUniqueIndex = true;
      } else if (report.scanCompleteness !== 'full') {
        // 2. Refuse partial / targeted.
        report.refused = true;
        report.refuseReason = `scanCompleteness=${report.scanCompleteness}; full scan required`;
        report.readyForUniqueIndex = false;
      } else if (
        (report.counts.remainingBlockers || 0) > 0 ||
        (report.counts.duplicates || 0) > 0 ||
        (report.duplicates && report.duplicates.length > 0)
      ) {
        // 3. Refuse blockers / duplicates.
        report.refused = true;
        report.refuseReason = 'remaining blockers or duplicate {unitId,night} keys';
        report.readyForUniqueIndex = false;
      } else if (!report.readyForUniqueIndex) {
        // 1. Refuse if preflight not ready.
        report.refused = true;
        report.refuseReason = 'preflight not readyForUniqueIndex';
      } else if (report.authoritativeUniquePresent && !report.authoritativeUniqueExact) {
        // Named unique exists but metadata mismatch — do not drop/replace.
        report.refused = true;
        report.refuseReason =
          'authoritative unique name present but keys/unique metadata do not match exactly';
        report.toolFailure = true;
      } else {
        try {
          const createdName = await createAuthoritativeUniqueIndex();
          const afterIndexes = await readExistingIndexes();
          report.existingIndexes = afterIndexes.map(summarizeIndex);
          const afterAuth = findIndexByName(afterIndexes, AUTHORITATIVE_NAME);
          report.authoritativeUniquePresent = Boolean(afterAuth) && afterAuth.unique === true;
          report.authoritativeUniqueExact = isAuthoritativeUniqueExact(afterAuth);
          report.legacyCompoundPresent = Boolean(
            findIndexByName(afterIndexes, LEGACY_COMPOUND_NAME)
          );

          if (!report.authoritativeUniqueExact) {
            report.indexCreate = {
              status: 'failed',
              name: createdName || AUTHORITATIVE_NAME,
              mutated: true,
              reason: 'createIndex returned but post-verify name/keys/unique:true mismatch'
            };
            report.toolFailure = true;
            report.refused = true;
            report.refuseReason = report.indexCreate.reason;
          } else {
            report.indexCreate = {
              status: 'created',
              name: createdName || AUTHORITATIVE_NAME,
              mutated: true
            };
            report.readyForUniqueIndex = true;
          }
        } catch (err) {
          report.indexCreate = {
            status: 'failed',
            name: AUTHORITATIVE_NAME,
            mutated: false,
            reason: err && err.message ? String(err.message) : String(err)
          };
          report.toolFailure = true;
          report.refused = true;
          report.refuseReason = report.indexCreate.reason;
        }
      }
    }

    if (args.reportJson) {
      fs.writeFileSync(args.reportJson, JSON.stringify(report, null, 2), 'utf8');
    }

    if (require.main === module) {
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = exitCodeForI6Report(report);
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
  parseArgs,
  exitCodeForI6Report,
  computeReadyForUniqueIndex,
  isAuthoritativeUniqueExact,
  mapCountsFromI5,
  AUTHORITATIVE_UNIQUE_INDEX_SPEC
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
