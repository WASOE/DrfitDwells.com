const mongoose = require('mongoose');

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
    }
  },
  { timestamps: true }
);

opsUserSchema.index({ email: 1 }, { unique: true });
opsUserSchema.index({ isActive: 1, role: 1 });

module.exports = mongoose.model('OpsUser', opsUserSchema);
module.exports.OPS_USER_ROLES = OPS_USER_ROLES;
