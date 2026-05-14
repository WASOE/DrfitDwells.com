'use strict';

/**
 * MessageOrchestrator (Batch 7).
 *
 * Reads enabled `MessageAutomationRule` rows (`enabled: true` and
 * `mode` in `shadow` | `auto` only — `manual_approve` is excluded until an
 * approval workflow exists) and produces `ScheduledMessageJob` rows from
 * booking lifecycle events. It does NOT
 * send anything, does NOT call any provider, and does NOT write to
 * `MessageDispatch` or `MessageDeliveryEvent`. The scheduler worker
 * (Batch 6) is the only thing that claims these jobs, and it remains
 * disabled and claim-only.
 *
 * Hooks (six surfaces, additive only):
 *
 *   1. POST /api/bookings post-response IIFE in routes/bookingRoutes.js.
 *   2. reservationWriteService.transitionReservation (confirm/cancel/...)
 *   3. reservationWriteService.editReservationDates
 *   4. reservationWriteService.reassignReservation
 *   5. reservationWriteService.createManualReservation
 *   6. adminController.updateBookingStatus
 *
 * Feature flag (default OFF):
 *
 *   MESSAGE_ORCHESTRATOR_ENABLED=1
 *
 * Everything else (unset, '0', 'true', 'TRUE', empty) -> orchestrator
 * returns immediately. No DB reads. No writes. No behaviour change.
 *
 * Strict payment-proof guard (D-12, locked in Batch 7 review):
 *
 *   Allowed:
 *     - paymentMethod === 'stripe'                  AND stripePaymentIntentId present
 *     - paymentMethod === 'stripe_plus_gift_voucher' AND stripePaymentIntentId present
 *     - paymentMethod === 'gift_voucher'            AND giftVoucherRedemptionId present
 *
 *   Everything else blocked. This deliberately blocks
 *   BOOKING_CONFIRM_WITHOUT_STRIPE and most manual confirmed bookings.
 *   Acceptable for V1; OPS exceptions go through manual send (out of
 *   scope here).
 *
 * Sofia scheduling math: see ./messageOrchestratorTime.js. T-72h is
 * calendar-based, not UTC arithmetic.
 *
 * Cancellation in Batch 7: cancels ScheduledMessageJob rows only
 * (status in {scheduled, claimed} and scheduledFor > now). Terminal
 * statuses untouched. No MessageDispatch writes.
 *
 * Failure isolation: every public function is wrapped so booking writes
 * never block. Only the documented error categories produce
 * ManualReviewItem rows:
 *
 *   - comms_orchestrator_hook_failed   (top-level catch)
 *   - comms_property_kind_missing      (resolver throw, guest rules only)
 *
 * No review items for: disabled rules, payment-guard blocks, status
 * mismatches, scope mismatches, past targets, duplicate-key dedupes.
 *
 * See: docs/guest-message-automation/02_V1_SPEC.md §§17, 32, 33, 34
 *      docs/guest-message-automation/03_IMPLEMENTATION_BATCHES.md Batch 7.
 */

const mongoose = require('mongoose');

const Booking = require('../../models/Booking');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const MessageAutomationRule = require('../../models/MessageAutomationRule');
const ScheduledMessageJob = require('../../models/ScheduledMessageJob');

const {
  resolvePropertyKindFromCabinDoc,
  resolvePropertyKindFromCabinTypeDoc,
  PropertyKindUnresolvedError
} = require('./propertyKindResolver');
const { computeScheduledSofiaInstant } = require('./messageOrchestratorTime');

const ENV_FLAG = 'MESSAGE_ORCHESTRATOR_ENABLED';

const HOOK_FAILED_CATEGORY = 'comms_orchestrator_hook_failed';
const PROPERTY_KIND_MISSING_CATEGORY = 'comms_property_kind_missing';

const CANCELABLE_STATUSES = Object.freeze(['scheduled', 'claimed']);

function isOrchestratorEnabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function logLine(level, phase, fields) {
  const payload = JSON.stringify({
    source: 'message-orchestrator',
    phase,
    ...fields
  });
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else console.log(payload);
}

async function safeOpenManualReviewItem(params) {
  try {
    // Lazy require so unit tests can stub manualReviewService.openManualReviewItem
    // via mongoose model mocking without pulling in routes etc.
    const { openManualReviewItem } = require('../ops/ingestion/manualReviewService');
    return await openManualReviewItem(params);
  } catch (err) {
    logLine('error', 'manual_review_item_open_failed', {
      category: params?.category,
      entityId: params?.entityId ? String(params.entityId) : null,
      error: err?.message || String(err)
    });
    return null;
  }
}

/**
 * Strict payment-proof guard (D-12).
 *
 * Returns true only for one of the three explicitly allowed combinations.
 * Treated the same for guest and ops audiences in Batch 7; OPS-specific
 * tuning is a Batch 12 decision.
 */
