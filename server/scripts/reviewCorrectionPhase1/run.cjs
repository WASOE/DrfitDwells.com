'use strict';

// Deliberately no dotenv, application bootstrap, models, jobs, notifications or index creation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { assert, hash, evidence, snapshotHash, prepare } = require('./core.cjs');

const ROOT = path.resolve(process.env.DRIFT_REVIEW_REPO_ROOT || path.resolve(__dirname, '../../..'));
const PRIVATE_ROOT = path.join(os.homedir(), '.local/state/drift-review-correction');
const encode = value => require('mongoose').mongo.BSON.EJSON.stringify(value, { relaxed: false });
const decode = value => require('mongoose').mongo.BSON.EJSON.parse(value, { relaxed: false });
const clone = value => decode(encode(value));

function privateDirectory(directory) {
  const resolved = fs.realpathSync(directory);
  assert(resolved.startsWith(`${PRIVATE_ROOT}${path.sep}`), `Use a private run directory under ${PRIVATE_ROOT}`);
  assert(!resolved.startsWith(`${ROOT}${path.sep}`), 'Backup cannot be inside the repository');
  const stat = fs.statSync(resolved);
  assert(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(),
    'Private directory must be owned by current user and mode 0700');
  // Every ancestor down from the dedicated private root must also be private and not a symlink.
  let current = resolved;
  while (current !== path.dirname(PRIVATE_ROOT)) {
    const parent = fs.lstatSync(current);
    assert(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0 &&
      parent.uid === process.getuid(), 'Unsafe private directory ancestor');
    current = path.dirname(current);
  }
  return resolved;
}

function writePrivate(directory, name, bytes) {
  const file = path.join(privateDirectory(directory), name);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const directoryFd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
  assert(fs.readFileSync(file).equals(Buffer.from(bytes)), 'Artifact read-back verification failed');
  return file;
}

function readPrivate(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
    stat.uid === process.getuid(), 'Private input must be owned, non-symlink, mode 0600');
  return fs.readFileSync(file, 'utf8');
}

async function readState(db, session) {
  const result = {};
  for (const [key, collection] of [['reviews', 'reviews'], ['cabins', 'cabins'], ['cabinTypes', 'cabintypes']]) {
    // Native reads include raw/select:false, every status and soft-deleted documents.
    result[key] = await db.collection(collection).find({}, {
      session, promoteValues: false, promoteLongs: false, bsonRegExp: true
    }).sort({ _id: 1 }).toArray();
  }
  return result;
}

function validateStagingUri(uri) {
  const parsed = new URL(uri);
  assert(parsed.protocol === 'mongodb:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'Mutation requires an explicitly isolated loopback staging replica set');
  const database = decodeURIComponent(parsed.pathname.slice(1));
  assert(/^review_correction_staging_[a-z0-9_]+$/.test(database), 'Database name is not in the staging allowlist');
  return database;
}

async function targetIdentity(client, uri, mutate) {
  const db = client.db();
  const hello = await db.admin().command({ hello: 1 });
  const identity = {
    database: db.databaseName,
    deployment: hash({ hosts: hello.hosts, setName: hello.setName, processId: hello.topologyVersion?.processId?.toString() })
  };
  if (mutate) {
    assert(validateStagingUri(uri) === db.databaseName, 'Database identity mismatch');
    assert(hello.setName, 'Staging must support replica-set transactions');
    const marker = await db.collection('review_correction_environment').findOne({ _id: 'phase1' });
    assert(marker?.environment === 'staging' && marker.isolated === true && marker.production === false &&
      marker.database === identity.database && marker.deployment === identity.deployment &&
      marker.approval === 'ISOLATED REVIEW-ONLY STAGING; NO PRODUCTION CONNECTION',
    'Missing independently approved staging identity marker');
  }
  return identity;
}

function loadBundle(file) {
  const text = readPrivate(file);
  const manifest = JSON.parse(readPrivate(`${file}.manifest.json`));
  assert(manifest.format === 1 && manifest.sha256 === hash(text), 'Backup integrity mismatch');
  const bundle = decode(text);
  assert(Number(bundle.format) === 1 && hash(manifest.identity) === hash(bundle.identity), 'Backup identity/format mismatch');
  assert(manifest.stateHash === snapshotHash(bundle.state, encode), 'Backup state hash mismatch');
  for (const key of ['reviews', 'cabins', 'cabinTypes']) {
    assert(manifest.counts[key] === bundle.state[key].length, 'Backup count mismatch');
  }
  return bundle;
}

async function transaction(client, fn) {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary'
    });
  } finally {
    await session.endSession();
  }
}

async function backup(client, uri, directory) {
  const identity = await targetIdentity(client, uri, false);
  const state = await transaction(client, session => readState(client.db(), session));
  const bundle = { format: 1, identity, capturedAt: new Date(), state };
  const text = encode(bundle);
  const file = writePrivate(directory, `backup-${crypto.randomUUID()}.ejson`, text);
  const manifest = {
    format: 1, sha256: hash(text), stateHash: snapshotHash(state, encode), identity,
    counts: Object.fromEntries(Object.entries(state).map(([key, rows]) => [key, rows.length])),
    scope: 'All review documents including raw/all statuses/deleted; complete Cabin/CabinType ownership and statistics; no other collections'
  };
  writePrivate(directory, `${path.basename(file)}.manifest.json`, JSON.stringify(manifest, null, 2));
  loadBundle(file);
  return { backup: file, ...manifest };
}

