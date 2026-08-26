import { describe, expect, it } from 'vitest';
import {
  OPS_MORE_GROUPS,
  OPS_MOBILE_TABS,
  OPS_NAV_ITEMS,
  canAccessNavItem,
  canAccessOpsFrontendPath,
  filterOpsNavItems,
  getActiveOpsMobileTabId,
  isOpsHomePath,
  isOpsMoreRoute,
  isOpsNavPath,
  matchOpsMobileTab
} from './opsNavConfig.js';

describe('opsNavConfig', () => {
  it('lists desktop nav items in OpsLayout order', () => {
    expect(OPS_NAV_ITEMS).toHaveLength(22);
    expect(OPS_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/ops',
      '/ops/calendar',
      '/ops/calendar/work-windows',
      '/ops/cleaning',
      '/ops/reservations',
      '/ops/payments',
      '/ops/promo-codes',
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
  });
});
