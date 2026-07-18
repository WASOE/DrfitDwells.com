'use strict';

const crypto = require('crypto');
const { sanitizeKey } = require('./funnelEventSanitize');

function resolveFunnelIdentity(sessionKey, visitorKey) {
  const session = sanitizeKey(sessionKey);
  const visitor = sanitizeKey(visitorKey);
  if (session) return { kind: 'session', value: session };
  if (visitor) return { kind: 'visitor', value: visitor };
  return { kind: 'orphan', value: crypto.randomUUID() };
}

function dayBucket(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function minuteBucket(now = new Date()) {
  const iso = now.toISOString();
  return `${iso.slice(0, 10)}:${iso.slice(11, 16)}`;
}

function promoHash8(promoCode, voucherCode) {
  const promo = String(promoCode || '').trim().toLowerCase();
  const voucher = String(voucherCode || '').trim().toLowerCase();
  if (!promo && !voucher) return 'none';
  return crypto
    .createHash('sha256')
    .update(`${promo}|${voucher}`, 'utf8')
    .digest('hex')
    .slice(0, 8);
}

function buildPropertyViewDedupeKey({ sessionKey, entityType, entityId, now = new Date() }) {
  return `pv:${sessionKey}:${entityType}:${entityId}:${dayBucket(now)}`;
}

function buildSearchResultsDedupeKey({
  sessionKey,
  checkInDateOnly,
  checkOutDateOnly,
  adults,
  children,
  now = new Date()
}) {
  return `sr:${sessionKey}:${checkInDateOnly || ''}:${checkOutDateOnly || ''}:${adults ?? ''}:${children ?? ''}:${dayBucket(now)}`;
}

function buildConfirmPageViewDedupeKey({
  sessionKey,
  entityType,
  entityId,
  checkInDateOnly,
  checkOutDateOnly
}) {
  return `cp:${sessionKey}:${entityType}:${entityId}:${checkInDateOnly || ''}:${checkOutDateOnly || ''}`;
}

function buildQuoteReceivedDedupeKey({
  sessionKey,
  visitorKey,
  entityType,
  entityId,
  checkInDateOnly,
  checkOutDateOnly,
  adults,
  children,
  priceCents,
  promoCode,
  voucherCode
}) {
  const identity = resolveFunnelIdentity(sessionKey, visitorKey);
  const promo = promoHash8(promoCode, voucherCode);
  if (identity.kind === 'orphan') {
    return `qr:orphan:${identity.value}`;
  }
  return `qr:${identity.value}:${entityType}:${entityId}:${checkInDateOnly || ''}:${checkOutDateOnly || ''}:${adults ?? ''}:${children ?? ''}:${priceCents ?? ''}:${promo}`;
}

function buildQuoteFailedDedupeKey({
  sessionKey,
  visitorKey,
  entityType,
  entityId,
  checkInDateOnly,
  checkOutDateOnly,
  quoteFailureClass,
  now = new Date()
}) {
  const identity = resolveFunnelIdentity(sessionKey, visitorKey);
  if (identity.kind === 'orphan') {
    return `qf:orphan:${identity.value}`;
  }
  return `qf:${identity.value}:${entityType}:${entityId}:${checkInDateOnly || ''}:${checkOutDateOnly || ''}:${quoteFailureClass || 'unknown'}:${minuteBucket(now)}`;
}

function buildBookingConvertedDedupeKey(bookingId) {
  return `bc:${String(bookingId)}`;
}

function buildCheckoutStartedDedupeKey({
  sessionKey,
  checkoutId,
  entityType,
  entityId,
  checkInDateOnly,
  checkOutDateOnly
}) {
  const checkout = sanitizeKey(checkoutId);
  if (checkout) {
    return `cs:${sessionKey}:${checkout}`;
  }
  return `cs:${sessionKey}:${entityType}:${entityId}:${checkInDateOnly || ''}:${checkOutDateOnly || ''}`;
}

function buildPaymentResilienceDedupeKey({ eventType, checkoutId, sessionKey }) {
  const checkout = sanitizeKey(checkoutId) || 'none';
  const session = sanitizeKey(sessionKey) || 'nosession';
  return `pr:${eventType}:${checkout}:${session}`;
}

module.exports = {
  resolveFunnelIdentity,
  dayBucket,
  minuteBucket,
  promoHash8,
  buildPropertyViewDedupeKey,
  buildSearchResultsDedupeKey,
  buildConfirmPageViewDedupeKey,
  buildQuoteReceivedDedupeKey,
  buildQuoteFailedDedupeKey,
  buildBookingConvertedDedupeKey,
  buildCheckoutStartedDedupeKey,
  buildPaymentResilienceDedupeKey
};
