/**
 * RP1 — RatePlan management service tests (MongoMemoryServer).
 * No production data, network, Stripe, or production env vars.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const RatePlan = require('../models/RatePlan');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const CancellationPolicy = require('../models/CancellationPolicy');
const mgmt = require('../services/ratePlanManagementService');
const {
  RatePlanManagementError,
  MANAGEMENT_ERROR_CODES,
  OPERATIONAL_WARNING_CODES,
  ACTIVATION_LOCK_ID,
  ACTIVATION_LOCK_COLLECTION_NAME,
  inclusiveDateWindowsOverlap,
  acquireSeasonalActivationLock,
  releaseSeasonalActivationLock,
  listRatePlans,
  createRatePlanDraft,
  updateRatePlanDraft,
  cloneRatePlanAsNextDraftVersion,
  activateRatePlan,
  retireRatePlan
} = mgmt;

let mongoServer;
let seq = 0;

function activationLockCollection() {
  return mongoose.connection.collection(ACTIVATION_LOCK_COLLECTION_NAME);
}

function lockDeps(extra = {}) {
  return { activationLockCollection: activationLockCollection(), ...extra };
}

function op(name = 'ops-tester') {
  return name;
}

function baseSeasonal(overrides = {}) {
  seq += 1;
  return {
    code: overrides.code || `winter-2026-${seq}`,
    internalName: overrides.internalName || `Winter 2026 ${seq}`,
    version: overrides.version != null ? overrides.version : 1,
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: overrides.arrivalWindowStart || '2026-12-01',
    arrivalWindowEnd: overrides.arrivalWindowEnd || '2026-12-31',
    minNights: overrides.minNights != null ? overrides.minNights : 2,
    inventoryMode: overrides.inventoryMode || 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: overrides.inclusions || ['Firewood'],
    accommodations: overrides.accommodations || [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 180
      }
    ],
    ...overrides
  };
}

async function seedPolicy() {
  await CancellationPolicy.create({
    code: 'normal-stay-standard',
    internalName: 'Normal stay standard',
    version: 1,
    status: 'active',
    policyType: 'normal_stay',
    correctionWindowHours: 48,
    correctionWindowMinDaysBeforeArrival: 7,
    refundTiers: [{ minDaysBeforeArrival: 0, maxDaysBeforeArrival: null, refundPercent: 0 }],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0
  });
}

async function seedInventory() {
  await Cabin.create({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    description: 'Lux',
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
    description: 'Stone',
    capacity: 6,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: 'https://example.com/stone.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: 'Inactive Cabin',
    slug: 'inactive-cabin',
    description: 'Inactive',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/x.jpg',
    location: 'Bulgaria',
    isActive: false
  });
  await CabinType.create({
    name: 'A-Frame Type',
    slug: 'a-frame',
    description: 'A-Frame',
    capacity: 2,
    pricePerNight: 120,
    minNights: 1,
    imageUrl: 'https://example.com/af.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  // Same slug different entity type — architecture treats cabin vs cabinType as separate
  await Cabin.create({
    name: 'A-Frame Cabin Listing',
    slug: 'a-frame',
    description: 'Single a-frame cabin slug twin',
    capacity: 2,
    pricePerNight: 110,
    minNights: 1,
    imageUrl: 'https://example.com/afc.jpg',
    location: 'Bulgaria',
    isActive: true
  });
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { autoIndex: true });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  seq = 0;
  await Promise.all([
    RatePlan.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    CancellationPolicy.deleteMany({}),
    activationLockCollection().deleteMany({})
  ]);
  await seedPolicy();
  await seedInventory();
});

describe('RP1 RatePlan management service', () => {
  it('1. creates a valid seasonal draft', async () => {
    const plan = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    assert.equal(plan.status, 'draft');
    assert.equal(plan.type, 'seasonal_stay');
    assert.equal(plan.createdBy, 'ops-tester');
    assert.equal(plan.updatedBy, 'ops-tester');
    assert.equal(plan.accommodations[0].nightlyPerUnitAmount, 180);
    assert.equal(plan.arrivalWindowStart, '2026-12-01');
  });

  it('2. creation always forces draft status', async () => {
    const plan = await createRatePlanDraft(
      { ...baseSeasonal(), status: 'active' },
      { operatorId: op() }
    );
    assert.equal(plan.status, 'draft');
    assert.equal(plan.activatedAt, null);
  });

  it('3. rejects client lifecycle/audit injection', async () => {
    const plan = await createRatePlanDraft(
      {
        ...baseSeasonal(),
        createdBy: 'attacker',
        updatedBy: 'attacker',
        activatedBy: 'attacker',
        activatedAt: new Date('2020-01-01'),
        retiredBy: 'attacker',
        retiredAt: new Date('2020-01-01')
      },
      { operatorId: op('real-ops') }
    );
    assert.equal(plan.createdBy, 'real-ops');
    assert.equal(plan.updatedBy, 'real-ops');
    assert.equal(plan.activatedBy, null);
    assert.equal(plan.activatedAt, null);
    assert.equal(plan.retiredBy, null);
    assert.equal(plan.retiredAt, null);
  });

  it('4. validates Cabin slug and entity type', async () => {
    const plan = await createRatePlanDraft(
      baseSeasonal({
        accommodations: [
          {
            accommodationKey: 'stone-house',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 200
          }
        ]
      }),
      { operatorId: op() }
    );
    assert.equal(plan.accommodations[0].accommodationKey, 'stone-house');
    assert.equal(plan.accommodations[0].entityType, 'cabin');
  });

  it('5. validates CabinType slug and entity type', async () => {
    const plan = await createRatePlanDraft(
      baseSeasonal({
        accommodations: [
          {
            accommodationKey: 'a-frame',
            entityType: 'cabinType',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 130
          }
        ]
      }),
      { operatorId: op() }
    );
    assert.equal(plan.accommodations[0].entityType, 'cabinType');
  });

  it('6. rejects missing or inactive accommodation', async () => {
    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            accommodations: [
              {
                accommodationKey: 'missing-slug',
                entityType: 'cabin',
                pricingMethod: 'nightly_per_unit',
                nightlyPerUnitAmount: 100
              }
            ]
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND
    );

    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            accommodations: [
              {
                accommodationKey: 'inactive-cabin',
                entityType: 'cabin',
                pricingMethod: 'nightly_per_unit',
                nightlyPerUnitAmount: 100
              }
            ]
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.ACCOMMODATION_INACTIVE
    );
  });

  it('7. rejects duplicate accommodation rows', async () => {
    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            accommodations: [
              {
                accommodationKey: 'lux-cabin',
                entityType: 'cabin',
                pricingMethod: 'nightly_per_unit',
                nightlyPerUnitAmount: 100
              },
              {
                accommodationKey: 'lux-cabin',
                entityType: 'cabin',
                pricingMethod: 'nightly_per_unit',
                nightlyPerUnitAmount: 110
              }
            ]
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.VALIDATION_FAILED
    );
  });

  it('8. validates cancellation policy code/version', async () => {
    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            cancellationPolicyCode: 'does-not-exist',
            cancellationPolicyVersion: 1
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.CANCELLATION_POLICY_NOT_FOUND
    );
  });

  it('9. rejects invalid date window', async () => {
    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            arrivalWindowStart: '2026-12-31',
            arrivalWindowEnd: '2026-12-01'
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.VALIDATION_FAILED
    );
  });

  it('10. rejects invalid minNights', async () => {
    await assert.rejects(
      () => createRatePlanDraft(baseSeasonal({ minNights: 0 }), { operatorId: op() }),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.VALIDATION_FAILED
    );
  });

  it('11. rejects invalid money and more than two decimals', async () => {
    await assert.rejects(
      () =>
        createRatePlanDraft(
          baseSeasonal({
            accommodations: [
              {
                accommodationKey: 'lux-cabin',
                entityType: 'cabin',
                pricingMethod: 'nightly_per_unit',
                nightlyPerUnitAmount: 180.123
              }
            ]
          }),
          { operatorId: op() }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.VALIDATION_FAILED
    );
  });

  it('12. updates draft with expected revision', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    const updated = await updateRatePlanDraft(
      created.id,
      { internalName: 'Renamed Winter', nightlyHint: undefined, minNights: 3 },
      { operatorId: op('editor'), expectedRevision: created.revision }
    );
    assert.equal(updated.internalName, 'Renamed Winter');
    assert.equal(updated.minNights, 3);
    assert.equal(updated.updatedBy, 'editor');
    assert.ok(updated.revision > created.revision);
  });

  it('13. rejects stale revision', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    await assert.rejects(
      () =>
        updateRatePlanDraft(
          created.id,
          { internalName: 'stale' },
          { operatorId: op(), expectedRevision: created.revision + 5 }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.STALE_REVISION
    );
  });

  it('14. rejects active edit', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    await activateRatePlan(created.id, { operatorId: op() });
    await assert.rejects(
      () =>
        updateRatePlanDraft(
          created.id,
          { minNights: 5 },
          { operatorId: op(), expectedRevision: 1 }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.IMMUTABLE_PLAN
    );
  });

  it('15. rejects retired edit', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    await activateRatePlan(created.id, { operatorId: op() });
    await retireRatePlan(created.id, { operatorId: op() });
    await assert.rejects(
      () =>
        updateRatePlanDraft(
          created.id,
          { minNights: 5 },
          { operatorId: op(), expectedRevision: 2 }
        ),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.IMMUTABLE_PLAN
    );
  });

  it('16-18. clone creates next version, does not mutate source, clears lifecycle', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'clone-me' }), {
      operatorId: op('creator')
    });
    const active = await activateRatePlan(created.id, { operatorId: op('activator') });
    assert.equal(active.status, 'active');
    assert.ok(active.activatedAt);
    assert.equal(active.activatedBy, 'activator');

    const cloned = await cloneRatePlanAsNextDraftVersion(created.id, {
      operatorId: op('cloner')
    });
    assert.equal(cloned.code, 'clone-me');
    assert.equal(cloned.version, 2);
    assert.equal(cloned.status, 'draft');
    assert.equal(cloned.activatedAt, null);
    assert.equal(cloned.activatedBy, null);
    assert.equal(cloned.retiredAt, null);
    assert.equal(cloned.retiredBy, null);
    assert.equal(cloned.createdBy, 'cloner');

    const source = await RatePlan.findById(created.id).lean();
    assert.equal(source.status, 'active');
    assert.equal(source.version, 1);
    assert.equal(source.activatedBy, 'activator');
  });

  it('19. duplicate-version race returns typed conflict', async () => {
    await createRatePlanDraft(baseSeasonal({ code: 'race-code', version: 1 }), {
      operatorId: op()
    });
    await assert.rejects(
      () =>
        createRatePlanDraft(baseSeasonal({ code: 'race-code', version: 1 }), {
          operatorId: op()
        }),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.DUPLICATE_VERSION
    );
  });

  it('20. activates valid draft', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    const active = await activateRatePlan(created.id, {
      operatorId: op('act'),
      expectedRevision: created.revision
    });
    assert.equal(active.status, 'active');
    assert.equal(active.activatedBy, 'act');
    assert.ok(active.activatedAt);
  });

  it('21. rejects direct active creation (status ignored → draft only path)', async () => {
    const plan = await createRatePlanDraft(
      { ...baseSeasonal(), status: 'retired' },
      { operatorId: op() }
    );
    assert.equal(plan.status, 'draft');
  });

  it('22. rejects activation with same accommodation and overlapping dates', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'season-a',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-20'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });

    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'season-b',
        arrivalWindowStart: '2026-12-10',
        arrivalWindowEnd: '2026-12-31'
      }),
      { operatorId: op() }
    );
    await assert.rejects(
      () => activateRatePlan(b.id, { operatorId: op() }),
      (err) =>
        err instanceof RatePlanManagementError &&
        err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP &&
        Array.isArray(err.details.conflicts) &&
        err.details.conflicts[0].code === 'season-a'
    );
  });

  it('23. detects overlap when either window contains the other', async () => {
    assert.equal(
      inclusiveDateWindowsOverlap('2026-12-01', '2026-12-31', '2026-12-10', '2026-12-15'),
      true
    );
    const outer = await createRatePlanDraft(
      baseSeasonal({
        code: 'outer',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-31'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(outer.id, { operatorId: op() });
    const inner = await createRatePlanDraft(
      baseSeasonal({
        code: 'inner',
        arrivalWindowStart: '2026-12-10',
        arrivalWindowEnd: '2026-12-15'
      }),
      { operatorId: op() }
    );
    await assert.rejects(
      () => activateRatePlan(inner.id, { operatorId: op() }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP
    );
  });

  it('24. detects overlap on shared boundary night', async () => {
    assert.equal(
      inclusiveDateWindowsOverlap('2026-12-01', '2026-12-10', '2026-12-10', '2026-12-20'),
      true
    );
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'bound-a',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-10'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'bound-b',
        arrivalWindowStart: '2026-12-10',
        arrivalWindowEnd: '2026-12-20'
      }),
      { operatorId: op() }
    );
    await assert.rejects(
      () => activateRatePlan(b.id, { operatorId: op() }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP
    );
  });

  it('25. allows adjacent non-overlapping seasons', async () => {
    assert.equal(
      inclusiveDateWindowsOverlap('2026-12-01', '2026-12-10', '2026-12-11', '2026-12-20'),
      false
    );
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'adj-a',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-10'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'adj-b',
        arrivalWindowStart: '2026-12-11',
        arrivalWindowEnd: '2026-12-20'
      }),
      { operatorId: op() }
    );
    const active = await activateRatePlan(b.id, { operatorId: op() });
    assert.equal(active.status, 'active');
  });

  it('26. allows same dates for different accommodations', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'lux-win',
        accommodations: [
          {
            accommodationKey: 'lux-cabin',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 180
          }
        ]
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'stone-win',
        accommodations: [
          {
            accommodationKey: 'stone-house',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 220
          }
        ]
      }),
      { operatorId: op() }
    );
    const active = await activateRatePlan(b.id, { operatorId: op() });
    assert.equal(active.status, 'active');
  });

  it('27. allows same slug when entity type differs (cabin vs cabinType are separate)', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'af-type',
        accommodations: [
          {
            accommodationKey: 'a-frame',
            entityType: 'cabinType',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 130
          }
        ]
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'af-cabin',
        accommodations: [
          {
            accommodationKey: 'a-frame',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 140
          }
        ]
      }),
      { operatorId: op() }
    );
    const active = await activateRatePlan(b.id, { operatorId: op() });
    assert.equal(active.status, 'active');
  });

  it('28. detects conflict when one row of a multi-accommodation plan overlaps', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'single-lux',
        accommodations: [
          {
            accommodationKey: 'lux-cabin',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 180
          }
        ]
      }),
      { operatorId: op() }
    );
    await activateRatePlan(a.id, { operatorId: op() });

    const multi = await createRatePlanDraft(
      baseSeasonal({
        code: 'multi-row',
        accommodations: [
          {
            accommodationKey: 'stone-house',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 200
          },
          {
            accommodationKey: 'lux-cabin',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 190
          }
        ]
      }),
      { operatorId: op() }
    );
    await assert.rejects(
      () => activateRatePlan(multi.id, { operatorId: op() }),
      (err) =>
        err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP &&
        err.details.conflicts.some((c) => c.accommodationKey === 'lux-cabin')
    );
  });

  it('29. ignores retired and draft plans during active-conflict check', async () => {
    const retiredDraft = await createRatePlanDraft(
      baseSeasonal({
        code: 'old-season',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-31'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(retiredDraft.id, { operatorId: op() });
    await retireRatePlan(retiredDraft.id, { operatorId: op() });

    const danglingDraft = await createRatePlanDraft(
      baseSeasonal({
        code: 'draft-overlap',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-31'
      }),
      { operatorId: op() }
    );
    assert.equal(danglingDraft.status, 'draft');

    const fresh = await createRatePlanDraft(
      baseSeasonal({
        code: 'fresh-season',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-31'
      }),
      { operatorId: op() }
    );
    const active = await activateRatePlan(fresh.id, { operatorId: op() });
    assert.equal(active.status, 'active');
  });

  it('30. retires active plan', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    await activateRatePlan(created.id, { operatorId: op() });
    const retired = await retireRatePlan(created.id, { operatorId: op('retirer') });
    assert.equal(retired.status, 'retired');
    assert.equal(retired.retiredBy, 'retirer');
    assert.ok(retired.retiredAt);
  });

  it('31. rejects retirement of draft or retired plan', async () => {
    const draft = await createRatePlanDraft(baseSeasonal(), { operatorId: op() });
    await assert.rejects(
      () => retireRatePlan(draft.id, { operatorId: op() }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION
    );

    await activateRatePlan(draft.id, { operatorId: op() });
    await retireRatePlan(draft.id, { operatorId: op() });
    await assert.rejects(
      () => retireRatePlan(draft.id, { operatorId: op() }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION
    );
  });

  it('32. audit identities and timestamps recorded correctly', async () => {
    const created = await createRatePlanDraft(baseSeasonal(), { operatorId: op('c1') });
    assert.equal(created.createdBy, 'c1');
    assert.equal(created.updatedBy, 'c1');
    const updated = await updateRatePlanDraft(
      created.id,
      { internalName: 'Audit Name' },
      { operatorId: op('u1'), expectedRevision: created.revision }
    );
    assert.equal(updated.updatedBy, 'u1');
    const active = await activateRatePlan(created.id, { operatorId: op('a1') });
    assert.equal(active.activatedBy, 'a1');
    assert.ok(active.activatedAt);
    const retired = await retireRatePlan(created.id, { operatorId: op('r1') });
    assert.equal(retired.retiredBy, 'r1');
    assert.ok(retired.retiredAt);
  });

  it('33. existing documents without new audit fields remain readable', async () => {
    await RatePlan.collection.insertOne({
      code: 'legacy-plan',
      internalName: 'Legacy',
      version: 1,
      status: 'draft',
      type: 'seasonal_stay',
      currency: 'EUR',
      arrivalWindowStart: new Date(Date.UTC(2027, 0, 1)),
      arrivalWindowEnd: new Date(Date.UTC(2027, 0, 31)),
      minNights: 2,
      inventoryMode: 'shared',
      requiresFullPayment: true,
      cancellationPolicyCode: 'normal-stay-standard',
      cancellationPolicyVersion: 1,
      inclusions: [],
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 100,
          includedGuests: null,
          additionalGuestNightlyAmount: null,
          fixedPerUnitAmount: null,
          adultPackageAmount: null,
          childPackageAmount: null,
          infantPackageAmount: null
        }
      ]
    });
    const listed = await listRatePlans({ code: 'legacy-plan' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].createdBy, null);
    assert.equal(listed[0].activatedBy, null);
    assert.equal(listed[0].status, 'draft');
  });

  it('34. no hard-delete export', () => {
    assert.equal(typeof mgmt.deleteRatePlan, 'undefined');
    assert.equal(typeof mgmt.hardDeleteRatePlan, 'undefined');
    assert.equal(typeof mgmt.removeRatePlan, 'undefined');
    const exported = Object.keys(mgmt);
    assert.ok(!exported.some((k) => /delete|remove|destroy/i.test(k)));
  });

  it('35. no unrestricted $set in management service source', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../services/ratePlanManagementService.js'),
      'utf8'
    );
    assert.equal(/\.$set\b/.test(src) || /\$set\s*:/.test(src), false);
    assert.equal(/findByIdAndUpdate|updateOne|updateMany|findOneAndUpdate/.test(src), false);
  });

  it('rejects seasonal exclusive inventoryMode', async () => {
    await assert.rejects(
      () => createRatePlanDraft(baseSeasonal({ inventoryMode: 'exclusive' }), { operatorId: op() }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.VALIDATION_FAILED
    );
  });

  it('rejects empty operator identity', async () => {
    await assert.rejects(
      () => createRatePlanDraft(baseSeasonal(), { operatorId: '   ' }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.INVALID_OPERATOR
    );
  });

  it('rejects code/version identity mutation on draft patch', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'keep-code' }), {
      operatorId: op()
    });
    await assert.rejects(
      () =>
        updateRatePlanDraft(
          created.id,
          { code: 'other-code' },
          { operatorId: op(), expectedRevision: created.revision }
        ),
      (err) => err.code === MANAGEMENT_ERROR_CODES.IDENTITY_IMMUTABLE
    );
  });

  it('listRatePlans returns created drafts', async () => {
    await createRatePlanDraft(baseSeasonal({ code: 'list-a' }), { operatorId: op() });
    await createRatePlanDraft(baseSeasonal({ code: 'list-b' }), { operatorId: op() });
    const all = await listRatePlans();
    assert.ok(all.length >= 2);
    const drafts = await listRatePlans({ status: 'draft' });
    assert.ok(drafts.every((p) => p.status === 'draft'));
  });

  // --- RP1 Correction 1: seasonal activation lock ---

  it('C1-1..3 concurrent overlapping activations: one active; loser BUSY or OVERLAP', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-ov-a',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-15'
      }),
      { operatorId: op() }
    );
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-ov-b',
        arrivalWindowStart: '2026-12-10',
        arrivalWindowEnd: '2026-12-25'
      }),
      { operatorId: op() }
    );

    const results = await Promise.allSettled([
      activateRatePlan(a.id, { operatorId: op('a') }, lockDeps()),
      activateRatePlan(b.id, { operatorId: op('b') }, lockDeps())
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(
      [MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY, MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP].includes(
        rejected[0].reason.code
      )
    );

    const actives = await RatePlan.find({ status: 'active' }).lean();
    assert.equal(actives.length, 1);

    // If loser got BUSY, retry after lock release must see SEASONAL_OVERLAP
    if (rejected[0].reason.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY) {
      const loserId = fulfilled[0].value.code === 'c1-ov-a' ? b.id : a.id;
      await assert.rejects(
        () => activateRatePlan(loserId, { operatorId: op('retry') }, lockDeps()),
        (err) => err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP
      );
    }

    const locks = await activationLockCollection().find({}).toArray();
    assert.equal(locks.length, 0);
  });

  it('C1-4..5 concurrent non-overlapping activations serialize; retry succeeds', async () => {
    const a = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-adj-a',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-10'
      }),
      { operatorId: op() }
    );
    const b = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-adj-b',
        arrivalWindowStart: '2026-12-11',
        arrivalWindowEnd: '2026-12-20'
      }),
      { operatorId: op() }
    );

    const firstWave = await Promise.allSettled([
      activateRatePlan(a.id, { operatorId: op('a') }, lockDeps()),
      activateRatePlan(b.id, { operatorId: op('b') }, lockDeps())
    ]);

    const ok = firstWave.filter((r) => r.status === 'fulfilled');
    const busy = firstWave.filter(
      (r) =>
        r.status === 'rejected' && r.reason.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY
    );
    assert.ok(ok.length >= 1);
    assert.equal(ok.length + busy.length + firstWave.filter((r) => r.status === 'rejected' && r.reason.code !== MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY).length, 2);

    // Retry any BUSY loser — non-conflicting plan must activate
    for (let i = 0; i < firstWave.length; i++) {
      if (
        firstWave[i].status === 'rejected' &&
        firstWave[i].reason.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY
      ) {
        const id = i === 0 ? a.id : b.id;
        const retried = await activateRatePlan(id, { operatorId: op('retry') }, lockDeps());
        assert.equal(retried.status, 'active');
      }
    }

    const actives = await RatePlan.find({ status: 'active', code: { $in: ['c1-adj-a', 'c1-adj-b'] } }).lean();
    assert.equal(actives.length, 2);
    assert.equal(await activationLockCollection().countDocuments({}), 0);
  });

  it('C1-6 conflict validation runs after lock acquisition', async () => {
    const events = [];
    const real = activationLockCollection();
    const trackingCol = {
      insertOne: async (doc) => {
        events.push('lock_acquired');
        return real.insertOne(doc);
      },
      deleteOne: async (filter) => {
        events.push('lock_released');
        return real.deleteOne(filter);
      }
    };

    const existing = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-conf-exist',
        arrivalWindowStart: '2026-12-01',
        arrivalWindowEnd: '2026-12-20'
      }),
      { operatorId: op() }
    );
    await activateRatePlan(existing.id, { operatorId: op() }, { activationLockCollection: trackingCol });
    events.length = 0;

    const candidate = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-conf-new',
        arrivalWindowStart: '2026-12-05',
        arrivalWindowEnd: '2026-12-25'
      }),
      { operatorId: op() }
    );

    const OrigFind = RatePlan.find.bind(RatePlan);
    RatePlan.find = function trackedFind(...args) {
      if (events.includes('lock_acquired') && !events.includes('lock_released')) {
        events.push('conflict_query_under_lock');
      }
      return OrigFind(...args);
    };

    try {
      await assert.rejects(
        () =>
          activateRatePlan(candidate.id, { operatorId: op() }, {
            activationLockCollection: trackingCol
          }),
        (err) => err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP
      );
    } finally {
      RatePlan.find = OrigFind;
    }

    assert.ok(events.indexOf('lock_acquired') < events.indexOf('conflict_query_under_lock'));
    assert.ok(events.includes('lock_released'));
  });

  it('C1-7 dependency validation runs after lock acquisition', async () => {
    const events = [];
    const real = activationLockCollection();
    const trackingCol = {
      insertOne: async (doc) => {
        events.push('lock_acquired');
        return real.insertOne(doc);
      },
      deleteOne: async (filter) => {
        events.push('lock_released');
        return real.deleteOne(filter);
      }
    };

    const created = await createRatePlanDraft(baseSeasonal({ code: 'c1-dep' }), {
      operatorId: op()
    });
    await Cabin.deleteMany({ slug: 'lux-cabin' });

    const OrigFindOne = Cabin.findOne.bind(Cabin);
    Cabin.findOne = function trackedCabinFindOne(...args) {
      if (events.includes('lock_acquired') && !events.includes('lock_released')) {
        events.push('dep_check_under_lock');
      }
      return OrigFindOne(...args);
    };

    try {
      await assert.rejects(
        () =>
          activateRatePlan(created.id, { operatorId: op() }, {
            activationLockCollection: trackingCol
          }),
        (err) => err.code === MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND
      );
    } finally {
      Cabin.findOne = OrigFindOne;
    }

    assert.ok(events.indexOf('lock_acquired') < events.indexOf('dep_check_under_lock'));
    assert.ok(events.includes('lock_released'));
    assert.equal(await activationLockCollection().countDocuments({}), 0);
  });

  it('C1-8 save failure releases the owned lock', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c1-save-fail' }), {
      operatorId: op()
    });

    const FakeRatePlan = {
      db: RatePlan.db,
      findById: async (id) => {
        const doc = await RatePlan.findById(id);
        if (!doc) return null;
        doc.save = async () => {
          throw new Error('forced-save-failure');
        };
        return doc;
      },
      find: (...args) => RatePlan.find(...args)
    };

    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, {
          ...lockDeps(),
          RatePlan: FakeRatePlan
        }),
      (err) => err && err.message === 'forced-save-failure'
    );

    assert.equal(await activationLockCollection().countDocuments({}), 0);
    const still = await RatePlan.findById(created.id).lean();
    assert.equal(still.status, 'draft');
  });

  it('C1-9 validation failure releases the owned lock', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c1-val-fail' }), {
      operatorId: op()
    });
    await Cabin.deleteMany({ slug: 'lux-cabin' });

    await assert.rejects(
      () => activateRatePlan(created.id, { operatorId: op() }, lockDeps()),
      (err) => err.code === MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND
    );
    assert.equal(await activationLockCollection().countDocuments({}), 0);
    const still = await RatePlan.findById(created.id).lean();
    assert.equal(still.status, 'draft');
  });

  it('C1-10..11 cannot release another owner lock; forged token rejected', async () => {
    const tokenA = await acquireSeasonalActivationLock(lockDeps());
    await assert.rejects(
      () => releaseSeasonalActivationLock('forged-token-not-owner', lockDeps()),
      (err) => err.code === MANAGEMENT_ERROR_CODES.LOCK_RELEASE_DENIED
    );
    const stillHeld = await activationLockCollection().findOne({ _id: ACTIVATION_LOCK_ID });
    assert.ok(stillHeld);
    assert.equal(stillHeld.ownerToken, tokenA);

    await releaseSeasonalActivationLock(tokenA, lockDeps());
    assert.equal(await activationLockCollection().countDocuments({}), 0);
  });

  it('C1-12..13 orphan lock blocks future activation; no stale stealing', async () => {
    await activationLockCollection().insertOne({
      _id: ACTIVATION_LOCK_ID,
      ownerToken: 'orphan-owner-token',
      acquiredAt: new Date('2020-01-01T00:00:00.000Z')
    });

    const created = await createRatePlanDraft(baseSeasonal({ code: 'c1-orphan' }), {
      operatorId: op()
    });

    await assert.rejects(
      () => activateRatePlan(created.id, { operatorId: op() }, lockDeps()),
      (err) => err.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY
    );

    const still = await RatePlan.findById(created.id).lean();
    assert.equal(still.status, 'draft');
    const lock = await activationLockCollection().findOne({ _id: ACTIVATION_LOCK_ID });
    assert.equal(lock.ownerToken, 'orphan-owner-token');
  });

  it('C1-14 lock acquisition failure causes no RatePlan mutation', async () => {
    await activationLockCollection().insertOne({
      _id: ACTIVATION_LOCK_ID,
      ownerToken: 'blocker',
      acquiredAt: new Date()
    });
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c1-no-mut' }), {
      operatorId: op()
    });
    const before = await RatePlan.findById(created.id).lean();

    await assert.rejects(
      () => activateRatePlan(created.id, { operatorId: op() }, lockDeps()),
      (err) => err.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY
    );

    const after = await RatePlan.findById(created.id).lean();
    assert.equal(after.status, before.status);
    assert.equal(String(after.updatedAt), String(before.updatedAt));
    assert.equal(after.__v, before.__v);
    assert.equal(after.activatedAt, null);
  });

  it('C1-15 multi-accommodation activation remains protected under lock', async () => {
    const existing = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-multi-exist',
        accommodations: [
          {
            accommodationKey: 'lux-cabin',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 100
          }
        ]
      }),
      { operatorId: op() }
    );
    await activateRatePlan(existing.id, { operatorId: op() }, lockDeps());

    const multi = await createRatePlanDraft(
      baseSeasonal({
        code: 'c1-multi-new',
        accommodations: [
          {
            accommodationKey: 'stone-house',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 150
          },
          {
            accommodationKey: 'lux-cabin',
            entityType: 'cabin',
            pricingMethod: 'nightly_per_unit',
            nightlyPerUnitAmount: 110
          }
        ]
      }),
      { operatorId: op() }
    );

    await assert.rejects(
      () => activateRatePlan(multi.id, { operatorId: op() }, lockDeps()),
      (err) =>
        err.code === MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP &&
        err.details.conflicts.some((c) => c.accommodationKey === 'lux-cabin')
    );
    assert.equal(await activationLockCollection().countDocuments({}), 0);
  });

  it('C1-17 concurrent clone and stale-revision protections remain green', async () => {
    const src = await createRatePlanDraft(baseSeasonal({ code: 'c1-clone-race' }), {
      operatorId: op()
    });
    await activateRatePlan(src.id, { operatorId: op() }, lockDeps());

    const cloneResults = await Promise.allSettled([
      cloneRatePlanAsNextDraftVersion(src.id, { operatorId: op('c1') }),
      cloneRatePlanAsNextDraftVersion(src.id, { operatorId: op('c2') })
    ]);
    const cloneOk = cloneResults.filter((r) => r.status === 'fulfilled');
    const cloneDup = cloneResults.filter(
      (r) => r.status === 'rejected' && r.reason.code === MANAGEMENT_ERROR_CODES.DUPLICATE_VERSION
    );
    assert.equal(cloneOk.length, 1);
    assert.equal(cloneDup.length, 1);

    const draft = await createRatePlanDraft(baseSeasonal({ code: 'c1-stale' }), {
      operatorId: op()
    });
    await assert.rejects(
      () =>
        updateRatePlanDraft(
          draft.id,
          { internalName: 'stale' },
          { operatorId: op(), expectedRevision: draft.revision + 9 }
        ),
      (err) => err.code === MANAGEMENT_ERROR_CODES.STALE_REVISION
    );
  });

  // --- RP1 Correction 2: unambiguous post-commit activation result ---

  function assertNoOwnerTokenLeak(value) {
    const text = JSON.stringify(value);
    assert.equal(/"ownerToken"\s*:/.test(text), false);
    // 64-char hex tokens must not appear in API surfaces
    assert.equal(/\b[a-f0-9]{64}\b/.test(text), false);
  }

  it('C2-1 save succeeds, release throws: successful committed result', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-rel-throw' }), {
      operatorId: op()
    });
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async () => {
        throw new Error('simulated-release-throw-RAW-SECRET');
      },
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op('act') }, {
      activationLockCollection: col
    });
    assert.equal(result.status, 'active');
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, false);
    assert.ok(
      result.operationalWarnings.some(
        (w) => w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED
      )
    );
    assert.equal(String(result).includes('simulated-release-throw'), false);
    assertNoOwnerTokenLeak(result);
    const persisted = await RatePlan.findById(created.id).lean();
    assert.equal(persisted.status, 'active');
  });

  it('C2-2 save succeeds, release deletedCount 0: successful committed result', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-rel-zero' }), {
      operatorId: op()
    });
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async () => ({ acknowledged: true, deletedCount: 0 }),
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: col
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, false);
    assert.ok(
      result.operationalWarnings.some(
        (w) => w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED
      )
    );
    assertNoOwnerTokenLeak(result);
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'active');
  });

  it('C2-3 release throws but lock absent on verification: lockReleased true', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-rel-absent' }), {
      operatorId: op()
    });
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async (filter) => {
        await real.deleteOne(filter);
        throw new Error('delete-succeeded-then-threw');
      },
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: col
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, true);
    assert.deepEqual(result.operationalWarnings, []);
    assert.equal(await activationLockCollection().countDocuments({}), 0);
  });

  it('C2-4 release failure with lock remaining: safe warning, no raw message', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-rel-remain' }), {
      operatorId: op()
    });
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async () => {
        throw new Error('MongoNetworkError raw stack TOKEN');
      },
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: col
    });
    assert.equal(result.lockReleased, false);
    const blob = JSON.stringify(result);
    assert.equal(blob.includes('MongoNetworkError'), false);
    assert.equal(blob.includes('raw stack'), false);
    assert.ok(result.operationalWarnings.every((w) => w.code === 'ACTIVATION_LOCK_RELEASE_FAILED'));
  });

  it('C2-5 activation never reported successful when plan remains draft', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-no-commit' }), {
      operatorId: op()
    });
    const FakeRatePlan = {
      db: RatePlan.db,
      findById: async (id) => {
        const doc = await RatePlan.findById(id);
        if (!doc) return null;
        doc.save = async function saveNoPersist() {
          return this;
        };
        return doc;
      },
      find: (...args) => RatePlan.find(...args)
    };
    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, {
          ...lockDeps(),
          RatePlan: FakeRatePlan
        }),
      (err) => {
        assert.notEqual(err.activationCommitted, true);
        assert.equal((err.details && err.details.activationCommitted) || false, false);
        return err.code === MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION;
      }
    );
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'draft');
  });

  it('C2-6 unacknowledged insert with proven ownership continues safely', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-unack-own' }), {
      operatorId: op()
    });
    const col = {
      insertOne: async (doc) => {
        await real.insertOne(doc);
        return { acknowledged: false, insertedId: doc._id };
      },
      deleteOne: (f) => real.deleteOne(f),
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: col
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.status, 'active');
    assert.equal(result.lockReleased, true);
  });

  it('C2-7 unacknowledged insert without ownership fails closed', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-unack-none' }), {
      operatorId: op()
    });
    const col = {
      insertOne: async () => ({ acknowledged: false }),
      deleteOne: async () => ({ deletedCount: 0 }),
      findOne: async () => null
    };
    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, { activationLockCollection: col }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.ACTIVATION_LOCK_UNCERTAIN
    );
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'draft');
  });

  it('C2-8 insert throws after writing own lock: ownership verification handles it', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-write-throw' }), {
      operatorId: op()
    });
    const col = {
      insertOne: async (doc) => {
        await real.insertOne(doc);
        throw new Error('write-then-throw');
      },
      deleteOne: (f) => real.deleteOne(f),
      findOne: (q) => real.findOne(q)
    };
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: col
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.status, 'active');
  });

  it('C2-9 insert throws with another owner: ACTIVATION_BUSY', async () => {
    await activationLockCollection().insertOne({
      _id: ACTIVATION_LOCK_ID,
      ownerToken: 'other-owner',
      acquiredAt: new Date()
    });
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-other-owner' }), {
      operatorId: op()
    });
    const real = activationLockCollection();
    const col = {
      insertOne: async () => {
        const err = new Error('E11000 duplicate');
        err.code = 11000;
        throw err;
      },
      deleteOne: (f) => real.deleteOne(f),
      findOne: (q) => real.findOne(q)
    };
    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, { activationLockCollection: col }),
      (err) => err.code === MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY
    );
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'draft');
  });

  it('C2-10 validation failure plus release failure preserves validation error', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-val-rel' }), {
      operatorId: op()
    });
    await Cabin.deleteMany({ slug: 'lux-cabin' });
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async () => {
        throw new Error('release-raw-should-not-surface');
      },
      findOne: (q) => real.findOne(q)
    };
    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, { activationLockCollection: col }),
      (err) => {
        assert.equal(err.code, MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND);
        assert.equal(err.details.lockCleanupRequired, true);
        assert.ok(
          err.details.operationalWarnings.some(
            (w) => w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED
          )
        );
        assert.equal(String(err.message).includes('release-raw'), false);
        assertNoOwnerTokenLeak(err);
        return true;
      }
    );
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'draft');
  });

  it('C2-11 save failure plus release failure preserves save error', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-save-rel' }), {
      operatorId: op()
    });
    const FakeRatePlan = {
      db: RatePlan.db,
      findById: async (id) => {
        const doc = await RatePlan.findById(id);
        if (!doc) return null;
        doc.save = async () => {
          throw new Error('forced-save-failure');
        };
        return doc;
      },
      find: (...args) => RatePlan.find(...args)
    };
    const col = {
      insertOne: (doc) => real.insertOne(doc),
      deleteOne: async () => {
        throw new Error('release-should-not-replace-save');
      },
      findOne: (q) => real.findOne(q)
    };
    await assert.rejects(
      () =>
        activateRatePlan(created.id, { operatorId: op() }, {
          activationLockCollection: col,
          RatePlan: FakeRatePlan
        }),
      (err) => {
        assert.equal(err.message, 'forced-save-failure');
        assert.equal(err.details.lockCleanupRequired, true);
        assert.equal(String(err.message).includes('release-should-not'), false);
        return true;
      }
    );
    assert.equal((await RatePlan.findById(created.id).lean()).status, 'draft');
  });

  it('C2-12 owner token absent from every return/error', async () => {
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c2-no-token' }), {
      operatorId: op()
    });
    const ok = await activateRatePlan(created.id, { operatorId: op() }, lockDeps());
    assertNoOwnerTokenLeak(ok);
    assert.equal(ok.activationCommitted, true);
    assert.equal(ok.lockReleased, true);
  });

  it('C2-13 overlap concurrency remains safe for at least 50 iterations', async () => {
    for (let i = 0; i < 50; i++) {
      await RatePlan.deleteMany({});
      await activationLockCollection().deleteMany({});

      const a = await createRatePlanDraft(
        baseSeasonal({
          code: `c2-ov-a-${i}`,
          arrivalWindowStart: '2026-12-01',
          arrivalWindowEnd: '2026-12-15'
        }),
        { operatorId: op() }
      );
      const b = await createRatePlanDraft(
        baseSeasonal({
          code: `c2-ov-b-${i}`,
          arrivalWindowStart: '2026-12-10',
          arrivalWindowEnd: '2026-12-25'
        }),
        { operatorId: op() }
      );
      const results = await Promise.allSettled([
        activateRatePlan(a.id, { operatorId: op('a') }, lockDeps()),
        activateRatePlan(b.id, { operatorId: op('b') }, lockDeps())
      ]);
      const actives = await RatePlan.find({ status: 'active' }).lean();
      assert.equal(actives.length, 1);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = results.find((r) => r.status === 'rejected');
      assert.ok(rejected);
      assert.ok(
        [MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY, MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP].includes(
          rejected.reason.code
        )
      );
      const win = results.find((r) => r.status === 'fulfilled').value;
      assert.equal(win.activationCommitted, true);
      assertNoOwnerTokenLeak(win);
    }
  });

  // --- RP1 Correction 3: foreign-owner release verification ---

  it('C3-1 failed delete then no lock document → lockReleased true', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c3-absent' }), {
      operatorId: op()
    });
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: {
        insertOne: (doc) => real.insertOne(doc),
        deleteOne: async (filter) => {
          await real.deleteOne(filter);
          return { deletedCount: 0 };
        },
        findOne: (q) => real.findOne(q)
      }
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, true);
    assert.deepEqual(result.operationalWarnings, []);
  });

  it('C3-2 failed delete then own lock remains → lockReleased false + warning', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c3-own' }), {
      operatorId: op()
    });
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: {
        insertOne: (doc) => real.insertOne(doc),
        deleteOne: async () => ({ deletedCount: 0 }),
        findOne: (q) => real.findOne(q)
      }
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, false);
    assert.ok(
      result.operationalWarnings.some(
        (w) => w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED
      )
    );
    const lock = await real.findOne({ _id: ACTIVATION_LOCK_ID });
    assert.ok(lock);
    assertNoOwnerTokenLeak(result);
  });

  it('C3-3..8 failed delete / release throw then foreign lock: success, lockReleased true, no warning, foreign untouched, no tokens', async () => {
    const real = activationLockCollection();
    const FOREIGN = 'foreign-owner-token-value-never-expose';

    async function runCase(mode) {
      await RatePlan.deleteMany({});
      await real.deleteMany({});
      const created = await createRatePlanDraft(
        baseSeasonal({ code: mode === 'throw' ? 'c3-foreign-throw' : 'c3-foreign-zero' }),
        { operatorId: op() }
      );
      let ourToken = null;
      const result = await activateRatePlan(created.id, { operatorId: op('act') }, {
        activationLockCollection: {
          insertOne: async (doc) => {
            ourToken = doc.ownerToken;
            return real.insertOne(doc);
          },
          deleteOne: async () => {
            // Simulate owned delete missing while a foreign holder is observed on verify.
            if (mode === 'throw') throw new Error('release-throw-RAW');
            return { deletedCount: 0 };
          },
          findOne: async () => ({
            _id: ACTIVATION_LOCK_ID,
            ownerToken: FOREIGN,
            acquiredAt: new Date()
          })
        }
      });

      assert.equal(result.activationCommitted, true);
      assert.equal(result.status, 'active');
      assert.equal(result.lockReleased, true);
      assert.deepEqual(result.operationalWarnings, []);
      assertNoOwnerTokenLeak(result);
      const blob = JSON.stringify(result);
      assert.equal(blob.includes(FOREIGN), false);
      assert.equal(blob.includes(ourToken), false);
      assert.equal(blob.includes('release-throw-RAW'), false);

      // Real DB still holds our lock (stub did not delete); foreign was only on verify path.
      // Re-check with a case that plants foreign in real collection:
      return { ourToken, result };
    }

    await runCase('zero');
    await runCase('throw');

    // Explicit: foreign lock in real collection remains untouched by owned deleteOne filter
    await RatePlan.deleteMany({});
    await real.deleteMany({});
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c3-foreign-real' }), {
      operatorId: op()
    });
    let ourToken = null;
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: {
        insertOne: async (doc) => {
          ourToken = doc.ownerToken;
          await real.insertOne(doc);
          // Replace with foreign owner before release (simulates ownership change).
          await real.deleteOne({ _id: ACTIVATION_LOCK_ID });
          await real.insertOne({
            _id: ACTIVATION_LOCK_ID,
            ownerToken: FOREIGN,
            acquiredAt: new Date()
          });
          return { acknowledged: true, insertedId: doc._id };
        },
        deleteOne: (f) => real.deleteOne(f),
        findOne: (q) => real.findOne(q)
      }
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, true);
    assert.deepEqual(result.operationalWarnings, []);
    const remaining = await real.findOne({ _id: ACTIVATION_LOCK_ID });
    assert.ok(remaining);
    assert.equal(remaining.ownerToken, FOREIGN);
    assert.notEqual(remaining.ownerToken, ourToken);
    assertNoOwnerTokenLeak(result);
    assert.equal(JSON.stringify(result).includes(FOREIGN), false);
    assert.equal(JSON.stringify(result).includes(ourToken), false);
  });

  it('C3-9 verification failure remains fail-closed', async () => {
    const real = activationLockCollection();
    const created = await createRatePlanDraft(baseSeasonal({ code: 'c3-verify-fail' }), {
      operatorId: op()
    });
    const result = await activateRatePlan(created.id, { operatorId: op() }, {
      activationLockCollection: {
        insertOne: (doc) => real.insertOne(doc),
        deleteOne: async () => ({ deletedCount: 0 }),
        findOne: async () => {
          throw new Error('findOne-RAW-should-not-surface');
        }
      }
    });
    assert.equal(result.activationCommitted, true);
    assert.equal(result.lockReleased, false);
    assert.ok(
      result.operationalWarnings.some(
        (w) => w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED
      )
    );
    assert.equal(JSON.stringify(result).includes('findOne-RAW'), false);
    assertNoOwnerTokenLeak(result);
  });

  it('C3-11 overlap concurrency remains safe for 50 iterations', async () => {
    for (let i = 0; i < 50; i++) {
      await RatePlan.deleteMany({});
      await activationLockCollection().deleteMany({});
      const a = await createRatePlanDraft(
        baseSeasonal({
          code: `c3-ov-a-${i}`,
          arrivalWindowStart: '2026-12-01',
          arrivalWindowEnd: '2026-12-15'
        }),
        { operatorId: op() }
      );
      const b = await createRatePlanDraft(
        baseSeasonal({
          code: `c3-ov-b-${i}`,
          arrivalWindowStart: '2026-12-10',
          arrivalWindowEnd: '2026-12-25'
        }),
        { operatorId: op() }
      );
      const results = await Promise.allSettled([
        activateRatePlan(a.id, { operatorId: op('a') }, lockDeps()),
        activateRatePlan(b.id, { operatorId: op('b') }, lockDeps())
      ]);
      assert.equal(await RatePlan.countDocuments({ status: 'active' }), 1);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const win = results.find((r) => r.status === 'fulfilled').value;
      assert.equal(win.activationCommitted, true);
      assert.equal(win.lockReleased, true);
    }
  });
});
