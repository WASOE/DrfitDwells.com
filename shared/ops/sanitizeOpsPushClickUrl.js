/**
 * OPS push notification click URLs — same-origin /ops paths only.
 * Shared by the service worker and unit tests.
 */
export function sanitizeOpsPushClickUrl(rawUrl, origin) {
  const fallback = '/ops';
  const baseOrigin = origin || 'https://localhost';

  if (rawUrl == null || String(rawUrl).trim() === '') {
    return fallback;
  }

  const trimmed = String(rawUrl).trim();

  let parsed;
  try {
    parsed = new URL(trimmed, baseOrigin);
  } catch {
    return fallback;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const absolute = new URL(trimmed);
      if (absolute.origin !== new URL(baseOrigin).origin) {
        return fallback;
      }
    } catch {
      return fallback;
    }
  }

  const { pathname } = parsed;
  if (pathname === '/ops' || pathname.startsWith('/ops/')) {
    return `${pathname}${parsed.search}${parsed.hash}`;
  }

  return fallback;
}
