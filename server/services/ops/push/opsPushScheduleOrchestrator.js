'use strict';

const { computeScheduledSofiaInstant } = require('../../messaging/messageOrchestratorTime');
const {
  loadOpsPushBookingContext,
  buildPayloadSnapshot,
  SCHEDULABLE_STATUSES
} = require('./opsPushBookingContext');
const {
  createScheduledJobIdempotent,
  cancelFutureJobsForBooking
} = require('./opsPushScheduledJobService');

const ENV_FLAG = 'OPS_PUSH_SCHEDULED_ENABLED';

const ARRIVAL_JOB_TYPE = 'arrival_reminder_admin';
const CLEANING_JOB_TYPE = 'cleaning_checkout_day';

function isOpsPushScheduledEnabled() {
  return String(process.env[ENV_FLAG] || '').trim() === '1';
}

function logLine(phase, fields) {
  console.log(JSON.stringify({ source: 'ops-push-scheduler', phase, ...fields }));
}

function buildArrivalDedupeKey(bookingId, checkInSofiaDate) {
  return `ops_push_arrival_admin:${String(bookingId)}:${checkInSofiaDate}`;
}

function buildCleaningDedupeKey(bookingId, checkOutSofiaDate) {
  return `ops_push_cleaning_checkout:${String(bookingId)}:${checkOutSofiaDate}`;
}

function computeArrivalSchedule(booking) {
  return computeScheduledSofiaInstant({
    anchorDate: booking.checkIn,
    offsetHours: -24,
    sofiaHour: 9,
    sofiaMinute: 0
  });
}

function computeCleaningSchedule(booking) {
  return computeScheduledSofiaInstant({
    anchorDate: booking.checkOut,
    offsetHours: 0,
    sofiaHour: 8,
    sofiaMinute: 0
  });
}

async function scheduleOpsPushForBooking({ bookingId, now = new Date() }) {
  if (!isOpsPushScheduledEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  if (!bookingId) {
    return { skipped: true, reason: 'missing_booking_id' };
  }

  const ctx = await loadOpsPushBookingContext(bookingId);
  if (!ctx) {
    return { skipped: true, reason: 'booking_missing' };
  }
  if (!ctx.isSchedulable) {
    return { skipped: true, reason: 'status_not_schedulable', status: ctx.status };
  }

  const summary = {
    created: 0,
    duplicates: 0,
    skipped: {}
  };
  const payloadSnapshot = buildPayloadSnapshot(ctx);

  const arrivalSched = computeArrivalSchedule(ctx.booking);
  if (!arrivalSched) {
    summary.skipped.arrival_unschedulable = 1;
  } else if (arrivalSched.scheduledForUtc.getTime() <= now.getTime()) {
    summary.skipped.arrival_past = 1;
  } else {
    const arrivalResult = await createScheduledJobIdempotent({
      jobType: ARRIVAL_JOB_TYPE,
      bookingId: ctx.booking._id,
      propertyKind: ctx.propertyKind,
      scheduledForUtc: arrivalSched.scheduledForUtc,
      scheduledForSofiaIso: arrivalSched.scheduledForSofiaIso,
      dedupeKey: buildArrivalDedupeKey(ctx.bookingId, ctx.checkInSofiaDate),
      payloadSnapshot
    });
    if (arrivalResult.created) summary.created += 1;
    else if (arrivalResult.duplicate) summary.duplicates += 1;
  }

  if (!ctx.propertyKind) {
    summary.skipped.cleaning_no_property_kind = 1;
  } else {
    const cleaningSched = computeCleaningSchedule(ctx.booking);
    if (!cleaningSched) {
      summary.skipped.cleaning_unschedulable = 1;
    } else if (cleaningSched.scheduledForUtc.getTime() <= now.getTime()) {
      summary.skipped.cleaning_past = 1;
    } else {
      const cleaningResult = await createScheduledJobIdempotent({
        jobType: CLEANING_JOB_TYPE,
        bookingId: ctx.booking._id,
        propertyKind: ctx.propertyKind,
        scheduledForUtc: cleaningSched.scheduledForUtc,
        scheduledForSofiaIso: cleaningSched.scheduledForSofiaIso,
        dedupeKey: buildCleaningDedupeKey(ctx.bookingId, ctx.checkOutSofiaDate),
        payloadSnapshot
      });
      if (cleaningResult.created) summary.created += 1;
      else if (cleaningResult.duplicate) summary.duplicates += 1;
    }
  }

  logLine('scheduled', { bookingId: String(bookingId), ...summary });
  return { ok: true, summary };
}

async function cancelFutureOpsPushJobsForBooking({ bookingId, reason, actor }) {
  if (!isOpsPushScheduledEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  const result = await cancelFutureJobsForBooking({ bookingId, reason, actor });
  logLine('cancelled', { bookingId: String(bookingId), cancelled: result.cancelled, reason });
  return result;
}

async function rescheduleOpsPushForBooking({ bookingId, reason, actor }) {
  if (!isOpsPushScheduledEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  const cancelRes = await cancelFutureJobsForBooking({
    bookingId,
    reason: reason || 'rescheduled',
    actor: actor || 'ops-push-scheduler'
  });
  const scheduleRes = await scheduleOpsPushForBooking({ bookingId });
  return { cancelled: cancelRes.cancelled, schedule: scheduleRes };
}

async function notifyOpsPushBookingStatusChange({ bookingId, previousStatus, nextStatus }) {
  if (!isOpsPushScheduledEnabled()) {
    return { skipped: true, reason: 'disabled' };
  }
  if (nextStatus === 'cancelled' && previousStatus !== 'cancelled') {
    return cancelFutureOpsPushJobsForBooking({
      bookingId,
      reason: 'booking_cancelled'
    });
  }
  if (nextStatus === 'completed' && previousStatus !== 'completed') {
    return cancelFutureOpsPushJobsForBooking({
      bookingId,
      reason: 'booking_completed'
    });
  }
  if (SCHEDULABLE_STATUSES.has(nextStatus)) {
    return scheduleOpsPushForBooking({ bookingId });
  }
  if (!SCHEDULABLE_STATUSES.has(nextStatus)) {
    return cancelFutureOpsPushJobsForBooking({
      bookingId,
      reason: 'status_not_schedulable'
    });
  }
  return { skipped: true };
}

async function notifyOpsPushReservationDatesChanged({ bookingId }) {
  return rescheduleOpsPushForBooking({
    bookingId,
    reason: 'rescheduled_due_to_date_edit'
  });
}

async function notifyOpsPushReservationReassigned({ bookingId }) {
  return rescheduleOpsPushForBooking({
    bookingId,
    reason: 'rescheduled_due_to_reassignment'
  });
}

module.exports = {
  ENV_FLAG,
  ARRIVAL_JOB_TYPE,
  CLEANING_JOB_TYPE,
  isOpsPushScheduledEnabled,
  scheduleOpsPushForBooking,
  cancelFutureOpsPushJobsForBooking,
  rescheduleOpsPushForBooking,
  notifyOpsPushBookingStatusChange,
  notifyOpsPushReservationDatesChanged,
  notifyOpsPushReservationReassigned,
  computeArrivalSchedule,
  computeCleaningSchedule,
  buildArrivalDedupeKey,
  buildCleaningDedupeKey
};