function passesPaymentProofGuard(booking) {
  if (!booking) return false;
  const method = booking.paymentMethod;
  const piId = typeof booking.stripePaymentIntentId === 'string'
    && booking.stripePaymentIntentId.trim().length > 0;
  const redemptionId = booking.giftVoucherRedemptionId != null;
  if (method === 'stripe' && piId) return true;
  if (method === 'stripe_plus_gift_voucher' && piId) return true;
  if (method === 'gift_voucher' && redemptionId) return true;
  return false;
}

function passesStatusGuard(booking, rule) {
  if (!Array.isArray(rule?.requiredBookingStatus) || rule.requiredBookingStatus.length === 0) {
    // Conservative default: rule with no statuses listed cannot schedule.
    return false;
  }
  return rule.requiredBookingStatus.includes(booking?.status);
}

function passesScopeGuard(rule, propertyKind) {
  if (!rule?.propertyScope) return false;
  if (rule.propertyScope === 'any') return true;
  return rule.propertyScope === propertyKind;
}

async function resolveBookingPropertyKind(booking) {
  if (booking?.cabinId) {
    const cabin = await Cabin.findById(booking.cabinId).select('propertyKind').lean();
    return resolvePropertyKindFromCabinDoc(cabin);
  }
  if (booking?.cabinTypeId) {
    const cabinType = await CabinType.findById(booking.cabinTypeId).select('propertyKind').lean();
    return resolvePropertyKindFromCabinTypeDoc(cabinType);
  }
  throw new PropertyKindUnresolvedError(
    'Booking has neither cabinId nor cabinTypeId; cannot resolve propertyKind.',
    { reason: 'no_stay_target' }
  );
}

async function loadEnabledRules() {
  return MessageAutomationRule.find({ enabled: true, mode: { $in: ['shadow', 'auto'] } }).lean();
}

function pickAnchorDate(rule, booking) {
  if (rule?.triggerType === 'time_relative_to_check_out') return booking?.checkOut;
  return booking?.checkIn;
}

function buildPayloadSnapshot(booking, propertyKind) {
  return {
    bookingStatus: booking?.status || null,
    paymentMethod: booking?.paymentMethod || null,
    checkIn: booking?.checkIn || null,
    checkOut: booking?.checkOut || null,
    propertyKind
  };
}

function ruleApplicableTo(rule, booking, propertyKind) {
  if (!rule?.enabled) return { ok: false, reason: 'rule_disabled' };
  if (!passesStatusGuard(booking, rule)) return { ok: false, reason: 'status_mismatch' };
  if (!passesPaymentProofGuard(booking)) return { ok: false, reason: 'payment_guard_blocked' };
  if (!passesScopeGuard(rule, propertyKind)) return { ok: false, reason: 'scope_mismatch' };
  return { ok: true };
}

function computeScheduledForForRule(rule, booking) {
  const offsetHours = Number.isFinite(rule?.triggerConfig?.offsetHours)
    ? rule.triggerConfig.offsetHours
    : null;
  if (offsetHours == null) return null;
  if (!['time_relative_to_check_in', 'time_relative_to_check_out'].includes(rule?.triggerType)) {
    // Batch 7 only supports time-relative triggers. Other triggers
    // (booking_status_change, manual) are not used by V1 seeded rules.
    return null;
  }
  const anchor = pickAnchorDate(rule, booking);
  return computeScheduledSofiaInstant({
    anchorDate: anchor,
    offsetHours,
    sofiaHour: rule?.triggerConfig?.sofiaHour,
    sofiaMinute: rule?.triggerConfig?.sofiaMinute
  });
}

async function createJobIdempotent({ booking, rule, scheduledForUtc, scheduledForSofiaIso, propertyKind }) {
  const audience = rule.audience;
  // ScheduledMessageJob.propertyKind is required and uses enum cabin/valley/any.
  // Use the rule's scope when it is 'any' so OPS-any rules can produce rows
  // (otherwise we'd need cabin/valley which doesn't match an 'any' rule).
  const persistedPropertyKind = rule.propertyScope === 'any' ? 'any' : propertyKind;

  try {
    const job = await ScheduledMessageJob.create({
      ruleKey: rule.ruleKey,
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience,
      propertyKind: persistedPropertyKind,
      scheduledFor: scheduledForUtc,
      scheduledForSofia: scheduledForSofiaIso,
      status: 'scheduled',
      payloadSnapshot: buildPayloadSnapshot(booking, propertyKind)
    });
    logLine('log', 'scheduled', {
      bookingId: String(booking._id),
      ruleKey: rule.ruleKey,
      jobId: String(job._id),
      scheduledFor: scheduledForUtc.toISOString()
    });
    return { created: true, jobId: String(job._id) };
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      logLine('log', 'duplicate_skipped', {
        bookingId: String(booking._id),
        ruleKey: rule.ruleKey,
        scheduledFor: scheduledForUtc.toISOString()
      });
      return { created: false, duplicate: true };
    }
    throw err;
  }
}

