import { describe, expect, it } from 'vitest';
import {
  calculateBaseLodgingPrice,
  calculateNightlyLodgingRate,
  humanGuestCount
} from './lodgingPrice';

const stone = {
  pricePerNight: 75,
  pricingModel: 'base_plus_extra',
  includedGuests: 3,
  extraGuestPricePerNight: 25,
  capacity: 6,
  minGuests: 1
};

describe('lodgingPrice (Stone House base_plus_extra)', () => {
  it('does not count pets as human guests', () => {
    expect(humanGuestCount(2, 0)).toBe(2);
  });

  it('charges €75/night for 1–3 guests', () => {
    expect(calculateNightlyLodgingRate(stone, 1, 0)).toBe(75);
    expect(calculateNightlyLodgingRate(stone, 2, 0)).toBe(75);
    expect(calculateNightlyLodgingRate(stone, 3, 0)).toBe(75);
  });

  it('adds €25/night per guest after 3', () => {
    expect(calculateNightlyLodgingRate(stone, 4, 0)).toBe(100);
    expect(calculateNightlyLodgingRate(stone, 5, 0)).toBe(125);
    expect(calculateNightlyLodgingRate(stone, 6, 0)).toBe(150);
  });

  it('matches locked multi-night totals', () => {
    expect(calculateBaseLodgingPrice(stone, 1, 1, 0)).toBe(75);
    expect(calculateBaseLodgingPrice(stone, 1, 2, 0)).toBe(75);
    expect(calculateBaseLodgingPrice(stone, 1, 3, 0)).toBe(75);
    expect(calculateBaseLodgingPrice(stone, 1, 4, 0)).toBe(100);
    expect(calculateBaseLodgingPrice(stone, 1, 5, 0)).toBe(125);
    expect(calculateBaseLodgingPrice(stone, 1, 6, 0)).toBe(150);
    expect(calculateBaseLodgingPrice(stone, 4, 2, 0)).toBe(300);
    expect(calculateBaseLodgingPrice(stone, 4, 3, 0)).toBe(300);
    expect(calculateBaseLodgingPrice(stone, 4, 4, 0)).toBe(400);
    expect(calculateBaseLodgingPrice(stone, 4, 5, 0)).toBe(500);
    expect(calculateBaseLodgingPrice(stone, 4, 6, 0)).toBe(600);
  });

  it('keeps per_night and per_person models unchanged', () => {
    expect(calculateNightlyLodgingRate({ pricePerNight: 85, pricingModel: 'per_night' }, 2, 0)).toBe(
      85
    );
    expect(
      calculateNightlyLodgingRate({ pricePerNight: 25, pricingModel: 'per_person' }, 4, 0)
    ).toBe(100);
  });
});
