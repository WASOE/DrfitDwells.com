'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { EJSON, ObjectId } = mongoose.mongo.BSON;
const { evidence, hash, documentsHash, prepare } = require('./core.cjs');
const { readState, privateDirectory, encode } = require('./run.cjs');
const {
  validateLocalUri, loadExport, seedLocal, stateHash, performApply, performRollback
} = require('./standalone.cjs');

function loadAudit() {
  const directory = process.env.REVIEW_CORRECTION_AUDIT_DIR;
  assert.ok(directory, 'Set REVIEW_CORRECTION_AUDIT_DIR to the private original audit directory');
  return evidence(
    fs.readFileSync(path.join(directory, 'generated-review-inventory.csv')),
    fs.readFileSync(path.join(directory, 'production-public-reviews.json'))
  );
}

test('Standalone correction recovery against verified production export (isolated local Mongo only)', {
  timeout: 180000
}, async t => {
  const exportPath = process.env.REVIEW_CORRECTION_PRODUCTION_EXPORT;
  assert.ok(exportPath, 'Set REVIEW_CORRECTION_PRODUCTION_EXPORT to the private verified export');
  const bundle = loadExport(exportPath);
  const audit = loadAudit();
  const expected = prepare(bundle.state, audit, encode, value => EJSON.parse(encode(value)));
  const root = path.join(os.homedir(), '.local/state/drift-review-correction');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const directory = fs.mkdtempSync(path.join(root, 'actual-export-local-test-'));
  fs.chmodSync(directory, 0o700);
  const server = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1' } });
  const uri = `${server.getUri()}review_correction_local_real_export_${process.pid}`;
  assert.equal(validateLocalUri(uri), `review_correction_local_real_export_${process.pid}`);
  const client = new mongoose.mongo.MongoClient(uri, { monitorCommands: true });
  const mutationCommands = [];
  client.on('commandStarted', event => {
    if (['insert', 'update', 'delete', 'findAndModify'].includes(event.commandName)) mutationCommands.push(event.commandName);
  });
  await client.connect();
  t.after(async () => {
    await client.close();
    await server.stop();
    fs.rmSync(directory, { recursive: true });
  });
  const db = client.db();
  const hello = await db.admin().command({ hello: 1 });
  assert.equal(hello.setName, undefined, 'Test must use a standalone mongod');

  await t.test('real export seeds only 487 reviews and five projected stats/ownership documents', async () => {
    assert.equal(await seedLocal(client, bundle, audit).then(row => row.reviews), 487);
    assert.equal(await db.collection('reviews').countDocuments(), 487);
    assert.equal(await db.collection('cabins').countDocuments(), 4);
    assert.equal(await db.collection('cabintypes').countDocuments(), 1);
    assert.ok(mutationCommands.includes('insert'));
    const manifest = JSON.parse(fs.readFileSync(`${exportPath}.manifest.json`, 'utf8'));
    assert.equal(manifest.sha256, bundle.sha256);
  });

  const cabinIds = audit.cabin.map(row => row._id);
  const cabinHash = documentsHash(
    bundle.state.reviews.filter(row => String(row.cabinId) === audit.cabin[0].cabinId),
    encode
  );
  let unrelated;
  await t.test('partial unpublish and stats interruptions resume from durable journal', async () => {
    unrelated = {
      _id: new ObjectId(),
      cabinId: new ObjectId('69b2ff947f141a71ffa7c452'),
      source: 'manual',
      status: 'hidden',
      deletedAt: null,
      rating: 1,
      text: 'LOCAL TEST FIXTURE ONLY',
      marker: 'NON-TARGET HIDDEN RECORD'
    };
    await db.collection('reviews').insertOne(unrelated);
    const beforeCommands = mutationCommands.length;
    let interrupted = false;
    await assert.rejects(() => performApply({
      client, uri, exportPath, audit, directory,
      faultHook: async event => {
        if (!interrupted && event.point === 'after-review-hide') {
          interrupted = true;
          throw new Error('INJECTED_PROCESS_INTERRUPTION_AFTER_HIDE');
        }
      }
    }), /INJECTED_PROCESS_INTERRUPTION_AFTER_HIDE/);
    assert.equal(await db.collection('reviews').countDocuments(), 488);
    const resumed = await performApply({
      client, uri, exportPath, audit, directory,
      faultHook: async event => {
        if (event.point === 'after-property-update') throw new Error('INJECTED_PROCESS_INTERRUPTION_AFTER_STATS');
      }
    }).catch(error => {
      assert.match(error.message, /INJECTED_PROCESS_INTERRUPTION_AFTER_STATS/);
      return null;
    });
    assert.equal(resumed, null);
    const final = await performApply({ client, uri, exportPath, audit, directory });
    assert.equal(final.state, 'applied');
    assert.equal(final.archiveCount, 357);
    assert.equal(final.cabinDocumentsUnchanged, true);
    assert.ok(final.journalPath.endsWith('.journal.ejson'));
    assert.deepEqual(final.report.map(row => [
      row.name, row.archiveCount, row.count, row.ratingSum, row.exactMean, row.storedMean
    ]), [
      ['The Cabin', 0, 130, 650, 5, 5],
      ['A-Frame', 110, 0, 0, null, 0],
      ['Stone House', 97, 0, 0, null, 0],
      ['Lux Cabin', 150, 0, 0, null, 0]
    ]);
    assert.ok(mutationCommands.length > beforeCommands);

    const current = await db.collection('reviews').find({
      cabinId: new ObjectId(audit.cabin[0].cabinId)
    }).sort({ _id: 1 }).toArray();
    assert.equal(current.length, 130);
    assert.equal(documentsHash(current.filter(row => cabinIds.includes(String(row._id))), encode), cabinHash);
    assert.equal(encode(await db.collection('reviews').findOne({ _id: unrelated._id })), encode(unrelated));
    assert.equal(await db.collection('reviews').countDocuments({
      _id: { $in: expected.archive.map(row => row._id) }, status: 'hidden'
    }), 357);
    for (const stats of final.report) {
      for (const ownerId of stats.ownerIds) {
        const property = await db.collection('cabins').findOne({ _id: new ObjectId(ownerId) }) ||
          await db.collection('cabintypes').findOne({ _id: new ObjectId(ownerId) });
        assert.equal(property.reviewsCount, stats.count);
        assert.equal(property.averageRating, stats.storedMean);
      }
    }
  });

  await t.test('rollback resumes after partial restores and restores exact original exported records/statistics', async () => {
    let interrupted = false;
    await assert.rejects(() => performRollback({
      client, uri, exportPath, audit, directory,
      faultHook: async event => {
        if (!interrupted && event.point === 'after-review-restore') {
          interrupted = true;
          throw new Error('INJECTED_PROCESS_INTERRUPTION_AFTER_RESTORE');
        }
      }
    }), /INJECTED_PROCESS_INTERRUPTION_AFTER_RESTORE/);
    const rollback = await performRollback({ client, uri, exportPath, audit, directory });
    assert.equal(rollback.state, 'rolled-back');
    const restored = await db.collection('reviews').find({
      $or: [
        { _id: { $in: bundle.state.reviews.filter(row => String(row.cabinId) !== audit.cabin[0].cabinId).map(row => row._id) } },
        { cabinId: new ObjectId(audit.cabin[0].cabinId) }
      ]
    }).sort({ _id: 1 }).toArray();
    assert.equal(restored.length, 487);
    assert.equal(stateHash({
      reviews: restored,
      cabins: await Promise.all(bundle.state.cabins.map(row => db.collection('cabins').findOne({ _id: row._id }))),
      cabinTypes: await Promise.all(bundle.state.cabinTypes.map(row => db.collection('cabintypes').findOne({ _id: row._id })))
    }), stateHash(bundle.state));
    assert.equal(encode(await db.collection('reviews').findOne({ _id: unrelated._id })), encode(unrelated));
  });

  await t.test('target URI and export integrity gates reject unsafe production paths', () => {
    for (const uriCandidate of [
      'mongodb://prod-db.example/review_correction_local_test',
      'mongodb://127.0.0.1/production',
      'mongodb+srv://127.0.0.1/review_correction_local_test'
    ]) assert.throws(() => validateLocalUri(uriCandidate));
    assert.throws(() => loadExport(`${exportPath}.missing`));
  });
});
