/* eslint-disable no-console */
/**
 * Backfill CreatorPartner.referral.ownedCodes to include the current referral.code.
 * Dry-run is a full ownership / unique-index safety audit (read-only).
 *
 * Usage (from server/):
 *   node scripts/backfillCreatorPartnerOwnedCodes.cjs --dry-run
 *   node scripts/backfillCreatorPartnerOwnedCodes.cjs --write
 *
 * Default is dry-run when neither flag is passed.
 *
 * Exit codes:
 *   0 — clean (no cross-partner ownership conflicts)
 *   1 — ownership conflicts or unexpected failure
 *
 * This process disables Mongoose automatic index creation for the connection only.
 * It never creates/syncs indexes.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
mongoose.set('autoIndex', false);

const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const { backfillCreatorPartnerOwnedCodes } = require('../services/creators/creatorReferralCodeService');

const write = process.argv.includes('--write');
const dryRun = !write;

function publicReport(result) {
  return {
    ok: result.ok !== false && !result.aborted,
    dryRun: result.dryRun,
    partnersScanned: result.partnersScanned,
    partnersNeedingBackfill: result.partnersNeedingBackfill,
    normalizedCodesScanned: result.normalizedCodesScanned,
    conflictsFound: result.conflictsFound,
    conflicts: result.conflicts,
    safeForUniqueIndex: result.safeForUniqueIndex,
    safeForBackfillWrite: result.safeForBackfillWrite,
    matched: result.matched,
    modified: result.modified,
    skipped: result.skipped,
    total: result.total,
    aborted: result.aborted,
    wrote: result.wrote,
    reason: result.reason || null
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    autoIndex: false
  });

  const result = await backfillCreatorPartnerOwnedCodes({ dryRun });
  const report = publicReport(result);
  console.log(JSON.stringify(report, null, 2));

  await mongoose.disconnect();

  if (!report.ok || report.conflictsFound > 0 || report.aborted) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
