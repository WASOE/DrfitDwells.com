#!/usr/bin/env node
/**
 * Backfill public slugs on single-unit Cabin documents.
 * Run once after deploy: node server/scripts/backfillCabinSlugs.cjs
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const {
  STAY_SLUGS,
  KNOWN_CABIN_ID_TO_SLUG,
  resolveCabinSlugFromDoc,
  slugForCabinName
} = require('../utils/staySlug');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const cabins = await Cabin.find({ isActive: true });
  let updated = 0;

  for (const cabin of cabins) {
    const id = String(cabin._id);
    const targetSlug =
      KNOWN_CABIN_ID_TO_SLUG[id] ||
      slugForCabinName(cabin.name) ||
      resolveCabinSlugFromDoc(cabin);

    if (!targetSlug || !Object.values(STAY_SLUGS).includes(targetSlug)) {
      continue;
    }

    if (cabin.slug === targetSlug) {
      console.log(`skip ${cabin.name} (${id}) — already ${targetSlug}`);
      continue;
    }

    cabin.slug = targetSlug;
    await cabin.save();
    updated += 1;
    console.log(`updated ${cabin.name} (${id}) → slug=${targetSlug}`);
  }

  console.log(`Done. Updated ${updated} cabin(s).`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
