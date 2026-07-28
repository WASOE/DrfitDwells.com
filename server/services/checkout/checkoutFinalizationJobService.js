'use strict';

/**
 * CheckoutFinalizationJob enqueue, claim, reclaim, complete (Batch 3–5).
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md §C
 *
 * Batch 5: claim/reclaim/complete. Execution lives in checkoutFinalizationWorker
 * and always calls finalizePaidCheckout — never inserts Booking directly.
 */

const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const {
  ACTIVE_EXECUTABLE_STATUSES,
  CHECKOUT_FINALIZATION_JOB_STAGES
} = require('../../models/CheckoutFinalizationJob');
const { CHECKOUT_SESSION_ERROR_CODES } = require('./checkoutSessionErrors');

const PRESERVED_EXISTING_STATUSES = Object.freeze([
  'scheduled',
  'claimed',
  'failed_retryable',
  'succeeded',
  'failed_permanent'
]);

/** Spec §C.6: base 30s, ×2, cap 15m, jitter ±20%. */
const BACKOFF_BASE_MS = 30 * 1000;
const BACKOFF_CAP_MS = 15 * 60 * 1000;
const DEFAULT_JOB_VISIBILITY_TIMEOUT_MS = 5 * 60 * 1000;

const DOMAIN_VERIFICATION_CODES = Object.freeze({
  PAYMENT_NOT_SUCCEEDED: 'PAYMENT_NOT_SUCCEEDED',
  SUPERSEDED_PAYMENT_INTENT: 'SUPERSEDED_PAYMENT_INTENT',
  NONCANONICAL_PAYMENT_INTENT: 'NONCANONICAL_PAYMENT_INTENT',
  QUOTE_SNAPSHOT_HASH_MISMATCH: 'QUOTE_SNAPSHOT_HASH_MISMATCH',
  FINALIZE_INTENT_HASH_MISMATCH: 'FINALIZE_INTENT_HASH_MISMATCH',
  FINALIZE_INTENT_MISSING: 'FINALIZE_INTENT_MISSING',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  DATE_MISMATCH: 'DATE_MISMATCH',
  ENTITY_MISMATCH: 'ENTITY_MISMATCH',
  STRIPE_RETRIEVE_FAILED: 'STRIPE_RETRIEVE_FAILED',
  CONFIRM_BODY_MISMATCH: 'CONFIRM_BODY_MISMATCH',
  ADOPT_FINGERPRINT_MISMATCH: 'ADOPT_FINGERPRINT_MISMATCH',
  ADOPT_PAYMENT_INTENT_MISMATCH: 'ADOPT_PAYMENT_INTENT_MISMATCH'
});

const PERMANENT_ERROR_CODES = Object.freeze(
  new Set([
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND,
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_SUPERSEDED,
    CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT,
    CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_MISSING,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_INVALID,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_HASH_MISMATCH,
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_INTENT_REQUIRED,
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT,
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH,
    DOMAIN_VERIFICATION_CODES.PAYMENT_NOT_SUCCEEDED,
    DOMAIN_VERIFICATION_CODES.SUPERSEDED_PAYMENT_INTENT,
    DOMAIN_VERIFICATION_CODES.NONCANONICAL_PAYMENT_INTENT,
    DOMAIN_VERIFICATION_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH,
    DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_HASH_MISMATCH,
    DOMAIN_VERIFICATION_CODES.FINALIZE_INTENT_MISSING,
    DOMAIN_VERIFICATION_CODES.AMOUNT_MISMATCH,
    DOMAIN_VERIFICATION_CODES.CURRENCY_MISMATCH,
    DOMAIN_VERIFICATION_CODES.DATE_MISMATCH,
    DOMAIN_VERIFICATION_CODES.ENTITY_MISMATCH,
    DOMAIN_VERIFICATION_CODES.CONFIRM_BODY_MISMATCH,
    DOMAIN_VERIFICATION_CODES.ADOPT_FINGERPRINT_MISMATCH,
    DOMAIN_VERIFICATION_CODES.ADOPT_PAYMENT_INTENT_MISMATCH,
    'PAID_BOOKING_SAVE_FAILED',
    'CABIN_OVERLAP_AFTER_SAVE',
    'UNIT_OVERLAP_AFTER_SAVE',
    'NO_UNITS_AVAILABLE',
    'NOT_AVAILABLE',
    'GIFT_VOUCHER_EXCLUDED',
    'FINALIZE_RETRY_EXHAUSTED',
    'LEGAL_ACCEPTANCE_INVALID',
    'GUEST_DATA_INVALID'
  ])
);

