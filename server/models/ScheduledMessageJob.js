const mongoose = require('mongoose');
const {
  AUTOMATION_RULE_AUDIENCES,
  MESSAGE_TEMPLATE_PROPERTY_KINDS,
  SCHEDULED_JOB_STATUSES
} = require('../services/messaging/messagingEnums');

/**
 * ScheduledMessageJob
 *
 * Durable queue. One row represents ONE rule occurrence — not one channel
 * attempt. WhatsApp/email attempts live in MessageDispatch under this job.
 * Channel is therefore deliberately excluded from the uniqueness keys; see
 * docs/guest-message-automation/02_V1_SPEC.md §13.
 *
 * Two partial-unique indexes cover both rule modalities:
 *   - per-booking jobs: unique on (bookingId, ruleKey, scheduledFor)
 *   - no-booking jobs:  unique on (ruleKey, scheduledFor)
 *
 * `bookingId` defaults to `null` (never `undefined`) so the partial filter
 * `{ bookingId: null }` matches consistently.
 */
const scheduledMessageJobSchema = new mongoose.Schema(
  {
    ruleKey: { type: String, required: true, trim: true },
    ruleVersionAtSchedule: { type: Number, required: true, default: 1, min: 1 },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    audience: {
      type: String,
      enum: AUTOMATION_RULE_AUDIENCES,
      required: true
    },
    propertyKind: {
      type: String,
      enum: MESSAGE_TEMPLATE_PROPERTY_KINDS,
      required: true
    },
    scheduledFor: { type: Date, required: true },
    scheduledForSofia: { type: String, default: null },
    status: {
      type: String,
      enum: SCHEDULED_JOB_STATUSES,
      required: true,
      default: 'scheduled'
    },
    attemptCount: { type: Number, required: true, default: 0, min: 0 },
    maxAttempts: { type: Number, required: true, default: 3, min: 1 },
    claimedBy: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    visibilityTimeoutAt: { type: Date, default: null },
    payloadSnapshot: { type: Object, default: {} },
    cancelReason: { type: String, default: null },
    cancelActor: { type: String, default: null },
    lastError: { type: String, default: null }
  },
  { timestamps: true }
);

// Per-booking uniqueness — channel deliberately EXCLUDED (Batch 1 patch).
scheduledMessageJobSchema.index(
  { bookingId: 1, ruleKey: 1, scheduledFor: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: { $type: 'objectId' } }
  }
);

// No-booking uniqueness — for ops rules not tied to a booking.
scheduledMessageJobSchema.index(
  { ruleKey: 1, scheduledFor: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingId: null }
  }
);

// Worker tick query.
scheduledMessageJobSchema.index({ status: 1, scheduledFor: 1 });

// OPS per-booking listing.
scheduledMessageJobSchema.index({ bookingId: 1, status: 1 });

module.exports = mongoose.model('ScheduledMessageJob', scheduledMessageJobSchema);
