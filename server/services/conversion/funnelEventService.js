'use strict';

const crypto = require('crypto');
const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const BookingFunnelEvent = require('../../models/BookingFunnelEvent');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const { FIXTURE_CABIN_NAME_PATTERN } = require('../../utils/fixtureExclusion');
const {
  isFunnelTrackingEnabled,
  isClientEventType,
  isServerOnlyEventType,
  isAllowedEventType,
  QUOTE_FAILURE_CLASSES,
  CLIENT_PAYLOAD_ALLOWLIST,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  resolveClientPersistNames,
  funnelStageForEvent,
  toCanonicalEventName
} = require('./funnelEventConstants');
const {
  sanitizeKey,
  sanitizeUuid,
  sanitizeObjectId,
  sanitizeGuestCount,
  sanitizePropertyKind,
  sanitizeCheckoutId,
  sanitizePath,
  sanitizeCents,
  sanitizeOccurredAt,
  sanitizeAttribution,
  sanitizeSelectedExtras,
  sanitizeText,
  sanitizeFunnelStage,
  rejectPiiFields,
  applyClientAllowlist,
  resolveEntityFromBody,
  extractDatesFromBody
} = require('./funnelEventSanitize');
const {
  buildBehaviouralDedupeKey,
  buildQuoteCreatedDedupeKey,
  buildQuoteFailedDedupeKey,
  buildCheckoutStartedDedupeKey,
  buildPaymentDedupeKey,
  buildBookingCreatedDedupeKey,
  buildBookingConfirmedDedupeKey
} = require('./funnelEventDedupe');

const BOT_UA_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|pingdom|uptimerobot|statuscake|monitoring/i;

async function resolvePropertyKindFromEntity({ cabinId, cabinTypeId }) {
  if (cabinId) {
    const cabin = await Cabin.findById(cabinId).select('propertyKind name').lean();
    return {
      propertyKind: sanitizePropertyKind(cabin?.propertyKind) || null,
      isFixture: FIXTURE_CABIN_NAME_PATTERN.test(String(cabin?.name || ''))
    };
  }
  if (cabinTypeId) {
    const cabinType = await CabinType.findById(cabinTypeId).select('propertyKind name').lean();
    return {
      propertyKind: sanitizePropertyKind(cabinType?.propertyKind) || null,
      isFixture: FIXTURE_CABIN_NAME_PATTERN.test(String(cabinType?.name || ''))
    };
  }
  return { propertyKind: null, isFixture: false };
}

function classifyRequestTraffic(req = {}) {
  const ua = String(req.headers?.['user-agent'] || '');
  const path = String(req.originalUrl || req.path || '');
  const isBotTraffic = BOT_UA_PATTERN.test(ua);
  const isInternalTraffic =
    path.startsWith('/ops') ||
    path.startsWith('/api/ops') ||
    path === '/health' ||
    path.startsWith('/health/') ||
    Boolean(req.user?.role && ['admin', 'ops', 'operator'].includes(String(req.user.role)));
  return { isBotTraffic, isInternalTraffic, isTestTraffic: false };
}

async function insertFunnelEvent(doc) {
  try {
    await BookingFunnelEvent.create(doc);
    return { inserted: true, duplicate: false };
  } catch (err) {
    if (err && err.code === 11000) {
      return { inserted: false, duplicate: true };
    }
    throw err;
  }
}

function assertPayloadSize(payload) {
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (size > MAX_BODY_BYTES) {
    const error = new Error('Funnel payload too large');
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
  }
}

