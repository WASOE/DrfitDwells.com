/**
 * Harden client-supplied metaClientContext for Booking persistence + Meta CAPI.
 * eventSourceUrl: must be absolute http(s) URL whose origin is allowlisted.
 */

function normalizeOriginList(raw) {
  const origins = new Set();
  if (typeof raw !== 'string' || !raw.trim()) return origins;
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      origins.add(u.origin);
    } catch {
      continue;
    }
  }
  return origins;
}

/**
 * Origins allowed for eventSourceUrl.
 * META_CLIENT_CONTEXT_ALLOWED_ORIGINS overrides when set (comma-separated origins).
 * Otherwise uses CORS_ORIGINS; if empty, same localhost defaults as server CORS.
 */
function getAllowedOriginsSet() {
  const explicit = process.env.META_CLIENT_CONTEXT_ALLOWED_ORIGINS;
  if (explicit && String(explicit).trim()) {
    return normalizeOriginList(explicit);
  }
  const cors = process.env.CORS_ORIGINS || '';
  if (String(cors).trim()) {
    return normalizeOriginList(cors);
  }
  return normalizeOriginList('http://localhost:5173,http://localhost:3000');
}

/**
 * @param {string} urlString
 * @param {Set<string>} allowedOrigins
 * @returns {string|null}
 */
function sanitizeEventSourceUrl(urlString, allowedOrigins) {
  if (typeof urlString !== 'string') return null;
  const trimmed = urlString.trim().slice(0, 2000);
  if (!trimmed) return null;
  let u;
  try {
    u = new URL(trimmed);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (!allowedOrigins || allowedOrigins.size === 0) return null;
  if (!allowedOrigins.has(u.origin)) return null;
  return trimmed;
}

function clipString(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/**
 * @param {unknown} raw
 * @param {{ allowedOriginsSet?: Set<string> }} [options] — inject for tests
 * @returns {undefined | { eventSourceUrl?: string, fbp?: string, fbc?: string, sessionId?: string }}
 */
function sanitizeMetaClientContext(raw, options = {}) {
  if (!raw || typeof raw !== 'object') return undefined;
  const allowedOriginsSet = options.allowedOriginsSet ?? getAllowedOriginsSet();

  const urlRaw = clipString(raw.eventSourceUrl, 2000);
  const eventSourceUrl = urlRaw
    ? sanitizeEventSourceUrl(urlRaw, allowedOriginsSet)
    : null;

  const fbp = clipString(raw.fbp, 500);
  const fbc = clipString(raw.fbc, 500);
  const sessionId = clipString(raw.sessionId, 200);

  const o = {};
  if (eventSourceUrl) o.eventSourceUrl = eventSourceUrl;
  if (fbp) o.fbp = fbp;
  if (fbc) o.fbc = fbc;
  if (sessionId) o.sessionId = sessionId;
  return Object.keys(o).length ? o : undefined;
}

module.exports = {
  sanitizeMetaClientContext,
  getAllowedOriginsSet,
  sanitizeEventSourceUrl,
  normalizeOriginList
};
