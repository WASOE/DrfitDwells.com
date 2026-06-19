'use strict';

const CLIENT_EVENT_TYPES = Object.freeze([
  'property_view',
  'search_results',
  'confirm_page_view',
  'checkout_started'
]);

const SERVER_EVENT_TYPES = Object.freeze([
  'quote_received',
  'quote_failed',
  'booking_converted'
]);

const ALL_EVENT_TYPES = Object.freeze([...CLIENT_EVENT_TYPES, ...SERVER_EVENT_TYPES]);

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
  ]
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

module.exports = {
  CLIENT_EVENT_TYPES,
  SERVER_EVENT_TYPES,
  ALL_EVENT_TYPES,
  QUOTE_FAILURE_CLASSES,
  PROPERTY_KINDS,
  PII_REJECT_FIELDS,
  ATTRIBUTION_ALLOWLIST,
  CLIENT_PAYLOAD_ALLOWLIST,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  isFunnelTrackingEnabled,
  isClientEventType,
  isAllowedEventType
};
