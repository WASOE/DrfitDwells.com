'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultRulesForPropertyKind } = require('../data/cleaning/defaultCleaningPricingPolicy');
const { priceDay } = require('../services/ops/cleaning/cleaningPricingService');

function checkout(bookingId, cleaningTag) {
  return {
    bookingId,
    cabinName: bookingId,
    propertyKind: 'valley',
    cleaningTags: [cleaningTag]
  };
}

const cases = [
  {
    name: '1 A-frame',
    checkouts: [checkout('af-1', 'a-frame')],
    totalAmountEUR: 32,
    cleaningAmounts: { aframe_clean: [20] }
  },
  {
    name: '2 A-frames',
    checkouts: [checkout('af-1', 'a-frame'), checkout('af-2', 'a-frame')],
    totalAmountEUR: 46,
    cleaningAmounts: { aframe_clean: [20, 10] }
  },
  {
    name: '3 A-frames',
    checkouts: [
      checkout('af-1', 'a-frame'),
      checkout('af-2', 'a-frame'),
      checkout('af-3', 'a-frame')
    ],
    totalAmountEUR: 60,
    cleaningAmounts: { aframe_clean: [20, 10, 10] }
  },
  {
    name: 'Lux',
    checkouts: [checkout('lux-1', 'lux-cabin')],
    totalAmountEUR: 37,
    cleaningAmounts: { lux_cabin: [25] }
  },
  {
    name: 'House',
    checkouts: [checkout('house-1', 'stone-house')],
    totalAmountEUR: 37,
    cleaningAmounts: { house_full: [25] }
  },
  {
    name: 'A-frame + Lux',
    checkouts: [checkout('lux-1', 'lux-cabin'), checkout('af-1', 'a-frame')],
    totalAmountEUR: 61,
    cleaningAmounts: { aframe_clean: [20], lux_cabin: [25] }
  },
  {
    name: '2 A-frames + Lux',
    checkouts: [
      checkout('lux-1', 'lux-cabin'),
      checkout('af-2', 'a-frame'),
      checkout('af-1', 'a-frame')
    ],
    totalAmountEUR: 75,
    cleaningAmounts: { aframe_clean: [20, 10], lux_cabin: [25] }
  },
  {
    name: 'A-frame + House + Lux',
    checkouts: [
      checkout('house-1', 'stone-house'),
      checkout('lux-1', 'lux-cabin'),
      checkout('af-1', 'a-frame')
    ],
    totalAmountEUR: 90,
    cleaningAmounts: { aframe_clean: [20], house_full: [25], lux_cabin: [25] }
  }
];

test('default Valley policy exact pricing and line-item invariants', () => {
  const policy = {
    propertyKind: 'valley',
    currency: 'EUR',
    rules: defaultRulesForPropertyKind('valley')
  };

  for (const scenario of cases) {
    const calc = priceDay(scenario.checkouts, policy);
    assert.equal(calc.totalAmountEUR, scenario.totalAmountEUR, scenario.name);

    const transportItems = calc.lineItems.filter((item) => item.ruleKey === 'transport');
    assert.equal(transportItems.length, 1, `${scenario.name}: transport count`);
    assert.deepEqual(
      {
        amountEUR: transportItems[0].amountEUR,
        category: transportItems[0].category,
        source: transportItems[0].source
      },
      { amountEUR: 8, category: 'daily', source: 'policy' },
      `${scenario.name}: transport line`
    );

    const laundryItems = calc.lineItems.filter((item) => item.ruleKey === 'laundry');
    assert.equal(laundryItems.length, scenario.checkouts.length, `${scenario.name}: laundry count`);
    assert.ok(
      laundryItems.every(
        (item) =>
          item.amountEUR === 4 &&
          item.unitAmountEUR === 4 &&
          item.quantity === 1 &&
          item.category === 'event' &&
          item.source === 'policy'
      ),
      `${scenario.name}: laundry lines`
    );

    for (const [ruleKey, expectedAmounts] of Object.entries(scenario.cleaningAmounts)) {
      const cleaningItems = calc.lineItems.filter((item) => item.ruleKey === ruleKey);
      assert.deepEqual(
        cleaningItems.map((item) => item.amountEUR),
        expectedAmounts,
        `${scenario.name}: ${ruleKey} amounts`
      );
      assert.ok(
        cleaningItems.every(
          (item) =>
            item.category === (ruleKey === 'aframe_clean' ? 'tiered' : 'event') &&
            item.source === 'policy'
        ),
        `${scenario.name}: ${ruleKey} line metadata`
      );
    }

    const aFrameCount = scenario.checkouts.filter((item) =>
      item.cleaningTags.includes('a-frame')
    ).length;
    const aFrameAmounts = calc.lineItems
      .filter((item) => item.ruleKey === 'aframe_clean')
      .map((item) => item.amountEUR);
    assert.equal(
      aFrameAmounts.filter((amount) => amount === 20).length,
      aFrameCount > 0 ? 1 : 0,
      `${scenario.name}: one initial A-frame tier`
    );
    assert.equal(
      aFrameAmounts.filter((amount) => amount === 10).length,
      Math.max(0, aFrameCount - 1),
      `${scenario.name}: additional A-frame tiers`
    );
    assert.deepEqual(calc.unmatchedCheckouts, [], `${scenario.name}: matched checkouts`);
  }
});
