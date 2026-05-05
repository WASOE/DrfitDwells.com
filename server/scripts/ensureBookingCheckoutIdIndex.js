/* eslint-disable no-console */
require('dotenv').config();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');

const INDEX_NAME = 'checkoutId_unique_non_empty';
const INDEX_KEY = { checkoutId: 1 };
const INDEX_PARTIAL = { checkoutId: { $type: 'string', $ne: '' } };

function canonical(value) {
  return JSON.stringify(value || {});
}

function sameKey(a, b) {
  return canonical(a) === canonical(b);
}

function samePartial(a, b) {
  return canonical(a) === canonical(b);
}

function isEquivalentIndex(ix) {
  return (
    ix &&
    sameKey(ix.key, INDEX_KEY) &&
    ix.unique === true &&
    samePartial(ix.partialFilterExpression, INDEX_PARTIAL)
  );
}

function findConflicts(indexes) {
  const conflicts = [];
  for (const ix of indexes) {
    if (!ix) continue;
    const hasSameName = ix.name === INDEX_NAME;
    const hasSameKey = sameKey(ix.key, INDEX_KEY);
    const equivalent = isEquivalentIndex(ix);
    if ((hasSameName || hasSameKey) && !equivalent) {
      conflicts.push(ix);
    }
  }
  return conflicts;
}

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);
  const collection = Booking.collection;

  try {
    const beforeIndexes = await collection.indexes();
    console.log('[ensure-booking-checkout-id-index] existing indexes:', beforeIndexes.map((ix) => ix.name));

    const equivalent = beforeIndexes.find(isEquivalentIndex);
    if (equivalent) {
      console.log(`[ensure-booking-checkout-id-index] already exists: ${equivalent.name}`);
      return;
    }

    const conflicts = findConflicts(beforeIndexes);
    if (conflicts.length > 0) {
      console.error('[ensure-booking-checkout-id-index] conflicting index configuration detected.');
      conflicts.forEach((ix) => {
        console.error(JSON.stringify({
          name: ix.name,
          key: ix.key,
          unique: ix.unique === true,
          partialFilterExpression: ix.partialFilterExpression || null
        }));
      });
      process.exitCode = 1;
      return;
    }

    const createdName = await collection.createIndex(INDEX_KEY, {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: INDEX_PARTIAL
    });
    console.log(`[ensure-booking-checkout-id-index] created index: ${createdName}`);

    const afterIndexes = await collection.indexes();
    const verified = afterIndexes.find((ix) => ix.name === INDEX_NAME && isEquivalentIndex(ix));
    if (!verified) {
      console.error('[ensure-booking-checkout-id-index] create attempted but verification failed.');
      process.exitCode = 1;
      return;
    }
    console.log(`[ensure-booking-checkout-id-index] verified index: ${verified.name}`);
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error('[ensure-booking-checkout-id-index] failed:', error?.message || String(error));
  process.exit(1);
});