async function writeDifference(db, session, from, to) {
  const original = new Map(from.reviews.map(row => [String(row._id), row]));
  const next = new Map(to.reviews.map(row => [String(row._id), row]));
  const removed = from.reviews.filter(row => !next.has(String(row._id)));
  if (removed.length) {
    const result = await db.collection('reviews').deleteMany({ _id: { $in: removed.map(row => row._id) } }, { session });
    assert(result.deletedCount === removed.length, 'Exact archive removal count mismatch');
  }
  const restored = to.reviews.filter(row => !original.has(String(row._id)));
  if (restored.length) {
    const result = await db.collection('reviews').insertMany(restored, { session });
    assert(result.insertedCount === restored.length, 'Exact restore count mismatch');
  }
  for (const [key, collection] of [['cabins', 'cabins'], ['cabinTypes', 'cabintypes']]) {
    const old = new Map(from[key].map(row => [String(row._id), row]));
    for (const row of to[key]) {
      if (hash(encode(row)) === hash(encode(old.get(String(row._id))))) continue;
      // Only counters differ. Rollback replacement also restores absent fields exactly.
      const result = await db.collection(collection).replaceOne({ _id: row._id }, row, { session });
      assert(result.matchedCount === 1, 'Property counter update mismatch');
    }
  }
}

async function correct(client, uri, bundle, audit, directory, rollback = false) {
  const identity = await targetIdentity(client, uri, true);
  assert(hash(identity) === hash(bundle.identity), 'Backup belongs to a different database/deployment');
  const plan = prepare(bundle.state, audit, encode, clone);
  const beforeHash = snapshotHash(bundle.state, encode);
  const afterHash = snapshotHash(plan.after, encode);
  // Archive is immutable, outside every API/public path, and verified before the first mutation.
  const archiveName = `archive-${beforeHash}.ejson`;
  const archiveText = encode({ format: 1, backupStateHash: beforeHash, records: plan.archive });
  const archivePath = path.join(directory, archiveName);
  if (fs.existsSync(archivePath)) {
    assert(readPrivate(archivePath) === archiveText, 'Existing private archive mismatch');
  } else {
    writePrivate(directory, archiveName, archiveText);
    writePrivate(directory, `${archiveName}.manifest.json`, JSON.stringify({
      format: 1, sha256: hash(archiveText), count: 357, backupStateHash: beforeHash
    }));
  }
  const archiveManifest = JSON.parse(readPrivate(`${archivePath}.manifest.json`));
  assert(archiveManifest.sha256 === hash(readPrivate(archivePath)) && archiveManifest.count === 357,
    'Archive integrity mismatch');
  const from = rollback ? plan.after : bundle.state;
  const to = rollback ? bundle.state : plan.after;
  const result = await transaction(client, async session => {
    const current = await readState(client.db(), session);
    const currentHash = snapshotHash(current, encode);
    if (currentHash === snapshotHash(to, encode)) return 'already-complete-no-writes';
    assert(currentHash === snapshotHash(from, encode), 'Database drift: abort without mutation');
    await writeDifference(client.db(), session, from, to);
    assert(snapshotHash(await readState(client.db(), session), encode) === snapshotHash(to, encode),
      'Post-write full-state verification failed');
    return rollback ? 'rolled-back-staging' : 'corrected-staging';
  });
  return {
    result, beforeHash, afterHash, archiveCount: 357, archiveSha256: hash(archiveText),
    cabinDocumentsHash: plan.cabinHash, cabinDocumentsUnchanged: true,
    report: plan.report, scope: 'Only inventoried reviews and resolved property counters; all other backed-up documents unchanged',
    rollback: 'staging-only; same pinned backup required; refuses any post-correction drift'
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  assert(['backup', 'plan', 'apply-staging', 'rollback-staging'].includes(command),
    'Usage: run.cjs backup|plan|apply-staging|rollback-staging --config /private/config.json');
  assert(args.length === 2 && args[0] === '--config', 'Only --config /private/config.json is accepted');
  const config = JSON.parse(readPrivate(args[1]));
  const directory = privateDirectory(config.privateDirectory);
  if (command === 'plan') {
    const bundle = loadBundle(config.backup);
    const audit = evidence(fs.readFileSync(config.inventory), fs.readFileSync(config.snapshot));
    const plan = prepare(bundle.state, audit, encode, clone);
    console.log(JSON.stringify({ mode: 'offline-plan-NOT-staging', report: plan.report, cabinHash: plan.cabinHash }, null, 2));
    return;
  }
  assert(config.uriFile, 'Explicit private URI file required; environment URIs are never loaded');
  const uri = readPrivate(config.uriFile).trim();
  const mutate = command !== 'backup';
  if (mutate) {
    validateStagingUri(uri);
    assert(config.exclusiveReviewOnlyStaging === true, 'Stop staging writers and confirm review-only isolation');
  }
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000, retryWrites: false, appName: 'review-correction-phase1',
    ...(mutate ? { directConnection: true } : {})
  });
  try {
    await client.connect();
    const result = command === 'backup' ? await backup(client, uri, directory) :
      await correct(client, uri, loadBundle(config.backup),
        evidence(fs.readFileSync(config.inventory), fs.readFileSync(config.snapshot)),
        directory, command === 'rollback-staging');
    writePrivate(directory, `receipt-${command}-${crypto.randomUUID()}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    // Driver errors can contain URIs or private document contents.
    const detail = error.name === 'Error' ? error.message : `${error.name}; code=${Number(error.code) || 'unavailable'}`;
    console.error(`Review correction failed; no success claimed: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = { encode, decode, clone, privateDirectory, readPrivate, writePrivate, readState,
  validateStagingUri, targetIdentity, loadBundle, backup, correct };
