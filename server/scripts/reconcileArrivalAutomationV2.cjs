#!/usr/bin/env node
'use strict';

/**
 * Arrival Automation V2 — existing booking reconciliation.
 *
 * Default: dry-run (no writes, no SMTP).
 *
 * Usage:
 *   node server/scripts/reconcileArrivalAutomationV2.cjs
 *   node server/scripts/reconcileArrivalAutomationV2.cjs --apply --confirm-schedule-only
 *   node server/scripts/reconcileArrivalAutomationV2.cjs --include-staff-stay
 *
 * --apply requires --confirm-schedule-only and ARRIVAL_AUTOMATION_V2=1 (+ ARRIVAL_EMAIL_V2=1).
 * Apply only creates/updates ScheduledMessageJob rows via syncArrivalAutomationForBooking.
 * It never bulk-submits SMTP.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const MessageDispatch = require('../models/MessageDispatch');
const {
  isArrivalAutomationAuthorized,
  ENV_ARRIVAL_AUTOMATION_V2,
  ENV_ARRIVAL_EMAIL_V2
} = require('../services/messaging/arrival/arrivalFeatureFlags');
const { buildInitialArrivalIdempotencyKey } = require('../services/messaging/arrival/arrivalDispatchIdentity');
const { resolveArrivalStayContext } = require('../services/messaging/arrival/arrivalStayResolver');
const { resolveAutomaticArrivalSchedule } = require('../services/messaging/arrival/arrivalSchedulePolicy');
const { syncArrivalAutomationForBooking } = require('../services/messaging/arrival/arrivalAutomationScheduler');

function parseArgs(argv) {
  const out = {
    apply: false,
    confirmScheduleOnly: false,
    includeStaffStay: false,
    limit: null
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--confirm-schedule-only') out.confirmScheduleOnly = true;
    else if (a === '--include-staff-stay') out.includeStaffStay = true;
    else if (a === '--limit') out.limit = Number.parseInt(argv[++i], 10);
  }
  return out;
}

async function classifyBooking(booking, { includeStaffStay }) {
  if (booking.status === 'cancelled') return { class: 'excluded_cancelled' };
  if (!includeStaffStay && booking.manualReservationPurpose === 'staff_stay') {
    return { class: 'excluded_staff_stay' };
  }
  if (booking.suppressGuestEmail === true) return { class: 'excluded_suppress_email' };
  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    return { class: 'excluded_status', status: booking.status };
  }
  const email = booking.guestInfo?.email;
  if (!email || !String(email).includes('@')) return { class: 'excluded_missing_email' };

  const stay = await resolveArrivalStayContext(booking);
  if (!stay.ok) return { class: 'needs_review_property', code: stay.code };

  const schedule = resolveAutomaticArrivalSchedule({ checkIn: booking.checkIn, now: new Date() });
  if (!schedule.ok) return { class: 'needs_review_cutoff', code: schedule.code };

  const initialKey = buildInitialArrivalIdempotencyKey(booking._id);
  const accepted = await MessageDispatch.findOne({
    idempotencyKey: initialKey,
    status: 'accepted'
  }).lean();

  if (accepted) {
    return {
      class: 'has_v2_initial',
      propertyKind: stay.propertyKind,
      note: 'Will schedule correction only if itinerary diverges'
    };
  }

  // Legacy stub / non-V2 email events do not count.
  return {
    class: 'needs_schedule_initial',
    propertyKind: stay.propertyKind,
    mode: schedule.mode,
    scheduledFor: schedule.scheduledForUtc.toISOString()
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.apply && !args.confirmScheduleOnly) {
    console.error('Refusing --apply without --confirm-schedule-only');
    process.exit(2);
  }
  if (args.apply && !isArrivalAutomationAuthorized()) {
    console.error(
      `Refusing --apply: require ${ENV_ARRIVAL_AUTOMATION_V2}=1 and ${ENV_ARRIVAL_EMAIL_V2}=1`
    );
    process.exit(2);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI missing');
    process.exit(2);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });

  const now = new Date();
  const query = {
    status: { $in: ['confirmed', 'checked_in'] },
    checkIn: { $gte: new Date(now.getTime() - 24 * 3600 * 1000) }
  };
  let cursor = Booking.find(query).sort({ checkIn: 1 });
  if (args.limit) cursor = cursor.limit(args.limit);
  const bookings = await cursor.exec();

  const counts = {};
  const samples = {};
  const applyResults = [];

  for (const booking of bookings) {
    const c = await classifyBooking(booking, args);
    counts[c.class] = (counts[c.class] || 0) + 1;
    if (!samples[c.class]) samples[c.class] = [];
    if (samples[c.class].length < 5) {
      samples[c.class].push({
        id: String(booking._id),
        checkIn: booking.checkIn,
        purpose: booking.manualReservationPurpose || null,
        ...c
      });
    }

    if (
      args.apply &&
      (c.class === 'needs_schedule_initial' || c.class === 'has_v2_initial')
    ) {
      const r = await syncArrivalAutomationForBooking({
        bookingId: booking._id,
        reason: 'reconcile_apply',
        now
      });
      applyResults.push({ id: String(booking._id), result: r });
    }
  }

  const report = {
    dryRun: !args.apply,
    at: new Date().toISOString(),
    scanned: bookings.length,
    counts,
    samples,
    applyResults: args.apply ? applyResults : undefined,
    flags: {
      ARRIVAL_AUTOMATION_V2: process.env[ENV_ARRIVAL_AUTOMATION_V2] || null,
      ARRIVAL_EMAIL_V2: process.env[ENV_ARRIVAL_EMAIL_V2] || null,
      authorized: isArrivalAutomationAuthorized()
    }
  };
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
