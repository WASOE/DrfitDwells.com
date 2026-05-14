const mongoose = require('mongoose');
const {
  MESSAGE_DISPATCH_CHANNELS,
  MESSAGE_DISPATCH_LIFECYCLE_SOURCES,
  MESSAGE_DISPATCH_STATUSES,
  MESSAGE_DISPATCH_PROVIDERS
} = require('../services/messaging/messagingEnums');

/**
 * MessageDispatch
 *
 * Record of one concrete send attempt. Channel lives here, NOT on
 * ScheduledMessageJob (one rule occurrence may produce 0..N dispatch rows,
 * one per channel attempt or retry). Manual sends produce a dispatch row
 * with no parent ScheduledMessageJob.
 *
 * See docs/guest-message-automation/02_V1_SPEC.md §14.
 */
const messageDispatchSchema = new mongoose.Schema(
  {
    scheduledMessageJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScheduledMessageJob',
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    ruleKey: { type: String, default: null },
    templateKey: { type: String, required: true, trim: true },
    templateVersion: { type: Number, required: true, min: 1 },
    channel: {
      type: String,
      enum: MESSAGE_DISPATCH_CHANNELS,
      required: true
    },
    recipient: { type: String, required: true, trim: true },
    recipientChannelId: { type: String, default: null },
    lifecycleSource: {
      type: String,
      enum: MESSAGE_DISPATCH_LIFECYCLE_SOURCES,
      required: true
    },
    status: {
      type: String,
      enum: MESSAGE_DISPATCH_STATUSES,
      required: true
    },
    providerName: {
      type: String,
      enum: MESSAGE_DISPATCH_PROVIDERS,
      required: true
    },
    providerMessageId: { type: String, default: null },
    error: { type: Object, default: null },
    actorId: { type: String, default: null },
    actorRole: { type: String, default: null },
    idempotencyKey: { type: String, required: true, trim: true },
    // Optional free-form details. Batch 8 stores `{ shadow: true }` for
    // shadow-mode dispatches so OPS can filter "did this go out for real".
    // Additive, no index, no validators; safe across batches.
    details: { type: Object, default: {} }
  },
  { timestamps: true }
);

messageDispatchSchema.index({ idempotencyKey: 1 }, { unique: true });

// Provider-message uniqueness, only when an id is present.
messageDispatchSchema.index(
  { providerName: 1, providerMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerMessageId: { $type: 'string' } }
  }
);

// OPS per-booking history.
messageDispatchSchema.index({ bookingId: 1, createdAt: -1 });

// Fast retry-list per job.
messageDispatchSchema.index({ scheduledMessageJobId: 1, createdAt: -1 });

module.exports = mongoose.model('MessageDispatch', messageDispatchSchema);
