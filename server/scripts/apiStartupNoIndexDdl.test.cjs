'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApiProcess } = require('../bootstrap/startApiProcess');
const {
  EXTERNAL_HOLD_INDEX_NAME,
  EXTERNAL_HOLD_INDEX_KEYS,
  EXTERNAL_HOLD_INDEX_FILTER,
  EXTERNAL_HOLD_INDEX_COLLATION,
  preflightCleaningRecordIndexes,
  applyCleaningRecordIndexMigration
} = require('../services/cleaning/cleaningRecordIndexMigration');

const SERVER_DIR = path.join(__dirname, '..');
const readServerSource = (file) =>
  fs.readFileSync(path.join(SERVER_DIR, file), 'utf8');

function createCleaningCollection({ indexes, records, allowDdl = false }) {
  const calls = [];
  return {
    calls,
    async indexes() {
      return indexes;
    },
    aggregate() {
      return {
        async toArray() {
          const identities = new Map();
          for (const record of records) {
            if (!record.availabilityBlockId || !record.cleaningDate) continue;
            const key = JSON.stringify([record.availabilityBlockId.id, record.cleaningDate]);
            identities.set(key, (identities.get(key) || 0) + 1);
          }
          const duplicateGroups = [...identities.values()].filter((count) => count > 1).length;
          return duplicateGroups ? [{ duplicateGroups }] : [];
        }
      };
    },
    async countDocuments(filter) {
      if (filter.availabilityBlockId) {
        return records.filter((record) =>
          record.availabilityBlockId?.type === 'objectId' &&
          record.cleaningDate instanceof Date
        ).length;
      }
      if (filter.$and) {
        return records.filter((record) =>
          record.availabilityBlockId?.type === 'objectId' &&
          record.cleaningDate instanceof Date &&
          record.sourceKind !== 'external_hold'
        ).length;
      }
      return records.filter((record) =>
        record.sourceKind === 'external_hold' &&
        (!record.availabilityBlockId || !record.sourceId || !record.cleaningDate)
      ).length;
    },
    async createIndex(keys, options) {
      calls.push({ method: 'createIndex', keys, options });
      if (!allowDdl) throw new Error('API startup must not create indexes');
      return options.name;
    },
    async dropIndex() {
      calls.push({ method: 'dropIndex' });
      if (!allowDdl) throw new Error('API startup must not drop indexes');
      return 'dropped';
    },
    async syncIndexes() {
      calls.push('syncIndexes');
      throw new Error('API startup must not sync indexes');
    }
  };
}

