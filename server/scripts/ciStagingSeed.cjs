/**
 * Synthetic inventory for the ephemeral CI database only.
 * Refuses any URI that is not the loopback CI database.
 */
const mongoose = require('mongoose');
const { assertReleaseCiStagingEnv, DATABASE_NAME } = require('../config/assertReleaseCiStaging');

async function main() {
  assertReleaseCiStagingEnv();
  const uri = process.env.MONGODB_URI;
  let connected = false;
  for (let attempt = 1; attempt <= 20 && !connected; attempt += 1) {
    try {
      await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 2000 });
      connected = true;
    } catch (error) {
      await mongoose.disconnect().catch(() => {});
      if (attempt === 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (mongoose.connection.name !== DATABASE_NAME) {
    throw new Error(`Connected to ${mongoose.connection.name}, not ${DATABASE_NAME}.`);
  }
  if (process.argv.includes('--drop')) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    return;
  }

  const Cabin = require('../models/Cabin');
  const GiftVoucher = require('../models/GiftVoucher');
  const CreatorPartner = require('../models/CreatorPartner');

  await Cabin.deleteMany({ slug: 'ci-staging-cabin' });
  await Cabin.create({
    name: 'CI Staging Cabin',
    slug: 'ci-staging-cabin',
    description: 'Synthetic cabin used only by the isolated release-safety database.',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/ci-staging/cabin.jpg',
    location: 'Isolated CI staging',
    isActive: true,
    archivedAt: null,
    inventoryMode: 'single'
  });

  await GiftVoucher.collection.createIndex(
    { purchaseRequestId: 1 },
    {
      unique: true,
      name: 'gift_voucher_purchase_request_unique',
      partialFilterExpression: { purchaseRequestId: { $type: 'string' } }
    }
  );
  await CreatorPartner.collection.createIndex(
    { 'referral.ownedCodes': 1 },
    { unique: true, name: 'referral_ownedCodes_1' }
  );
  await mongoose.connection.db.collection('cistagingruns').updateOne(
    { _id: 'current' },
    { $set: { runId: String(process.env.CI_STAGING_RUN_ID || ''), createdAt: new Date() } },
    { upsert: true }
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(String(error.message || error).replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]'));
  process.exit(1);
});
