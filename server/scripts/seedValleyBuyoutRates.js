#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seed flat whole-Valley buyout nightly rates into the existing `buyoutPricePerNight`
 * field. Single-stay `pricePerNight` (incl. Stone House €25 per-person) is never touched.
 *
 * Targets & values:
 *   - Stone House (Cabin)      → €150  (flat buyout; derived from €25/person × 6 capacity)
 *   - Lux Cabin  (Cabin)       → €85
 *   - A-Frame    (CabinType)   → €60   (per unit)
 *
 * Nightly buyout total = 150 + 85 + (60 × 2 A-frame units) = €355
 * 2-night floor        = 355 × 2 = €710
 *
 * Dry-run (default):
 *   node server/scripts/seedValleyBuyoutRates.js
 *
 * Apply:
 *   node server/scripts/seedValleyBuyoutRates.js --apply
 *
 * Idempotent: skips rows whose buyoutPricePerNight already equals the target value.
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');

/** Flat buyout nightly rate per entity (EUR). Per-unit for the A-frame type. */
const BUYOUT_RATES = Object.freeze({
  stoneHouse: 150,
  luxCabin: 85,
  aFrameType: 60
});

function parseArgs(argv) {
  return { apply: argv.includes('--apply') };
}

async function resolveTargets() {
  const [aFrameType, luxCabin, stoneHouse] = await Promise.all([
    CabinType.findOne({ slug: 'a-frame' })
      .select('_id name slug buyoutPricePerNight propertyKind')
      .lean(),
    Cabin.findOne({
      $or: [{ slug: 'lux-cabin' }, { name: /^lux cabin$/i }],
      propertyKind: 'valley'
    })
      .select('_id name slug buyoutPricePerNight propertyKind')
      .lean(),
    Cabin.findOne({
      $or: [{ slug: 'stone-house' }, { name: /^stone house$/i }],
      propertyKind: 'valley'
    })
      .select('_id name slug buyoutPricePerNight propertyKind')
      .lean()
  ]);

  return [
    {
      model: 'Cabin',
      doc: stoneHouse,
      matchKey: 'slug:stone-house|name:Stone House',
      target: BUYOUT_RATES.stoneHouse
    },
    {
      model: 'Cabin',
      doc: luxCabin,
      matchKey: 'slug:lux-cabin|name:Lux Cabin',
      target: BUYOUT_RATES.luxCabin
    },
    {
      model: 'CabinType',
      doc: aFrameType,
      matchKey: 'slug:a-frame',
      target: BUYOUT_RATES.aFrameType
    }
  ];
}

/** Every active Valley buyout target still lacking a non-negative buyout rate. */
async function listMissingBuyoutRateInventory() {
  const missingClause = {
    $or: [{ buyoutPricePerNight: { $exists: false } }, { buyoutPricePerNight: null }]
  };

  const [cabins, cabinTypes] = await Promise.all([
    Cabin.find({
      propertyKind: 'valley',
      isActive: true,
      inventoryType: { $ne: 'multi' },
      ...missingClause
    })
      .select('name slug buyoutPricePerNight')
      .lean(),
    CabinType.find({
      propertyKind: 'valley',
      isActive: { $ne: false },
      ...missingClause
    })
      .select('name slug buyoutPricePerNight')
      .lean()
  ]);

  return { cabins, cabinTypes };
}

async function main() {
  const { apply } = parseArgs(process.argv);
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;

  await mongoose.connect(uri);
  console.log(`[seedValleyBuyoutRates] connected apply=${apply}`);

  const targets = await resolveTargets();
  const results = {
    applied: [],
    skipped: [],
    missing: []
  };

  for (const row of targets) {
    if (!row.doc) {
      results.missing.push({ model: row.model, matchKey: row.matchKey });
      continue;
    }

    if (Number(row.doc.buyoutPricePerNight) === row.target) {
      results.skipped.push({
        model: row.model,
        id: String(row.doc._id),
        name: row.doc.name,
        buyoutPricePerNight: row.target
      });
      continue;
    }

    if (apply) {
      const Model = row.model === 'CabinType' ? CabinType : Cabin;
      await Model.updateOne(
        { _id: row.doc._id },
        { $set: { buyoutPricePerNight: row.target } }
      );
    }

    results.applied.push({
      model: row.model,
      id: String(row.doc._id),
      name: row.doc.name,
      from: row.doc.buyoutPricePerNight ?? null,
      to: row.target,
      dryRun: !apply
    });
  }

  const nightlyTotal =
    BUYOUT_RATES.stoneHouse + BUYOUT_RATES.luxCabin + BUYOUT_RATES.aFrameType * 2;
  const twoNightFloor = nightlyTotal * 2;

  console.log('\n[seedValleyBuyoutRates] summary');
  console.log(JSON.stringify(results, null, 2));

  const missingInventory = await listMissingBuyoutRateInventory();
  console.log('\n[seedValleyBuyoutRates] valley targets still missing a buyout rate after run:');
  console.log(
    JSON.stringify(
      {
        cabins: missingInventory.cabins.map((c) => ({
          name: c.name,
          slug: c.slug || null,
          id: String(c._id)
        })),
        cabinTypes: missingInventory.cabinTypes.map((ct) => ({
          name: ct.name,
          slug: ct.slug || null,
          id: String(ct._id)
        }))
      },
      null,
      2
    )
  );

  console.log('\n[seedValleyBuyoutRates] expected inventory-endpoint values once applied:');
  console.log(
    JSON.stringify(
      {
        'fromPrice.nightlyTotal': nightlyTotal,
        'fromPrice.amount': twoNightFloor,
        note: 'Assumes 2 active A-frame units and 2-night minimum stay.'
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[seedValleyBuyoutRates] fatal:', err);
  process.exit(1);
});
