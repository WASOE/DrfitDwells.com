'use strict';

const { listAssignedCleanersForPropertyKind } = require('../../messaging/cleanerRecipientResolver');
const { formatSofiaDateOnly } = require('../../../utils/dateTime');
const { sendOpsPushSafely } = require('./opsPushService');
const { loadOpsPushBookingContext, SCHEDULABLE_STATUSES } = require('./opsPushBookingContext');
const {
  markJobSent,
  markJobSuppressed,
  markJobFailed,
  handleClaimedJobPushFailure
} = require('./opsPushScheduledJobService');
const {
  ARRIVAL_JOB_TYPE,
  CLEANING_JOB_TYPE
} = require('./opsPushScheduleOrchestrator');

let sendOpsPushSafelyImpl = sendOpsPushSafely;

function __setSendOpsPushSafelyForTesting(fn) {
  sendOpsPushSafelyImpl = typeof fn === 'function' ? fn : sendOpsPushSafely;
}

function __resetSendOpsPushSafelyForTesting() {
  sendOpsPushSafelyImpl = sendOpsPushSafely;
}

function safePush(params) {
  return sendOpsPushSafelyImpl(params);
}

function datesMatchSnapshot(booking, snapshot) {
  if (!snapshot) return true;
  const checkInDate = formatSofiaDateOnly(booking.checkIn);
  const checkOutDate = formatSofiaDateOnly(booking.checkOut);
  if (snapshot.checkInSofiaDate && snapshot.checkInSofiaDate !== checkInDate) {
    return false;
  }
  if (snapshot.checkOutSofiaDate && snapshot.checkOutSofiaDate !== checkOutDate) {
    return false;
  }
  return true;
}

async function executeArrivalReminderAdmin(job, ctx) {
  const pushResult = await safePush({
    role: 'admin',
    title: 'Arrival tomorrow',
    body: `${ctx.guestName} · ${ctx.propertyLabel} · check-in ${ctx.checkInSofia} · ${ctx.status}`,
    url: `/ops/reservations/${ctx.bookingId}`,
    tag: 'arrival-reminder',
    dedupeKey: job.dedupeKey,
    source: 'ops_push_arrival_admin'
  });
  return pushResult;
}

async function executeCleaningCheckoutDay(job, ctx) {
  if (!ctx.propertyKind) {
    return { suppressed: true, reason: 'property_kind_missing' };
  }

  const cleaners = await listAssignedCleanersForPropertyKind(ctx.propertyKind);
  if (!cleaners.length) {
    return { suppressed: true, reason: 'no_assigned_cleaners' };
  }

  const body = `${ctx.propertyLabel} · checkout ${ctx.checkOutSofia} · ${ctx.guestCount} guests`;
  if (body.includes('@') || /\+\d{8,}/.test(body)) {
    return { suppressed: true, reason: 'pii_guard' };
  }

  const pushResult = await safePush({
    role: 'cleaner',
    propertyKind: ctx.propertyKind,
    title: 'Checkout today',
    body,
    url: `/ops/reservations/${ctx.bookingId}`,
    tag: 'cleaning-checkout',
    dedupeKey: job.dedupeKey,
    source: 'ops_push_cleaning_checkout'
  });
  return pushResult;
}

async function executeOpsPushScheduledJob(job) {
  if (!job?._id) {
    return { ok: false, error: 'missing_job' };
  }

  const ctx = await loadOpsPushBookingContext(job.bookingId);
  if (!ctx) {
    await markJobSuppressed(job._id, 'booking_missing');
    return { ok: true, suppressed: true, reason: 'booking_missing' };
  }

  if (!SCHEDULABLE_STATUSES.has(ctx.status)) {
    await markJobSuppressed(job._id, 'status_not_schedulable');
    return { ok: true, suppressed: true, reason: 'status_not_schedulable' };
  }

  if (!datesMatchSnapshot(ctx.booking, job.payloadSnapshot)) {
    await markJobSuppressed(job._id, 'dates_changed');
    return { ok: true, suppressed: true, reason: 'dates_changed' };
  }

  try {
    let result;
    if (job.jobType === ARRIVAL_JOB_TYPE) {
      result = await executeArrivalReminderAdmin(job, ctx);
    } else if (job.jobType === CLEANING_JOB_TYPE) {
      result = await executeCleaningCheckoutDay(job, ctx);
      if (result?.suppressed) {
        await markJobSuppressed(job._id, result.reason);
        return { ok: true, suppressed: true, reason: result.reason };
      }
    } else {
      await markJobSuppressed(job._id, 'unknown_job_type');
      return { ok: true, suppressed: true, reason: 'unknown_job_type' };
    }

    if (result?.skipped === true && result?.reason === 'vapid_not_configured') {
      await markJobSent(job._id, {
        ...result,
        skipped: 'vapid_not_configured'
      });
      return { ok: true, sent: true, skipped: 'vapid_not_configured' };
    }

    if (result?.skipped === true && result?.reason === 'cleaner_property_kind_required') {
      await markJobSuppressed(job._id, 'cleaner_property_kind_required');
      return { ok: true, suppressed: true, reason: 'cleaner_property_kind_required' };
    }

    if (result?.error === true) {
      const retryOutcome = await handleClaimedJobPushFailure({
        jobId: job._id,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        errorMessage: result.message || 'push_send_failed'
      });
      return {
        ok: false,
        error: result.message || 'push_send_failed',
        terminal: retryOutcome.terminal,
        rescheduled: !retryOutcome.terminal
      };
    }

    await markJobSent(job._id, result || { sent: true });
    return { ok: true, sent: true, result };
  } catch (err) {
    await markJobFailed(job._id, err?.message || String(err));
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = {
  executeOpsPushScheduledJob,
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting,
  datesMatchSnapshot
};
