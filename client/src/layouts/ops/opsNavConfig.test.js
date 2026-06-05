import { describe, expect, it } from 'vitest';
import {
  OPS_MORE_GROUPS,
  OPS_MOBILE_TABS,
  OPS_NAV_ITEMS,
  getActiveOpsMobileTabId,
  isOpsHomePath,
  isOpsMoreRoute,
  isOpsNavPath,
  matchOpsMobileTab
} from './opsNavConfig.js';

describe('opsNavConfig', () => {
  it('lists 14 desktop nav items in OpsLayout order', () => {
    expect(OPS_NAV_ITEMS).toHaveLength(14);
    expect(OPS_NAV_ITEMS.map((item) => item.to)).toEqual([
      '/ops',
      '/ops/calendar',
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
      '/ops/manual-review',
      '/ops/readiness'
    ]);
    expect(OPS_NAV_ITEMS.find((item) => item.to === '/ops')?.end).toBe(true);
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

  it('covers all nav destinations in mobile tabs or More groups', () => {
    const mobilePrimary = OPS_MOBILE_TABS.filter((tab) => tab.to).map((tab) => tab.to);
    const moreRoutes = OPS_MORE_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    const calendarSync = ['/ops/sync'];
    const guestRoutes = [
      '/ops/communications',
      '/ops/messaging',
      '/ops/reviews'
    ];
    const financeRoutes = ['/ops/promo-codes', '/ops/gift-vouchers'];

    const covered = new Set([
      ...mobilePrimary,
      ...moreRoutes,
      ...calendarSync,
      ...guestRoutes,
      ...financeRoutes
    ]);

    for (const item of OPS_NAV_ITEMS) {
      expect(covered.has(item.to), `missing mobile coverage for ${item.to}`).toBe(true);
    }
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

    it('matches More routes including cabin detail', () => {
      expect(getActiveOpsMobileTabId('/ops/creator-partners')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/cabins')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/cabins/cabin-1')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/manual-review')).toBe('more');
      expect(getActiveOpsMobileTabId('/ops/readiness')).toBe('more');
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
});
