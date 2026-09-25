/**
 * Shared OPS navigation config — single source for desktop nav, mobile tabs, and More sheet.
 * Desktop sidebar groups are derived from the same records. Mobile tabs/More stay the current IA.
 */

/** @typedef {'home' | 'calendar' | 'guests' | 'finance' | 'more'} OpsMobileTabId */
/** @typedef {'home' | 'calendar' | 'guests' | 'finance' | 'property' | 'cleaning' | 'insights' | 'admin'} OpsDesktopGroupId */
/** @typedef {'exact' | 'prefix'} OpsNavMatch */

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
  { prefix: '/ops/rate-plans', module: 'finance' },
  { prefix: '/ops/pricing-calendar', module: 'finance' },
  { prefix: '/ops/payment-terms', module: 'finance' },
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

/** Admin-only frontend prefixes. Not nav destinations and not permission modules. */
export const OPS_ADMIN_ONLY_PREFIXES = Object.freeze(['/ops/design-system']);

export function isOpsAdminOnlyPath(pathname) {
  const path = pathname || '';
  return OPS_ADMIN_ONLY_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Locked desktop product groups. Admin is last. Icons are Lucide names for a later shell; not rendered here. */
export const OPS_SIDEBAR_GROUPS = Object.freeze([
  { id: 'home', label: 'Home', order: 1, icon: 'House' },
  { id: 'calendar', label: 'Calendar', order: 2, icon: 'CalendarDays' },
  { id: 'guests', label: 'Guests', order: 3, icon: 'Users' },
  { id: 'finance', label: 'Finance', order: 4, icon: 'CircleDollarSign' },
  { id: 'property', label: 'Property', order: 5, icon: 'Building2' },
  { id: 'cleaning', label: 'Cleaning', order: 6, icon: 'Sparkles' },
  { id: 'insights', label: 'Insights', order: 7, icon: 'ChartSpline' },
  { id: 'admin', label: 'Admin', order: 8, icon: 'Settings' }
]);

/**
 * All OPS destinations. Array order is the current desktop strip order (do not reshuffle in S1A).
 * desktopGroup is the future sidebar. mobileTab / moreGroupId preserve current mobile IA.
 */
export const OPS_NAV_ITEMS = [
  {
    to: '/ops',
    label: 'Dashboard',
    end: true,
    module: 'dashboard',
    desktopGroup: 'home',
    sidebarOrder: 1,
    mobileTab: 'home',
    moreGroupId: 'dashboard',
    match: 'exact'
  },
  {
    to: '/ops/calendar',
    label: 'Calendar',
    module: 'calendar',
    desktopGroup: 'calendar',
    sidebarOrder: 1,
    mobileTab: 'calendar',
    moreGroupId: 'calendar',
    match: 'prefix'
  },
  {
    to: '/ops/calendar/work-windows',
    label: 'Work windows',
    module: 'calendar',
    desktopGroup: 'calendar',
    sidebarOrder: 2,
    mobileTab: 'calendar',
    moreGroupId: 'calendar',
    match: 'prefix'
  },
  {
    to: '/ops/cleaning',
    label: 'Cleaning',
    module: 'cleaning',
    action: 'ops.cleaning.view',
    desktopGroup: 'cleaning',
    sidebarOrder: 1,
    mobileTab: 'more',
    moreGroupId: 'operations',
    match: 'prefix'
  },
  {
    to: '/ops/reservations',
    label: 'Reservations',
    module: 'reservations',
    desktopGroup: 'guests',
    sidebarOrder: 1,
    mobileTab: 'guests',
    moreGroupId: 'guests',
    match: 'prefix'
  },
  {
    to: '/ops/payments',
    label: 'Payments',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 1,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/promo-codes',
    label: 'Promo codes',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 2,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/rate-plans',
    label: 'Rate plans',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 3,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/pricing-calendar',
    label: 'Pricing Calendar',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 5,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/payment-terms',
    label: 'Payment terms',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 4,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/creator-partners',
    label: 'Creator partners',
    module: 'property',
    desktopGroup: 'property',
    sidebarOrder: 2,
    mobileTab: 'more',
    moreGroupId: 'property-partners',
    match: 'prefix'
  },
  {
    to: '/ops/sync',
    label: 'Sync',
    module: 'calendar',
    desktopGroup: 'calendar',
    sidebarOrder: 3,
    mobileTab: 'calendar',
    moreGroupId: 'calendar',
    match: 'prefix'
  },
  {
    to: '/ops/cabins',
    label: 'Cabins',
    module: 'property',
    desktopGroup: 'property',
    sidebarOrder: 1,
    mobileTab: 'more',
    moreGroupId: 'property-partners',
    match: 'prefix'
  },
  {
    to: '/ops/reviews',
    label: 'Reviews',
    module: 'guests_comms',
    desktopGroup: 'guests',
    sidebarOrder: 4,
    mobileTab: 'guests',
    moreGroupId: 'guests',
    match: 'prefix'
  },
  {
    to: '/ops/communications',
    label: 'Comms',
    module: 'guests_comms',
    desktopGroup: 'guests',
    sidebarOrder: 3,
    mobileTab: 'guests',
    moreGroupId: 'guests',
    match: 'prefix'
  },
  {
    to: '/ops/messaging',
    label: 'Messaging',
    module: 'guests_comms',
    desktopGroup: 'guests',
    sidebarOrder: 2,
    mobileTab: 'guests',
    moreGroupId: 'guests',
    match: 'prefix'
  },
  {
    to: '/ops/gift-vouchers',
    label: 'Gift vouchers',
    module: 'finance',
    desktopGroup: 'finance',
    sidebarOrder: 4,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/insights',
    label: 'Insights',
    module: 'finance',
    desktopGroup: 'insights',
    sidebarOrder: 1,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/insights/performance',
    label: 'Historical performance',
    module: 'finance',
    desktopGroup: 'insights',
    sidebarOrder: 2,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/conversion',
    label: 'Conversion',
    module: 'finance',
    desktopGroup: 'insights',
    sidebarOrder: 3,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/conversion/recovery',
    label: 'Quote recovery',
    module: 'finance',
    desktopGroup: 'insights',
    sidebarOrder: 4,
    mobileTab: 'finance',
    moreGroupId: 'finance',
    match: 'prefix'
  },
  {
    to: '/ops/manual-review',
    label: 'Manual',
    module: 'operations',
    desktopGroup: 'home',
    sidebarOrder: 2,
    mobileTab: 'more',
    moreGroupId: 'operations',
    match: 'prefix'
  },
  {
    to: '/ops/readiness',
    label: 'Readiness',
    module: 'operations',
    desktopGroup: 'admin',
    sidebarOrder: 2,
    mobileTab: 'more',
    moreGroupId: 'operations',
    match: 'prefix'
  },
  {
    to: '/ops/settings/cleaning',
    label: 'Cleaning settings',
    module: 'cleaning',
    action: 'ops.cleaning.settings_read',
    desktopGroup: 'cleaning',
    sidebarOrder: 2,
    mobileTab: 'more',
    moreGroupId: 'operations',
    match: 'prefix'
  },
  {
    to: '/ops/users',
    label: 'Users',
    module: 'users',
    action: 'ops.users.manage',
    desktopGroup: 'admin',
    sidebarOrder: 1,
    mobileTab: 'more',
    moreGroupId: 'operations',
    match: 'prefix'
  }
];

/** @type {Record<OpsMobileTabId, readonly string[]>} */
export const OPS_MOBILE_TAB_ROUTE_PREFIXES = {
  home: ['/ops'],
  calendar: ['/ops/calendar', '/ops/sync'],
  guests: ['/ops/reservations', '/ops/messaging', '/ops/communications', '/ops/reviews'],
  finance: [
    '/ops/payments',
    '/ops/promo-codes',
    '/ops/rate-plans',
    '/ops/payment-terms',
    '/ops/gift-vouchers',
    '/ops/insights',
    '/ops/conversion',
    '/ops/conversion/recovery'
  ],
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

/** Full OPS mobile menu (< md More sheet). Current IA; not regrouped to desktop taxonomy in S1A. */
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
      { to: '/ops/calendar/work-windows', label: 'Work windows' },
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
      { to: '/ops/rate-plans', label: 'Rate plans' },
      { to: '/ops/payment-terms', label: 'Payment terms' },
      { to: '/ops/gift-vouchers', label: 'Gift vouchers' },
      { to: '/ops/insights', label: 'Insights' },
      { to: '/ops/insights/performance', label: 'Historical performance' },
      { to: '/ops/conversion', label: 'Conversion' },
      { to: '/ops/conversion/recovery', label: 'Quote recovery' }
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

function compareSidebarItems(a, b) {
  const orderDelta = (a.sidebarOrder || 0) - (b.sidebarOrder || 0);
  if (orderDelta !== 0) return orderDelta;
  return a.to.localeCompare(b.to);
}

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

function normalizeOpsPath(pathname) {
  const path = pathname || '';
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

/**
 * Whether a nav record matches a pathname. Exact `/ops` never consumes nested routes.
 * @param {string | null | undefined} pathname
 * @param {{ to: string, match?: OpsNavMatch }} item
 */
export function pathMatchesOpsNavItem(pathname, item) {
  const path = normalizeOpsPath(pathname);
  if (!item?.to) return false;
  if (item.match === 'exact' || item.to === '/ops') {
    return isOpsHomePath(path);
  }
  return path === item.to || path.startsWith(`${item.to}/`);
}

/**
 * Most specific matching nav record, or null (including /ops/design-system).
 * @param {string | null | undefined} pathname
 * @param {typeof OPS_NAV_ITEMS} [items]
 */
export function matchOpsNavItem(pathname, items = OPS_NAV_ITEMS) {
  const matches = items.filter((item) => pathMatchesOpsNavItem(pathname, item));
  if (matches.length === 0) return null;
  return matches.reduce((best, item) => (item.to.length > best.to.length ? item : best));
}

/**
 * @param {string | null | undefined} pathname
 * @param {typeof OPS_NAV_ITEMS} [items]
 * @returns {{ groupId: OpsDesktopGroupId, item: (typeof OPS_NAV_ITEMS)[number] } | null}
 */
export function getOpsSidebarSelection(pathname, items = OPS_NAV_ITEMS) {
  const item = matchOpsNavItem(pathname, items);
  if (!item) return null;
  return { groupId: item.desktopGroup, item };
}

/**
 * Unfiltered desktop sidebar groups in locked order.
 * @param {typeof OPS_NAV_ITEMS} [items]
 */
export function getOpsSidebarGroups(items = OPS_NAV_ITEMS) {
  return OPS_SIDEBAR_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    order: group.order,
    icon: group.icon,
    items: items.filter((item) => item.desktopGroup === group.id).sort(compareSidebarItems)
  }));
}

/**
 * Permission-filtered desktop sidebar groups. Empty groups are omitted.
 */
export function filterOpsSidebarGroups(session, items = OPS_NAV_ITEMS) {
  return getOpsSidebarGroups(items)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessNavItem(item, session))
    }))
    .filter((group) => group.items.length > 0);
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
  if (isOpsAdminOnlyPath(pathname)) {
    return session.role === 'admin';
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
