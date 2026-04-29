const mongoose = require('mongoose');

const PARTNER_KEY_RE = /^[a-z0-9_-]{1,80}$/;

function normalizePartnerKey(raw) {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  return value || null;
}

function validatePartnerKey(value) {
  if (value == null) return true;
  return PARTNER_KEY_RE.test(String(value));
}

const creatorPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: {
      type: String,
      required: true,
      trim: true,
      set: normalizePartnerKey,
      validate: {
        validator: validatePartnerKey,
        message: 'Slug must contain only a-z, 0-9, - or _ (max 80 chars)'
      }
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'paused', 'archived'],
      default: 'draft',
      index: true
    },
    contact: {
      email: { type: String, trim: true, lowercase: true, default: null },
      phone: { type: String, trim: true, default: null }
    },
    profiles: {
      instagram: { type: String, trim: true, default: null },
      tiktok: { type: String, trim: true, default: null },
      youtube: { type: String, trim: true, default: null },
      website: { type: String, trim: true, default: null }
    },
    referral: {
      code: {
        type: String,
        required: true,
        trim: true,
        set: normalizePartnerKey,
        validate: {
          validator: validatePartnerKey,
          message: 'Referral code must contain only a-z, 0-9, - or _ (max 80 chars)'
        }
      },
      cookieDays: { type: Number, default: 60, min: 1, max: 365 }
    },
    promo: {
      code: { type: String, trim: true, uppercase: true, default: null },
      promoCodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'PromoCode', default: null }
    },
    commission: {
      rateBps: { type: Number, default: 1000, min: 0, max: 10000 },
      basis: { type: String, enum: ['accommodation_net'], default: 'accommodation_net' },
      eligibleAfter: { type: String, enum: ['stay_completed', 'manual_approval'], default: 'stay_completed' }
    },
    contentAgreement: {
      compStayOffered: { type: Boolean, default: false },
      deliverables: { type: String, trim: true, default: null },
      usageRights: { type: String, trim: true, default: null },
      agreedAt: { type: Date, default: null }
    },
    notes: { type: String, trim: true, default: null },
    createdBy: { type: String, trim: true, default: null },
    updatedBy: { type: String, trim: true, default: null }
  },
  { timestamps: true }
);

creatorPartnerSchema.index({ slug: 1 }, { unique: true });
creatorPartnerSchema.index({ 'referral.code': 1 }, { unique: true });

module.exports = mongoose.model('CreatorPartner', creatorPartnerSchema);
module.exports.normalizePartnerKey = normalizePartnerKey;
module.exports.PARTNER_KEY_RE = PARTNER_KEY_RE;
