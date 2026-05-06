const mongoose = require('mongoose');

const creatorReferralVisitSchema = new mongoose.Schema(
  {
    creatorPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreatorPartner', default: null, index: true },
    referralCode: { type: String, required: true, trim: true, lowercase: true, index: true },
    landingPath: { type: String, default: null, trim: true },
    referrer: { type: String, default: null, trim: true },
    visitorKey: { type: String, default: null, trim: true, index: true },
    sessionKey: { type: String, default: null, trim: true, index: true },
    dayBucket: { type: String, required: true, trim: true, index: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    visitCount: { type: Number, default: 1, min: 1 }
  },
  { timestamps: true }
);

creatorReferralVisitSchema.index({ referralCode: 1, visitorKey: 1, dayBucket: 1 }, { unique: true, sparse: true });
creatorReferralVisitSchema.index({ referralCode: 1, sessionKey: 1, dayBucket: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('CreatorReferralVisit', creatorReferralVisitSchema);
