'use strict';

/**
 * CheckoutFinalizationJob enqueue + inspection (Batch 3).
 * No claim / execute / worker — FINALIZE_JOB_EXECUTE stays off.
 */

const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const {
  ACTIVE_EXECUTABLE_STATUSES
} = require('../../models/CheckoutFinalizationJob');

const PRESERVED_EXISTING_STATUSES = Object.freeze([
  'scheduled',
  'claimed',
  'failed_retryable',
  'succeeded',
  'failed_permanent'
]);

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 11000 || /E11000/.test(String(err.message || ''))));
}

function toJobDto(job) {
  if (!job) return null;
  const doc = job.toObject ? job.toObject() : job;
  return {
    jobId: String(doc._id),
    checkoutId: doc.checkoutId,
    paymentIntentId: doc.paymentIntentId,
    stripeEventId: doc.stripeEventId || null,
    quoteSnapshotHash: doc.quoteSnapshotHash || null,
    finalizeIntentHash: doc.finalizeIntentHash || null,
    status: doc.status,
    stage: doc.stage,
    attemptCount: doc.attemptCount,
    maxAttempts: doc.maxAttempts,
    createdReason: doc.createdReason,
    nextAttemptAt: doc.nextAttemptAt,
    lastErrorCode: doc.lastErrorCode || null,
    lastErrorSummary: doc.lastErrorSummary || null,
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}

async function findPreservedJobForCheckout(checkoutId) {
  const id = String(checkoutId || '').trim();
  if (!id) return null;

  const active = await CheckoutFinalizationJob.findOne({
    checkoutId: id,
    status: { $in: [...ACTIVE_EXECUTABLE_STATUSES] }
  })
    .sort({ createdAt: -1 })
    .lean();
  if (active) return active;

  // Prefer recoverable failed_retryable over terminal outcomes.
  const retryable = await CheckoutFinalizationJob.findOne({
    checkoutId: id,
    status: 'failed_retryable'
  })
    .sort({ createdAt: -1 })
    .lean();
  if (retryable) return retryable;

  return CheckoutFinalizationJob.findOne({
    checkoutId: id,
    status: { $in: ['succeeded', 'failed_permanent'] }
  })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * Recover failed_retryable → scheduled when attempts remain.
 * Exhausted attempts → failed_permanent (binding FINALIZE_RETRY_EXHAUSTED).
 * Preserves attemptCount, lastError*, safeDetails, firstFailedAt / lastFailedAt.
 */
async function recoverFailedRetryableJob(existing, { now, checkoutKey }) {
  const maxAttempts = Number(existing.maxAttempts) > 0 ? Number(existing.maxAttempts) : 20;
  const attemptCount = Number(existing.attemptCount) || 0;

  if (attemptCount >= maxAttempts) {
    const promoted = await CheckoutFinalizationJob.findOneAndUpdate(
      {
        _id: existing._id,
        status: 'failed_retryable',
        attemptCount: { $gte: maxAttempts }
      },
      {
        $set: {
          status: 'failed_permanent',
          claimedBy: null,
          claimedAt: null,
          visibilityTimeoutAt: null,
          lastErrorCode: existing.lastErrorCode || 'FINALIZE_RETRY_EXHAUSTED',
          lastErrorSummary:
            existing.lastErrorSummary ||
            'Retry attempts exhausted; marked failed_permanent',
          lastFailedAt: existing.lastFailedAt || now
        }
      },
      { new: true }
    );

    if (promoted) {
      return {
        created: false,
        existing: true,
        jobId: String(promoted._id),
        checkoutId: checkoutKey,
        status: 'failed_permanent',
        preserved: true,
        promotedToPermanent: true
      };
    }

    const reloaded = await findPreservedJobForCheckout(checkoutKey);
    return {
      created: false,
      existing: true,
      jobId: reloaded ? String(reloaded._id) : String(existing._id),
      checkoutId: checkoutKey,
      status: reloaded?.status || existing.status,
      preserved: true
    };
  }

  const rescheduled = await CheckoutFinalizationJob.findOneAndUpdate(
    {
      _id: existing._id,
      status: 'failed_retryable',
      attemptCount: { $lt: maxAttempts }
    },
    {
      $set: {
        status: 'scheduled',
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        nextAttemptAt: now
        // Preserve: attemptCount, lastErrorCode, lastErrorSummary, safeDetails,
        // firstFailedAt, lastFailedAt, stage, bookingId, hashes, etc.
      }
    },
    { new: true }
  );

  if (rescheduled) {
    return {
      created: false,
      existing: true,
      jobId: String(rescheduled._id),
      checkoutId: checkoutKey,
      status: 'scheduled',
      preserved: false,
      rescheduled: true
    };
  }

  // Lost race (another ensure/worker moved the row) — return current preserved job.
  const reloaded = await findPreservedJobForCheckout(checkoutKey);
  return {
    created: false,
    existing: true,
    jobId: reloaded ? String(reloaded._id) : String(existing._id),
    checkoutId: checkoutKey,
    status: reloaded?.status || existing.status,
    preserved: reloaded ? !ACTIVE_EXECUTABLE_STATUSES.includes(reloaded.status) : true
  };
}

/**
 * Idempotent ensure: one active scheduled job per checkout, or return existing preserved job.
 *
 * failed_retryable with remaining attempts is atomically rescheduled (not left inert).
 * cancelled is never silently revived — a new scheduled job may be created instead.
 *
 * @returns {{
 *   created: boolean,
 *   existing: boolean,
 *   jobId: string|null,
 *   checkoutId: string,
 *   status: string|null,
 *   preserved?: boolean,
 *   rescheduled?: boolean,
 *   promotedToPermanent?: boolean,
 *   duplicateKey?: boolean
 * }}
 */
async function ensureCheckoutFinalizationJob({
  checkoutId,
  paymentIntentId,
  stripeEventId = null,
  quoteSnapshotHash = null,
  finalizeIntentHash = null,
  createdReason = 'webhook',
  now = new Date()
}) {
  const checkoutKey = String(checkoutId || '').trim();
  const piId = String(paymentIntentId || '').trim();
  if (!checkoutKey || !piId) {
    throw new Error('checkoutId and paymentIntentId are required to enqueue CheckoutFinalizationJob');
  }

  const existing = await findPreservedJobForCheckout(checkoutKey);
  if (existing) {
    if (existing.status === 'scheduled' || existing.status === 'claimed') {
      return {
        created: false,
        existing: true,
        jobId: String(existing._id),
        checkoutId: checkoutKey,
        status: existing.status,
        preserved: false
      };
    }

    if (existing.status === 'succeeded') {
      return {
        created: false,
        existing: true,
        jobId: String(existing._id),
        checkoutId: checkoutKey,
        status: 'succeeded',
        preserved: true
      };
    }

    if (existing.status === 'failed_permanent') {
      return {
        created: false,
        existing: true,
        jobId: String(existing._id),
        checkoutId: checkoutKey,
        status: 'failed_permanent',
        preserved: true
      };
    }

    if (existing.status === 'failed_retryable') {
      return recoverFailedRetryableJob(existing, { now, checkoutKey });
    }
  }

  // cancelled (or no job): do not revive cancelled; create a new scheduled job.
  try {
    const job = await CheckoutFinalizationJob.create({
      checkoutId: checkoutKey,
      paymentIntentId: piId,
      stripeEventId: stripeEventId ? String(stripeEventId).trim() : null,
      quoteSnapshotHash: quoteSnapshotHash ? String(quoteSnapshotHash).trim() : null,
      finalizeIntentHash: finalizeIntentHash ? String(finalizeIntentHash).trim() : null,
      status: 'scheduled',
      stage: 'queued',
      attemptCount: 0,
      maxAttempts: 20,
      nextAttemptAt: now,
      createdReason: createdReason || 'webhook'
    });
    return {
      created: true,
      existing: false,
      jobId: String(job._id),
      checkoutId: checkoutKey,
      status: job.status
    };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const raced = await findPreservedJobForCheckout(checkoutKey);
      if (raced?.status === 'failed_retryable') {
        return recoverFailedRetryableJob(raced, { now, checkoutKey });
      }
      return {
        created: false,
        existing: true,
        jobId: raced ? String(raced._id) : null,
        checkoutId: checkoutKey,
        status: raced?.status || null,
        duplicateKey: true,
        preserved: raced ? !ACTIVE_EXECUTABLE_STATUSES.includes(raced.status) : undefined
      };
    }
    throw err;
  }
}

async function getCheckoutFinalizationJobById(jobId) {
  if (!jobId) return null;
  const job = await CheckoutFinalizationJob.findById(jobId).lean();
  return toJobDto(job);
}

async function getCheckoutFinalizationJobByCheckoutId(checkoutId) {
  const job = await findPreservedJobForCheckout(checkoutId);
  return toJobDto(job);
}

async function listCheckoutFinalizationJobsByPaymentIntentId(paymentIntentId, { limit = 20 } = {}) {
  const piId = String(paymentIntentId || '').trim();
  if (!piId) return [];
  const rows = await CheckoutFinalizationJob.find({ paymentIntentId: piId })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
    .lean();
  return rows.map(toJobDto);
}

module.exports = {
  PRESERVED_EXISTING_STATUSES,
  ACTIVE_EXECUTABLE_STATUSES,
  ensureCheckoutFinalizationJob,
  findPreservedJobForCheckout,
  recoverFailedRetryableJob,
  getCheckoutFinalizationJobById,
  getCheckoutFinalizationJobByCheckoutId,
  listCheckoutFinalizationJobsByPaymentIntentId,
  toJobDto
};
