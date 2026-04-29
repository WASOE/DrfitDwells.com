const mongoose = require('mongoose');

const ISSUE_STATUSES = ['needs_review', 'resolved', 'refunded', 'booking_created', 'void'];
const ISSUE_TYPES = ['paid_booking_conflict', 'paid_booking_save_failed', 'paid_booking_unknown_failure'];

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
    metadata: { type: Object, default: {} },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: null, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentResolutionIssue', paymentResolutionIssueSchema);
module.exports.PAYMENT_RESOLUTION_ISSUE_STATUSES = ISSUE_STATUSES;
module.exports.PAYMENT_RESOLUTION_ISSUE_TYPES = ISSUE_TYPES;
