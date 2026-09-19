import { describe, expect, it } from 'vitest';
import {
  createLastRequestWinsGuard,
  getSearchCardPetPolicyLabel,
  getSearchCardStatus,
  PUBLIC_PRICING_ERROR_MESSAGES,
  resolvePublicPricingErrorMessage
} from './searchCardStatus';

const tEn = (key, opts) => {
  const map = {
    'search.dogsWelcome': 'Dogs welcome',
    'search.dogsNotPermitted': 'Dogs not permitted',
    'search.unavailableWithDogs': 'Not available with dogs',
    'search.unavailableForDates': 'Unavailable for these dates',
    'search.reasonMinGuests': 'Minimum guests',
    'search.reasonMaxGuests': 'Maximum guests',
    'search.reasonMinNights': 'Minimum nights',
    'search.reasonCriteria': 'Not available for this search',
    'search.pricingUnavailable': 'Price unavailable for these dates. Try different dates or contact us.'
  };
  if (map[key]) return map[key];
  if (opts && opts.defaultValue) return opts.defaultValue;
  return key;
};

const MALICIOUS_MESSAGES = [
  'ownerToken=SECRETTOKEN',
  'mongodb://user:pass@host/database',
  'password=hunter2',
  'Error: boom\n    at Object.<anonymous> (/app/server/services/publicAvailabilityPricingService.js:100:1)',
  'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.leak'
];

