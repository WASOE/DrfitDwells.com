#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Backfill `bedConfig` on Valley inventory (Lux Cabin, Stone House, A-Frame type).
 *
 * Dry-run (default):
 *   node server/scripts/backfillBedConfig.js
 *
 * Apply:
 *   node server/scripts/backfillBedConfig.js --apply
 *
 * Idempotent: skips rows whose bedConfig already matches the target payload.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

/** Known bed layouts derived from amenities copy ("Double bed") and capacity. */
const KNOWN_BED_CONFIGS = Object.freeze({
  aFrameType: [{ bedType: 'double', count: 1 }],
  luxCabin: [{ bedType: 'double', count: 1 }],
  /** Inferred from capacity 6 + "Multiple sleeping areas" — 2 doubles + 2 singles. */
  stoneHouse: [
    { bedType: 'double', count: 2 },
    { bedType: 'single', count: 2 }
  ]
});

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

function bedConfigKey(config) {
  return JSON.stringify(
    (Array.isArray(config) ? config : [])
      .map((row) => ({ bedType: row.bedType, count: row.count }))
      .sort((a, b) => `${a.bedType}:${a.count}`.localeCompare(`${b.bedType}:${b.count}`))
  );
}

function configsMatch(existing, target) {
  return bedConfigKey(existing) === bedConfigKey(target);
}

function isEmptyBedConfig(config) {
  return !Array.isArray(config) || config.length === 0;
}

async function resolveTargets() {
  const [aFrameType, luxCabin, stoneHouse] = await Promise.all([
    CabinType.findOne({ slug: 'a-frame' }).select('_id name slug bedConfig propertyKind').lean(),
    Cabin.findOne({
      $or: [{ slug: 'lux-cabin' }, { name: /^lux cabin$/i }],
      propertyKind: 'valley'
    })
      .select('_id name slug bedConfig propertyKind')
      .lean(),
    Cabin.findOne({
      $or: [{ slug: 'stone-house' }, { name: /^stone house$/i }],
      propertyKind: 'valley'
    })
      .select('_id name slug bedConfig propertyKind')
      .lean()
  ]);

  return [
    {
      model: 'CabinType',
      doc: aFrameType,
      matchKey: 'slug:a-frame',
      target: KNOWN_BED_CONFIGS.aFrameType
    },
    {
      model: 'Cabin',
      doc: luxCabin,
      matchKey: 'slug:lux-cabin|name:Lux Cabin',
      target: KNOWN_BED_CONFIGS.luxCabin
    },
    {
      model: 'Cabin',
      doc: stoneHouse,
      matchKey: 'slug:stone-house|name:Stone House',
      target: KNOWN_BED_CONFIGS.stoneHouse
    }
  ];
}

async function listNullBedConfigInventory() {
  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({
      propertyKind: 'valley',
      isActive: true,
      $or: [{ bedConfig: { $exists: false } }, { bedConfig: { $size: 0 } }]
    })
      .select('name slug propertyKind')
      .lean(),
    CabinType.find({
      propertyKind: 'valley',
      isActive: { $ne: false },
      $or: [{ bedConfig: { $exists: false } }, { bedConfig: { $size: 0 } }]
    })
      .select('name slug propertyKind')
      .lean()
  ]);

  return { cabins, cabinTypes };
}

async function main() {
  const { apply } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;

  await mongoose.connect(uri);
  console.log(`[backfillBedConfig] connected apply=${apply}`);

  const targets = await resolveTargets();
  const results = {
    applied: [],
    skipped: [],
    missing: [],
    mismatched: []
  };

  for (const row of targets) {
    if (!row.doc) {
      results.missing.push({ model: row.model, matchKey: row.matchKey });
      continue;
    }

    const existing = row.doc.bedConfig;
    if (configsMatch(existing, row.target)) {
      results.skipped.push({
        model: row.model,
        id: String(row.doc._id),
        name: row.doc.name,
        bedConfig: row.target
      });
      continue;
    }

    if (!isEmptyBedConfig(existing) && !configsMatch(existing, row.target)) {
      results.mismatched.push({
        model: row.model,
        id: String(row.doc._id),
        name: row.doc.name,
        existing,
        target: row.target
      });
      if (!apply) {
        continue;
      }
    }

    if (apply) {
      if (row.model === 'CabinType') {
        await CabinType.updateOne({ _id: row.doc._id }, { $set: { bedConfig: row.target } });
      } else {
        await Cabin.updateOne({ _id: row.doc._id }, { $set: { bedConfig: row.target } });
      }
    }

    results.applied.push({
      model: row.model,
      id: String(row.doc._id),
      name: row.doc.name,
      bedConfig: row.target,
      dryRun: !apply
    });
  }

  const nullInventory = await listNullBedConfigInventory();

  console.log('\n[backfillBedConfig] summary');
  console.log(JSON.stringify(results, null, 2));
  console.log('\n[backfillBedConfig] valley inventory still missing bedConfig after run:');
  console.log(
    JSON.stringify(
      {
        cabins: nullInventory.cabins.map((c) => ({
          name: c.name,
          slug: c.slug || null,
          id: String(c._id)
        })),
        cabinTypes: nullInventory.cabinTypes.map((ct) => ({
          name: ct.name,
          slug: ct.slug || null,
          id: String(ct._id)
        }))
      },
      null,
      2
    )
  );

  if (results.mismatched.length > 0 && !apply) {
    console.log(
      '\n[backfillBedConfig] WARNING: existing non-empty bedConfig differs from target; re-run with --apply to overwrite.'
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[backfillBedConfig] fatal:', err);
  process.exit(1);
});
