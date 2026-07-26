'use strict';

const mongoose = require('mongoose');
const {
  SAVED_QUOTE_STATUSES,
  SAVED_QUOTE_SCHEMA_VERSION
} = require('../services/savedQuotes/savedQuoteConstants');

const recoveryEligibilitySchema = new mongoose.Schema(
  {
    eligible: { type: Boolean, default: false },
    reason: { type: String, default: 'unknown', trim: true },
    evaluatedAt: { type: Date, default: null }
  },
  { _id: false }
);

const recoveryStateSchema = new mongoose.Schema(
  {
    sendCount: { type: Number, default: 0, min: 0 },
    lastSentAt: { type: Date, default: null },
    lastMessageType: { type: String, default: null, trim: true },
    suppressedAt: { type: Date, default: null },
    suppressionReason: { type: String, default: null, trim: true }
  },
  { _id: false }
);

const pricingSnapshotSchema = new mongoose.Schema(
  {
    baseCents: { type: Number, default: 0 },
    discountsCents: { type: Number, default: 0 },
    extrasCents: { type: Number, default: 0 },
    taxesCents: { type: Number, default: 0 },
    feesCents: { type: Number, default: 0 },
    promoCode: { type: String, default: null, trim: true },
    promoDiscountCents: { type: Number, default: 0 },
    voucherCode: { type: String, default: null, trim: true },
    voucherAppliedCents: { type: Number, default: 0 },
    remainingDueCents: { type: Number, default: 0 },
    subtotalCents: { type: Number, default: 0 },
    experienceKeys: { type: [String], default: [] },
    // Valley location buyout extensions
    locationKey: { type: String, default: null, trim: true },
    nights: { type: Number, default: null },
    lodgingSubtotalCents: { type: Number, default: null },
    priceDisclaimer: { type: String, default: null, trim: true, maxlength: 500 },
    includedTargets: { type: mongoose.Schema.Types.Mixed, default: null },
    isLocationBuyout: { type: Boolean, default: false }
  },
  { _id: false }
);

const consentSnapshotSchema = new mongoose.Schema(
  {
    quoteDeliveryRequested: { type: Boolean, default: false },
    bookingReminderConsent: { type: Boolean, default: false },
    marketingConsent: { type: Boolean, default: false },
    consentCapturedAt: { type: Date, default: null },
    consentTextVersion: { type: String, default: null, trim: true },
    quoteDeliveryTextVersion: { type: String, default: null, trim: true },
    bookingReminderTextVersion: { type: String, default: null, trim: true },
    marketingTextVersion: { type: String, default: null, trim: true }
  },
  { _id: false }
);

const attributionSchema = new mongoose.Schema(
  {
    source: { type: String, default: null, trim: true, maxlength: 120 },
    medium: { type: String, default: null, trim: true, maxlength: 120 },
    campaign: { type: String, default: null, trim: true, maxlength: 120 }
  },
  { _id: false }
);

const savedBookingQuoteSchema = new mongoose.Schema(
  {
    propertyKind: {
      type: String,
      enum: ['cabin', 'valley'],
      required: true,
      index: true
    },
    entityType: {
      type: String,
      enum: ['cabin', 'cabin_type', 'location'],
      required: true
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    locationKey: { type: String, default: null, trim: true, index: true },
    cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', default: null },
    cabinTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CabinType', default: null },
    unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, required: true },
    checkInDateOnly: { type: String, required: true, trim: true },
    checkOutDateOnly: { type: String, required: true, trim: true },
    adults: { type: Number, required: true, min: 0 },
    children: { type: Number, default: 0, min: 0 },
    quotedTotalCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR', trim: true },
    pricingSnapshot: { type: pricingSnapshotSchema, default: () => ({}) },
    quoteFingerprint: { type: String, required: true, trim: true },
    quoteVersion: { type: Number, default: SAVED_QUOTE_SCHEMA_VERSION },
    sessionKey: { type: String, default: null, trim: true },
    visitorKey: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    emailNormalized: { type: String, default: null, trim: true, lowercase: true },
    analyticsConsent: { type: Boolean, default: null },
    marketingConsent: { type: Boolean, default: false },
    quoteDeliveryRequested: { type: Boolean, default: false },
    bookingReminderConsent: { type: Boolean, default: false },
    /** @deprecated Batch 4A flag; prefer bookingReminderConsent */
    transactionalContinuationEligible: { type: Boolean, default: false },
    consentSnapshot: { type: consentSnapshotSchema, default: () => ({}) },
    checkoutId: { type: String, default: null, trim: true, index: true },
    checkoutSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckoutSession',
      default: null
    },
    /** Soft checkout expiry when known (Cabin CheckoutSession.expiresAt or hold TTL). */
    checkoutExpiresAt: { type: Date, default: null },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    locationBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LocationBooking',
      default: null
    },
    status: {
      type: String,
      enum: SAVED_QUOTE_STATUSES,
      default: 'quoted',
      index: true
    },
    recoveryEligibility: { type: recoveryEligibilitySchema, default: () => ({}) },
    recoveryState: { type: recoveryStateSchema, default: () => ({}) },
    quotedAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    checkoutStartedAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    anonymizedAt: { type: Date, default: null },
    attribution: { type: attributionSchema, default: () => ({}) },
    isTest: { type: Boolean, default: false, index: true },
    schemaVersion: { type: Number, default: SAVED_QUOTE_SCHEMA_VERSION }
  },
  { timestamps: true }
);

savedBookingQuoteSchema.index({ quoteFingerprint: 1 }, { unique: true });
savedBookingQuoteSchema.index({ propertyKind: 1, isTest: 1, quotedAt: -1 });
savedBookingQuoteSchema.index({ propertyKind: 1, status: 1, quotedAt: -1 });
savedBookingQuoteSchema.index({ propertyKind: 1, locationKey: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ cabinId: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ cabinTypeId: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ emailNormalized: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ bookingId: 1 }, { sparse: true });
savedBookingQuoteSchema.index({ locationBookingId: 1 }, { sparse: true });
savedBookingQuoteSchema.index({ checkoutId: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ expiresAt: 1, status: 1 });
savedBookingQuoteSchema.index({ sessionKey: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({ visitorKey: 1, quotedAt: -1 }, { sparse: true });
savedBookingQuoteSchema.index({
  propertyKind: 1,
  'recoveryState.suppressedAt': 1,
  quotedAt: -1
});

module.exports = mongoose.model('SavedBookingQuote', savedBookingQuoteSchema);
module.exports.SAVED_QUOTE_STATUSES = SAVED_QUOTE_STATUSES;
