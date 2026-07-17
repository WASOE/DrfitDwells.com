'use strict';

const mongoose = require('mongoose');

const CLIENT_ERROR_EVENT_TYPES = Object.freeze([
  'payment_element_slow',
  'payment_element_load_error',
  'stripe_js_load_failed',
  'payment_element_escalated'
]);

const UA_CLASSES = Object.freeze(['instagram', 'facebook', 'safari', 'other']);
const PROPERTY_KINDS = Object.freeze(['cabin', 'valley']);

const clientErrorEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: CLIENT_ERROR_EVENT_TYPES,
      index: true
    },
    checkoutId: { type: String, trim: true, default: null },
    stripeAmountCents: { type: Number, default: null, min: 0 },
    priceShownCents: { type: Number, default: null, min: 0 },
    uaClass: { type: String, enum: [...UA_CLASSES, null], default: null },
    propertyKind: { type: String, enum: [...PROPERTY_KINDS, null], default: null },
    dedupeKey: { type: String, required: true, trim: true }
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

clientErrorEventSchema.index({ dedupeKey: 1 }, { unique: true });
clientErrorEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('ClientErrorEvent', clientErrorEventSchema);
module.exports.CLIENT_ERROR_EVENT_TYPES = CLIENT_ERROR_EVENT_TYPES;
module.exports.UA_CLASSES = UA_CLASSES;
