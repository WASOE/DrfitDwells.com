'use strict';

/**
 * Dispatch adapter: claimed allowlisted ScheduledMessageJob → sendArrivalEmailV2.
 *
 * Revalidates booking eligibility, schedule generation, and itinerary state
 * immediately before SMTP. Never sends WhatsApp. Never uses shadow success.
 */

const mongoose = require('mongoose');
const Booking = require('../../../models/Booking');
const ScheduledMessageJob = require('../../../models/ScheduledMessageJob');
const {
  isArrivalAutomationAuthorized,
  isArrivalAutomationRuleKey
} = require('./arrivalFeatureFlags');
const { resolveArrivalStayContext } = require('./arrivalStayResolver');
const {
  buildArrivalStateKey,
  readArrivalComms,
  stateMatchesLastCommunicated
} = require('./arrivalCommunicationRevision');
const { sendArrivalEmailV2 } = require('./arrivalEmailSendService');
const {
  markCommunicated,
  markInitialBaseline,
  syncArrivalAutomationForBooking
} = require('./arrivalAutomationScheduler');
const { resolveAutomaticArrivalSchedule } = require('./arrivalSchedulePolicy');

function logLine(level, phase, fields) {
  const payload = JSON.stringify({ source: 'arrival-auto-dispatch', phase, ...fields });
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

async function transitionJob(jobId, $set) {
  return ScheduledMessageJob.findOneAndUpdate(
    { _id: jobId, status: 'claimed' },
    { $set },
    { new: true }
  );
}

/**
 * Process a claimed arrival automation job.
 * @param {string|object} jobOrId
 */
async function processArrivalAutomationJob(jobOrId, options = {}) {
  if (!isArrivalAutomationAuthorized()) {
    return { ran: false, disabled: true };
  }

  const now = options.now || new Date();
  let job =
    jobOrId && typeof jobOrId === 'object' && jobOrId._id
      ? jobOrId
      : await ScheduledMessageJob.findById(jobOrId).lean();

  if (!job) return { ran: true, missing: true };
  if (!isArrivalAutomationRuleKey(job.ruleKey)) {
    return { ran: false, skippedReason: 'not_arrival_allowlist' };
  }
  if (job.status !== 'claimed') {
    return { ran: true, skippedReason: 'not_claimed', status: job.status };
  }
  // Refuse legacy/GMA-scheduled rows that lack V2 payload markers.
  if (job.payloadSnapshot?.arrivalAutomationV2 !== true) {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'missing_arrival_automation_v2_payload',
      cancelActor: 'arrival-auto-dispatch'
    });
    return { ran: true, terminal: 'cancelled', reason: 'missing_v2_payload' };
  }
  if (job.payloadSnapshot?.scheduleGeneration == null) {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'missing_schedule_generation',
      cancelActor: 'arrival-auto-dispatch'
    });
    return { ran: true, terminal: 'cancelled', reason: 'missing_generation' };
  }

  const booking = job.bookingId ? await Booking.findById(job.bookingId) : null;
  if (!booking) {
    await transitionJob(job._id, { status: 'failed', lastError: 'booking_missing' });
    return { ran: true, terminal: 'failed', reason: 'booking_missing' };
  }

  if (booking.status === 'cancelled') {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'booking_cancelled_at_dispatch',
      cancelActor: 'arrival-auto-dispatch'
    });
    return { ran: true, terminal: 'cancelled', reason: 'booking_cancelled' };
  }

  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    await transitionJob(job._id, {
      status: 'skipped_status_guard',
      lastError: `status:${booking.status}`
    });
    return { ran: true, terminal: 'skipped_status_guard' };
  }

  const stay = await resolveArrivalStayContext(booking);
  if (!stay.ok) {
    await transitionJob(job._id, { status: 'failed', lastError: 'property_unresolved' });
    await safeOpenMri({
      category: 'comms_arrival_automation_requires_review',
      severity: 'high',
      entityType: 'Booking',
      entityId: String(booking._id),
      title: 'Arrival auto-dispatch: property unresolved',
      details: stay.message || 'unresolved',
      provenance: { source: 'arrival-auto-dispatch', sourceReference: String(job._id) }
    });
    return { ran: true, terminal: 'failed', reason: 'property_unresolved' };
  }

  const expectedRule =
    stay.propertyKind === 'cabin'
      ? 'arrival_instructions_pre_arrival_cabin'
      : stay.propertyKind === 'valley'
        ? 'arrival_instructions_pre_arrival_valley'
        : null;
  if (expectedRule !== job.ruleKey) {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'property_reassigned_at_dispatch',
      cancelActor: 'arrival-auto-dispatch'
    });
    // Resync to current property
    await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      reason: 'dispatch_property_mismatch',
      now
    });
    return { ran: true, terminal: 'cancelled', reason: 'property_mismatch_resynced' };
  }

  const stateKey = buildArrivalStateKey(booking, stay.propertyKind);
  const snap = job.payloadSnapshot || {};
  const bookingComms = readArrivalComms(booking);
  const liveGeneration = bookingComms.scheduleGeneration;
  const jobGeneration = snap.scheduleGeneration;

  if (
    jobGeneration != null &&
    liveGeneration != null &&
    Number(jobGeneration) !== Number(liveGeneration)
  ) {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'stale_schedule_generation',
      cancelActor: 'arrival-auto-dispatch'
    });
    return { ran: true, terminal: 'cancelled', reason: 'stale_generation' };
  }

  if (snap.stateKey && snap.stateKey !== stateKey) {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'itinerary_changed_at_dispatch',
      cancelActor: 'arrival-auto-dispatch'
    });
    await syncArrivalAutomationForBooking({
      bookingId: booking._id,
      reason: 'dispatch_itinerary_mismatch',
      now
    });
    return { ran: true, terminal: 'cancelled', reason: 'itinerary_mismatch_resynced' };
  }

  const cutoffCheck = resolveAutomaticArrivalSchedule({ checkIn: booking.checkIn, now });
  if (!cutoffCheck.ok && cutoffCheck.code === 'past_cutoff') {
    await transitionJob(job._id, {
      status: 'cancelled',
      cancelReason: 'past_cutoff_at_dispatch',
      cancelActor: 'arrival-auto-dispatch'
    });
    await safeOpenMri({
      category: 'comms_arrival_automation_requires_review',
      severity: 'medium',
      entityType: 'Booking',
      entityId: String(booking._id),
      title: 'Arrival auto-dispatch past cutoff',
      details: cutoffCheck.message,
      provenance: { source: 'arrival-auto-dispatch', sourceReference: String(job._id) }
    });
    return { ran: true, terminal: 'cancelled', reason: 'past_cutoff' };
  }

  const purpose = snap.purpose === 'correction' ? 'correction' : 'initial';

  if (purpose === 'correction') {
    if (stateMatchesLastCommunicated(bookingComms, stateKey)) {
      await transitionJob(job._id, {
        status: 'skipped_status_guard',
        lastError: 'state_matches_last_communicated'
      });
      return { ran: true, terminal: 'skipped', reason: 'noop_correction' };
    }
    const revision = Number(snap.revision);
    if (!Number.isInteger(revision) || revision < 1) {
      await transitionJob(job._id, { status: 'failed', lastError: 'invalid_correction_revision' });
      return { ran: true, terminal: 'failed', reason: 'invalid_revision' };
    }

    const sendResult = await sendArrivalEmailV2({
      booking,
      kind: 'correction',
      revision,
      actor: { id: 'arrival-automation-v2', role: 'system' },
      scheduledMessageJobId: job._id,
      lifecycleSource: 'automatic'
    });

    if (sendResult.ok && sendResult.status === 'accepted') {
      await markCommunicated({ bookingId: booking._id, revision, stateKey });
      await transitionJob(job._id, { status: 'sent', lastError: null });
      return {
        ran: true,
        terminal: 'sent',
        purpose: 'correction',
        revision,
        dispatchId: sendResult.dispatchId,
        duplicate: Boolean(sendResult.duplicate)
      };
    }

    if (sendResult.uncertain) {
      await transitionJob(job._id, {
        status: 'failed',
        lastError: sendResult.code || 'uncertain'
      });
      return { ran: true, terminal: 'failed', uncertain: true, sendResult };
    }

    if (sendResult.retriable) {
      // Leave claimed → sweeper reclaims; do not mark sent.
      return { ran: true, retry: true, sendResult };
    }

    await transitionJob(job._id, {
      status: 'failed',
      lastError: sendResult.code || 'send_failed'
    });
    return { ran: true, terminal: 'failed', sendResult };
  }

  // Initial
  const sendResult = await sendArrivalEmailV2({
    booking,
    kind: 'send',
    actor: { id: 'arrival-automation-v2', role: 'system' },
    scheduledMessageJobId: job._id,
    lifecycleSource: 'automatic'
  });

  if (sendResult.ok && sendResult.status === 'accepted') {
    // Duplicate initial (e.g. manual send raced) must not reset an advanced
    // correction revision — only baseline when no state has been recorded yet.
    if (sendResult.duplicate) {
      await markInitialBaseline({ bookingId: booking._id, stateKey });
    } else {
      await markCommunicated({ bookingId: booking._id, revision: 0, stateKey });
    }
    await transitionJob(job._id, { status: 'sent', lastError: null });
    return {
      ran: true,
      terminal: 'sent',
      purpose: 'initial',
      dispatchId: sendResult.dispatchId,
      duplicate: Boolean(sendResult.duplicate)
    };
  }

  if (sendResult.uncertain) {
    await transitionJob(job._id, {
      status: 'failed',
      lastError: sendResult.code || 'uncertain'
    });
    return { ran: true, terminal: 'failed', uncertain: true, sendResult };
  }

  if (sendResult.retriable) {
    return { ran: true, retry: true, sendResult };
  }

  await transitionJob(job._id, {
    status: 'failed',
    lastError: sendResult.code || 'send_failed'
  });
  return { ran: true, terminal: 'failed', sendResult };
}

module.exports = {
  processArrivalAutomationJob
};
