/**
 * BookingInstallment — real split-payment obligation rows (SP5).
 * Created on successful split initial payment finalize.
 * Future invoice collection is out of scope for SP5.
 */
'use strict';

const mongoose = require('mongoose');

const BOOKING_INSTALLMENT_STATUSES = ['scheduled', 'paid', 'failed', 'cancelled', 'waived'];
const BOOKING_INSTALLMENT_AMOUNT_TYPES = ['percent_bps', 'fixed_cents', 'remainder'];
const BOOKING_INSTALLMENT_DUE_RULES = [
  'checkout',
  'days_before_arrival',
  'days_after_booking'
];
const BOOKING_INSTALLMENT_CANCELLATION_TREATMENTS = [
  'standard_policy',
  'stay_credit',
  'forfeit'
];

function integerNonNegative(v) {
  return Number.isInteger(v) && v >= 0;
}
function integerPositive(v) {
  return Number.isInteger(v) && v >= 1;
}

const bookingInstallmentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    checkoutSessionId: {
      type: String,
      trim: true,
      default: null
    },
    sequence: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositive, message: 'sequence must be a positive integer' }
    },
    amountCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: integerNonNegative, message: 'amountCents must be a non-negative integer' }
    },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      default: 'EUR'
    },
    amountType: {
      type: String,
      required: true,
      enum: { values: BOOKING_INSTALLMENT_AMOUNT_TYPES, message: 'Unsupported amountType' }
    },
    dueRule: {
      type: String,
      required: true,
      enum: { values: BOOKING_INSTALLMENT_DUE_RULES, message: 'Unsupported dueRule' }
    },
    dueOffsetDays: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: integerNonNegative, message: 'dueOffsetDays must be a non-negative integer' }
    },
    dueAtDateOnly: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'dueAtDateOnly must be YYYY-MM-DD']
    },
    cancellationTreatment: {
      type: String,
      required: true,
      enum: {
        values: BOOKING_INSTALLMENT_CANCELLATION_TREATMENTS,
        message: 'Unsupported cancellationTreatment'
      }
    },
    status: {
      type: String,
      required: true,
      enum: { values: BOOKING_INSTALLMENT_STATUSES, message: 'Unsupported installment status' },
      default: 'scheduled',
      index: true
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
      default: null
    },
    stripeInvoiceId: {
      type: String,
      trim: true,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    },
    revision: {
      type: Number,
      default: 1,
      min: 1
    }
  },
  { timestamps: true }
);

bookingInstallmentSchema.index({ bookingId: 1, sequence: 1 }, { unique: true });
bookingInstallmentSchema.index(
  { stripePaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripePaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);
bookingInstallmentSchema.index(
  { stripeInvoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      stripeInvoiceId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);
bookingInstallmentSchema.index({ status: 1, dueAtDateOnly: 1 });

module.exports = mongoose.model('BookingInstallment', bookingInstallmentSchema);
module.exports.BOOKING_INSTALLMENT_STATUSES = BOOKING_INSTALLMENT_STATUSES;
module.exports.BOOKING_INSTALLMENT_AMOUNT_TYPES = BOOKING_INSTALLMENT_AMOUNT_TYPES;
module.exports.BOOKING_INSTALLMENT_DUE_RULES = BOOKING_INSTALLMENT_DUE_RULES;
module.exports.BOOKING_INSTALLMENT_CANCELLATION_TREATMENTS =
  BOOKING_INSTALLMENT_CANCELLATION_TREATMENTS;
