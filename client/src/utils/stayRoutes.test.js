import { describe, expect, it } from 'vitest';
import {
  appendQueryString,
  KNOWN_CABIN_ID_TO_SLUG,
  resolveCabinStaySlug,
  resolveListingStayPathBase,
  STAY_SLUG
} from './stayRoutes';

describe('stayRoutes', () => {
  it('resolveCabinStaySlug uses explicit slug', () => {
    expect(resolveCabinStaySlug({ slug: 'lux-cabin', name: 'Lux Cabin' })).toBe('lux-cabin');
  });

  it('resolveCabinStaySlug maps known production IDs', () => {
    expect(resolveCabinStaySlug({ _id: '69b2ff933a7fff6621e785cc', name: 'The Cabin' })).toBe(
      STAY_SLUG.THE_CABIN
    );
    expect(resolveCabinStaySlug({ _id: '69b2ff947f141a71ffa7c492', name: 'Lux Cabin' })).toBe(
      STAY_SLUG.LUX_CABIN
    );
  });

  it('resolveListingStayPathBase prefers stay slug for single units', () => {
    expect(resolveListingStayPathBase({ _id: 'abc', name: 'Stone House' })).toBe('/stays/stone-house');
  });

  it('resolveListingStayPathBase uses type slug for multi-unit', () => {
    expect(resolveListingStayPathBase({ inventoryType: 'multi', slug: 'a-frame' })).toBe(
      '/stays/a-frame'
    );
  });

  it('appendQueryString omits bare ?', () => {
    expect(appendQueryString('/stays/the-cabin', '')).toBe('/stays/the-cabin');
    expect(appendQueryString('/stays/the-cabin', '?')).toBe('/stays/the-cabin');
    expect(appendQueryString('/stays/the-cabin', 'checkIn=2026-07-01')).toBe(
      '/stays/the-cabin?checkIn=2026-07-01'
    );
  });

  it('KNOWN_CABIN_ID_TO_SLUG covers audit IDs', () => {
    expect(KNOWN_CABIN_ID_TO_SLUG['69b2ff933a7fff6621e785cc']).toBe('the-cabin');
    expect(KNOWN_CABIN_ID_TO_SLUG['69b2ff947f141a71ffa7c492']).toBe('lux-cabin');
  });
});
