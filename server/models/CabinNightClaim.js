'use strict';

const mongoose = require('mongoose');

/**
 * CabinNightClaim — exclusive guest ownership of one single-cabin occupied night.
 *
 * Binding: docs/stay-change-implementation-plan.md — §24 REBOOK-S1.
 * B8F1A: checkout lease ownership shares the same unique {cabinId, night} authority.
 *
 * Delete-on-release: releasing deletes the row. No active/released status.
 *
 * Authoritative unique index is created ONLY by explicit S1 cutover CLI (S1.6).
 * Schema autoIndex is disabled so ordinary deploy/startup cannot mutate it.
 */

const CLAIM_SOURCES = Object.freeze([
  'finalize',
  'legacy_create',
  'manual_reservation',
  'location_child',
  'date_edit',
  'reassign',
  'rebook',
  'bootstrap',
  'recovery',
  'test',
  'other',
  'checkout_lease'
]);

const OWNER_TYPES = Object.freeze(['booking', 'checkout']);

const AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ cabinId: 1, night: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'cabinNightClaim_cabinId_night_unique'
  }),
  cutoverBatch: 'S1',
  legacyNonUniqueName: 'cabinId_1_night_1',
  note: 'Created only by cabinNightClaimS1Cutover.js --create-unique-index'
});

function isNonNullField(value) {
  return value != null && !(typeof value === 'string' && value.trim() === '');
}

const cabinNightClaimSchema = new mongoose.Schema(
  {
    cabinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cabin',
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

cabinNightClaimSchema.pre('validate', function validateOwnership(next) {
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

cabinNightClaimSchema.index({ cabinId: 1 });
cabinNightClaimSchema.index({ night: 1 });
cabinNightClaimSchema.index({ bookingId: 1 });
cabinNightClaimSchema.index({ stayChangeId: 1 });
cabinNightClaimSchema.index({ bookingId: 1, cabinId: 1 });
cabinNightClaimSchema.index({ checkoutId: 1, leaseId: 1 });
cabinNightClaimSchema.index({ leaseId: 1, acquisitionId: 1 });
cabinNightClaimSchema.index({ ownerType: 1, expiresAt: 1 });
cabinNightClaimSchema.index({ convertedFromCheckoutId: 1, convertedFromLeaseId: 1 });
cabinNightClaimSchema.index({ bookingId: 1, convertedFromLeaseId: 1 });

cabinNightClaimSchema.set('autoIndex', false);

cabinNightClaimSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
cabinNightClaimSchema.statics.CLAIM_SOURCES = CLAIM_SOURCES;
cabinNightClaimSchema.statics.OWNER_TYPES = OWNER_TYPES;

module.exports = mongoose.model('CabinNightClaim', cabinNightClaimSchema);
module.exports.CLAIM_SOURCES = CLAIM_SOURCES;
module.exports.OWNER_TYPES = OWNER_TYPES;
module.exports.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
