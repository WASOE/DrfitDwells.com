'use strict';

// Operator-only production workflow. Importing this module never connects or writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const {
  assert, hash, prepare, verifyScopedExport, CABIN, POOLS
} = require('./core.cjs');
const {
  encode, privateDirectory, readPrivate, writePrivate
} = require('./run.cjs');
const {
  loadExport, stateHash, readScopedState, performApplyForDatabase, performRollbackForDatabase
} = require('./standalone.cjs');
const { loadConfiguredUri } = require('./export.cjs');

const BACKUP_ROOT = '/home/illoc/backups/driftdwells';
const PUBLIC_OWNER_IDS = [
  CABIN, '69b2ff947f141a71ffa7c401', '69d096b6bd7fb6fc0d3c2a34',
  '69b2ff947f141a71ffa7c452', '69b2ff947f141a71ffa7c492'
];
const { ObjectId, BSON } = require('mongoose').mongo;

async function fileHash(file) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

async function verifyFullBackup(backupSet, restoreVerifiedBackupSet, backupRoot = BACKUP_ROOT) {
  const suppliedStat = fs.lstatSync(backupSet);
  assert(suppliedStat.isDirectory() && !suppliedStat.isSymbolicLink(),
    'Full backup path must not be a symlink');
  const resolved = fs.realpathSync(backupSet);
  const root = path.resolve(backupRoot);
  assert(resolved.startsWith(`${root}/daily/`) ||
    resolved.startsWith(`${root}/weekly/`) ||
    resolved.startsWith(`${root}/manual/`),
  'Full backup must be within the existing protected backup root');
  assert(restoreVerifiedBackupSet === resolved,
    'The exact backup set must have passed the existing restore-verification procedure');
  const directoryStat = fs.lstatSync(resolved);
  assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink() &&
    directoryStat.uid === process.getuid() && (directoryStat.mode & 0o077) === 0,
  'Full backup directory must be operator-owned and mode 0700');
  const manifestPath = path.join(resolved, 'manifest.txt');
  const checksumsPath = path.join(resolved, 'checksums.sha256');
  const manifest = readPrivate(manifestPath);
  const checksumText = readPrivate(checksumsPath);
  assert(manifest.split('\n').includes(`backup_set_path=${resolved}`),
    'Full-backup manifest path mismatch');
  const mongoEntries = fs.readdirSync(path.join(resolved, 'mongo'));
  const uploadEntries = fs.readdirSync(path.join(resolved, 'uploads'));
  assert(mongoEntries.length === 1 && /^driftdwells-mongo-[0-9-]+\.gz$/.test(mongoEntries[0]) &&
    uploadEntries.length === 1 && /^driftdwells-uploads-[0-9-]+\.tar\.gz$/.test(uploadEntries[0]),
  'Full backup must contain exactly one expected Mongo archive and uploads tar');
  const expectedFiles = [
    path.join(resolved, 'mongo', mongoEntries[0]),
    path.join(resolved, 'uploads', uploadEntries[0])
  ];
  assert(expectedFiles.length === 2, 'Expected exactly one Mongo archive and one uploads archive');
  const entries = checksumText.trim().split('\n').map(line => {
    const match = line.match(/^([a-f0-9]{64})  (mongo\/driftdwells-mongo-[0-9-]+\.gz|uploads\/driftdwells-uploads-[0-9-]+\.tar\.gz)$/);
    assert(match, 'Unexpected full-backup checksum manifest entry');
    return { sha256: match[1], relative: match[2] };
  });
  assert(entries.length === 2 && new Set(entries.map(row => row.relative)).size === 2,
    'Full-backup checksum manifest must cover exactly two files');
  for (const entry of entries) {
    const file = path.join(resolved, entry.relative);
    assert(expectedFiles.includes(file), 'Checksum references a missing or unexpected backup file');
    const stat = fs.lstatSync(file);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0, 'Backup archive must be operator-owned and mode 0600');
    assert(await fileHash(file) === entry.sha256, `Full-backup checksum mismatch: ${entry.relative}`);
  }
  return { path: resolved, sha256: hash({ manifest, checksumText }), files: entries.length };
}

