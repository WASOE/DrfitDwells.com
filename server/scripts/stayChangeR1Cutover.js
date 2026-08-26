'use strict';

/**
 * R1 StayChange safety-index cutover CLI.
 *
 * Owns BOTH required R1 indexes:
 *   A. StayChange kind+bookingId+idempotencyKey unique
 *   B. AuditEvent dedupeKey unique PARTIAL (string values only)
 *
 * Usage:
 *   cd server && node scripts/stayChangeR1Cutover.js
 *   cd server && node scripts/stayChangeR1Cutover.js --verify
 *   cd server && node scripts/stayChangeR1Cutover.js --create-indexes
 *   cd server && node scripts/stayChangeR1Cutover.js --replace-audit-dedupe-index
 *
 * Default / --verify: ZERO Mongo writes (read-only).
 * --create-indexes: create missing exact indexes; refuses unexpected inexact;
 *   refuses legacy sparse audit index without --replace-audit-dedupe-index.
 * --replace-audit-dedupe-index: drop+create AuditEvent dedupe index only
 *   (legacy sparse/nonpartial → desired partial). Requires no string-key duplicates.
 *
 * Never mutates StayChange/Booking/UnitNightClaim/AuditEvent documents.
 *
 * Production cutover for AuditEvent null-collision hotfix:
 *   1. --verify (confirm legacy_sparse_unique / classify counts)
 *   2. Briefly pause API processes that write AuditEvents (recommended)
 *   3. --replace-audit-dedupe-index
 *   4. --verify (readyForR1 / desired_partial)
 *   5. Resume API
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
  classifyAuditDedupeIndex,
  assertStayChangeIdempotencyIndex,
  ensureR1IndexesForTests,
  dropIndexIfExists
} = require('../services/stayChange/stayChangeIndexes');

function parseArgs(argv) {
  const args = {
    createIndexes: false,
    verify: false,
    replaceAuditDedupeIndex: false,
    reportJson: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--create-indexes') args.createIndexes = true;
    else if (a === '--verify') args.verify = true;
    else if (a === '--replace-audit-dedupe-index') args.replaceAuditDedupeIndex = true;
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
    { $match: { dedupeKey: { $type: 'string' } } },
    { $group: { _id: '$dedupeKey', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 50 }
  ]);
}

async function classifyAuditDedupeDocuments() {
  const coll = AuditEvent.collection;
  const total = await coll.countDocuments();
  const missing = await coll.countDocuments({ dedupeKey: { $exists: false } });
  const nullVal = await coll.countDocuments({ dedupeKey: { $type: 'null' } });
  const stringVal = await coll.countDocuments({ dedupeKey: { $type: 'string' } });
  const emptyString = await coll.countDocuments({ dedupeKey: '' });
  const invalidTyped = await coll.countDocuments({
    dedupeKey: {
      $exists: true,
      $nin: [null],
      $not: { $type: 'string' }
    }
  });
  return {
    total,
    missingDedupeKey: missing,
    nullDedupeKey: nullVal,
    stringDedupeKey: stringVal,
    emptyStringDedupeKey: emptyString,
    invalidTypedDedupeKey: invalidTyped
  };
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
  const auditClass = classifyAuditDedupeIndex(auditIndexes);
  const auditDocClass = auditCollectionExists
    ? await classifyAuditDedupeDocuments()
    : {
        total: 0,
        missingDedupeKey: 0,
        nullDedupeKey: 0,
        stringDedupeKey: 0,
        emptyStringDedupeKey: 0,
        invalidTypedDedupeKey: 0
      };

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
    auditDedupeDocumentClassification: auditDocClass,
    auditDedupeIndexKind: auditClass.kind,
    indexes: {
      stayChange: stayIndexes.map((i) => ({ name: i.name, unique: !!i.unique, key: i.key })),
      auditEvent: auditIndexes.map((i) => ({
        name: i.name,
        unique: !!i.unique,
        key: i.key,
        sparse: !!i.sparse,
        partialFilterExpression: i.partialFilterExpression || null
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
    },
    productionNotes: {
      auditNullCollision:
        'legacy_sparse_unique indexes explicit null; appendAuditEvent historically wrote null → E11000 on second null event',
      replaceRequiresWriterPause:
        'Recommended: pause AuditEvent writers during --replace-audit-dedupe-index (drop then create same name)',
      noDocumentMutation: true
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
    if (
      report.auditDedupeIndexKind === 'legacy_sparse_unique' ||
      report.auditDedupeIndexKind === 'legacy_nonpartial_unique'
    ) {
      throw new Error(
        'Refusing --create-indexes: AuditEvent dedupe index is legacy unique (sparse/nonpartial). ' +
          'Use --replace-audit-dedupe-index after --verify (brief AuditEvent writer pause recommended).'
      );
    }
    throw new Error(
      'Refusing --create-indexes: AuditEvent dedupe index present but unexpected/inexact (will not drop/replace)'
    );
  }
  if (!report.requiredIdempotencyUniqueExact) {
    await StayChange.collection.createIndex(IDEMPOTENCY_UNIQUE_INDEX_SPEC.keys, {
      ...IDEMPOTENCY_UNIQUE_INDEX_SPEC.options
    });
  }
  if (!report.requiredAuditDedupeUniqueExact) {
    await AuditEvent.collection.createIndex(AUDIT_DEDUPE_INDEX_SPEC.keys, {
      ...AUDIT_DEDUPE_INDEX_SPEC.options
    });
  }
}

/**
 * Replace legacy/broken AuditEvent dedupe unique with desired partial unique.
 * Does not mutate AuditEvent documents. Drop+create under same index name.
 */
