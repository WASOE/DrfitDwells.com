'use strict';

const mongoose = require('mongoose');

/**
 * Opaque continuation token → SavedBookingQuote.
 * No sessionKey/visitorKey in URL or token payload.
 */
const recoveryContinuationTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    savedQuoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedBookingQuote',
      required: true,
      index: true
    },
    propertyKind: { type: String, enum: ['cabin', 'valley'], required: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0, min: 0 },
    lastOpenedAt: { type: Date, default: null },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

module.exports = mongoose.model('RecoveryContinuationToken', recoveryContinuationTokenSchema);
