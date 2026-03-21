/* eslint-disable no-console */
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { computeOpsReadiness } = require('../services/ops/readiness/opsReadinessService');
const { applyCutoverTargetsFromReadiness } = require('../services/ops/cutover/opsCutoverService');

async function run() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    const readiness = await computeOpsReadiness();
    await applyCutoverTargetsFromReadiness(readiness.readinessByModule);

    console.log(JSON.stringify({ success: true, batch: 'cutover-apply-initial', computedAt: readiness.computedAt }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ success: false, batch: 'cutover-apply-initial', error: error.message }, null, 2));
  process.exit(1);
});

