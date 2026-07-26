'use strict';

/**
 * Batch 6A first-party journey event contract.
 * Legacy event names remain in ALL_EVENT_TYPES for persisted rows and writes during TTL window.
 */

const BEHAVIOURAL_EVENT_TYPES = Object.freeze([
  'landing',
  'page_view',
  'property_view',
  'gallery_opened',
  'availability_started',
  'dates_selected',
  'guest_count_selected',
  'availability_checked',
  'availability_unavailable',
  'search_results_viewed',
  'property_selected',
  'quote_viewed',
  'checkout_ui_started',
  'guest_details_started',
  'guest_details_completed',
  'payment_ui_opened',
  'payment_ui_cancelled',
  'validation_error',
  'availability_error',
  'pricing_error',
  'checkout_error',
  'payment_provider_error',
  'page_error',
  'network_error',
  'slow_request',
  'abandoned_navigation',
  // Legacy client names (accepted at ingest; canonicalEventName remapped)
  'search_results',
  'confirm_page_view',
  'checkout_started'
]);

const SERVER_COMMERCIAL_EVENT_TYPES = Object.freeze([
  'quote_created',
  'checkout_started',
  'payment_started',
  'payment_failed',
  'payment_cancelled',
  'payment_succeeded',
  'booking_created',
  'booking_confirmed',
  // Legacy server names
  'quote_received',
  'quote_failed',
  'booking_converted'
]);

/** Events the public client ingest endpoint may accept (behavioural + legacy client aliases). */
const CLIENT_INGEST_EVENT_TYPES = Object.freeze([
  'landing',
  'page_view',
  'property_view',
  'gallery_opened',
  'availability_started',
  'dates_selected',
  'guest_count_selected',
  'availability_checked',
  'availability_unavailable',
  'search_results_viewed',
  'search_results',
  'property_selected',
  'quote_viewed',
  'checkout_ui_started',
  'confirm_page_view',
  'guest_details_started',
  'guest_details_completed',
  'payment_ui_opened',
  'payment_ui_cancelled',
  // Legacy client checkout_started → stored as checkout_ui_started
  'checkout_started',
  'validation_error',
  'availability_error',
  'pricing_error',
  'checkout_error',
  'payment_provider_error',
  'page_error',
  'network_error',
  'slow_request',
  'abandoned_navigation'
]);

/** Server-truth events — rejected if submitted via public client ingest. */
const SERVER_ONLY_EVENT_TYPES = Object.freeze([
  'quote_created',
  'quote_received',
  'payment_started',
  'payment_failed',
  'payment_cancelled',
  'payment_succeeded',
  'booking_created',
  'booking_confirmed',
  'booking_converted',
  'quote_failed'
]);

const ALL_EVENT_TYPES = Object.freeze([
  ...new Set([...BEHAVIOURAL_EVENT_TYPES, ...SERVER_COMMERCIAL_EVENT_TYPES])
]);

/**
 * Map any stored eventType → canonical name for aggregation / reporting.
 */
const LEGACY_TO_CANONICAL = Object.freeze({
  property_view: 'property_view',
  search_results: 'search_results_viewed',
  search_results_viewed: 'search_results_viewed',
  confirm_page_view: 'checkout_ui_started',
  checkout_ui_started: 'checkout_ui_started',
  // Legacy client checkout_started is behavioural UI intent
  checkout_started: 'checkout_started',
  quote_received: 'quote_created',
  quote_created: 'quote_created',
  quote_failed: 'quote_failed',
  booking_converted: 'booking_confirmed',
  booking_confirmed: 'booking_confirmed',
  booking_created: 'booking_created',
  payment_started: 'payment_started',
  payment_failed: 'payment_failed',
  payment_cancelled: 'payment_cancelled',
  payment_succeeded: 'payment_succeeded'
});

/**
 * Existing OPS main funnel stages → eventTypes that count (legacy + canonical).
 * search_results is intentionally excluded from the main funnel.
 */
const MAIN_FUNNEL_STAGE_EVENT_TYPES = Object.freeze({
  property_view: Object.freeze(['property_view']),
  checkout_intent: Object.freeze(['confirm_page_view', 'checkout_ui_started']),
  quote: Object.freeze(['quote_received', 'quote_created']),
  checkout: Object.freeze(['checkout_started']),
  booking_confirmed: Object.freeze(['booking_converted', 'booking_confirmed'])
});

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
  'metadata',
  'password',
  'cardNumber',
  'cvc',
  'cvv',
  'paymentMethod'
]);

const ATTRIBUTION_ALLOWLIST = Object.freeze([
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmTerm',
  'utmContent',
  'gclid',
  'fbclid',
  'msclkid',
  'referrer',
  'landingPath',
  'referralCode',
  'referringDomain',
  'source',
  'medium',
  'campaign',
  'term',
  'content'
]);

const FUNNEL_STAGES = Object.freeze([
  'landing',
  'browse',
  'property',
  'availability',
  'quote',
  'checkout',
  'payment',
  'booking',
  'friction',
  'unknown'
]);

