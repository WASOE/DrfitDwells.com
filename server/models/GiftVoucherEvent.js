const mongoose = require('mongoose');

const GIFT_VOUCHER_EVENT_TYPES = [
  'created',
  'payment_pending',
  'paid',
  'activated',
  'send_attempted',
  'sent',
  'send_failed',
  'resent',
  'redeemed_reserved',
  'redeemed_confirmed',
  'redeemed_released',
  'adjusted',
  'voided',
  'expired',
  'refunded',
  'expiry_extended',
  'recipient_email_updated',
  'manual_review_created'
];

function integerOrNull(value) {
  return value == null || Number.isInteger(value);
}

const giftVoucherEventSchema = new mongoose.Schema(
  {
    giftVoucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucher',
      required: true,
      immutable: true,
      index: true
    },
    type: {
      type: String,
      enum: GIFT_VOUCHER_EVENT_TYPES,
      required: true,
      immutable: true,
      index: true
    },
    actor: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    note: {
      type: String,
      default: null,
      trim: true,
      immutable: true
    },
    previousBalanceCents: {
      type: Number,
      default: null,
      immutable: true,
      validate: {
        validator: integerOrNull,
        message: 'previousBalanceCents must be an integer when provided'
      }
    },
    newBalanceCents: {
      type: Number,
      default: null,
      immutable: true,
      validate: {
        validator: integerOrNull,
        message: 'newBalanceCents must be an integer when provided'
      }
    },
    deltaCents: {
      type: Number,
      default: null,
      immutable: true,
      validate: {
        validator: integerOrNull,
        message: 'deltaCents must be an integer when provided'
      }
    },
    metadata: {
      type: Object,
      default: {},
      immutable: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true
    }
  },
  { versionKey: false }
);

giftVoucherEventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function rejectUpdates(next) {
  next(new Error('GiftVoucherEvent history is append-only and immutable'));
});
giftVoucherEventSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete', 'findByIdAndDelete'], function rejectDeletes(next) {
  next(new Error('GiftVoucherEvent history is append-only and immutable'));
});

giftVoucherEventSchema.index({ giftVoucherId: 1, createdAt: -1 });
giftVoucherEventSchema.index({ giftVoucherId: 1, type: 1, createdAt: -1 });
giftVoucherEventSchema.index(
  { giftVoucherId: 1, type: 1, 'metadata.stripeEventId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'metadata.stripeEventId': { $type: 'string' } }
  }
);
giftVoucherEventSchema.index(
  { giftVoucherId: 1, type: 1, 'metadata.paymentIntentId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'metadata.paymentIntentId': { $type: 'string' } }
  }
);

module.exports = mongoose.model('GiftVoucherEvent', giftVoucherEventSchema);
module.exports.GIFT_VOUCHER_EVENT_TYPES = GIFT_VOUCHER_EVENT_TYPES;
