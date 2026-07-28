const mongoose = require('mongoose');

/**
 * Durable email delivery state.
 * Batch 6 extends booking-confirmation lifecycle with pending/sending/succeeded/ambiguous
 * while preserving legacy success|failed|skipped for existing applyEmailDeliveryAttempt callers.
 */

const LEGACY_STATUSES = ['success', 'failed', 'skipped'];
const CONFIRMATION_STATUSES = ['pending', 'sending', 'succeeded', 'ambiguous'];
const ALL_STATUSES = [...new Set([...LEGACY_STATUSES, ...CONFIRMATION_STATUSES])];

const FAILURE_HISTORY_MAX = 10;

const failureHistoryEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    errorCode: { type: String, default: null },
    errorSummary: { type: String, maxlength: 500, default: null },
    attemptCount: { type: Number, default: null },
    stage: { type: String, default: null }
  },
  { _id: false }
);

const EmailDeliveryStateSchema = new mongoose.Schema(
  {
    correlationKey: { type: String, required: true, unique: true, index: true },
    domain: { type: String, enum: ['booking_lifecycle', 'gift_voucher'], required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', index: true },
    giftVoucherId: { type: mongoose.Schema.Types.ObjectId, ref: 'GiftVoucher', index: true },
    checkoutId: { type: String, trim: true, default: null, index: true },
    templateKey: { type: String, index: true },
    templateKind: { type: String, index: true },
    recipient: { type: String, required: true, index: true },
    latestStatus: {
      type: String,
      enum: ALL_STATUSES,
      required: true,
      index: true
    },
    latestEventAt: { type: Date, required: true, index: true },
    latestEmailEventId: { type: mongoose.Schema.Types.ObjectId, ref: 'EmailEvent' },
    latestLifecycleSource: { type: String, enum: ['automatic', 'manual_resend'], index: true },
    latestErrorMessage: { type: String },
    resolvedAt: { type: Date },
    resolvedBy: { type: String },
    resolutionNote: { type: String },

    /** Batch 6 confirmation lease / retry */
    attemptCount: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 10, min: 1 },
    claimedBy: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    visibilityTimeoutAt: { type: Date, default: null },
    nextAttemptAt: { type: Date, default: null, index: true },
    smtpAttemptStartedAt: { type: Date, default: null },
    providerMessageId: { type: String, default: null, maxlength: 500 },
    ambiguousAt: { type: Date, default: null },
    ambiguousReason: { type: String, default: null, maxlength: 500 },
    failureHistory: { type: [failureHistoryEntrySchema], default: [] },
    lastErrorCode: { type: String, default: null }
  },
  { timestamps: true }
);

EmailDeliveryStateSchema.index({ latestStatus: 1, latestEventAt: -1 });
EmailDeliveryStateSchema.index({ latestStatus: 1, visibilityTimeoutAt: 1 });
EmailDeliveryStateSchema.index({ latestStatus: 1, nextAttemptAt: 1 });
EmailDeliveryStateSchema.index({ bookingId: 1, templateKey: 1 });

module.exports = mongoose.model('EmailDeliveryState', EmailDeliveryStateSchema);
module.exports.EMAIL_DELIVERY_STATUSES = Object.freeze(ALL_STATUSES);
module.exports.CONFIRMATION_DELIVERY_STATUSES = Object.freeze(CONFIRMATION_STATUSES);
module.exports.FAILURE_HISTORY_MAX = FAILURE_HISTORY_MAX;
module.exports.isDefinitiveSentStatus = function isDefinitiveSentStatus(status) {
  return status === 'success' || status === 'succeeded';
};
