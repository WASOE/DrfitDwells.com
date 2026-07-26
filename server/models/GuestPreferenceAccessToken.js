'use strict';

const mongoose = require('mongoose');

/**
 * Opaque preference-access token. Raw token never stored; email never in URL.
 * Public page can only withdraw / suppress — never grant consent.
 */
const guestPreferenceAccessTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    emailNormalized: { type: String, required: true, trim: true, lowercase: true, index: true },
    purpose: {
      type: String,
      enum: ['communication_preferences'],
      default: 'communication_preferences'
    },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    savedQuoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedBookingQuote',
      default: null
    },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

guestPreferenceAccessTokenSchema.index({ emailNormalized: 1, expiresAt: -1 });

module.exports = mongoose.model('GuestPreferenceAccessToken', guestPreferenceAccessTokenSchema);
