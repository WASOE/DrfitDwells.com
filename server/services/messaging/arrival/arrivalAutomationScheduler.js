'use strict';

/**
 * Arrival Automation V2 scheduler (PR2).
 *
 * Independent of MESSAGE_ORCHESTRATOR_ENABLED — gated solely by
 * ARRIVAL_AUTOMATION_V2 (+ ARRIVAL_EMAIL_V2 required at dispatch).
 *
 * Uses ScheduledMessageJob with allowlisted rule keys and generation fencing
 * so stale schedule writers cannot overwrite newer booking state.
 */

const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Booking = require('../../../models/Booking');
const ScheduledMessageJob = require('../../../models/ScheduledMessageJob');
const MessageDispatch = require('../../../models/MessageDispatch');
const { PROPERTY_TIMEZONE } = require('../../../utils/dateTime');
const {
  isArrivalAutomationAuthorized,
  isArrivalAutomationRuleKey,
  ARRIVAL_AUTOMATION_RULE_KEYS
} = require('./arrivalFeatureFlags');
const { resolveArrivalStayContext } = require('./arrivalStayResolver');
const {
  buildArrivalStateKey,
  readArrivalComms,
  initialAlreadyCommunicated,
  stateMatchesLastCommunicated
} = require('./arrivalCommunicationRevision');
const {
  resolveAutomaticArrivalSchedule,
  applyCorrectionCoalesce
} = require('./arrivalSchedulePolicy');
const { buildInitialArrivalIdempotencyKey } = require('./arrivalDispatchIdentity');

const CANCELABLE = Object.freeze(['scheduled', 'claimed']);
const MRI_CATEGORY = 'comms_arrival_automation_requires_review';

