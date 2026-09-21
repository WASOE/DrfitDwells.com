'use strict';

/**
 * AccommodationCheckoutLease — same-checkout acquisition fencing header.
 *
 * NOT the accommodation exclusivity authority.
 * Exclusivity remains UnitNightClaim / CabinNightClaim unique {resource, night}.
 *
 * B8F4A: sealed → converting → converted binds paid finalization before claim promotion.
 * B8F4A C5: released-header checkout-claim cleanup progress (pending → complete).
 */
const mongoose = require('mongoose');

const LEASE_STATUSES = Object.freeze([
  'open',
  'sealed',
  'converting',
  'failed',
  'released',
  'converted'
]);
const ENTITY_TYPES = Object.freeze(['unit', 'cabin']);
const CHECKOUT_CLAIM_CLEANUP_STATUSES = Object.freeze(['pending', 'complete']);

const accommodationCheckoutLeaseSchema = new mongoose.Schema(
  {
    leaseId: {
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
    generation: {
      type: Number,
      required: true,
      min: 1
    },
    status: {
      type: String,
      enum: LEASE_STATUSES,
      required: true,
      default: 'open'
    },
    /** True for open|sealed|converting. Partial unique index uses this equality (no $in). */
    isLive: {
      type: Boolean,
      required: true,
      default: true
    },
    entityType: {
      type: String,
      enum: ENTITY_TYPES,
      required: true
    },
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      default: null
    },
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
      default: null
    },
    checkIn: {
      type: String,
      required: true,
      trim: true
    },
    checkOut: {
      type: String,
      required: true,
      trim: true
    },
    expectedNightCount: {
      type: Number,
      required: true,
      min: 1
    },
    expiresAt: {
      type: Date,
      required: true
    },
    activeAcquisitionId: {
      type: String,
      default: null,
      trim: true
    },
    acquisitionStartedAt: {
      type: Date,
      default: null
    },
    /** B8F4A — durable conversion identity while converting / after converted. */
    conversionBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    conversionAttemptId: {
      type: String,
      trim: true,
      default: null
    },
    conversionQuoteSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    conversionStartedAt: {
      type: Date,
      default: null
    },
    convertedAt: {
      type: Date,
      default: null
    },
    conversionFailureCode: {
      type: String,
      trim: true,
      default: null
    },
    conversionFailedAt: {
      type: Date,
      default: null
    },
    /**
     * B8F4A C5 / B8F5A — released-header checkout-claim cleanup progress.
     * Missing/null on released headers is treated as pending by recovery.
     * Legacy missing attempt/nextAttempt fields → zero attempts / immediately eligible.
     */
    checkoutClaimCleanupStatus: {
      type: String,
      enum: CHECKOUT_CLAIM_CLEANUP_STATUSES,
      default: null
    },
    checkoutClaimCleanupCompletedAt: {
      type: Date,
      default: null
    },
    checkoutClaimCleanupLastAttemptAt: {
      type: Date,
      default: null
    },
    checkoutClaimCleanupFailureCode: {
      type: String,
      trim: true,
      default: null
    },
    /** Non-negative cleanup attempt counter (missing legacy ≡ 0).
     * B8F5A Correction 1: reservation CAS normalizes malformed values and stores
     * an integer ≥ 1 on every successful reserve (never unchecked $inc).
     */
    checkoutClaimCleanupAttemptCount: {
      type: Number,
      min: 0,
      default: 0
    },
    /**
     * When null/missing → immediately eligible.
     * When set in the future → deferred out of the eligible batch until due.
     * Complete cleanup always stores null.
     */
    checkoutClaimCleanupNextAttemptAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

accommodationCheckoutLeaseSchema.index({ leaseId: 1 }, { unique: true });
accommodationCheckoutLeaseSchema.index({ checkoutId: 1, generation: 1 }, { unique: true });
accommodationCheckoutLeaseSchema.index(
  { checkoutId: 1 },
  {
    unique: true,
    partialFilterExpression: { isLive: true },
    name: 'accommodationCheckoutLease_checkoutId_live_unique'
  }
);
accommodationCheckoutLeaseSchema.index({ expiresAt: 1 });
accommodationCheckoutLeaseSchema.index({ conversionBookingId: 1 });
/**
 * Released pending/legacy cleanup recovery (B8F5A).
 * Supports released+non-live + cleanup status + nextAttemptAt scheduling + leaseId order.
 * Not created against production in this batch (autoIndex false).
 */
accommodationCheckoutLeaseSchema.index(
  {
    status: 1,
    isLive: 1,
    checkoutClaimCleanupStatus: 1,
    checkoutClaimCleanupNextAttemptAt: 1,
    leaseId: 1
  },
  { name: 'accommodationCheckoutLease_released_cleanup_v2' }
);

accommodationCheckoutLeaseSchema.set('autoIndex', false);

accommodationCheckoutLeaseSchema.pre('validate', function syncIsLive(next) {
  if (this.status === 'open' || this.status === 'sealed' || this.status === 'converting') {
    this.isLive = true;
  } else if (
    this.status === 'failed' ||
    this.status === 'released' ||
    this.status === 'converted'
  ) {
    this.isLive = false;
  }
  next();
});

module.exports = mongoose.model('AccommodationCheckoutLease', accommodationCheckoutLeaseSchema);
module.exports.LEASE_STATUSES = LEASE_STATUSES;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
module.exports.CHECKOUT_CLAIM_CLEANUP_STATUSES = CHECKOUT_CLAIM_CLEANUP_STATUSES;
