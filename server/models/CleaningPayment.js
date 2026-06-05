const mongoose = require('mongoose');

/**
 * CleaningPayment — daily cleaning payout owed per property kind.
 *
 * One row per (date, propertyKind). `totalAmount` is auto-calculated from the
 * day's cleaning records/fees and stored for audit. `date` is a Sofia day-start
 * (UTC). Tracks how much has been paid out to cleaners for that day.
 */
const cleaningPaymentSchema = new mongoose.Schema(
  {
    // Sofia day start (UTC).
    date: {
      type: Date,
      required: true
    },
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true
    },
    // Auto-calculated, stored for audit.
    totalAmount: {
      type: Number,
      required: true
    },
    paidAmount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid'],
      default: 'pending'
    },
    markedPaidAt: {
      type: Date,
      default: null
    },
    markedPaidBy: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

cleaningPaymentSchema.index({ date: 1, propertyKind: 1 }, { unique: true });

module.exports = mongoose.model('CleaningPayment', cleaningPaymentSchema);
