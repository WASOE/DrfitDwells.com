const mongoose = require('mongoose');

const FLOW_VERSIONS = ['v2', 'legacy'];

const CHECKOUT_SESSION_STATUSES = [
  'draft',
  'quoted',
  'payment_required',
  'pi_active',
  'voucher_only_reserved',
  'paid',
  'abandoned',
  'expired',
  'needs_review',
  'superseded'
];

const PAYMENT_STATUSES = ['unpaid', 'processing', 'paid', 'failed', 'not_required'];

const FINALIZE_STATUSES = ['open', 'in_progress', 'finalized', 'needs_review'];

function integerNonNegativeValidator(value) {
  return Number.isInteger(value) && value >= 0;
}

const checkoutSessionSchema = new mongoose.Schema(
  {
    checkoutId: {
      type: String,
      required: [true, 'checkoutId is required'],
      trim: true,
      immutable: true
    },
    flowVersion: {
      type: String,
      enum: FLOW_VERSIONS,
      required: true,
      default: 'v2'
    },
    status: {
      type: String,
      enum: CHECKOUT_SESSION_STATUSES,
      required: true,
      default: 'draft',
      index: true
    },
    stayFingerprint: {
      type: String,
      trim: true,
      default: null
    },
    replayFingerprint: {
      type: String,
      trim: true,
      default: null
    },
    guestEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null
    },
    quoteSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    quoteSnapshotHash: {
      type: String,
      trim: true,
      default: null
    },
    canonicalPaymentIntentId: {
      type: String,
      trim: true,
      default: null
    },
    supersededPaymentIntentIds: {
      type: [String],
      default: []
    },
    voucherRedemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucherRedemption',
      default: null
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      default: 'unpaid'
    },
    finalizeStatus: {
      type: String,
      enum: FINALIZE_STATUSES,
      required: true,
      default: 'open'
    },
    confirmationEmailSentAt: {
      type: Date,
      default: null
    },
    stripeAmountCents: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'stripeAmountCents must be a non-negative integer'
      }
    },
    giftVoucherAppliedCents: {
      type: Number,
      default: 0,
      min: 0,
      validate: {
        validator: integerNonNegativeValidator,
        message: 'giftVoucherAppliedCents must be a non-negative integer'
      }
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    sessionVersion: {
      type: Number,
      default: 1,
      min: 1
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    }
  },
  { timestamps: true }
);

checkoutSessionSchema.index({ checkoutId: 1 }, { unique: true });

checkoutSessionSchema.index(
  { canonicalPaymentIntentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      canonicalPaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
    }
  }
);

checkoutSessionSchema.index({ stayFingerprint: 1, finalizeStatus: 1 });
checkoutSessionSchema.index({ guestEmail: 1, createdAt: -1 });
checkoutSessionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('CheckoutSession', checkoutSessionSchema);
module.exports.FLOW_VERSIONS = FLOW_VERSIONS;
module.exports.CHECKOUT_SESSION_STATUSES = CHECKOUT_SESSION_STATUSES;
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
module.exports.FINALIZE_STATUSES = FINALIZE_STATUSES;
