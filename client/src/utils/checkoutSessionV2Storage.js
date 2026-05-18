import { formatDateOnlyLocal, parseDateOnlyLocal } from './dateOnly';

export const CHECKOUT_SESSION_V2_STORAGE_KEY = 'confirm-booking-checkout-session-v2';

/**
 * clientSecretPresent is a debug/remount hint only.
 * Do not use it as the authority for PaymentIntent reuse — reuse requires in-memory
 * clientSecret plus matching checkoutId, canonicalPaymentIntentId, and quoteSnapshotHash.
 */

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toDateOnlyString(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const parsed = value instanceof Date ? value : parseDateOnlyLocal(value);
  if (!parsed) return '';
  return formatDateOnlyLocal(parsed);
}

function normalizeEntityType(entityType) {
  const normalized = trimString(entityType).toLowerCase();
  return normalized === 'cabintype' || normalized === 'cabin_type' ? 'cabinType' : 'cabin';
}

/**
 * Commercial boundary key aligned with server buildCommercialBoundaryKey (entity + dates only).
 */
export function buildCheckoutSessionV2BoundaryKey({ entityType, entityId, checkIn, checkOut }) {
  const type = normalizeEntityType(entityType);
  const id = trimString(entityId);
  const checkInDateOnly = toDateOnlyString(checkIn);
  const checkOutDateOnly = toDateOnlyString(checkOut);
  return ['v1', type, id, checkInDateOnly, checkOutDateOnly].join('|');
}

function toNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

function toNullableString(value) {
  const trimmed = trimString(value);
  return trimmed || null;
}

function sanitizePersistedState(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const checkoutId = trimString(raw.checkoutId);
  const commercialBoundaryKey = trimString(raw.commercialBoundaryKey);
  if (!checkoutId || !commercialBoundaryKey) {
    return null;
  }

  return {
    checkoutId,
    commercialBoundaryKey,
    quoteSnapshotHash: trimString(raw.quoteSnapshotHash),
    sessionVersion: toNonNegativeInteger(raw.sessionVersion, 1) || 1,
    canonicalPaymentIntentId: toNullableString(raw.canonicalPaymentIntentId),
    clientSecretPresent: Boolean(raw.clientSecretPresent),
    voucherRedemptionId: toNullableString(raw.voucherRedemptionId),
    stripeAmountCents: toNonNegativeInteger(raw.stripeAmountCents, 0),
    noPaymentRequired: Boolean(raw.noPaymentRequired),
    updatedAt: trimString(raw.updatedAt) || new Date().toISOString()
  };
}

function stripSecretFields(value) {
  if (!value || typeof value !== 'object') {
    return;
  }
  delete value.clientSecret;
  delete value.client_secret;
}

export function readCheckoutSessionV2Storage(currentBoundaryKey) {
  const boundary = trimString(currentBoundaryKey);
  if (!boundary) {
    return null;
  }

  let raw = null;
  try {
    const stored = sessionStorage.getItem(CHECKOUT_SESSION_V2_STORAGE_KEY);
    if (!stored) {
      return null;
    }
    raw = JSON.parse(stored);
  } catch {
    clearCheckoutSessionV2Storage();
    return null;
  }

  stripSecretFields(raw);

  const state = sanitizePersistedState(raw);
  if (!state) {
    clearCheckoutSessionV2Storage();
    return null;
  }

  if (state.commercialBoundaryKey !== boundary) {
    clearCheckoutSessionV2Storage();
    return null;
  }

  return state;
}

export function writeCheckoutSessionV2Storage(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }

  const draft = { ...state };
  stripSecretFields(draft);

  const sanitized = sanitizePersistedState({
    ...draft,
    updatedAt: draft.updatedAt || new Date().toISOString()
  });

  if (!sanitized) {
    return false;
  }

  try {
    sessionStorage.setItem(CHECKOUT_SESSION_V2_STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch {
    return false;
  }
}

export function clearCheckoutSessionV2Storage() {
  try {
    sessionStorage.removeItem(CHECKOUT_SESSION_V2_STORAGE_KEY);
  } catch {
    // ignore quota / private mode errors
  }
}

export function isSameCheckoutSessionV2Identity(a, b) {
  if (!a || !b) {
    return false;
  }

  const checkoutIdA = trimString(a.checkoutId);
  const checkoutIdB = trimString(b.checkoutId);
  if (!checkoutIdA || checkoutIdA !== checkoutIdB) {
    return false;
  }

  const hashA = trimString(a.quoteSnapshotHash);
  const hashB = trimString(b.quoteSnapshotHash);
  if (!hashA || hashA !== hashB) {
    return false;
  }

  const canonicalA = toNullableString(a.canonicalPaymentIntentId);
  const canonicalB = toNullableString(b.canonicalPaymentIntentId);
  return canonicalA === canonicalB;
}
