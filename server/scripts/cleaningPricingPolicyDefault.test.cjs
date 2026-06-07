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
  defaultCleaningPricingRules
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
  const policy = {
    _id: new mongoose.Types.ObjectId(),
    version: DEFAULT_CLEANING_POLICY_VERSION,
    currency: 'EUR',
    rules: defaultCleaningPricingRules()
  };

  await t.test('editableInputFields derived from policy', () => {
    const fields = buildEditableInputFields(policy);
    assert.equal(fields.length, 7);
    assert.ok(fields.some((f) => f.inputKey === 'transport' && f.type === 'boolean' && f.amountEUR === 8));
    assert.ok(
      fields.some(
        (f) => f.inputKey === 'aframeSmallOnlyCount' && f.type === 'quantity' && f.unitAmountEUR === 10
      )
    );
    assert.ok(
      fields.some(
        (f) => f.inputKey === 'laundryCount' && f.type === 'quantity' && f.unitAmountEUR === 2
      )
    );
  });

  await t.test('all business tasks produce expected line items', () => {
    const daySheet = {
      inputs: {
        transport: true,
        aframeSmallOnlyCount: 1,
        aframeFullCount: 2,
        luxCabinClean: true,
        houseFullClean: true,
        deepCleaning: true,
        laundryCount: 3
      },
      perCheckoutInputs: []
    };
    const calc = calculatePolicyLineItems([], policy, daySheet);
    assert.equal(calc.totalAmountEUR, 264);
    const amounts = calc.lineItems.map((li) => li.amountEUR).sort((a, b) => a - b);
    assert.deepEqual(amounts, [6, 8, 10, 25, 25, 40, 150]);
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'transport' && li.amountEUR === 8));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'aframe_small' && li.amountEUR === 10));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'aframe_full' && li.amountEUR === 40));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'lux_cabin' && li.amountEUR === 25));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'house_full' && li.amountEUR === 25));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'deep_cleaning' && li.amountEUR === 150));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'laundry' && li.amountEUR === 6));
    assert.equal(calc.editableInputFields.length, 7);
  });

  await t.test('seed script creates cabin and valley policies', async () => {
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
    assert.equal(cabin.rules.length, 7);
  });

  await t.test('payment-summary returns editableInputFields when policy active', async () => {
    await CleaningPricingPolicy.updateMany({}, { $set: { isActive: false } });
    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'summary-fields-test',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultCleaningPricingRules()
    });
    const summary = await calculateCleaningPaymentSummary({
      date: '2026-08-01',
      propertyKind: 'cabin'
    });
    assert.ok(Array.isArray(summary.editableInputFields));
    assert.equal(summary.editableInputFields.length, 7);
  });
});
