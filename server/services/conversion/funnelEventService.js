'use strict';

const Cabin = require('../../models/Cabin');
const CabinType = require('../../models/CabinType');
const BookingFunnelEvent = require('../../models/BookingFunnelEvent');
const { formatSofiaDateOnly } = require('../../utils/dateTime');
const {
  isFunnelTrackingEnabled,
  isClientEventType,
  isAllowedEventType,
  QUOTE_FAILURE_CLASSES,
  CLIENT_PAYLOAD_ALLOWLIST,
  MAX_BODY_BYTES,
  SCHEMA_VERSION
} = require('./funnelEventConstants');
const {
  sanitizeKey,
  sanitizeDateOnly,
  sanitizeObjectId,
  sanitizeGuestCount,
  sanitizePropertyKind,
  sanitizeCheckoutId,
  sanitizeAttribution,
  rejectPiiFields,
  resolveEntityFromBody,
  extractDatesFromBody
} = require('./funnelEventSanitize');
const {
  buildPropertyViewDedupeKey,
  buildSearchResultsDedupeKey,
  buildConfirmPageViewDedupeKey,
  buildQuoteReceivedDedupeKey,
  buildQuoteFailedDedupeKey,
  buildBookingConvertedDedupeKey
} = require('./funnelEventDedupe');