async function scheduleAllApplicableRules({ booking, propertyKind, now = new Date() }) {
  const rules = await loadEnabledRules();
  const summary = { evaluated: rules.length, created: 0, duplicates: 0, skipped: {} };

  for (const rule of rules) {
    const applies = ruleApplicableTo(rule, booking, propertyKind);
    if (!applies.ok) {
      summary.skipped[applies.reason] = (summary.skipped[applies.reason] || 0) + 1;
      logLine('log', `${applies.reason}_skipped`, {
        bookingId: String(booking._id),
        ruleKey: rule.ruleKey
      });
      continue;
    }
    const sched = computeScheduledForForRule(rule, booking);
    if (!sched) {
      summary.skipped.unschedulable = (summary.skipped.unschedulable || 0) + 1;
      continue;
    }
    if (sched.scheduledForUtc.getTime() <= now.getTime()) {
      summary.skipped.past = (summary.skipped.past || 0) + 1;
      logLine('log', 'past_skipped', {
        bookingId: String(booking._id),
        ruleKey: rule.ruleKey,
        scheduledFor: sched.scheduledForUtc.toISOString()
      });
      continue;
    }
    const r = await createJobIdempotent({
      booking,
      rule,
      scheduledForUtc: sched.scheduledForUtc,
      scheduledForSofiaIso: sched.scheduledForSofiaIso,
      propertyKind
    });
    if (r.created) summary.created += 1;
    else if (r.duplicate) summary.duplicates += 1;
  }
  return summary;
}

