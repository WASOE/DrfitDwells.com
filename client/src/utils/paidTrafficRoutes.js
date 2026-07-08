import { localizePath, stripLocaleFromPath } from './localizedRoutes';

export const PAID_TRAFFIC_LANDING_PATH = '/off-grid-stays-bulgaria';
export const PAID_TRAFFIC_BOOKING_HASH = 'details';

/**
 * Mobile sticky CTA clearance: pt-3 + min-h-44 button + pb min 1rem + small tap buffer.
 * Matches the fixed bar in OffGridStaysBulgaria (measured ~73px before safe-area).
 */
export const PAID_TRAFFIC_MOBILE_STICKY_CLEARANCE =
  'calc(5.25rem + max(1rem, env(safe-area-inset-bottom, 0px)))';

/**
 * Build a React Router location from paid-traffic stay meta `route` (not listingSlug).
 * @param {string} route - Canonical path from PAID_TRAFFIC_STAY_META.route
 * @param {'en'|'bg'} language
 * @param {{ hash?: string }} [options]
 * @returns {{ pathname: string, hash?: string }}
 */
export function buildPaidTrafficStayNavTarget(route, language, { hash } = {}) {
  const pathname = localizePath(route, language);
  if (!hash) return { pathname };
  const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
  return { pathname, hash: normalizedHash };
}

export function isPaidTrafficLandingPath(pathname) {
  return stripLocaleFromPath(pathname || '') === PAID_TRAFFIC_LANDING_PATH;
}

/** Scroll to the stay cards section on the paid-traffic landing page. */
export function scrollToPaidTrafficStays() {
  const el = document.getElementById('stays');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return true;
  }
  return false;
}
