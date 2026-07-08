import { stripLocaleFromPath } from './localizedRoutes';

export const PAID_TRAFFIC_LANDING_PATH = '/off-grid-stays-bulgaria';

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
