const mongoose = require('mongoose');
const {
  DELIVERY_EVENT_PROVIDERS,
  DELIVERY_EVENT_CHANNELS,
  DELIVERY_EVENT_TYPES
} = require('../services/messaging/messagingEnums');

/**
 * MessageDeliveryEvent
 *
 * Provider webhook events normalised across channels. Distinct from the
 * legacy `EmailEvent` collection — `EmailEvent` continues to receive legacy
 * lifecycle events; this store receives ONLY new-system events. See
 * docs/guest-message-automation/02_V1_SPEC.md §15.
 *
 * `createdAt` represents receipt time and is never re-stamped, so
 * `updatedAt` is intentionally suppressed.
 */
const messageDeliveryEventSchema = new mongoose.Schema(
  {
    dispatchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MessageDispatch',
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    provider: {
      type: String,
      enum: DELIVERY_EVENT_PROVIDERS,
      required: true
    },
    channel: {
      type: String,
      enum: DELIVERY_EVENT_CHANNELS,
      required: true
    },
    eventType: {
      type: String,
      enum: DELIVERY_EVENT_TYPES,
      required: true
    },
    isTerminal: { type: Boolean, required: true, default: false },
    providerEventId: { type: String, required: true, trim: true },
    providerMessageId: { type: String, default: null },
    occurredAt: { type: Date, required: true },
    payload: { type: Object, default: {} }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageDeliveryEventSchema.index(
  { provider: 1, providerEventId: 1 },
  { unique: true }
);

// Per-dispatch event stream.
messageDeliveryEventSchema.index(
  { dispatchId: 1, occurredAt: -1 },
  { partialFilterExpression: { dispatchId: { $type: 'objectId' } } }
);

// Per-booking channel timeline.
messageDeliveryEventSchema.index(
  { bookingId: 1, channel: 1, occurredAt: -1 },
  { partialFilterExpression: { bookingId: { $type: 'objectId' } } }
);

module.exports = mongoose.model('MessageDeliveryEvent', messageDeliveryEventSchema);
