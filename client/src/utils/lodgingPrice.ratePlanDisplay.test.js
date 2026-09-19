import { describe, expect, it } from 'vitest';
import {
  calculateNightlyLodgingRate,
  effectiveDisplayNightlyFromStayTotal
} from './lodgingPrice';

describe('effectiveDisplayNightlyFromStayTotal (display-only)', () => {
  it('RatePlan 6-night winter matrix nightlies', () => {
    expect(effectiveDisplayNightlyFromStayTotal(450, 6)).toBe(75);
    expect(effectiveDisplayNightlyFromStayTotal(660, 6)).toBe(110);
    expect(effectiveDisplayNightlyFromStayTotal(540, 6)).toBe(90);
    expect(effectiveDisplayNightlyFromStayTotal(330, 6)).toBe(55);
  });

  it('RatePlan 5-night winter matrix nightlies', () => {
    expect(effectiveDisplayNightlyFromStayTotal(375, 5)).toBe(75);
    expect(effectiveDisplayNightlyFromStayTotal(550, 5)).toBe(110);
    expect(effectiveDisplayNightlyFromStayTotal(450, 5)).toBe(90);
  });

  it('guest-sensitive Stone House RatePlan display nightlies', () => {
    // 6 nights: 2→540, 4→720, 5→900, 6→1080 ⇒ 90/120/150/180
    expect(effectiveDisplayNightlyFromStayTotal(540, 6)).toBe(90);
    expect(effectiveDisplayNightlyFromStayTotal(720, 6)).toBe(120);
    expect(effectiveDisplayNightlyFromStayTotal(900, 6)).toBe(150);
    expect(effectiveDisplayNightlyFromStayTotal(1080, 6)).toBe(180);
  });

  it('returns null for invalid inputs', () => {
    expect(effectiveDisplayNightlyFromStayTotal(450, 0)).toBeNull();
    expect(effectiveDisplayNightlyFromStayTotal(null, 6)).toBeNull();
    expect(effectiveDisplayNightlyFromStayTotal(NaN, 6)).toBeNull();
  });

  it('uses the same euro cent rounding as lodging helpers', () => {
    expect(effectiveDisplayNightlyFromStayTotal(100, 3)).toBe(33.33);
  });
});

describe('outside-window entity nightly unchanged', () => {
  it('A-frame / Luxury / Cabin / Stone entity rates', () => {
    expect(calculateNightlyLodgingRate({ pricePerNight: 60, pricingModel: 'per_night' }, 2, 0)).toBe(60);
    expect(calculateNightlyLodgingRate({ pricePerNight: 85, pricingModel: 'per_night' }, 2, 0)).toBe(85);
    expect(calculateNightlyLodgingRate({ pricePerNight: 55, pricingModel: 'per_night' }, 2, 0)).toBe(55);
    expect(
      calculateNightlyLodgingRate(
        { pricePerNight: 75, pricingModel: 'base_plus_extra', includedGuests: 3, extraGuestPricePerNight: 25 },
        2,
        0
      )
    ).toBe(75);
  });
});
