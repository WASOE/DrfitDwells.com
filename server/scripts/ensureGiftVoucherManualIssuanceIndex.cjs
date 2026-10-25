require('dotenv').config();
const mongoose = require('mongoose');
const GiftVoucher = require('../models/GiftVoucher');
const { assertManualIssuanceIndex } = require('../services/giftVouchers/issueManualVoucherService');

async function run({ apply = process.argv.includes('--apply') } = {}) {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Set MONGODB_URI or MONGO_URI explicitly; no database fallback is allowed');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false });
  try {
    const duplicates = await GiftVoucher.collection.aggregate([
      { $match: { manualIssuanceKey: { $type: 'string' } } },
      { $group: { _id: '$manualIssuanceKey', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $count: 'groups' }
    ]).toArray();
    if (duplicates.length) throw new Error('Duplicate manual issuance keys require manual review; no records were changed');
    const { keys, options } = GiftVoucher.MANUAL_ISSUANCE_INDEX;
    if (apply) {
      // Never drop/replace an existing index or mutate financial records.
      await GiftVoucher.collection.createIndex(keys, options);
    }
    try {
      await assertManualIssuanceIndex();
      console.log(`Verified ${options.name}`);
    } catch (error) {
      if (error.code !== 'MANUAL_ISSUANCE_INDEX_REQUIRED') throw error;
      console.log(`Index not ready. Review configuration, then rerun with --apply to create ${options.name}.`);
      throw error;
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { run };
