const mongoose = require('mongoose');
const {
  PAID_BOOKING_FINALIZATION_STAGES
} = require('../services/payments/paidBookingFinalizationStages');

const ISSUE_STATUSES = ['needs_review', 'resolved', 'refunded', 'booking_created', 'void'];
const ISSUE_TYPES = ['paid_booking_conflict', 'paid_booking_save_failed', 'paid_booking_unknown_failure'];

/** Bounded per-PaymentIntent failure trail (Batch 1). Latest entry is also mirrored on top-level fields. */
const FAILURE_HISTORY_ENTRY_SCHEMA = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    finalizationStage: { type: String, default: null, trim: true },
    issueType: { type: String, default: null, trim: true },
    errorCode: { type: String, default: null, trim: true },
    errorSummary: { type: String, default: null, trim: true },
    failureSource: { type: String, default: null, trim: true },
    bookingId: { type: String, default: null, trim: true }
  },
  { _id: false }
);

const paymentResolutionIssueSchema = new mongoose.Schema(
  {
    paymentIntentId: { type: String, required: true, index: true, unique: true, trim: true },
    status: { type: String, enum: ISSUE_STATUSES, default: 'needs_review', index: true },
    issueType: { type: String, enum: ISSUE_TYPES, required: true, index: true },
    amount: { type: Number, default: null },
    currency: { type: String, default: null, trim: true },
    guest: {
      name: { type: String, default: null, trim: true },
      email: { type: String, default: null, trim: true, lowercase: true },
      phone: { type: String, default: null, trim: true }
    },
    bookingAttempt: {
      entityType: { type: String, default: null, trim: true },
      cabinId: { type: String, default: null, trim: true },
      cabinTypeId: { type: String, default: null, trim: true },
      checkIn: { type: Date, default: null },
      checkOut: { type: Date, default: null },
      guests: { type: Number, default: null },
      promoCode: { type: String, default: null, trim: true }
    },
    attribution: { type: Object, default: {} },
    errorSummary: { type: String, default: null, trim: true },
    errorCode: { type: String, default: null, trim: true },
    /** Batch 1 observability — optional / backward compatible. Stage values controlled in app code. */
    checkoutId: { type: String, default: null, trim: true, index: true },
    finalizationStage: { type: String, default: null, trim: true, index: true },
    occurrenceCount: { type: Number, default: 1, min: 0 },
    firstFailedAt: { type: Date, default: null, index: true },
    lastFailedAt: { type: Date, default: null, index: true },
    failureHistory: { type: [FAILURE_HISTORY_ENTRY_SCHEMA], default: [] },
    metadata: { type: Object, default: {} },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null, trim: true }
  },
  { timestamps: true }
);

paymentResolutionIssueSchema.index({ checkoutId: 1, lastFailedAt: -1 }, { sparse: true });
paymentResolutionIssueSchema.index({ finalizationStage: 1, status: 1, lastFailedAt: -1 });

module.exports = mongoose.model('PaymentResolutionIssue', paymentResolutionIssueSchema);
module.exports.PAYMENT_RESOLUTION_ISSUE_STATUSES = ISSUE_STATUSES;
module.exports.PAYMENT_RESOLUTION_ISSUE_TYPES = ISSUE_TYPES;
module.exports.PAID_BOOKING_FINALIZATION_STAGES = PAID_BOOKING_FINALIZATION_STAGES;
module.exports.FAILURE_HISTORY_MAX_ENTRIES = 10;
