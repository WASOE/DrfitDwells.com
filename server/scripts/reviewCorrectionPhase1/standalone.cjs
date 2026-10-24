'use strict';

// Standalone-MongoDB correction protocol. All mutation commands are loopback-only.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  assert, hash, verifyScopedExport, prepare
} = require('./core.cjs');
const {
  encode, decode, clone, privateDirectory, readPrivate, writePrivate
} = require('./run.cjs');

const { ObjectId, BSON } = require('mongoose').mongo;
const REVIEW_COLLECTION = 'reviews';
const PROPERTY_COLLECTIONS = [['cabins', 'cabins'], ['cabinTypes', 'cabintypes']];
const PROPERTY_FIELDS = [
  '_id', 'reviewsCount', 'averageRating', 'inventoryType', 'inventoryMode',
  'cabinTypeId', 'cabinTypeRef'
];

function validateLocalUri(uri) {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error('A valid loopback-only MongoDB URI is required');
  }
  assert(parsed.protocol === 'mongodb:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
  'Standalone correction is restricted to loopback MongoDB');
  const database = decodeURIComponent(parsed.pathname.slice(1));
  assert(/^review_correction_(local|staging)_[a-z0-9_]+$/.test(database),
    'Database name is not in the local review-only allowlist');
  return database;
}

function loadExport(exportPath) {
  const bytes = fs.readFileSync(exportPath);
  const manifest = JSON.parse(readPrivate(`${exportPath}.manifest.json`));
  const fileHash = hash(bytes);
  assert(manifest.sha256 === fileHash, 'Export package checksum mismatch');
  const payload = BSON.EJSON.parse(bytes.toString('utf8'));
  assert(payload.format === 1 && payload.consistency?.pointInTimeSnapshot === false &&
    payload.consistency.method === 'two complete, independently hashed non-transactional reads' &&
    payload.consistency.readHashes?.length === 2 &&
    payload.consistency.readHashes[0] === payload.consistency.readHashes[1],
  'Export is not a verified matching two-read package');
  assert(payload.reviews.length === 487 && payload.scope.syntheticIds === 357 &&
    payload.scope.cabinReviewIds === 130, 'Export package count mismatch');
  return {
    sha256: fileHash,
    payload,
    state: {
      reviews: payload.reviews,
      cabins: payload.statistics.cabins,
      cabinTypes: payload.statistics.cabinTypes
    }
  };
}

function packageStats(state, audit) {
  return verifyScopedExport(state, audit);
}

function stateHash(state) {
  return hash(encode({
    reviews: [...state.reviews].sort((a, b) => String(a._id).localeCompare(String(b._id))),
    cabins: [...state.cabins].sort((a, b) => String(a._id).localeCompare(String(b._id))),
    cabinTypes: [...state.cabinTypes].sort((a, b) => String(a._id).localeCompare(String(b._id)))
  }));
}

async function readScopedState(db, expected, session) {
  const ownerCabin = '69b2ff933a7fff6621e785cc';
  const ids = expected.reviews.filter(row => String(row.cabinId) !== ownerCabin).map(row => row._id);
  const queryOptions = { promoteValues: false, promoteLongs: false, bsonRegExp: true };
  const reviews = await db.collection(REVIEW_COLLECTION).find({
    $or: [
      { _id: { $in: ids } },
      { cabinId: new ObjectId(ownerCabin) }
    ]
  }, { ...queryOptions, ...(session ? { session } : {}) }).sort({ _id: 1 }).toArray();
  const cabins = [];
  const cabinTypes = [];
  for (const [key, collection] of PROPERTY_COLLECTIONS) {
    const target = key === 'cabins' ? cabins : cabinTypes;
    for (const expectedDoc of expected[key]) {
      const row = await db.collection(collection).findOne(
        { _id: expectedDoc._id },
        { projection: Object.fromEntries(PROPERTY_FIELDS.map(field => [field, 1])),
          ...queryOptions, ...(session ? { session } : {}) }
      );
      if (row) target.push(row);
    }
  }
  return { reviews, cabins, cabinTypes };
}

