'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_FIXED_RATE_PLANS,
  resolveWinterVillageOffer,
  PAYMENT_TERM_CODE,
  PAYMENT_TERM_VERSION,
  CANCELLATION_POLICY_CODE,
  CANCELLATION_POLICY_VERSION,
  WINTER_VILLAGE_SEASONAL_RATE_PLAN
} = require('../config/winterVillageCommercialCatalog');
const {
  buildWinterVillageFixedPackageQuote,
  buildWinterVillageStayQuote
} = require('../services/winterVillageCommercialService');
const {
  auditWinterVillageCommercialData,
  expectedPaymentTermShape
} = require('../services/winterVillageCommercialReadinessService');
const {
  selectSeasonalRatePlan,
  seasonalStayFullyEligible
} = require('../services/ratePlanService');

const PARTICIPANTS = [
  { fullName: 'Parent One', dateOfBirth: '1985-01-01' },
  { fullName: 'Child One', dateOfBirth: '2018-01-01' }
];

function cabinTypeEntity(slug, capacity = 2) {
  return {
    _id: `${slug}-type-id`,
    slug,
    capacity,
    isActive: true,
    inventoryType: 'multi',
    inventoryMode: 'multi'
  };
}

function packagePlan(code) {
  const plan = WINTER_VILLAGE_FIXED_RATE_PLANS.find((row) => row.code === code);
  return plan ? { ...plan, status: 'active' } : null;
}

function quoteDeps(plan, resources = [{ _id: 'unit-1', isActive: true, salesStatus: 'ready' }]) {
  return {
    loadRatePlanByCodeVersion: async () => plan,
    listInventoryResources: async () => resources,
    loadExclusiveFixedPackages: async () => [plan],
    isResourceConflicted: async () => false,
    todayDateOnly: '2026-09-25'
  };
}

function seasonalPlan() {
  return { ...WINTER_VILLAGE_SEASONAL_RATE_PLAN, status: 'active' };
}

test('catalog maps every planned date to one exact fixed package identity', () => {
  assert.equal(WINTER_VILLAGE_PRODUCTS['parent-child'].offers.length, 3);
  assert.equal(WINTER_VILLAGE_PRODUCTS.christmas.offers.length, 1);
  assert.deepEqual(
    resolveWinterVillageOffer('christmas', '2026-12-24', '2026-12-27'),
    {
      offerId: 'christmas-2026',
      ratePlanCode: 'christmas-2026',
      ratePlanVersion: 1,
      checkIn: '2026-12-24',
      checkOut: '2026-12-27'
    }
  );
  assert.equal(resolveWinterVillageOffer('christmas', '2026-12-23', '2026-12-27'), null);
});

test('Christmas A-frame quote uses authoritative fixed price and real inventory', async () => {
  const plan = packagePlan('christmas-2026');
  const result = await buildWinterVillageFixedPackageQuote(
    {
      productId: 'christmas',
      checkIn: '2026-12-24',
      checkOut: '2026-12-27',
      accommodationKey: 'a-frame',
      entity: cabinTypeEntity('a-frame'),
      participants: PARTICIPANTS
    },
    quoteDeps(plan)
  );

  assert.equal(result.ok, true);
  assert.equal(result.totalPrice, 490);
  assert.equal(result.ratePlan.code, 'christmas-2026');
  assert.equal(result.packageSnapshot.availableUnitCount, 1);
  assert.equal(result.packageSnapshot.totalBeforePaymentCredits, 490);
});

test('Parent & Child uses participant pricing and rejects unavailable inventory', async () => {
  const plan = packagePlan('parent-child-2026-12');
  const result = await buildWinterVillageFixedPackageQuote(
    {
      productId: 'parent-child',
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      accommodationKey: 'stone-house',
      entity: { ...cabinTypeEntity('stone-house', 6), inventoryType: 'single' },
      participants: PARTICIPANTS
    },
    quoteDeps(plan, [{ _id: 'house-1', isActive: true, salesStatus: 'ready' }])
  );
  assert.equal(result.ok, true);
  assert.equal(result.totalPrice, 190);

  const unavailable = await buildWinterVillageFixedPackageQuote(
    {
      productId: 'parent-child',
      checkIn: '2026-12-11',
      checkOut: '2026-12-13',
      accommodationKey: 'a-frame',
      entity: cabinTypeEntity('a-frame'),
      participants: PARTICIPANTS
    },
    quoteDeps(plan, [])
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.code, 'NO_ELIGIBLE_UNIT');
});

test('catalog fixed plans use the existing payment-term and cancellation references', () => {
  for (const plan of WINTER_VILLAGE_FIXED_RATE_PLANS) {
    assert.equal(plan.paymentTermCode, 'split-40-60-30d');
    assert.equal(plan.paymentTermVersion, 1);
    assert.equal(plan.cancellationPolicyCode, 'normal-stay-standard');
    assert.equal(plan.cancellationPolicyVersion, 1);
    assert.equal(plan.inventoryMode, 'exclusive');
  }
});