test('API startup has no index DDL or Mongoose auto-creation', async () => {
  const server = readServerSource('server.js');
  const database = readServerSource('config/database.js');
  const startup = readServerSource('bootstrap/startApiProcess.js');
  assert.doesNotMatch(server, /\.(?:createIndex|dropIndex|syncIndexes|ensureIndexes)\s*\(/);
  assert.match(server, /process\.env\.API_HOST/);
  assert.match(database, /mongoose\.set\('autoIndex', false\)/);
  assert.match(database, /mongoose\.set\('autoCreate', false\)/);
  assert.match(database, /autoIndex:\s*false/);
  assert.match(database, /autoCreate:\s*false/);
  require('../config/database');
  const mongoose = require('mongoose');
  assert.equal(mongoose.get('autoIndex'), false);
  assert.equal(mongoose.get('autoCreate'), false);
  assert.doesNotMatch(startup, /\.(?:createIndex|dropIndex|syncIndexes|ensureIndexes)\s*\(/);

  const legacyIndex = {
    name: 'bookingId_1_cleaningDate_1',
    key: { bookingId: 1, cleaningDate: 1 },
    unique: true
  };
  const legacyRecords = Array.from({ length: 43 }, (_, index) => ({
    sourceKind: 'booking',
    sourceId: '',
    cleaningDate: null,
    _id: `legacy-${index}`
  }));
  const cleaningRecords = [
    ...legacyRecords,
    {
      sourceKind: 'external_hold',
      sourceId: 'hold-a',
      availabilityBlockId: { type: 'objectId', id: 'hold-a' },
      cleaningDate: new Date('2026-10-14T00:00:00.000Z')
    }
  ];
  const collection = createCleaningCollection({
    indexes: [legacyIndex],
    records: cleaningRecords
  });
  const originalIndexes = JSON.stringify(await collection.indexes());
  const originalRecords = JSON.stringify(cleaningRecords);
  const report = await preflightCleaningRecordIndexes(collection);
  assert.equal(report.safe, true);
  assert.equal(report.externalHoldIndexPresent, false);
  assert.equal(report.indexScopeCount, 1);
  assert.equal(report.duplicateGroups, 0);

  const events = [];
  await startApiProcess({
    connectDbFn: async () => ({ db: true }),
    assertAuthorityBootFn: async () => ({ required: false }),
    env: { CABIN_NIGHT_CLAIM_MODE: 'off' },
    startPostConnectRuntimeFn: () => events.push('runtime'),
    startHttpListenerFn: () => {
      events.push('listen');
      return { listening: true };
    },
    logInfo: () => {},
    logError: assert.fail
  });

  assert.deepEqual(events, ['runtime', 'listen']);
  assert.deepEqual(collection.calls, []);
  assert.equal(JSON.stringify(await collection.indexes()), originalIndexes);
  assert.equal(JSON.stringify(cleaningRecords), originalRecords);
  assert.match(
    readServerSource('routes/ops/modules/cleaningRoutes.js'),
    /createOrGetExternalHoldCleaningRecord/
  );
});

test('external-hold index migration fails closed and preserves legacy indexes', async () => {
  const duplicateCollection = createCleaningCollection({
    indexes: [],
    records: [
      {
        sourceKind: 'external_hold',
        sourceId: 'hold-a',
        availabilityBlockId: { type: 'objectId', id: 'hold-a' },
        cleaningDate: new Date('2026-10-14T00:00:00.000Z')
      },
      {
        sourceKind: 'external_hold',
        sourceId: 'hold-a',
        availabilityBlockId: { type: 'objectId', id: 'hold-a' },
        cleaningDate: new Date('2026-10-14T00:00:00.000Z')
      }
    ]
  });
  const unsafe = await preflightCleaningRecordIndexes(duplicateCollection);
  await assert.rejects(
    applyCleaningRecordIndexMigration(duplicateCollection, unsafe),
    /preflight failed/
  );
  assert.deepEqual(duplicateCollection.calls, []);

  const safeCollection = createCleaningCollection({
    indexes: [{
      name: 'availabilityBlockId_1',
      key: { availabilityBlockId: 1 },
      unique: false
    }, {
      name: 'bookingId_1_cleaningDate_1',
      key: { bookingId: 1, cleaningDate: 1 },
      unique: true,
      partialFilterExpression: { bookingId: { $type: 'objectId' } }
    }],
    records: [{
      sourceKind: 'external_hold',
      sourceId: 'hold-a',
      availabilityBlockId: { type: 'objectId', id: 'hold-a' },
      cleaningDate: new Date('2026-10-14T00:00:00.000Z')
    }],
    allowDdl: true
  });
  const safe = await preflightCleaningRecordIndexes(safeCollection);
  assert.equal(safe.safe, true);
  assert.equal(safe.externalHoldIndexPresent, false);
  const result = await applyCleaningRecordIndexMigration(safeCollection, safe);
  assert.deepEqual(result, { createdExternalHoldIndex: true });
  assert.deepEqual(
    safeCollection.calls.map((call) => call.method),
    ['createIndex']
  );
  assert.deepEqual(safeCollection.calls[0], {
    method: 'createIndex',
    keys: EXTERNAL_HOLD_INDEX_KEYS,
    options: {
      unique: true,
      name: EXTERNAL_HOLD_INDEX_NAME,
      partialFilterExpression: EXTERNAL_HOLD_INDEX_FILTER,
      collation: EXTERNAL_HOLD_INDEX_COLLATION
    }
  });

  const collatedIndex = createCleaningCollection({
    indexes: [{
      name: EXTERNAL_HOLD_INDEX_NAME,
      key: EXTERNAL_HOLD_INDEX_KEYS,
      unique: true,
      partialFilterExpression: EXTERNAL_HOLD_INDEX_FILTER,
      collation: { locale: 'en' }
    }],
    records: []
  });
  const collated = await preflightCleaningRecordIndexes(collatedIndex);
  assert.equal(collated.safe, false);
  assert.match(collated.issues.join(' '), /unexpected definition/);
});