async function seedLocal(client, bundle, audit) {
  const database = client.db();
  const hello = await database.admin().command({ hello: 1 });
  assert(!hello.setName && hello.msg !== 'isdbgrid', 'Local correction test must use standalone MongoDB');
  const state = bundle.state;
  packageStats(state, audit);
  const collections = ['reviews', 'cabins', 'cabintypes'];
  for (const collection of collections) {
    assert(await database.collection(collection).countDocuments() === 0,
      `Refusing to seed non-empty local collection: ${collection}`);
  }
  await database.collection('reviews').insertMany(state.reviews);
  await database.collection('cabins').insertMany(state.cabins);
  await database.collection('cabintypes').insertMany(state.cabinTypes);
  const after = await readScopedState(database, state);
  assert(stateHash(after) === stateHash(state), 'Local export import verification failed');
  return { reviews: state.reviews.length, cabins: state.cabins.length, cabinTypes: state.cabinTypes.length };
}

function journalPath(directory, exportHash, database) {
  return path.join(directory, `correction-${database}-${exportHash}.journal.ejson`);
}

function persistJournal(directory, file, journal) {
  const payload = encode(journal);
  const envelope = JSON.stringify({ sha256: hash(payload), payload });
  const temporary = `${file}.next-${crypto.randomUUID()}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, envelope);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  const directoryFd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
}

function loadJournal(directory, file) {
  const envelope = JSON.parse(readPrivate(file));
  assert(typeof envelope.payload === 'string' && envelope.sha256 === hash(envelope.payload),
    'Correction journal integrity mismatch');
  const journal = BSON.EJSON.parse(envelope.payload);
  assert(journal.format === 1 && journal.directory === directory, 'Correction journal identity mismatch');
  return journal;
}

function acquireLock(file) {
  const lockPath = `${file}.lock`;
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.fsyncSync(fd);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Correction journal is locked; verify no other operator is running before recovery');
    }
    throw error;
  }
  return () => {
    fs.closeSync(fd);
    fs.unlinkSync(lockPath);
  };
}

function exactDocumentFilter(document) {
  return {
    $and: Object.entries(document).map(([key, value]) => ({ [key]: { $eq: value } }))
  };
}

function propertyFilter(document) {
  return {
    $and: PROPERTY_FIELDS.map(field => Object.hasOwn(document, field)
      ? { [field]: { $eq: document[field] } }
      : { [field]: { $exists: false } })
  };
}

function sameFields(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys) &&
    leftKeys.every(key => encode(left[key]) === encode(right[key]));
}

function archiveArtifacts(directory, exportHash, plan) {
  const archivePath = path.join(directory, `private-archive-${exportHash}.ejson`);
  const archivePayload = encode({
    format: 1,
    exportSha256: exportHash,
    records: plan.archive
  });
  if (fs.existsSync(archivePath)) {
    assert(readPrivate(archivePath) === archivePayload, 'Private review archive differs from export');
  } else {
    writePrivate(directory, path.basename(archivePath), archivePayload);
  }
  const archiveHash = hash(readPrivate(archivePath));
  assert(archiveHash === hash(archivePayload), 'Private review archive checksum mismatch');
  return { archivePath, archiveHash };
}

function initialJournal(directory, database, bundle, plan, archive) {
  return {
    format: 1,
    directory,
    database,
    exportSha256: bundle.sha256,
    baselineHash: stateHash(bundle.state),
    correctedHash: stateHash(plan.after),
    archivePath: archive.archivePath,
    archiveSha256: archive.archiveHash,
    state: 'applying',
    reviewOps: plan.archive.map(review => ({ id: review._id, phase: 'pending' })),
    propertyOps: PROPERTY_COLLECTIONS.flatMap(([key, collection]) =>
      plan.after[key].map(after => ({
        collection,
        id: after._id,
        before: bundle.state[key].find(row => String(row._id) === String(after._id)),
        after,
        phase: 'pending'
      })))
  };
}

function expectedStateWithStatus(bundle, audit, status) {
  const plan = prepare(bundle.state, audit, encode, clone);
  const state = clone(bundle.state);
  const ids = new Set(audit.synthetic.map(row => row._id));
  for (const review of state.reviews) {
    if (ids.has(String(review._id))) review.status = status;
  }
  state.cabins = plan.after.cabins;
  state.cabinTypes = plan.after.cabinTypes;
  return state;
}

async function performApply({ client, uri, exportPath, audit, directory, faultHook = async () => {} }) {
  const databaseName = validateLocalUri(uri);
  assert(client.db().databaseName === databaseName, 'Connected database differs from allowlisted local database');
  const directoryPath = privateDirectory(directory);
  const bundle = loadExport(exportPath);
  const plan = prepare(bundle.state, audit, encode, clone);
  const archive = archiveArtifacts(directoryPath, bundle.sha256, plan);
  const file = journalPath(directoryPath, bundle.sha256, databaseName);
  let journal;
  if (fs.existsSync(file)) {
    journal = loadJournal(directoryPath, file);
    assert(journal.database === databaseName && journal.exportSha256 === bundle.sha256 &&
      journal.archiveSha256 === archive.archiveHash, 'Correction journal target mismatch');
    assert(journal.state === 'applying' || journal.state === 'applied',
      'Journal is not in a resumable apply state');
  } else {
    const live = await readScopedState(client.db(), bundle.state);
    assert(stateHash(live) === stateHash(bundle.state), 'Local staging data drifted from verified export');
    journal = initialJournal(directoryPath, databaseName, bundle, plan, archive);
    persistJournal(directoryPath, file, journal);
  }
  const unlock = acquireLock(file);
  try {
    for (const operation of journal.reviewOps) {
      if (operation.phase === 'hidden') continue;
      const snapshot = plan.archive.find(row => String(row._id) === String(operation.id));
      assert(snapshot, 'Journal review ID is absent from pinned archive');
      const previousPhase = operation.phase;
      const hidden = clone(snapshot);
      hidden.status = 'hidden';
      operation.phase = 'hiding';
      persistJournal(directoryPath, file, journal);
      const collection = client.db().collection('reviews');
      const current = await collection.findOne({ _id: snapshot._id });
      if (current) {
        if (encode(current) === encode(hidden)) {
          assert(previousPhase === 'hiding', `Unexpected pre-existing hidden review: ${operation.id}`);
        } else {
          assert(encode(current) === encode(snapshot), `Review changed after export: ${operation.id}`);
          assert(snapshot.status === 'approved', `Expected generated review is not approved: ${operation.id}`);
          const result = await collection.updateOne(exactDocumentFilter(snapshot), {
            $set: { status: 'hidden' }
          });
          assert(result.matchedCount === 1, `Conditional review unpublish failed: ${operation.id}`);
          await faultHook({ point: 'after-review-hide', id: String(operation.id) });
        }
      } else {
        throw new Error(`Review disappeared during correction: ${operation.id}`);
      }
      const verified = await collection.findOne({ _id: snapshot._id });
      assert(verified && encode(verified) === encode(hidden),
        `Review was not safely unpublished: ${operation.id}`);
      operation.phase = 'hidden';
      persistJournal(directoryPath, file, journal);
    }
    for (const operation of journal.propertyOps) {
      if (operation.phase === 'updated') continue;
      const previousPhase = operation.phase;
      operation.phase = 'updating';
      persistJournal(directoryPath, file, journal);
      const collection = client.db().collection(operation.collection);
      const current = await collection.findOne({ _id: operation.id });
      assert(current, `Property stats document disappeared: ${operation.id}`);
      const currentProjection = Object.fromEntries(PROPERTY_FIELDS
        .filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
      if (sameFields(currentProjection, operation.after)) {
        assert(previousPhase === 'updating' || sameFields(operation.before, operation.after),
          `Unexpected pre-existing property target state: ${operation.id}`);
        operation.phase = 'updated';
        persistJournal(directoryPath, file, journal);
        continue;
      }
      assert(sameFields(currentProjection, operation.before),
        `Property ownership/statistics drift: ${operation.id}`);
      const result = await collection.updateOne(propertyFilter(operation.before), {
        $set: {
          reviewsCount: operation.after.reviewsCount,
          averageRating: operation.after.averageRating
        }
      });
      assert(result.matchedCount === 1, `Conditional property stats update failed: ${operation.id}`);
      await faultHook({ point: 'after-property-update', id: String(operation.id) });
      const updated = await collection.findOne({ _id: operation.id });
      assert(updated.reviewsCount === operation.after.reviewsCount &&
        updated.averageRating === operation.after.averageRating,
      `Property stats verification failed: ${operation.id}`);
      operation.phase = 'updated';
      persistJournal(directoryPath, file, journal);
    }
    journal.state = 'applied';
    persistJournal(directoryPath, file, journal);
  } finally {
    unlock();
  }
  const after = await readScopedState(client.db(), bundle.state);
  const expectedAfter = expectedStateWithStatus(bundle, audit, 'hidden');
  if (stateHash(after) !== stateHash(expectedAfter)) {
    const actualById = new Map(after.reviews.map(row => [String(row._id), row]));
    const difference = expectedAfter.reviews.find(row => {
      const actual = actualById.get(String(row._id));
      return !actual || encode(actual) !== encode(row);
    });
    if (difference) {
      throw new Error(`Final local correction verification failed at review ${difference._id}`);
    }
    for (const key of ['cabins', 'cabinTypes']) {
      const actualRows = new Map(after[key].map(row => [String(row._id), row]));
      const expectedRow = expectedAfter[key].find(row => {
        const actual = actualRows.get(String(row._id));
        return !actual || !sameFields(actual, row);
      });
      if (expectedRow) {
        const actual = actualRows.get(String(expectedRow._id));
        const fields = PROPERTY_FIELDS.filter(field =>
          (Object.hasOwn(actual || {}, field) !== Object.hasOwn(expectedRow, field)) ||
          (Object.hasOwn(actual || {}, field) && encode(actual[field]) !== encode(expectedRow[field])));
        throw new Error(`Final local correction verification failed in ${key} ${expectedRow._id}: ` +
          fields.map(field => `${field}=${actual?.[field] ?? 'missing'}/${expectedRow[field] ?? 'missing'}`).join(','));
      }
    }
    throw new Error('Final local correction verification failed in property statistics');
  }
  return {
    state: journal.state,
    archiveCount: plan.archive.length,
    archiveSha256: archive.archiveHash,
    journalPath: file,
    report: plan.report,
    cabinDocumentsUnchanged: true,
    consistency: 'per-document conditional writes and durable journal; no multi-document transaction'
  };
}

async function performRollback({ client, uri, exportPath, audit, directory, faultHook = async () => {} }) {
  const databaseName = validateLocalUri(uri);
  assert(client.db().databaseName === databaseName, 'Connected database differs from allowlisted local database');
  const directoryPath = privateDirectory(directory);
  const bundle = loadExport(exportPath);
  const plan = prepare(bundle.state, audit, encode, clone);
  const file = journalPath(directoryPath, bundle.sha256, databaseName);
  const journal = loadJournal(directoryPath, file);
  assert(journal.state === 'applied' || journal.state === 'rolling-back' ||
    journal.state === 'rolled-back', 'Correction must be applied before rollback');
  const archive = readPrivate(journal.archivePath);
  assert(hash(archive) === journal.archiveSha256, 'Private review archive integrity mismatch');
  const archived = BSON.EJSON.parse(archive);
  assert(archived.exportSha256 === bundle.sha256 &&
    hash(encode(archived.records)) === hash(encode(plan.archive)), 'Private review archive content mismatch');
  const unlock = acquireLock(file);
  try {
    journal.state = 'rolling-back';
    persistJournal(directoryPath, file, journal);
    for (const operation of journal.reviewOps) {
      if (operation.phase === 'restored') continue;
      const snapshot = plan.archive.find(row => String(row._id) === String(operation.id));
      assert(snapshot, 'Rollback review ID is absent from pinned archive');
      operation.phase = 'restoring';
      persistJournal(directoryPath, file, journal);
      const collection = client.db().collection('reviews');
      const current = await collection.findOne({ _id: snapshot._id });
      if (current) {
        const hidden = clone(snapshot);
        hidden.status = 'hidden';
        if (encode(current) !== encode(snapshot)) {
          assert(encode(current) === encode(hidden), `Conflicting review during rollback: ${operation.id}`);
          const result = await collection.updateOne(exactDocumentFilter(hidden), {
            $set: { status: snapshot.status }
          });
          assert(result.matchedCount === 1, `Conditional review rollback failed: ${operation.id}`);
          await faultHook({ point: 'after-review-restore', id: String(operation.id) });
        }
      } else {
        throw new Error(`Review disappeared during rollback: ${operation.id}`);
      }
      assert(encode(await collection.findOne({ _id: snapshot._id })) === encode(snapshot),
        `Original review was not restored: ${operation.id}`);
      operation.phase = 'restored';
      persistJournal(directoryPath, file, journal);
    }
    for (const operation of journal.propertyOps) {
      if (operation.rollbackPhase === 'restored') continue;
      operation.rollbackPhase = 'restoring';
      persistJournal(directoryPath, file, journal);
      const collection = client.db().collection(operation.collection);
      const current = await collection.findOne({ _id: operation.id });
      assert(current, `Property document missing during rollback: ${operation.id}`);
      const projection = Object.fromEntries(PROPERTY_FIELDS
        .filter(key => Object.hasOwn(current, key)).map(key => [key, current[key]]));
      if (!sameFields(projection, operation.before)) {
        assert(sameFields(projection, operation.after),
          `Property drift prevents rollback: ${operation.id}`);
        const result = await collection.updateOne(propertyFilter(operation.after), {
          $set: {
            reviewsCount: operation.before.reviewsCount,
            averageRating: operation.before.averageRating
          }
        });
        assert(result.matchedCount === 1, `Conditional property rollback failed: ${operation.id}`);
        await faultHook({ point: 'after-property-rollback', id: String(operation.id) });
      }
      operation.rollbackPhase = 'restored';
      persistJournal(directoryPath, file, journal);
    }
    journal.state = 'rolled-back';
    persistJournal(directoryPath, file, journal);
  } finally {
    unlock();
  }
  const restored = await readScopedState(client.db(), bundle.state);
  assert(stateHash(restored) === stateHash(bundle.state), 'Final local rollback verification failed');
  return {
    state: journal.state,
    restoredReviews: plan.archive.length,
    journalPath: file,
    consistency: 'per-document conditional writes and durable journal; no multi-document transaction'
  };
}

async function main() {
  const [command, uri, exportPath, directory, inventoryPath, snapshotPath] = process.argv.slice(2);
  assert(['seed-local', 'apply-local', 'rollback-local'].includes(command) &&
    uri && exportPath && directory && inventoryPath && snapshotPath,
  'Usage: standalone.cjs seed-local|apply-local|rollback-local <loopback-uri> <private-export> <private-dir> <inventory> <snapshot>');
  validateLocalUri(uri);
  const audit = require('./core.cjs').evidence(fs.readFileSync(inventoryPath), fs.readFileSync(snapshotPath));
  privateDirectory(directory);
  const bundle = loadExport(exportPath);
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10000, retryWrites: false, appName: 'review-correction-local-only'
  });
  try {
    await client.connect();
    const result = command === 'seed-local'
      ? await seedLocal(client, bundle, audit)
      : command === 'apply-local'
        ? await performApply({ client, uri, exportPath, audit, directory })
        : await performRollback({ client, uri, exportPath, audit, directory });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    const detail = error.name === 'Error' ? error.message : `${error.name}; code=${Number(error.code) || 'unavailable'}`;
    console.error(`Standalone correction stopped safely: ${detail}`);
    process.exitCode = 1;
  });
}

module.exports = {
  validateLocalUri, loadExport, collect: readScopedState, seedLocal, stateHash,
  persistJournal, loadJournal, exactDocumentFilter, propertyFilter,
  sameFields, expectedStateWithStatus, performApply, performRollback
};