describe('searchCardStatus', () => {
  const lux = { _id: '1', slug: 'lux-cabin', name: 'Lux Cabin', available: true };
  const aFrame = {
    _id: '2',
    slug: 'a-frame',
    inventoryType: 'multi',
    name: 'A-Frame',
    available: true
  };
  const stone = { _id: '3', slug: 'stone-house', name: 'Stone House', available: true };
  const cabin = { _id: '4', slug: 'the-cabin', name: 'The Cabin', available: true };

  it('shows explicit dog policy on every known stay', () => {
    expect(getSearchCardPetPolicyLabel(aFrame, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(stone, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(cabin, tEn)).toBe('Dogs welcome');
    expect(getSearchCardPetPolicyLabel(lux, tEn)).toBe('Dogs not permitted');
  });

  it('keeps Lux bookable when pets = 0 and dates available', () => {
    const status = getSearchCardStatus(lux, tEn, { pets: 0 });
    expect(status.isBookable).toBe(true);
    expect(status.reasonCode).toBeNull();
    expect(getSearchCardPetPolicyLabel(lux, tEn)).toBe('Dogs not permitted');
  });

  it('marks Lux incompatible when pets > 0 even if dates available', () => {
    const status = getSearchCardStatus(lux, tEn, { pets: 1 });
    expect(status.isBookable).toBe(false);
    expect(status.reasonCode).toBe('pets');
    expect(status.banner).toBe('Not available with dogs');
    expect(status.disabledCta).toBe('Not available with dogs');
  });

  it('keeps dog-friendly stays bookable when pets > 0', () => {
    for (const stay of [aFrame, stone, cabin]) {
      const status = getSearchCardStatus(stay, tEn, { pets: 1 });
      expect(status.isBookable).toBe(true);
      expect(getSearchCardPetPolicyLabel(stay, tEn)).toBe('Dogs welcome');
    }
  });

  it('prefers ordinary date-unavailable over pet incompatibility', () => {
    const luxDatesBlocked = {
      ...lux,
      available: false,
      unavailabilityReason: 'dates'
    };
    const status = getSearchCardStatus(luxDatesBlocked, tEn, { pets: 1 });
    expect(status.isBookable).toBe(false);
    expect(status.reasonCode).toBe('dates');
    expect(status.banner).toBe('Unavailable for these dates');
  });

  it('resolves Lux by display name when slug missing', () => {
    const byName = { _id: 'x', name: 'Luxury Cabin', available: true };
    expect(getSearchCardPetPolicyLabel(byName, tEn)).toBe('Dogs not permitted');
    expect(getSearchCardStatus(byName, tEn, { pets: 2 }).reasonCode).toBe('pets');
  });

  it('marks pricing failures unavailable without inventing a base price', () => {
    const pricedOut = {
      ...lux,
      available: false,
      unavailabilityReason: 'pricing',
      totalPrice: null,
      pricingError: {
        code: 'AMBIGUOUS_SEASONAL_RATE_PLAN',
        message: 'Pricing is temporarily unavailable for this stay. Please try different dates or contact us.'
      }
    };
    const status = getSearchCardStatus(pricedOut, tEn, { pets: 0 });
    expect(status.isBookable).toBe(false);
    expect(status.reasonCode).toBe('pricing');
    expect(status.banner).toMatch(/temporarily unavailable/i);
  });

  it('C1 Search/A-Frame: never renders API pricingError.message (code-only)', () => {
    for (const leak of MALICIOUS_MESSAGES) {
      const searchCabin = {
        ...lux,
        available: false,
        unavailabilityReason: 'pricing',
        totalPrice: null,
        pricingError: {
          code: 'AMBIGUOUS_SEASONAL_RATE_PLAN',
          message: leak,
          details: leak,
          stack: leak
        }
      };
      const searchStatus = getSearchCardStatus(searchCabin, tEn, { pets: 0 });
      // SearchResults price block uses the same resolver as AFrameDetails.
      const aFrameDisplayed = resolvePublicPricingErrorMessage(searchCabin.pricingError.code);
      const searchDisplayed = resolvePublicPricingErrorMessage(searchCabin.pricingError?.code);

      expect(searchStatus.banner).toBe(
        PUBLIC_PRICING_ERROR_MESSAGES.AMBIGUOUS_SEASONAL_RATE_PLAN
      );
      expect(searchStatus.disabledCta).toBe(
        PUBLIC_PRICING_ERROR_MESSAGES.AMBIGUOUS_SEASONAL_RATE_PLAN
      );
      expect(aFrameDisplayed).toBe(PUBLIC_PRICING_ERROR_MESSAGES.AMBIGUOUS_SEASONAL_RATE_PLAN);
      expect(searchDisplayed).toBe(PUBLIC_PRICING_ERROR_MESSAGES.AMBIGUOUS_SEASONAL_RATE_PLAN);

      for (const text of [searchStatus.banner, searchStatus.disabledCta, aFrameDisplayed, searchDisplayed]) {
        expect(text).not.toContain(leak);
        expect(text).not.toContain('SECRETTOKEN');
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('mongodb://');
        expect(text).not.toContain('eyJhbGciOi');
      }
    }

    expect(resolvePublicPricingErrorMessage('NOT_A_REAL_CODE')).toBe(
      PUBLIC_PRICING_ERROR_MESSAGES.PRICING_FAILED
    );
    expect(resolvePublicPricingErrorMessage(null)).toBe(PUBLIC_PRICING_ERROR_MESSAGES.PRICING_FAILED);
    expect(resolvePublicPricingErrorMessage({ code: 'SEASONAL_MIN_NIGHTS' })).toBe(
      PUBLIC_PRICING_ERROR_MESSAGES.PRICING_FAILED
    );
    expect(resolvePublicPricingErrorMessage('SEASONAL_MIN_NIGHTS')).toBe(
      PUBLIC_PRICING_ERROR_MESSAGES.SEASONAL_MIN_NIGHTS
    );

    const unknownLeakCabin = {
      ...aFrame,
      available: false,
      unavailabilityReason: 'pricing',
      totalPrice: null,
      pricingError: {
        code: 'TOTALLY_UNKNOWN',
        message: 'password=hunter2 mongodb://user:pass@host/database ownerToken=SECRETTOKEN'
      }
    };
    const unknownStatus = getSearchCardStatus(unknownLeakCabin, tEn, { pets: 0 });
    expect(unknownStatus.banner).toBe(PUBLIC_PRICING_ERROR_MESSAGES.PRICING_FAILED);
    expect(unknownStatus.banner).not.toContain('hunter2');
    expect(unknownStatus.banner).not.toContain('SECRETTOKEN');
  });
});

describe('createLastRequestWinsGuard (SearchResults stale-response)', () => {
  it('keeps newer results when older request settles later; unmount blocks updates', () => {
    const guard = createLastRequestWinsGuard();
    const ui = {
      results: null,
      error: null,
      loading: false,
      mounted: true
    };

    const applySearchState = (request, patch) => {
      if (!ui.mounted) return false;
      return request.apply(() => {
        Object.assign(ui, patch);
      });
    };

    // 1. Request A starts
    const requestA = guard.begin();
    applySearchState(requestA, { loading: true, error: null });
    expect(ui.loading).toBe(true);

    // 2. Request B starts with newer parameters (invalidates A)
    const requestB = guard.begin();
    applySearchState(requestB, { loading: true, error: null });
    expect(requestA.isCurrent()).toBe(false);
    expect(requestB.isCurrent()).toBe(true);

    // 3. B resolves first and is displayed
    expect(
      applySearchState(requestB, {
        results: [{ id: 'B', checkIn: '2026-12-20' }],
        error: null,
        loading: false
      })
    ).toBe(true);
    expect(ui.results).toEqual([{ id: 'B', checkIn: '2026-12-20' }]);
    expect(ui.loading).toBe(false);

    // 4–5. A resolves afterward — no UI effect on results/error/loading
    expect(
      applySearchState(requestA, {
        results: [{ id: 'A', checkIn: '2026-12-10' }],
        error: null,
        loading: false
      })
    ).toBe(false);
    expect(ui.results).toEqual([{ id: 'B', checkIn: '2026-12-20' }]);
    expect(ui.error).toBeNull();
    expect(ui.loading).toBe(false);

    // A rejects afterward — still no effect
    expect(
      applySearchState(requestA, {
        error: 'stale failure',
        loading: false,
        results: [{ id: 'A-fail' }]
      })
    ).toBe(false);
    expect(ui.results).toEqual([{ id: 'B', checkIn: '2026-12-20' }]);
    expect(ui.error).toBeNull();
    expect(ui.loading).toBe(false);

    // Only current request may clear loading after a newer begin
    const requestC = guard.begin();
    applySearchState(requestC, { loading: true });
    expect(applySearchState(requestB, { loading: false })).toBe(false);
    expect(ui.loading).toBe(true);
    expect(applySearchState(requestC, { loading: false, results: [{ id: 'C' }] })).toBe(true);
    expect(ui.loading).toBe(false);
    expect(ui.results).toEqual([{ id: 'C' }]);

    // 6. Unmounted component is not updated
    const requestD = guard.begin();
    applySearchState(requestD, { loading: true });
    ui.mounted = false;
    guard.invalidate();
    expect(
      applySearchState(requestD, {
        results: [{ id: 'D-after-unmount' }],
        loading: false,
        error: 'should not appear'
      })
    ).toBe(false);
    expect(ui.results).toEqual([{ id: 'C' }]);
    expect(ui.error).toBeNull();
  });
});
