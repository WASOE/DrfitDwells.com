'use strict';

const mongoose = require('mongoose');

const OPS_PUSH_SCHEDULED_JOB_TYPES = Object.freeze([
  'arrival_reminder_admin',
  'cleaning_checkout_day'
]);

const OPS_PUSH_SCHEDULED_JOB_STATUSES = Object.freeze([
  'scheduled',
  'claimed',
  'sent',
  'failed',
  'cancelled',
  'suppressed'
]);

const opsPushScheduledJobSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: OPS_PUSH_SCHEDULED_JOB_TYPES,
      required: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley', null],
      default: null
    },
    scheduledFor: {
      type: Date,
      required: true,
      index: true
    },
    scheduledForSofia: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: OPS_PUSH_SCHEDULED_JOB_STATUSES,
      required: true,
      default: 'scheduled'
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
      default: 3,
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
    payloadSnapshot: {
      type: Object,
      default: {}
    },
    cancelReason: {
      type: String,
      default: null
    },
    cancelActor: {
      type: String,
      default: null
    },
    lastError: {
      type: String,
      default: null
    },
    lastResult: {
      type: Object,
      default: null
    },
    dedupeKey: {
      type: String,
      required: true,
      maxlength: 256
    }
  },
  { timestamps: true }
);

opsPushScheduledJobSchema.index({ status: 1, scheduledFor: 1 });
opsPushScheduledJobSchema.index({ bookingId: 1, status: 1 });
opsPushScheduledJobSchema.index(
  { bookingId: 1, jobType: 1, scheduledFor: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['scheduled', 'claimed', 'sent'] }
    }
  }
);

module.exports = mongoose.model('OpsPushScheduledJob', opsPushScheduledJobSchema);
module.exports.OPS_PUSH_SCHEDULED_JOB_TYPES = OPS_PUSH_SCHEDULED_JOB_TYPES;
module.exports.OPS_PUSH_SCHEDULED_JOB_STATUSES = OPS_PUSH_SCHEDULED_JOB_STATUSES;
