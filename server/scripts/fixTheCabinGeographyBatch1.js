#!/usr/bin/env node
/**
 * Idempotent content fix: remove outdated Pirin geography for The Cabin.
 *
 * Changes only incorrect geographical references. Existing descriptions are
 * edited in place. Amenities, prices, slugs, IDs and booking fields are never
 * written.
 *
 * Usage (from server/):
 *   node scripts/fixTheCabinGeographyBatch1.js --dry-run
 *   CONFIRM_CABIN_GEOGRAPHY_FIX=1 node scripts/fixTheCabinGeographyBatch1.js
 */
const EN_LOCATION = 'Near Bachevo, in the Razlog area of southwestern Bulgaria';
const BG_LOCATION = 'Край Бачево, в района на Разлог, югозападна България';

const DESCRIPTION_REPLACEMENTS = [
  [/Nestled in the rugged folds of the Pirin Mountains/gi, EN_LOCATION],
  [/in the rugged folds of the Pirin Mountains/gi, 'near Bachevo, in the Razlog area of southwestern Bulgaria'],
  [/Near Bachevo, Pirin Mountains, Bulgaria/gi, EN_LOCATION],
  [/Pirin mountains, near Bachevo/gi, EN_LOCATION],
  [/Pirin Mountains/g, 'Razlog area of southwestern Bulgaria'],
  [/Pirin mountains/g, 'Razlog area of southwestern Bulgaria'],
  [/Скътана в суровите гънки на Пирин/g, 'Край Бачево, в района на Разлог в югозападна България'],
  [/Край Бачево, Пирин планина, България/g, BG_LOCATION],
  [/Пирин планина, край Бачево/g, BG_LOCATION],
  [/Пирин планина/g, 'района на Разлог'],
  [/\bPirin\b/g, 'Razlog area'],
  [/Пирин/g, 'Разлог']
];

function hasPirin(value) {
  return /pirin|пирин/i.test(String(value || ''));
}

function scrubGeographyText(value) {
  const original = String(value || '');
  if (!hasPirin(original)) return original;
  let next = original;
  for (const [pattern, replacement] of DESCRIPTION_REPLACEMENTS) {
    next = next.replace(pattern, replacement);
  }
  return next;
}

function canonicalLocation(language, value) {
  if (!hasPirin(value)) return value || '';
  return language === 'bg' ? BG_LOCATION : EN_LOCATION;
}

function buildGeographyUpdate(cabin) {
  const $set = {};
  const notes = [];

  const nextLocation = canonicalLocation('en', cabin.location);
  if (nextLocation !== (cabin.location || '')) {
    $set.location = nextLocation;
    notes.push('location');
  }

  const bgLocation = canonicalLocation('bg', cabin.i18n?.bg?.location);
  if (bgLocation !== (cabin.i18n?.bg?.location || '')) {
    $set['i18n.bg.location'] = bgLocation;
    notes.push('i18n.bg.location');
  }

  const enLocation = canonicalLocation('en', cabin.i18n?.en?.location);
  if (cabin.i18n?.en?.location && enLocation !== cabin.i18n.en.location) {
    $set['i18n.en.location'] = enLocation;
    notes.push('i18n.en.location');
  }

  for (const [path, current] of [
    ['description', cabin.description],
    ['i18n.bg.description', cabin.i18n?.bg?.description],
    ['i18n.en.description', cabin.i18n?.en?.description]
  ]) {
    if (!current || !hasPirin(current)) continue;
    const next = scrubGeographyText(current);
    if (hasPirin(next)) {
      throw new Error(`Refusing to write ${path}: a Pirin reference remained after surgical replacement`);
    }
    if (next !== current) {
      $set[path] = next;
      notes.push(path);
    }
  }

  return { $set, notes, amenityCount: Array.isArray(cabin.amenities) ? cabin.amenities.length : 0 };
}

async function main() {
  require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
  const mongoose = require('mongoose');
  const Cabin = require('../models/Cabin');
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

  const beforeAmenities = JSON.stringify(cabin.amenities || []);
  const { $set, notes, amenityCount } = buildGeographyUpdate(cabin);
  console.log('before', {
    id: String(cabin._id),
    slug: cabin.slug,
    location: cabin.location,
    bgLocation: cabin.i18n?.bg?.location,
    descriptionHasPirin: hasPirin(cabin.description),
    bgDescriptionHasPirin: hasPirin(cabin.i18n?.bg?.description),
    amenityCount
  });
  console.log(dryRun ? 'dry-run would update' : 'updating', notes, $set);

  if (Object.keys($set).length === 0) {
    console.log('No geographical references to change. Amenities left untouched.');
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    await mongoose.disconnect();
    return;
  }

  await Cabin.updateOne({ _id: cabin._id }, { $set });
  const after = await Cabin.findById(cabin._id).lean();
  if (JSON.stringify(after.amenities || []) !== beforeAmenities) {
    throw new Error('Amenities changed unexpectedly');
  }
  if (hasPirin(after.location) || hasPirin(after.description) || hasPirin(after.i18n?.bg?.location) || hasPirin(after.i18n?.bg?.description)) {
    throw new Error('Pirin reference remained after update');
  }
  console.log('after', {
    location: after.location,
    bgLocation: after.i18n?.bg?.location,
    descriptionHasPirin: hasPirin(after.description),
    bgDescriptionHasPirin: hasPirin(after.i18n?.bg?.description),
    amenityCount: Array.isArray(after.amenities) ? after.amenities.length : 0
  });
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}

module.exports = {
  EN_LOCATION,
  BG_LOCATION,
  hasPirin,
  scrubGeographyText,
  canonicalLocation,
  buildGeographyUpdate
};