const RETRYABLE_ERROR_CODES = Object.freeze(
  new Set([
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS,
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT,
    DOMAIN_VERIFICATION_CODES.STRIPE_RETRIEVE_FAILED,
    'MONGO_TRANSIENT',
    'STRIPE_RETRIEVE_TIMEOUT',
    'STRIPE_METADATA_PATCH_FAILED',
    'JOB_CLAIM_CONFLICT',
    'JOB_VISIBILITY_TIMEOUT'
  ])
);

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 11000 || /E11000/.test(String(err.message || ''))));
}

function truncateSummary(value, max = 500) {
  const s = value == null ? '' : String(value);
  if (s.length <= max) return s;
  return s.slice(0, max);
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
    claimedBy: doc.claimedBy || null,
    claimedAt: doc.claimedAt || null,
    visibilityTimeoutAt: doc.visibilityTimeoutAt || null,
    paymentLinkedAt: doc.paymentLinkedAt || null,
    sessionFinalizedAt: doc.sessionFinalizedAt || null,
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null
  };
}

function getFinalizeJobVisibilityTimeoutMs() {
  const raw = process.env.FINALIZE_JOB_VISIBILITY_TIMEOUT_MS;
  if (raw == null || raw === '') return DEFAULT_JOB_VISIBILITY_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1000) return DEFAULT_JOB_VISIBILITY_TIMEOUT_MS;
  return Math.floor(n);
}

/**
 * Spec §C.6 backoff with ±20% jitter.
 * @param {number} attemptCount - post-increment attempt count on the job
 */
function computeFinalizeJobBackoffMs(attemptCount, { random = Math.random } = {}) {
  const n = Math.max(1, Number(attemptCount) || 1);
  const exp = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, n - 1));
  const capped = Math.min(BACKOFF_CAP_MS, exp);
  const jitterFactor = 0.8 + random() * 0.4;
  return Math.max(BACKOFF_BASE_MS, Math.floor(capped * jitterFactor));
}

function extractErrorCode(err) {
  if (!err || typeof err !== 'object') return 'UNKNOWN_FINALIZE_ERROR';
  if (err.verificationErrorCode) return String(err.verificationErrorCode);
  if (err.details?.verificationErrorCode) {
    return String(err.details.verificationErrorCode);
  }
  if (err.errorCode) return String(err.errorCode);
  if (err.code) return String(err.code);
  return 'UNKNOWN_FINALIZE_ERROR';
}

function extractErrorStage(err, fallback = 'save_booking') {
  if (err?.finalizationStage) return String(err.finalizationStage);
  if (err?.details?.finalizationStage) return String(err.details.finalizationStage);
  const code = extractErrorCode(err);
  if (code === 'FINALIZE_IN_PROGRESS') return 'acquire_lock';
  if (
    code.includes('PAYMENT') ||
    code.includes('STRIPE') ||
    code.includes('AMOUNT') ||
    code.includes('CURRENCY') ||
    code.includes('QUOTE') ||
    code.includes('INTENT') ||
    code.includes('SUPERSEDED') ||
    code.includes('NONCANONICAL')
  ) {
    return 'verify_payment';
  }
  if (code === 'DUPLICATE_STAY_CONFLICT') return 'acquire_lock';
  return fallback;
}

function buildSafeErrorDetails(err) {
  if (!err || typeof err !== 'object') return null;
  const details =
    err.details && typeof err.details === 'object' && !Array.isArray(err.details)
      ? err.details
      : null;
  return {
    code: err.code || null,
    verificationErrorCode: err.verificationErrorCode || details?.verificationErrorCode || null,
    errorCode: err.errorCode || null,
    needsReview: err.needsReview === true,
    permanent: details?.permanent === true || err.permanent === true,
    mismatches: Array.isArray(details?.mismatches) ? details.mismatches.slice(0, 20) : undefined
  };
}

/**
 * Classify domain/worker errors into permanent vs retryable (spec §H).
 */
function classifyFinalizeJobError(err) {
  const errorCode = extractErrorCode(err);
  const stage = extractErrorStage(err);
  const summary = truncateSummary(err?.message || errorCode);
  const permanentFlag =
    err?.details?.permanent === true ||
    err?.permanent === true ||
    err?.needsReview === true;

  if (errorCode === CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS) {
    return {
      permanent: false,
      errorCode,
      stage,
      summary,
      safeDetails: buildSafeErrorDetails(err)
    };
  }

  if (RETRYABLE_ERROR_CODES.has(errorCode)) {
    return {
      permanent: false,
      errorCode,
      stage,
      summary,
      safeDetails: buildSafeErrorDetails(err)
    };
  }

  if (PERMANENT_ERROR_CODES.has(errorCode) || permanentFlag) {
    return {
      permanent: true,
      errorCode,
      stage,
      summary,
      safeDetails: buildSafeErrorDetails(err)
    };
  }

  return {
    permanent: false,
    errorCode,
    stage,
    summary,
    safeDetails: buildSafeErrorDetails(err)
  };
}

