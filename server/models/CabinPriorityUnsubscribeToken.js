'use strict';

const mongoose = require('mongoose');

/**
 * Cabin-only unsubscribe access token.
 * Raw token is emailed once and never stored; only its SHA-256 hash is kept.
 */
const cabinPriorityUnsubscribeTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    emailNormalized: { type: String, required: true, trim: true, lowercase: true, index: true },
    cabinId: { type: String, required: true, default: 'the-cabin' },
    language: { type: String, enum: ['en', 'bg'], default: 'en' },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

cabinPriorityUnsubscribeTokenSchema.index({ emailNormalized: 1, cabinId: 1, expiresAt: -1 });

module.exports = mongoose.model('CabinPriorityUnsubscribeToken', cabinPriorityUnsubscribeTokenSchema);