async function readPublishedPoolIds(db) {
  const rows = await db.collection('reviews').find({
    cabinId: { $in: PUBLIC_OWNER_IDS.map(value => new ObjectId(value)) },
    status: 'approved',
    deletedAt: null,
    rating: { $gte: 1 }
  }, {
    projection: { _id: 1, cabinId: 1, status: 1, rating: 1, deletedAt: 1 },
    promoteValues: false, promoteLongs: false, bsonRegExp: true
  }).sort({ _id: 1 }).toArray();
  return rows;
}

async function liveIdentity(client) {
  const hello = await client.db().admin().command({ hello: 1 });
  return {
    environment: 'production',
    database: client.db().databaseName,
    deployment: hash({
      hosts: hello.hosts,
      setName: hello.setName,
      processId: hello.topologyVersion?.processId?.toString()
    })
  };
}

async function readProductionPass(client, bundle, audit) {
  const state = await readScopedState(client.db(), bundle.state);
  const publicRows = await readPublishedPoolIds(client.db());
  const knownIds = new Set([...audit.synthetic, ...audit.cabin].map(row => row._id));
  assert(publicRows.every(row => knownIds.has(String(row._id))),
    'Unexpected published review in an affected property pool; stop for evidence review');
  const counts = new Map(POOLS.map(pool => [pool.name, 0]));
  for (const row of publicRows) {
    const owners = POOLS.find(pool => pool.id === String(row.cabinId) ||
      pool.linked === String(row.cabinId));
    assert(owners, 'Unexpected published review owner');
    counts.set(owners.name, counts.get(owners.name) + 1);
  }
  const stateDigest = stateHash(state);
  const publicDigest = hash(publicRows.map(row => encode(row)));
  const plan = prepare(state, audit, encode, value => BSON.EJSON.parse(encode(value)));
  return {
    state, stateDigest, publicDigest, publicCounts: Object.fromEntries(counts),
    currentStatistics: verifyScopedExport(state, audit), expectedAfterCorrection: plan.report
  };
}

async function productionPreflight({ client, bundle, audit, expectedIdentity }) {
  const identityBefore = await liveIdentity(client);
  assert(identityBefore.database === bundle.payload.source.database &&
    identityBefore.deployment === bundle.payload.source.deploymentFingerprint &&
    hash(identityBefore) === hash(expectedIdentity),
  'Connected production deployment does not match the pinned export');
  const first = await readProductionPass(client, bundle, audit);
  const second = await readProductionPass(client, bundle, audit);
  assert(first.stateDigest === second.stateDigest && first.publicDigest === second.publicDigest &&
    hash(first.publicCounts) === hash(second.publicCounts),
  'Two complete non-transactional production preflight reads differ');
  assert(first.stateDigest === stateHash(bundle.state),
    'Production review/property state differs from the verified export');
  const identityAfter = await liveIdentity(client);
  assert(hash(identityBefore) === hash(identityAfter),
    'Production deployment identity changed during preflight');
  assert(second.state.reviews.length === 487 &&
    second.state.reviews.filter(row => String(row.cabinId) === CABIN).length === 130,
  'Production preflight exact review counts differ from inventory');
  assert(Object.values(second.publicCounts).reduce((total, value) => total + value, 0) === 487,
    'Production published-property counts differ from export');
  return {
    environment: 'production-read-only-preflight',
    pointInTimeSnapshot: false,
    method: 'two complete, independently hashed non-transactional reads',
    deploymentFingerprint: identityAfter.deployment,
    exportSha256: bundle.sha256,
    reviews: 487,
    targetedSyntheticReviews: 357,
    cabinReviews: 130,
    publishedPoolCounts: second.publicCounts,
    currentStatistics: second.currentStatistics.map(row => ({
      property: row.property, count: row.count, ratingSum: row.ratingSum,
      exactMean: row.exactMean, stored: row.stored
    })),
    expectedAfterCorrection: second.expectedAfterCorrection.map(row => ({
      property: row.name, archived: row.archiveCount, count: row.count,
      ratingSum: row.ratingSum, exactMean: row.exactMean, storedMean: row.storedMean
    })),
    cabinDocumentsHash: prepare(bundle.state, audit, encode,
      value => BSON.EJSON.parse(encode(value))).cabinHash
  };
}

function confirmationToken(action, bundle, backup) {
  const operation = action === 'apply'
    ? `APPLY PRODUCTION REVIEW CORRECTION ${bundle.sha256} ${path.basename(backup.path)}`
    : `ROLL BACK PRODUCTION REVIEW CORRECTION ${bundle.sha256} ${path.basename(backup.path)}`;
  return operation;
}

