'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const NightlyRateOverride = require('../models/NightlyRateOverride');
const pricingService = require('../services/pricingService');
const quoteService = require('../services/bookingQuoteService');
const overrideService = require('../services/nightlyRateOverrideService');
const { buildQuoteSnapshot, hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');

function plan(pricingMethod = 'nightly_per_unit') {
  return {
    code: 'summer',
    version: 1,
    type: 'seasonal_stay',
    currency: 'EUR',
    accommodation: { accommodationKey: 'stone-house', entityType: 'cabin' },
    pricing: {
      pricingMethod,
      nightlyPerUnitAmount: 100,
      includedGuests: pricingMethod === 'nightly_base_plus_extra_guest' ? 2 : null,
      additionalGuestNightlyAmount: pricingMethod === 'nightly_base_plus_extra_guest' ? 15 : null
    },
    dates: { checkIn: '2026-07-01', checkOut: '2026-07-04' }
  };
}

test('NightlyRateOverride has the immutable compound identity index', () => {
  const index = NightlyRateOverride.schema.indexes().find(([fields, options]) =>
    fields.ratePlanCode === 1 &&
    fields.ratePlanVersion === 1 &&
    fields.entityType === 1 &&
    fields.accommodationKey === 1 &&
    fields.dateKey === 1 &&
    options.unique === true
  );
  assert.ok(index);
});

test('override range expands arrival-inclusive and departure-exclusive', () => {
  assert.deepEqual(
    overrideService.expandNightlyDateRange('2026-07-01', '2026-07-04'),
    ['2026-07-01', '2026-07-02', '2026-07-03']
  );
});

test('override loader performs one exact identity/range query', async () => {
  let calls = 0;
  let filter;
  const fakeModel = {
    find(input) {
      calls += 1;
      filter = input;
      return {
        select() { return this; },
        sort() { return this; },
        lean: async () => []
      };
    }
  };
  await overrideService.loadNightlyRateOverrides({
    ratePlanCode: 'SUMMER',
    ratePlanVersion: 1,
    entityType: 'cabin',
    accommodationKey: 'STONE-HOUSE',
    checkIn: '2026-07-01',
    checkOut: '2026-07-04',
    model: fakeModel
  });
  assert.equal(calls, 1);
  assert.deepEqual(filter.dateKey, { $gte: '2026-07-01', $lt: '2026-07-04' });
  assert.equal(filter.ratePlanCode, 'summer');
  assert.equal(filter.accommodationKey, 'stone-house');
});

test('nightly override replaces base only and preserves extra guest surcharge', () => {
  const result = pricingService.calculateRatePlanPriceBreakdown(
    plan('nightly_base_plus_extra_guest'),
    { adults: 3, children: 0 },
    [{ dateKey: '2026-07-02', baseNightlyAmountCents: 12500 }]
  );
  assert.equal(result.baseLodgingAmount, 325);
  assert.equal(result.additionalGuestAmount, 45);
  assert.equal(result.totalPrice, 370);
  assert.deepEqual(result.nightlyPricing.map((night) => night.date), [
    '2026-07-01',
    '2026-07-02',
    '2026-07-03'
  ]);
});

test('quote integration changes total and snapshot hash while fixed methods stay untouched', async () => {
  const entity = { slug: 'stone-house', experiences: [] };
  const input = {
    entity,
    entityType: 'cabin',
    checkIn: '2026-07-01',
    checkOut: '2026-07-04',
    checkInDate: new Date('2026-07-01T00:00:00Z'),
    checkOutDate: new Date('2026-07-04T00:00:00Z'),
    adults: 2,
    children: 0,
    experienceKeys: []
  };
  const deps = {
    loadActiveSeasonalRatePlans: async () => [{
      code: 'summer',
      internalName: 'Summer',
      version: 1,
      status: 'active',
      type: 'seasonal_stay',
      currency: 'EUR',
      arrivalWindowStart: '2026-06-01',
      arrivalWindowEnd: '2026-08-31',
      bookingWindowStart: null,
      bookingWindowEnd: null,
      minNights: 1,
      inventoryMode: 'shared',
      requiresFullPayment: true,
      cancellationPolicyCode: 'standard',
      cancellationPolicyVersion: 1,
      accommodations: [{
        accommodationKey: 'stone-house',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 100
      }]
    }],
    loadNightlyRateOverrides: async () => [{ dateKey: '2026-07-02', baseNightlyAmountCents: 12500 }]
  };
  const quoted = await quoteService.buildQuoteForResolvedEntity(input, deps);
  assert.equal(quoted.totalPrice, 325);
  assert.deepEqual(quoted.nightlyPricing, [
    { date: '2026-07-01', effectiveBaseNightlyAmount: 100 },
    { date: '2026-07-02', effectiveBaseNightlyAmount: 125 },
    { date: '2026-07-03', effectiveBaseNightlyAmount: 100 }
  ]);

  const normalizedInput = {
    cabinId: '507f1f77bcf86cd799439011',
    checkInDateOnly: '2026-07-01',
    checkOutDateOnly: '2026-07-04',
    adults: 2,
    children: 0,
    experienceKeys: []
  };
  const snapshot = buildQuoteSnapshot({ normalizedInput, quote: quoted });
  assert.equal(snapshot.ratePlanPricingBreakdown.nightlyPricing[1].effectiveBaseNightlyAmount, 125);
  assert.notEqual(hashQuoteSnapshot(snapshot), hashQuoteSnapshot({
    ...snapshot,
    ratePlanPricingBreakdown: {
      ...snapshot.ratePlanPricingBreakdown,
      nightlyPricing: snapshot.ratePlanPricingBreakdown.nightlyPricing.map((night, index) =>
        index === 1 ? { ...night, effectiveBaseNightlyAmount: 100 } : night
      )
    }
  }));
});
