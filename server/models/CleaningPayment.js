const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema(
  {
    ruleKey: { type: String, trim: true, default: null },
    label: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: null },
    quantity: { type: Number, default: 1, min: 0 },
    unitAmountEUR: { type: Number, default: null, min: 0 },
    amountEUR: { type: Number, required: true, min: 0 },
    bookingId: { type: String, trim: true, default: null },
    cabinName: { type: String, trim: true, default: null },
    source: {
      type: String,
      enum: ['policy', 'legacy', 'manual'],
      default: 'policy'
    },
    amountType: {
      type: String,
      enum: ['cleaner_payout', 'customer_charge'],
      default: 'cleaner_payout'
    },
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      default: null
    },
    // Audit fields for source='manual' items only.
    addedAt: { type: Date },
    addedBy: { type: String, trim: true }
  },
  { _id: false }
);

const paidSnapshotHistorySchema = new mongoose.Schema(
  {
    currency: { type: String, default: 'EUR' },
    totalAmount: { type: Number, required: true },
    paidAmount: { type: Number, default: 0 },
    lineItems: { type: [lineItemSchema], default: [] },
    pricingPolicyId: { type: mongoose.Schema.Types.ObjectId, ref: 'CleaningPricingPolicy', default: null },
    pricingVersion: { type: String, trim: true, default: null },
    calculatedAt: { type: Date, default: null },
    markedPaidAt: { type: Date, default: null },
    markedPaidBy: { type: String, default: null },
    unmarkedAt: { type: Date, required: true },
    unmarkedBy: { type: String, default: null }
  },
  { _id: false }
);

function hasUniqueRuleKeys(items) {
  const keys = (items || []).map((item) => item?.ruleKey).filter(Boolean);
  return new Set(keys).size === keys.length;
}

/**
 * CleaningPayment — daily cleaning payout owed per property kind.
 *
 * One row per (date, propertyKind). All amounts are in EUR. `totalAmount` is
 * calculated from pricing rules and stored for audit. When marked paid, line
 * items are snapshotted so future rule changes do not rewrite history.
 * `manualLineItems` hold OPS-added items (e.g. deep cleaning) that survive
 * recalculation; they are merged into `lineItems` when the day is marked paid.
 * Unmarking archives the paid snapshot into `paidSnapshotHistory`.
 * `date` is a Sofia day-start (UTC).
 */
const cleaningPaymentSchema = new mongoose.Schema(
  {
    // Sofia day start (UTC).
    date: {
      type: Date,
      required: true
    },
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true
    },
    currency: {
      type: String,
      enum: ['EUR'],
      default: 'EUR'
    },
    // Calculated total; frozen on mark-paid.
    totalAmount: {
      type: Number,
      required: true
    },
    paidAmount: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ['pending', 'partial', 'paid'],
      default: 'pending'
    },
    lineItems: {
      type: [lineItemSchema],
      default: []
    },
    manualLineItems: {
      type: [lineItemSchema],
      default: [],
      validate: {
        validator: hasUniqueRuleKeys,
        message: 'manualLineItems must not contain duplicate ruleKey values.'
      }
    },
    paidSnapshotHistory: {
      type: [paidSnapshotHistorySchema],
      default: []
    },
    /** @deprecated Legacy manual day-sheet inputs; no longer written. Kept for old documents. */
    inputsSnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    pricingPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CleaningPricingPolicy',
      default: null
    },
    pricingVersion: {
      type: String,
      trim: true,
      default: null
    },
    calculatedAt: {
      type: Date,
      default: null
    },
    markedPaidAt: {
      type: Date,
      default: null
    },
    markedPaidBy: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

cleaningPaymentSchema.index({ date: 1, propertyKind: 1 }, { unique: true });

module.exports = mongoose.model('CleaningPayment', cleaningPaymentSchema);
