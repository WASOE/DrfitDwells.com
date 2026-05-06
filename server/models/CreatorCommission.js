const mongoose = require('mongoose');

const ELIGIBILITY_STATUSES = ['eligible', 'not_eligible', 'needs_review'];
const LEDGER_STATUSES = ['pending', 'approved', 'paid', 'void'];
const ATTR_SOURCES = ['creator_promo', 'creator_referral'];

const creatorCommissionSchema = new mongoose.Schema(
  {
    creatorPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreatorPartner', required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true },

    referralCode: { type: String, default: null, trim: true, lowercase: true },
    promoCode: { type: String, default: null, trim: true, uppercase: true },
    source: { type: String, enum: ATTR_SOURCES, required: true },

    rateBpsSnapshot: { type: Number, required: true, min: 0, max: 10000 },
    commissionableRevenueSnapshot: { type: Number, required: true, min: 0 },
    amountSnapshot: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'BGN', trim: true, uppercase: true },

    bookingStatusSnapshot: { type: String, default: null, trim: true },
    paymentStatusSnapshot: { type: String, default: null, trim: true },
    eligibilityStatus: { type: String, enum: ELIGIBILITY_STATUSES, required: true, index: true },
    status: { type: String, enum: LEDGER_STATUSES, required: true, default: 'pending', index: true },

    voidReason: { type: String, default: null, trim: true },
    calculatedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    notes: { type: String, default: null, trim: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CreatorCommission', creatorCommissionSchema);
module.exports.CREATOR_COMMISSION_ELIGIBILITY_STATUSES = ELIGIBILITY_STATUSES;
module.exports.CREATOR_COMMISSION_STATUSES = LEDGER_STATUSES;
