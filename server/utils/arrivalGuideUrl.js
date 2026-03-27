const RELATIVE_GUIDE_PATH_REGEX = /^\/guides\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

function isSafeAbsoluteHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_err) {
    return false;
  }
}

function isSafeArrivalGuideUrl(value) {
  if (!value) return true;
  const v = String(value).trim();
  if (!v) return true;
  return isSafeAbsoluteHttpUrl(v) || RELATIVE_GUIDE_PATH_REGEX.test(v);
}

function resolveGuideUrl(raw, appUrl) {
  if (!raw) return '';
  const value = String(raw).trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const base = String(appUrl || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}${value.startsWith('/') ? value : `/${value}`}`;
}

function isPdfUrl(url) {
  return /\.pdf($|\?)/i.test(String(url || ''));
}

module.exports = {
  isSafeArrivalGuideUrl,
  resolveGuideUrl,
  isPdfUrl
};
