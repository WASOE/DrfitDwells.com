'use strict';

const mongoose = require('mongoose');
const {
  ALL_EVENT_TYPES,
  QUOTE_FAILURE_CLASSES,
  PROPERTY_KINDS,
  FUNNEL_STAGES
} = require('../services/conversion/funnelEventConstants');

const attributionSchema = new mongoose.Schema(
  {
    utmSource: { type: String, trim: true, default: undefined },
    utmMedium: { type: String, trim: true, default: undefined },
    utmCampaign: { type: String, trim: true, default: undefined },
    utmTerm: { type: String, trim: true, default: undefined },
    utmContent: { type: String, trim: true, default: undefined },
    gclid: { type: String, trim: true, default: undefined },
    fbclid: { type: String, trim: true, default: undefined },
    msclkid: { type: String, trim: true, default: undefined },
    referrer: { type: String, trim: true, default: undefined },
    landingPath: { type: String, trim: true, default: undefined },
    referralCode: { type: String, trim: true, default: undefined },
    referringDomain: { type: String, trim: true, default: undefined },
    source: { type: String, trim: true, default: undefined },
    medium: { type: String, trim: true, default: undefined },
    campaign: { type: String, trim: true, default: undefined },
    term: { type: String, trim: true, default: undefined },
    content: { type: String, trim: true, default: undefined }
  },
  { _id: false }
);

const bookingFunnelEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, trim: true },
    eventType: {
      type: String,
      required: true,
      enum: ALL_EVENT_TYPES,
      index: true
    },
    canonicalEventName: { type: String, trim: true, default: null, index: true },
    eventSource: {
      type: String,
      enum: ['client', 'server'],
      default: null
    },
    /** @deprecated use eventSource; kept for legacy rows */
    source: {
      type: String,
      required: true,
      enum: ['client', 'server']
    },
    verificationStatus: {
      type: String,
      enum: ['behavioural', 'server_verified'],
      default: 'behavioural'
    },
    origin: {
      type: String,
      enum: ['web', 'api', 'webhook', 'internal'],
      default: 'web'
    },
    dedupeKey: {
      type: String,
      required: true,
      trim: true
    },
    sessionKey: { type: String, trim: true, default: null },
    visitorKey: { type: String, trim: true, default: null },
    anonymousId: { type: String, trim: true, default: null },
    propertyKind: { type: String, enum: PROPERTY_KINDS, default: null },
    cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', default: null },
    cabinTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CabinType', default: null },
    unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
    locationId: { type: String, trim: true, default: null },
    checkInDateOnly: { type: String, trim: true, default: null },
    checkOutDateOnly: { type: String, trim: true, default: null },
    nights: { type: Number, default: null, min: 0 },
    adults: { type: Number, default: null, min: 0 },
    children: { type: Number, default: null, min: 0 },
    pets: { type: Number, default: null, min: 0 },
    selectedExtras: { type: mongoose.Schema.Types.Mixed, default: undefined },
    priceShownCents: { type: Number, default: null, min: 0 },
    quotedSubtotalCents: { type: Number, default: null, min: 0 },
    quotedDiscountCents: { type: Number, default: null, min: 0 },
    quotedTotalCents: { type: Number, default: null, min: 0 },
    currency: { type: String, trim: true, default: 'EUR' },
    availabilityResult: { type: String, trim: true, default: null },
    unavailableReason: { type: String, trim: true, default: null },
    quoteFailureClass: { type: String, enum: [...QUOTE_FAILURE_CLASSES, null], default: null },
    attribution: { type: attributionSchema, default: undefined },
    firstTouch: { type: attributionSchema, default: undefined },
    lastTouch: { type: attributionSchema, default: undefined },
    convertedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    quoteId: { type: String, trim: true, default: null },
    checkoutId: { type: String, trim: true, default: null },
    paymentId: { type: String, trim: true, default: null },
    searchResultCount: { type: Number, default: null, min: 0 },
    funnelStage: { type: String, enum: [...FUNNEL_STAGES, null], default: null },
    previousEventName: { type: String, trim: true, default: null },
    pagePath: { type: String, trim: true, default: null },
    pageTitle: { type: String, trim: true, default: null },
    routeName: { type: String, trim: true, default: null },
    landingPage: { type: String, trim: true, default: null },
    referrer: { type: String, trim: true, default: null },
    deviceCategory: { type: String, trim: true, default: null },
    browserFamily: { type: String, trim: true, default: null },
    osFamily: { type: String, trim: true, default: null },
    screenCategory: { type: String, trim: true, default: null },
    language: { type: String, trim: true, default: null },
    connectionType: { type: String, trim: true, default: null },
    apiEndpoint: { type: String, trim: true, default: null },
    httpMethod: { type: String, trim: true, default: null },
    httpStatus: { type: Number, default: null },
    durationMs: { type: Number, default: null, min: 0 },
    errorCode: { type: String, trim: true, default: null },
    errorClass: { type: String, trim: true, default: null },
    isInternalTraffic: { type: Boolean, default: false },
    isBotTraffic: { type: Boolean, default: false },
    isTestTraffic: { type: Boolean, default: false },
    identitySuppressed: { type: Boolean, default: false },
    occurredAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
    clientSequence: { type: Number, default: null, min: 0 },
    schemaVersion: { type: Number, default: 2 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

bookingFunnelEventSchema.index({ eventId: 1 }, { unique: true });
bookingFunnelEventSchema.index({ dedupeKey: 1 }, { unique: true });
bookingFunnelEventSchema.index({ eventType: 1, createdAt: -1 });
bookingFunnelEventSchema.index({ canonicalEventName: 1, occurredAt: -1 });
bookingFunnelEventSchema.index(
  { sessionKey: 1, occurredAt: -1 },
  { partialFilterExpression: { sessionKey: { $type: 'string' } } }
);
bookingFunnelEventSchema.index(
  { visitorKey: 1, occurredAt: -1 },
  { partialFilterExpression: { visitorKey: { $type: 'string' } } }
);
bookingFunnelEventSchema.index(
  { convertedBookingId: 1 },
  { unique: true, partialFilterExpression: { convertedBookingId: { $type: 'objectId' } } }
);
bookingFunnelEventSchema.index(
  { bookingId: 1 },
  { partialFilterExpression: { bookingId: { $type: 'objectId' } } }
);
bookingFunnelEventSchema.index({ propertyKind: 1, occurredAt: -1 });
bookingFunnelEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('BookingFunnelEvent', bookingFunnelEventSchema);
