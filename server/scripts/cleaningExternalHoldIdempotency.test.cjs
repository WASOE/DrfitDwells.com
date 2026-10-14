'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  preflightCleaningRecordIndexes,
  applyCleaningRecordIndexMigration,
  EXTERNAL_HOLD_INDEX_NAME
} = require('../services/cleaning/cleaningRecordIndexMigration');
const {
  createOrGetExternalHoldCleaningRecord
} = require('../services/ops/cleaning/externalHoldCleaningRecordService');

let mongoServer;
let mongoose;
let CleaningRecord;

test('external-hold creation remains unique under concurrent requests', async (t) => {
  mongoServer = await MongoMemoryServer.create();
  mongoose = require('mongoose');
  mongoose.set('autoIndex', false);
  mongoose.set('autoCreate', false);
  await mongoose.connect(mongoServer.getUri(), {
    autoIndex: false,
    autoCreate: false
  });
  CleaningRecord = require('../models/CleaningRecord');

  t.after(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  await CleaningRecord.createCollection();
  const collection = CleaningRecord.collection;
  const legacyRows = Array.from({ length: 43 }, (_, index) => ({
    sourceKind: 'booking',
    sourceId: '',
    cleaningDate: new Date('2026-10-14T00:00:00.000Z'),
    legacySequence: index
  }));
  await collection.insertMany(legacyRows);

  const preflight = await preflightCleaningRecordIndexes(collection);
  assert.equal(preflight.safe, true);
  assert.equal(preflight.indexScopeCount, 0);
  assert.equal(preflight.duplicateGroups, 0);
  assert.equal(preflight.externalHoldIndexPresent, false);
  assert.deepEqual(await applyCleaningRecordIndexMigration(collection, preflight), {
    createdExternalHoldIndex: true
  });
  assert.equal((await collection.indexes()).some((index) => index.name === EXTERNAL_HOLD_INDEX_NAME), true);
  const postMigrationPreflight = await preflightCleaningRecordIndexes(collection);
  assert.equal(postMigrationPreflight.safe, true);
  assert.equal(postMigrationPreflight.externalHoldIndexPresent, true);

  const blockId = new mongoose.Types.ObjectId();
  const insert = {
    sourceKind: 'external_hold',
    sourceId: String(blockId),
    bookingId: null,
    availabilityBlockId: blockId,
    sourceReference: 'airbnb_ical:test-hold',
    cabinId: new mongoose.Types.ObjectId(),
    cabinTypeId: null,
    unitId: null,
    cleaningDate: new Date('2026-10-15T00:00:00.000Z'),
    paymentStatus: 'unpaid'
  };
  const records = await Promise.all(
    Array.from({ length: 32 }, () =>
      createOrGetExternalHoldCleaningRecord(CleaningRecord, insert)
    )
  );

  assert.equal(new Set(records.map((record) => String(record._id))).size, 1);
  assert.equal(
    await CleaningRecord.countDocuments({
      availabilityBlockId: blockId,
      cleaningDate: insert.cleaningDate
    }),
    1
  );
  assert.equal(await collection.countDocuments({}), 44);

  const rerun = await createOrGetExternalHoldCleaningRecord(CleaningRecord, insert);
  assert.equal(String(rerun._id), String(records[0]._id));
  assert.equal(await collection.countDocuments({}), 44);

  rerun.status = 'cleaned';
  rerun.paymentStatus = 'paid';
  await rerun.save();
  const repeatAfterStatusChanges = await createOrGetExternalHoldCleaningRecord(
    CleaningRecord,
    insert
  );
  assert.equal(String(repeatAfterStatusChanges._id), String(rerun._id));
  assert.equal(repeatAfterStatusChanges.status, 'cleaned');
  assert.equal(repeatAfterStatusChanges.paymentStatus, 'paid');

  repeatAfterStatusChanges.cleaningDate = new Date('2026-10-16T00:00:00.000Z');
  await repeatAfterStatusChanges.save();
  assert.equal(
    await CleaningRecord.countDocuments({ availabilityBlockId: blockId }),
    1
  );
});
