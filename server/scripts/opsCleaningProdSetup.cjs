'use strict';

/**
 * One-shot production setup for checkout-driven cleaner payouts:
 * 1) Seed 2026-06-checkout-payout-v1 policies (idempotent)
 * 2) Tag Valley inventory: a-frame, lux-cabin, stone-house
 *
 * Usage (from server/ with production MONGODB_URI):
 *   node scripts/opsCleaningProdSetup.cjs --dry-run
 *   ALLOW_PRODUCTION_CLEANING_SETUP=1 node scripts/opsCleaningProdSetup.cjs
 *
 * Flags: --dry-run, --skip-seed, --skip-tags
 */
require('dotenv').config();

const mongoose = require('mongoose');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const { seedPolicies } = require('./cleaningPricingPolicySeed.cjs');
const { sanitizeCleaningTags } = require('../data/cleaning/cleaningTagVocabulary');

const VALLEY_TAG_RULES = [
  { kind: 'cabin_type', match: { slug: 'a-frame' }, tags: ['a-frame'] },
  { kind: 'cabin_type', match: { name: /^a-?frame$/i }, tags: ['a-frame'] },
  { kind: 'cabin', match: { name: /^stone house$/i }, tags: ['stone-house'] },
  { kind: 'cabin', match: { name: /^lux cabin$/i }, tags: ['lux-cabin'] }
];

function matches(doc, rule) {
  if (rule.match.slug && doc.slug !== rule.match.slug) return false;
  if (rule.match.name) {
    const name = String(doc.name || '');
    if (rule.match.name instanceof RegExp) return rule.match.name.test(name);
    return name.toLowerCase() === String(rule.match.name).toLowerCase();
  }
  return true;
}

async function tagValleyInventory({ dryRun = false } = {}) {
  const summary = { updated: [], skipped: [], unmatched: [] };

  for (const rule of VALLEY_TAG_RULES) {
    if (rule.kind === 'cabin_type') {
      const types = await CabinType.find({ isActive: { $ne: false } }).lean();
      for (const row of types) {
        if (!matches(row, rule)) continue;
        const { tags } = sanitizeCleaningTags(rule.tags);
        const current = Array.isArray(row.cleaningTags) ? row.cleaningTags : [];
        const same =
          current.length === tags.length && tags.every((t) => current.includes(t));
        if (same) {
          summary.skipped.push({ kind: 'cabin_type', id: String(row._id), name: row.name, tags });
          continue;
        }
        if (!dryRun) {
          await CabinType.updateOne({ _id: row._id }, { $set: { cleaningTags: tags, propertyKind: 'valley' } });
        }
        summary.updated.push({ kind: 'cabin_type', id: String(row._id), name: row.name, tags, was: current });
      }
    } else {
      const cabins = await Cabin.find({}).lean();
      for (const row of cabins) {
        if (!matches(row, rule)) continue;
        const { tags } = sanitizeCleaningTags(rule.tags);
        const current = Array.isArray(row.cleaningTags) ? row.cleaningTags : [];
        const same =
          current.length === tags.length && tags.every((t) => current.includes(t));
        if (same) {
          summary.skipped.push({ kind: 'cabin', id: String(row._id), name: row.name, tags });
          continue;
        }
        if (!dryRun) {
          await Cabin.updateOne({ _id: row._id }, { $set: { cleaningTags: tags, propertyKind: 'valley' } });
        }
        summary.updated.push({ kind: 'cabin', id: String(row._id), name: row.name, tags, was: current });
      }
    }
  }

  const valleyTypes = await CabinType.find({ propertyKind: 'valley', isActive: { $ne: false } })
    .select('name slug cleaningTags propertyKind')
    .lean();
  const valleyCabins = await Cabin.find({ propertyKind: 'valley' })
    .select('name cleaningTags propertyKind')
    .lean();

  for (const row of [...valleyTypes, ...valleyCabins]) {
    const tags = Array.isArray(row.cleaningTags) ? row.cleaningTags : [];
    if (!tags.length) {
      summary.unmatched.push({
        kind: row.slug ? 'cabin_type' : 'cabin',
        id: String(row._id),
        name: row.name,
        slug: row.slug || null
      });
    }
  }

  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipSeed = process.argv.includes('--skip-seed');
  const skipTags = process.argv.includes('--skip-tags');

  if (process.env.NODE_ENV === 'production' && !dryRun) {
    if (process.env.ALLOW_PRODUCTION_CLEANING_SETUP !== '1') {
      console.error(
        'Refused: set ALLOW_PRODUCTION_CLEANING_SETUP=1 to run against production (or use --dry-run).'
      );
      process.exit(1);
    }
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  try {
    if (!skipSeed) {
      console.log('--- Seeding cleaning pricing policies ---');
      await seedPolicies({ dryRun });
    }

    if (!skipTags) {
      console.log('--- Tagging Valley inventory ---');
      const result = await tagValleyInventory({ dryRun });
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await mongoose.disconnect();
  }
}

module.exports = { tagValleyInventory, VALLEY_TAG_RULES };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
