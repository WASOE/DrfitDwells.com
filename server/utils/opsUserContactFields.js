'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');

const OPS_USER_LOCALES = Object.freeze(['en', 'bg']);
const OPS_USER_PROPERTY_KINDS = Object.freeze(['cabin', 'valley']);

const DEFAULT_PHONE_COUNTRY = () =>
  String(process.env.DEFAULT_PHONE_COUNTRY || 'BG').trim() || 'BG';

/**
 * Normalize optional OPS user phone to E.164. Empty/null → { ok: true, value: null }.
 */
function normalizeOpsUserPhone(raw) {
  if (raw == null) {
    return { ok: true, value: null };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  try {
    const parsed = parsePhoneNumberFromString(
      trimmed,
      trimmed.startsWith('+') ? undefined : DEFAULT_PHONE_COUNTRY()
    );
    if (parsed && parsed.isValid()) {
      return { ok: true, value: parsed.format('E.164') };
    }
  } catch {
    // fall through
  }

  return { ok: false, value: null, message: 'Phone must be a valid E.164 number' };
}

function normalizeOpsUserLocale(locale) {
  if (locale == null || locale === '') {
    return { ok: true, value: null };
  }
  const v = String(locale).trim().toLowerCase();
  if (!OPS_USER_LOCALES.includes(v)) {
    return { ok: false, value: null, message: `Locale must be one of: ${OPS_USER_LOCALES.join(', ')}` };
  }
  return { ok: true, value: v };
}

/**
 * Dedupe and validate propertyKinds. Non-array → [].
 */
function normalizePropertyKinds(propertyKinds) {
  if (!Array.isArray(propertyKinds)) {
    return { ok: true, value: [] };
  }
  const out = [];
  const seen = new Set();
  for (const item of propertyKinds) {
    const v = String(item).trim().toLowerCase();
    if (!OPS_USER_PROPERTY_KINDS.includes(v)) {
      return {
        ok: false,
        value: [],
        message: `propertyKinds entries must be one of: ${OPS_USER_PROPERTY_KINDS.join(', ')}`
      };
    }
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return { ok: true, value: out };
}

/**
 * Apply C0 assignment rules: only cleaners retain propertyKinds.
 */
function propertyKindsForRole(role, propertyKinds) {
  if (String(role).toLowerCase() !== 'cleaner') {
    return [];
  }
  const norm = normalizePropertyKinds(propertyKinds);
  return norm.ok ? norm.value : norm.value;
}

module.exports = {
  OPS_USER_LOCALES,
  OPS_USER_PROPERTY_KINDS,
  normalizeOpsUserPhone,
  normalizeOpsUserLocale,
  normalizePropertyKinds,
  propertyKindsForRole
};