async function resolvePropertyKindFromEntity({ cabinId, cabinTypeId }) {
  if (cabinId) {
    const cabin = await Cabin.findById(cabinId).select('propertyKind').lean();
    return sanitizePropertyKind(cabin?.propertyKind) || null;
  }
  if (cabinTypeId) {
    const cabinType = await CabinType.findById(cabinTypeId).select('propertyKind').lean();
    return sanitizePropertyKind(cabinType?.propertyKind) || null;
  }
  return null;
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

function buildClientEventDoc(body) {
  const eventType = String(body?.eventType || '').trim();
  if (!isClientEventType(eventType)) {
    const error = new Error('Invalid client event type');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }

  const sessionKey = sanitizeKey(body.sessionKey);
  if (!sessionKey) {
    const error = new Error('sessionKey is required');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const visitorKey = sanitizeKey(body.visitorKey);
  const entity = resolveEntityFromBody(body);
  const dates = extractDatesFromBody(body);
  const adults = sanitizeGuestCount(body.adults, { min: 1, max: 10 });
  const children = sanitizeGuestCount(body.children, { min: 0, max: 10 }) ?? 0;
  const attribution = sanitizeAttribution(body.attribution);

  let dedupeKey;
  if (eventType === 'property_view') {
    if (!entity.cabinId && !entity.cabinTypeId) {
      const error = new Error('cabinId or cabinTypeId required');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    dedupeKey = buildPropertyViewDedupeKey({
      sessionKey,
      entityType: entity.entityType,
      entityId: entity.entityId
    });
  } else if (eventType === 'search_results') {
    if (!dates.checkInDateOnly || !dates.checkOutDateOnly) {
      const error = new Error('checkInDateOnly and checkOutDateOnly required');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    dedupeKey = buildSearchResultsDedupeKey({
      sessionKey,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      adults: adults ?? 1,
      children
    });
  } else if (eventType === 'confirm_page_view') {
    if (!entity.cabinId && !entity.cabinTypeId) {
      const error = new Error('cabinId or cabinTypeId required');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    if (!dates.checkInDateOnly || !dates.checkOutDateOnly) {
      const error = new Error('checkInDateOnly and checkOutDateOnly required');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    dedupeKey = buildConfirmPageViewDedupeKey({
      sessionKey,
      entityType: entity.entityType,
      entityId: entity.entityId,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly
    });
  }

  const doc = {
    eventType,
    source: 'client',
    dedupeKey,
    sessionKey,
    visitorKey: visitorKey || null,
    cabinId: entity.cabinId,
    cabinTypeId: entity.cabinTypeId,
    checkInDateOnly: dates.checkInDateOnly,
    checkOutDateOnly: dates.checkOutDateOnly,
    adults: eventType === 'search_results' || eventType === 'confirm_page_view' ? adults : sanitizeGuestCount(body.adults, { min: 0, max: 10 }),
    children,
    searchResultCount:
      eventType === 'search_results' ? sanitizeGuestCount(body.searchResultCount, { min: 0, max: 500 }) : null,
    currency: 'EUR',
    schemaVersion: SCHEMA_VERSION
  };

  const resolvedKind = sanitizePropertyKind(body.propertyKind);
  if (resolvedKind) doc.propertyKind = resolvedKind;

  if (attribution) doc.attribution = attribution;
  return doc;
}

async function recordClientFunnelEvent(body) {
  if (!isFunnelTrackingEnabled()) {
    return { skipped: true };
  }
  if (!body || typeof body !== 'object' || rejectPiiFields(body)) {
    const error = new Error('Invalid funnel event');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const eventType = String(body.eventType || '').trim();
  if (!isAllowedEventType(eventType) || !isClientEventType(eventType)) {
    const error = new Error('Invalid funnel event');
    error.code = 'INVALID_EVENT_TYPE';
    throw error;
  }

  assertPayloadSize(body);
  const doc = buildClientEventDoc(body);

  if (!doc.propertyKind && (doc.cabinId || doc.cabinTypeId)) {
    doc.propertyKind = await resolvePropertyKindFromEntity({
      cabinId: doc.cabinId,
      cabinTypeId: doc.cabinTypeId
    });
  }

  const result = await insertFunnelEvent(doc);
  return { skipped: false, ...result };
}

async function recordQuoteFunnelOutcome(req, outcome) {
  if (!isFunnelTrackingEnabled() || !outcome) return { skipped: true };

  const body = req?.body || {};
  const sessionKey = sanitizeKey(body.funnelSessionKey);
  const visitorKey = sanitizeKey(body.funnelVisitorKey);
  const entity = resolveEntityFromBody(body);
  const dates = extractDatesFromBody(body);
  const adults = sanitizeGuestCount(body.adults, { min: 0, max: 10 });
  const children = sanitizeGuestCount(body.children, { min: 0, max: 10 });

  if (outcome.kind === 'received' && outcome.result?.ok) {
    const totalPrice = Number(outcome.result.totalPrice);
    const priceShownCents = Number.isFinite(totalPrice) ? Math.max(0, Math.round(totalPrice * 100)) : null;
    const dedupeKey = buildQuoteReceivedDedupeKey({
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
      voucherCode: body.voucherCode
    });

    const propertyKind = await resolvePropertyKindFromEntity({
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId
    });

    const doc = {
      eventType: 'quote_received',
      source: 'server',
      dedupeKey,
      sessionKey: sessionKey || null,
      visitorKey: visitorKey || null,
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      adults,
      children,
      priceShownCents,
      currency: 'EUR',
      schemaVersion: SCHEMA_VERSION
    };
    if (propertyKind) doc.propertyKind = propertyKind;

    return { skipped: false, ...(await insertFunnelEvent(doc)) };
  }

  if (outcome.kind === 'failed') {
    const quoteFailureClass = mapQuoteFailureClass(outcome.result, {
      validationFailed: outcome.validationFailed
    });
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

    const propertyKind = await resolvePropertyKindFromEntity({
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId
    });

    const doc = {
      eventType: 'quote_failed',
      source: 'server',
      dedupeKey,
      sessionKey: sessionKey || null,
      visitorKey: visitorKey || null,
      cabinId: entity.cabinId,
      cabinTypeId: entity.cabinTypeId,
      checkInDateOnly: dates.checkInDateOnly,
      checkOutDateOnly: dates.checkOutDateOnly,
      adults,
      children,
      quoteFailureClass,
      currency: 'EUR',
      schemaVersion: SCHEMA_VERSION
    };
    if (propertyKind) doc.propertyKind = propertyKind;

    return { skipped: false, ...(await insertFunnelEvent(doc)) };
  }

  return { skipped: true };
}

async function recordBookingFunnelConversion(booking, { funnelSessionKey, funnelVisitorKey } = {}) {
  if (!isFunnelTrackingEnabled() || !booking) return { skipped: true };

  const status = String(booking.status || '');
  const source = String(booking.provenance?.source || '').trim();
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
  const propertyKind = await resolvePropertyKindFromEntity({
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId)
  });

  const doc = {
    eventType: 'booking_converted',
    source: 'server',
    dedupeKey: buildBookingConvertedDedupeKey(bookingId),
    sessionKey: sessionKey || null,
    visitorKey: visitorKey || null,
    cabinId: sanitizeObjectId(cabinId),
    cabinTypeId: sanitizeObjectId(cabinTypeId),
    unitId: booking.unitId ? sanitizeObjectId(String(booking.unitId)) : null,
    checkInDateOnly,
    checkOutDateOnly,
    adults: sanitizeGuestCount(booking.adults, { min: 0, max: 10 }),
    children: sanitizeGuestCount(booking.children, { min: 0, max: 10 }),
    priceShownCents: totalCents,
    currency: 'EUR',
    convertedBookingId: bookingId,
    checkoutId: sanitizeCheckoutId(booking.checkoutId),
    schemaVersion: SCHEMA_VERSION
  };
  if (propertyKind) doc.propertyKind = propertyKind;

  return { skipped: false, ...(await insertFunnelEvent(doc)) };
}

module.exports = {
  isFunnelTrackingEnabled,
  mapQuoteFailureClass,
  recordClientFunnelEvent,
  recordQuoteFunnelOutcome,
  recordBookingFunnelConversion,
  CLIENT_PAYLOAD_ALLOWLIST
};
