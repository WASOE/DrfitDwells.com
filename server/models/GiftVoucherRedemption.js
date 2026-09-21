const mongoose = require('mongoose');

const ATTEMPT_MARKER_FIELD = 'acquisition' + 'AttemptId';

const REDEMPTION_STATUSES = ['pending_debit', 'reserved', 'confirmed', 'released', 'voided'];
const LEDGER_PROTOCOL_VERSION_V1 = 1;

function integerValidator(value) {
  return Number.isInteger(value);
}

const AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ reservationKey: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'gvr_v1_reservationKey_unique',
    partialFilterExpression: Object.freeze({
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      reservationKey: { $type: 'string' }
    })
  }),
  note: 'Permanent v1 reservationKey uniqueness including terminal rows; tests createIndex explicitly'
});

const AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ checkoutId: 1 }),
  options: Object.freeze({
    unique: true,
    name: 'gvr_v1_checkoutId_live_unique',
    partialFilterExpression: Object.freeze({
      ledgerProtocolVersion: LEDGER_PROTOCOL_VERSION_V1,
      status: { $in: ['pending_debit', 'reserved'] },
      checkoutId: { $type: 'string' }
    })
  }),
  note: 'At most one live v1 redemption per checkoutId'
});

const AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC = Object.freeze({
  keys: Object.freeze({ [ATTEMPT_MARKER_FIELD]: 1 }),
  options: Object.freeze({
    sparse: true,
    name: ['gvr_', 'acquisition', 'AttemptId', '_sparse'].join('')
  }),
  note: 'B8F2B1B sparse lookup by acquisition attempt marker; tests createIndex explicitly'
});

const giftVoucherRedemptionSchema = new mongoose.Schema(
  {
    giftVoucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucher',
      required: true,
      index: true,
      immutable: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    reservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    checkoutId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    reservationKey: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    paymentIntentId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    amountAppliedCents: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
      validate: {
        validator: integerValidator,
        message: 'amountAppliedCents must be an integer'
      }
    },
    status: {
      type: String,
      enum: REDEMPTION_STATUSES,
      default: 'reserved',
      required: true,
      index: true
    },
    ledgerProtocolVersion: {
      type: Number,
      default: null,
      index: true,
      immutable: true,
      validate: {
        validator(value) {
          return value == null || value === LEDGER_PROTOCOL_VERSION_V1;
        },
        message: 'ledgerProtocolVersion must be null or 1'
      }
    },
    operationId: {
      type: String,
      trim: true,
      default: null,
      index: true,
      immutable: true
    },
    currency: {
      type: String,
      default: null,
      immutable: true,
      validate: {
        validator(value) {
          return value == null || value === 'EUR';
        },
        message: 'currency must be null or EUR'
      }
    },
    /**
     * B8F2B1B: attempt ownership fence on the redemption.
     * null/absent = unmarked (tokenless / sealed).
     */
    [ATTEMPT_MARKER_FIELD]: {
      type: String,
      trim: true,
      default: null,
      index: false
    },
    /** Immutable stable identity for attempt-aware v1 rows (set at create). */
    quoteSnapshotHash: {
      type: String,
      trim: true,
      default: null,
      immutable: true
    },
    /** Normalized voucher code; immutable when set. */
    voucherCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      immutable: true
    },
    reservedAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    reason: { type: String, trim: true, default: null }
  },
  { timestamps: true }
);

giftVoucherRedemptionSchema.index({ giftVoucherId: 1, status: 1 });
giftVoucherRedemptionSchema.index({ createdAt: -1 });
giftVoucherRedemptionSchema.index({ checkoutId: 1, reservationKey: 1 });
giftVoucherRedemptionSchema.index({ status: 1, expiresAt: 1 });
giftVoucherRedemptionSchema.index({ status: 1, createdAt: 1 });

giftVoucherRedemptionSchema.index(
  AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC.options }
);
giftVoucherRedemptionSchema.index(
  AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC.options }
);
giftVoucherRedemptionSchema.index(
  AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC.keys,
  { ...AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC.options }
);

giftVoucherRedemptionSchema.pre('validate', function validateV1Identity(next) {
  if (this.ledgerProtocolVersion !== LEDGER_PROTOCOL_VERSION_V1) {
    return next();
  }
  if (typeof this.reservationKey !== 'string' || !this.reservationKey.trim()) {
    return next(new Error('v1 redemption requires non-empty reservationKey'));
  }
  if (typeof this.operationId !== 'string' || !this.operationId.trim()) {
    return next(new Error('v1 redemption requires non-empty operationId'));
  }
  const expectedOperationId = `gvop:v1:${String(this._id)}`;
  if (this.operationId !== expectedOperationId) {
    return next(new Error('v1 operationId must equal gvop:v1:<redemptionId>'));
  }
  if (!Number.isInteger(this.amountAppliedCents) || this.amountAppliedCents < 1) {
    return next(new Error('v1 redemption requires positive integer amountAppliedCents'));
  }
  if (this.currency !== 'EUR') {
    return next(new Error('v1 redemption requires currency EUR'));
  }
  if (!(this.expiresAt instanceof Date) || Number.isNaN(this.expiresAt.getTime())) {
    return next(new Error('v1 redemption requires valid expiresAt'));
  }
  return next();
});

/**
 * Prevent mutating v1 reservationKey after create (legacy may still set key post-create).
 */
giftVoucherRedemptionSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function blockV1KeyMutation(next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || {};
  if (Object.prototype.hasOwnProperty.call($set, 'reservationKey') || Object.prototype.hasOwnProperty.call(update, 'reservationKey')) {
    const filter = this.getFilter() || {};
    if (filter.ledgerProtocolVersion === LEDGER_PROTOCOL_VERSION_V1) {
      return next(new Error('v1 reservationKey is immutable'));
    }
  }
  return next();
});

module.exports = mongoose.model('GiftVoucherRedemption', giftVoucherRedemptionSchema);
module.exports.GIFT_VOUCHER_REDEMPTION_STATUSES = REDEMPTION_STATUSES;
module.exports.LEDGER_PROTOCOL_VERSION_V1 = LEDGER_PROTOCOL_VERSION_V1;
module.exports.AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC =
  AUTHORITATIVE_V1_RESERVATION_KEY_INDEX_SPEC;
module.exports.AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC =
  AUTHORITATIVE_V1_LIVE_CHECKOUT_INDEX_SPEC;
module.exports.AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC =
  AUTHORITATIVE_ACQUISITION_ATTEMPT_INDEX_SPEC;
