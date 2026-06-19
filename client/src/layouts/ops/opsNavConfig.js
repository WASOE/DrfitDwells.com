/**
 * Shared OPS navigation config — single source for desktop nav, mobile tabs, and More sheet.
 * Batch 1: config + matchers only; OpsLayout still uses inline navItems until wired in Batch 2+.
 */

/** @typedef {'home' | 'calendar' | 'guests' | 'finance' | 'more'} OpsMobileTabId */

/** Frontend route prefixes → module keys (longest match first). Keep in sync with server opsModuleRegistry. */
const OPS_FRONTEND_MODULE_ROUTES = [
  { prefix: '/ops/settings/cleaning', module: 'cleaning' },
  { prefix: '/ops/cleaning', module: 'cleaning' },
  { prefix: '/ops/users', module: 'users' },
  { prefix: '/ops/reservations', module: 'reservations' },
  { prefix: '/ops/gift-vouchers', module: 'finance' },
  { prefix: '/ops/conversion', module: 'finance' },
  { prefix: '/ops/insights', module: 'finance' },
  { prefix: '/ops/promo-codes', module: 'finance' },
  { prefix: '/ops/payments', module: 'finance' },
  { prefix: '/ops/creator-partners', module: 'property' },
  { prefix: '/ops/cabins', module: 'property' },
  { prefix: '/ops/messaging', module: 'guests_comms' },
  { prefix: '/ops/communications', module: 'guests_comms' },
  { prefix: '/ops/reviews', module: 'guests_comms' },
  { prefix: '/ops/manual-review', module: 'operations' },
  { prefix: '/ops/readiness', module: 'operations' },
  { prefix: '/ops/sync', module: 'calendar' },
  { prefix: '/ops/calendar', module: 'calendar' },
  { prefix: '/ops', module: 'dashboard' }
];

/** Optional action required to show/use a nav destination. */
const OPS_ROUTE_ACTIONS = {
  '/ops/settings/cleaning': 'ops.cleaning.settings_read',
  '/ops/users': 'ops.users.manage'
};

/** All OPS top-nav destinations in current desktop order (OpsLayout.jsx). */
export const OPS_NAV_ITEMS = [
  { to: '/ops', label: 'Dashboard', end: true, module: 'dashboard' },
  { to: '/ops/calendar', label: 'Calendar', module: 'calendar' },
  { to: '/ops/cleaning', label: 'Cleaning', module: 'cleaning', action: 'ops.cleaning.view' },
  { to: '/ops/reservations', label: 'Reservations', module: 'reservations' },
  { to: '/ops/payments', label: 'Payments', module: 'finance' },
  { to: '/ops/promo-codes', label: 'Promo codes', module: 'finance' },
  { to: '/ops/creator-partners', label: 'Creator partners', module: 'property' },
  { to: '/ops/sync', label: 'Sync', module: 'calendar' },
  { to: '/ops/cabins', label: 'Cabins', module: 'property' },
  { to: '/ops/reviews', label: 'Reviews', module: 'guests_comms' },
  { to: '/ops/communications', label: 'Comms', module: 'guests_comms' },
  { to: '/ops/messaging', label: 'Messaging', module: 'guests_comms' },
  { to: '/ops/gift-vouchers', label: 'Gift vouchers', module: 'finance' },
  { to: '/ops/insights', label: 'Insights', module: 'finance' },
  { to: '/ops/conversion', label: 'Conversion', module: 'finance' },
  { to: '/ops/manual-review', label: 'Manual', module: 'operations' },
  { to: '/ops/readiness', label: 'Readiness', module: 'operations' },
  {
    to: '/ops/settings/cleaning',
    label: 'Cleaning settings',
    module: 'cleaning',
    action: 'ops.cleaning.settings_read'
  },
  {
    to: '/ops/users',
    label: 'Users',
    module: 'users',
    action: 'ops.users.manage'
  }
];

/** @type {Record<OpsMobileTabId, readonly string[]>} */
export const OPS_MOBILE_TAB_ROUTE_PREFIXES = {
  home: ['/ops'],
  calendar: ['/ops/calendar', '/ops/sync'],
  guests: ['/ops/reservations', '/ops/messaging', '/ops/communications', '/ops/reviews'],
  finance: ['/ops/payments', '/ops/promo-codes', '/ops/gift-vouchers', '/ops/insights', '/ops/conversion'],
  more: [
    '/ops/creator-partners',
    '/ops/cabins',
    '/ops/manual-review',
    '/ops/readiness',
    '/ops/cleaning',
    '/ops/settings/cleaning',
    '/ops/users'
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
      { to: '/ops/gift-vouchers', label: 'Gift vouchers' },
      { to: '/ops/insights', label: 'Insights' },
      { to: '/ops/conversion', label: 'Conversion' }
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
      { to: '/ops/readiness', label: 'Readiness' },
      { to: '/ops/users', label: 'Users' }
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
  return getActiveOpsMobileTabId(pathname) !== null || resolveOpsFrontendModule(pathname) === 'cleaning';
}

export function resolveOpsFrontendModule(pathname) {
  const path = pathname || '';
  if (!path.startsWith('/ops')) {
    return null;
  }
  for (const entry of OPS_FRONTEND_MODULE_ROUTES) {
    if (path === entry.prefix || path.startsWith(`${entry.prefix}/`)) {
      return entry.module;
    }
  }
  return null;
}

function sessionHasModule(session, moduleKey) {
  const modules = session?.modules || [];
  if (modules.includes('*')) {
    return true;
  }
  return modules.includes(moduleKey);
}

function sessionHasAction(session, action) {
  if (!action) {
    return true;
  }
  return (session?.actions || []).includes(action);
}

export function canAccessNavItem(item, session) {
  if (!session?.authenticated) {
    return false;
  }
  if (session.modules?.includes('*')) {
    return sessionHasAction(session, item.action);
  }
  if (item.module && !sessionHasModule(session, item.module)) {
    return false;
  }
  return sessionHasAction(session, item.action);
}

export function filterOpsNavItems(items, session) {
  return items.filter((item) => canAccessNavItem(item, session));
}

export function filterOpsMoreGroups(groups, session) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const navItem = OPS_NAV_ITEMS.find((entry) => entry.to === item.to);
        const module = navItem?.module || resolveOpsFrontendModule(item.to);
        const action = navItem?.action || OPS_ROUTE_ACTIONS[item.to];
        return canAccessNavItem({ module, action }, session);
      })
    }))
    .filter((group) => group.items.length > 0);
}

export function canAccessOpsFrontendPath(pathname, session) {
  if (!session?.authenticated) {
    return false;
  }
  if (session.modules?.includes('*')) {
    return true;
  }
  const moduleKey = resolveOpsFrontendModule(pathname);
  if (!moduleKey) {
    return session.role === 'cleaner' ? false : true;
  }
  if (!sessionHasModule(session, moduleKey)) {
    return false;
  }
  const exactMeta = OPS_NAV_ITEMS.find((item) => item.to === pathname);
  const action = exactMeta?.action || OPS_ROUTE_ACTIONS[pathname];
  return sessionHasAction(session, action);
}

export function isCleanerOnlySession(session) {
  const modules = session?.modules || [];
  return session?.role === 'cleaner' || (modules.length === 1 && modules[0] === 'cleaning');
}
