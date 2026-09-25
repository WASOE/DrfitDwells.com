'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPaymentTermDefinition,
  buildCancellationPolicyDefinition,
  buildRatePlanDefinitions,
  classify,
  executeActivation
} = require('./winterVillageCommercialActivation.cjs');
const {
  validateAndNormalizePaymentTermTemplate
} = require('../services/paymentTermService');
const {
  validateAndNormalizeCancellationPolicy
} = require('../services/cancellationPolicyService');
const { validateAndNormalizeRatePlan } = require('../services/ratePlanService');
const {
  normalizedName,
  inventoryMappingIsUsable
} = require('../services/winterVillageInventoryResolver');

function findRows(rows) {
  return {
    lean: async () => rows
  };
}

function modelFor(rows) {
  return {
    find: () => findRows(rows)
  };
}

function inventory() {
  return {
    'a-frame': { entityType: 'cabinType', entityId: 'af-type', document: { isActive: true }, resources: [{ _id: 'af-1' }] },
    'lux-cabin': { entityType: 'cabin', entityId: 'lux-id', document: { isActive: true }, resources: [{ _id: 'lux-id' }] },
    'stone-house': { entityType: 'cabin', entityId: 'stone-id', document: { isActive: true }, resources: [{ _id: 'stone-id' }] }
  };
}

test('activation definitions validate against all current schemas', () => {
  assert.equal(validateAndNormalizePaymentTermTemplate(buildPaymentTermDefinition()).ok, true);
  assert.equal(validateAndNormalizeCancellationPolicy(buildCancellationPolicyDefinition()).ok, true);
  for (const definition of buildRatePlanDefinitions()) {
    const result = validateAndNormalizeRatePlan(definition);
    assert.equal(result.ok, true, `${definition.code}: ${result.errors?.join('; ')}`);
  }
});

test('inventory mapping uses stable business identity without requiring live slugs', () => {
  assert.equal(normalizedName('Lux-Cabin'), 'lux cabin');
  assert.equal(normalizedName('Stone_House'), 'stone house');
  assert.equal(inventoryMappingIsUsable(inventory()['lux-cabin']), true);
  assert.equal(inventoryMappingIsUsable(inventory()['stone-house']), true);
  assert.equal(inventoryMappingIsUsable({ entityType: 'cabin', resources: [] }), false);
});

test('dry-run proposes missing records and performs zero writes', async () => {
  let writes = 0;
  const result = await executeActivation({
    dryRun: true,
    deps: {
      loadInventory: async () => inventory(),
      models: {
        RatePlan: modelFor([]),
        PaymentTermTemplate: modelFor([]),
        CancellationPolicy: modelFor([])
      },
      create: async () => {
        writes += 1;
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.writes, 0);
  assert.equal(writes, 0);
  assert.equal(result.actions.filter((row) => row.action === 'CREATE').length, 7);
});

test('exact matching records are skipped and immutable mismatches stop', () => {
  const payment = buildPaymentTermDefinition();
  assert.equal(classify({ ...payment, status: 'active', _id: 'p1' }, payment, validateAndNormalizePaymentTermTemplate).action, 'ALREADY MATCHES');
  assert.equal(
    classify(
      { ...payment, status: 'active', legs: [{ ...payment.legs[0], amountValue: 3000 }, payment.legs[1]] },
      payment,
      validateAndNormalizePaymentTermTemplate
    ).action,
    'MISMATCH / STOP'
  );
});
