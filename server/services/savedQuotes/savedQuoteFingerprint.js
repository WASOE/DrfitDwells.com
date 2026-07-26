'use strict';

const crypto = require('crypto');

function normalizePromoIdentity(promoCode, voucherCode) {
  const promo = String(promoCode || '')
    .trim()
    .toUpperCase();
  const voucher = String(voucherCode || '')
    .trim()
    .toUpperCase();
  if (!promo && !voucher) return 'none';
  return crypto.createHash('sha256').update(`${promo}|${voucher}`, 'utf8').digest('hex').slice(0, 8);
}

function resolveIdentitySegment({ sessionKey, visitorKey }) {
  const session = sessionKey ? String(sessionKey).trim() : '';
  const visitor = visitorKey ? String(visitorKey).trim() : '';
  if (session) return { segment: `s:${session}`, hasBrowserIdentity: true };
  if (visitor) return { segment: `v:${visitor}`, hasBrowserIdentity: true };
  return { segment: null, hasBrowserIdentity: false };
}

/**
 * Deterministic fingerprint for upsert when browser identity is present.
 * Anonymous (no session/visitor) fingerprints are unique per call so strangers never merge.
 */
function buildQuoteFingerprint({
  propertyKind,
  entityType,
  entityId,
  checkInDateOnly,
  checkOutDateOnly,
  adults,
  children,
  quotedTotalCents,
  promoCode,
  voucherCode,
  sessionKey,
  visitorKey,
  anonymousNonce = null
}) {
  const promoHash = normalizePromoIdentity(promoCode, voucherCode);
  const identity = resolveIdentitySegment({ sessionKey, visitorKey });
  const identityPart = identity.hasBrowserIdentity
    ? identity.segment
    : `orphan:${anonymousNonce || crypto.randomUUID()}`;

  return [
    'sq',
    propertyKind || 'unknown',
    entityType || 'unknown',
    entityId || 'unknown',
    checkInDateOnly || '',
    checkOutDateOnly || '',
    Number(adults) || 0,
    Number(children) || 0,
    Number(quotedTotalCents) || 0,
    promoHash,
    identityPart
  ].join(':');
}

module.exports = {
  normalizePromoIdentity,
  resolveIdentitySegment,
  buildQuoteFingerprint
};
