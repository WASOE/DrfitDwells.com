const mongoose = require('mongoose');

const creatorPortalAccessSchema = new mongoose.Schema(
  {
    creatorPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreatorPartner',
      required: true,
      index: true
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 128
    },
    status: {
      type: String,
      enum: ['active', 'used', 'revoked', 'expired'],
      default: 'active',
      index: true
    },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdBy: { type: String, trim: true, default: null },
    sentToEmail: { type: String, trim: true, default: null },
    lastUsedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

creatorPortalAccessSchema.index({ creatorPartnerId: 1, status: 1 });

module.exports = mongoose.model('CreatorPortalAccess', creatorPortalAccessSchema);
