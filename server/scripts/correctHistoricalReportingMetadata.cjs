#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Controlled reporting-metadata corrections for Batch 5A.
 *
 * Dry-run default. Never rewrites prices, payments, guest data, or booking status
 * except optional isTest / archive flags when explicitly requested.
 *
 * Examples:
 *   MONGODB_URI=... node server/scripts/correctHistoricalReportingMetadata.cjs --mark-test <bookingId>
 *   MONGODB_URI=... node server/scripts/correctHistoricalReportingMetadata.cjs --mark-test <bookingId> --apply
 *   # production also requires: --confirm-production-write
 *
 * Connection banner is written to stderr.
 */
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const { appendAuditEvent } = require('../services/auditWriter');
const {
  connectScriptMongo,
  exitFromScriptError
} = require('./lib/scriptMongoSafety.cjs');

function parseArgs(argv) {
  const args = {
    apply: false,
    confirmProductionWrite: false,
    markTest: null,
    archive: null
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    if (argv[i] === '--confirm-production-write') args.confirmProductionWrite = true;
    if (argv[i] === '--mark-test') args.markTest = argv[++i];
    if (argv[i] === '--archive') args.archive = argv[++i];
  }
  return args;
}

async function main(argv = process.argv, env = process.env) {
  const args = parseArgs(argv);
  if (!args.markTest && !args.archive) {
    console.error(
      'Usage: correctHistoricalReportingMetadata.cjs (--mark-test|--archive) <bookingId> [--apply] [--confirm-production-write]'
    );
    process.exit(1);
  }

  await connectScriptMongo(mongoose, {
    apply: args.apply,
    confirmProductionWrite: args.confirmProductionWrite,
    mode: args.apply ? 'apply' : 'dry-run',
    env
  });

  const id = args.markTest || args.archive;
  const booking = await Booking.findById(id).lean();
  if (!booking) {
    console.error(JSON.stringify({ ok: false, error: 'booking_not_found' }));
    await mongoose.disconnect();
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
    return { mode: 'dry-run', proposal, written: false };
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
  return { mode: 'apply', proposal, written: true };
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
