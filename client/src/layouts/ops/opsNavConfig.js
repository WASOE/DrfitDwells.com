/**
 * Shared OPS navigation config — single source for desktop nav, mobile tabs, and More sheet.
 * Batch 1: config + matchers only; OpsLayout still uses inline navItems until wired in Batch 2+.
 */

/** @typedef {'home' | 'calendar' | 'guests' | 'finance' | 'more'} OpsMobileTabId */

/** All OPS top-nav destinations in current desktop order (OpsLayout.jsx). */
export const OPS_NAV_ITEMS = [
  { to: '/ops', label: 'Dashboard', end: true },
  { to: '/ops/calendar', label: 'Calendar' },
  { to: '/ops/cleaning', label: 'Cleaning' },
  { to: '/ops/reservations', label: 'Reservations' },
  { to: '/ops/payments', label: 'Payments' },
  { to: '/ops/promo-codes', label: 'Promo codes' },
  { to: '/ops/creator-partners', label: 'Creator partners' },
  { to: '/ops/sync', label: 'Sync' },
  { to: '/ops/cabins', label: 'Cabins' },
  { to: '/ops/reviews', label: 'Reviews' },
  { to: '/ops/communications', label: 'Comms' },
  { to: '/ops/messaging', label: 'Messaging' },
  { to: '/ops/gift-vouchers', label: 'Gift vouchers' },
  { to: '/ops/manual-review', label: 'Manual' },
  { to: '/ops/readiness', label: 'Readiness' },
  { to: '/ops/settings/cleaning', label: 'Cleaning settings' }
];

/** @type {Record<OpsMobileTabId, readonly string[]>} */
export const OPS_MOBILE_TAB_ROUTE_PREFIXES = {
  home: ['/ops'],
  calendar: ['/ops/calendar', '/ops/sync'],
  guests: ['/ops/reservations', '/ops/messaging', '/ops/communications', '/ops/reviews'],
  finance: ['/ops/payments', '/ops/promo-codes', '/ops/gift-vouchers'],
  more: [
    '/ops/creator-partners',
    '/ops/cabins',
    '/ops/manual-review',
    '/ops/readiness',
    '/ops/cleaning',
    '/ops/settings/cleaning'
  ]
};

/** Fixed bottom tab bar entries (< md). More tab opens sheet; active when on a More-group route. */
export const OPS_MOBILE_TABS = [
  { id: 'home', label: 'Home', to: '/ops', end: true },
  { id: 'calendar', label: 'Calendar', to: '/ops/calendar' },
  { id: 'guests', label: 'Guests', to: '/ops/reservations' },
  { id: 'finance', label: 'Finance', to: '/ops/payments' },
  { id: 'more', label: 'More', to: null }
];

/** Full OPS mobile menu (< md More sheet). All 14 destinations; bottom tabs remain shortcuts. */
export const OPS_MORE_GROUPS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    items: [{ to: '/ops', label: 'Dashboard', end: true }]
  },
  {
    id: 'calendar',
    label: 'Calendar',
    items: [
      { to: '/ops/calendar', label: 'Calendar' },
      { to: '/ops/sync', label: 'Sync' }
    ]
  },
  {
    id: 'guests',
    label: 'Guests',
    items: [
      { to: '/ops/reservations', label: 'Reservations' },
      { to: '/ops/messaging', label: 'Messaging' },
      { to: '/ops/communications', label: 'Comms' },
      { to: '/ops/reviews', label: 'Reviews' }
    ]
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { to: '/ops/payments', label: 'Payments' },
      { to: '/ops/promo-codes', label: 'Promo codes' },
      { to: '/ops/gift-vouchers', label: 'Gift vouchers' }
    ]
  },
  {
    id: 'property-partners',
    label: 'Property & partners',
    items: [
      { to: '/ops/cabins', label: 'Cabins' },
      { to: '/ops/creator-partners', label: 'Creator partners' }
    ]
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/ops/cleaning', label: 'Cleaning' },
      { to: '/ops/settings/cleaning', label: 'Cleaning settings' },
      { to: '/ops/manual-review', label: 'Manual' },
      { to: '/ops/readiness', label: 'Readiness' }
    ]
  }
];

/**
 * @param {string | null | undefined} pathname
 * @returns {boolean}
 */
export function isOpsHomePath(pathname) {
  const path = pathname || '';
  return path === '/ops' || path === '/ops/';
}

/**
 * @param {string | null | undefined} pathname
 * @param {string} prefix
 * @returns {boolean}
 */
function pathMatchesPrefix(pathname, prefix) {
  const path = pathname || '';
  if (prefix === '/ops') {
    return isOpsHomePath(path);
  }
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Active mobile tab from router pathname (not sheet open state).
 * @param {string | null | undefined} pathname
 * @returns {OpsMobileTabId | null}
 */
export function getActiveOpsMobileTabId(pathname) {
  if (isOpsHomePath(pathname)) {
    return 'home';
  }

  const path = pathname || '';
  /** @type {OpsMobileTabId[]} */
  const tabOrder = ['calendar', 'guests', 'finance', 'more'];

  for (const tabId of tabOrder) {
    const prefixes = OPS_MOBILE_TAB_ROUTE_PREFIXES[tabId];
    if (prefixes.some((prefix) => pathMatchesPrefix(path, prefix))) {
      return tabId;
    }
  }

  return null;
}

/**
 * @param {string | null | undefined} pathname
 * @param {OpsMobileTabId} tabId
 * @returns {boolean}
 */
export function matchOpsMobileTab(pathname, tabId) {
  return getActiveOpsMobileTabId(pathname) === tabId;
}

/**
 * Whether pathname is a More-group route (More tab active styling).
 * @param {string | null | undefined} pathname
 * @returns {boolean}
 */
export function isOpsMoreRoute(pathname) {
  return matchOpsMobileTab(pathname, 'more');
}

/**
 * Whether pathname matches any configured OPS nav or child route prefix.
 * @param {string | null | undefined} pathname
 * @returns {boolean}
 */
export function isOpsNavPath(pathname) {
  if (!pathname?.startsWith('/ops')) {
    return false;
  }
  return getActiveOpsMobileTabId(pathname) !== null;
}
