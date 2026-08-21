'use strict';

/**
 * R1 StayChange safety-index cutover CLI.
 *
 * Owns BOTH required R1 indexes:
 *   A. StayChange kind+bookingId+idempotencyKey unique
 *   B. AuditEvent dedupeKey unique sparse
 *
 * Usage:
 *   cd server && node scripts/stayChangeR1Cutover.js
 *   cd server && node scripts/stayChangeR1Cutover.js --verify
 *   cd server && node scripts/stayChangeR1Cutover.js --create-indexes
 *
 * Default / --verify: ZERO Mongo writes (read-only).
 * --create-indexes: create exact approved unique indexes only when ready.
 * Never drops indexes, never mutates StayChange/Booking/UnitNightClaim/AuditEvent documents.
 */

try {
  // eslint-disable-next-line global-require, import/no-extraneous-dependencies
  require('dotenv').config();
} catch (_) {
  /* optional */
}

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
process.chdir(root);

const mongoose = require('mongoose');
const StayChange = require('../models/StayChange');
const { IDEMPOTENCY_UNIQUE_INDEX_SPEC } = require('../models/StayChange');
const AuditEvent = require('../models/AuditEvent');
const { AUDIT_DEDUPE_INDEX_SPEC } = require('../models/AuditEvent');
const {
  indexExact,
  assertStayChangeIdempotencyIndex,
  ensureR1IndexesForTests
} = require('../services/stayChange/stayChangeIndexes');

function parseArgs(argv) {
  const args = {
    createIndexes: false,
    verify: false,
    reportJson: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--create-indexes') args.createIndexes = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--report-json') {
      args.reportJson = argv[i + 1] || null;
      i += 1;
    }
  }
  return args;
}

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: path.join(root, '..'), encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function countIdempotencyDuplicates() {
  return StayChange.aggregate([
    {
      $group: {
        _id: { kind: '$kind', bookingId: '$bookingId', idempotencyKey: '$idempotencyKey' },
        n: { $sum: 1 }
      }
    },
    { $match: { n: { $gt: 1 } } },
    { $limit: 50 }
  ]);
}

async function countAuditDedupeDuplicates() {
  return AuditEvent.aggregate([
    { $match: { dedupeKey: { $type: 'string', $ne: null } } },
    { $group: { _id: '$dedupeKey', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 50 }
  ]);
}

async function buildReport() {
  const collNames = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
  const stayColl = StayChange.collection.collectionName;
  const auditColl = AuditEvent.collection.collectionName;
  const collectionExists = collNames.includes(stayColl);
  const auditCollectionExists = collNames.includes(auditColl);
  const documentCount = collectionExists ? await StayChange.countDocuments() : 0;
  const duplicates = collectionExists ? await countIdempotencyDuplicates() : [];
  const auditDedupeDuplicates = auditCollectionExists ? await countAuditDedupeDuplicates() : [];
  const stayIndexes = collectionExists ? await StayChange.collection.indexes() : [];
  const auditIndexes = auditCollectionExists ? await AuditEvent.collection.indexes() : [];

  const idem = indexExact(stayIndexes, IDEMPOTENCY_UNIQUE_INDEX_SPEC);
  const audit = indexExact(auditIndexes, AUDIT_DEDUPE_INDEX_SPEC);

  const readyForR1 =
    idem.exact === true &&
    audit.exact === true &&
    duplicates.length === 0 &&
    auditDedupeDuplicates.length === 0;

  return {
    scanCompleteness: 'full',
    gitSha: gitSha(),
    mongoVersion: (await mongoose.connection.db.admin().serverInfo()).version,
    collectionExists,
    auditCollectionExists,
    documentCount,
    duplicateScopedIdempotencyKeys: duplicates.length,
    duplicateSamples: duplicates.slice(0, 10),
    duplicateAuditDedupeKeys: auditDedupeDuplicates.length,
    duplicateAuditDedupeSamples: auditDedupeDuplicates.slice(0, 10),
    indexes: {
      stayChange: stayIndexes.map((i) => ({ name: i.name, unique: !!i.unique, key: i.key })),
      auditEvent: auditIndexes.map((i) => ({
        name: i.name,
        unique: !!i.unique,
        key: i.key,
        sparse: !!i.sparse
      }))
    },
    requiredIdempotencyUniquePresent: idem.present,
    requiredIdempotencyUniqueExact: idem.exact,
    requiredAuditDedupeUniquePresent: audit.present,
    requiredAuditDedupeUniqueExact: audit.exact,
    readyForR1,
    specs: {
      idempotency: IDEMPOTENCY_UNIQUE_INDEX_SPEC,
      auditDedupe: AUDIT_DEDUPE_INDEX_SPEC
    }
  };
}

async function createIndexes(report) {
  if (report.duplicateScopedIdempotencyKeys > 0) {
    throw new Error('Refusing --create-indexes: duplicate scoped StayChange idempotency keys exist');
  }
  if (report.duplicateAuditDedupeKeys > 0) {
    throw new Error('Refusing --create-indexes: duplicate non-null AuditEvent dedupeKey values exist');
  }
  if (report.requiredIdempotencyUniquePresent && !report.requiredIdempotencyUniqueExact) {
    throw new Error(
      'Refusing --create-indexes: StayChange idempotency index present but inexact (will not drop/replace)'
    );
  }
  if (report.requiredAuditDedupeUniquePresent && !report.requiredAuditDedupeUniqueExact) {
    throw new Error(
      'Refusing --create-indexes: AuditEvent dedupe index present but inexact (will not drop/replace)'
    );
  }
  if (!report.requiredIdempotencyUniqueExact) {
    await StayChange.collection.createIndex(
      IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys,
      { ...IDEMPOTENCY_UNIQUE_INDEX_SPEC.options }
    );
  }
  if (!report.requiredAuditDedupeUniqueExact) {
    await AuditEvent.collection.createIndex(
      AUDIT_DEDUPE_INDEX_SPEC.keys,
      { ...AUDIT_DEDUPE_INDEX_SPEC.options }
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.createIndexes && args.verify) {
    console.error('Rejected flag combination: --create-indexes with --verify');
    process.exitCode = 1;
    return null;
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri && mongoose.connection.readyState !== 1) {
    console.error('MONGODB_URI required');
    process.exitCode = 1;
    return null;
  }
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  }

  let report = await buildReport();
  if (args.createIndexes) {
    await createIndexes(report);
    report = await buildReport();
    report.mutation = 'create-indexes';
  } else {
    report.mutation = 'none';
  }

  if (args.reportJson) {
    fs.writeFileSync(args.reportJson, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));

  if (args.createIndexes && !report.readyForR1) {
    process.exitCode = 2;
  }
  return report;
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (require.main === module && mongoose.connection.readyState === 1) {
        await mongoose.disconnect().catch(() => {});
      }
    });
}

module.exports = {
  main,
  parseArgs,
  buildReport,
  createIndexes,
  ensureR1IndexesForTests,
  assertStayChangeIdempotencyIndex,
  IDEMPOTENCY_UNIQUE_INDEX_SPEC,
  AUDIT_DEDUPE_INDEX_SPEC
};