function isValidStage(stage) {
  return CHECKOUT_FINALIZATION_JOB_STAGES.includes(stage);
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

async function findDueCheckoutFinalizationJobIds({
  now = new Date(),
  limit = 20
} = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 20));
  const rows = await CheckoutFinalizationJob.find({
    status: { $in: ['scheduled', 'failed_retryable'] },
    nextAttemptAt: { $lte: now }
  })
    .sort({ nextAttemptAt: 1, createdAt: 1 })
    .limit(cap)
    .select({ _id: 1 })
    .lean();
  return rows.map((r) => r._id);
}

async function claimDueCheckoutFinalizationJob({
  jobId,
  workerId,
  now = new Date(),
  visibilityTimeoutMs = getFinalizeJobVisibilityTimeoutMs()
} = {}) {
  if (!jobId) return null;
  const wid = String(workerId || '').trim();
  if (!wid) {
    throw new Error('workerId is required to claim CheckoutFinalizationJob');
  }
  const at = now instanceof Date ? now : new Date(now);
  const vtMs =
    Number.isFinite(visibilityTimeoutMs) && visibilityTimeoutMs > 0
      ? visibilityTimeoutMs
      : getFinalizeJobVisibilityTimeoutMs();

  return CheckoutFinalizationJob.findOneAndUpdate(
    {
      _id: jobId,
      status: { $in: ['scheduled', 'failed_retryable'] },
      nextAttemptAt: { $lte: at }
    },
    {
      $set: {
        status: 'claimed',
        claimedBy: wid,
        claimedAt: at,
        visibilityTimeoutAt: new Date(at.getTime() + vtMs)
      },
      $inc: { attemptCount: 1 }
    },
    { new: true }
  );
}

async function reclaimStaleClaimedCheckoutFinalizationJob({
  jobId = null,
  now = new Date()
} = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const filter = {
    status: 'claimed',
    visibilityTimeoutAt: { $lte: at }
  };
  if (jobId) {
    filter._id = jobId;
  }

  return CheckoutFinalizationJob.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'scheduled',
        nextAttemptAt: at,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        lastErrorCode: 'JOB_VISIBILITY_TIMEOUT',
        lastErrorSummary: truncateSummary('Claim visibility timeout; reclaimed')
      }
    },
    { new: true }
  );
}

async function reclaimStaleClaimedCheckoutFinalizationJobs({
  now = new Date(),
  limit = 50
} = {}) {
  const cap = Math.min(100, Math.max(1, Number(limit) || 50));
  const at = now instanceof Date ? now : new Date(now);
  const stale = await CheckoutFinalizationJob.find({
    status: 'claimed',
    visibilityTimeoutAt: { $lte: at }
  })
    .sort({ visibilityTimeoutAt: 1 })
    .limit(cap)
    .select({ _id: 1 })
    .lean();

  const reclaimed = [];
  for (const row of stale) {
    const updated = await reclaimStaleClaimedCheckoutFinalizationJob({
      jobId: row._id,
      now: at
    });
    if (updated) reclaimed.push(updated);
  }
  return reclaimed;
}

async function updateCheckoutFinalizationJobStage({ jobId, stage }) {
  if (!jobId || !isValidStage(stage)) return null;
  return CheckoutFinalizationJob.findOneAndUpdate(
    { _id: jobId, status: 'claimed' },
    { $set: { stage } },
    { new: true }
  );
}

async function markCheckoutFinalizationJobSucceeded({
  jobId,
  bookingId,
  now = new Date(),
  paymentLinkedAt = null,
  sessionFinalizedAt = null
} = {}) {
  if (!jobId || !bookingId) {
    throw new Error('jobId and bookingId are required to mark CheckoutFinalizationJob succeeded');
  }
  const at = now instanceof Date ? now : new Date(now);
  const set = {
    status: 'succeeded',
    stage: 'succeeded',
    bookingId,
    sessionFinalizedAt: sessionFinalizedAt || at,
    paymentLinkedAt: paymentLinkedAt || at,
    claimedBy: null,
    claimedAt: null,
    visibilityTimeoutAt: null,
    lastErrorCode: null,
    lastErrorSummary: null
  };

  return CheckoutFinalizationJob.findOneAndUpdate(
    { _id: jobId, status: 'claimed' },
    { $set: set },
    { new: true }
  );
}

