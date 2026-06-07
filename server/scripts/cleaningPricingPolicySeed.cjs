'use strict';

/**
 * Seed default cleaning pricing policies for cabin and valley.
 * Run manually after deploy: node server/scripts/cleaningPricingPolicySeed.cjs
 *
 * Uses createIndexes (not syncIndexes) for new collections when run with --ensure-indexes.
 */
const mongoose = require('mongoose');
const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const CleaningDaySheet = require('../models/CleaningDaySheet');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  defaultCleaningPricingRules
} = require('../data/cleaning/defaultCleaningPricingPolicy');

const PROPERTY_KINDS = ['cabin', 'valley'];

async function ensureIndexes() {
  await CleaningPricingPolicy.createIndexes();
  await CleaningDaySheet.createIndexes();
  console.log('Indexes ensured via createIndexes().');
}

async function seedPolicies({ dryRun = false } = {}) {
  const effectiveFrom = new Date('2020-01-01T00:00:00.000Z');
  const rules = defaultCleaningPricingRules();

  for (const propertyKind of PROPERTY_KINDS) {
    const existing = await CleaningPricingPolicy.findOne({
      propertyKind,
      version: DEFAULT_CLEANING_POLICY_VERSION
    }).lean();

    if (existing) {
      console.log(`Policy already exists for ${propertyKind} (${DEFAULT_CLEANING_POLICY_VERSION}). Skipping.`);
      continue;
    }

    const doc = {
      propertyKind,
      version: DEFAULT_CLEANING_POLICY_VERSION,
      isActive: true,
      effectiveFrom,
      currency: 'EUR',
      rules
    };

    if (dryRun) {
      console.log(`[dry-run] Would create policy for ${propertyKind}:`, doc.version);
      continue;
    }

    await CleaningPricingPolicy.create(doc);
    console.log(`Created default cleaning policy for ${propertyKind} (${DEFAULT_CLEANING_POLICY_VERSION}).`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is required.');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const ensureIdx = process.argv.includes('--ensure-indexes');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    if (ensureIdx) await ensureIndexes();
    await seedPolicies({ dryRun });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { seedPolicies, ensureIndexes };
