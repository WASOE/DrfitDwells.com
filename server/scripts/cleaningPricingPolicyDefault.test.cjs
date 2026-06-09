'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const {
  priceDay,
  calculateCleaningPaymentSummary
} = require('../services/ops/cleaning/cleaningPricingService');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  defaultRulesForPropertyKind
} = require('../data/cleaning/defaultCleaningPricingPolicy');
const { seedPolicies } = require('./cleaningPricingPolicySeed.cjs');

let mongoServer;

function policyDoc(propertyKind) {
  return {
    propertyKind,
    _id: new mongoose.Types.ObjectId(),
    version: DEFAULT_CLEANING_POLICY_VERSION,
    currency: 'EUR',
    rules: defaultRulesForPropertyKind(propertyKind)
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('default checkout-driven payout rules', async (t) => {
  await t.test('cabin checkout without the-cabin tag is unmatched with €0 payout', () => {
    const cabinPolicy = policyDoc('cabin');
    const checkouts = [
      {
        bookingId: 'b1',
        cabinName: 'Main Cabin',
        propertyKind: 'cabin',
        cleaningTags: []
      }
    ];
    const calc = priceDay(checkouts, cabinPolicy);
    assert.equal(calc.totalAmountEUR, 0);
    assert.equal(calc.unmatchedCheckouts.length, 1);
    assert.equal(calc.unmatchedCheckouts[0].bookingId, 'b1');
  });

  await t.test('cabin checkout produces transport + clean lines', () => {
    const cabinPolicy = policyDoc('cabin');
    const checkouts = [
      {
        bookingId: 'b1',
        cabinName: 'Main Cabin',
        propertyKind: 'cabin',
        cleaningTags: ['the-cabin']
      }
    ];
    const calc = priceDay(checkouts, cabinPolicy);
    assert.equal(calc.totalAmountEUR, 35);
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'transport' && li.amountEUR === 15));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'cabin_clean' && li.amountEUR === 20));
    assert.equal(calc.lineItems.every((li) => li.amountType === 'cleaner_payout'), true);
    assert.deepEqual(calc.unmatchedCheckouts, []);
  });

  await t.test('seed script creates location-specific policies', async () => {
    await CleaningPricingPolicy.deleteMany({});
    await seedPolicies();
    const cabin = await CleaningPricingPolicy.findOne({
      propertyKind: 'cabin',
      version: DEFAULT_CLEANING_POLICY_VERSION
    }).lean();
    const valley = await CleaningPricingPolicy.findOne({
      propertyKind: 'valley',
      version: DEFAULT_CLEANING_POLICY_VERSION
    }).lean();
    assert.ok(cabin?.isActive);
    assert.ok(valley?.isActive);
    assert.equal(cabin.rules.length, 2);
    assert.equal(valley.rules.length, 5);
    assert.ok(cabin.rules.some((r) => r.ruleKey === 'cabin_clean'));
    assert.ok(valley.rules.some((r) => r.ruleKey === 'aframe_clean' && r.type === 'tiered_per_event'));
    assert.ok(!valley.rules.some((r) => r.ruleKey === 'deep_cleaning'));
    assert.ok(!valley.rules.some((r) => r.ruleKey === 'aframe_small'));
  });

  await t.test('default rules differ per location', () => {
    const cabin = defaultRulesForPropertyKind('cabin');
    const valley = defaultRulesForPropertyKind('valley');
    assert.equal(cabin.length, 2);
    assert.equal(valley.length, 5);
    assert.ok(cabin.some((i) => i.ruleKey === 'cabin_clean'));
    assert.ok(!cabin.some((i) => i.ruleKey === 'aframe_clean'));
    assert.ok(valley.some((i) => i.ruleKey === 'aframe_clean'));
    assert.ok(valley.some((i) => i.ruleKey === 'lux_cabin'));
  });

  await t.test('payment-summary returns noPolicy when policy missing', async () => {
    await CleaningPricingPolicy.updateMany({}, { $set: { isActive: false } });
    const summary = await calculateCleaningPaymentSummary({
      date: '2026-08-01',
      propertyKind: 'cabin'
    });
    assert.equal(summary.noPolicy, true);
    assert.equal(summary.totalAmount, 0);
    assert.deepEqual(summary.lineItems, []);
  });
});
