import { describe, expect, it } from 'vitest';
import {
  OPS_ADMIN_ONLY_PREFIXES,
  OPS_MORE_GROUPS,
  OPS_MOBILE_TAB_ROUTE_PREFIXES,
  OPS_MOBILE_TABS,
  OPS_NAV_ITEMS,
  OPS_SIDEBAR_GROUPS,
  canAccessNavItem,
  canAccessOpsFrontendPath,
  filterOpsNavItems,
  filterOpsSidebarGroups,
  getActiveOpsMobileTabId,
  getOpsSidebarGroups,
  getOpsSidebarSelection,
  isOpsAdminOnlyPath,
  isOpsHomePath,
  isOpsMoreRoute,
  isOpsNavPath,
  matchOpsMobileTab,
  matchOpsNavItem
} from './opsNavConfig.js';

describe('opsNavConfig', () => {
  it('lists desktop nav items in OpsLayout order', () => {
    expect(OPS_NAV_ITEMS).toHaveLength(24);
    expect(OPS_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/ops',
      '/ops/calendar',
      '/ops/calendar/work-windows',
      '/ops/cleaning',
      '/ops/reservations',
      '/ops/payments',
      '/ops/promo-codes',
      '/ops/rate-plans',
      '/ops/packages',
      '/ops/creator-partners',
      '/ops/sync',
      '/ops/cabins',
      '/ops/reviews',
      '/ops/communications',
      '/ops/messaging',
      '/ops/gift-vouchers',
      '/ops/insights',
      '/ops/insights/performance',
      '/ops/conversion',
      '/ops/conversion/recovery',
      '/ops/manual-review',
      '/ops/readiness',
      '/ops/settings/cleaning',
      '/ops/users'
    ]);
    expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops')?.end).toBe(true);
  });

  it('maps work-windows under the calendar module and mobile calendar tab', () => {
    expect(
      canAccessOpsFrontendPath('/ops/calendar/work-windows', {
        authenticated: true,
        modules: ['calendar']
      })
    ).toBe(true);
    expect(
      canAccessOpsFrontendPath('/ops/calendar/work-windows', {
        authenticated: true,
        modules: ['cleaning']
      })
    ).toBe(false);
    expect(getActiveOpsMobileTabId('/ops/calendar/work-windows')).toBe('calendar');
  });

  it('defines five mobile tabs', () => {
    expect(OPS_MOBILE_TABS.map((tab) => tab.id)).toEqual([
      'home',
      'calendar',
      'guests',
      'finance',
      'more'
    ]);
  });

  it('covers all nav destinations in mobile tabs or More sheet', () => {
    const mobilePrimary = OPS_MOBILE_TABS.filter((tab) => tab.to).map((tab) => tab.to);
    const moreRoutes = OPS_MORE_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    const covered = new Set([...mobilePrimary, ...moreRoutes]);

    for (const item of OPS_NAV_ITEMS) {
      expect(covered.has(item.to), `missing mobile coverage for ${item.to}`).toBe(true);
    }
  });

  describe('OPS_MORE_GROUPS full menu', () => {
    const moreRoutes = () => OPS_MORE_GROUPS.flatMap((group) => group.items.map((item) => item.to));

    it('contains exactly all OPS_NAV_ITEMS routes', () => {
      expect(moreRoutes()).toHaveLength(OPS_NAV_ITEMS.length);
      expect(new Set(moreRoutes()).size).toBe(OPS_NAV_ITEMS.length);
      expect(new Set(moreRoutes())).toEqual(new Set(OPS_NAV_ITEMS.map((item) => item.to)));
    });

    it('includes every OPS_NAV_ITEMS route', () => {
      const routes = new Set(moreRoutes());
      for (const item of OPS_NAV_ITEMS) {
        expect(routes.has(item.to), `More sheet missing ${item.to}`).toBe(true);
      }
    });

    it('includes all required OPS routes explicitly', () => {
      const required = [
        '/ops',
        '/ops/calendar',
        '/ops/calendar/work-windows',
        '/ops/sync',
        '/ops/cleaning',
        '/ops/settings/cleaning',
        '/ops/reservations',
        '/ops/messaging',
        '/ops/communications',
        '/ops/reviews',
        '/ops/payments',
        '/ops/promo-codes',
        '/ops/rate-plans',
        '/ops/packages',
        '/ops/gift-vouchers',
        '/ops/cabins',
        '/ops/creator-partners',
        '/ops/manual-review',
        '/ops/readiness',
        '/ops/users'
      ];
      const routes = new Set(moreRoutes());
      for (const path of required) {
        expect(routes.has(path), `More sheet missing ${path}`).toBe(true);
      }
    });

    it('uses the approved section groups', () => {
      expect(OPS_MORE_GROUPS.map((group) => group.label)).toEqual([
        'Dashboard',
        'Calendar',
        'Guests',
        'Finance',
        'Property & partners',
        'Operations'
      ]);
    });
  });

  describe('getActiveOpsMobileTabId', () => {
    it('matches home exactly', () => {
      expect(getActiveOpsMobileTabId('/ops')).toBe('home');
      expect(getActiveOpsMobileTabId('/ops/')).toBe('home');
      expect(isOpsHomePath('/ops')).toBe(true);
    });

    it('does not treat nested /ops paths as home', () => {
      expect(getActiveOpsMobileTabId('/ops/calendar')).toBe('calendar');
      expect(isOpsHomePath('/ops/calendar')).toBe(false);
    });

    it('matches calendar and sync including child routes', () => {
      expect(getActiveOpsMobileTabId('/ops/calendar')).toBe('calendar');
      expect(getActiveOpsMobileTabId('/ops/sync')).toBe('calendar');
      expect(getActiveOpsMobileTabId('/ops/calendar/cabin-123')).toBe('calendar');
      expect(getActiveOpsMobileTabId('/ops/calendar/work-windows')).toBe('calendar');
    });

    it('matches guest routes including reservation detail', () => {
      expect(getActiveOpsMobileTabId('/ops/reservations')).toBe('guests');
      expect(getActiveOpsMobileTabId('/ops/reservations/abc')).toBe('guests');
      expect(getActiveOpsMobileTabId('/ops/messaging')).toBe('guests');
      expect(getActiveOpsMobileTabId('/ops/communications')).toBe('guests');
      expect(getActiveOpsMobileTabId('/ops/reviews')).toBe('guests');
    });

    it('matches finance routes including voucher detail', () => {
      expect(getActiveOpsMobileTabId('/ops/payments')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/promo-codes')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/rate-plans')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/packages')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/gift-vouchers')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/gift-vouchers/v-1')).toBe('finance');
    });

    it('matches More routes including cabin detail and cleaning', () => {
      expect(getActiveOpsMobileTabId('/ops/creator-partners')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/cabins')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/cabins/cabin-1')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/cleaning')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/settings/cleaning')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/manual-review')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/readiness')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/users')).toBe('more');
      expect(isOpsMoreRoute('/ops/cabins/cabin-1')).toBe(true);
    });

    it('returns null for non-ops paths', () => {
      expect(getActiveOpsMobileTabId('/login')).toBe(null);
      expect(getActiveOpsMobileTabId('/ops-unknown')).toBe(null);
      expect(isOpsNavPath('/login')).toBe(false);
    });
  });

  describe('matchOpsMobileTab', () => {
    it('returns true only for the active tab', () => {
      expect(matchOpsMobileTab('/ops/reservations/1', 'guests')).toBe(true);
      expect(matchOpsMobileTab('/ops/reservations/1', 'finance')).toBe(false);
      expect(matchOpsMobileTab('/ops/cabins/1', 'more')).toBe(true);
      expect(matchOpsMobileTab('/ops/cabins/1', 'guests')).toBe(false);
    });
  });

  describe('nav permission filtering', () => {
    const cleanerSession = {
      authenticated: true,
      role: 'cleaner',
      modules: ['cleaning'],
      actions: ['ops.cleaning.view', 'ops.cleaning.mark_cleaned']
    };

    it('shows only cleaning nav items for cleaner session', () => {
      const filtered = filterOpsNavItems(OPS_NAV_ITEMS, cleanerSession);
      expect(filtered.map((item) => item.to)).toEqual(['/ops/cleaning']);
    });

    it('denies cleaning settings without settings_read action', () => {
      const settingsItem = OPS_NAV_ITEMS.find((item) => item.to === '/ops/settings/cleaning');
      expect(canAccessNavItem(settingsItem, cleanerSession)).toBe(false);
    });

    const adminSession = {
      authenticated: true,
      role: 'admin',
      modules: ['*'],
      actions: ['ops.users.manage']
    };
    const operatorSession = {
      authenticated: true,
      role: 'operator',
      modules: ['dashboard', 'calendar', 'reservations', 'finance', 'property', 'guests_comms', 'operations', 'cleaning'],
      actions: []
    };

    it('shows Users nav only for admin with ops.users.manage', () => {
      const usersItem = OPS_NAV_ITEMS.find((item) => item.to === '/ops/users');
      expect(canAccessNavItem(usersItem, adminSession)).toBe(true);
      expect(canAccessNavItem(usersItem, operatorSession)).toBe(false);
      expect(canAccessNavItem(usersItem, cleanerSession)).toBe(false);
      expect(filterOpsNavItems(OPS_NAV_ITEMS, adminSession).some((item) => item.to === '/ops/users')).toBe(true);
      expect(filterOpsNavItems(OPS_NAV_ITEMS, operatorSession).some((item) => item.to === '/ops/users')).toBe(false);
    });

    it('blocks operator and cleaner from /ops/users route', () => {
      expect(canAccessOpsFrontendPath('/ops/users', adminSession)).toBe(true);
      expect(canAccessOpsFrontendPath('/ops/users', operatorSession)).toBe(false);
      expect(canAccessOpsFrontendPath('/ops/users', cleanerSession)).toBe(false);
    });

    it('keeps /ops/design-system admin-only and off navigation', () => {
      expect(OPS_ADMIN_ONLY_PREFIXES).toEqual(['/ops/design-system']);
      expect(isOpsAdminOnlyPath('/ops/design-system')).toBe(true);
      expect(isOpsAdminOnlyPath('/ops/design-system/preview')).toBe(true);
      expect(OPS_NAV_ITEMS.some((item) => item.to === '/ops/design-system')).toBe(false);
      expect(
        OPS_MORE_GROUPS.some((group) => group.items.some((item) => item.to === '/ops/design-system'))
      ).toBe(false);
      expect(canAccessOpsFrontendPath('/ops/design-system', adminSession)).toBe(true);
      expect(canAccessOpsFrontendPath('/ops/design-system', operatorSession)).toBe(false);
      expect(canAccessOpsFrontendPath('/ops/design-system', cleanerSession)).toBe(false);
      expect(canAccessOpsFrontendPath('/ops', operatorSession)).toBe(true);
      expect(canAccessOpsFrontendPath('/ops/not-a-real-page', operatorSession)).toBe(true);
    });
  });

  describe('desktop sidebar grouping', () => {
    const groupChildren = (groupId) =>
      getOpsSidebarGroups()
        .find((group) => group.id === groupId)
        ?.items.map((item) => item.to);

    it('defines exactly eight locked desktop groups', () => {
      expect(OPS_SIDEBAR_GROUPS).toHaveLength(8);
      expect(OPS_SIDEBAR_GROUPS.map((group) => group.id)).toEqual([
        'home',
        'calendar',
        'guests',
        'finance',
        'property',
        'cleaning',
        'insights',
        'admin'
      ]);
      expect(OPS_SIDEBAR_GROUPS.map((group) => group.label)).toEqual([
        'Home',
        'Calendar',
        'Guests',
        'Finance',
        'Property',
        'Cleaning',
        'Insights',
        'Admin'
      ]);
      expect(OPS_SIDEBAR_GROUPS.map((group) => group.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(OPS_SIDEBAR_GROUPS[0].id).toBe('home');
      expect(OPS_SIDEBAR_GROUPS.at(-1).id).toBe('admin');
    });

    it('uses semantic Lucide identifiers for future sidebar icons', () => {
      expect(Object.fromEntries(OPS_SIDEBAR_GROUPS.map((group) => [group.id, group.icon]))).toEqual({
        home: 'House',
        calendar: 'CalendarDays',
        guests: 'Users',
        finance: 'CircleDollarSign',
        property: 'Building2',
        cleaning: 'Sparkles',
        insights: 'ChartSpline',
        admin: 'Settings'
      });
    });

    it('places every nav destination in exactly one desktop group', () => {
      const groupedTos = getOpsSidebarGroups().flatMap((group) => group.items.map((item) => item.to));
      expect(groupedTos).toHaveLength(24);
      expect(new Set(groupedTos).size).toBe(24);
      expect(new Set(groupedTos)).toEqual(new Set(OPS_NAV_ITEMS.map((item) => item.to)));
      expect(OPS_NAV_ITEMS.every((item) => Boolean(item.desktopGroup))).toBe(true);
      expect(OPS_NAV_ITEMS.some((item) => item.to === '/ops/design-system')).toBe(false);
      expect(
        getOpsSidebarGroups().some((group) =>
          group.items.some((item) => item.to === '/ops/design-system')
        )
      ).toBe(false);
    });

    it('locks desktop children to the audited mapping', () => {
      expect(groupChildren('home')).toEqual(['/ops', '/ops/manual-review']);
      expect(groupChildren('calendar')).toEqual([
        '/ops/calendar',
        '/ops/calendar/work-windows',
        '/ops/sync'
      ]);
      expect(groupChildren('guests')).toEqual([
        '/ops/reservations',
        '/ops/messaging',
        '/ops/communications',
        '/ops/reviews'
      ]);
      expect(groupChildren('finance')).toEqual([
        '/ops/payments',
        '/ops/promo-codes',
        '/ops/rate-plans',
        '/ops/packages',
        '/ops/gift-vouchers'
      ]);
      expect(groupChildren('property')).toEqual(['/ops/cabins', '/ops/creator-partners']);
      expect(groupChildren('cleaning')).toEqual(['/ops/cleaning', '/ops/settings/cleaning']);
      expect(groupChildren('insights')).toEqual([
        '/ops/insights',
        '/ops/insights/performance',
        '/ops/conversion',
        '/ops/conversion/recovery'
      ]);
      expect(groupChildren('admin')).toEqual(['/ops/users', '/ops/readiness']);
    });

    it('keeps current visible labels unchanged', () => {
      const labels = Object.fromEntries(OPS_NAV_ITEMS.map((item) => [item.to, item.label]));
      expect(labels['/ops/communications']).toBe('Comms');
      expect(labels['/ops/manual-review']).toBe('Manual');
      expect(labels['/ops/cleaning']).toBe('Cleaning');
      expect(labels['/ops']).toBe('Dashboard');
      expect(labels['/ops/insights/performance']).toBe('Historical performance');
      expect(labels['/ops/conversion/recovery']).toBe('Quote recovery');
      expect(labels['/ops/settings/cleaning']).toBe('Cleaning settings');
    });

    it('maps Manual to Home and Readiness to Admin', () => {
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/manual-review')?.desktopGroup).toBe('home');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/readiness')?.desktopGroup).toBe('admin');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/users')?.desktopGroup).toBe('admin');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/creator-partners')?.desktopGroup).toBe(
        'property'
      );
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/settings/cleaning')?.desktopGroup).toBe(
        'cleaning'
      );
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/conversion')?.desktopGroup).toBe('insights');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/conversion/recovery')?.desktopGroup).toBe(
        'insights'
      );
    });

    it('does not introduce an insights permission module', () => {
      const insightItems = OPS_NAV_ITEMS.filter((item) => item.desktopGroup === 'insights');
      expect(insightItems).toHaveLength(4);
      expect(insightItems.every((item) => item.module === 'finance')).toBe(true);
    });
  });

  describe('filterOpsSidebarGroups', () => {
    const groupTos = (session) =>
      Object.fromEntries(
        filterOpsSidebarGroups(session).map((group) => [group.id, group.items.map((item) => item.to)])
      );

    it('removes inaccessible children and hides empty groups', () => {
      const filtered = groupTos({
        authenticated: true,
        modules: ['dashboard'],
        actions: []
      });
      expect(Object.keys(filtered)).toEqual(['home']);
      expect(filtered.home).toEqual(['/ops']);
      expect(filtered.calendar).toBeUndefined();
      expect(filtered.admin).toBeUndefined();
    });

    it('keeps mixed Guests permissions as Reservations-only when comms is missing', () => {
      const filtered = groupTos({
        authenticated: true,
        modules: ['reservations'],
        actions: []
      });
      expect(filtered.guests).toEqual(['/ops/reservations']);
      expect(filtered.guests).not.toContain('/ops/messaging');
      expect(filtered.guests).not.toContain('/ops/communications');
      expect(filtered.guests).not.toContain('/ops/reviews');
    });

    it('preserves the Users action gate', () => {
      const withManage = groupTos({
        authenticated: true,
        role: 'admin',
        modules: ['*'],
        actions: ['ops.users.manage']
      });
      const withoutManage = groupTos({
        authenticated: true,
        role: 'admin',
        modules: ['*'],
        actions: []
      });
      expect(withManage.admin).toEqual(['/ops/users', '/ops/readiness']);
      expect(withoutManage.admin).toEqual(['/ops/readiness']);
    });

    it('preserves the Cleaning settings action gate', () => {
      const viewOnly = groupTos({
        authenticated: true,
        modules: ['cleaning'],
        actions: ['ops.cleaning.view']
      });
      const withSettings = groupTos({
        authenticated: true,
        modules: ['cleaning'],
        actions: ['ops.cleaning.view', 'ops.cleaning.settings_read']
      });
      expect(viewOnly.cleaning).toEqual(['/ops/cleaning']);
      expect(withSettings.cleaning).toEqual(['/ops/cleaning', '/ops/settings/cleaning']);
    });

    it('keeps Insights finance-backed and Manual operations-backed', () => {
      const financeOnly = groupTos({
        authenticated: true,
        modules: ['finance'],
        actions: []
      });
      const operationsOnly = groupTos({
        authenticated: true,
        modules: ['operations'],
        actions: []
      });
      const dashboardAndOperations = groupTos({
        authenticated: true,
        modules: ['dashboard', 'operations'],
        actions: []
      });
      expect(financeOnly.insights).toEqual([
        '/ops/insights',
        '/ops/insights/performance',
        '/ops/conversion',
        '/ops/conversion/recovery'
      ]);
      expect(financeOnly.home).toBeUndefined();
      expect(operationsOnly.home).toEqual(['/ops/manual-review']);
      expect(operationsOnly.insights).toBeUndefined();
      expect(dashboardAndOperations.home).toEqual(['/ops', '/ops/manual-review']);
    });
  });

  describe('matchOpsNavItem', () => {
    const matchTo = (pathname) => matchOpsNavItem(pathname)?.to ?? null;
    const matchGroup = (pathname) => getOpsSidebarSelection(pathname)?.groupId ?? null;

    it('matches exact /ops to Dashboard only', () => {
      expect(matchTo('/ops')).toBe('/ops');
      expect(matchTo('/ops/')).toBe('/ops');
      expect(matchGroup('/ops')).toBe('home');
      expect(matchOpsNavItem('/ops')?.label).toBe('Dashboard');
    });

    it('maps detail routes to their parent destinations', () => {
      expect(matchTo('/ops/reservations')).toBe('/ops/reservations');
      expect(matchTo('/ops/reservations/123')).toBe('/ops/reservations');
      expect(matchGroup('/ops/reservations/123')).toBe('guests');
      expect(matchTo('/ops/gift-vouchers/123')).toBe('/ops/gift-vouchers');
      expect(matchGroup('/ops/gift-vouchers/123')).toBe('finance');
      expect(matchTo('/ops/cabins/123')).toBe('/ops/cabins');
      expect(matchGroup('/ops/cabins/123')).toBe('property');
      expect(matchTo('/ops/calendar/abc123')).toBe('/ops/calendar');
      expect(matchGroup('/ops/calendar/abc123')).toBe('calendar');
    });

    it('selects reserved child routes over parent prefixes', () => {
      expect(matchTo('/ops/calendar/work-windows')).toBe('/ops/calendar/work-windows');
      expect(matchTo('/ops/insights/performance')).toBe('/ops/insights/performance');
      expect(matchTo('/ops/conversion/recovery')).toBe('/ops/conversion/recovery');
      expect(matchTo('/ops/settings/cleaning')).toBe('/ops/settings/cleaning');
      expect(matchGroup('/ops/calendar/work-windows')).toBe('calendar');
      expect(matchGroup('/ops/insights/performance')).toBe('insights');
      expect(matchGroup('/ops/conversion/recovery')).toBe('insights');
      expect(matchGroup('/ops/settings/cleaning')).toBe('cleaning');
      expect(matchOpsNavItem('/ops/calendar')?.label).toBe('Calendar');
      expect(matchOpsNavItem('/ops/insights')?.label).toBe('Insights');
      expect(matchOpsNavItem('/ops/conversion')?.label).toBe('Conversion');
    });

    it('does not select a sidebar item for /ops/design-system', () => {
      expect(matchTo('/ops/design-system')).toBe(null);
      expect(getOpsSidebarSelection('/ops/design-system')).toBe(null);
      expect(matchTo('/ops/manual-review')).toBe('/ops/manual-review');
      expect(matchGroup('/ops/manual-review')).toBe('home');
    });
  });

  describe('mobile IA freeze', () => {
    it('keeps five tabs, ids, and primary destinations', () => {
      expect(OPS_MOBILE_TABS.map((tab) => ({ id: tab.id, to: tab.to, end: tab.end }))).toEqual([
        { id: 'home', to: '/ops', end: true },
        { id: 'calendar', to: '/ops/calendar', end: undefined },
        { id: 'guests', to: '/ops/reservations', end: undefined },
        { id: 'finance', to: '/ops/payments', end: undefined },
        { id: 'more', to: null, end: undefined }
      ]);
    });

    it('keeps current mobile tab prefixes, including Finance for Insights/Conversion', () => {
      expect(OPS_MOBILE_TAB_ROUTE_PREFIXES).toEqual({
        home: ['/ops'],
        calendar: ['/ops/calendar', '/ops/sync'],
        guests: ['/ops/reservations', '/ops/messaging', '/ops/communications', '/ops/reviews'],
        finance: [
          '/ops/payments',
          '/ops/promo-codes',
          '/ops/rate-plans',
          '/ops/packages',
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
      });
      expect(getActiveOpsMobileTabId('/ops/insights')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/insights/performance')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/conversion')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/conversion/recovery')).toBe('finance');
      expect(getActiveOpsMobileTabId('/ops/manual-review')).toBe('more');
    });

    it('keeps More group ids, labels, destinations, and order unchanged', () => {
      expect(OPS_MORE_GROUPS.map((group) => group.id)).toEqual([
        'dashboard',
        'calendar',
        'guests',
        'finance',
        'property-partners',
        'operations'
      ]);
      expect(OPS_MORE_GROUPS.map((group) => group.label)).toEqual([
        'Dashboard',
        'Calendar',
        'Guests',
        'Finance',
        'Property & partners',
        'Operations'
      ]);
      expect(OPS_MORE_GROUPS.map((group) => group.items.map((item) => item.to))).toEqual([
        ['/ops'],
        ['/ops/calendar', '/ops/calendar/work-windows', '/ops/sync'],
        ['/ops/reservations', '/ops/messaging', '/ops/communications', '/ops/reviews'],
        [
          '/ops/payments',
          '/ops/promo-codes',
          '/ops/rate-plans',
          '/ops/gift-vouchers',
          '/ops/insights',
          '/ops/insights/performance',
          '/ops/conversion',
          '/ops/conversion/recovery'
        ],
        ['/ops/cabins', '/ops/creator-partners'],
        [
          '/ops/cleaning',
          '/ops/settings/cleaning',
          '/ops/manual-review',
          '/ops/readiness',
          '/ops/users'
        ]
      ]);
    });

    it('keeps mobileTab and moreGroupId aligned with current mobile behavior', () => {
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/insights')?.mobileTab).toBe('finance');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/insights')?.moreGroupId).toBe('finance');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/manual-review')?.mobileTab).toBe('more');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/manual-review')?.moreGroupId).toBe(
        'operations'
      );
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops/cleaning')?.mobileTab).toBe('more');
      expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops')?.mobileTab).toBe('home');
    });
  });
});
