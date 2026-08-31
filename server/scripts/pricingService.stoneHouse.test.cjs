/**
 * Stone House / base_plus_extra lodging price tests (server-authoritative).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateBaseLodgingPrice,
  calculateNightlyLodgingRate,
  humanGuestCount
} = require('../services/pricingService');

const stone = {
  pricePerNight: 75,
  pricingModel: 'base_plus_extra',
  includedGuests: 3,
  extraGuestPricePerNight: 25,
  capacity: 6,
  minGuests: 1
};

describe('pricingService Stone House base_plus_extra', () => {
  it('human guests exclude pets (callers pass adults+children only)', () => {
    assert.equal(humanGuestCount(2, 1), 3);
    assert.equal(humanGuestCount(4, 0), 4);
  });

  it('1–3 guests = €75/night; 4–6 add €25 each', () => {
    assert.equal(calculateNightlyLodgingRate(stone, 1, 0), 75);
    assert.equal(calculateNightlyLodgingRate(stone, 2, 0), 75);
    assert.equal(calculateNightlyLodgingRate(stone, 3, 0), 75);
    assert.equal(calculateNightlyLodgingRate(stone, 4, 0), 100);
    assert.equal(calculateNightlyLodgingRate(stone, 5, 0), 125);
    assert.equal(calculateNightlyLodgingRate(stone, 6, 0), 150);
  });

  it('locked stay totals for 1 and 4 nights', () => {
    const ci = '2026-09-10';
    const co1 = '2026-09-11';
    const co4 = '2026-09-14';
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 1, 0), 75);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 2, 0), 75);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 3, 0), 75);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 4, 0), 100);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 5, 0), 125);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co1, 6, 0), 150);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co4, 2, 0), 300);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co4, 3, 0), 300);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co4, 4, 0), 400);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co4, 5, 0), 500);
    assert.equal(calculateBaseLodgingPrice(stone, ci, co4, 6, 0), 600);
  });

  it('does not change A-Frame / Lux flat per_night', () => {
    const lux = { pricePerNight: 85, pricingModel: 'per_night' };
    assert.equal(calculateBaseLodgingPrice(lux, '2026-09-10', '2026-09-12', 2, 0), 170);
  });

  it('preserves legacy per_person math', () => {
    const legacy = { pricePerNight: 25, pricingModel: 'per_person' };
    assert.equal(calculateBaseLodgingPrice(legacy, '2026-09-10', '2026-09-11', 4, 0), 100);
  });
});
