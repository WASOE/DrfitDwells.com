/* eslint-disable no-console */
/**
 * One-time migration after adding compound unique index { cabinId, channel, unitId }:
 * 1) Drop legacy unique index on { cabinId, channel } if present
 * 2) Normalize missing unitId to null
 * 3) syncIndexes() from Mongoose model
 *
 * Run: MONGODB_URI=... node server/scripts/migrateCabinChannelSyncStateUnitIndex.js
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const CabinChannelSyncState = require('../models/CabinChannelSyncState');

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri);
  const coll = CabinChannelSyncState.collection;
  const indexes = await coll.indexes();
  const legacy = indexes.find((ix) => {
    const k = ix.key && Object.keys(ix.key).sort().join(',');
    return k === 'cabinId,channel' && ix.unique;
  });
  if (legacy) {
    await coll.dropIndex(legacy.name);
    console.log('Dropped legacy index:', legacy.name);
  } else {
    console.log('No legacy cabinId+channel unique index found (already migrated?).');
  }
  await CabinChannelSyncState.updateMany({ unitId: { $exists: false } }, { $set: { unitId: null } });
  console.log('Normalized unitId field.');
  await CabinChannelSyncState.syncIndexes();
  console.log('syncIndexes() complete.');
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
