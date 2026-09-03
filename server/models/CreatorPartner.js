const mongoose = require('mongoose');

/** Slug and internal partner keys (no dots). */
const PARTNER_KEY_RE = /^[a-z0-9_-]{1,80}$/;

/** Instagram-style creator referral codes in URLs and storage (dots allowed). Hyphen last avoids ambiguity. */
const REFERRAL_CODE_RE = /^[a-z0-9_.-]{1,80}$/;

function normalizePartnerKey(raw) {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  return value || null;
}

function validatePartnerKey(value) {
  if (value == null) return true;
  return PARTNER_KEY_RE.test(String(value));
}

/**
 * Normalize referral code for storage: strip invisible chars, trim, lowercase, strip leading @ (Instagram).
 * Does not reject invalid characters; schema validator enforces REFERRAL_CODE_RE.
 */
function applyReferralCodeNormalization(raw) {
  if (raw == null) return null;
  let value = String(raw)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .trim()
    .toLowerCase();
  return value || null;
}

function validateReferralCode(value) {
  if (value == null) return true;
  return REFERRAL_CODE_RE.test(String(value));
}

/**
 * Canonical referral code for attribution payloads and booking sanitize: normalized or null if invalid.
 */
function normalizeReferralCode(raw) {
  const value = applyReferralCodeNormalization(raw);
  if (!value || !REFERRAL_CODE_RE.test(value)) return null;
  return value;
}

function validateOwnedCodesArray(arr) {
  if (arr == null) return true;
  if (!Array.isArray(arr)) return false;
  for (const item of arr) {
    if (item == null) return false;
    if (!REFERRAL_CODE_RE.test(String(item))) return false;
  }
  return true;
}

/**
 * All codes permanently owned by a partner (current + historical aliases).
 * Falls back to `[referral.code]` when ownedCodes is missing/empty so pre-backfill
 * and inert rollout behave like current-code-only.
 */
function getOwnedReferralCodes(partner) {
  const set = new Set();
  const raw = partner?.referral?.ownedCodes;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const n = normalizeReferralCode(item);
      if (n) set.add(n);
    }
  }
  const current = normalizeReferralCode(partner?.referral?.code);
  if (current) set.add(current);
  return Array.from(set);
}

/**
 * Initial ownedCodes payload for partner create (always includes current code).
 */
function buildInitialOwnedCodes(rawCode) {
  const code = normalizeReferralCode(rawCode) || applyReferralCodeNormalization(rawCode);
  return code ? [code] : [];
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
        set: applyReferralCodeNormalization,
        validate: {
          validator: validateReferralCode,
          message: 'Referral code must be Instagram-style: a-z, 0-9, ., -, _ (max 80 chars)'
        }
      },
      /**
       * Permanent set of every referral code this partner has owned (includes current).
       * Unique multikey index prevents another partner from claiming any owned code.
       */
      ownedCodes: {
        type: [String],
        default: undefined,
        validate: {
          validator: validateOwnedCodesArray,
          message: 'ownedCodes entries must be Instagram-style referral codes'
        }
      },
      cookieDays: { type: Number, default: 60, min: 1, max: 365 },
      codeChangedAt: { type: Date, default: null },
      lastCodeChangedBy: { type: String, trim: true, maxlength: 200, default: null }
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

/**
 * Keep ownedCodes ⊇ current code on validate/save paths that still mutate referral.code
 * outside the rename service (e.g. create). Does not remove historical aliases.
 */
creatorPartnerSchema.pre('validate', function ensureCurrentCodeOwned(next) {
  try {
    if (!this.referral) return next();
    const current = normalizeReferralCode(this.referral.code);
    if (!current) return next();
    const existing = Array.isArray(this.referral.ownedCodes) ? this.referral.ownedCodes.slice() : [];
    const normalizedOwned = [];
    const seen = new Set();
    for (const item of existing) {
      const n = normalizeReferralCode(item);
      if (n && !seen.has(n)) {
        seen.add(n);
        normalizedOwned.push(n);
      }
    }
    if (!seen.has(current)) normalizedOwned.push(current);
    this.referral.ownedCodes = normalizedOwned;
  } catch {
    /* leave validation to schema validators */
  }
  return next();
});

creatorPartnerSchema.index({ slug: 1 }, { unique: true });
creatorPartnerSchema.index({ 'referral.code': 1 }, { unique: true });
creatorPartnerSchema.index({ 'referral.ownedCodes': 1 }, { unique: true });

module.exports = mongoose.model('CreatorPartner', creatorPartnerSchema);
module.exports.normalizePartnerKey = normalizePartnerKey;
module.exports.PARTNER_KEY_RE = PARTNER_KEY_RE;
module.exports.applyReferralCodeNormalization = applyReferralCodeNormalization;
module.exports.normalizeReferralCode = normalizeReferralCode;
module.exports.REFERRAL_CODE_RE = REFERRAL_CODE_RE;
module.exports.getOwnedReferralCodes = getOwnedReferralCodes;
module.exports.buildInitialOwnedCodes = buildInitialOwnedCodes;
