'use strict';

const mongoose = require('mongoose');

const MESSAGE_PURPOSES = Object.freeze(['quote_delivery', 'booking_reminder']);
const DELIVERY_STATUSES = Object.freeze([
  'prepared',
  'prepared_preview',
  'blocked',
  'cancelled',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed'
]);

const eligibilitySnapshotSchema = new mongoose.Schema(
  {
    eligible: { type: Boolean, default: false },
    reason: { type: String, default: 'unknown', trim: true },
    evaluatedAt: { type: Date, default: null },
    consentBasis: { type: String, default: null, trim: true },
    globallySuppressed: { type: Boolean, default: false }
  },
  { _id: false }
);

/**
 * Append-only recovery delivery ledger. Batch 4B never writes status `sent`.
 * Full email is not stored — only recipientHash + domain for ops.
 */
const recoveryMessageDeliverySchema = new mongoose.Schema(
  {
    savedQuoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedBookingQuote',
      required: true,
      index: true
    },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    locationBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LocationBooking',
      default: null
    },
    checkoutSessionId: { type: String, default: null, trim: true },
    propertyKind: { type: String, enum: ['cabin', 'valley'], required: true, index: true },
    messagePurpose: { type: String, enum: MESSAGE_PURPOSES, required: true, index: true },
    channel: { type: String, enum: ['email'], default: 'email' },
    templateKey: { type: String, required: true, trim: true },
    templateVersion: { type: String, required: true, trim: true },
    recipientHash: { type: String, default: null, trim: true, index: true },
    recipientDomain: { type: String, default: null, trim: true },
    status: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'prepared',
      index: true
    },
    eligibilitySnapshot: { type: eligibilitySnapshotSchema, default: () => ({}) },
    idempotencyKey: { type: String, required: true, trim: true },
    sequence: { type: Number, default: 1, min: 1 },
    preparedAt: { type: Date, default: null },
    scheduledFor: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, trim: true },
    providerMessageId: { type: String, default: null, trim: true },
    failureClass: { type: String, default: null, trim: true },
    isPreview: { type: Boolean, default: false },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

recoveryMessageDeliverySchema.index({ idempotencyKey: 1 }, { unique: true });
recoveryMessageDeliverySchema.index({ savedQuoteId: 1, messagePurpose: 1, sequence: 1 });
recoveryMessageDeliverySchema.index({ status: 1, preparedAt: -1 });

module.exports = mongoose.model('RecoveryMessageDelivery', recoveryMessageDeliverySchema);
module.exports.MESSAGE_PURPOSES = MESSAGE_PURPOSES;
module.exports.DELIVERY_STATUSES = DELIVERY_STATUSES;