function logLine(level, phase, fields) {
  const payload = JSON.stringify({ source: 'arrival-automation-v2', phase, ...fields });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

async function safeOpenMri(params) {
  try {
    const { openManualReviewItem } = require('../../ops/ingestion/manualReviewService');
    return await openManualReviewItem(params);
  } catch (err) {
    logLine('error', 'mri_open_failed', { error: err?.message || String(err) });
    return null;
  }
}

function ruleKeyForPropertyKind(propertyKind) {
  if (propertyKind === 'cabin') return 'arrival_instructions_pre_arrival_cabin';
  if (propertyKind === 'valley') return 'arrival_instructions_pre_arrival_valley';
  return null;
}

function isEligibleBooking(booking) {
  if (!booking) return { ok: false, reason: 'booking_missing' };
  if (booking.status === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    return { ok: false, reason: 'status_not_confirmed' };
  }
  if (booking.manualReservationPurpose === 'staff_stay') {
    // Staff stays are eligible for Ops tests when automation is on; still
    // excluded from reconciliation dry-run by default via reconcile script.
  }
  if (booking.suppressGuestEmail === true) return { ok: false, reason: 'suppress_guest_email' };
  const email = booking.guestInfo?.email;
  if (!email || !String(email).includes('@')) return { ok: false, reason: 'missing_email' };
  return { ok: true };
}

async function hasAcceptedInitial(bookingId) {
  const key = buildInitialArrivalIdempotencyKey(bookingId);
  const row = await MessageDispatch.findOne({ idempotencyKey: key, status: 'accepted' }).lean();
  return Boolean(row);
}

/**
 * Cancel allowlisted non-terminal jobs. Includes due/claimed (not only future).
 * Never touches sent/failed/skipped terminals.
 */
async function cancelActiveArrivalJobs({ bookingId, reason, actor = 'arrival-automation-v2' }) {
  const res = await ScheduledMessageJob.updateMany(
    {
      bookingId,
      ruleKey: { $in: [...ARRIVAL_AUTOMATION_RULE_KEYS] },
      status: { $in: [...CANCELABLE] }
    },
    {
      $set: {
        status: 'cancelled',
        cancelReason: reason,
        cancelActor: actor,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
  return { cancelled: res.modifiedCount || 0 };
}

async function bumpScheduleGeneration(bookingId) {
  const updated = await Booking.findOneAndUpdate(
    { _id: bookingId },
    {
      $inc: { 'arrivalCommsV2.scheduleGeneration': 1 },
      $setOnInsert: {
        'arrivalCommsV2.communicationRevision': 0,
        'arrivalCommsV2.lastCommunicatedRevision': null,
        'arrivalCommsV2.lastCommunicatedStateKey': null
      }
    },
    { new: true }
  );
  return updated;
}

/**
 * Allocate next communication revision for a material change after initial.
 * Idempotent relative to pendingCorrectionRevision when state unchanged mid-coalesce
 * is handled by callers via state key comparison.
 */
async function allocateCorrectionRevision(bookingId) {
  const updated = await Booking.findOneAndUpdate(
    { _id: bookingId },
    { $inc: { 'arrivalCommsV2.communicationRevision': 1 } },
    { new: true }
  );
  const rev = Number(updated?.arrivalCommsV2?.communicationRevision) || 0;
  await Booking.updateOne(
    { _id: bookingId },
    { $set: { 'arrivalCommsV2.pendingCorrectionRevision': rev } }
  );
  return rev;
}

async function clearPendingCorrection(bookingId) {
  await Booking.updateOne(
    { _id: bookingId },
    {
      $set: {
        'arrivalCommsV2.pendingCorrectionRevision': null,
        'arrivalCommsV2.coalesceUntil': null
      }
    }
  );
}

async function markCommunicated({ bookingId, revision, stateKey }) {
  await Booking.updateOne(
    { _id: bookingId },
    {
      $set: {
        'arrivalCommsV2.lastCommunicatedRevision': revision,
        'arrivalCommsV2.lastCommunicatedStateKey': stateKey,
        'arrivalCommsV2.pendingCorrectionRevision': null,
        'arrivalCommsV2.coalesceUntil': null
      }
    }
  );
}

/**
 * Baseline after a newly accepted manual initial send.
 * Never regresses an already-advanced correction revision, and never
 * overwrites an existing lastCommunicatedStateKey.
 */
async function markInitialBaseline({ bookingId, stateKey }) {
  const res = await Booking.updateOne(
    {
      _id: bookingId,
      $and: [
        {
          $or: [
            { 'arrivalCommsV2.lastCommunicatedRevision': { $exists: false } },
            { 'arrivalCommsV2.lastCommunicatedRevision': null },
            { 'arrivalCommsV2.lastCommunicatedRevision': 0 }
          ]
        },
        {
          $or: [
            { 'arrivalCommsV2.lastCommunicatedStateKey': { $exists: false } },
            { 'arrivalCommsV2.lastCommunicatedStateKey': null }
          ]
        }
      ]
    },
    {
      $set: {
        'arrivalCommsV2.lastCommunicatedRevision': 0,
        'arrivalCommsV2.lastCommunicatedStateKey': stateKey,
        'arrivalCommsV2.pendingCorrectionRevision': null,
        'arrivalCommsV2.coalesceUntil': null
      }
    }
  );
  return { matched: res.matchedCount || 0, modified: res.modifiedCount || 0 };
}

/**
 * Create or reactivate a scheduled job under unique (bookingId, ruleKey, scheduledFor).
 * Prefer reactivating a cancelled row at the same key over inserting a duplicate.
 */
async function upsertArrivalJob({
  booking,
  ruleKey,
  propertyKind,
  scheduledForUtc,
  scheduledForSofiaIso,
  purpose,
  revision,
  scheduleGeneration,
  stateKey
}) {
  const payloadSnapshot = {
    purpose,
    revision: revision == null ? null : revision,
    scheduleGeneration,
    stateKey,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    propertyKind,
    cabinId: booking.cabinId || null,
    cabinTypeId: booking.cabinTypeId || null,
    unitId: booking.unitId || null,
    arrivalAutomationV2: true
  };

  const reactivated = await ScheduledMessageJob.findOneAndUpdate(
    {
      bookingId: booking._id,
      ruleKey,
      scheduledFor: scheduledForUtc,
      status: 'cancelled'
    },
    {
      $set: {
        status: 'scheduled',
        cancelReason: null,
        cancelActor: null,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        lastError: null,
        payloadSnapshot,
        propertyKind,
        audience: 'guest',
        scheduledForSofia: scheduledForSofiaIso,
        ruleVersionAtSchedule: 1,
        attemptCount: 0
      }
    },
    { new: true }
  );
  if (reactivated) {
    return { created: false, reactivated: true, jobId: String(reactivated._id) };
  }

  try {
    const job = await ScheduledMessageJob.create({
      ruleKey,
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind,
      scheduledFor: scheduledForUtc,
      scheduledForSofia: scheduledForSofiaIso,
      status: 'scheduled',
      payloadSnapshot
    });
    return { created: true, reactivated: false, jobId: String(job._id) };
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      const existing = await ScheduledMessageJob.findOne({
        bookingId: booking._id,
        ruleKey,
        scheduledFor: scheduledForUtc
      });
      if (!existing) {
        return { created: false, reactivated: false, duplicate: true, jobId: null };
      }

      const existingGen = Number(existing.payloadSnapshot?.scheduleGeneration);
      const canUpgrade =
        ['scheduled', 'cancelled'].includes(existing.status) &&
        (Number.isFinite(existingGen) ? existingGen < scheduleGeneration : true);

      if (canUpgrade) {
        // Compare-and-set: newer generation wins over a stale row at the same
        // unique key so concurrent syncs converge without orphaning the winner.
        const upgraded = await ScheduledMessageJob.findOneAndUpdate(
          {
            _id: existing._id,
            status: { $in: ['scheduled', 'cancelled'] },
            $or: [
              { 'payloadSnapshot.scheduleGeneration': { $lt: scheduleGeneration } },
              { 'payloadSnapshot.scheduleGeneration': { $exists: false } },
              { 'payloadSnapshot.scheduleGeneration': null }
            ]
          },
          {
            $set: {
              status: 'scheduled',
              cancelReason: null,
              cancelActor: null,
              claimedBy: null,
              claimedAt: null,
              visibilityTimeoutAt: null,
              lastError: null,
              payloadSnapshot,
              propertyKind,
              audience: 'guest',
              scheduledForSofia: scheduledForSofiaIso,
              ruleVersionAtSchedule: 1,
              attemptCount: 0
            }
          },
          { new: true }
        );
        if (upgraded) {
          return {
            created: false,
            reactivated: false,
            upgraded: true,
            jobId: String(upgraded._id)
          };
        }
      }

      if (['sent', 'failed', 'skipped_status_guard'].includes(existing.status)) {
        logLine('warn', 'terminal_job_blocks_unique_key', {
          bookingId: String(booking._id),
          ruleKey,
          jobId: String(existing._id),
          status: existing.status,
          scheduleGeneration,
          existingGeneration: existing.payloadSnapshot?.scheduleGeneration ?? null,
          purpose
        });
        await safeOpenMri({
          category: MRI_CATEGORY,
          severity: 'high',
          entityType: 'ScheduledMessageJob',
          entityId: String(existing._id),
          title: 'Arrival automation: terminal job blocks reschedule',
          details:
            'A terminal ScheduledMessageJob occupies the unique (bookingId, ruleKey, scheduledFor) key; newer schedule could not be written.',
          provenance: { source: 'arrival-automation-v2', sourceReference: 'upsert_terminal_conflict' },
          evidence: {
            purpose,
            scheduleGeneration,
            existingStatus: existing.status,
            existingGeneration: existing.payloadSnapshot?.scheduleGeneration ?? null
          }
        });
        return {
          created: false,
          reactivated: false,
          conflict: true,
          jobId: String(existing._id),
          status: existing.status
        };
      }

      return {
        created: false,
        reactivated: false,
        duplicate: true,
        jobId: String(existing._id),
        status: existing.status
      };
    }
    throw err;
  }
}

/**
 * Authoritative schedule sync for one booking.
 */
async function syncArrivalAutomationForBooking({
  bookingId,
  reason = 'sync',
  now = new Date(),
  force = false
} = {}) {
  if (!isArrivalAutomationAuthorized() && !force) {
    return { ran: false, disabled: true };
  }
  if (bookingId == null || !mongoose.isValidObjectId(bookingId)) {
    return { ran: false, error: 'invalid_booking_id' };
  }

  try {
    const bumped = await bumpScheduleGeneration(bookingId);
    if (!bumped) return { ran: true, skipped: 'booking_missing' };
    const scheduleGeneration = Number(bumped.arrivalCommsV2?.scheduleGeneration) || 0;

    const booking = await Booking.findById(bookingId);
    if (!booking) return { ran: true, skipped: 'booking_missing' };

    const eligibility = isEligibleBooking(booking);
    if (!eligibility.ok) {
      const cancelRes = await cancelActiveArrivalJobs({
        bookingId: booking._id,
        reason: `ineligible:${eligibility.reason}`
      });
      if (eligibility.reason === 'cancelled') {
        await clearPendingCorrection(booking._id);
      }
      return { ran: true, skipped: eligibility.reason, cancelled: cancelRes.cancelled, scheduleGeneration };
    }

    const stay = await resolveArrivalStayContext(booking);
    if (!stay.ok) {
      await cancelActiveArrivalJobs({ bookingId: booking._id, reason: 'property_unresolved' });
      await safeOpenMri({
        category: MRI_CATEGORY,
        severity: 'high',
        entityType: 'Booking',
        entityId: String(booking._id),
        title: 'Arrival automation: property unresolved',
        details: stay.message || 'Unable to resolve arrival stay context',
        provenance: { source: 'arrival-automation-v2', sourceReference: reason },
        evidence: { code: stay.code || null }
      });
      return { ran: true, skipped: 'property_unresolved', scheduleGeneration };
    }

    const ruleKey = ruleKeyForPropertyKind(stay.propertyKind);
    if (!ruleKey || !isArrivalAutomationRuleKey(ruleKey)) {
      return { ran: true, skipped: 'unsupported_property', scheduleGeneration };
    }

    const stateKey = buildArrivalStateKey(booking, stay.propertyKind);
    const comms = readArrivalComms(booking);
    const acceptedInitial = await hasAcceptedInitial(booking._id);
    // Prefer MessageDispatch as source of truth for "initial already sent".
    const initialDone = acceptedInitial || initialAlreadyCommunicated(comms);

    await cancelActiveArrivalJobs({
      bookingId: booking._id,
      reason: `reschedule:${reason}`
    });

    // Generation fence: if a newer sync advanced the counter, abort before
    // writing jobs so stale writers cannot replace newer schedules.
    const genCheck = await Booking.findById(booking._id).select('arrivalCommsV2').lean();
    if (Number(genCheck?.arrivalCommsV2?.scheduleGeneration) !== scheduleGeneration) {
      logLine('log', 'superseded_before_schedule', {
        bookingId: String(booking._id),
        scheduleGeneration,
        liveGeneration: genCheck?.arrivalCommsV2?.scheduleGeneration ?? null
      });
      return { ran: true, superseded: true, scheduleGeneration };
    }

    const schedule = resolveAutomaticArrivalSchedule({ checkIn: booking.checkIn, now });
    if (!schedule.ok) {
      await clearPendingCorrection(booking._id);
      await safeOpenMri({
        category: MRI_CATEGORY,
        severity: 'medium',
        entityType: 'Booking',
        entityId: String(booking._id),
        title: 'Arrival automation: operator review required',
        details: schedule.message,
        provenance: { source: 'arrival-automation-v2', sourceReference: reason },
        evidence: { code: schedule.code, cutoffUtc: schedule.cutoffUtc || null }
      });
      return {
        ran: true,
        skipped: schedule.code,
        scheduleGeneration,
        needsOperatorReview: true
      };
    }

    if (!initialDone) {
      const job = await upsertArrivalJob({
        booking,
        ruleKey,
        propertyKind: stay.propertyKind,
        scheduledForUtc: schedule.scheduledForUtc,
        scheduledForSofiaIso: schedule.scheduledForSofiaIso,
        purpose: 'initial',
        revision: null,
        scheduleGeneration,
        stateKey
      });
      logLine('log', 'scheduled_initial', {
        bookingId: String(booking._id),
        jobId: job.jobId,
        mode: schedule.mode,
        scheduledFor: schedule.scheduledForUtc.toISOString(),
        scheduleGeneration
      });
      return {
        ran: true,
        purpose: 'initial',
        mode: schedule.mode,
        job,
        scheduleGeneration,
        stateKey
      };
    }

    // Initial already accepted.
    if (stateMatchesLastCommunicated(comms, stateKey)) {
      await clearPendingCorrection(booking._id);
      logLine('log', 'noop_state_matches_last_communicated', {
        bookingId: String(booking._id),
        stateKey,
        scheduleGeneration
      });
      return {
        ran: true,
        purpose: 'noop',
        reason: 'state_matches_last_communicated',
        scheduleGeneration,
        stateKey
      };
    }

    // Manual/legacy initial may exist without lastCommunicatedStateKey.
    // Baseline the *current* itinerary as revision 0 (monotonic) so we do
    // not SMTP a same-state correction. Later material changes still allocate
    // correction revisions.
    if (acceptedInitial && comms.lastCommunicatedStateKey == null) {
      await markInitialBaseline({ bookingId: booking._id, stateKey });
      logLine('log', 'baseline_manual_initial_state', {
        bookingId: String(booking._id),
        stateKey,
        scheduleGeneration
      });
      return {
        ran: true,
        purpose: 'noop',
        reason: 'baselined_manual_initial',
        scheduleGeneration,
        stateKey
      };
    }

    const revision = await allocateCorrectionRevision(booking._id);
    // For corrections, coalesce from "now" so rapid edits share one send window.
    // Nominal T-3 still applies when it is later than the coalesce instant.
    const coalesced = applyCorrectionCoalesce({
      desiredUtc: schedule.scheduledForUtc,
      now,
      cutoffUtc: schedule.cutoffUtc
    });
    if (!coalesced.ok) {
      await safeOpenMri({
        category: MRI_CATEGORY,
        severity: 'medium',
        entityType: 'Booking',
        entityId: String(booking._id),
        title: 'Arrival correction past cutoff',
        details: coalesced.message,
        provenance: { source: 'arrival-automation-v2', sourceReference: reason },
        evidence: { revision, code: coalesced.code }
      });
      return { ran: true, skipped: coalesced.code, revision, scheduleGeneration };
    }

    const genCheck2 = await Booking.findById(booking._id).select('arrivalCommsV2').lean();
    if (Number(genCheck2?.arrivalCommsV2?.scheduleGeneration) !== scheduleGeneration) {
      return { ran: true, superseded: true, scheduleGeneration, revision };
    }

    await Booking.updateOne(
      { _id: booking._id },
      { $set: { 'arrivalCommsV2.coalesceUntil': coalesced.coalesceUntil } }
    );

    const job = await upsertArrivalJob({
      booking,
      ruleKey,
      propertyKind: stay.propertyKind,
      scheduledForUtc: coalesced.scheduledForUtc,
      scheduledForSofiaIso: moment.tz(coalesced.scheduledForUtc, PROPERTY_TIMEZONE).format(),
      purpose: 'correction',
      revision,
      scheduleGeneration,
      stateKey
    });

    logLine('log', 'scheduled_correction', {
      bookingId: String(booking._id),
      jobId: job.jobId,
      revision,
      scheduledFor: coalesced.scheduledForUtc.toISOString(),
      scheduleGeneration
    });

    return {
      ran: true,
      purpose: 'correction',
      revision,
      job,
      scheduleGeneration,
      stateKey
    };
  } catch (err) {
    logLine('error', 'sync_failed', {
      bookingId: String(bookingId),
      error: err?.message || String(err)
    });
    await safeOpenMri({
      category: MRI_CATEGORY,
      severity: 'high',
      entityType: 'Booking',
      entityId: String(bookingId),
      title: 'Arrival automation sync failed',
      details: err?.message || String(err),
      provenance: { source: 'arrival-automation-v2', sourceReference: reason }
    });
    return { ran: true, error: true, message: err?.message || String(err) };
  }
}

function fireAndForgetSync(bookingId, reason) {
  if (!isArrivalAutomationAuthorized()) return;
  Promise.resolve()
    .then(() => syncArrivalAutomationForBooking({ bookingId, reason }))
    .catch((err) => {
      logLine('error', 'async_sync_failed', {
        bookingId: String(bookingId),
        error: err?.message || String(err)
      });
    });
}

module.exports = {
  syncArrivalAutomationForBooking,
  fireAndForgetSync,
  cancelActiveArrivalJobs,
  markCommunicated,
  markInitialBaseline,
  hasAcceptedInitial,
  isEligibleBooking,
  ruleKeyForPropertyKind,
  bumpScheduleGeneration,
  MRI_CATEGORY,
  CANCELABLE
};
