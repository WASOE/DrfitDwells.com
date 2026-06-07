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
  updatePricingPolicyAmounts,
  validateAmounts
} = require('../services/ops/cleaning/cleaningPricingPolicyAdminService');
const { calculateCleaningPaymentSummary } = require('../services/ops/cleaning/cleaningPricingService');

let mongoServer;

const VALID_AMOUNTS = {
  transport: 8,
  aframe_small: 10,
  aframe_full: 20,
  lux_cabin: 25,
  house_full: 25,
  deep_cleaning: 150,
  laundry: 2
};

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

test('GET pricing-policy returns cabin and valley with default catalog when no active policy', async () => {
  const data = await getPricingPolicySettings();

  assert.equal(data.currency, 'EUR');
  assert.equal(data.cabin.mode, 'legacy');
  assert.equal(data.cabin.needsActivation, true);
  assert.equal(data.valley.mode, 'legacy');
  assert.equal(data.valley.needsActivation, true);
  assert.equal(data.cabin.rules.length, 7);
  assert.equal(data.valley.rules.length, 7);
  assert.ok(data.cabin.rules.some((r) => r.ruleKey === 'transport' && r.amountEUR === 8));
  assert.ok(
    data.cabin.rules.some((r) => r.ruleKey === 'laundry' && r.valueType === 'unit' && r.unitAmountEUR === 2)
  );
});

test('PUT creates active policy if missing', async () => {
  const data = await updatePricingPolicyAmounts({
    propertyKind: 'cabin',
    amounts: VALID_AMOUNTS
  });

  assert.equal(data.cabin.mode, 'policy');
  assert.equal(data.cabin.needsActivation, false);
  assert.ok(data.cabin.policyId);
  assert.equal(data.cabin.isActive, true);

  const stored = await CleaningPricingPolicy.findById(data.cabin.policyId).lean();
  assert.ok(stored);
  assert.equal(stored.currency, 'EUR');
  assert.equal(stored.rules.length, 7);
});

test('PUT updates existing active policy amounts', async () => {
  await updatePricingPolicyAmounts({ propertyKind: 'cabin', amounts: VALID_AMOUNTS });

  const data = await updatePricingPolicyAmounts({
    propertyKind: 'cabin',
    amounts: { ...VALID_AMOUNTS, transport: 9, laundry: 3 }
  });

  const transport = data.cabin.rules.find((r) => r.ruleKey === 'transport');
  const laundry = data.cabin.rules.find((r) => r.ruleKey === 'laundry');
  assert.equal(transport.amountEUR, 9);
  assert.equal(laundry.unitAmountEUR, 3);

  const count = await CleaningPricingPolicy.countDocuments({ propertyKind: 'cabin', isActive: true });
  assert.equal(count, 1);
});

test('PUT rejects unknown rule key', () => {
  assert.throws(
    () =>
      validateAmounts({
        ...VALID_AMOUNTS,
        mystery_rule: 5
      }),
    /Unknown rule key: mystery_rule/
  );
});

test('PUT rejects negative amount', () => {
  assert.throws(
    () =>
      validateAmounts({
        ...VALID_AMOUNTS,
        transport: -1
      }),
    /Invalid amount for transport/
  );
});

test('PUT rejects missing required keys', () => {
  const partial = { ...VALID_AMOUNTS };
  delete partial.laundry;
  assert.throws(() => validateAmounts(partial), /Missing required rule key: laundry/);
});

test('PUT enforces EUR currency on stored policy', async () => {
  const data = await updatePricingPolicyAmounts({
    propertyKind: 'valley',
    amounts: VALID_AMOUNTS
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
  assert.equal(
    evaluatePermission({
      role: ROLE_OPERATOR,
      modules: operatorModules,
      action: ACTIONS.OPS_CLEANING_SETTINGS_READ
    }).allowed,
    true
  );
});

test('updated amounts flow into payment-summary line items', async () => {
  await updatePricingPolicyAmounts({
    propertyKind: 'cabin',
    amounts: { ...VALID_AMOUNTS, transport: 12 }
  });

  const summary = await calculateCleaningPaymentSummary({
    date: '2026-08-01',
    propertyKind: 'cabin'
  });

  assert.equal(summary.editableInputFields.length, 7);
  const transportField = summary.editableInputFields.find((f) => f.inputKey === 'transport');
  assert.equal(transportField.amountEUR, 12);
  assert.equal(summary.pricingVersion, '2026-06-default');

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
