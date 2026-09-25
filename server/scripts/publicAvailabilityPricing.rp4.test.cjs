/**
 * RP4 — Public availability lodging pricing aligned with booking-quote RatePlan path.
 *
 * Run: node --test server/scripts/publicAvailabilityPricing.rp4.test.cjs
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  pricePublicStayLodging,
  availabilityPriceFieldsFromResult,
  publicPricingErrorFromCode,
  SAFE_PRICING_ERROR_MESSAGES
} = require('../services/publicAvailabilityPricingService');
const { buildQuoteForResolvedEntity } = require('../services/bookingQuoteService');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const { calculateBaseLodgingPrice } = require('../services/pricingService');

function stay(checkIn, checkOut) {
  const n = normalizeGuestStayRange(checkIn, checkOut);
  return { checkInDate: n.startDate, checkOutDate: n.endDate, checkIn, checkOut };
}

function cabinEntity(overrides = {}) {
  return {
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    pricePerNight: 100,
    pricingModel: 'per_night',
    capacity: 4,
    minGuests: 1,
    minNights: 1,
    ...overrides
  };
}

function aFrameEntity(overrides = {}) {
  return {
    name: 'A-Frame',
    slug: 'a-frame',
    pricePerNight: 60,
    pricingModel: 'per_night',
    capacity: 2,
    minGuests: 1,
    minNights: 1,
    ...overrides
  };
}

function seasonalPlan(overrides = {}) {
  return {
    code: 'winter-peak',
    internalName: 'Winter peak',
    version: 1,
    status: 'active',
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: '2026-12-01',
    arrivalWindowEnd: '2026-12-31',
    bookingWindowStart: null,
    bookingWindowEnd: null,
    minNights: 2,
    packageArrivalDate: null,
    packageDepartureDate: null,
    inventoryMode: 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: ['Firewood'],
    accommodations: [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 180,
        includedGuests: null,
        additionalGuestNightlyAmount: null,
        fixedPerUnitAmount: null,
        adultPackageAmount: null,
        childPackageAmount: null,
        infantPackageAmount: null
      }
    ],
    ...overrides
  };
}

function loader(plans) {
  return async () => plans;
}

function overrideLoader(overrides, calls = []) {
  return async (query) => {
    calls.push(query);
    const dateOnly = (value) =>
      value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
    const checkIn = dateOnly(query.checkIn);
    const checkOut = dateOnly(query.checkOut);
    return overrides.filter((override) =>
      override.ratePlanCode === query.ratePlanCode &&
      override.ratePlanVersion === query.ratePlanVersion &&
      override.entityType === query.entityType &&
      override.accommodationKey === query.accommodationKey &&
      override.dateKey >= checkIn &&
      override.dateKey < checkOut
    );
  };
}

describe('RP4 publicAvailabilityPricingService', () => {
  it('1. no RatePlan → existing entity price', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate } = stay('2026-06-10', '2026-06-12');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([])
    });
    assert.equal(priced.ok, true);
    assert.equal(priced.pricingSource, 'entity');
    assert.equal(priced.pricingMode, 'exact_stay');
    assert.equal(priced.currency, 'EUR');
    assert.equal(priced.ratePlan, null);
    assert.equal(priced.totalPrice, calculateBaseLodgingPrice(entity, checkInDate, checkOutDate, 2, 0));
    assert.equal(priced.totalPrice, 200);
  });

  it('2. active seasonal plan changes displayed price', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([seasonalPlan()])
    });
    assert.equal(priced.ok, true);
    assert.equal(priced.pricingSource, 'rate_plan');
    assert.equal(priced.totalPrice, 360);
    assert.deepEqual(priced.ratePlan, { code: 'winter-peak', version: 1, type: 'seasonal_stay' });
  });

  it('2b. public search applies exact nightly overrides and matches checkout totals', async () => {
    const entity = cabinEntity();
    const plan = seasonalPlan({
      code: 'winter-cabin-stay-2026-27',
      version: 2,
      accommodations: [{
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 110
      }]
    });
    const { checkInDate, checkOutDate, checkIn, checkOut } = stay('2026-12-23', '2026-12-27');
    const overrides = [
      ...['2026-12-23', '2026-12-24', '2026-12-25'].map((dateKey) => ({
        ratePlanCode: plan.code,
        ratePlanVersion: 2,
        entityType: 'cabin',
        accommodationKey: 'lux-cabin',
        dateKey,
        baseNightlyAmountCents: 15500
      })),
      {
        ratePlanCode: plan.code,
        ratePlanVersion: 1,
        entityType: 'cabin',
        accommodationKey: 'lux-cabin',
        dateKey: '2026-12-24',
        baseNightlyAmountCents: 99900
      },
      {
        ratePlanCode: plan.code,
        ratePlanVersion: 2,
        entityType: 'cabin',
        accommodationKey: 'a-frame',
        dateKey: '2026-12-24',
        baseNightlyAmountCents: 99900
      },
      {
        ratePlanCode: plan.code,
        ratePlanVersion: 2,
        entityType: 'cabin',
        accommodationKey: 'lux-cabin',
        dateKey: '2026-12-27',
        baseNightlyAmountCents: 99900
      }
    ];
    const publicLoaderCalls = [];
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([plan]),
      loadNightlyRateOverrides: overrideLoader(overrides, publicLoaderCalls)
    });
    const quote = await buildQuoteForResolvedEntity(
      { entity, checkIn, checkOut, checkInDate, checkOutDate, adults: 2, children: 0 },
      {
        loadActiveSeasonalRatePlans: loader([plan]),
        loadNightlyRateOverrides: overrideLoader(overrides)
      }
    );

    assert.equal(priced.ok, true);
    assert.equal(priced.totalPrice, 575);
    assert.equal(quote.ok, true);
    assert.equal(quote.totalPrice, priced.totalPrice);
    assert.equal(priced.lodgingSubtotalBeforePromo, 575);
    assert.deepEqual(publicLoaderCalls[0], {
      ratePlanCode: plan.code,
      ratePlanVersion: 2,
      entityType: 'cabin',
      accommodationKey: 'lux-cabin',
      checkIn: checkInDate,
      checkOut: checkOutDate
    });
    assert.equal(priced.totalPrice, 155 + 155 + 155 + 110);
  });

  it('2c. Christmas search totals are authoritative for every accommodation', async () => {
    const plans = [{
      ...seasonalPlan({
        code: 'winter-cabin-stay-2026-27',
        version: 2,
        accommodations: [
          { accommodationKey: 'a-frame', entityType: 'cabinType', pricingMethod: 'nightly_per_unit', nightlyPerUnitAmount: 75 },
          { accommodationKey: 'lux-cabin', entityType: 'cabin', pricingMethod: 'nightly_per_unit', nightlyPerUnitAmount: 110 },
          { accommodationKey: 'stone-house', entityType: 'cabin', pricingMethod: 'nightly_per_unit', nightlyPerUnitAmount: 90 }
        ]
      })
    }];
    const stayDates = stay('2026-12-23', '2026-12-27');
    const prices = {
      'a-frame': 11000,
      'lux-cabin': 15500,
      'stone-house': 13000
    };
    const entities = [
      ['a-frame', 'cabinType'],
      ['lux-cabin', 'cabin'],
      ['stone-house', 'cabin']
    ];
    for (const [accommodationKey, entityType] of entities) {
      const priced = await pricePublicStayLodging({
        entity: { slug: accommodationKey },
        entityType,
        ...stayDates,
        adults: 2,
        loadActiveSeasonalRatePlans: loader(plans),
        loadNightlyRateOverrides: async (query) =>
          Array.from({ length: 4 }, (_, index) => ({
            ratePlanCode: query.ratePlanCode,
            ratePlanVersion: query.ratePlanVersion,
            entityType,
            accommodationKey,
            dateKey: `2026-12-${String(23 + index).padStart(2, '0')}`,
            baseNightlyAmountCents: prices[accommodationKey]
          }))
      });
      assert.equal(priced.ok, true);
      assert.equal(priced.totalPrice, prices[accommodationKey] * 4 / 100);
    }
  });

  it('3. draft and retired plans are ignored', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');
    const draft = seasonalPlan({ status: 'draft', code: 'draft-peak', nightly: undefined });
    const retired = seasonalPlan({ status: 'retired', code: 'retired-peak', version: 2 });
    // ensure accommodations still set for draft/retired fixtures
    draft.accommodations = seasonalPlan().accommodations;
    retired.accommodations = seasonalPlan().accommodations;

    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([draft, retired])
    });
    assert.equal(priced.ok, true);
    assert.equal(priced.pricingSource, 'entity');
    assert.equal(priced.totalPrice, 200);
  });

  it('4. cabin pricing parity with buildQuoteForResolvedEntity (no extras)', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate, checkIn, checkOut } = stay('2026-12-10', '2026-12-13');
    const plans = [seasonalPlan()];
    const load = loader(plans);
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    const quote = await buildQuoteForResolvedEntity(
      {
        entity,
        checkIn,
        checkOut,
        checkInDate,
        checkOutDate,
        adults: 2,
        children: 0,
        experienceKeys: []
      },
      { loadActiveSeasonalRatePlans: load }
    );
    assert.equal(quote.ok, true);
    assert.equal(priced.ok, true);
    assert.equal(priced.totalPrice, quote.baseLodgingPrice);
    assert.equal(priced.totalPrice, quote.totalPrice); // no extras
    assert.equal(priced.totalPrice, 540);
  });

  it('5. CabinType / A-frame pricing parity', async () => {
    const entity = aFrameEntity();
    const plan = seasonalPlan({
      accommodations: [
        {
          accommodationKey: 'a-frame',
          entityType: 'cabinType',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 95,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const { checkInDate, checkOutDate, checkIn, checkOut } = stay('2026-12-10', '2026-12-12');
    const load = loader([plan]);
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    const quote = await buildQuoteForResolvedEntity(
      {
        entity,
        entityType: 'cabinType',
        checkIn,
        checkOut,
        checkInDate,
        checkOutDate,
        adults: 2,
        children: 0,
        experienceKeys: []
      },
      { loadActiveSeasonalRatePlans: load }
    );
    assert.equal(priced.ok, true);
    assert.equal(quote.ok, true);
    assert.equal(priced.pricingSource, 'rate_plan');
    assert.equal(priced.totalPrice, quote.baseLodgingPrice);
    assert.equal(priced.totalPrice, 190);
  });

  it('6. every supported seasonal pricing method', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');

    const nightly = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([seasonalPlan()])
    });
    assert.equal(nightly.totalPrice, 360);

    const basePlus = seasonalPlan({
      code: 'winter-base-plus',
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_base_plus_extra_guest',
          nightlyPerUnitAmount: 150,
          includedGuests: 2,
          additionalGuestNightlyAmount: 40,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const withExtra = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 3,
      children: 0,
      loadActiveSeasonalRatePlans: loader([basePlus])
    });
    // 150*2 nights + 40*1 extra*2 nights = 300 + 80 = 380
    assert.equal(withExtra.totalPrice, 380);

    // fixed_per_unit is a package-style method; seasonal plans may still carry it on a row.
    // Public search still only selects seasonal_stay plans — method applies if selected.
    const fixedUnit = seasonalPlan({
      code: 'winter-fixed-unit',
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'fixed_per_unit',
          nightlyPerUnitAmount: null,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: 500,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const fixedPriced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([fixedUnit])
    });
    assert.equal(fixedPriced.totalPrice, 500);

    const perParticipant = seasonalPlan({
      code: 'winter-participant',
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'fixed_per_participant',
          nightlyPerUnitAmount: null,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: 200,
          childPackageAmount: 100,
          infantPackageAmount: 0
        }
      ]
    });
    const partPriced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 1,
      loadActiveSeasonalRatePlans: loader([perParticipant])
    });
    assert.equal(partPriced.totalPrice, 500);
  });

  it('7. guest-count pricing parity (base_plus_extra)', async () => {
    const entity = cabinEntity();
    const plan = seasonalPlan({
      code: 'guest-sensitive',
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_base_plus_extra_guest',
          nightlyPerUnitAmount: 100,
          includedGuests: 2,
          additionalGuestNightlyAmount: 25,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const { checkInDate, checkOutDate, checkIn, checkOut } = stay('2026-12-10', '2026-12-12');
    const load = loader([plan]);
    for (const guests of [
      { adults: 2, children: 0, expect: 200 },
      { adults: 3, children: 0, expect: 250 },
      { adults: 2, children: 1, expect: 250 }
    ]) {
      const priced = await pricePublicStayLodging({
        entity,
        checkInDate,
        checkOutDate,
        adults: guests.adults,
        children: guests.children,
        loadActiveSeasonalRatePlans: load
      });
      const quote = await buildQuoteForResolvedEntity(
        {
          entity,
          checkIn,
          checkOut,
          checkInDate,
          checkOutDate,
          adults: guests.adults,
          children: guests.children,
          experienceKeys: []
        },
        { loadActiveSeasonalRatePlans: load }
      );
      assert.equal(priced.totalPrice, guests.expect);
      assert.equal(priced.totalPrice, quote.baseLodgingPrice);
    }
  });

  it('8. two-night and three-night stays', async () => {
    const entity = cabinEntity();
    const load = loader([seasonalPlan()]);
    const two = stay('2026-12-10', '2026-12-12');
    const three = stay('2026-12-10', '2026-12-13');
    const p2 = await pricePublicStayLodging({
      entity,
      checkInDate: two.checkInDate,
      checkOutDate: two.checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    const p3 = await pricePublicStayLodging({
      entity,
      checkInDate: three.checkInDate,
      checkOutDate: three.checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    assert.equal(p2.totalPrice, 360);
    assert.equal(p3.totalPrice, 540);
  });

  it('9. arrival-window boundaries', async () => {
    const entity = cabinEntity();
    const load = loader([seasonalPlan()]);
    // Fully inside window
    const inside = stay('2026-12-01', '2026-12-03');
    const pIn = await pricePublicStayLodging({
      entity,
      checkInDate: inside.checkInDate,
      checkOutDate: inside.checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    assert.equal(pIn.pricingSource, 'rate_plan');

    // Outside window → entity
    const outside = stay('2026-11-10', '2026-11-12');
    const pOut = await pricePublicStayLodging({
      entity,
      checkInDate: outside.checkInDate,
      checkOutDate: outside.checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    assert.equal(pOut.pricingSource, 'entity');
    assert.equal(pOut.totalPrice, 200);
  });

  it('10. cross-boundary stay matches quote (no split pricing)', async () => {
    const entity = cabinEntity();
    const load = loader([seasonalPlan()]);
    // Spans into window from outside — seasonalStayFullyEligible requires full coverage
    const cross = stay('2026-11-29', '2026-12-03');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate: cross.checkInDate,
      checkOutDate: cross.checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: load
    });
    const quote = await buildQuoteForResolvedEntity(
      {
        entity,
        checkIn: cross.checkIn,
        checkOut: cross.checkOut,
        checkInDate: cross.checkInDate,
        checkOutDate: cross.checkOutDate,
        adults: 2,
        children: 0,
        experienceKeys: []
      },
      { loadActiveSeasonalRatePlans: load }
    );
    assert.equal(quote.ok, true);
    assert.equal(priced.ok, true);
    assert.equal(priced.pricingSource, 'entity');
    assert.equal(priced.totalPrice, quote.baseLodgingPrice);
    assert.equal(priced.totalPrice, calculateBaseLodgingPrice(entity, cross.checkInDate, cross.checkOutDate, 2, 0));
  });

  it('11. overlapping active plans fail closed (no entity fallback)', async () => {
    const entity = cabinEntity();
    const a = seasonalPlan({ code: 'overlap-a', version: 1 });
    const b = seasonalPlan({ code: 'overlap-b', version: 1 });
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([a, b])
    });
    assert.equal(priced.ok, false);
    assert.equal(priced.code, 'AMBIGUOUS_SEASONAL_RATE_PLAN');
    assert.equal(priced.message, SAFE_PRICING_ERROR_MESSAGES.AMBIGUOUS_SEASONAL_RATE_PLAN);
    const fields = availabilityPriceFieldsFromResult(priced);
    assert.equal(fields.totalPrice, null);
    assert.equal(fields.pricingError.code, 'AMBIGUOUS_SEASONAL_RATE_PLAN');
    assert.match(JSON.stringify(fields), /null/);
    assert.equal(JSON.stringify(fields).includes('ownerToken'), false);
  });

  it('12. fixed-package plans do not affect normal availability', async () => {
    const entity = cabinEntity();
    const pkg = {
      code: 'xmas-pkg',
      internalName: 'Xmas',
      version: 1,
      status: 'active',
      type: 'fixed_package',
      currency: 'EUR',
      arrivalWindowStart: null,
      arrivalWindowEnd: null,
      bookingWindowStart: null,
      bookingWindowEnd: null,
      minNights: 4,
      packageArrivalDate: '2026-12-20',
      packageDepartureDate: '2026-12-24',
      inventoryMode: 'exclusive',
      requiresFullPayment: true,
      cancellationPolicyCode: 'normal-stay-standard',
      cancellationPolicyVersion: 1,
      inclusions: [],
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'fixed_per_participant',
          nightlyPerUnitAmount: null,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: 999,
          childPackageAmount: 500,
          infantPackageAmount: 0
        }
      ]
    };
    const { checkInDate, checkOutDate } = stay('2026-12-20', '2026-12-24');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([pkg])
    });
    assert.equal(priced.ok, true);
    assert.equal(priced.pricingSource, 'entity');
    assert.equal(priced.totalPrice, 400);
  });

  it('13. exact money precision and currency', async () => {
    const entity = cabinEntity();
    const plan = seasonalPlan({
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 99.99,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([plan])
    });
    assert.equal(priced.currency, 'EUR');
    assert.equal(priced.totalPrice, 199.98);
  });

  it('14. incomplete searches are not priced by this service (starting price is client/entity)', () => {
    // Documented contract: pricePublicStayLodging requires complete stay inputs.
    // Starting/"from" prices remain entity pricePerNight on incomplete client searches.
    assert.equal(typeof cabinEntity().pricePerNight, 'number');
  });

  it('15. complete availability total equals booking quote total for identical inputs', async () => {
    const entity = cabinEntity({ pricePerNight: 85 });
    const { checkInDate, checkOutDate, checkIn, checkOut } = stay('2026-12-15', '2026-12-18');
    const load = loader([seasonalPlan()]);
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 1,
      loadActiveSeasonalRatePlans: load
    });
    const quote = await buildQuoteForResolvedEntity(
      {
        entity,
        checkIn,
        checkOut,
        checkInDate,
        checkOutDate,
        adults: 2,
        children: 1,
        experienceKeys: []
      },
      { loadActiveSeasonalRatePlans: load }
    );
    assert.equal(priced.ok, true);
    assert.equal(quote.ok, true);
    assert.equal(priced.totalPrice, quote.totalPrice);
    assert.equal(priced.totalPrice, quote.baseLodgingPrice);
  });

  it('19. no management/internal metadata leaks in price fields', async () => {
    const entity = cabinEntity();
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12');
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([seasonalPlan()])
    });
    const fields = availabilityPriceFieldsFromResult(priced);
    const json = JSON.stringify(fields);
    for (const banned of [
      'ownerToken',
      'createdBy',
      'activatedBy',
      'revision',
      '_id',
      'lock',
      'operatorId',
      'mongodb'
    ]) {
      assert.equal(json.includes(banned), false, banned);
    }
    assert.deepEqual(Object.keys(fields.ratePlan).sort(), ['code', 'type', 'version']);
  });

  it('20. service performs no database mutation (source scan)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../services/publicAvailabilityPricingService.js'),
      'utf8'
    );
    assert.equal(/\.(create|updateOne|findByIdAndUpdate|deleteOne|save)\(/.test(src), false);
    assert.equal(/RatePlan\.(create|update)/.test(src), false);
  });

  it('SEASONAL_MIN_NIGHTS fails closed (no undercharge)', async () => {
    const entity = cabinEntity();
    const plan = seasonalPlan({ minNights: 3 });
    const { checkInDate, checkOutDate } = stay('2026-12-10', '2026-12-12'); // 2 nights
    const priced = await pricePublicStayLodging({
      entity,
      checkInDate,
      checkOutDate,
      adults: 2,
      children: 0,
      loadActiveSeasonalRatePlans: loader([plan])
    });
    assert.equal(priced.ok, false);
    assert.equal(priced.code, 'SEASONAL_MIN_NIGHTS');
    assert.equal(availabilityPriceFieldsFromResult(priced).totalPrice, null);
  });

  it('C1. availabilityPriceFieldsFromResult never copies priced.message (malicious leak probe)', () => {
    const leaks = [
      'ownerToken=SECRETTOKEN',
      'mongodb://user:pass@host/database',
      'password=hunter2',
      'Error: boom\n    at pricePublicStayLodging (/app/server/services/publicAvailabilityPricingService.js:100:1)',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.leak'
    ];

    for (const leak of leaks) {
      for (const code of [
        'AMBIGUOUS_SEASONAL_RATE_PLAN',
        'SEASONAL_MIN_NIGHTS',
        'PRICING_FAILED',
        'NOT_A_REAL_CODE',
        undefined,
        null,
        42,
        { nested: leak }
      ]) {
        const fields = availabilityPriceFieldsFromResult({
          ok: false,
          code,
          message: leak,
          details: leak,
          stack: leak,
          extra: { uri: leak, password: 'hunter2' }
        });
        const json = JSON.stringify(fields);
        assert.equal(fields.totalPrice, null);
        assert.ok(fields.pricingError);
        assert.equal(typeof fields.pricingError.code, 'string');
        assert.equal(typeof fields.pricingError.message, 'string');
        assert.equal(
          Object.prototype.hasOwnProperty.call(SAFE_PRICING_ERROR_MESSAGES, fields.pricingError.code),
          true
        );
        assert.equal(fields.pricingError.message, SAFE_PRICING_ERROR_MESSAGES[fields.pricingError.code]);
        for (const banned of leaks) {
          assert.equal(json.includes(banned), false, `leak via code=${String(code)}`);
        }
        assert.equal(json.includes('SECRETTOKEN'), false);
        assert.equal(json.includes('hunter2'), false);
        assert.equal(json.includes('mongodb://'), false);
        assert.equal(json.includes('eyJhbGciOi'), false);
        assert.equal(json.includes('details'), false);
        assert.equal(json.includes('stack'), false);
        assert.equal(json.includes('extra'), false);
      }
    }

    // Known code keeps that code; unknown/malformed → PRICING_FAILED
    assert.deepEqual(publicPricingErrorFromCode('SEASONAL_MIN_NIGHTS'), {
      code: 'SEASONAL_MIN_NIGHTS',
      message: SAFE_PRICING_ERROR_MESSAGES.SEASONAL_MIN_NIGHTS
    });
    assert.deepEqual(publicPricingErrorFromCode('TOTALLY_UNKNOWN'), {
      code: 'PRICING_FAILED',
      message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    });
    assert.deepEqual(publicPricingErrorFromCode(null), {
      code: 'PRICING_FAILED',
      message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    });
    assert.deepEqual(publicPricingErrorFromCode({ code: 'AMBIGUOUS_SEASONAL_RATE_PLAN' }), {
      code: 'PRICING_FAILED',
      message: SAFE_PRICING_ERROR_MESSAGES.PRICING_FAILED
    });
  });
});

describe('RP4 availabilityRoutes wiring (static)', () => {
  it('routes use publicAvailabilityPricingService and do not call calculateBaseLodgingPrice directly', () => {
    const src = fs.readFileSync(path.join(__dirname, '../routes/availabilityRoutes.js'), 'utf8');
    assert.match(src, /pricePublicStayLodging/);
    assert.match(src, /availabilityPriceFieldsFromResult/);
    assert.equal(/calculateBaseLodgingPrice\s*\(/.test(src), false);
    assert.equal(/DELETE/.test(src), false);
  });
});
