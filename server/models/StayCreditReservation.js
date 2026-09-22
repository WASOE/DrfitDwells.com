/**
 * StayCreditReservation — durable reserve → consume → release for SP7B.
 * Quote preview must never spend. Only checkout reservation decrements balance.
 */
'use strict';

const mongoose = require('mongoose');

const STAY_CREDIT_RESERVATION_STATUSES = ['reserved', 'consumed', 'released'];

function integerPositive(v) {
  return Number.isInteger(v) && v >= 1;
}
function integerNonNegative(v) {
  return Number.isInteger(v) && v >= 0;
}

const stayCreditReservationSchema = new mongoose.Schema(
  {
    stayCreditId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StayCredit',
      required: true,
      index: true,
      immutable: true
    },
    stayCreditCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      immutable: true
    },
    checkoutSessionId: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    reservationKey: {
      type: String,
      required: true,
      trim: true,
      immutable: true
    },
    amountCents: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: integerPositive, message: 'amountCents must be a positive integer' },
      immutable: true
    },
    currency: {
      type: String,
      enum: ['EUR'],
      required: true,
      default: 'EUR',
      immutable: true
    },
    guestEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true
    },
    status: {
      type: String,
      enum: STAY_CREDIT_RESERVATION_STATUSES,
      required: true,
      default: 'reserved'
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    reservedAt: { type: Date, required: true, default: Date.now },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    releaseReason: { type: String, trim: true, default: null },
    revision: { type: Number, default: 1, min: 1 }
  },
  { timestamps: true }
);

// One live reservation per checkout.
stayCreditReservationSchema.index(
  { checkoutSessionId: 1 },
  {
    unique: true,
    name: 'stay_credit_reservation_live_checkout_unique',
    partialFilterExpression: {
      status: 'reserved',
      checkoutSessionId: { $type: 'string' }
    }
  }
);

// Idempotent resume by reservation key (includes terminal rows).
stayCreditReservationSchema.index(
  { reservationKey: 1 },
  { unique: true, name: 'stay_credit_reservation_key_unique' }
);

stayCreditReservationSchema.index(
  { status: 1, expiresAt: 1 },
  { name: 'stay_credit_reservation_expiry_scan' }
);

module.exports = mongoose.model('StayCreditReservation', stayCreditReservationSchema);
module.exports.STAY_CREDIT_RESERVATION_STATUSES = STAY_CREDIT_RESERVATION_STATUSES;
