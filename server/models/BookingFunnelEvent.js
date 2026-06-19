'use strict';

const mongoose = require('mongoose');
const {
  ALL_EVENT_TYPES,
  QUOTE_FAILURE_CLASSES,
  PROPERTY_KINDS
} = require('../services/conversion/funnelEventConstants');

const attributionSchema = new mongoose.Schema(
  {
    utmSource: { type: String, trim: true, default: undefined },
    utmMedium: { type: String, trim: true, default: undefined },
    utmCampaign: { type: String, trim: true, default: undefined },
    gclid: { type: String, trim: true, default: undefined },
    fbclid: { type: String, trim: true, default: undefined },
    msclkid: { type: String, trim: true, default: undefined },
    referrer: { type: String, trim: true, default: undefined },
    landingPath: { type: String, trim: true, default: undefined },
    referralCode: { type: String, trim: true, default: undefined }
  },
  { _id: false }
);

const bookingFunnelEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: ALL_EVENT_TYPES,
      index: true
    },
    source: {
      type: String,
      required: true,
      enum: ['client', 'server']
    },
    dedupeKey: {
      type: String,
      required: true,
      trim: true
    },
    sessionKey: { type: String, trim: true, default: null },
    visitorKey: { type: String, trim: true, default: null },
    propertyKind: { type: String, enum: PROPERTY_KINDS, default: null },
    cabinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cabin', default: null },
    cabinTypeId: { type: mongoose.Schema.Types.ObjectId, ref: 'CabinType', default: null },
    unitId: { type: mongoose.Schema.Types.ObjectId, ref: 'Unit', default: null },
    checkInDateOnly: { type: String, trim: true, default: null },
    checkOutDateOnly: { type: String, trim: true, default: null },
    adults: { type: Number, default: null, min: 0 },
    children: { type: Number, default: null, min: 0 },
    priceShownCents: { type: Number, default: null, min: 0 },
    currency: { type: String, trim: true, default: 'EUR' },
    quoteFailureClass: { type: String, enum: [...QUOTE_FAILURE_CLASSES, null], default: null },
    attribution: { type: attributionSchema, default: undefined },
    convertedBookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },
    checkoutId: { type: String, trim: true, default: null },
    searchResultCount: { type: Number, default: null, min: 0 },
    schemaVersion: { type: Number, default: 1 }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

bookingFunnelEventSchema.index({ dedupeKey: 1 }, { unique: true });
bookingFunnelEventSchema.index({ eventType: 1, createdAt: -1 });
bookingFunnelEventSchema.index(
  { sessionKey: 1, createdAt: -1 },
  { partialFilterExpression: { sessionKey: { $type: 'string' } } }
);
bookingFunnelEventSchema.index(
  { convertedBookingId: 1 },
  { unique: true, partialFilterExpression: { convertedBookingId: { $type: 'objectId' } } }
);
bookingFunnelEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 });

module.exports = mongoose.model('BookingFunnelEvent', bookingFunnelEventSchema);
