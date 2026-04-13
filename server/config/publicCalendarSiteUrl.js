/**
 * Optional absolute base for public calendar URLs shown in ops (copy/paste for channel imports).
 * Example: https://driftdwells.com  — no trailing slash.
 */
function resolvePublicSiteBaseUrl() {
  const raw = process.env.PUBLIC_SITE_ORIGIN || process.env.PUBLIC_APP_URL || '';
  return String(raw).trim().replace(/\/$/, '');
}

function buildPublicUnitIcsPath(unitId) {
  return `/api/public/calendar/unit/${String(unitId)}.ics`;
}

/** @returns {string|null} Null if no env set (client may use window.location.origin + path). */
function buildAbsoluteUnitIcsUrl(unitId) {
  const base = resolvePublicSiteBaseUrl();
  if (!base) return null;
  return `${base}${buildPublicUnitIcsPath(unitId)}`;
}

module.exports = {
  resolvePublicSiteBaseUrl,
  buildPublicUnitIcsPath,
  buildAbsoluteUnitIcsUrl
};
