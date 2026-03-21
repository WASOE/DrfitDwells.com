const mongoose = require('mongoose');

const PAYOUT_STATUSES = ['pending', 'paid', 'failed', 'reconciliation_completed'];

const payoutSchema = new mongoose.Schema(
  {
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
      enum: PAYOUT_STATUSES,
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
    expectedArrivalDate: {
      type: Date,
      default: null
    },
    paidAt: {
      type: Date,
      default: null
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

payoutSchema.index({ provider: 1, providerReference: 1 }, { unique: true });

module.exports = mongoose.model('Payout', payoutSchema);
module.exports.PAYOUT_STATUSES = PAYOUT_STATUSES;