test('Winter Cabin Stay uses the exact seasonal plan and nightly override boundary', async () => {
  const plan = seasonalPlan();
  const result = await buildWinterVillageStayQuote(
    {
      entity: { slug: 'a-frame', pricePerNight: 999, experiences: [] },
      entityType: 'cabinType',
      checkIn: '2026-12-23',
      checkOut: '2026-12-27',
      adults: 2,
      children: 0
    },
    {
      loadActiveSeasonalRatePlans: async () => [plan],
      loadNightlyRateOverrides: async () => [
        { dateKey: '2026-12-23', baseNightlyAmountCents: 11000 },
        { dateKey: '2026-12-24', baseNightlyAmountCents: 11000 },
        { dateKey: '2026-12-25', baseNightlyAmountCents: 11000 },
        { dateKey: '2026-12-26', baseNightlyAmountCents: 11000 }
      ],
      applyPromoToBreakdown: async (quote) => quote
    }
  );

  assert.equal(result.totalPrice, 440);
  assert.equal(result.ratePlanPricingBreakdown.ratePlanCode, 'winter-cabin-stay-2026-27');
  assert.equal(result.nightlyPricing.length, 4);
  assert.equal(result.nightlyPricing[0].effectiveBaseNightlyAmount, 110);
});

test('Winter Cabin Stay leaves booking sale window open while restricting stay dates', () => {
  const plan = seasonalPlan();
  assert.equal(plan.bookingWindowStart, null);
  assert.equal(plan.bookingWindowEnd, null);
  assert.equal(seasonalStayFullyEligible(plan, '2026-12-23', '2026-12-27'), true);
  assert.equal(seasonalStayFullyEligible(plan, '2026-11-30', '2026-12-02'), false);
  const selected = selectSeasonalRatePlan({
    plans: [plan],
    checkIn: '2026-12-23',
    checkOut: '2026-12-27',
    accommodationKey: 'stone-house'
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.resolved.pricing.pricingMethod, 'nightly_base_plus_extra_guest');
});

test('Winter Cabin Stay Stone House applies the €90 minimum and €30 extra-guest rate', async () => {
  const plan = seasonalPlan();
  const expectedByGuests = [90, 90, 90, 120, 150, 180];
  for (const [index, expected] of expectedByGuests.entries()) {
    const guests = index + 1;
    const result = await buildWinterVillageStayQuote(
      {
        entity: { slug: 'stone-house', experiences: [] },
        entityType: 'cabin',
        checkIn: '2026-12-23',
        checkOut: '2026-12-25',
        adults: guests,
        children: 0
      },
      {
        loadActiveSeasonalRatePlans: async () => [plan],
        loadNightlyRateOverrides: async () => [],
        applyPromoToBreakdown: async (quote) => quote
      }
    );
    assert.equal(result.totalPrice, expected * 2, `${guests} guests`);
    assert.equal(result.ratePlanPricingBreakdown.preDiscountTotal / 2, expected, `${guests} guests per night`);
  }
});

test('commercial readiness accepts active exact plans, references, and physical inventory', () => {
  const report = auditWinterVillageCommercialData({
    ratePlans: [
      seasonalPlan(),
      ...WINTER_VILLAGE_FIXED_RATE_PLANS.map((plan) => ({ ...plan, status: 'active' }))
    ],
    paymentTerms: [
      {
        code: PAYMENT_TERM_CODE,
        version: PAYMENT_TERM_VERSION,
        status: 'active',
        scheduleKind: 'percent_split',
        legs: [
          { amountType: 'percent_bps', amountValue: 4000, dueRule: 'checkout' },
          { amountType: 'remainder', dueRule: 'days_before_arrival', dueOffsetDays: 30 }
        ]
      }
    ],
    cancellationPolicies: [
      {
        code: CANCELLATION_POLICY_CODE,
        version: CANCELLATION_POLICY_VERSION,
        status: 'active',
        policyType: 'normal_stay',
        refundTiers: []
      }
    ],
    inventory: {
      'a-frame': { entityType: 'cabinType', resources: [{ _id: 'af-1', isActive: true }] },
      'lux-cabin': { entityType: 'cabin', resources: [{ _id: 'lux-1', isActive: true }] },
      'stone-house': { entityType: 'cabin', resources: [{ _id: 'stone-1', isActive: true }] }
    }
  });

  assert.equal(report.ok, true);
  assert.equal(report.ratePlans.length, 5);
  assert.equal(report.paymentTerm.active, true);
  assert.equal(report.cancellationPolicy.policyType, 'normal_stay');
});

test('commercial readiness fails closed when the exact payment term is absent or mismatched', () => {
  assert.deepEqual(expectedPaymentTermShape(null), ['missing']);
  const report = auditWinterVillageCommercialData({
    ratePlans: [],
    paymentTerms: [],
    cancellationPolicies: [],
    inventory: {}
  });

  assert.equal(report.ok, false);
  assert.ok(report.errors.includes('split-40-60-30d@v1: missing'));
  assert.ok(report.errors.includes('normal-stay-standard@v1: missing'));
});
