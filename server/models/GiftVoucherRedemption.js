const mongoose = require('mongoose');

const REDEMPTION_STATUSES = ['reserved', 'confirmed', 'released', 'voided'];

function integerValidator(value) {
  return Number.isInteger(value);
}

const giftVoucherRedemptionSchema = new mongoose.Schema(
  {
    giftVoucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucher',
      required: true,
      index: true
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

module.exports = mongoose.model('GiftVoucherRedemption', giftVoucherRedemptionSchema);
module.exports.GIFT_VOUCHER_REDEMPTION_STATUSES = REDEMPTION_STATUSES;
