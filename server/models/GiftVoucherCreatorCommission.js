const mongoose = require('mongoose');

const LEDGER_STATUSES = ['pending', 'approved', 'paid', 'voided'];
const ELIGIBILITY_STATUSES = ['pending_manual_approval', 'eligible', 'blocked'];

const ATTR_SOURCES = ['gift_voucher_referral'];

const giftVoucherCreatorCommissionSchema = new mongoose.Schema(
  {
    giftVoucherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GiftVoucher',
      required: true,
      unique: true,
      index: true
    },
    creatorPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreatorPartner',
      required: true,
      index: true
    },
    referralCode: { type: String, default: null, trim: true, lowercase: true, index: true },
    stripePaymentIntentId: { type: String, default: null, trim: true, index: true },
    amountOriginalCents: { type: Number, required: true, min: 0 },
    commissionableRevenueCents: { type: Number, required: true, min: 0 },
    commissionRateBps: { type: Number, required: true, min: 0, max: 10000 },
    commissionAmountCents: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: LEDGER_STATUSES,
      required: true,
      default: 'pending',
      index: true
    },
    eligibilityStatus: {
      type: String,
      enum: ELIGIBILITY_STATUSES,
      required: true,
      default: 'pending_manual_approval',
      index: true
    },
    source: { type: String, enum: ATTR_SOURCES, required: true, default: 'gift_voucher_referral' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

giftVoucherCreatorCommissionSchema.index({ creatorPartnerId: 1, status: 1 });

module.exports = mongoose.model('GiftVoucherCreatorCommission', giftVoucherCreatorCommissionSchema);
module.exports.GIFT_VOUCHER_CREATOR_COMMISSION_STATUSES = LEDGER_STATUSES;
module.exports.GIFT_VOUCHER_CREATOR_COMMISSION_ELIGIBILITY = ELIGIBILITY_STATUSES;
