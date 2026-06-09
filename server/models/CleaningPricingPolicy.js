const mongoose = require('mongoose');

const RULE_TYPES = [
  'daily_fixed',
  'quantity',
  'per_event_fixed',
  'tiered_per_event',
  'optional_addon'
];

const AMOUNT_TYPES = ['cleaner_payout', 'customer_charge'];

const ruleSelectorSchema = new mongoose.Schema(
  {
    cleaningTags: [{ type: String, trim: true }],
    cleaningCategory: { type: String, trim: true, default: null },
    cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', default: null },
    cabinTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CabinType', default: null }
  },
  { _id: false }
);

const tierSchema = new mongoose.Schema(
  {
    amountEUR: { type: Number, required: true, min: 0 }
  },
  { _id: false }
);

const pricingRuleSchema = new mongoose.Schema(
  {
    ruleKey: { type: String, required: true, trim: true },
    type: { type: String, required: true, enum: RULE_TYPES },
    label: { type: String, required: true, trim: true },
    amountEUR: { type: Number, min: 0, default: null },
    unitAmountEUR: { type: Number, min: 0, default: null },
    /** @deprecated Legacy manual-input rules; editor no longer produces these. */
    inputKey: { type: String, trim: true, default: null },
    selector: { type: ruleSelectorSchema, default: () => ({}) },
    tiers: { type: [tierSchema], default: undefined },
    amountType: {
      type: String,
      enum: AMOUNT_TYPES,
      default: 'cleaner_payout'
    },
    requiresCheckouts: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true }
  },
  { _id: false }
);

/**
 * CleaningPricingPolicy — versioned pricing rules per property kind.
 * Rules are evaluated server-side; amounts are never hardcoded in the client.
 */
const cleaningPricingPolicySchema = new mongoose.Schema(
  {
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true
    },
    version: {
      type: String,
      required: true,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: false
    },
    effectiveFrom: {
      type: Date,
      required: true
    },
    currency: {
      type: String,
      enum: ['EUR'],
      default: 'EUR'
    },
    rules: {
      type: [pricingRuleSchema],
      default: []
    }
  },
  { timestamps: true }
);

cleaningPricingPolicySchema.index({ propertyKind: 1, isActive: 1, effectiveFrom: -1 });
cleaningPricingPolicySchema.index({ propertyKind: 1, version: 1 }, { unique: true });

module.exports = mongoose.model('CleaningPricingPolicy', cleaningPricingPolicySchema);
module.exports.RULE_TYPES = RULE_TYPES;
module.exports.AMOUNT_TYPES = AMOUNT_TYPES;
