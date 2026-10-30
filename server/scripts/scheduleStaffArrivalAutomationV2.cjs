#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Staff-scoped Arrival V2 schedule sync — does NOT require global
 * ARRIVAL_AUTOMATION_V2 on the shared API.
 *
 * Creates/updates V2 ScheduledMessageJob rows for allowlisted staff emails
 * via syncArrivalAutomationForBooking({ force: true }).
 *
 * Usage:
 *   node scripts/scheduleStaffArrivalAutomationV2.cjs \
 *     --booking-id <ObjectId> \
 *     --confirm-staff-email jose@driftdwells.com
 *
 * Optional:
 *   ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST=jose@driftdwells.com
 *   (defaults allowlist to the --confirm-staff-email value)
 *
 * Never schedules guest emails outside the allowlist.
 * Never starts a worker. Never sends SMTP.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const {
  ENV_EMAIL_ALLOWLIST,
  parseEmailAllowlist,
  isEmailAllowlisted
} = require('../services/messaging/arrival/arrivalWorkerClaimPolicy');
const {
  syncArrivalAutomationForBooking
} = require('../services/messaging/arrival/arrivalAutomationScheduler');

function parseArgs(argv) {
  const out = { bookingId: null, confirmStaffEmail: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--booking-id') out.bookingId = argv[++i];
    else if (a === '--confirm-staff-email') out.confirmStaffEmail = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.bookingId || !mongoose.isValidObjectId(args.bookingId)) {
    console.error('Require --booking-id <ObjectId>');
    process.exit(2);
  }
  if (!args.confirmStaffEmail || !String(args.confirmStaffEmail).includes('@')) {
    console.error('Require --confirm-staff-email <address>');
    process.exit(2);
  }

  const confirm = String(args.confirmStaffEmail).trim().toLowerCase();
  if (!process.env[ENV_EMAIL_ALLOWLIST]) {
    process.env[ENV_EMAIL_ALLOWLIST] = confirm;
  }
  const allowlist = parseEmailAllowlist(process.env);
  if (!allowlist || !allowlist.has(confirm)) {
    console.error(
      `--confirm-staff-email must be included in ${ENV_EMAIL_ALLOWLIST}`
    );
    process.exit(2);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(2);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  const booking = await Booking.findById(args.bookingId);
  if (!booking) {
    console.error(JSON.stringify({ ok: false, error: 'booking_missing' }));
    await mongoose.disconnect();
    process.exit(2);
  }

  const bookingEmail = String(booking.guestInfo?.email || '').trim().toLowerCase();
  if (bookingEmail !== confirm) {
    console.error(
      JSON.stringify({
        ok: false,
        error: 'email_mismatch',
        bookingEmailRedacted: bookingEmail
          ? `${bookingEmail.slice(0, 1)}***@${bookingEmail.split('@')[1] || '?'}`
          : null,
        expected: confirm
      })
    );
    await mongoose.disconnect();
    process.exit(2);
  }
  if (!isEmailAllowlisted(bookingEmail, process.env)) {
    console.error(JSON.stringify({ ok: false, error: 'email_not_allowlisted' }));
    await mongoose.disconnect();
    process.exit(2);
  }

  // force:true → schedules even when shared ARRIVAL_AUTOMATION_V2=0
  const result = await syncArrivalAutomationForBooking({
    bookingId: booking._id,
    reason: 'staff_schedule_cli',
    force: true
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        force: true,
        sharedAutomationFlag: process.env.ARRIVAL_AUTOMATION_V2 || null,
        bookingId: String(booking._id),
        emailRedacted: `${confirm.slice(0, 1)}***@${confirm.split('@')[1]}`,
        result
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  if (result?.error || result?.disabled) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
