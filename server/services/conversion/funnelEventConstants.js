'use strict';

const CLIENT_EVENT_TYPES = Object.freeze([
  'property_view',
  'search_results',
  'confirm_page_view',
  'checkout_started',
  'payment_element_slow',
  'payment_element_load_error',
  'stripe_js_load_failed',
  'payment_element_escalated'
]);

const SERVER_EVENT_TYPES = Object.freeze([
  'quote_received',
  'quote_failed',
  'booking_converted'
]);

const ALL_EVENT_TYPES = Object.freeze([...CLIENT_EVENT_TYPES, ...SERVER_EVENT_TYPES]);

const PAYMENT_RESILIENCE_EVENT_TYPES = Object.freeze([
  'payment_element_slow',
  'payment_element_load_error',
  'stripe_js_load_failed',
  'payment_element_escalated'
]);

const UA_CLASSES = Object.freeze(['instagram', 'facebook', 'safari', 'other']);

const QUOTE_FAILURE_CLASSES = Object.freeze([
  'validation_error',
  'not_found',
  'unavailable',
  'past_date',
  'capacity_exceeded',
  'promo_invalid',
  'server_error',
  'unknown'
]);

const PROPERTY_KINDS = Object.freeze(['cabin', 'valley']);

const PII_REJECT_FIELDS = Object.freeze([
  'email',
  'phone',
  'firstName',
  'lastName',
  'guestInfo',
  'metadata'
]);

const ATTRIBUTION_ALLOWLIST = Object.freeze([
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'gclid',
  'fbclid',
  'msclkid',
  'referrer',
  'landingPath',
  'referralCode'
]);

const PAYMENT_RESILIENCE_PAYLOAD_FIELDS = Object.freeze([
  'eventType',
  'sessionKey',
  'visitorKey',
  'checkoutId',
  'priceShownCents',
  'stripeAmountCents',
  'uaClass',
  'propertyKind',
  'attribution'
]);

const CLIENT_PAYLOAD_ALLOWLIST = Object.freeze({
  property_view: [
    'eventType',
    'sessionKey',
    'visitorKey',
    'cabinId',
    'cabinTypeId',
    'checkInDateOnly',
    'checkOutDateOnly',
    'adults',
    'children',
    'attribution'
  ],
  search_results: [
    'eventType',
    'sessionKey',
    'visitorKey',
    'checkInDateOnly',
    'checkOutDateOnly',
    'adults',
    'children',
    'searchResultCount',
    'attribution'
  ],
  confirm_page_view: [
    'eventType',
    'sessionKey',
    'visitorKey',
    'cabinId',
    'cabinTypeId',
    'checkInDateOnly',
    'checkOutDateOnly',
    'adults',
    'children',
    'attribution'
  ],
  checkout_started: [
    'eventType',
    'sessionKey',
    'visitorKey',
    'checkoutId',
    'cabinId',
    'cabinTypeId',
    'checkInDateOnly',
    'checkOutDateOnly',
    'adults',
    'children',
    'attribution'
  ],
  payment_element_slow: [...PAYMENT_RESILIENCE_PAYLOAD_FIELDS],
  payment_element_load_error: [...PAYMENT_RESILIENCE_PAYLOAD_FIELDS],
  stripe_js_load_failed: [...PAYMENT_RESILIENCE_PAYLOAD_FIELDS],
  payment_element_escalated: [...PAYMENT_RESILIENCE_PAYLOAD_FIELDS]
});

const MAX_BODY_BYTES = 8192;
const SCHEMA_VERSION = 1;

function isFunnelTrackingEnabled() {
  return String(process.env.FUNNEL_TRACKING_ENABLED || '').trim() === '1';
}

function isClientEventType(eventType) {
  return CLIENT_EVENT_TYPES.includes(eventType);
}

function isAllowedEventType(eventType) {
  return ALL_EVENT_TYPES.includes(eventType);
}

function isPaymentResilienceEventType(eventType) {
  return PAYMENT_RESILIENCE_EVENT_TYPES.includes(eventType);
}

module.exports = {
  CLIENT_EVENT_TYPES,
  SERVER_EVENT_TYPES,
  ALL_EVENT_TYPES,
  PAYMENT_RESILIENCE_EVENT_TYPES,
  UA_CLASSES,
  QUOTE_FAILURE_CLASSES,
  PROPERTY_KINDS,
  PII_REJECT_FIELDS,
  ATTRIBUTION_ALLOWLIST,
  CLIENT_PAYLOAD_ALLOWLIST,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  isFunnelTrackingEnabled,
  isClientEventType,
  isAllowedEventType,
  isPaymentResilienceEventType
};
