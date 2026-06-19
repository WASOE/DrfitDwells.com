'use strict';

const mongoose = require('mongoose');
const { ATTRIBUTION_ALLOWLIST, PROPERTY_KINDS, PII_REJECT_FIELDS } = require('./funnelEventConstants');

function sanitizeText(value, max = 500) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  return v.slice(0, max);
}

function sanitizeKey(value, max = 120) {
  if (value == null) return null;
  const v = String(value).trim().replace(/[^a-zA-Z0-9_.:-]/g, '');
  if (!v) return null;
  return v.slice(0, max);
}

function sanitizeDateOnly(value) {
  if (value == null) return null;
  const v = String(value).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function sanitizeObjectId(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(v)) return null;
  return v;
}

function sanitizeGuestCount(value, { min = 0, max = 20 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function sanitizePropertyKind(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  return PROPERTY_KINDS.includes(v) ? v : null;
}

function sanitizeCheckoutId(value) {
  return sanitizeKey(value, 64);
}

function sanitizeAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out = {};
  for (const key of ATTRIBUTION_ALLOWLIST) {
    const val = sanitizeText(input[key], key === 'landingPath' ? 1000 : 500);
    if (val) out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function rejectPiiFields(body) {
  if (!body || typeof body !== 'object') return false;
  return PII_REJECT_FIELDS.some((field) => body[field] != null);
}

function resolveEntityFromBody(body = {}) {
  const cabinId = sanitizeObjectId(body.cabinId);
  const cabinTypeId = sanitizeObjectId(body.cabinTypeId);
  if (cabinId && cabinTypeId) {
    return { entityType: 'unknown', entityId: 'unknown', cabinId: null, cabinTypeId: null };
  }
  if (cabinId) {
    return { entityType: 'cabin', entityId: cabinId, cabinId, cabinTypeId: null };
  }
  if (cabinTypeId) {
    return { entityType: 'cabinType', entityId: cabinTypeId, cabinId: null, cabinTypeId };
  }
  return { entityType: 'unknown', entityId: 'unknown', cabinId: null, cabinTypeId: null };
}

function extractDatesFromBody(body = {}) {
  const checkIn =
    sanitizeDateOnly(body.checkInDateOnly) ||
    sanitizeDateOnly(body.checkIn && String(body.checkIn).slice(0, 10));
  const checkOut =
    sanitizeDateOnly(body.checkOutDateOnly) ||
    sanitizeDateOnly(body.checkOut && String(body.checkOut).slice(0, 10));
  return { checkInDateOnly: checkIn, checkOutDateOnly: checkOut };
}

module.exports = {
  sanitizeText,
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
};
