/**
 * FacilityReservation — time-slot hold/confirm for a single Facility resource.
 *
 * Separate from AvailabilityBlock (cabin/unit nights).
 * B6: model + pure availability helpers.
 * B8D: concurrency-safe holds via unique (facilityCode, slotStart, capacityLane).
 */
'use strict';

const mongoose = require('mongoose');

const RESERVATION_STATUSES = ['hold', 'confirmed', 'cancelled', 'expired'];

const AUTHORITATIVE_UNIQUE_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ facilityCode: 1, slotStart: 1, capacityLane: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'facilityReservation_facility_slot_lane_unique'
  }),
  note: 'Contention authority for B8D facility holds; tests must createIndex explicitly'
});

const priceSnapshotSchema = new mongoose.Schema(
  {
    currency: { type: String, required: true, enum: ['EUR'] },
    amount: { type: Number, required: true, min: 0 },
    chargeUnit: { type: String, required: true },
    addOnCode: { type: String, required: true, lowercase: true, trim: true },
    addOnVersion: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const facilityReservationSchema = new mongoose.Schema(
  {
    facilityCode: {
      type: String,
      required: [true, 'facilityCode is required'],
      trim: true,
      lowercase: true,
      index: true,
      maxlength: [80, 'facilityCode cannot exceed 80 characters']
    },
    /** Canonical slot start; must equal startTime. */
    slotStart: {
      type: Date,
      required: [true, 'slotStart is required']
    },
    /**
     * Capacity lane 0 .. maxConcurrentBookings-1.
     * Unique with facilityCode + slotStart.
     */
    capacityLane: {
      type: Number,
      required: [true, 'capacityLane is required'],
      min: [0, 'capacityLane cannot be negative'],
      validate: {
        validator(v) {
          return Number.isInteger(v) && v >= 0;
        },
        message: 'capacityLane must be a non-negative integer'
      }
    },
    startTime: {
      type: Date,
      required: [true, 'startTime is required']
    },
    endTime: {
      type: Date,
      required: [true, 'endTime is required']
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: RESERVATION_STATUSES,
        message: 'Unsupported reservation status'
      },
      default: 'hold',
      index: true
    },
    /** Idempotency / ownership key for holds (CheckoutSession.checkoutId). */
    checkoutSessionId: {
      type: String,
      default: null,
      trim: true,
      index: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    /** When status is hold; after this instant the hold no longer blocks. */
    holdExpiresAt: {
      type: Date,
      default: null
    },
    addOnCode: {
      type: String,
      required: [true, 'addOnCode is required'],
      trim: true,
      lowercase: true
    },
    addOnVersion: {
      type: Number,
      required: [true, 'addOnVersion is required'],
      min: [1, 'addOnVersion must be a positive integer']
    },
    /** Server-owned firewood pack price at selection time. */
    priceSnapshot: {
      type: priceSnapshotSchema,
      required: true
    },
    ratePlanCode: {
      type: String,
      default: null,
      trim: true,
      lowercase: true
    },
    ratePlanVersion: {
      type: Number,
      default: null,
      min: [1, 'ratePlanVersion must be a positive integer']
    },
    /**
     * B8F2A1: resource-attempt fencing token while a hold is in-flight.
     * Null/absent after seal or for legacy B8D unmarked holds.
     */
    acquisitionAttemptId: {
      type: String,
      default: null,
      trim: true
    }
  },
  { timestamps: true }
);

facilityReservationSchema.pre('validate', function preValidate(next) {
  if (this.slotStart != null && this.startTime != null) {
    const slotMs = new Date(this.slotStart).getTime();
    const startMs = new Date(this.startTime).getTime();
    if (slotMs !== startMs) {
      this.invalidate('slotStart', 'slotStart must equal startTime');
    }
  }

  if (this.status === 'hold') {
    if (!this.checkoutSessionId || !String(this.checkoutSessionId).trim()) {
      this.invalidate('checkoutSessionId', 'checkoutSessionId is required for hold');
    }
    if (!this.holdExpiresAt) {
      this.invalidate('holdExpiresAt', 'holdExpiresAt is required for hold');
    }
  }

  next();
});

facilityReservationSchema.index({ facilityCode: 1, startTime: 1, endTime: 1, status: 1 });
facilityReservationSchema.index({ holdExpiresAt: 1 }, { sparse: true });
facilityReservationSchema.index(AUTHORITATIVE_UNIQUE_INDEX_SPEC.keys, {
  ...AUTHORITATIVE_UNIQUE_INDEX_SPEC.options
});
facilityReservationSchema.index({ checkoutSessionId: 1, status: 1 });
facilityReservationSchema.index({ status: 1, holdExpiresAt: 1 });
facilityReservationSchema.index({ bookingId: 1 });
facilityReservationSchema.index({ facilityCode: 1, slotStart: 1, status: 1 });
facilityReservationSchema.index(
  { acquisitionAttemptId: 1 },
  {
    sparse: true,
    name: 'facilityReservation_acquisitionAttemptId_sparse'
  }
);

facilityReservationSchema.statics.AUTHORITATIVE_UNIQUE_INDEX_SPEC =
  AUTHORITATIVE_UNIQUE_INDEX_SPEC;

module.exports = mongoose.model('FacilityReservation', facilityReservationSchema);
module.exports.RESERVATION_STATUSES = RESERVATION_STATUSES;
module.exports.AUTHORITATIVE_UNIQUE_INDEX_SPEC = AUTHORITATIVE_UNIQUE_INDEX_SPEC;
