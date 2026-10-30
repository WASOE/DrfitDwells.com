#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Audited retirement of pre-V2 GMA arrival ScheduledMessageJob rows.
 *
 * Default: dry-run (read-only classification).
 * Apply:    node scripts/retireLegacyArrivalJobs.cjs --apply --confirm-retire-legacy
 *
 * Preserves historical rows (status → cancelled; does not delete).
 * Does NOT create replacement V2 schedules — run reconcile after the
 * scheduling path is proven and ARRIVAL_AUTOMATION_V2=1.
 *
 * Never run --apply until:
 *   1. Dedicated worker + flag topology proven
 *   2. Staff automation SMTP proven
 *   3. Owner approval
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { DEFAULT_MONGO_URI } = require('../config/dbDefaults');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const Booking = require('../models/Booking');
const MessageDispatch = require('../models/MessageDispatch');
const { ARRIVAL_AUTOMATION_RULE_KEYS } = require('../services/messaging/arrival/arrivalFeatureFlags');
const { buildInitialArrivalIdempotencyKey } = require('../services/messaging/arrival/arrivalDispatchIdentity');

function redactEmail(e) {
  if (!e || !String(e).includes('@')) return null;
  const [u, d] = String(e).split('@');
  return `${u.slice(0, 1)}***@${d}`;
}

async function classifyJob(job, now) {
  const booking = job.bookingId ? await Booking.findById(job.bookingId).lean() : null;
  const v2Accepted = job.bookingId
    ? await MessageDispatch.findOne({
        idempotencyKey: buildInitialArrivalIdempotencyKey(job.bookingId),
        status: 'accepted'
      }).lean()
    : null;
  const scheduledFor = job.scheduledFor ? new Date(job.scheduledFor) : null;
  const past = scheduledFor ? scheduledFor.getTime() < now.getTime() : null;
  const checkIn = booking?.checkIn ? new Date(booking.checkIn) : null;
  const checkInPast = checkIn ? checkIn.getTime() < now.getTime() : null;
  const isV2 = job.payloadSnapshot?.arrivalAutomationV2 === true;

  let relevance;
  if (isV2) relevance = 'keep_v2_job';
  else if (!booking) relevance = 'obsolete_booking_missing';
  else if (booking.status === 'cancelled') relevance = 'obsolete_cancelled';
  else if (v2Accepted) relevance = 'obsolete_v2_already_sent';
  else if (checkInPast) relevance = 'obsolete_checkin_passed';
  else if (past) relevance = 'stale_due_stay_upcoming';
  else relevance = 'future_legacy_gma_row';

  return {
    jobId: String(job._id),
    ruleKey: job.ruleKey,
    jobStatus: job.status,
    scheduledFor: scheduledFor ? scheduledFor.toISOString() : null,
    scheduledRelative: past == null ? null : past ? 'past' : 'future',
    hasV2Payload: isV2,
    bookingId: job.bookingId ? String(job.bookingId) : null,
    bookingStatus: booking?.status || null,
    checkIn: checkIn ? checkIn.toISOString() : null,
    checkInRelative: checkInPast == null ? null : checkInPast ? 'past' : 'future',
    emailRedacted: redactEmail(booking?.guestInfo?.email),
    v2InitialAccepted: Boolean(v2Accepted),
    relevance,
    retire: !isV2 && ['scheduled', 'claimed'].includes(job.status)
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const confirmed = args.has('--confirm-retire-legacy');
  if (apply && !confirmed) {
    console.error('Refusing --apply without --confirm-retire-legacy');
    process.exit(2);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || DEFAULT_MONGO_URI;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const now = new Date();

  const jobs = await ScheduledMessageJob.find({
    ruleKey: { $in: [...ARRIVAL_AUTOMATION_RULE_KEYS] },
    status: { $in: ['scheduled', 'claimed'] }
  })
    .sort({ scheduledFor: 1 })
    .lean();

  const rows = [];
  for (const job of jobs) {
    rows.push(await classifyJob(job, now));
  }

  const toRetire = rows.filter((r) => r.retire);
  const keepV2 = rows.filter((r) => r.relevance === 'keep_v2_job');
  const futureLegacy = toRetire.filter((r) => r.relevance === 'future_legacy_gma_row');

  let modified = 0;
  if (apply) {
    const ids = toRetire.map((r) => r.jobId);
    if (ids.length) {
      const res = await ScheduledMessageJob.updateMany(
        {
          _id: { $in: ids },
          status: { $in: ['scheduled', 'claimed'] },
          'payloadSnapshot.arrivalAutomationV2': { $ne: true }
        },
        {
          $set: {
            status: 'cancelled',
            cancelReason: 'legacy_pre_v2_retirement',
            cancelActor: 'retireLegacyArrivalJobs',
            claimedBy: null,
            claimedAt: null,
            visibilityTimeoutAt: null
          }
        }
      );
      modified = res.modifiedCount || 0;
    }
  }

  const report = {
    dryRun: !apply,
    at: now.toISOString(),
    scanned: rows.length,
    retireCandidates: toRetire.length,
    keepV2Jobs: keepV2.length,
    futureLegacyNeedingV2Replacement: futureLegacy.length,
    modified,
    summaryByRelevance: rows.reduce((a, r) => {
      a[r.relevance] = (a[r.relevance] || 0) + 1;
      return a;
    }, {}),
    jobs: rows,
    note:
      'Replacement V2 schedules are NOT created here. After path proof + owner approval, '
      + 'run reconcileArrivalAutomationV2.cjs --apply --confirm-schedule-only with worker still off.'
  };

  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
