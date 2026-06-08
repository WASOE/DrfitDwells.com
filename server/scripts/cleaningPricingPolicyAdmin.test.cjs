'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const {
  ACTIONS,
  evaluatePermission,
  ROLE_ADMIN,
  ROLE_OPERATOR,
  ROLE_CLEANER
} = require('../services/permissionService');
const { resolveModulesForRole } = require('../services/ops/opsModuleRegistry');
const {
  getPricingPolicySettings,
  updatePricingPolicyItems,
  validateItems,
  slugifyRuleKey
} = require('../services/ops/cleaning/cleaningPricingPolicyAdminService');
const { calculateCleaningPaymentSummary } = require('../services/ops/cleaning/cleaningPricingService');
const { defaultItemsForPropertyKind } = require('../data/cleaning/defaultCleaningPricingPolicy');

let mongoServer;

const CABIN_ITEMS = defaultItemsForPropertyKind('cabin');
const VALLEY_ITEMS = defaultItemsForPropertyKind('valley');

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CleaningPricingPolicy.deleteMany({});
});

test('GET pricing-policy returns independent cabin and valley default items', async () => {
  const data = await getPricingPolicySettings();

  assert.equal(data.currency, 'EUR');
  assert.equal(data.cabin.mode, 'legacy');
  assert.equal(data.cabin.needsActivation, true);
  assert.equal(data.valley.mode, 'legacy');
  assert.equal(data.cabin.items.length, 5);
  assert.equal(data.valley.items.length, 5);
  assert.ok(data.cabin.items.some((r) => r.ruleKey === 'lux_cabin'));
  assert.ok(!data.cabin.items.some((r) => r.ruleKey === 'aframe_small'));
  assert.ok(data.valley.items.some((r) => r.ruleKey === 'aframe_small'));
  assert.ok(!data.valley.items.some((r) => r.ruleKey === 'lux_cabin'));
});

test('PUT creates active policy if missing', async () => {
  const data = await updatePricingPolicyItems({
    propertyKind: 'cabin',
    items: CABIN_ITEMS
  });

  assert.equal(data.cabin.mode, 'policy');
  assert.equal(data.cabin.needsActivation, false);
  assert.ok(data.cabin.policyId);
  assert.equal(data.cabin.isActive, true);
  assert.equal(data.valley.mode, 'legacy');

  const stored = await CleaningPricingPolicy.findById(data.cabin.policyId).lean();
  assert.ok(stored);
  assert.equal(stored.currency, 'EUR');
  assert.equal(stored.rules.length, 5);
});

test('PUT updates only the requested location', async () => {
  await updatePricingPolicyItems({ propertyKind: 'cabin', items: CABIN_ITEMS });

  const updatedCabin = CABIN_ITEMS.map((item) =>
    item.ruleKey === 'transport' ? { ...item, amountEUR: 9 } : item
  );
  const data = await updatePricingPolicyItems({
    propertyKind: 'cabin',
    items: updatedCabin
  });

  const transport = data.cabin.items.find((r) => r.ruleKey === 'transport');
  assert.equal(transport.amountEUR, 9);
  assert.equal(data.valley.mode, 'legacy');
  assert.equal(await CleaningPricingPolicy.countDocuments({ propertyKind: 'cabin', isActive: true }), 1);
  assert.equal(await CleaningPricingPolicy.countDocuments({ propertyKind: 'valley', isActive: true }), 0);
});

test('PUT derives ruleKey from label for new items', async () => {
  const items = [
    ...CABIN_ITEMS,
    { ruleKey: '', label: 'Extra towels', type: 'fixed', amountEUR: 5, enabled: true }
  ];
  const data = await updatePricingPolicyItems({ propertyKind: 'cabin', items });

  assert.ok(data.cabin.items.some((r) => r.ruleKey === 'extra_towels' && r.amountEUR === 5));
});

test('PUT rejects invalid item type', () => {
  assert.throws(
    () =>
      validateItems([
        { ruleKey: 'x', label: 'Bad', type: 'formula', amountEUR: 1, enabled: true }
      ]),
    /type must be "fixed" or "quantity"/
  );
});

test('PUT rejects negative amount', () => {
  assert.throws(
    () =>
      validateItems([
        { ruleKey: 'transport', label: 'Fuel', type: 'fixed', amountEUR: -1, enabled: true }
      ]),
    /amountEUR must be a number >= 0/
  );
});

test('PUT rejects enabled item without label', () => {
  assert.throws(
    () =>
      validateItems([{ ruleKey: '', label: '', type: 'fixed', amountEUR: 0, enabled: true }]),
    /label is required for enabled items/
  );
});

test('slugifyRuleKey produces stable keys', () => {
  assert.equal(slugifyRuleKey('Fuel / transport per visit'), 'fuel_transport_per_visit');
});

test('PUT enforces EUR currency on stored policy', async () => {
  const data = await updatePricingPolicyItems({
    propertyKind: 'valley',
    items: VALLEY_ITEMS
  });

  const stored = await CleaningPricingPolicy.findById(data.valley.policyId).lean();
  assert.equal(stored.currency, 'EUR');
});

test('permissions: admin can write settings, operator and cleaner cannot', () => {
  const adminModules = resolveModulesForRole(ROLE_ADMIN);
  const operatorModules = resolveModulesForRole(ROLE_OPERATOR);
  const cleanerModules = resolveModulesForRole(ROLE_CLEANER);

  assert.equal(
    evaluatePermission({
      role: ROLE_ADMIN,
      modules: adminModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    true
  );
  assert.equal(
    evaluatePermission({
      role: ROLE_OPERATOR,
      modules: operatorModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    false
  );
  assert.equal(
    evaluatePermission({
      role: ROLE_CLEANER,
      modules: cleanerModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_WRITE
    }).allowed,
    false
  );
});

test('disabled items are excluded from payment-summary editable fields', async () => {
  const items = CABIN_ITEMS.map((item) =>
    item.ruleKey === 'laundry' ? { ...item, enabled: false } : item
  );
  await updatePricingPolicyItems({ propertyKind: 'cabin', items });

  const summary = await calculateCleaningPaymentSummary({
    date: '2026-08-01',
    propertyKind: 'cabin'
  });

  assert.equal(summary.editableInputFields.length, 4);
  assert.ok(!summary.editableInputFields.some((f) => f.inputKey === 'laundryCount'));
});

test('updated amounts flow into payment-summary line items', async () => {
  const items = CABIN_ITEMS.map((item) =>
    item.ruleKey === 'transport' ? { ...item, amountEUR: 12 } : item
  );
  await updatePricingPolicyItems({ propertyKind: 'cabin', items });

  const CleaningDaySheet = require('../models/CleaningDaySheet');
  const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
  const sofiaStart = normalizeDateToSofiaDayStart('2026-08-03');
  await CleaningDaySheet.findOneAndUpdate(
    { date: sofiaStart, propertyKind: 'cabin' },
    { $set: { inputs: { transport: true } } },
    { upsert: true, new: true }
  );

  const withLineItem = await calculateCleaningPaymentSummary({
    date: '2026-08-03',
    propertyKind: 'cabin'
  });
  const transportLine = withLineItem.lineItems.find((li) => li.ruleKey === 'transport');
  assert.ok(transportLine);
  assert.equal(transportLine.amountEUR, 12);
});
