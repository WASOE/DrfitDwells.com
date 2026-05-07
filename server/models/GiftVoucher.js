const mongoose = require('mongoose');

const VOUCHER_STATUSES = [
  'draft',
  'pending_payment',
  'active',
  'partially_redeemed',
  'redeemed',
  'expired',
  'voided',
  'refunded'
];

const DELIVERY_MODES = ['email', 'postal', 'manual'];

function isIntegerNumber(value) {
  return Number.isInteger(value);
}

function integerValidator(value) {
  if (value == null) return false;
  return isIntegerNumber(value);
}

const attributionSchema = new mongoose.Schema(
  {
    referralCode: { type: String, trim: true, lowercase: true, default: null },
    creatorPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreatorPartner', default: null, index: true },
    landingPath: { type: String, trim: true, default: null },
    utmSource: { type: String, trim: true, default: null },
    utmMedium: { type: String, trim: true, default: null },
    utmCampaign: { type: String, trim: true, default: null },
    utmTerm: { type: String, trim: true, default: null },
    utmContent: { type: String, trim: true, default: null }
  },
  { _id: false }
);

const deliveryAddressSchema = new mongoose.Schema(
  {
    addressLine1: { type: String, trim: true, default: null },
    addressLine2: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    postalCode: { type: String, trim: true, default: null },
    country: { type: String, trim: true, default: null }
  },
  { _id: false }
);

const giftVoucherSchema = new mongoose.Schema(
  {
    code: { type: String, default: null, trim: true, uppercase: true },
    amountOriginalCents: {
      type: Number,
      required: true,
      min: 1500,
      validate: {
        validator: integerValidator,
        message: 'amountOriginalCents must be an integer'
      }
    },
    balanceRemainingCents: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: integerValidator,
        message: 'balanceRemainingCents must be an integer'
      }
    },
    currency: {
      type: String,
      enum: ['EUR'],
      default: 'EUR',
      required: true
    },
    status: {
      type: String,
      enum: VOUCHER_STATUSES,
      default: 'draft',
      required: true,
      index: true
    },
    buyerName: { type: String, trim: true, default: null },
    buyerEmail: { type: String, trim: true, lowercase: true, default: null, index: true },
    recipientName: { type: String, trim: true, default: null },
    recipientEmail: { type: String, trim: true, lowercase: true, default: null, index: true },
    message: { type: String, trim: true, default: null },
    deliveryMode: { type: String, enum: DELIVERY_MODES, default: 'email' },
    deliveryAddress: { type: deliveryAddressSchema, default: undefined },
    deliveryDate: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    purchaseRequestId: { type: String, trim: true, default: null, index: true },
    purchaseFingerprint: { type: String, trim: true, default: null, index: true },
    termsAcceptedAt: { type: Date, default: null },
    termsVersion: { type: String, trim: true, default: null },
    stripePaymentIntentId: { type: String, trim: true, default: null, index: true },
    stripeCheckoutSessionId: { type: String, trim: true, default: null },
    stripeEventIdsProcessed: { type: [String], default: [] },
    activatedAt: { type: Date, default: null },
    attribution: { type: attributionSchema, default: undefined }
  },
  { timestamps: true }
);

giftVoucherSchema.pre('validate', function validateBalance(next) {
  if (!isIntegerNumber(this.amountOriginalCents)) {
    return next(new Error('amountOriginalCents must be an integer'));
  }
  if (!isIntegerNumber(this.balanceRemainingCents)) {
    return next(new Error('balanceRemainingCents must be an integer'));
  }
  if (this.amountOriginalCents < 1500) {
    return next(new Error('amountOriginalCents must be at least 1500'));
  }
  if (this.balanceRemainingCents < 0) {
    return next(new Error('balanceRemainingCents cannot be negative'));
  }
  if (this.balanceRemainingCents > this.amountOriginalCents) {
    return next(new Error('balanceRemainingCents cannot exceed amountOriginalCents'));
  }
  if (this.deliveryMode === 'email' && !this.recipientEmail) {
    return next(new Error('recipientEmail is required for email delivery mode'));
  }
  if (this.deliveryMode === 'postal') {
    const address = this.deliveryAddress || {};
    if (!this.recipientName) {
      return next(new Error('recipientName is required for postal delivery mode'));
    }
    if (!address.addressLine1 || !address.city || !address.postalCode || !address.country) {
      return next(new Error('deliveryAddress.addressLine1, city, postalCode and country are required for postal delivery mode'));
    }
  }
  return next();
});

giftVoucherSchema.index(
  { code: 1 },
  {
    unique: true,
    partialFilterExpression: { code: { $type: 'string' } }
  }
);
giftVoucherSchema.index({ status: 1, createdAt: -1 });
giftVoucherSchema.index({ 'attribution.referralCode': 1 });

module.exports = mongoose.model('GiftVoucher', giftVoucherSchema);
module.exports.GIFT_VOUCHER_STATUSES = VOUCHER_STATUSES;
module.exports.GIFT_VOUCHER_DELIVERY_MODES = DELIVERY_MODES;