async function runProduction({ command, configPath, confirmation }) {
  assert(['preflight', 'apply', 'rollback'].includes(command),
    'Usage: production.cjs preflight|apply|rollback --config /private/config.json [--confirm exact-phrase]');
  const config = JSON.parse(readPrivate(configPath));
  const directory = privateDirectory(config.privateDirectory);
  assert(config.restoreVerifiedBackupSet && config.backupSet,
    'Verified full-backup path and restore-verification attestation are required');
  const backup = await verifyFullBackup(config.backupSet, config.restoreVerifiedBackupSet);
  const bundle = loadExport(config.exportPath);
  const audit = require('./core.cjs').evidence(
    fs.readFileSync(config.inventoryPath), fs.readFileSync(config.snapshotPath)
  );
  const uri = loadConfiguredUri(config.serverEnv);
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: false,
    appName: 'review-correction-phase1-production',
    directConnection: true
  });
  try {
    await client.connect();
    const identity = await liveIdentity(client);
    assert(identity.database === bundle.payload.source.database &&
      identity.deployment === bundle.payload.source.deploymentFingerprint,
    'Connected target identity differs from pinned production export');
    if (command === 'preflight') {
      const result = await productionPreflight({ client, bundle, audit, expectedIdentity: identity });
      const receipt = {
        ...result,
        backup: { path: backup.path, integritySha256: backup.sha256, files: backup.files },
        restoreVerification: 'operator attested; existing restore verifier passed for this exact backup set',
        createdAt: new Date()
      };
      writePrivate(directory,
        `production-preflight-${bundle.sha256}-${crypto.randomUUID()}.json`,
        JSON.stringify(receipt, null, 2));
      console.log(JSON.stringify(receipt, null, 2));
      return;
    }
    const expectedConfirmation = confirmationToken(command, bundle, backup);
    assert(confirmation === expectedConfirmation,
      `Explicit production-write approval required; expected confirmation phrase: ${expectedConfirmation}`);
    assert(config.restoreVerifiedBackupSet === backup.path,
      'Full backup restore verification does not match selected backup');
    const plan = prepare(bundle.state, audit, encode, value => BSON.EJSON.parse(encode(value)));
    const archiveHash = hash(encode(plan.archive));
    const journalFile = path.join(directory,
      `correction-${bundle.payload.source.database}-${bundle.sha256}.journal.ejson`);
    if (command === 'apply' && !fs.existsSync(journalFile)) {
      await productionPreflight({ client, bundle, audit, expectedIdentity: identity });
    }
    const result = command === 'apply'
      ? await performApplyForDatabase({
        client, databaseName: identity.database, targetIdentity: identity,
        exportPath: config.exportPath, audit, directory
      })
      : await performRollbackForDatabase({
        client, databaseName: identity.database, targetIdentity: identity,
        exportPath: config.exportPath, audit, directory
      });
    const receipt = {
      environment: `production-${command}`,
      target: identity,
      exportSha256: bundle.sha256,
      backupIntegritySha256: backup.sha256,
      archiveSha256: result.archiveSha256 || archiveHash,
      archiveCount: result.archiveCount || result.restoredReviews,
      report: result.report || plan.report,
      cabinDocumentsUnchanged: true,
      consistency: 'Per-document conditional updates with durable journal; no multi-document transaction',
      result: result.state || result.result,
      journalPath: result.journalPath,
      createdAt: new Date()
    };
    writePrivate(directory,
      `production-${command}-${bundle.sha256}-${crypto.randomUUID()}.json`,
      JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await client.close();
  }
}

async function main() {
  const [command, configFlag, configPath, confirmFlag, confirmation] = process.argv.slice(2);
  assert(configFlag === '--config' && configPath &&
    ((confirmFlag === undefined && confirmation === undefined) ||
      (confirmFlag === '--confirm' && confirmation)),
  'Usage: production.cjs preflight|apply|rollback --config /private/config.json [--confirm exact-phrase]');
  await runProduction({ command, configPath, confirmation });
}

if (require.main === module) {
  main().catch(error => {
    const detail = error.name === 'Error' ? error.message : `${error.name}; code=${Number(error.code) || 'unavailable'}`;
    console.error(`Production review correction stopped safely: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = {
  fileHash, verifyFullBackup, readPublishedPoolIds, liveIdentity,
  readProductionPass, productionPreflight, confirmationToken, runProduction
};
