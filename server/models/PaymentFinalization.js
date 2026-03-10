/**
 * Tracks payment finalization failures and refund state.
 * Used when payment succeeded but booking creation failed (e.g. availability conflict).
 *
 * Status semantics (mutually exclusive, strict):
 * - finalization_failed: booking creation failed; refund not yet requested
 * - refund_pending: refund requested via Stripe API, awaiting confirmation
 * - refunded: confirmed by Stripe (webhook or immediate API response)
 * - refund_failed: Stripe refund API failed; requires manual action
 */
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  paymentIntentId: {
    type: String,
    required: true,
    unique: true
  },
  cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', required: true },
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  amountCents: { type: Number, required: true },
  currency: { type: String, default: 'eur' },

  status: {
    type: String,
    enum: ['finalization_failed', 'refund_pending', 'refunded', 'refund_failed'],
    default: 'finalization_failed' // booking creation failed; refund not yet requested
  },
  stripeRefundId: { type: String, trim: true },

  guestEmail: { type: String, required: true },
  guestName: { type: String, trim: true },

  failureReason: { type: String, trim: true },
  refundError: { type: String, trim: true },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

schema.index({ status: 1 });
schema.index({ createdAt: 1 });

module.exports = mongoose.model('PaymentFinalization', schema);
