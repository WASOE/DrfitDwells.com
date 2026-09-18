'use strict';

const mongoose = require('mongoose');

/**
 * UnitNightClaim — exclusive guest ownership of one physical unit-night.
 *
 * Binding: docs/stay-change-implementation-plan.md — I6 authoritative cutover.
 * B8F1A: checkout lease ownership shares the same unique {unitId, night} authority.
 *
 * Delete-on-release: releasing deletes the row. No active/released status.
 *
 * Authoritative unique index is created ONLY by explicit I6 cutover CLI.
 * Schema autoIndex is disabled so ordinary deploy/startup cannot mutate it.
 */

const CLAIM_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'location_child',
  'multi_unit_recovery',
  'date_edit',
  'reallocate',
  'rebook',
  'bootstrap',
  'test',
  'other',
  'checkout_lease'
]);

const OWNER_TYPES = Object.freeze(['booking', 'checkout']);

const AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ unitId: 1, night: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'unitNightClaim_unitId_night_unique'
  }),
  cutoverBatch: 'I6',
  legacyNonUniqueName: 'unitId_1_night_1',
  note: 'Created only by unitNightClaimI6Cutover.js --create-unique-index'
});

function isNonNullField(value) {
  return value != null && !(typeof value === 'string' && value.trim() === '');
}

const unitNightClaimSchema = new mongoose.Schema(
  {
    unitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Unit',
      required: true
    },
    night: {
      type: Date,
      required: true
    },
    ownerType: {
      type: String,
      enum: OWNER_TYPES,
      default: 'booking'
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      required: function requiredBookingId() {
        return this.ownerType !== 'checkout';
      }
    },
    checkoutId: {
      type: String,
      trim: true,
      default: null
    },
    leaseId: {
      type: String,
      trim: true,
      default: null
    },
    acquisitionId: {
      type: String,
      trim: true,
      default: null
    },
    expiresAt: {
      type: Date,
      default: null
    },
    stayChangeId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },
    source: {
      type: String,
      required: true,
      trim: true,
      maxlength: [80, 'source cannot exceed 80 characters'],
      default: 'other'
    },
    /** B8F4A — durable conversion provenance on booking-owned claims. */
    convertedFromCheckoutId: {
      type: String,
      trim: true,
      default: null
    },
    convertedFromLeaseId: {
      type: String,
      trim: true,
      default: null
    },
    convertedFromGeneration: {
      type: Number,
      default: null,
      min: 1
    },
    convertedFromAttemptId: {
      type: String,
      trim: true,
      default: null
    },
    convertedFromQuoteSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    convertedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

unitNightClaimSchema.pre('validate', function validateOwnership(next) {
  const owner = this.ownerType == null || this.ownerType === '' ? 'booking' : this.ownerType;
  if (owner === 'checkout') {
    if (!isNonNullField(this.checkoutId)) {
      this.invalidate('checkoutId', 'checkoutId is required for checkout ownership');
    }
    if (!isNonNullField(this.leaseId)) {
      this.invalidate('leaseId', 'leaseId is required for checkout ownership');
    }
    if (this.expiresAt == null || Number.isNaN(new Date(this.expiresAt).getTime())) {
      this.invalidate('expiresAt', 'valid expiresAt is required for checkout ownership');
    }
    if (this.bookingId != null) {
      this.invalidate('bookingId', 'bookingId must be null for checkout ownership');
    }
  } else {
    if (this.bookingId == null) {
      this.invalidate('bookingId', 'bookingId is required for booking ownership');
    }
    if (isNonNullField(this.checkoutId)) {
      this.invalidate('checkoutId', 'checkoutId must be null for booking ownership');
    }
    if (isNonNullField(this.leaseId)) {
      this.invalidate('leaseId', 'leaseId must be null for booking ownership');
    }
    if (isNonNullField(this.acquisitionId)) {
      this.invalidate('acquisitionId', 'acquisitionId must be null for booking ownership');
    }
    if (this.expiresAt != null) {
      this.invalidate('expiresAt', 'expiresAt must be null for booking ownership');
    }
  }
  next();
});

unitNightClaimSchema.index({ unitId: 1 });
unitNightClaimSchema.index({ night: 1 });
unitNightClaimSchema.index({ bookingId: 1 });
unitNightClaimSchema.index({ stayChangeId: 1 });
unitNightClaimSchema.index({ bookingId: 1, unitId: 1 });
unitNightClaimSchema.index({ checkoutId: 1, leaseId: 1 });
unitNightClaimSchema.index({ leaseId: 1, acquisitionId: 1 });
unitNightClaimSchema.index({ ownerType: 1, expiresAt: 1 });
unitNightClaimSchema.index({ convertedFromCheckoutId: 1, convertedFromLeaseId: 1 });
unitNightClaimSchema.index({ bookingId: 1, convertedFromLeaseId: 1 });

unitNightClaimSchema.index(
  AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options }
);

unitNightClaimSchema.set('autoIndex', false);

unitNightClaimSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
unitNightClaimSchema.statics.CLAIM_SOURCES = CLAIM_SOURCES;
unitNightClaimSchema.statics.OWNER_TYPES = OWNER_TYPES;

module.exports = mongoose.model('UnitNightClaim', unitNightClaimSchema);
module.exports.CLAIM_SOURCES = CLAIM_SOURCES;
module.exports.OWNER_TYPES = OWNER_TYPES;
module.exports.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
