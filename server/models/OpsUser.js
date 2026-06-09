const mongoose = require('mongoose');
const {
  normalizeOpsUserPhone,
  normalizeOpsUserLocale,
  normalizePropertyKinds,
  propertyKindsForRole,
  OPS_USER_LOCALES,
  OPS_USER_PROPERTY_KINDS
} = require('../utils/opsUserContactFields');

const OPS_USER_ROLES = ['admin', 'operator', 'cleaner'];

const opsUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 320
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: OPS_USER_ROLES,
      required: true
    },
    modules: {
      type: [String],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true
    },
    tokenVersion: {
      type: Number,
      default: 1
    },
    /** E.164 when set; optional for all roles (required for cleaner notifications in later batches). */
    phone: {
      type: String,
      default: null,
      trim: true
    },
    /** Notification locale; optional. Meaningful for cleaners in later batches. */
    locale: {
      type: String,
      default: null
    },
    /**
     * propertyKind assignment (C0): cabin and/or valley. Only persisted for role cleaner;
     * cleared for admin/operator on save.
     */
    propertyKinds: {
      type: [String],
      enum: OPS_USER_PROPERTY_KINDS,
      default: []
    }
  },
  { timestamps: true }
);

opsUserSchema.pre('validate', function opsUserContactPreValidate(next) {
  const phoneResult = normalizeOpsUserPhone(this.phone);
  if (!phoneResult.ok) {
    return next(new Error(phoneResult.message));
  }
  this.phone = phoneResult.value;

  const localeResult = normalizeOpsUserLocale(this.locale);
  if (!localeResult.ok) {
    return next(new Error(localeResult.message));
  }
  this.locale = localeResult.value;

  const kindsResult = normalizePropertyKinds(this.propertyKinds);
  if (!kindsResult.ok) {
    return next(new Error(kindsResult.message));
  }
  this.propertyKinds = propertyKindsForRole(this.role, kindsResult.value);

  next();
});

opsUserSchema.index({ email: 1 }, { unique: true });
opsUserSchema.index({ isActive: 1, role: 1 });

module.exports = mongoose.model('OpsUser', opsUserSchema);
module.exports.OPS_USER_ROLES = OPS_USER_ROLES;
module.exports.OPS_USER_LOCALES = OPS_USER_LOCALES;
module.exports.OPS_USER_PROPERTY_KINDS = OPS_USER_PROPERTY_KINDS;
