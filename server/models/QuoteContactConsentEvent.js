'use strict';

const mongoose = require('mongoose');
const { CONSENT_TYPES } = require('../services/savedQuotes/savedQuoteConstants');

/**
 * Append-only audit trail for quote delivery / booking reminder / marketing
 * consent captured at checkout. Mutable current preference lives on
 * GuestContactPreference (+ SavedBookingQuote snapshot for journey display).
 */
const quoteContactConsentEventSchema = new mongoose.Schema(
  {
    consentType: {
      type: String,
      enum: CONSENT_TYPES,
      required: true,
      index: true
    },
    granted: { type: Boolean, required: true },
    textVersion: { type: String, required: true, trim: true },
    textSnapshot: { type: String, required: true, trim: true, maxlength: 2000 },
    capturedAt: { type: Date, required: true, default: Date.now, index: true },
    sourceSurface: {
      type: String,
      enum: [
        'confirm_booking',
        'valley_checkout',
        'ops_manual',
        'withdrawal',
        'system'
      ],
      required: true
    },
    emailNormalized: { type: String, required: true, trim: true, lowercase: true, index: true },
    savedQuoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SavedBookingQuote',
      default: null,
      index: true
    },
    checkoutSessionId: { type: String, default: null, trim: true },
    checkoutSessionObjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      default: null
    },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    locationBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LocationBooking',
      default: null
    },
    propertyKind: { type: String, enum: ['cabin', 'valley'], default: null },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: true }
);

quoteContactConsentEventSchema.index({ emailNormalized: 1, consentType: 1, capturedAt: -1 });

module.exports = mongoose.model('QuoteContactConsentEvent', quoteContactConsentEventSchema);
