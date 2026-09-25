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

function queryFor(value) {
  return {
    session: () => queryFor(value),
    lean: async () => value
  };
}

function mutableModels(rows) {
  const state = [...rows];
  return {
    state,
    RatePlan: {
      find: () => queryFor(state),
      findOne: ({ code, version }) =>
        queryFor(state.find((row) => row.code === code && row.version === version) || null),
      findById: (id) => queryFor(state.find((row) => String(row._id) === String(id)) || null)
    },
    PaymentTermTemplate: modelFor([{ ...buildPaymentTermDefinition(), status: 'active', _id: 'payment-1' }]),
    CancellationPolicy: modelFor([buildCancellationPolicyDefinition()])
  };
}

function matchingPrerequisiteRows() {
  const definitions = buildRatePlanDefinitions();
  return [
    { ...definitions[0], status: 'active', _id: 'seasonal-1' }
  ];
}

function inventory() {
  return {
    'a-frame': { entityType: 'cabinType', entityId: 'af-type', document: { isActive: true }, resources: [{ _id: 'af-1' }] },
    'lux-cabin': { entityType: 'cabin', entityId: 'lux-id', document: { isActive: true }, resources: [{ _id: 'lux-id' }] },
    'stone-house': { entityType: 'cabin', entityId: 'stone-id', document: { isActive: true }, resources: [{ _id: 'stone-id' }] }
  };
}

test('activation definitions validate against all current schemas', () => {
  assert.equal(buildPaymentTermDefinition().internalName, '40% now / 60% 30 days before arrival');
  assert.equal(validateAndNormalizePaymentTermTemplate(buildPaymentTermDefinition()).ok, true);
  assert.equal(validateAndNormalizeCancellationPolicy(buildCancellationPolicyDefinition()).ok, true);
  for (const definition of buildRatePlanDefinitions()) {
    const result = validateAndNormalizeRatePlan(definition);
    assert.equal(result.ok, true, `${definition.code}: ${result.errors?.join('; ')}`);
  }
  const seasonal = buildRatePlanDefinitions().find((definition) => definition.code === 'winter-cabin-stay-2026-27');
  assert.equal(seasonal.bookingWindowStart, null);
  assert.deepEqual(
    seasonal.accommodations.find((row) => row.accommodationKey === 'stone-house'),
    {
      accommodationKey: 'stone-house',
      entityType: 'cabin',
      pricingMethod: 'nightly_base_plus_extra_guest',
      nightlyPerUnitAmount: 90,
      includedGuests: 3,
      additionalGuestNightlyAmount: 30
    }
  );
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
  const models = mutableModels(matchingPrerequisiteRows());
  const result = await executeActivation({
    dryRun: true,
    deps: {
      transactionSupported: false,
      loadInventory: async () => inventory(),
      models,
      create: async () => {
        writes += 1;
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'standalone_resumable');
  assert.equal(result.dryRun, true);
  assert.equal(result.writes, 0);
  assert.equal(writes, 0);
  assert.equal(result.actions.filter((row) => row.action === 'CREATE').length, 4);
});

test('dry-run reports transaction mode without writing', async () => {
  const result = await executeActivation({
    dryRun: true,
    deps: {
      transactionSupported: true,
      loadInventory: async () => inventory(),
      models: mutableModels(matchingPrerequisiteRows())
    }
  });
  assert.equal(result.mode, 'transaction');
  assert.equal(result.writes, 0);
});

test('preflight failure happens before any standalone write', async () => {
  let createCalls = 0;
  const models = mutableModels(matchingPrerequisiteRows());
  const result = await executeActivation({
    dryRun: false,
    operatorId: 'ops@example.com',
    deps: {
      transactionSupported: false,
      loadInventory: async () => ({ ...inventory(), 'stone-house': { entityType: 'cabin', resources: [] } }),
      models,
      management: {
        createRatePlanDraft: async () => {
          createCalls += 1;
        }
      }
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.writes, 0);
  assert.equal(createCalls, 0);
});

test('standalone activation creates fixed plans sequentially and resumes after interruption', async () => {
  const models = mutableModels(matchingPrerequisiteRows());
  let createCount = 0;
  let interruptAfterFirst = true;
  const management = {
    createRatePlanDraft: async (input) => {
      const row = { ...input, _id: `${input.code}-id`, status: 'draft' };
      models.state.push(row);
      createCount += 1;
      return row;
    },
    activateRatePlan: async (id) => {
      const row = models.state.find((candidate) => String(candidate._id) === String(id));
      row.status = 'active';
      return row;
    }
  };
  process.env.WINTER_VILLAGE_ACTIVATION_CONFIRM = 'ACTIVATE_WINTER_VILLAGE_COMMERCIAL_V1';
  const interrupted = await executeActivation({
    dryRun: false,
    operatorId: 'ops@example.com',
    deps: {
      transactionSupported: false,
      loadInventory: async () => inventory(),
      models,
      management: {
        ...management,
        activateRatePlan: async (...args) => {
          const active = await management.activateRatePlan(...args);
          if (interruptAfterFirst && createCount === 1) {
            interruptAfterFirst = false;
            throw new Error('simulated interruption');
          }
          return active;
        }
      }
    }
  });
  assert.equal(interrupted.mode, 'standalone_resumable');
  assert.equal(interrupted.ok, false);
  assert.deepEqual(interrupted.written, ['parent-child-2026-12@v1']);
  assert.equal(interrupted.failed, 'parent-child-2027-01@v1');
  assert.equal(models.state.find((row) => row.code === 'parent-child-2026-12').status, 'active');

  const resumed = await executeActivation({
    dryRun: false,
    operatorId: 'ops@example.com',
    deps: {
      transactionSupported: false,
      loadInventory: async () => inventory(),
      models,
      management
    }
  });
  delete process.env.WINTER_VILLAGE_ACTIVATION_CONFIRM;
  assert.equal(resumed.ok, true);
  assert.deepEqual(resumed.written, [
    'parent-child-2027-01@v1',
    'parent-child-2027-02@v1',
    'christmas-2026@v1'
  ]);
  assert.equal(models.state.filter((row) => row.type === 'fixed_package').length, 4);
});

test('an immutable fixed-package mismatch stops before any write', async () => {
  const definitions = buildRatePlanDefinitions();
  const models = mutableModels([
    ...matchingPrerequisiteRows(),
    {
      ...definitions[1],
      status: 'active',
      _id: 'mismatch-id',
      accommodations: definitions[1].accommodations.map((row, index) =>
        index === 0 ? { ...row, fixedPerUnitAmount: row.fixedPerUnitAmount + 1 } : row
      )
    }
  ]);
  let writes = 0;
  const result = await executeActivation({
    dryRun: false,
    operatorId: 'ops@example.com',
    deps: {
      transactionSupported: false,
      loadInventory: async () => inventory(),
      models,
      management: {
        createRatePlanDraft: async () => {
          writes += 1;
        }
      }
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.writes, 0);
  assert.equal(writes, 0);
  assert.ok(result.errors.some((error) => error.includes('immutable content mismatch')));
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
