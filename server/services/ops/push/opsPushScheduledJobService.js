'use strict';

const OpsPushScheduledJob = require('../../../models/OpsPushScheduledJob');

const CANCELABLE_STATUSES = Object.freeze(['scheduled', 'claimed']);
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

function computeBackoffMs(nextAttempt) {
  const expIdx = Math.max(0, nextAttempt - 1);
  const exp = BACKOFF_BASE_MS * Math.pow(2, expIdx);
  return Math.min(BACKOFF_CAP_MS, exp);
}

async function createScheduledJobIdempotent({
  jobType,
  bookingId,
  propertyKind,
  scheduledForUtc,
  scheduledForSofiaIso,
  dedupeKey,
  payloadSnapshot
}) {
  try {
    const job = await OpsPushScheduledJob.create({
      jobType,
      bookingId,
      propertyKind: propertyKind || null,
      scheduledFor: scheduledForUtc,
      scheduledForSofia: scheduledForSofiaIso,
      status: 'scheduled',
      dedupeKey,
      payloadSnapshot: payloadSnapshot || {}
    });
    return { created: true, jobId: String(job._id) };
  } catch (err) {
    if (err && (err.code === 11000 || /E11000/.test(String(err.message)))) {
      return { created: false, duplicate: true };
    }
    throw err;
  }
}

async function cancelFutureJobsForBooking({
  bookingId,
  reason,
  actor = 'ops-push-scheduler',
  now = new Date()
}) {
  const res = await OpsPushScheduledJob.updateMany(
    {
      bookingId,
      status: { $in: CANCELABLE_STATUSES },
      scheduledFor: { $gt: now }
    },
    {
      $set: {
        status: 'cancelled',
        cancelReason: reason || 'cancelled',
        cancelActor: actor,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
  return { cancelled: res.modifiedCount || 0 };
}

async function claimDueJob({ jobId, workerId, now = new Date(), visibilityTimeoutMs }) {
  const visibilityTimeoutAt = new Date(now.getTime() + visibilityTimeoutMs);
  return OpsPushScheduledJob.findOneAndUpdate(
    { _id: jobId, status: 'scheduled' },
    {
      $set: {
        status: 'claimed',
        claimedBy: workerId,
        claimedAt: now,
        visibilityTimeoutAt
      }
    },
    { new: true }
  );
}

async function markJobSent(jobId, lastResult) {
  await OpsPushScheduledJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        status: 'sent',
        lastResult: lastResult || null,
        lastError: null,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
}

async function markJobSuppressed(jobId, reason, lastResult = null) {
  await OpsPushScheduledJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        status: 'suppressed',
        lastError: reason || 'suppressed',
        lastResult: lastResult || { suppressed: true, reason: reason || 'suppressed' },
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
}

async function markJobFailed(jobId, errorMessage) {
  await OpsPushScheduledJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        status: 'failed',
        lastError: errorMessage || 'failed',
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
}

async function rescheduleStaleClaimedJob({
  jobId,
  nextAttempt,
  nextScheduledFor,
  lastError = 'visibility_timeout_reclaim',
  now = new Date()
}) {
  void now;
  const res = await OpsPushScheduledJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        status: 'scheduled',
        attemptCount: nextAttempt,
        scheduledFor: nextScheduledFor,
        lastError,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
  return res.modifiedCount === 1;
}

async function failStaleClaimedJob({ jobId, nextAttempt, lastError = 'visibility_timeout_terminal' }) {
  const res = await OpsPushScheduledJob.updateOne(
    { _id: jobId, status: 'claimed' },
    {
      $set: {
        status: 'failed',
        attemptCount: nextAttempt,
        lastError,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    }
  );
  return res.modifiedCount === 1;
}

async function handleClaimedJobPushFailure({
  jobId,
  attemptCount,
  maxAttempts,
  errorMessage,
  now = new Date()
}) {
  const currentAttempt = Number.isFinite(attemptCount) ? attemptCount : 0;
  const cap = Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3;
  const nextAttempt = currentAttempt + 1;
  const lastError = errorMessage || 'push_send_failed';

  if (nextAttempt >= cap) {
    const ok = await failStaleClaimedJob({
      jobId,
      nextAttempt,
      lastError
    });
    return { terminal: true, modified: ok, nextAttempt };
  }

  const nextScheduledFor = new Date(now.getTime() + computeBackoffMs(nextAttempt));
  const ok = await rescheduleStaleClaimedJob({
    jobId,
    nextAttempt,
    nextScheduledFor,
    lastError,
    now
  });
  return { terminal: false, modified: ok, nextAttempt, nextScheduledFor };
}

module.exports = {
  CANCELABLE_STATUSES,
  createScheduledJobIdempotent,
  cancelFutureJobsForBooking,
  claimDueJob,
  markJobSent,
  markJobSuppressed,
  markJobFailed,
  rescheduleStaleClaimedJob,
  failStaleClaimedJob,
  handleClaimedJobPushFailure,
  computeBackoffMs
};
