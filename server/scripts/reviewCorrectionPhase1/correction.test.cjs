'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { CABIN, hash, evidence, prepare, snapshotHash, documentsHash } = require('./core.cjs');
const {
  encode, decode, clone, readState, backup, loadBundle, correct, targetIdentity,
  validateStagingUri, privateDirectory, writePrivate
} = require('./run.cjs');
const { ObjectId, BSON } = mongoose.mongo;

function loadFixture() {
  const directory = process.env.REVIEW_CORRECTION_AUDIT_DIR;
  assert.ok(directory, 'Set REVIEW_CORRECTION_AUDIT_DIR to the private, read-only 22 October audit directory');
  const inventory = fs.readFileSync(path.join(directory, 'generated-review-inventory.csv'));
  const snapshot = fs.readFileSync(path.join(directory, 'production-public-reviews.json'));
  const audit = evidence(inventory, snapshot);
  const rows = new Map();
  for (const pool of JSON.parse(snapshot)) {
    for (const review of pool.reviews) rows.set(review._id, review);
  }
  const native = row => {
    const out = structuredClone(row);
    for (const key of ['_id', 'cabinId', 'cabinTypeId', 'cabinTypeRef']) {
      if (typeof out[key] === 'string' && /^[a-f0-9]{24}$/.test(out[key])) out[key] = new ObjectId(out[key]);
    }
    for (const key of ['createdAt', 'updatedAt', 'createdAtSource', 'editedAt']) {
      if (out[key]) out[key] = new Date(out[key]);
    }
    return out;
  };
  const state = {
    reviews: [...rows.values()].map(native),
    cabins: JSON.parse(fs.readFileSync(path.join(directory, 'cabins-public.json'))).data.cabins.map(native),
    cabinTypes: JSON.parse(fs.readFileSync(path.join(directory, 'types-public.json'))).data.cabinTypes.map(native)
  };
  assert.equal(state.reviews.length, 487);
  // Test-only private fields exercise native BSON preservation; never invented guest testimonials.
  for (const row of state.reviews) {
    row.raw = { fixtureOnly: true, binary: new BSON.Binary(Buffer.from([0, 1, 255])),
      precise: BSON.Long.fromString('9007199254740993'), integerDouble: new BSON.Double(5),
      decimal: BSON.Decimal128.fromString('5.0000'), nullable: null };
    row.moderationNotes = 'LOCAL TEST METADATA ONLY';
    if (!Object.hasOwn(row, 'deletedAt')) row.deletedAt = null;
  }
  return { state, audit, inventory, snapshot };
}

