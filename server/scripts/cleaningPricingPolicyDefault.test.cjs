'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const {
  buildEditableInputFields,
  calculatePolicyLineItems,
  calculateCleaningPaymentSummary
} = require('../services/ops/cleaning/cleaningPricingService');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  defaultRulesForPropertyKind,
  defaultItemsForPropertyKind
} = require('../data/cleaning/defaultCleaningPricingPolicy');
const { seedPolicies } = require('./cleaningPricingPolicySeed.cjs');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('default cleaning pricing policy rules', async (t) => {
  const cabinPolicy = {
    _id: new mongoose.Types.ObjectId(),
    version: DEFAULT_CLEANING_POLICY_VERSION,
    currency: 'EUR',
    rules: defaultRulesForPropertyKind('cabin')
  };

  await t.test('cabin editableInputFields derived from policy', () => {
    const fields = buildEditableInputFields(cabinPolicy);
    assert.equal(fields.length, 5);
    assert.ok(fields.some((f) => f.inputKey === 'transport' && f.type === 'boolean' && f.amountEUR === 8));
    assert.ok(fields.some((f) => f.inputKey === 'luxCabinClean'));
    assert.ok(!fields.some((f) => f.inputKey === 'aframeSmallOnlyCount'));
  });

  await t.test('cabin business tasks produce expected line items', () => {
    const daySheet = {
      inputs: {
        transport: true,
        luxCabinClean: true,
        houseFullClean: true,
        deepCleaning: true,
        laundryCount: 3
      },
      perCheckoutInputs: []
    };
    const calc = calculatePolicyLineItems([], cabinPolicy, daySheet);
    assert.equal(calc.totalAmountEUR, 214);
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'transport' && li.amountEUR === 8));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'laundry' && li.amountEUR === 6));
    assert.equal(calc.editableInputFields.length, 5);
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
    assert.equal(cabin.rules.length, 5);
    assert.equal(valley.rules.length, 5);
    assert.ok(cabin.rules.some((r) => r.ruleKey === 'lux_cabin'));
    assert.ok(valley.rules.some((r) => r.ruleKey === 'aframe_small'));
  });

  await t.test('default items differ per location', () => {
    const cabin = defaultItemsForPropertyKind('cabin');
    const valley = defaultItemsForPropertyKind('valley');
    assert.equal(cabin.length, 5);
    assert.equal(valley.length, 5);
    assert.ok(cabin.some((i) => i.ruleKey === 'lux_cabin'));
    assert.ok(!cabin.some((i) => i.ruleKey === 'aframe_small'));
    assert.ok(valley.some((i) => i.ruleKey === 'aframe_small'));
    assert.ok(!valley.some((i) => i.ruleKey === 'lux_cabin'));
  });

  await t.test('payment-summary returns editableInputFields when policy active', async () => {
    await CleaningPricingPolicy.updateMany({}, { $set: { isActive: false } });
    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'summary-fields-test',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });
    const summary = await calculateCleaningPaymentSummary({
      date: '2026-08-01',
      propertyKind: 'cabin'
    });
    assert.ok(Array.isArray(summary.editableInputFields));
    assert.equal(summary.editableInputFields.length, 5);
  });
});
