/**
 * Redact sensitive query values from URLs before writing access logs (e.g. Morgan).
 * Creator portal magic links use GET /api/creator-portal/verify?token=...
 */
function redactAccessLogUrl(originalUrl) {
  if (typeof originalUrl !== 'string' || !originalUrl) return originalUrl || '';
  const q = originalUrl.indexOf('?');
  if (q === -1) return originalUrl;
  const pathPart = originalUrl.slice(0, q);
  if (pathPart !== '/api/creator-portal/verify') return originalUrl;
  return originalUrl.replace(/([?&])token=[^&]*/gi, '$1token=[redacted]');
}

module.exports = { redactAccessLogUrl };
