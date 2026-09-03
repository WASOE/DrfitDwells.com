/* eslint-disable no-console */
/**
 * Deliberately create the CreatorPartner unique multikey index on referral.ownedCodes.
 *
 * Usage (from server/):
 *   node scripts/ensureCreatorPartnerOwnedCodesIndex.cjs
 *
 * Steps:
 *   1. Connect with autoIndex disabled
 *   2. Run full ownership safety audit (read-only)
 *   3. Refuse create if conflicts exist
 *   4. Create only { 'referral.ownedCodes': 1 } unique: true
 *   5. Verify after create
 *
 * Never invoked from API startup. Do not run against production unless intentionally approved.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
mongoose.set('autoIndex', false);

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const {
  ensureCreatorPartnerOwnedCodesUniqueIndex
} = require('../services/creators/creatorPartnerOwnedCodesIndex');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    autoIndex: false
  });

  // Ensure model is registered before touching the collection.
  require('../models/CreatorPartner');

  const result = await ensureCreatorPartnerOwnedCodesUniqueIndex();
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        created: result.created,
        alreadyPresent: result.alreadyPresent || false,
        reason: result.reason || null,
        indexName: result.indexName || result.index?.name || null,
        index: result.index
          ? { name: result.index.name, key: result.index.key, unique: result.index.unique }
          : null,
        audit: result.audit
          ? {
              partnersScanned: result.audit.partnersScanned,
              partnersNeedingBackfill: result.audit.partnersNeedingBackfill,
              normalizedCodesScanned: result.audit.normalizedCodesScanned,
              conflictsFound: result.audit.conflictsFound,
              safeForUniqueIndex: result.audit.safeForUniqueIndex,
              safeForBackfillWrite: result.audit.safeForBackfillWrite,
              conflicts: result.audit.conflicts
            }
          : null
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
