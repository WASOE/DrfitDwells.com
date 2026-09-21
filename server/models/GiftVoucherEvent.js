const mongoose = require('mongoose');

const GIFT_VOUCHER_EVENT_TYPES = [
  'created',
  'payment_pending',
  'paid',
  'activated',
  'compensation_issued',
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
  'recipient_delivery_deferred',
  'scheduled_delivery_attempt_failed',
  'scheduled_delivery_exhausted',
  'scheduled_delivery_date_past_expiry',
  'manual_review_created',
  'card_printed'
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
giftVoucherEventSchema.index(
  { giftVoucherId: 1, type: 1, 'metadata.emailLifecycleKey': 1 },
  {
    unique: true,
    partialFilterExpression: { 'metadata.emailLifecycleKey': { $type: 'string' } }
  }
);

const AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ giftVoucherId: 1, type: 1, 'metadata.ledgerEventKey': 1 }),
  options: Object.freeze({
    unique: true,
    name: 'gve_ledgerEventKey_unique',
    partialFilterExpression: Object.freeze({
      'metadata.ledgerEventKey': { $type: 'string' }
    })
  }),
  note: 'B8F2B1A financial event idempotency for v1 ledgerEventKey'
});

giftVoucherEventSchema.index(
  AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC.options }
);

module.exports = mongoose.model('GiftVoucherEvent', giftVoucherEventSchema);
module.exports.GIFT_VOUCHER_EVENT_TYPES = GIFT_VOUCHER_EVENT_TYPES;
module.exports.AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC =
  AUTHORITATIVE_LEDGER_EVENT_KEY_INDEX_SPEC;
