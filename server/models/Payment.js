const mongoose = require('mongoose');

const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'failed', 'refunded', 'disputed'];

const paymentSchema = new mongoose.Schema(
  {
    reservationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true
    },
    guestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Guest',
      default: null,
      index: true
    },
    provider: {
      type: String,
      required: true,
      default: 'stripe',
      index: true
    },
    providerReference: {
      type: String,
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      required: true,
      default: 'eur'
    },
    source: {
      type: String,
      required: true,
      default: 'webhook',
      index: true
    },
    sourceReference: {
      type: String,
      default: null
    },
    importedAt: {
      type: Date,
      default: null
    },
    metadata: {
      type: Object,
      default: {}
    }
  },
  { timestamps: true }
);

paymentSchema.index({ provider: 1, providerReference: 1 }, { unique: true });

module.exports = mongoose.model('Payment', paymentSchema);
module.exports.PAYMENT_STATUSES = PAYMENT_STATUSES;