async function markCheckoutFinalizationJobFailedPermanent({
  jobId,
  errorCode,
  errorSummary,
  stage = null,
  safeDetails = null,
  now = new Date(),
  bookingId = null
} = {}) {
  if (!jobId) return null;
  const at = now instanceof Date ? now : new Date(now);
  const current = await CheckoutFinalizationJob.findById(jobId);
  if (!current || current.status !== 'claimed') {
    return null;
  }

  const set = {
    status: 'failed_permanent',
    claimedBy: null,
    claimedAt: null,
    visibilityTimeoutAt: null,
    lastErrorCode: errorCode ? String(errorCode) : 'UNKNOWN_FINALIZE_ERROR',
    lastErrorSummary: truncateSummary(errorSummary || errorCode || 'permanent failure'),
    lastFailedAt: at,
    safeDetails: safeDetails || null
  };
  if (stage && isValidStage(stage)) {
    set.stage = stage;
  }
  if (bookingId) {
    set.bookingId = bookingId;
  } else if (current.bookingId) {
    set.bookingId = current.bookingId;
  }
  if (!current.firstFailedAt) {
    set.firstFailedAt = at;
  }

  return CheckoutFinalizationJob.findOneAndUpdate(
    { _id: jobId, status: 'claimed' },
    { $set: set },
    { new: true }
  );
}

async function markCheckoutFinalizationJobFailedRetryable({
  jobId,
  errorCode,
  errorSummary,
  stage = null,
  safeDetails = null,
  now = new Date(),
  attemptCount = null,
  maxAttempts = null,
  bookingId = null
} = {}) {
  if (!jobId) return null;
  const at = now instanceof Date ? now : new Date(now);
  const current = await CheckoutFinalizationJob.findById(jobId);
  if (!current || current.status !== 'claimed') {
    return null;
  }

  const attempts =
    attemptCount != null ? Number(attemptCount) : Number(current.attemptCount) || 0;
  const max =
    maxAttempts != null
      ? Number(maxAttempts)
      : Number(current.maxAttempts) > 0
        ? Number(current.maxAttempts)
        : 20;

  if (attempts >= max) {
    return markCheckoutFinalizationJobFailedPermanent({
      jobId,
      errorCode: errorCode || 'FINALIZE_RETRY_EXHAUSTED',
      errorSummary:
        errorSummary || 'Retry attempts exhausted; marked failed_permanent',
      stage,
      safeDetails,
      now: at,
      bookingId: bookingId || current.bookingId
    });
  }

  const backoffMs = computeFinalizeJobBackoffMs(attempts);
  const set = {
    status: 'failed_retryable',
    nextAttemptAt: new Date(at.getTime() + backoffMs),
    claimedBy: null,
    claimedAt: null,
    visibilityTimeoutAt: null,
    lastErrorCode: errorCode ? String(errorCode) : 'UNKNOWN_FINALIZE_ERROR',
    lastErrorSummary: truncateSummary(errorSummary || errorCode || 'retryable failure'),
    lastFailedAt: at,
    safeDetails: safeDetails || null
  };
  if (stage && isValidStage(stage)) {
    set.stage = stage;
  }
  if (bookingId) {
    set.bookingId = bookingId;
  }
  if (!current.firstFailedAt) {
    set.firstFailedAt = at;
  }

  return CheckoutFinalizationJob.findOneAndUpdate(
    { _id: jobId, status: 'claimed' },
    { $set: set },
    { new: true }
  );
}

async function markCheckoutFinalizationJobCancelled({
  jobId,
  errorCode = 'GIFT_VOUCHER_EXCLUDED',
  errorSummary = 'Gift voucher / non-accommodation job excluded from paid finalize worker',
  now = new Date()
} = {}) {
  if (!jobId) return null;
  const at = now instanceof Date ? now : new Date(now);
  return CheckoutFinalizationJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['claimed', 'scheduled'] } },
    {
      $set: {
        status: 'cancelled',
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null,
        lastErrorCode: String(errorCode),
        lastErrorSummary: truncateSummary(errorSummary),
        lastFailedAt: at
      }
    },
    { new: true }
  );
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
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  DEFAULT_JOB_VISIBILITY_TIMEOUT_MS,
  PERMANENT_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  ensureCheckoutFinalizationJob,
  findPreservedJobForCheckout,
  recoverFailedRetryableJob,
  findDueCheckoutFinalizationJobIds,
  claimDueCheckoutFinalizationJob,
  reclaimStaleClaimedCheckoutFinalizationJob,
  reclaimStaleClaimedCheckoutFinalizationJobs,
  updateCheckoutFinalizationJobStage,
  markCheckoutFinalizationJobSucceeded,
  markCheckoutFinalizationJobFailedRetryable,
  markCheckoutFinalizationJobFailedPermanent,
  markCheckoutFinalizationJobCancelled,
  classifyFinalizeJobError,
  computeFinalizeJobBackoffMs,
  getFinalizeJobVisibilityTimeoutMs,
  getCheckoutFinalizationJobById,
  getCheckoutFinalizationJobByCheckoutId,
  listCheckoutFinalizationJobsByPaymentIntentId,
  toJobDto
};
