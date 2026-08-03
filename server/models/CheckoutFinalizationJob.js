'use strict';

/**
 * CheckoutFinalizationJob — durable paid-finalization work queue (Batch 3–5).
 * Binding: docs/checkout-payment-architecture/02_PAID_BOOKING_FINALIZATION_IMPLEMENTATION_SPEC.md §C
 *
 * Batch 3: enqueue (scheduled). Batch 5: claim/execute via checkoutFinalizationWorker.
 */

const mongoose = require('mongoose');

const CHECKOUT_FINALIZATION_JOB_STATUSES = Object.freeze([
  'scheduled',
  'claimed',
  'succeeded',
  'failed_retryable',
  'failed_permanent',
  'cancelled'
]);

const CHECKOUT_FINALIZATION_JOB_STAGES = Object.freeze([
  'queued',
  'verify_payment',
  'acquire_lock',
  'assign_unit',
  'save_booking',
  'link_payment',
  'patch_stripe_metadata',
  'finalize_session',
  'convert_quote',
  'resolve_alerts',
  'enqueue_side_effects',
  'succeeded'
]);

const CHECKOUT_FINALIZATION_JOB_CREATED_REASONS = Object.freeze([
  'webhook',
  'reconcile',
  'manual'
]);

const ACTIVE_EXECUTABLE_STATUSES = Object.freeze(['scheduled', 'claimed']);

const CHECKOUT_FINALIZATION_RECOVERY_STATUSES = Object.freeze([
  'idle',
  'leased',
  'linkage_complete',
  'awaiting_confirmation_queue',
  'awaiting_review_resolution',
  'complete',
  'failed'
]);

const checkoutFinalizationJobSchema = new mongoose.Schema(
  {
    checkoutId: {
      type: String,
      required: [true, 'checkoutId is required'],
      trim: true,
      maxlength: 128
    },
    paymentIntentId: {
      type: String,
      required: [true, 'paymentIntentId is required'],
      trim: true
    },
    stripeEventId: {
      type: String,
      trim: true,
      default: null
    },
    quoteSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    finalizeIntentHash: {
      type: String,
      trim: true,
      default: null
    },
    status: {
      type: String,
      enum: CHECKOUT_FINALIZATION_JOB_STATUSES,
      required: true,
      default: 'scheduled'
    },
    stage: {
      type: String,
      enum: CHECKOUT_FINALIZATION_JOB_STAGES,
      required: true,
      default: 'queued'
    },
    attemptCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0
    },
    maxAttempts: {
      type: Number,
      required: true,
      default: 20,
      min: 1
    },
    claimedBy: {
      type: String,
      default: null
    },
    claimedAt: {
      type: Date,
      default: null
    },
    visibilityTimeoutAt: {
      type: Date,
      default: null
    },
    nextAttemptAt: {
      type: Date,
      required: true,
      default: Date.now
    },
    lastErrorCode: {
      type: String,
      default: null
    },
    lastErrorSummary: {
      type: String,
      maxlength: 500,
      default: null
    },
    safeDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    paymentLinkedAt: {
      type: Date,
      default: null
    },
    sessionFinalizedAt: {
      type: Date,
      default: null
    },
    quoteConvertedAt: {
      type: Date,
      default: null
    },
    confirmationQueuedAt: {
      type: Date,
      default: null
    },
    confirmationSentAt: {
      type: Date,
      default: null
    },
    firstFailedAt: {
      type: Date,
      default: null
    },
    lastFailedAt: {
      type: Date,
      default: null
    },
    createdReason: {
      type: String,
      enum: CHECKOUT_FINALIZATION_JOB_CREATED_REASONS,
      required: true
    },
    // S0 multi-unit paid-orphan recovery lifecycle (independent of worker status)
    recoveryStatus: {
      type: String,
      enum: CHECKOUT_FINALIZATION_RECOVERY_STATUSES,
      default: 'idle'
    },
    recoveryExecutionId: {
      type: String,
      default: null
    },
    recoveryEvidenceDigest: {
      type: String,
      default: null
    },
    recoveryAllowlistHash: {
      type: String,
      default: null
    },
    recoveryClaimedBy: {
      type: String,
      default: null
    },
    recoveryClaimedAt: {
      type: Date,
      default: null
    },
    recoveryVisibilityTimeoutAt: {
      type: Date,
      default: null
    },
    recoveryAttemptCount: {
      type: Number,
      default: 0,
      min: 0
    },
    recoveryLastErrorCode: {
      type: String,
      default: null
    },
    recoveryLastErrorSummary: {
      type: String,
      maxlength: 500,
      default: null
    },
    recoveryHistory: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    recoveryOperatorActorId: {
      type: String,
      default: null
    },
    recoveryOperatorIntentConfirmedAt: {
      type: Date,
      default: null
    },
    recoveryReason: {
      type: String,
      maxlength: 500,
      default: null
    },
    activeRecoveryReviewItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ManualReviewItem',
      default: null
    },
    recoveredAt: {
      type: Date,
      default: null
    },
    recoveredBy: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

// 1. At most one active executable job per checkoutId
checkoutFinalizationJobSchema.index(
  { checkoutId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['scheduled', 'claimed'] }
    }
  }
);

// 2. Worker poll (Batch 5+; defined now for index readiness)
checkoutFinalizationJobSchema.index({ status: 1, nextAttemptAt: 1 });

// 3. Stale claim sweep
checkoutFinalizationJobSchema.index({ status: 1, visibilityTimeoutAt: 1 });

// 4. Ops / reconcile by PaymentIntent
checkoutFinalizationJobSchema.index({ paymentIntentId: 1, createdAt: -1 });

// 5. Optional ops filter
checkoutFinalizationJobSchema.index({ createdReason: 1, status: 1, createdAt: -1 });

// 6. S0 recovery lease / phase scans (worker continues scheduled|claimed only)
checkoutFinalizationJobSchema.index({
  recoveryStatus: 1,
  recoveryVisibilityTimeoutAt: 1
});
checkoutFinalizationJobSchema.index({ recoveryExecutionId: 1 });

module.exports = mongoose.model('CheckoutFinalizationJob', checkoutFinalizationJobSchema);
module.exports.CHECKOUT_FINALIZATION_JOB_STATUSES = CHECKOUT_FINALIZATION_JOB_STATUSES;
module.exports.CHECKOUT_FINALIZATION_JOB_STAGES = CHECKOUT_FINALIZATION_JOB_STAGES;
module.exports.CHECKOUT_FINALIZATION_JOB_CREATED_REASONS = CHECKOUT_FINALIZATION_JOB_CREATED_REASONS;
module.exports.ACTIVE_EXECUTABLE_STATUSES = ACTIVE_EXECUTABLE_STATUSES;
module.exports.CHECKOUT_FINALIZATION_RECOVERY_STATUSES = CHECKOUT_FINALIZATION_RECOVERY_STATUSES;
