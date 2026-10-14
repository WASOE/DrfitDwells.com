'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startApiProcess } = require('../bootstrap/startApiProcess');
const {
  LEGACY_INDEX_NAME,
  LEGACY_INDEX_KEYS,
  SOURCE_INDEX_NAME,
  SOURCE_INDEX_KEYS,
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
            const key = JSON.stringify([
              record.sourceKind,
              record.sourceId,
              record.cleaningDate
            ]);
            identities.set(key, (identities.get(key) || 0) + 1);
          }
          const duplicateGroups = [...identities.values()].filter((count) => count > 1).length;
          return duplicateGroups ? [{ duplicateGroups }] : [];
        }
      };
    },
    async countDocuments() {
      return records.filter((record) =>
        !record.sourceKind || !record.sourceId || !record.cleaningDate
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
    name: LEGACY_INDEX_NAME,
    key: LEGACY_INDEX_KEYS,
    unique: true
  };
  const cleaningRecords = [
    { sourceKind: 'external_hold', sourceId: 'hold-a', cleaningDate: '2026-10-14' },
    { sourceKind: 'external_hold', sourceId: 'hold-b', cleaningDate: '2026-10-14' },
    { sourceKind: 'booking', sourceId: 'booking-a', cleaningDate: '2026-10-14' },
    { sourceKind: 'booking', sourceId: 'booking-a', cleaningDate: '2026-10-14' }
  ];
  const collection = createCleaningCollection({
    indexes: [legacyIndex],
    records: cleaningRecords
  });
  const originalIndexes = JSON.stringify(await collection.indexes());
  const originalRecords = JSON.stringify(cleaningRecords);
  const report = await preflightCleaningRecordIndexes(collection);
  assert.equal(report.safe, false);
  assert.equal(report.legacyIndexPresent, true);
  assert.equal(report.duplicateGroups, 1);

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
  assert.match(readServerSource('routes/ops/modules/cleaningRoutes.js'), /CleaningRecord\.create/);
});

test('CleaningRecord index migration fails closed and creates replacement before dropping legacy', async () => {
  const duplicateCollection = createCleaningCollection({
    indexes: [{ name: LEGACY_INDEX_NAME, key: LEGACY_INDEX_KEYS, unique: true }],
    records: [
      { sourceKind: 'booking', sourceId: 'booking-a', cleaningDate: '2026-10-14' },
      { sourceKind: 'booking', sourceId: 'booking-a', cleaningDate: '2026-10-14' }
    ]
  });
  const unsafe = await preflightCleaningRecordIndexes(duplicateCollection);
  await assert.rejects(
    applyCleaningRecordIndexMigration(duplicateCollection, unsafe),
    /preflight failed/
  );
  assert.deepEqual(duplicateCollection.calls, []);

  const safeCollection = createCleaningCollection({
    indexes: [{ name: LEGACY_INDEX_NAME, key: LEGACY_INDEX_KEYS, unique: true }],
    records: [],
    allowDdl: true
  });
  const safe = await preflightCleaningRecordIndexes(safeCollection);
  assert.equal(safe.safe, true);
  assert.equal(safe.sourceIndexPresent, false);
  const result = await applyCleaningRecordIndexMigration(safeCollection, safe);
  assert.deepEqual(result, { createdSourceIndex: true, droppedLegacyIndex: true });
  assert.deepEqual(
    safeCollection.calls.map((call) => call.method),
    ['createIndex', 'dropIndex']
  );
  assert.deepEqual(safeCollection.calls[0], {
    method: 'createIndex',
    keys: SOURCE_INDEX_KEYS,
    options: { unique: true, name: SOURCE_INDEX_NAME }
  });

  const collatedIndex = createCleaningCollection({
    indexes: [{
      name: SOURCE_INDEX_NAME,
      key: SOURCE_INDEX_KEYS,
      unique: true,
      collation: { locale: 'en' }
    }],
    records: []
  });
  const collated = await preflightCleaningRecordIndexes(collatedIndex);
  assert.equal(collated.safe, false);
  assert.match(collated.issues.join(' '), /unexpected index definition/);
});