const CLIENT_PAYLOAD_ALLOWLIST = Object.freeze({
  _common: Object.freeze([
    'eventType',
    'eventId',
    'sessionKey',
    'visitorKey',
    'anonymousId',
    'occurredAt',
    'clientSequence',
    'previousEventName',
    'funnelStage',
    'pagePath',
    'pageTitle',
    'routeName',
    'landingPage',
    'referrer',
    'propertyKind',
    'cabinId',
    'cabinTypeId',
    'unitId',
    'locationId',
    'checkIn',
    'checkOut',
    'checkInDateOnly',
    'checkOutDateOnly',
    'nights',
    'adults',
    'children',
    'pets',
    'selectedExtras',
    'quotedSubtotal',
    'quotedDiscount',
    'quotedTotal',
    'priceShownCents',
    'currency',
    'availabilityResult',
    'unavailableReason',
    'searchResultCount',
    'checkoutId',
    'quoteId',
    'attribution',
    'firstTouch',
    'lastTouch',
    'deviceCategory',
    'browserFamily',
    'osFamily',
    'screenCategory',
    'language',
    'connectionType',
    'apiEndpoint',
    'httpMethod',
    'httpStatus',
    'durationMs',
    'errorCode',
    'errorClass'
  ])
});

const MAX_BODY_BYTES = 12288;
const SCHEMA_VERSION = 2;

/** Slow-request thresholds (ms) by endpoint category. */
const SLOW_REQUEST_THRESHOLDS_MS = Object.freeze({
  availability_quote: 4000,
  checkout_payment: 8000,
  general_public: 5000
});

function isFunnelTrackingEnabled() {
  return String(process.env.FUNNEL_TRACKING_ENABLED || '').trim() === '1';
}

function isClientEventType(eventType) {
  return CLIENT_INGEST_EVENT_TYPES.includes(eventType);
}

function isServerOnlyEventType(eventType) {
  return SERVER_ONLY_EVENT_TYPES.includes(eventType);
}

function isAllowedEventType(eventType) {
  return ALL_EVENT_TYPES.includes(eventType);
}

function toCanonicalEventName(eventType) {
  if (!eventType) return null;
  if (LEGACY_TO_CANONICAL[eventType]) return LEGACY_TO_CANONICAL[eventType];
  if (ALL_EVENT_TYPES.includes(eventType)) return eventType;
  return eventType;
}

/**
 * Client ingest remaps some legacy/alias names before persist.
 * Server commercial checkout_started is never accepted on this path.
 */
function resolveClientPersistNames(eventType) {
  const raw = String(eventType || '').trim();
  if (raw === 'search_results') {
    return { eventType: 'search_results_viewed', canonicalEventName: 'search_results_viewed' };
  }
  if (raw === 'confirm_page_view' || raw === 'checkout_started') {
    return { eventType: 'checkout_ui_started', canonicalEventName: 'checkout_ui_started' };
  }
  const canonical = toCanonicalEventName(raw);
  return { eventType: raw === 'checkout_ui_started' ? 'checkout_ui_started' : canonical || raw, canonicalEventName: canonical || raw };
}

function funnelStageForEvent(canonicalEventName) {
  const name = String(canonicalEventName || '');
  if (name === 'landing' || name === 'page_view') return 'browse';
  if (['property_view', 'gallery_opened', 'property_selected'].includes(name)) return 'property';
  if (
    [
      'availability_started',
      'dates_selected',
      'guest_count_selected',
      'availability_checked',
      'availability_unavailable',
      'search_results_viewed'
    ].includes(name)
  ) {
    return 'availability';
  }
  if (['quote_viewed', 'quote_created', 'quote_failed', 'pricing_error'].includes(name)) return 'quote';
  if (['checkout_ui_started', 'guest_details_started', 'guest_details_completed', 'checkout_started', 'checkout_error'].includes(name)) {
    return 'checkout';
  }
  if (
    [
      'payment_ui_opened',
      'payment_ui_cancelled',
      'payment_started',
      'payment_failed',
      'payment_cancelled',
      'payment_succeeded',
      'payment_provider_error'
    ].includes(name)
  ) {
    return 'payment';
  }
  if (['booking_created', 'booking_confirmed'].includes(name)) return 'booking';
  if (name.endsWith('_error') || name === 'slow_request' || name === 'abandoned_navigation') return 'friction';
  return 'unknown';
}

module.exports = {
  BEHAVIOURAL_EVENT_TYPES,
  SERVER_COMMERCIAL_EVENT_TYPES,
  CLIENT_INGEST_EVENT_TYPES,
  SERVER_ONLY_EVENT_TYPES,
  ALL_EVENT_TYPES,
  LEGACY_TO_CANONICAL,
  MAIN_FUNNEL_STAGE_EVENT_TYPES,
  QUOTE_FAILURE_CLASSES,
  PROPERTY_KINDS,
  PII_REJECT_FIELDS,
  ATTRIBUTION_ALLOWLIST,
  FUNNEL_STAGES,
  CLIENT_PAYLOAD_ALLOWLIST,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  SLOW_REQUEST_THRESHOLDS_MS,
  isFunnelTrackingEnabled,
  isClientEventType,
  isServerOnlyEventType,
  isAllowedEventType,
  toCanonicalEventName,
  resolveClientPersistNames,
  funnelStageForEvent,
  // Back-compat aliases used by older tests
  CLIENT_EVENT_TYPES: CLIENT_INGEST_EVENT_TYPES,
  SERVER_EVENT_TYPES: SERVER_COMMERCIAL_EVENT_TYPES
};
