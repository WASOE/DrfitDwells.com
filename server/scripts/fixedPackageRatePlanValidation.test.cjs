'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RatePlan = require('../models/RatePlan');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const CancellationPolicy = require('../models/CancellationPolicy');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const {
  createRatePlanDraft,
  activateRatePlan
} = require('../services/ratePlanManagementService');
const { validateAndNormalizeRatePlan } = require('../services/ratePlanService');
const {
  buildPaymentTermDefinition,
  buildCancellationPolicyDefinition,
  buildRatePlanDefinitions
} = require('./winterVillageCommercialActivation.cjs');

let mongoServer;

async function seedDependencies() {
  await PaymentTermTemplate.create({
    ...buildPaymentTermDefinition(),
    status: 'active',
    createdBy: 'test',
    updatedBy: 'test'
  });
  await CancellationPolicy.create({
    ...buildCancellationPolicyDefinition(),
    createdBy: 'test',
    updatedBy: 'test'
  });
  await Cabin.create({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    description: 'Lux Cabin test fixture',
    capacity: 4,
    pricePerNight: 150,
    minNights: 1,
    imageUrl: 'https://example.com/lux.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: 'Stone House',
    slug: 'stone-house',
    description: 'Stone House test fixture',
    capacity: 6,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: 'https://example.com/stone.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await CabinType.create({
    name: 'A-Frame',
    slug: 'a-frame',
    description: 'A-Frame test fixture',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/a-frame.jpg',
    location: 'Bulgaria',
    isActive: true
  });
}

function parentChild() {
  return buildRatePlanDefinitions().find((row) => row.code === 'parent-child-2026-12');
}

function christmas() {
  return buildRatePlanDefinitions().find((row) => row.code === 'christmas-2026');
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { autoIndex: true });
});

test.after(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    RatePlan.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    CancellationPolicy.deleteMany({}),
    PaymentTermTemplate.deleteMany({})
  ]);
  await seedDependencies();
});

test('production-shaped fixed packages use package dates without seasonal windows', () => {
  for (const definition of [parentChild(), christmas()]) {
    const result = validateAndNormalizeRatePlan(definition);
    assert.equal(result.ok, true, `${definition.code}: ${result.errors?.join('; ')}`);
    assert.equal(result.value.type, 'fixed_package');
    assert.equal(result.value.arrivalWindowStart, null);
    assert.equal(result.value.arrivalWindowEnd, null);
    assert.ok(result.value.packageArrivalDate);
    assert.ok(result.value.packageDepartureDate);
  }
});

test('fixed-package date and inventory invariants remain enforced', () => {
  const definition = parentChild();
  for (const invalid of [
    { packageArrivalDate: null },
    { packageDepartureDate: null },
    { packageArrivalDate: '2026-12-13' },
    { inventoryMode: 'shared' }
  ]) {
    const result = validateAndNormalizeRatePlan({ ...definition, ...invalid });
    assert.equal(result.ok, false);
  }
});

test('seasonal stays still require arrival windows', () => {
  const definition = buildRatePlanDefinitions()[0];
  const result = validateAndNormalizeRatePlan({
    ...definition,
    arrivalWindowStart: null,
    arrivalWindowEnd: null
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('seasonal_stay requires arrivalWindowStart and arrivalWindowEnd'));
});

test('fixed package completes draft, fingerprint, and activation lifecycle', async () => {
  const definition = parentChild();
  const draft = await createRatePlanDraft(definition, { operatorId: 'ops-test' });
  assert.equal(draft.type, 'fixed_package');
  assert.equal(draft.status, 'draft');

  const persistedDraft = await RatePlan.findById(draft.id).lean();
  const normalizedExpected = validateAndNormalizeRatePlan(definition);
  const normalizedPersisted = validateAndNormalizeRatePlan(persistedDraft);
  assert.equal(normalizedExpected.ok, true);
  assert.equal(normalizedPersisted.ok, true);
  assert.deepEqual(
    { ...normalizedPersisted.value, status: undefined },
    { ...normalizedExpected.value, status: undefined }
  );

  const active = await activateRatePlan(draft.id, { operatorId: 'ops-test' });
  assert.equal(active.status, 'active');
  assert.equal(active.type, 'fixed_package');
  assert.equal(active.packageArrivalDate, '2026-12-11');
  assert.equal(active.packageDepartureDate, '2026-12-13');
  assert.equal(active.inventoryMode, 'exclusive');
});
