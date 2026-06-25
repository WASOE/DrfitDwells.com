const { KNOWN_CABIN_ID_TO_SLUG } = require('../utils/staySlug');

const MONGO_OBJECT_ID = /^[a-f0-9]{24}$/i;
const CABIN_CONFIRM_PATH = /^\/(?:bg\/)?cabin\/[a-f0-9]{24}\/confirm(?:\/|$)/i;

/**
 * Match legacy public cabin detail paths only:
 *   /cabin/:id
 *   /bg/cabin/:id
 * Excludes /cabin, /cabin/faq, and /cabin/:id/confirm.
 */
function parseLegacyCabinDetailPath(pathname = '/') {
  const normalized = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (normalized === '/cabin' || normalized === '/bg/cabin') return null;
  if (CABIN_CONFIRM_PATH.test(normalized)) return null;

  const match = normalized.match(/^\/(?:bg\/)?cabin\/([^/]+)$/i);
  if (!match) return null;

  const cabinId = match[1];
  if (!MONGO_OBJECT_ID.test(cabinId)) return null;

  const localePrefix = normalized.startsWith('/bg/') ? '/bg' : '';
  return { cabinId, localePrefix };
}

/**
 * Build a 301 Location for known legacy cabin IDs, or null when no redirect applies.
 * Query keys with empty values are omitted (never emits a bare ?).
 */
function buildLegacyCabinRedirectLocation(pathname = '/', query = {}) {
  const parsed = parseLegacyCabinDetailPath(pathname);
  if (!parsed) return null;

  const slug = KNOWN_CABIN_ID_TO_SLUG[parsed.cabinId];
  if (!slug) return null;

  const base = `${parsed.localePrefix}/stays/${slug}`;
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry !== undefined && entry !== null && entry !== '') {
          params.append(key, String(entry));
        }
      });
      continue;
    }
    params.set(key, String(value));
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function legacyCabinDetailRedirectMiddleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  const location = buildLegacyCabinRedirectLocation(req.path, req.query);
  if (!location) return next();

  return res.redirect(301, location);
}

module.exports = {
  parseLegacyCabinDetailPath,
  buildLegacyCabinRedirectLocation,
  legacyCabinDetailRedirectMiddleware
};
