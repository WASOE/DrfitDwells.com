/**
 * PaymentTermTemplate — versioned commercial payment-schedule definition.
 *
 * SP3 foundation only: configuration + validation. Not wired to checkout,
 * Booking schedules, Stripe collectors, or amount calculation.
 *
 * Money on legs: integer basis points (percent_bps) or integer cents (fixed_cents).
 * Every valid template ends with exactly one remainder leg (cents-balancing).
 */
'use strict';

const mongoose = require('mongoose');

const PAYMENT_TERM_STATUSES = ['draft', 'active', 'retired'];
const PAYMENT_TERM_CURRENCIES = ['EUR'];
const PAYMENT_TERM_SCHEDULE_KINDS = [
  'full',
  'percent_split',
  'fixed_deposit',
  'installment_plan'
];
const PAYMENT_TERM_AMOUNT_TYPES = ['percent_bps', 'fixed_cents', 'remainder'];
const PAYMENT_TERM_DUE_RULES = [
  'checkout',
  'days_before_arrival',
  'days_after_booking'
];

const paymentTermLegSchema = new mongoose.Schema(
  {
    sequence: {
      type: Number,
      required: [true, 'leg.sequence is required'],
      min: [1, 'leg.sequence must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'leg.sequence must be a positive integer'
      }
    },
    amountType: {
      type: String,
      required: [true, 'leg.amountType is required'],
      enum: {
        values: PAYMENT_TERM_AMOUNT_TYPES,
        message: 'Unsupported amountType'
      }
    },
    /**
     * percent_bps: integer 1..10000
     * fixed_cents: integer >= 1
     * remainder: must be null
     */
    amountValue: {
      type: Number,
      default: null,
      validate: {
        validator(v) {
          if (v == null) return true;
          return Number.isInteger(v);
        },
        message: 'leg.amountValue must be an integer or null'
      }
    },
    dueRule: {
      type: String,
      required: [true, 'leg.dueRule is required'],
      enum: {
        values: PAYMENT_TERM_DUE_RULES,
        message: 'Unsupported dueRule'
      }
    },
    dueOffsetDays: {
      type: Number,
      required: true,
      min: [0, 'leg.dueOffsetDays cannot be negative'],
      default: 0,
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'leg.dueOffsetDays must be an integer'
      }
    },
    nonRefundable: {
      type: Boolean,
      required: true,
      default: false
    }
  },
  { _id: false }
);

const paymentTermTemplateSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Payment term code is required'],
      trim: true,
      lowercase: true,
      minlength: [2, 'Code must be at least 2 characters'],
      maxlength: [80, 'Code cannot exceed 80 characters'],
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be lowercase kebab-case']
    },
    internalName: {
      type: String,
      required: [true, 'Internal name is required'],
      trim: true,
      maxlength: [160, 'Internal name cannot exceed 160 characters']
    },
    version: {
      type: Number,
      required: [true, 'Version is required'],
      min: [1, 'Version must be a positive integer'],
      validate: {
        validator(v) {
          return Number.isInteger(v);
        },
        message: 'Version must be a positive integer'
      }
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: PAYMENT_TERM_STATUSES,
        message: 'Status must be draft, active, or retired'
      },
      default: 'draft'
    },
    currency: {
      type: String,
      required: true,
      enum: {
        values: PAYMENT_TERM_CURRENCIES,
        message: 'Unsupported currency'
      },
      default: 'EUR'
    },
    scheduleKind: {
      type: String,
      required: [true, 'scheduleKind is required'],
      enum: {
        values: PAYMENT_TERM_SCHEDULE_KINDS,
        message: 'Unsupported scheduleKind'
      }
    },
    legs: {
      type: [paymentTermLegSchema],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0;
        },
        message: 'At least one payment term leg is required'
      }
    },
    allowDateTransfer: {
      type: Boolean,
      required: true,
      default: false
    },
    /**
     * Operator audit / lifecycle (aligned with RatePlan). Optional so documents
     * remain valid without management callers.
     */
    createdBy: { type: String, trim: true, default: null, maxlength: 160 },
    updatedBy: { type: String, trim: true, default: null, maxlength: 160 },
    activatedAt: { type: Date, default: null },
    activatedBy: { type: String, trim: true, default: null, maxlength: 160 },
    retiredAt: { type: Date, default: null },
    retiredBy: { type: String, trim: true, default: null, maxlength: 160 }
  },
  { timestamps: true }
);

paymentTermTemplateSchema.index({ code: 1, version: 1 }, { unique: true });
paymentTermTemplateSchema.index({ status: 1, code: 1 });

module.exports = mongoose.model('PaymentTermTemplate', paymentTermTemplateSchema);
module.exports.PAYMENT_TERM_STATUSES = PAYMENT_TERM_STATUSES;
module.exports.PAYMENT_TERM_CURRENCIES = PAYMENT_TERM_CURRENCIES;
module.exports.PAYMENT_TERM_SCHEDULE_KINDS = PAYMENT_TERM_SCHEDULE_KINDS;
module.exports.PAYMENT_TERM_AMOUNT_TYPES = PAYMENT_TERM_AMOUNT_TYPES;
module.exports.PAYMENT_TERM_DUE_RULES = PAYMENT_TERM_DUE_RULES;
