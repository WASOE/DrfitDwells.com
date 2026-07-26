#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Controlled InventoryOperatingPeriod upsert for Batch 5A.
 *
 * Dry-run (default):
 *   MONGODB_URI=... node server/scripts/upsertInventoryOperatingPeriods.cjs --file ./periods.json
 *
 * Apply (development):
 *   MONGODB_URI=... node server/scripts/upsertInventoryOperatingPeriods.cjs --file ./periods.json --apply
 *
 * Apply (production / APP_ENV=production):
 *   ... --apply --confirm-production-write
 *
 * Does not mutate Booking/Payment. Does not affect public booking behaviour.
 * Connection banner is written to stderr.
 */
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const InventoryOperatingPeriod = require('../models/InventoryOperatingPeriod');
const { appendAuditEvent } = require('../services/auditWriter');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  connectScriptMongo,
  exitFromScriptError
} = require('./lib/scriptMongoSafety.cjs');

function parseArgs(argv) {
  const args = { apply: false, confirmProductionWrite: false, file: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--confirm-production-write') args.confirmProductionWrite = true;
    if (argv[i] === '--file') args.file = argv[++i];
  }
  return args;
}

async function main(argv = process.argv, env = process.env) {
  const args = parseArgs(argv);
  if (!args.file) {
    console.error(
      'Usage: node upsertInventoryOperatingPeriods.cjs --file <path> [--apply] [--confirm-production-write]'
    );
    process.exit(1);
  }
  const abs = path.resolve(args.file);
  const rows = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!Array.isArray(rows)) throw new Error('File must contain a JSON array');

  await connectScriptMongo(mongoose, {
    apply: args.apply,
    confirmProductionWrite: args.confirmProductionWrite,
    mode: args.apply ? 'apply' : 'dry-run',
    env
  });

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
      operatingFrom: normalizeDateToSofiaDayStart(
        `${String(row.operatingFrom).slice(0, 10)}T00:00:00.000Z`
      ),
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

  if (!args.apply) {
    // Exactly one JSON document on stdout (banner remains on stderr).
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          count: proposals.length,
          proposals
        },
        null,
        2
      )
    );
    await mongoose.disconnect();
    return { written: 0, mode: 'dry-run', proposals };
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

  // Exactly one JSON document on stdout — proposals + apply result combined.
  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        count: proposals.length,
        proposals,
        ok: true,
        written
      },
      null,
      2
    )
  );
  await mongoose.disconnect();
  return { written, mode: 'apply', proposals };
}

if (require.main === module) {
  main().catch((err) => {
    if (err?.code === 'MONGO_URI_REQUIRED' || err?.code === 'PRODUCTION_WRITE_CONFIRM_REQUIRED') {
      exitFromScriptError(err);
    }
    console.error(err);
    process.exit(2);
  });
}

module.exports = { main, parseArgs };