function mapQuoteFailureClass(result, { validationFailed = false } = {}) {
  if (validationFailed) return 'validation_error';
  const status = Number(result?.status);
  const message = String(result?.message || '').toLowerCase();

  if (status === 404) return 'not_found';
  if (status === 409) return 'unavailable';
  if (message.includes('past') || message.includes('cannot be in the past')) return 'past_date';
  if (message.includes('accommodate') || message.includes('guest')) return 'capacity_exceeded';
  if (message.includes('promo') || message.includes('voucher')) return 'promo_invalid';
  if (status === 400) return 'validation_error';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

function nightsFromDates(checkInDateOnly, checkOutDateOnly) {
  if (!checkInDateOnly || !checkOutDateOnly) return null;
  const a = Date.parse(`${checkInDateOnly}T00:00:00.000Z`);
  const b = Date.parse(`${checkOutDateOnly}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return Math.round((b - a) / 86400000);
}

function buildClientEventDoc(rawBody, { traffic = {} } = {}) {
  const body = applyClientAllowlist(rawBody);
  const requestedType = String(body.eventType || '').trim();

  if (isServerOnlyEventType(requestedType) && requestedType !== 'checkout_started') {
    // checkout_started is remapped to checkout_ui_started for client ingest
    const error = new Error('Server-only event type rejected');
    error.code = 'SERVER_ONLY_EVENT';
    throw error;
  }
  if (requestedType === 'quote_created' || requestedType === 'payment_succeeded' || requestedType === 'booking_confirmed' || requestedType === 'booking_created' || requestedType === 'payment_started' || requestedType === 'payment_failed' || requestedType === 'payment_cancelled') {
    const error = new Error('Server-only event type rejected');
    error.code = 'SERVER_ONLY_EVENT';
    throw error;
  }

  if (!isClientEventType(requestedType)) {
    const error = new Error('Invalid client event type');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }

  const names = resolveClientPersistNames(requestedType);
  const eventId = sanitizeUuid(body.eventId);
  if (!eventId) {
    const error = new Error('eventId UUID required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const sessionKey = sanitizeKey(body.sessionKey);
  if (!sessionKey) {
    const error = new Error('sessionKey is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const visitorKey = sanitizeKey(body.visitorKey);
  const anonymousId = sanitizeKey(body.anonymousId) || visitorKey || null;
  const entity = resolveEntityFromBody(body);
  const dates = extractDatesFromBody(body);
  const adults = sanitizeGuestCount(body.adults, { min: 0, max: 20 });
  const children = sanitizeGuestCount(body.children, { min: 0, max: 20 });
  const pets = sanitizeGuestCount(body.pets, { min: 0, max: 10 });
  const attribution = sanitizeAttribution(body.attribution);
  const firstTouch = sanitizeAttribution(body.firstTouch);
  const lastTouch = sanitizeAttribution(body.lastTouch);
  const occurredAt = sanitizeOccurredAt(body.occurredAt) || new Date();
  const receivedAt = new Date();

  // Entity required for property-scoped behavioural events
  const needsEntity = [
    'property_view',
    'gallery_opened',
    'property_selected',
    'availability_started',
    'dates_selected',
    'guest_count_selected',
    'availability_checked',
    'availability_unavailable',
    'quote_viewed',
    'checkout_ui_started'
  ].includes(names.canonicalEventName);
  if (needsEntity && !entity.cabinId && !entity.cabinTypeId && !sanitizeKey(body.locationId, 64)) {
    const error = new Error('cabinId, cabinTypeId or locationId required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (
    (names.canonicalEventName === 'search_results_viewed' ||
      names.canonicalEventName === 'dates_selected' ||
      names.canonicalEventName === 'availability_checked' ||
      names.canonicalEventName === 'availability_unavailable') &&
    (!dates.checkInDateOnly || !dates.checkOutDateOnly)
  ) {
    const error = new Error('checkInDateOnly and checkOutDateOnly required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const doc = {
    eventId,
    eventType: names.eventType,
    canonicalEventName: names.canonicalEventName,
    eventSource: 'client',
    source: 'client',
    verificationStatus: 'behavioural',
    origin: 'web',
    dedupeKey: buildBehaviouralDedupeKey(eventId),
    sessionKey,
    visitorKey: visitorKey || null,
    anonymousId,
    cabinId: entity.cabinId,
    cabinTypeId: entity.cabinTypeId,
    unitId: sanitizeObjectId(body.unitId),
    locationId: sanitizeKey(body.locationId, 64),
    checkInDateOnly: dates.checkInDateOnly,
    checkOutDateOnly: dates.checkOutDateOnly,
    nights: nightsFromDates(dates.checkInDateOnly, dates.checkOutDateOnly),
    adults,
    children,
    pets,
    selectedExtras: sanitizeSelectedExtras(body.selectedExtras),
    quotedSubtotalCents: sanitizeCents(body.quotedSubtotal),
    quotedDiscountCents: sanitizeCents(body.quotedDiscount),
    quotedTotalCents: sanitizeCents(body.quotedTotal ?? body.priceShownCents),
    priceShownCents: sanitizeCents(body.priceShownCents ?? body.quotedTotal),
    currency: sanitizeText(body.currency, 8) || 'EUR',
    availabilityResult: sanitizeText(body.availabilityResult, 64),
    unavailableReason: sanitizeText(body.unavailableReason, 200),
    searchResultCount: sanitizeGuestCount(body.searchResultCount, { min: 0, max: 500 }),
    checkoutId: sanitizeCheckoutId(body.checkoutId),
    quoteId: sanitizeKey(body.quoteId, 64),
    funnelStage: sanitizeFunnelStage(body.funnelStage) || funnelStageForEvent(names.canonicalEventName),
    previousEventName: sanitizeKey(body.previousEventName, 64),
    pagePath: sanitizePath(body.pagePath),
    pageTitle: sanitizeText(body.pageTitle, 200),
    routeName: sanitizeKey(body.routeName, 80),
    landingPage: sanitizePath(body.landingPage),
    referrer: sanitizePath(body.referrer),
    deviceCategory: sanitizeText(body.deviceCategory, 40),
    browserFamily: sanitizeText(body.browserFamily, 40),
    osFamily: sanitizeText(body.osFamily, 40),
    screenCategory: sanitizeText(body.screenCategory, 40),
    language: sanitizeText(body.language, 16),
    connectionType: sanitizeText(body.connectionType, 40),
    apiEndpoint: sanitizePath(body.apiEndpoint, 200),
    httpMethod: sanitizeText(body.httpMethod, 16),
    httpStatus: Number.isFinite(Number(body.httpStatus)) ? Number(body.httpStatus) : null,
    durationMs: Number.isFinite(Number(body.durationMs)) ? Math.max(0, Math.round(Number(body.durationMs))) : null,
    errorCode: sanitizeKey(body.errorCode, 64),
    errorClass: sanitizeKey(body.errorClass, 64),
    isInternalTraffic: Boolean(traffic.isInternalTraffic),
    isBotTraffic: Boolean(traffic.isBotTraffic),
    isTestTraffic: Boolean(traffic.isTestTraffic),
    identitySuppressed: false,
    occurredAt,
    receivedAt,
    clientSequence: Number.isFinite(Number(body.clientSequence))
      ? Math.max(0, Math.round(Number(body.clientSequence)))
      : null,
    schemaVersion: SCHEMA_VERSION
  };

  const resolvedKind = sanitizePropertyKind(body.propertyKind);
  if (resolvedKind) doc.propertyKind = resolvedKind;
  if (attribution) doc.attribution = attribution;
  if (firstTouch) doc.firstTouch = firstTouch;
  if (lastTouch) doc.lastTouch = lastTouch;

  return doc;
}

async function recordClientFunnelEvent(body, { req = null } = {}) {
  if (!isFunnelTrackingEnabled()) {
    return { skipped: true };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('Invalid funnel event');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (rejectPiiFields(body)) {
    const error = new Error('Invalid funnel event');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const eventType = String(body.eventType || '').trim();
  if (isServerOnlyEventType(eventType) && eventType !== 'checkout_started') {
    const error = new Error('Server-only event type rejected');
    error.code = 'SERVER_ONLY_EVENT';
    throw error;
  }
  if (
    [
      'quote_created',
      'payment_succeeded',
      'payment_started',
      'payment_failed',
      'payment_cancelled',
      'booking_created',
      'booking_confirmed',
      'quote_received',
      'booking_converted'
    ].includes(eventType)
  ) {
    const error = new Error('Server-only event type rejected');
    error.code = 'SERVER_ONLY_EVENT';
    throw error;
  }
  if (!isAllowedEventType(eventType) && !isClientEventType(eventType)) {
    const error = new Error('Invalid funnel event');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }
  if (!isClientEventType(eventType)) {
    const error = new Error('Invalid funnel event');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }

  assertPayloadSize(body);
  const traffic = classifyRequestTraffic(req || {});
  const doc = buildClientEventDoc(body, { traffic });

  if (!doc.propertyKind && (doc.cabinId || doc.cabinTypeId)) {
    const resolved = await resolvePropertyKindFromEntity({
      cabinId: doc.cabinId,
      cabinTypeId: doc.cabinTypeId
    });
    if (resolved.propertyKind) doc.propertyKind = resolved.propertyKind;
    if (resolved.isFixture) doc.isTestTraffic = true;
  }

  // Persist bot/internal with markers (excluded from primary metrics in aggregation)
  const result = await insertFunnelEvent(doc);
  return { skipped: false, ...result };
}

function baseServerDoc({
  eventType,
  canonicalEventName,
  dedupeKey,
  origin = 'api',
  sessionKey = null,
  visitorKey = null,
  identitySuppressed = false,
  ...rest
}) {
  const eventId = crypto.randomUUID();
  const now = new Date();
  const canonical = canonicalEventName || toCanonicalEventName(eventType);
  return {
    eventId,
    eventType,
    canonicalEventName: canonical,
    eventSource: 'server',
    source: 'server',
    verificationStatus: 'server_verified',
    origin,
    dedupeKey,
    sessionKey: sessionKey || null,
    visitorKey: visitorKey || null,
    anonymousId: visitorKey || null,
    identitySuppressed: Boolean(identitySuppressed || (!sessionKey && !visitorKey)),
    funnelStage: funnelStageForEvent(canonical),
    occurredAt: now,
    receivedAt: now,
    currency: 'EUR',
    schemaVersion: SCHEMA_VERSION,
    isInternalTraffic: false,
    isBotTraffic: false,
    isTestTraffic: false,
    ...rest
  };
}

async function recordQuoteFunnelOutcome(req, outcome) {
  if (!isFunnelTrackingEnabled() || !outcome) return { skipped: true };

  const body = req?.body || {};
  const sessionKey = sanitizeKey(body.funnelSessionKey);
  const visitorKey = sanitizeKey(body.funnelVisitorKey);
  const entity = resolveEntityFromBody(body);
  const dates = extractDatesFromBody(body);
  const adults = sanitizeGuestCount(body.adults, { min: 0, max: 20 });
  const children = sanitizeGuestCount(body.children, { min: 0, max: 20 });
  const identitySuppressed = !sessionKey && !visitorKey;

  if (outcome.kind === 'received' && outcome.result?.ok !== false && outcome.result) {
    const totalPrice = Number(outcome.result.totalPrice ?? outcome.result.data?.totalPrice);
    const priceShownCents = Number.isFinite(totalPrice) ? Math.max(0, Math.round(totalPrice * 100)) : null;
    const quoteId = sanitizeKey(outcome.result.quoteId || outcome.result.savedQuoteId, 64);
    const dedupeKey = buildQuoteCreatedDedupeKey({
      sessionKey,
      visitorKey,
      entityType: entity.entityType,
      entityId: entity.entityId,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      adults,
      children,
      priceCents: priceShownCents,
      promoCode: body.promoCode,
      voucherCode: body.voucherCode,
      quoteId
    });

    const resolved = await resolvePropertyKindFromEntity({
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId
    });

    const doc = baseServerDoc({
      eventType: 'quote_created',
      canonicalEventName: 'quote_created',
      dedupeKey,
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed,
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId,
      locationId: sanitizeKey(body.locationKey || body.locationId, 64),
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      nights: nightsFromDates(dates.checkInDateOnly, dates.checkOutDateOnly),
      adults,
      children,
      priceShownCents,
      quotedTotalCents: priceShownCents,
      quoteId: quoteId || null,
      propertyKind: resolved.propertyKind || sanitizePropertyKind(outcome.propertyKind) || null,
      isTestTraffic: resolved.isFixture
    });

    return { skipped: false, ...(await insertFunnelEvent(doc)) };
  }

  if (outcome.kind === 'failed' || outcome.kind === 'unavailable') {
    const quoteFailureClass =
      outcome.quoteFailureClass ||
      mapQuoteFailureClass(
        { ...(outcome.result || {}), status: outcome.httpStatus || outcome.result?.status },
        { validationFailed: outcome.validationFailed }
      );
    if (!QUOTE_FAILURE_CLASSES.includes(quoteFailureClass)) {
      return { skipped: true };
    }

    const dedupeKey = buildQuoteFailedDedupeKey({
      sessionKey,
      visitorKey,
      entityType: entity.entityType,
      entityId: entity.entityId,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      quoteFailureClass
    });

    const resolved = await resolvePropertyKindFromEntity({
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId
    });

    // Persist as pricing_error (canonical friction) while keeping quoteFailureClass
    const doc = baseServerDoc({
      eventType: 'pricing_error',
      canonicalEventName: 'pricing_error',
      dedupeKey,
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed,
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId,
      locationId: sanitizeKey(body.locationKey || body.locationId, 64),
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      adults,
      children,
      quoteFailureClass,
      errorClass: quoteFailureClass,
      unavailableReason: sanitizeText(outcome.result?.unavailableReason || outcome.result?.message, 200),
      availabilityResult: outcome.kind === 'unavailable' ? 'unavailable' : null,
      propertyKind: resolved.propertyKind || sanitizePropertyKind(outcome.propertyKind) || null,
      isTestTraffic: resolved.isFixture,
      httpStatus: Number(outcome.result?.status) || null
    });

    return { skipped: false, ...(await insertFunnelEvent(doc)) };
  }

  return { skipped: true };
}

async function recordServerCheckoutStarted({
  checkoutId,
  paymentId = null,
  sessionKey = null,
  visitorKey = null,
  cabinId = null,
  cabinTypeId = null,
  unitId = null,
  locationId = null,
  propertyKind = null,
  checkInDateOnly = null,
  checkOutDateOnly = null,
  adults = null,
  children = null,
  quotedTotalCents = null,
  isTest = false
} = {}) {
  if (!isFunnelTrackingEnabled()) return { skipped: true };
  const checkout = sanitizeCheckoutId(checkoutId);
  const payment = sanitizeKey(paymentId, 64);
  if (!checkout && !payment) return { skipped: true };

  const dedupeKey = buildCheckoutStartedDedupeKey({ checkoutId: checkout, paymentId: payment });
  const resolved = await resolvePropertyKindFromEntity({
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId)
  });

  const doc = baseServerDoc({
    eventType: 'checkout_started',
    canonicalEventName: 'checkout_started',
    dedupeKey,
    origin: 'api',
    sessionKey: sanitizeKey(sessionKey),
    visitorKey: sanitizeKey(visitorKey),
    identitySuppressed: !sessionKey && !visitorKey,
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId),
    unitId: sanitizeObjectId(unitId),
    locationId: sanitizeKey(locationId, 64),
    checkInDateOnly,
    checkOutDateOnly,
    nights: nightsFromDates(checkInDateOnly, checkOutDateOnly),
    adults: sanitizeGuestCount(adults, { min: 0, max: 20 }),
    children: sanitizeGuestCount(children, { min: 0, max: 20 }),
    checkoutId: checkout,
    paymentId: payment,
    quotedTotalCents: sanitizeCents(quotedTotalCents),
    priceShownCents: sanitizeCents(quotedTotalCents),
    propertyKind: sanitizePropertyKind(propertyKind) || resolved.propertyKind,
    isTestTraffic: Boolean(isTest || resolved.isFixture)
  });

  return { skipped: false, ...(await insertFunnelEvent(doc)) };
}

async function recordServerPaymentEvent({
  eventName,
  paymentId,
  stateCode = null,
  sessionKey = null,
  visitorKey = null,
  checkoutId = null,
  cabinId = null,
  cabinTypeId = null,
  locationId = null,
  propertyKind = null,
  checkInDateOnly = null,
  checkOutDateOnly = null,
  quotedTotalCents = null,
  origin = 'api',
  errorCode = null,
  errorClass = null,
  isTest = false
} = {}) {
  if (!isFunnelTrackingEnabled()) return { skipped: true };
  const allowed = ['payment_started', 'payment_failed', 'payment_cancelled', 'payment_succeeded'];
  if (!allowed.includes(eventName)) return { skipped: true };
  const payment = sanitizeKey(paymentId, 64);
  if (!payment) return { skipped: true };

  const dedupeKey = buildPaymentDedupeKey({ eventName, paymentId: payment, stateCode });
  const resolved = await resolvePropertyKindFromEntity({
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId)
  });

  const doc = baseServerDoc({
    eventType: eventName,
    canonicalEventName: eventName,
    dedupeKey,
    origin,
    sessionKey: sanitizeKey(sessionKey),
    visitorKey: sanitizeKey(visitorKey),
    identitySuppressed: !sessionKey && !visitorKey,
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId),
    locationId: sanitizeKey(locationId, 64),
    checkInDateOnly,
    checkOutDateOnly,
    checkoutId: sanitizeCheckoutId(checkoutId),
    paymentId: payment,
    quotedTotalCents: sanitizeCents(quotedTotalCents),
    priceShownCents: sanitizeCents(quotedTotalCents),
    propertyKind: sanitizePropertyKind(propertyKind) || resolved.propertyKind,
    errorCode: sanitizeKey(errorCode, 64),
    errorClass: sanitizeKey(errorClass, 64),
    isTestTraffic: Boolean(isTest || resolved.isFixture)
  });

  return { skipped: false, ...(await insertFunnelEvent(doc)) };
}

async function recordBookingFunnelConversion(booking, { funnelSessionKey, funnelVisitorKey } = {}) {
  if (!isFunnelTrackingEnabled() || !booking) return { skipped: true };

  const status = String(booking.status || '');
  const source = String(booking.provenance?.source || '').trim();
  const isTest = Boolean(booking.isTest);
  if (status !== 'confirmed' || source !== 'guest_portal') {
    return { skipped: true };
  }

  const bookingId = booking._id;
  const cabinId = booking.cabinId ? String(booking.cabinId) : null;
  const cabinTypeId = booking.cabinTypeId ? String(booking.cabinTypeId) : null;
  const checkInDateOnly = booking.checkIn ? formatSofiaDateOnly(booking.checkIn) : null;
  const checkOutDateOnly = booking.checkOut ? formatSofiaDateOnly(booking.checkOut) : null;
  const totalCents =
    Number.isFinite(booking.totalValueCents) && booking.totalValueCents != null
      ? Math.max(0, Math.round(booking.totalValueCents))
      : Math.max(0, Math.round(Number(booking.totalPrice || 0) * 100));

  const sessionKey = sanitizeKey(funnelSessionKey);
  const visitorKey = sanitizeKey(funnelVisitorKey);
  const resolved = await resolvePropertyKindFromEntity({
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId)
  });

  const created = await insertFunnelEvent(
    baseServerDoc({
      eventType: 'booking_created',
      canonicalEventName: 'booking_created',
      dedupeKey: buildBookingCreatedDedupeKey(bookingId),
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed: !sessionKey && !visitorKey,
      cabinId: sanitizeObjectId(cabinId),
      cabinTypeId: sanitizeObjectId(cabinTypeId),
      unitId: booking.unitId ? sanitizeObjectId(String(booking.unitId)) : null,
      checkInDateOnly,
      checkOutDateOnly,
      nights: nightsFromDates(checkInDateOnly, checkOutDateOnly),
      adults: sanitizeGuestCount(booking.adults, { min: 0, max: 20 }),
      children: sanitizeGuestCount(booking.children, { min: 0, max: 20 }),
      priceShownCents: totalCents,
      quotedTotalCents: totalCents,
      bookingId,
      checkoutId: sanitizeCheckoutId(booking.checkoutId),
      paymentId: sanitizeKey(booking.stripePaymentIntentId, 64),
      propertyKind: resolved.propertyKind,
      isTestTraffic: isTest || resolved.isFixture
    })
  );

  const confirmed = await insertFunnelEvent(
    baseServerDoc({
      eventType: 'booking_confirmed',
      canonicalEventName: 'booking_confirmed',
      dedupeKey: buildBookingConfirmedDedupeKey(bookingId),
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed: !sessionKey && !visitorKey,
      cabinId: sanitizeObjectId(cabinId),
      cabinTypeId: sanitizeObjectId(cabinTypeId),
      unitId: booking.unitId ? sanitizeObjectId(String(booking.unitId)) : null,
      checkInDateOnly,
      checkOutDateOnly,
      nights: nightsFromDates(checkInDateOnly, checkOutDateOnly),
      adults: sanitizeGuestCount(booking.adults, { min: 0, max: 20 }),
      children: sanitizeGuestCount(booking.children, { min: 0, max: 20 }),
      priceShownCents: totalCents,
      quotedTotalCents: totalCents,
      bookingId,
      convertedBookingId: bookingId,
      checkoutId: sanitizeCheckoutId(booking.checkoutId),
      paymentId: sanitizeKey(booking.stripePaymentIntentId, 64),
      propertyKind: resolved.propertyKind,
      isTestTraffic: isTest || resolved.isFixture
    })
  );

  if (booking.stripePaymentIntentId) {
    await recordServerPaymentEvent({
      eventName: 'payment_succeeded',
      paymentId: String(booking.stripePaymentIntentId),
      stateCode: 'succeeded',
      sessionKey,
      visitorKey,
      checkoutId: booking.checkoutId,
      cabinId,
      cabinTypeId,
      propertyKind: resolved.propertyKind,
      checkInDateOnly,
      checkOutDateOnly,
      quotedTotalCents: totalCents,
      origin: 'api',
      isTest
    });
  }

  return {
    skipped: false,
    created,
    confirmed,
    inserted: Boolean(created.inserted || confirmed.inserted),
    duplicate: Boolean(created.duplicate && confirmed.duplicate)
  };
}

/**
 * Valley location buyout confirmation (LocationBooking master).
 */
async function recordLocationBookingFunnelConversion(locationBooking, {
  funnelSessionKey = null,
  funnelVisitorKey = null,
  checkoutId = null,
  paymentId = null
} = {}) {
  if (!isFunnelTrackingEnabled() || !locationBooking) return { skipped: true };
  if (String(locationBooking.status || '') !== 'confirmed') return { skipped: true };

  const bookingId = locationBooking._id;
  const checkInDateOnly = locationBooking.checkIn
    ? formatSofiaDateOnly(locationBooking.checkIn)
    : null;
  const checkOutDateOnly = locationBooking.checkOut
    ? formatSofiaDateOnly(locationBooking.checkOut)
    : null;
  const totalCents = Math.max(0, Math.round(Number(locationBooking.totalPrice || 0) * 100));
  const sessionKey = sanitizeKey(funnelSessionKey);
  const visitorKey = sanitizeKey(funnelVisitorKey);

  const created = await insertFunnelEvent(
    baseServerDoc({
      eventType: 'booking_created',
      canonicalEventName: 'booking_created',
      dedupeKey: `bcr:loc:${String(bookingId)}`,
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed: !sessionKey && !visitorKey,
      locationId: 'valley',
      propertyKind: 'valley',
      checkInDateOnly,
      checkOutDateOnly,
      nights: nightsFromDates(checkInDateOnly, checkOutDateOnly),
      adults: sanitizeGuestCount(locationBooking.adults, { min: 0, max: 50 }),
      children: sanitizeGuestCount(locationBooking.children, { min: 0, max: 50 }),
      priceShownCents: totalCents,
      quotedTotalCents: totalCents,
      bookingId,
      checkoutId: sanitizeCheckoutId(checkoutId),
      paymentId: sanitizeKey(paymentId || locationBooking.stripePaymentIntentId, 64)
    })
  );

  const confirmed = await insertFunnelEvent(
    baseServerDoc({
      eventType: 'booking_confirmed',
      canonicalEventName: 'booking_confirmed',
      dedupeKey: `bcf:loc:${String(bookingId)}`,
      origin: 'api',
      sessionKey,
      visitorKey,
      identitySuppressed: !sessionKey && !visitorKey,
      locationId: 'valley',
      propertyKind: 'valley',
      checkInDateOnly,
      checkOutDateOnly,
      nights: nightsFromDates(checkInDateOnly, checkOutDateOnly),
      adults: sanitizeGuestCount(locationBooking.adults, { min: 0, max: 50 }),
      children: sanitizeGuestCount(locationBooking.children, { min: 0, max: 50 }),
      priceShownCents: totalCents,
      quotedTotalCents: totalCents,
      bookingId,
      checkoutId: sanitizeCheckoutId(checkoutId),
      paymentId: sanitizeKey(paymentId || locationBooking.stripePaymentIntentId, 64)
    })
  );

  return {
    skipped: false,
    created,
    confirmed,
    inserted: Boolean(created.inserted || confirmed.inserted),
    duplicate: Boolean(created.duplicate && confirmed.duplicate)
  };
}

module.exports = {
  isFunnelTrackingEnabled,
  mapQuoteFailureClass,
  classifyRequestTraffic,
  recordClientFunnelEvent,
  recordQuoteFunnelOutcome,
  recordServerCheckoutStarted,
  recordServerPaymentEvent,
  recordBookingFunnelConversion,
  recordLocationBookingFunnelConversion,
  CLIENT_PAYLOAD_ALLOWLIST
};
