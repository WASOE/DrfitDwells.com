'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INDEX_NAME,
  INDEX_KEY,
  INDEX_PARTIAL_FILTER,
  indexMatches,
  inspectManualBlockConversionIndex,
  applyManualBlockConversionIndex
} = require('../services/ops/domain/manualBlockConversionIndexService');

function exactIndex() {
  return {
    name: INDEX_NAME,
    key: { ...INDEX_KEY },
    unique: true,
    partialFilterExpression: { ...INDEX_PARTIAL_FILTER }
  };
}

function fakeCollection({ indexes = [], duplicates = [] } = {}) {
  return {
    createCalls: 0,
    async indexes() {
      return indexes;
    },
    aggregate() {
      return { toArray: async () => duplicates };
    },
    async createIndex(key, options) {
      this.createCalls += 1;
      indexes.push({ name: options.name, key, unique: options.unique, partialFilterExpression: options.partialFilterExpression });
      return options.name;
    }
  };
}

test('conversion index accepts only the exact named unique partial specification', () => {
  assert.equal(indexMatches(exactIndex()), true);
  assert.equal(indexMatches({ ...exactIndex(), unique: false }), false);
  assert.equal(indexMatches({ ...exactIndex(), partialFilterExpression: {} }), false);
  assert.equal(indexMatches({ ...exactIndex(), key: { other: 1 } }), false);
  assert.equal(indexMatches({ ...exactIndex(), name: 'other' }), false);
});

test('preflight identifies a missing index', async () => {
  const report = await inspectManualBlockConversionIndex({ collection: fakeCollection() });
  assert.equal(report.indexStatus, 'missing');
  assert.equal(report.exact, false);
});

test('preflight identifies a malformed same-key index', async () => {
  const report = await inspectManualBlockConversionIndex({
    collection: fakeCollection({ indexes: [{ ...exactIndex(), unique: false }] })
  });
  assert.equal(report.indexStatus, 'wrong');
  assert.equal(report.exact, false);
});

test('preflight reports duplicate source-block provenance values', async () => {
  const report = await inspectManualBlockConversionIndex({
    collection: fakeCollection({
      indexes: [exactIndex()],
      duplicates: [{ _id: '507f1f77bcf86cd799439011', count: 2 }]
    })
  });
  assert.equal(report.exact, true);
  assert.equal(report.duplicateCount, 1);
});

test('cutover defaults to dry-run and apply verifies exact created index', async () => {
  const collection = fakeCollection();
  const dryRun = await applyManualBlockConversionIndex({ collection });
  assert.equal(dryRun.mode, 'dry_run');
  assert.equal(collection.createCalls, 0);
  const applied = await applyManualBlockConversionIndex({ collection, apply: true });
  assert.equal(applied.mode, 'applied');
  assert.equal(applied.after.exact, true);
  assert.equal(collection.createCalls, 1);
});

test('cutover refuses duplicate data and never creates an index', async () => {
  const collection = fakeCollection({ duplicates: [{ _id: '507f1f77bcf86cd799439011', count: 2 }] });
  await assert.rejects(
    applyManualBlockConversionIndex({ collection, apply: true }),
    (error) => error.code === 'MANUAL_BLOCK_CONVERSION_DUPLICATES'
  );
  assert.equal(collection.createCalls, 0);
});
