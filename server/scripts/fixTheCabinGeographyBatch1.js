#!/usr/bin/env node
/**
 * Idempotent content fix: remove outdated Pirin geography for The Cabin.
 *
 * Does NOT change slugs, IDs, pricing, inventory, or booking contracts.
 * Intended for operator-approved Mongo updates (not a schema migration).
 *
 * Usage (from server/):
 *   node scripts/fixTheCabinGeographyBatch1.js --dry-run
 *   CONFIRM_CABIN_GEOGRAPHY_FIX=1 node scripts/fixTheCabinGeographyBatch1.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');

const EN_LOCATION = 'Near Bachevo, in the Razlog area of southwestern Bulgaria';
const BG_LOCATION = 'Край Бачево, в района на Разлог, югозападна България';

const EN_DESCRIPTION =
  "Near Bachevo, in the Razlog area of southwestern Bulgaria, The Cabin is a testament to the beauty of subtraction. Formerly Bucephalus, this is a sanctuary for the over-connected. Off-grid, wood stove, composting toilet, and a wood-fired hot tub.";

const BG_DESCRIPTION =
  'Край Бачево, в района на Разлог в югозападна България, Къщата е доказателство за красотата на изваждането. Позната преди като „Буцефал“, тя е убежище за свръхсвързаните. Офгрид, с печка на дърва, компостна тоалетна и джакузи, подгрявано на дърва.';

function hasPirin(value) {
  return /pirin|пирин/i.test(String(value || ''));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirmed = process.env.CONFIRM_CABIN_GEOGRAPHY_FIX === '1';
  if (!dryRun && !confirmed) {
    console.error('Refusing to write. Pass --dry-run or set CONFIRM_CABIN_GEOGRAPHY_FIX=1');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI / MONGO_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const cabin = await Cabin.findOne({
    $or: [{ slug: 'the-cabin' }, { name: 'The Cabin' }, { name: 'Bucephalus' }]
  });

  if (!cabin) {
    console.error('The Cabin document was not found');
    process.exit(1);
  }

  const before = {
    id: String(cabin._id),
    slug: cabin.slug,
    location: cabin.location,
    bgLocation: cabin.i18n?.bg?.location,
    descriptionHasPirin: hasPirin(cabin.description),
    bgDescriptionHasPirin: hasPirin(cabin.i18n?.bg?.description)
  };
  console.log('before', before);

  const $set = {
    location: EN_LOCATION,
    'i18n.bg.location': BG_LOCATION
  };
  if (hasPirin(cabin.description) || !cabin.description) {
    $set.description = EN_DESCRIPTION;
  }
  if (hasPirin(cabin.i18n?.bg?.description) || !cabin.i18n?.bg?.description) {
    $set['i18n.bg.description'] = BG_DESCRIPTION;
  }

  if (dryRun) {
    console.log('dry-run would $set', $set);
    await mongoose.disconnect();
    return;
  }

  await Cabin.updateOne({ _id: cabin._id }, { $set });
  const after = await Cabin.findById(cabin._id).lean();
  console.log('after', {
    location: after.location,
    bgLocation: after.i18n?.bg?.location,
    descriptionHasPirin: hasPirin(after.description),
    bgDescriptionHasPirin: hasPirin(after.i18n?.bg?.description)
  });
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
