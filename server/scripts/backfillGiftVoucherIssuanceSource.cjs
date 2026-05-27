/* eslint-disable no-console */
/**
 * Backfill GiftVoucher.issuanceSource = purchase for legacy rows missing the field.
 * Safe to re-run (only updates rows without issuanceSource).
 *
 * Usage:
 *   node scripts/backfillGiftVoucherIssuanceSource.cjs
 *   node scripts/backfillGiftVoucherIssuanceSource.cjs --dry-run
 */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const GiftVoucher = require('../models/GiftVoucher');
const { ISSUANCE_SOURCE_PURCHASE } = require('../services/giftVouchers/giftVoucherIssuance');

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const uri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });

  const filter = {
    $or: [{ issuanceSource: { $exists: false } }, { issuanceSource: null }]
  };

  const matchedCount = await GiftVoucher.countDocuments(filter);
  let modifiedCount = 0;

  if (!dryRun && matchedCount > 0) {
    const result = await GiftVoucher.updateMany(filter, {
      $set: { issuanceSource: ISSUANCE_SOURCE_PURCHASE }
    });
    modifiedCount = result.modifiedCount ?? result.nModified ?? 0;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        matchedCount,
        modifiedCount: dryRun ? 0 : modifiedCount,
        issuanceSource: ISSUANCE_SOURCE_PURCHASE
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