async function replaceAuditDedupeIndex(report) {
  if (report.duplicateAuditDedupeKeys > 0) {
    throw new Error(
      'Refusing --replace-audit-dedupe-index: duplicate string AuditEvent dedupeKey values exist'
    );
  }
  if (report.auditDedupeDocumentClassification?.invalidTypedDedupeKey > 0) {
    throw new Error(
      'Refusing --replace-audit-dedupe-index: invalid typed dedupeKey values exist (manual review)'
    );
  }
  if (report.requiredAuditDedupeUniqueExact) {
    return { skipped: true, reason: 'already_desired_partial' };
  }
  const kind = report.auditDedupeIndexKind;
  if (kind === 'unexpected') {
    throw new Error(
      'Refusing --replace-audit-dedupe-index: unexpected AuditEvent dedupe index state (manual review)'
    );
  }
  if (kind !== 'missing' && kind !== 'legacy_sparse_unique' && kind !== 'legacy_nonpartial_unique') {
    throw new Error(
      `Refusing --replace-audit-dedupe-index: unsupported auditDedupeIndexKind=${kind}`
    );
  }

  const name = AUDIT_DEDUPE_INDEX_SPEC.options.name;
  await dropIndexIfExists(AuditEvent.collection, name);
  await AuditEvent.collection.createIndex(AUDIT_DEDUPE_INDEX_SPEC.keys, {
    ...AUDIT_DEDUPE_INDEX_SPEC.options
  });
  return { skipped: false, replaced: true, from: kind, to: 'desired_partial' };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const mutationFlags = [args.createIndexes, args.replaceAuditDedupeIndex].filter(Boolean).length;
  if (args.verify && mutationFlags > 0) {
    console.error('Rejected flag combination: --verify with mutation flags');
    process.exitCode = 1;
    return null;
  }
  if (args.createIndexes && args.replaceAuditDedupeIndex) {
    console.error('Rejected flag combination: --create-indexes with --replace-audit-dedupe-index');
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
  if (args.replaceAuditDedupeIndex) {
    const result = await replaceAuditDedupeIndex(report);
    report = await buildReport();
    report.mutation = 'replace-audit-dedupe-index';
    report.replaceResult = result;
  } else if (args.createIndexes) {
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

  if (
    (args.createIndexes || args.replaceAuditDedupeIndex) &&
    args.replaceAuditDedupeIndex &&
    !report.requiredAuditDedupeUniqueExact
  ) {
    process.exitCode = 2;
  } else if (args.createIndexes && !report.readyForR1) {
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
  replaceAuditDedupeIndex,
  classifyAuditDedupeDocuments,
  ensureR1IndexesForTests,
  assertStayChangeIdempotencyIndex,
  IDEMPOTENCY_UNIQUE_INDEX_SPEC,
  AUDIT_DEDUPE_INDEX_SPEC
};
