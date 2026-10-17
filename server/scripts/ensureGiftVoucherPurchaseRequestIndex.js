/* eslint-disable no-console */
require('dotenv').config();

const mongoose = require('mongoose');
const crypto = require('crypto');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const GiftVoucher = require('../models/GiftVoucher');

const INDEX_NAME = 'gift_voucher_purchase_request_unique';
const INDEX_KEY = { purchaseRequestId: 1 };
const INDEX_PARTIAL = { purchaseRequestId: { $type: 'string' } };

function canonical(value) {
  return JSON.stringify(value || {});
}

function isEquivalentIndex(index) {
  return Boolean(
    index &&
    canonical(index.key) === canonical(INDEX_KEY) &&
    index.unique === true &&
    canonical(index.partialFilterExpression) === canonical(INDEX_PARTIAL)
  );
}

function findConflicts(indexes) {
  return indexes.filter((index) => {
    const sameName = index.name === INDEX_NAME;
    const sameKey = canonical(index.key) === canonical(INDEX_KEY);
    return (
      !isEquivalentIndex(index) &&
      (sameName || (sameKey && index.unique === true))
    );
  });
}

async function findDuplicatePurchaseRequestIds(collection) {
  const cursor = collection.aggregate([
    { $match: { purchaseRequestId: { $type: 'string' } } },
    {
      $group: {
        _id: '$purchaseRequestId',
        count: { $sum: 1 }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);
  const samples = [];
  let count = 0;
  for await (const duplicate of cursor) {
    count += 1;
    if (samples.length < 100) samples.push(duplicate);
  }
  return { count, samples };
}

function printIndex(index) {
  return {
    name: index.name,
    key: index.key,
    unique: index.unique === true,
    partialFilterExpression: index.partialFilterExpression || null
  };
}

async function run({ apply = process.argv.includes('--apply') } = {}) {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error(`Set MONGODB_URI or MONGO_URI explicitly; refusing the local fallback ${DEFAULT_MONGO_URI}`);
  }
  await mongoose.connect(mongoUri, { autoIndex: false, autoCreate: false });
  const collection = GiftVoucher.collection;

  try {
    const [duplicateSummary, indexes] = await Promise.all([
      findDuplicatePurchaseRequestIds(collection),
      collection.indexes()
    ]);
    console.log(`[ensure-gift-voucher-purchase-request-index] duplicate purchaseRequestId groups: ${duplicateSummary.count}`);
    if (duplicateSummary.count) {
      duplicateSummary.samples.forEach((duplicate) => {
        const digest = crypto
          .createHash('sha256')
          .update(String(duplicate._id))
          .digest('hex')
          .slice(0, 12);
        console.log(`  id-sha256:${digest} count=${duplicate.count}`);
      });
      console.error('[ensure-gift-voucher-purchase-request-index] duplicate samples are capped at 100; manual financial-record reconciliation is required and no records were changed.');
      process.exitCode = 1;
      return;
    }

    console.log('[ensure-gift-voucher-purchase-request-index] existing indexes:', indexes.map(printIndex));
    const equivalent = indexes.find(isEquivalentIndex);
    if (equivalent) {
      console.log(`[ensure-gift-voucher-purchase-request-index] verified existing index: ${equivalent.name}`);
      return;
    }

    const conflicts = findConflicts(indexes);
    if (conflicts.length) {
      console.error('[ensure-gift-voucher-purchase-request-index] conflicting unique index configuration requires manual review.');
      conflicts.forEach((index) => console.error(JSON.stringify(printIndex(index))));
      process.exitCode = 1;
      return;
    }

    if (!apply) {
      console.log(`[ensure-gift-voucher-purchase-request-index] read-only preflight passed; rerun with --apply to create ${INDEX_NAME}.`);
      return;
    }

    const createdName = await collection.createIndex(INDEX_KEY, {
      unique: true,
      name: INDEX_NAME,
      partialFilterExpression: INDEX_PARTIAL
    });
    const verified = (await collection.indexes()).find(isEquivalentIndex);
    if (!verified || verified.name !== createdName) {
      console.error('[ensure-gift-voucher-purchase-request-index] index creation attempted but verification failed.');
      process.exitCode = 1;
      return;
    }
    console.log(`[ensure-gift-voucher-purchase-request-index] created and verified index: ${verified.name}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[ensure-gift-voucher-purchase-request-index] failed:', error?.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  INDEX_NAME,
  INDEX_KEY,
  INDEX_PARTIAL,
  isEquivalentIndex,
  findConflicts,
  findDuplicatePurchaseRequestIds,
  run
};
