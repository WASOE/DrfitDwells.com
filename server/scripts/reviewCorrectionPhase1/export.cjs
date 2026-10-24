'use strict';

// Read-only, allowlisted export. No application bootstrap, models, jobs or writes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  assert, hash, evidence, POOLS, verifyScopedExport
} = require('./core.cjs');

const { privateDirectory, writePrivate } = require('./run.cjs');
const CABIN = '69b2ff933a7fff6621e785cc';
const CABIN_IDS = [
  CABIN, '69d096b6bd7fb6fc0d3c2a34',
  '69b2ff947f141a71ffa7c452', '69b2ff947f141a71ffa7c492'
];
const CABIN_TYPE_IDS = ['69b2ff947f141a71ffa7c401'];
const EXPORT_ROOT = path.join(os.homedir(), '.local/state/drift-review-correction');
const PROPERTY_PROJECTION = {
  _id: 1,
  reviewsCount: 1,
  averageRating: 1,
  inventoryType: 1,
  inventoryMode: 1,
  cabinTypeId: 1,
  cabinTypeRef: 1
};
const encode = value => require('mongoose').mongo.BSON.EJSON.stringify(value, { relaxed: false });

function loadConfiguredUri(serverEnv) {
  const envStat = fs.lstatSync(serverEnv);
  assert(envStat.isFile() && !envStat.isSymbolicLink() && envStat.uid === process.getuid() &&
    (envStat.mode & 0o077) === 0, 'Existing server configuration must be owner-only and non-symlink');
  const configured = require('dotenv').parse(fs.readFileSync(serverEnv, 'utf8'));
  const uri = configured.MONGODB_URI || configured.MONGO_URI;
  assert(uri, 'Existing server configuration must provide MONGODB_URI or MONGO_URI');
  return uri;
}

async function collect(client, audit) {
  const db = client.db();
  const { ObjectId } = require('mongoose').mongo;
  const owners = [...new Set(POOLS.flatMap(pool => [pool.id, ...(pool.linked ? [pool.linked] : [])]))]
    .map(value => new ObjectId(value));
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const reviews = await db.collection('reviews').find({ cabinId: { $in: owners } }, {
        session, promoteValues: false, promoteLongs: false, bsonRegExp: true
      }).sort({ _id: 1 }).toArray();
      const cabins = await db.collection('cabins').find(
        { _id: { $in: CABIN_IDS.map(value => new ObjectId(value)) } },
        { session, projection: PROPERTY_PROJECTION, promoteValues: false, promoteLongs: false, bsonRegExp: true }
      ).sort({ _id: 1 }).toArray();
      const cabinTypes = await db.collection('cabintypes').find(
        { _id: { $in: CABIN_TYPE_IDS.map(value => new ObjectId(value)) } },
        { session, projection: PROPERTY_PROJECTION, promoteValues: false, promoteLongs: false, bsonRegExp: true }
      ).sort({ _id: 1 }).toArray();
      const state = { reviews, cabins, cabinTypes };
      const stats = verifyScopedExport(state, audit);
      return { state, stats };
    }, {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
      readPreference: 'primary'
    });
  } finally {
    await session.endSession();
  }
}

async function createExport(client, audit, directory) {
  const stateResult = await collect(client, audit);
  const hello = await client.db().admin().command({ hello: 1 });
  const payload = {
    format: 1,
    createdAt: new Date(),
    source: {
      database: client.db().databaseName,
      deploymentFingerprint: hash({
        hosts: hello.hosts,
        setName: hello.setName,
        processId: hello.topologyVersion?.processId?.toString()
      }),
      evidence: {
        inventorySha256: require('./core.cjs').EVIDENCE_HASHES.inventory,
        publicSnapshotSha256: require('./core.cjs').EVIDENCE_HASHES.snapshot
      }
    },
    scope: {
      reviews: 487,
      syntheticIds: 357,
      cabinReviewIds: 130,
      statisticsDocuments: 5,
      collections: ['reviews', 'cabins', 'cabintypes'],
      exclusions: ['all bookings', 'payments', 'guests', 'users', 'other reviews', 'unrelated properties']
    },
    reviews: stateResult.state.reviews,
    statistics: {
      cabins: stateResult.state.cabins,
      cabinTypes: stateResult.state.cabinTypes,
      observed: stateResult.stats
    }
  };
  const bytes = encode(payload);
  const sha256 = hash(bytes);
  const filename = `review-only-export-${sha256}.ejson`;
  const exportPath = writePrivate(directory, filename, bytes);
  const manifest = {
    format: 1,
    sha256,
    counts: { reviews: 487, synthetic: 357, cabin: 130, cabins: 4, cabinTypes: 1 },
    evidence: payload.source.evidence,
    target: {
      database: payload.source.database,
      deploymentFingerprint: payload.source.deploymentFingerprint
    },
    scope: payload.scope,
    stats: stateResult.stats
  };
  writePrivate(directory, `${filename}.manifest.json`, JSON.stringify(manifest, null, 2));
  const readBack = fs.readFileSync(exportPath);
  assert(hash(readBack) === sha256, 'Scoped export read-back integrity check failed');
  return {
    path: exportPath,
    sha256,
    count: manifest.counts,
    stats: stateResult.stats,
    stagingPackage: 'This exact allowlisted export is the review-only staging dataset package; no DB import was performed.'
  };
}

async function main() {
  assert(process.argv.length === 6 && process.argv[2] === '--inventory' &&
    process.argv[4] === '--snapshot', 'Usage: node export.cjs --inventory /private/audit.csv --snapshot /private/audit.json');
  const inventoryPath = process.argv[3];
  const snapshotPath = process.argv[5];
  const audit = evidence(fs.readFileSync(inventoryPath), fs.readFileSync(snapshotPath));
  const serverEnv = process.env.DRIFT_REVIEW_ENV_FILE || path.resolve(__dirname, '../../.env');
  const uri = loadConfiguredUri(serverEnv);
  const privateDirectoryPath =
    path.join(EXPORT_ROOT, `export-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(privateDirectoryPath, { recursive: true, mode: 0o700 });
  fs.chmodSync(privateDirectoryPath, 0o700);
  const directory = privateDirectory(privateDirectoryPath);
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    retryWrites: false,
    appName: 'review-only-phase1-export'
  });
  try {
    await client.connect();
    const result = await createExport(client, audit, directory);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    const detail = error.name === 'Error' ? error.message : `${error.name}; code=${Number(error.code) || 'unavailable'}`;
    console.error(`Review-only export failed; no export claimed: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = { collect, createExport, loadConfiguredUri };
