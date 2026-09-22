/**
 * StayCredit — customer-specific reservation-payment stay credit (SP7).
 * Not a gift-voucher product. Cannot be cash-refunded through the app.
 */
'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const STAY_CREDIT_STATUSES = ['active', 'partially_redeemed', 'redeemed', 'voided'];
const STAY_CREDIT_CURRENCIES = ['EUR'];

function integerNonNegative(v) {
  return Number.isInteger(v) && v >= 0;
}
function integerPositive(v) {
  return Number.isInteger(v) && v >= 1;
}

const redemptionSchema = new mongoose.Schema(
  {
    redemptionKey: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositive, message: 'amountCents must be a positive integer' }
    },
    currency: {
      type: String,
      enum: STAY_CREDIT_CURRENCIES,
      required: true,
      default: 'EUR',
      immutable: true
    },
    checkoutSessionId: { type: String, trim: true, default: null },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null
    },
    redeemedAt: { type: Date, required: true, default: Date.now },
    actorId: { type: String, trim: true, default: null }
  },
  { _id: true }
);

const stayCreditSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true
    },
    originBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true
    },
    originInstallmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookingInstallment',
      required: true,
      index: true
    },
    originInstallmentSequence: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositive, message: 'originInstallmentSequence must be positive' }
    },
    guestEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true
    },
    currency: {
      type: String,
      enum: STAY_CREDIT_CURRENCIES,
      required: true,
      default: 'EUR'
    },
    issuedCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositive, message: 'issuedCents must be a positive integer' }
    },
    remainingCents: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: integerNonNegative, message: 'remainingCents must be non-negative' }
    },
    status: {
      type: String,
      enum: STAY_CREDIT_STATUSES,
      required: true,
      default: 'active',
      index: true
    },
    issuedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, default: null },
    issuanceIdempotencyKey: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      immutable: true
    },
    cashConvertible: {
      type: Boolean,
      required: true,
      default: false,
      immutable: true
    },
    redemptions: { type: [redemptionSchema], default: [] },
    revision: { type: Number, default: 1, min: 1 }
  },
  { timestamps: true }
);

stayCreditSchema.index({ originBookingId: 1, originInstallmentId: 1 }, { unique: true });

stayCreditSchema.statics.generateCode = function generateCode() {
  return `SC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
};

module.exports = mongoose.model('StayCredit', stayCreditSchema);
module.exports.STAY_CREDIT_STATUSES = STAY_CREDIT_STATUSES;
module.exports.STAY_CREDIT_CURRENCIES = STAY_CREDIT_CURRENCIES;
