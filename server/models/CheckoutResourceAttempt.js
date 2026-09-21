'use strict';

/**
 * CheckoutResourceAttempt — same-checkout resource-bundle orchestration fence.
 *
 * Coordination authority only (partial unique live fence per checkoutId).
 * Does NOT replace accommodation night claims or facility lane uniqueness.
 */
const mongoose = require('mongoose');

const ATTEMPT_STATUSES = Object.freeze(['open', 'released', 'failed', 'expired']);

const AUTHORITATIVE_LIVE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ checkoutId: 1 }),
  options: Object.freeze({
    unique: true,
    partialFilterExpression: Object.freeze({ isLive: true }),
    name: 'checkoutResourceAttempt_checkoutId_live_unique'
  }),
  note: 'Live fence exclusivity; tests must createIndex explicitly; autoIndex false'
});

const checkoutResourceAttemptSchema = new mongoose.Schema(
  {
    attemptId: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    checkoutId: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    quoteSnapshotHash: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
      validate: {
        validator(v) {
          return typeof v === 'string' && v.trim().length > 0;
        },
        message: 'quoteSnapshotHash must be a non-empty string'
      }
    },
    generation: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator(v) {
          return Number.isInteger(v) && v >= 1;
        },
        message: 'generation must be an integer >= 1'
      }
    },
    status: {
      type: String,
      enum: ATTEMPT_STATUSES,
      required: true,
      default: 'open'
    },
    /** True iff status === open. Partial unique index uses equality on this field. */
    isLive: {
      type: Boolean,
      required: true,
      default: true
    },
    startedAt: {
      type: Date,
      required: true
    },
    bundleValidUntil: {
      type: Date,
      required: true,
      immutable: true
    },
    releasedAt: {
      type: Date,
      default: null
    },
    failureCode: {
      type: String,
      default: null,
      trim: true
    }
  },
  { timestamps: true }
);

checkoutResourceAttemptSchema.index({ attemptId: 1 }, { unique: true });
checkoutResourceAttemptSchema.index({ checkoutId: 1, generation: 1 }, { unique: true });
checkoutResourceAttemptSchema.index(
  AUTHORITATIVE_LIVE_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_LIVE_INDEX_SPEC.options }
);
checkoutResourceAttemptSchema.index({ status: 1, bundleValidUntil: 1 });
checkoutResourceAttemptSchema.index({ checkoutId: 1, generation: -1 });

checkoutResourceAttemptSchema.set('autoIndex', false);

checkoutResourceAttemptSchema.pre('validate', function syncIsLive(next) {
  if (this.status === 'open') {
    this.isLive = true;
  } else if (
    this.status === 'released' ||
    this.status === 'failed' ||
    this.status === 'expired'
  ) {
    this.isLive = false;
  }
  next();
});

module.exports = mongoose.model('CheckoutResourceAttempt', checkoutResourceAttemptSchema);
module.exports.ATTEMPT_STATUSES = ATTEMPT_STATUSES;
module.exports.AUTHORITATIVE_LIVE_INDEX_SPEC = AUTHORITATIVE_LIVE_INDEX_SPEC;