test('Phase 1 local-only fixture verification (NOT staging)', { timeout: 180000 }, async t => {
  const fixture = loadFixture();
  const { state, audit } = fixture;
  const expectedCounts = [['The Cabin', 130, 5, 0], ['A-Frame', 0, null, 110],
    ['Stone House', 0, null, 97], ['Lux Cabin', 0, null, 150]];
  const plan = prepare(state, audit, encode, clone);
  assert.deepEqual(plan.report.map(row => [row.name, row.count, row.exactMean, row.archiveCount]), expectedCounts);
  assert.equal(plan.archive.length, 357);
  assert.equal(plan.after.reviews.length, 130);
  const cabinHash = documentsHash(state.reviews.filter(row => String(row.cabinId) === CABIN), encode);
  assert.equal(plan.cabinHash, cabinHash);
  const editedLux = plan.archive.find(row => String(row._id) === '69b30d37e5a5de4234265097');
  assert.ok(editedLux.editedAt);
  assert.equal(encode(editedLux), encode(state.reviews.find(row => String(row._id) === String(editedLux._id))));

  await t.test('pinned inventory, all fingerprints, owner links and new feedback fail closed', () => {
    assert.throws(() => evidence(Buffer.concat([fixture.inventory, Buffer.from('\n')]), fixture.snapshot), /hash mismatch/);
    assert.throws(() => evidence(fixture.inventory, Buffer.from('[]')), /hash mismatch/);
    for (const key of ['text', 'rating', 'reviewerName', 'externalId', 'source', 'createdAtSource', 'updatedAt', 'cabinId']) {
      const changed = clone(state);
      const row = changed.reviews.find(row => String(row._id) === audit.synthetic[0]._id);
      row[key] = key === 'rating' ? 3 : 'DRIFT';
      assert.throws(() => prepare(changed, audit, encode, clone), /fingerprint drift/);
    }
    const missing = clone(state);
    missing.reviews.pop();
    assert.throws(() => prepare(missing, audit, encode, clone), /Missing|drift/);
    const cabinChanged = clone(state);
    cabinChanged.reviews.find(row => String(row.cabinId) === CABIN).text = 'DRIFT';
    assert.throws(() => prepare(cabinChanged, audit, encode, clone), /fingerprint drift/);
    const added = clone(state);
    added.reviews.push({ _id: new ObjectId(), cabinId: new ObjectId(audit.synthetic[0].cabinId),
      text: 'LOCAL TEST ONLY', status: 'approved', rating: 1, deletedAt: null, source: 'manual' });
    assert.throws(() => prepare(added, audit, encode, clone), /Additional published records/);
    const ownership = clone(state);
    ownership.cabins.find(row => String(row._id) === '69d096b6bd7fb6fc0d3c2a34').inventoryType = 'single';
    ownership.cabins.find(row => String(row._id) === '69d096b6bd7fb6fc0d3c2a34').inventoryMode = 'single';
    assert.throws(() => prepare(ownership, audit, encode, clone), /reverse ownership drift/);
    const extraLinked = clone(state);
    extraLinked.cabins.push({ _id: new ObjectId(), cabinTypeId: new ObjectId('69b2ff947f141a71ffa7c401'),
      inventoryType: 'multi' });
    assert.throws(() => prepare(extraLinked, audit, encode, clone), /explicit allowlist/);
  });

  await t.test('generator fails before loading dependencies or opening a connection', () => {
    const retired = path.resolve(__dirname, '../generateValleyReviewsImproved.js');
    const source = fs.readFileSync(retired, 'utf8');
    assert.doesNotMatch(source, /require\(|mongoose|Math\.random|deleteMany|Review\.create/);
    const result = spawnSync(process.execPath, [retired], { encoding: 'utf8', env: {} });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /permanently retired/);
  });

  await t.test('nonlocal, production-like, implicit and misleading targets are rejected', () => {
    for (const uri of [
      'mongodb://127.0.0.1/production', 'mongodb://example.com/review_correction_staging_test',
      'mongodb+srv://example.com/review_correction_staging_test',
      'mongodb://127.0.0.1/production?appName=staging',
      'mongodb://127.0.0.1/', 'mongodb://localhost.evil/review_correction_staging_test'
    ]) assert.throws(() => validateStagingUri(uri));
  });

  const privateRoot = path.join(os.homedir(), '.local/state/drift-review-correction');
  fs.mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(privateRoot, 'local-test-'));
  fs.chmodSync(directory, 0o700);
  const repl = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ ip: '127.0.0.1' }]
  });
  const uri = repl.getUri(`review_correction_staging_local_test_${process.pid}`);
  const client = new mongoose.mongo.MongoClient(uri, { monitorCommands: true });
  const mutations = [];
  client.on('commandStarted', event => {
    if (['insert', 'update', 'delete', 'findAndModify'].includes(event.commandName)) mutations.push(event.commandName);
  });
  await client.connect();
  t.after(async () => {
    await client.close();
    await mongoose.disconnect();
    await repl.stop();
    // This path is a known test-owned private run directory, never an evidence source.
    fs.rmSync(directory, { recursive: true });
  });
  const db = client.db();
  const unrelated = { _id: new ObjectId(), fixtureOnly: true, value: 'UNRELATED LOCAL SENTINEL' };
  await db.collection('unrelated_local_sentinel').insertOne(unrelated);
  const extra = ['pending', 'hidden', 'approved'].map((status, index) => ({
    _id: new ObjectId(), cabinId: new ObjectId(audit.synthetic[0].cabinId),
    text: 'LOCAL TEST ONLY - NOT A TESTIMONIAL', source: 'manual', rating: index + 1,
    status, deletedAt: status === 'approved' ? new Date('2026-01-01') : null, raw: { fixture: true }
  }));
  extra.push({ _id: new ObjectId(), cabinId: new ObjectId(), source: 'import',
    rating: 1, text: 'LOCAL TEST ONLY', status: 'approved' }); // missing deletedAt and unrelated owner
  state.reviews.push(...extra);
  await db.collection('reviews').insertMany(state.reviews);
  await db.collection('cabins').insertMany(state.cabins);
  await db.collection('cabintypes').insertMany(state.cabinTypes);
  const initial = await readState(db);
  const initialHash = snapshotHash(initial, encode);
  const writesBeforeBackup = mutations.length;
  const backupReceipt = await backup(client, uri, directory);
  assert.equal(mutations.length, writesBeforeBackup, 'Backup must issue no MongoDB mutation commands');
  const bundle = loadBundle(backupReceipt.backup);

  await t.test('CLI plan is offline and CLI refuses production-like URI before connecting', () => {
    const config = {
      privateDirectory: directory, backup: backupReceipt.backup,
      inventory: path.join(process.env.REVIEW_CORRECTION_AUDIT_DIR, 'generated-review-inventory.csv'),
      snapshot: path.join(process.env.REVIEW_CORRECTION_AUDIT_DIR, 'production-public-reviews.json')
    };
    const configFile = writePrivate(directory, 'plan-config.json', JSON.stringify(config));
    const runner = path.join(__dirname, 'run.cjs');
    const result = spawnSync(process.execPath, [runner, 'plan', '--config', configFile], { encoding: 'utf8', env: {} });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).mode, 'offline-plan-NOT-staging');
    assert.deepEqual(JSON.parse(result.stdout).report.map(row =>
      [row.name, row.count, row.exactMean, row.archiveCount]), expectedCounts);
    const uriFile = writePrivate(directory, 'rejected-uri.txt', 'mongodb://127.0.0.1:1/production');
    const rejectedConfig = writePrivate(directory, 'rejected-config.json',
      JSON.stringify({ ...config, uriFile, exclusiveReviewOnlyStaging: true }));
    const rejected = spawnSync(process.execPath, [runner, 'apply-staging', '--config', rejectedConfig],
      { encoding: 'utf8', env: {} });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /Database name is not in the staging allowlist/);
  });

  await t.test('complete local backup includes every status, deleted and raw BSON with integrity and permissions', () => {
    assert.deepEqual(backupReceipt.counts, {
      reviews: 491, cabins: state.cabins.length, cabinTypes: state.cabinTypes.length
    });
    assert.equal(snapshotHash(bundle.state, encode), initialHash);
    assert.equal(hash(encode(bundle.state.reviews)), hash(encode(initial.reviews)));
    assert.ok(bundle.state.reviews[0].raw.integerDouble instanceof BSON.Double);
    assert.ok(bundle.state.reviews[0].raw.precise instanceof BSON.Long);
    assert.ok(bundle.state.reviews[0].raw.decimal instanceof BSON.Decimal128);
    assert.equal(fs.statSync(backupReceipt.backup).mode & 0o777, 0o600);
    assert.throws(() => writePrivate(directory, path.basename(backupReceipt.backup), 'overwrite'), /EEXIST/);
    assert.throws(() => privateDirectory(path.dirname(directory)), /Use a private run directory/);
    const damaged = writePrivate(directory, 'damaged.ejson', `${encode(bundle)} `);
    fs.copyFileSync(`${backupReceipt.backup}.manifest.json`, `${damaged}.manifest.json`);
    fs.chmodSync(`${damaged}.manifest.json`, 0o600);
    assert.throws(() => loadBundle(damaged), /integrity mismatch/);
  });

  await t.test('identity marker and cross-database backup checks precede any mutation', async () => {
    await assert.rejects(() => correct(client, uri, bundle, audit, directory), /identity marker/);
    const identity = await targetIdentity(client, uri, false);
    // A simulated marker exists only inside this test-owned ephemeral replica set.
    await db.collection('review_correction_environment').insertOne({
      _id: 'phase1', environment: 'staging', isolated: true, production: false, ...identity,
      approval: 'ISOLATED REVIEW-ONLY STAGING; NO PRODUCTION CONNECTION'
    });
    const wrong = clone(bundle);
    wrong.identity.database = 'different';
    await assert.rejects(() => correct(client, uri, wrong, audit, directory), /different database/);
    assert.equal(snapshotHash(await readState(db), encode), initialHash);
  });

  await t.test('private/raw drift since backup aborts the entire transaction', async () => {
    const row = initial.reviews[0];
    await db.collection('reviews').updateOne({ _id: row._id }, { $set: { raw: { changed: true } } });
    await assert.rejects(() => correct(client, uri, bundle, audit, directory), /Database drift/);
    assert.equal(await db.collection('reviews').countDocuments(), 491);
    await db.collection('reviews').replaceOne({ _id: row._id }, row);
  });

  await t.test('failure updating counters rolls back all 357 removals atomically', async () => {
    await db.command({ collMod: 'cabins', validator: { reviewsCount: { $ne: 130 } }, validationLevel: 'strict' });
    try {
      await assert.rejects(() => correct(client, uri, bundle, audit, directory), error => error.code === 121);
      assert.equal(snapshotHash(await readState(db), encode), initialHash);
      assert.equal(await db.collection('reviews').countDocuments(), 491);
    } finally {
      await db.command({ collMod: 'cabins', validator: {} });
    }
  });

  let receipt;
  await t.test('archive exactly 357, retain 130 Cabin documents and private originals, preserve every other record', async () => {
    receipt = await correct(client, uri, bundle, audit, directory);
    assert.equal(receipt.result, 'corrected-staging');
    assert.deepEqual(receipt.report.map(row => [row.name, row.count, row.exactMean, row.archiveCount]), expectedCounts);
    const after = await readState(db);
    assert.equal(after.reviews.length, 134);
    assert.equal(documentsHash(after.reviews.filter(row => String(row.cabinId) === CABIN), encode),
      documentsHash(initial.reviews.filter(row => String(row.cabinId) === CABIN), encode));
    for (const row of extra) {
      const initialRow = initial.reviews.find(item => String(item._id) === String(row._id));
      assert.equal(encode(after.reviews.find(item => String(item._id) === String(row._id))), encode(initialRow));
    }
    const archive = decode(fs.readFileSync(path.join(directory, `archive-${initialHash}.ejson`), 'utf8'));
    assert.equal(archive.records.length, 357);
    const expected = initial.reviews.filter(row => audit.synthetic.some(item => item._id === String(row._id)));
    assert.equal(documentsHash(archive.records, encode), documentsHash(expected, encode));
    assert.equal(snapshotHash(after, encode), receipt.afterHash);
    assert.equal(encode(await db.collection('unrelated_local_sentinel').findOne({ _id: unrelated._id })), encode(unrelated));
  });

  await t.test('public API pools and stored counters agree; archived private fields cannot be retrieved', async () => {
    await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.use('/api', require('../../routes/reviewRoutes'));
    for (const row of receipt.report) {
      for (const ownerId of row.ownerIds) {
        for (const minRating of [1, 2]) {
          const result = await request(app).get(`/api/cabins/${ownerId}/reviews?minRating=${minRating}&limit=100`);
          assert.equal(result.status, 200);
          assert.equal(result.body.data.total, row.count);
          assert.ok(result.body.data.items.every(item => !audit.synthetic.some(old => old._id === item._id)));
          assert.ok(result.body.data.items.every(item => !('raw' in item) && !('moderationNotes' in item)));
          if (row.count) {
            const second = await request(app).get(`/api/cabins/${ownerId}/reviews?minRating=${minRating}&limit=100&page=2`);
            assert.equal(result.body.data.items.length + second.body.data.items.length, 130);
          }
        }
        const property = await db.collection('cabins').findOne({ _id: new ObjectId(ownerId) }) ||
          await db.collection('cabintypes').findOne({ _id: new ObjectId(ownerId) });
        assert.equal(property.reviewsCount, row.count);
        assert.equal(property.averageRating, row.storedMean);
      }
    }
    const storedCabin = await db.collection('cabins').findOne({ _id: new ObjectId(CABIN) });
    assert.equal(storedCabin.reviewsCount, 130);
    assert.equal(storedCabin.averageRating, 5);
    assert.equal(await db.collection('reviews').countDocuments({ raw: { $exists: true } }), 133);
  });

  await t.test('archive corruption blocks further operations without any database writes', async () => {
    const archivePath = path.join(directory, `archive-${initialHash}.ejson`);
    const text = fs.readFileSync(archivePath, 'utf8');
    const writesBefore = mutations.length;
    fs.writeFileSync(archivePath, `${text}\n`);
    try {
      await assert.rejects(() => correct(client, uri, bundle, audit, directory), /archive mismatch/);
      assert.equal(mutations.length, writesBefore);
    } finally {
      fs.writeFileSync(archivePath, text);
    }
  });

  await t.test('second apply is an exact no-write no-op; rollback refuses drift and restores exact BSON', async () => {
    const hashAfter = snapshotHash(await readState(db), encode);
    const writesBefore = mutations.length;
    const second = await correct(client, uri, bundle, audit, directory);
    assert.equal(second.result, 'already-complete-no-writes');
    assert.equal(mutations.length, writesBefore, 'Repeat apply must issue no MongoDB mutation commands');
    assert.equal(snapshotHash(await readState(db), encode), hashAfter);
    const owner = await db.collection('cabins').findOne({ _id: new ObjectId(CABIN) });
    await db.collection('cabins').updateOne({ _id: owner._id }, { $set: { reviewsCount: 999 } });
    await assert.rejects(() => correct(client, uri, bundle, audit, directory, true), /Database drift/);
    await db.collection('cabins').replaceOne({ _id: owner._id }, owner);
    const restored = await correct(client, uri, bundle, audit, directory, true);
    assert.equal(restored.result, 'rolled-back-staging');
    assert.equal(snapshotHash(await readState(db), encode), initialHash);
    const writesBeforeRepeatRollback = mutations.length;
    assert.equal((await correct(client, uri, bundle, audit, directory, true)).result, 'already-complete-no-writes');
    assert.equal(mutations.length, writesBeforeRepeatRollback, 'Repeat rollback must issue no MongoDB mutation commands');
    assert.equal((await correct(client, uri, bundle, audit, directory)).result, 'corrected-staging');
  });

  console.log(JSON.stringify({
    verification: 'LOCAL EPHEMERAL FIXTURE ONLY; NOT STAGING; NOT A FULL PRODUCTION BACKUP',
    fixtureReviews: 491, auditSnapshotUniqueReviews: 487,
    archiveCount: receipt.archiveCount, pools: receipt.report,
    cabinDocumentsHash: receipt.cabinDocumentsHash, cabinUnchanged: true,
    repeatApply: 'no writes', rollback: 'exact full-state restoration; drift rejected'
  }));
});
