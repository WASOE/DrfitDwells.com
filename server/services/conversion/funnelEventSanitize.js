'use strict';

const mongoose = require('mongoose');
const {
  ATTRIBUTION_ALLOWLIST,
  PROPERTY_KINDS,
  PII_REJECT_FIELDS,
  CLIENT_PAYLOAD_ALLOWLIST,
  FUNNEL_STAGES
} = require('./funnelEventConstants');

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

function sanitizeUuid(value) {
  if (value == null) return null;
  const v = String(value).trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
  ) {
    return null;
  }
  return v.toLowerCase();
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

function sanitizePath(value, max = 1000) {
  const v = sanitizeText(value, max);
  if (!v) return null;
  if (v.includes('<') || v.includes('>') || /javascript:/i.test(v)) return null;
  return v;
}

function sanitizeCents(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function sanitizeOccurredAt(value) {
  if (value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  // Reject extreme clock skew (> 24h future or > 30d past)
  if (d.getTime() > now + 24 * 60 * 60 * 1000) return null;
  if (d.getTime() < now - 30 * 24 * 60 * 60 * 1000) return null;
  return d;
}

function sanitizeAttribution(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out = {};
  for (const key of ATTRIBUTION_ALLOWLIST) {
    const max = key === 'landingPath' || key === 'referrer' ? 1000 : 500;
    const val = sanitizeText(input[key], max);
    if (val) out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeSelectedExtras(input) {
  if (input == null) return undefined;
  if (!Array.isArray(input)) return undefined;
  const out = [];
  for (const item of input.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue;
    const code = sanitizeKey(item.code || item.id || item.type, 64);
    const label = sanitizeText(item.label || item.name, 120);
    const qty = sanitizeGuestCount(item.quantity ?? item.qty, { min: 1, max: 50 });
    if (!code && !label) continue;
    out.push({
      ...(code ? { code } : {}),
      ...(label ? { label } : {}),
      ...(qty != null ? { quantity: qty } : {})
    });
  }
  return out.length ? out : undefined;
}

function rejectPiiFields(body) {
  if (!body || typeof body !== 'object') return false;
  return PII_REJECT_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

/**
 * Hard allowlist: only known fields survive. Nested objects sanitized separately.
 */
function applyClientAllowlist(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const allowed = new Set(CLIENT_PAYLOAD_ALLOWLIST._common);
  const out = {};
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) continue;
    out[key] = body[key];
  }
  return out;
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

function sanitizeFunnelStage(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return FUNNEL_STAGES.includes(v) ? v : null;
}

function sanitizeCoarseEnum(value, allowed, max = 40) {
  const v = sanitizeText(value, max);
  if (!v) return null;
  if (allowed && !allowed.includes(v)) return sanitizeText(v, max);
  return v;
}

module.exports = {
  sanitizeText,
  sanitizeKey,
  sanitizeUuid,
  sanitizeDateOnly,
  sanitizeObjectId,
  sanitizeGuestCount,
  sanitizePropertyKind,
  sanitizeCheckoutId,
  sanitizePath,
  sanitizeCents,
  sanitizeOccurredAt,
  sanitizeAttribution,
  sanitizeSelectedExtras,
  rejectPiiFields,
  applyClientAllowlist,
  resolveEntityFromBody,
  extractDatesFromBody,
  sanitizeFunnelStage,
  sanitizeCoarseEnum
};
