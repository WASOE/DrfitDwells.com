#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Controlled reporting-metadata corrections for Batch 5A.
 *
 * Dry-run default. Never rewrites prices, payments, guest data, or booking status
 * except optional isTest / archive flags when explicitly requested.
 *
 * Examples:
 *   node server/scripts/correctHistoricalReportingMetadata.cjs --mark-test <bookingId>
 *   node server/scripts/correctHistoricalReportingMetadata.cjs --mark-test <bookingId> --apply
 *
 * propertyKind inventory corrections remain in backfillPropertyKind.js.
 * Operating periods remain in upsertInventoryOperatingPeriods.cjs.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const Booking = require('../models/Booking');
const { appendAuditEvent } = require('../services/auditWriter');

function parseArgs(argv) {
  const args = { apply: false, markTest: null, archive: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--mark-test') args.markTest = argv[++i];
    if (argv[i] === '--archive') args.archive = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.markTest && !args.archive) {
    console.error(
      'Usage: correctHistoricalReportingMetadata.cjs (--mark-test|--archive) <bookingId> [--apply]'
    );
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });

  const id = args.markTest || args.archive;
  const booking = await Booking.findById(id).lean();
  if (!booking) {
    console.error(JSON.stringify({ ok: false, error: 'booking_not_found' }));
    process.exit(1);
  }

  const proposal = {
    bookingId: String(booking._id),
    current: {
      isTest: booking.isTest === true,
      archivedAt: booking.archivedAt || null
    },
    next: {}
  };
  if (args.markTest) proposal.next.isTest = true;
  if (args.archive) {
    proposal.next.archivedAt = new Date();
    proposal.next.archivedReason = 'historical_reporting_correction';
  }

  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', proposal }, null, 2));

  if (!args.apply) {
    await mongoose.disconnect();
    return;
  }

  await Booking.updateOne({ _id: booking._id }, { $set: proposal.next });
  await appendAuditEvent({
    actorType: 'system',
    action: 'historical_reporting_metadata.correct',
    entityType: 'Booking',
    entityId: String(booking._id),
    metadata: proposal
  });
  console.log(JSON.stringify({ ok: true, applied: proposal.next }, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

module.exports = { main };