async function cancelFutureJobsForBooking({ bookingId, reason, actor = 'orchestrator', now = new Date() }) {
  const res = await ScheduledMessageJob.updateMany(
    {
      bookingId,
      status: { $in: CANCELABLE_STATUSES },
      scheduledFor: { $gt: now }
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

async function loadBooking(bookingId) {
  if (bookingId == null) return null;
  if (typeof bookingId === 'string' && !mongoose.isValidObjectId(bookingId)) return null;
  return Booking.findById(bookingId);
}

/**
 * Common wrapper: enforces flag, catches top-level errors, opens a
 * single ManualReviewItem (`comms_orchestrator_hook_failed`) on real
 * failure, and never rethrows.
 */
async function runHook(name, fn, { bookingId, extra = {} } = {}) {
  if (!isOrchestratorEnabled()) {
    logLine('log', 'disabled', { hook: name, bookingId: bookingId ? String(bookingId) : null });
    return { ran: false, disabled: true };
  }
  try {
    const result = await fn();
    return { ran: true, result };
  } catch (err) {
    const message = err?.message || String(err);
    logLine('error', 'hook_error', {
      hook: name,
      bookingId: bookingId ? String(bookingId) : null,
      error: message,
      ...extra
    });
    await safeOpenManualReviewItem({
      category: HOOK_FAILED_CATEGORY,
      severity: 'medium',
      entityType: 'Booking',
      entityId: bookingId ? String(bookingId) : null,
      title: `MessageOrchestrator hook failed: ${name}`,
      details: message,
      provenance: { source: 'message-orchestrator', sourceReference: name },
      evidence: { hook: name, ...extra }
    });
    return { ran: true, error: true };
  }
}

async function schedulePassForBooking(booking) {
  let propertyKind;
  try {
    propertyKind = await resolveBookingPropertyKind(booking);
  } catch (err) {
    if (err instanceof PropertyKindUnresolvedError) {
      logLine('warn', 'property_kind_unresolved', {
        bookingId: String(booking._id),
        reason: err?.details?.reason || 'unknown'
      });
      await safeOpenManualReviewItem({
        category: PROPERTY_KIND_MISSING_CATEGORY,
        severity: 'high',
        entityType: 'Booking',
        entityId: String(booking._id),
        title: 'Booking propertyKind could not be resolved for messaging',
        details: err.message,
        provenance: { source: 'message-orchestrator', sourceReference: 'schedule_pass' },
        evidence: { reason: err?.details?.reason || null, bookingId: String(booking._id) }
      });
      return { propertyKindMissing: true };
    }
    throw err;
  }
  const summary = await scheduleAllApplicableRules({ booking, propertyKind });
  return { propertyKind, summary };
}

// ---------------------------------------------------------------------------
// Public hook entrypoints (called by the six surfaces).
// ---------------------------------------------------------------------------

async function notifyBookingCreated({ bookingId }) {
  return runHook('notifyBookingCreated', async () => {
    const booking = await loadBooking(bookingId);
    if (!booking) return { skipped: 'booking_missing' };
    return schedulePassForBooking(booking);
  }, { bookingId });
}

async function notifyManualReservationCreated({ bookingId }) {
  return runHook('notifyManualReservationCreated', async () => {
    const booking = await loadBooking(bookingId);
    if (!booking) return { skipped: 'booking_missing' };
    return schedulePassForBooking(booking);
  }, { bookingId });
}

async function notifyBookingStatusChange({ bookingId, previousStatus, nextStatus, transitionKind }) {
  return runHook('notifyBookingStatusChange', async () => {
    const booking = await loadBooking(bookingId);
    if (!booking) return { skipped: 'booking_missing' };

    if (nextStatus === 'cancelled' && previousStatus !== 'cancelled') {
      const cancelRes = await cancelFutureJobsForBooking({
        bookingId: booking._id,
        reason: 'booking_cancelled'
      });
      logLine('log', 'cancelled', {
        bookingId: String(booking._id),
        cancelled: cancelRes.cancelled,
        transitionKind: transitionKind || null
      });
      return { cancelled: cancelRes.cancelled };
    }

    // Confirm (or any transition that lands on a status guest/OPS rules
    // accept) -> rerun schedule pass. Idempotent against the unique key.
    return schedulePassForBooking(booking);
  }, { bookingId, extra: { previousStatus, nextStatus, transitionKind } });
}

async function notifyReservationDatesChanged({ bookingId, previousCheckIn, previousCheckOut }) {
  return runHook('notifyReservationDatesChanged', async () => {
    const booking = await loadBooking(bookingId);
    if (!booking) return { skipped: 'booking_missing' };

    const prevCheckInMs = previousCheckIn ? new Date(previousCheckIn).getTime() : null;
    const prevCheckOutMs = previousCheckOut ? new Date(previousCheckOut).getTime() : null;
    const nextCheckInMs = booking.checkIn ? new Date(booking.checkIn).getTime() : null;
    const nextCheckOutMs = booking.checkOut ? new Date(booking.checkOut).getTime() : null;
    const checkInUnchanged = prevCheckInMs != null && prevCheckInMs === nextCheckInMs;
    const checkOutUnchanged = prevCheckOutMs != null && prevCheckOutMs === nextCheckOutMs;
    if (checkInUnchanged && checkOutUnchanged) {
      logLine('log', 'dates_unchanged_skipped', { bookingId: String(booking._id) });
      return { skipped: 'dates_unchanged' };
    }

    const cancelRes = await cancelFutureJobsForBooking({
      bookingId: booking._id,
      reason: 'rescheduled_due_to_date_edit'
    });
    const reschedule = await schedulePassForBooking(booking);
    logLine('log', 'rescheduled', {
      bookingId: String(booking._id),
      cancelled: cancelRes.cancelled,
      created: reschedule?.summary?.created || 0
    });
    return { cancelled: cancelRes.cancelled, reschedule };
  }, { bookingId, extra: { previousCheckIn, previousCheckOut } });
}

async function notifyReservationReassigned({ bookingId, previousCabinId }) {
  return runHook('notifyReservationReassigned', async () => {
    const booking = await loadBooking(bookingId);
    if (!booking) return { skipped: 'booking_missing' };

    // Simpler accepted approach (per Batch 7 review): cancel all future
    // scheduled/claimed jobs for this booking and rerun the schedule
    // pass against the new stay target.
    const cancelRes = await cancelFutureJobsForBooking({
      bookingId: booking._id,
      reason: 'rescheduled_due_to_reassignment'
    });
    const reschedule = await schedulePassForBooking(booking);
    logLine('log', 'reassigned', {
      bookingId: String(booking._id),
      cancelled: cancelRes.cancelled,
      created: reschedule?.summary?.created || 0,
      previousCabinId: previousCabinId ? String(previousCabinId) : null
    });
    return { cancelled: cancelRes.cancelled, reschedule };
  }, { bookingId, extra: { previousCabinId: previousCabinId ? String(previousCabinId) : null } });
}

module.exports = {
  // Public hooks.
  notifyBookingCreated,
  notifyManualReservationCreated,
  notifyBookingStatusChange,
  notifyReservationDatesChanged,
  notifyReservationReassigned,
  // Diagnostics / wiring helpers.
  isOrchestratorEnabled,
  ENV_FLAG,
  HOOK_FAILED_CATEGORY,
  PROPERTY_KIND_MISSING_CATEGORY,
  // Exported for tests only. Treat as internal.
  __internals: {
    passesPaymentProofGuard,
    passesStatusGuard,
    passesScopeGuard,
    ruleApplicableTo,
    computeScheduledForForRule,
    cancelFutureJobsForBooking,
    scheduleAllApplicableRules,
    schedulePassForBooking,
    loadEnabledRules,
    resolveBookingPropertyKind
  }
};
