/**
 * Facility — generic self-led bookable facility resource.
 *
 * B6: one sauna + two separately schedulable hot tubs.
 * Not accommodation inventory; do not use AvailabilityBlock.
 * Slot duration / schedule / concurrency are configurable (not hardcoded).
 */
'use strict';

const mongoose = require('mongoose');

const FACILITY_STATUSES = ['draft', 'active', 'retired', 'inactive'];

const absoluteWindowSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true }
  },
  { _id: false }
);

const unavailablePeriodSchema = new mongoose.Schema(
  {
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 200, default: null }
  },
  { _id: false }
);

const operatingScheduleSchema = new mongoose.Schema(
  {
    /**
     * Absolute [start, end) windows used by tests and explicit overrides.
     * Weekly recurring hours can be added later without breaking this shape.
     */
    absoluteWindows: {
      type: [absoluteWindowSchema],
      default: []
    }
  },
  { _id: false }
);

const facilitySchema = new mongoose.Schema(
  {
    facilityCode: {
      type: String,
      required: [true, 'facilityCode is required'],
      trim: true,
      lowercase: true,
      unique: true,
      minlength: [2, 'facilityCode must be at least 2 characters'],
      maxlength: [80, 'facilityCode cannot exceed 80 characters'],
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'facilityCode must be lowercase kebab-case']
    },
    name: {
      type: String,
      required: [true, 'Facility name is required'],
      trim: true,
      maxlength: [160, 'Name cannot exceed 160 characters']
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: FACILITY_STATUSES,
        message: 'Unsupported facility status'
      },
      default: 'draft'
    },
    /** Guests heat and operate the facility themselves. */
    selfLed: {
      type: Boolean,
      required: true,
      default: true
    },
    requiredAddOnCode: {
      type: String,
      required: [true, 'requiredAddOnCode is required'],
      trim: true,
      lowercase: true,
      maxlength: [80, 'requiredAddOnCode cannot exceed 80 characters']
    },
    requiredAddOnVersion: {
      type: Number,
      required: [true, 'requiredAddOnVersion is required'],
      min: [1, 'requiredAddOnVersion must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'requiredAddOnVersion must be a positive integer'
      }
    },
    /** Slot length in minutes; must be configured per facility (no global hardcode). */
    slotDurationMinutes: {
      type: Number,
      required: [true, 'slotDurationMinutes is required'],
      min: [1, 'slotDurationMinutes must be at least 1'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'slotDurationMinutes must be an integer'
      }
    },
    maxConcurrentBookings: {
      type: Number,
      required: true,
      min: [1, 'maxConcurrentBookings must be at least 1'],
      default: 1,
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'maxConcurrentBookings must be an integer'
      }
    },
    operatingSchedule: {
      type: operatingScheduleSchema,
      default: null
    },
    unavailablePeriods: {
      type: [unavailablePeriodSchema],
      default: []
    }
  },
  { timestamps: true }
);

facilitySchema.index({ status: 1, facilityCode: 1 });

module.exports = mongoose.model('Facility', facilitySchema);
module.exports.FACILITY_STATUSES = FACILITY_STATUSES;
