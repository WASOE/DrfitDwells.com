#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Controlled InventoryOperatingPeriod upsert for Batch 5A.
 *
 * Dry-run (default):
 *   node server/scripts/upsertInventoryOperatingPeriods.cjs --file ./periods.json
 *
 * Apply:
 *   node server/scripts/upsertInventoryOperatingPeriods.cjs --file ./periods.json --apply
 *
 * JSON array items:
 * {
 *   "propertyKind": "cabin",
 *   "entityType": "cabin",
 *   "entityId": "<ObjectId>",
 *   "operatingFrom": "2024-01-01",
 *   "operatingTo": null,
 *   "reason": "opened",
 *   "source": "ops_manual",
 *   "notes": "Confirmed opening"
 * }
 *
 * Does not mutate Booking/Payment. Does not affect public booking behaviour.
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const InventoryOperatingPeriod = require('../models/InventoryOperatingPeriod');
const { appendAuditEvent } = require('../services/auditWriter');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

function parseArgs(argv) {
  const args = { apply: false, file: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--file') args.file = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node upsertInventoryOperatingPeriods.cjs --file <path> [--apply]');
    process.exit(1);
  }
  const abs = path.resolve(args.file);
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('File must contain a JSON array');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });

  const proposals = [];
  for (const row of rows) {
    if (!['cabin', 'valley'].includes(row.propertyKind)) {
      throw new Error(`Invalid propertyKind: ${row.propertyKind}`);
    }
    if (!['cabin', 'cabin_type', 'unit', 'location'].includes(row.entityType)) {
      throw new Error(`Invalid entityType: ${row.entityType}`);
    }
    proposals.push({
      propertyKind: row.propertyKind,
      entityType: row.entityType,
      entityId: row.entityId,
      operatingFrom: normalizeDateToSofiaDayStart(`${String(row.operatingFrom).slice(0, 10)}T00:00:00.000Z`),
      operatingTo: row.operatingTo
        ? normalizeDateToSofiaDayStart(`${String(row.operatingTo).slice(0, 10)}T00:00:00.000Z`)
        : null,
      sellableWeekdays: row.sellableWeekdays || [0, 1, 2, 3, 4, 5, 6],
      defaultSellable: row.defaultSellable !== false,
      reason: row.reason || 'opened',
      source: row.source || 'ops_manual',
      notes: row.notes || ''
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? 'apply' : 'dry-run',
        count: proposals.length,
        proposals
      },
      null,
      2
    )
  );

  if (!args.apply) {
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const p of proposals) {
    const doc = await InventoryOperatingPeriod.findOneAndUpdate(
      {
        propertyKind: p.propertyKind,
        entityType: p.entityType,
        entityId: p.entityId,
        operatingFrom: p.operatingFrom,
        reason: p.reason
      },
      { $set: p },
      { upsert: true, new: true }
    );
    written += 1;
    await appendAuditEvent({
      actorType: 'system',
      action: 'inventory_operating_period.upsert',
      entityType: 'InventoryOperatingPeriod',
      entityId: String(doc._id),
      metadata: {
        propertyKind: p.propertyKind,
        entityType: p.entityType,
        entityId: String(p.entityId),
        operatingFrom: p.operatingFrom,
        reason: p.reason
      }
    });
  }

  console.log(JSON.stringify({ ok: true, written }, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

module.exports = { main };
