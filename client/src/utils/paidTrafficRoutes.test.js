import { describe, expect, it } from 'vitest';
import { PAID_TRAFFIC_STAY_META } from '../data/paidTrafficLandingStays';
import {
  buildPaidTrafficStayNavTarget,
  isPaidTrafficLandingPath,
  PAID_TRAFFIC_BOOKING_HASH
} from './paidTrafficRoutes';

describe('paidTrafficRoutes', () => {
  it('isPaidTrafficLandingPath matches localized and default routes', () => {
    expect(isPaidTrafficLandingPath('/off-grid-stays-bulgaria')).toBe(true);
    expect(isPaidTrafficLandingPath('/bg/off-grid-stays-bulgaria')).toBe(true);
    expect(isPaidTrafficLandingPath('/valley')).toBe(false);
    expect(isPaidTrafficLandingPath('/')).toBe(false);
  });

  it('buildPaidTrafficStayNavTarget localizes route and appends booking hash', () => {
    expect(buildPaidTrafficStayNavTarget('/stays/the-cabin', 'en')).toEqual({
      pathname: '/stays/the-cabin'
    });
    expect(
      buildPaidTrafficStayNavTarget('/stays/the-cabin', 'bg', {
        hash: PAID_TRAFFIC_BOOKING_HASH
      })
    ).toEqual({
      pathname: '/bg/stays/the-cabin',
      hash: '#booking'
    });
  });

  it('buildPaidTrafficStayNavTarget details path has no hash', () => {
    expect(buildPaidTrafficStayNavTarget('/stays/lux-cabin', 'en')).toEqual({
      pathname: '/stays/lux-cabin'
    });
    expect(buildPaidTrafficStayNavTarget('/stays/stone-house', 'bg')).toEqual({
      pathname: '/bg/stays/stone-house'
    });
  });

  it('paid-traffic stay meta routes match /stays/:slug pattern', () => {
    for (const stay of PAID_TRAFFIC_STAY_META) {
      expect(stay.route).toMatch(/^\/stays\/[a-z0-9-]+$/);
      expect(stay.route).toBe(`/stays/${stay.listingSlug}`);
    }
  });
});
