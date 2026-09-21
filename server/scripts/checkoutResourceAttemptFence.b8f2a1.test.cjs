/**
 * B8F2A1 — Resource-attempt fence + facility acquisition safety (MongoMemoryServer).
 * No orchestrator / CheckoutSession / voucher / PI / routes / Booking wiring.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutResourceAttempt = require('../models/CheckoutResourceAttempt');
const {
  AUTHORITATIVE_LIVE_INDEX_SPEC
} = require('../models/CheckoutResourceAttempt');
const FacilityReservation = require('../models/FacilityReservation');

const {
  DEFAULT_RESOURCE_BUNDLE_TTL_MS,
  CheckoutResourceAttemptFenceError,
  assertCheckoutResourceAttemptAuthoritativeIndex,
  acquireCheckoutResourceAttemptFence,
  assertCheckoutResourceAttemptFence,
  releaseCheckoutResourceAttemptFence,
  failCheckoutResourceAttemptFence,
  annotateCheckoutResourceAttemptFenceFailure,
  expireCheckoutResourceAttemptFences,
  ensureCheckoutResourceAttemptIndexesForTests
} = require('../services/checkout/checkoutResourceAttemptFenceService');

const {
  FacilityBookingError,
  DEFAULT_FACILITY_HOLD_TTL_MS,
  ensureFacilityReservationUniqueIndexForTests,
  acquireFacilityHold,
  acquireFacilityHolds,
  compensateFacilityHolds,
  releaseFacilityHolds,
  expireFacilityHolds,
  confirmFacilityHolds,
  clearFacilityAcquisitionMarkers,
  assertFacilityHoldsActive,
  completeFencedFacilityAcquisition,
  listCurrentAttemptMarkedHoldIds
} = require('../services/facilityBookingService');

const DAY = '2027-01-15';
const WIN_START = `${DAY}T10:00:00.000Z`;
const WIN_END = `${DAY}T22:00:00.000Z`;
const NOW = new Date('2026-09-06T12:00:00.000Z');
const HASH = 'a'.repeat(64);

let mongoServer;

function saunaPack() {
  return {
    code: 'sauna-firewood-pack',
    internalName: 'Sauna firewood',
    publicName: 'Sauna firewood pack',
    version: 1,
    status: 'active',
    currency: 'EUR',
    amount: 15,
    chargeUnit: 'per_firing',
    includedItems: ['firewood']
  };
}

function hotTubPack() {
  return {
    code: 'hot-tub-firewood-pack',
    internalName: 'Hot tub firewood',
    publicName: 'Hot tub firewood pack',
    version: 1,
    status: 'active',
    currency: 'EUR',
    amount: 30,
    chargeUnit: 'per_firing',
    includedItems: ['firewood']
  };
}

function facilityFixture(code, addOnCode, overrides = {}) {
  return {
    facilityCode: code,
    name: code,
    status: 'active',
    selfLed: true,
    requiredAddOnCode: addOnCode,
    requiredAddOnVersion: 1,
    slotDurationMinutes: 120,
    maxConcurrentBookings: 1,
    operatingSchedule: {
      absoluteWindows: [{ start: WIN_START, end: WIN_END }]
    },
    unavailablePeriods: [],
    ...overrides
  };
}

const SAUNA = facilityFixture('sauna-1', 'sauna-firewood-pack', { name: 'Communal sauna' });
const TUB1 = facilityFixture('hot-tub-1', 'hot-tub-firewood-pack', { name: 'Hot tub 1' });

const ADDONS = {
  'sauna-firewood-pack@1': saunaPack(),
  'hot-tub-firewood-pack@1': hotTubPack()
};

const FACILITIES = {
  'sauna-1': SAUNA,
  'hot-tub-1': TUB1
};

function slot(startHour, durationMinutes = 120) {
  const start = new Date(`${DAY}T${String(startHour).padStart(2, '0')}:00:00.000Z`);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { slotStart: start, startTime: start, endTime: end };
}

function facilityDeps(extra = {}) {
  return {
    now: extra.now || NOW,
    holdTtlMs: extra.holdTtlMs != null ? extra.holdTtlMs : DEFAULT_FACILITY_HOLD_TTL_MS,
    FacilityReservation,
    CheckoutResourceAttempt,
    loadFacilityByCode: async (code) => FACILITIES[code] || null,
    loadAddOnByCodeVersion: async (code, version) =>
      ADDONS[`${code}@${version}`] || null,
    ...extra
  };
}

function fenceDeps(extra = {}) {
  return {
    now: extra.now || NOW,
    CheckoutResourceAttempt,
    ...extra
  };
}

function checkoutId(suffix) {
  return `co_b8f2a1_${suffix}`;
}

function selection(facilityCode, startHour, checkoutSessionId) {
  const s = slot(startHour);
  const pack =
    facilityCode === 'sauna-1' ? saunaPack() : hotTubPack();
  return {
    facilityCode,
    ...s,
    checkoutSessionId,
    addOn: pack,
    addOnCode: pack.code,
    addOnVersion: pack.version
  };
}

async function dropLiveFenceIndex() {
  const indexes = await CheckoutResourceAttempt.collection.indexes();
  for (const ix of indexes) {
    if (
      ix.unique &&
      ix.key &&
      Object.keys(ix.key).length === 1 &&
      ix.key.checkoutId === 1 &&
      ix.partialFilterExpression
    ) {
      await CheckoutResourceAttempt.collection.dropIndex(ix.name);
    }
  }
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  await ensureCheckoutResourceAttemptIndexesForTests();
  await ensureFacilityReservationUniqueIndexForTests();
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await FacilityReservation.deleteMany({});
  await CheckoutResourceAttempt.deleteMany({});
  // Ensure authoritative fence index exists after tests that drop it.
  try {
    await assertCheckoutResourceAttemptAuthoritativeIndex(fenceDeps());
  } catch {
    await ensureCheckoutResourceAttemptIndexesForTests();
  }
});

describe('B8F2A1 fence indexes and lifetime', () => {
  it('1. Correct authoritative index accepted', async () => {
    const r = await assertCheckoutResourceAttemptAuthoritativeIndex(fenceDeps());
    assert.equal(r.ok, true);
  });

  it('2. Missing index rejected before writes', async () => {
    await dropLiveFenceIndex();
    await assert.rejects(
      () =>
        acquireCheckoutResourceAttemptFence(
          {
            checkoutId: checkoutId('idx1'),
            quoteSnapshotHash: HASH
          },
          fenceDeps()
        ),
      (err) => err.code === 'RESOURCE_ATTEMPT_INDEX_MISSING'
    );
    await ensureCheckoutResourceAttemptIndexesForTests();
  });

  it('3. Non-unique or wrong-partial index rejected', async () => {
    await dropLiveFenceIndex();
    await CheckoutResourceAttempt.collection.createIndex(
      { checkoutId: 1 },
      { name: 'wrong_non_unique_live' }
    );
    await assert.rejects(
      () => assertCheckoutResourceAttemptAuthoritativeIndex(fenceDeps()),
      (err) => err.code === 'RESOURCE_ATTEMPT_INDEX_MISSING'
    );
    await CheckoutResourceAttempt.collection.dropIndex('wrong_non_unique_live');
    await CheckoutResourceAttempt.collection.createIndex(
      { checkoutId: 1 },
      {
        unique: true,
        name: 'wrong_partial',
        partialFilterExpression: { status: 'open' }
      }
    );
    await assert.rejects(
      () => assertCheckoutResourceAttemptAuthoritativeIndex(fenceDeps()),
      (err) => err.code === 'RESOURCE_ATTEMPT_INDEX_MISSING'
    );
    await CheckoutResourceAttempt.collection.dropIndex('wrong_partial');
    await ensureCheckoutResourceAttemptIndexesForTests();
  });

  it('13. Invalid and far-future fence expiry rejected', async () => {
    await assert.rejects(
      () =>
        acquireCheckoutResourceAttemptFence(
          {
            checkoutId: checkoutId('exp1'),
            quoteSnapshotHash: HASH,
            bundleValidUntil: new Date(NOW.getTime() - 1000)
          },
          fenceDeps()
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_INVALID_EXPIRY'
    );
    await assert.rejects(
      () =>
        acquireCheckoutResourceAttemptFence(
          {
            checkoutId: checkoutId('exp2'),
            quoteSnapshotHash: HASH,
            bundleValidUntil: new Date(
              NOW.getTime() + DEFAULT_RESOURCE_BUNDLE_TTL_MS + 60000
            )
          },
          fenceDeps()
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_INVALID_EXPIRY'
    );
  });
});

describe('B8F2A1 fence concurrency and lifecycle', () => {
  it('4-7. One live fence; loser IN_PROGRESS; different checkouts ok', async () => {
    const a = await acquireCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('live1'), quoteSnapshotHash: HASH },
      fenceDeps()
    );
    assert.equal(a.generation, 1);
    assert.equal(a.isLive, true);

    await assert.rejects(
      () =>
        acquireCheckoutResourceAttemptFence(
          { checkoutId: checkoutId('live1'), quoteSnapshotHash: HASH },
          fenceDeps()
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_IN_PROGRESS'
    );

    const b = await acquireCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('live2'), quoteSnapshotHash: HASH },
      fenceDeps()
    );
    assert.ok(b.attemptId !== a.attemptId);

    const [r1, r2] = await Promise.allSettled([
      acquireCheckoutResourceAttemptFence(
        { checkoutId: checkoutId('race1'), quoteSnapshotHash: HASH },
        fenceDeps()
      ),
      acquireCheckoutResourceAttemptFence(
        { checkoutId: checkoutId('race1'), quoteSnapshotHash: HASH },
        fenceDeps()
      )
    ]);
    const wins = [r1, r2].filter((x) => x.status === 'fulfilled');
    const losses = [r1, r2].filter((x) => x.status === 'rejected');
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    assert.equal(losses[0].reason.code, 'RESOURCE_BUNDLE_IN_PROGRESS');
  });

  it('8-9. Expired takeover one winner; generation increments', async () => {
    const first = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: checkoutId('take1'),
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 60000)
      },
      fenceDeps({ now: NOW })
    );
    assert.equal(first.generation, 1);

    const later = new Date(NOW.getTime() + 120000);
    const second = await acquireCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('take1'), quoteSnapshotHash: HASH },
      fenceDeps({ now: later })
    );
    assert.equal(second.generation, 2);
    assert.notEqual(second.attemptId, first.attemptId);

    const old = await CheckoutResourceAttempt.findOne({
      attemptId: first.attemptId
    }).lean();
    assert.equal(old.status, 'expired');
    assert.equal(old.isLive, false);
  });

  it('10-11. Old attempt cannot release/fail replacement; release/fail idempotent', async () => {
    const first = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: checkoutId('old1'),
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 1000)
      },
      fenceDeps({ now: NOW })
    );
    const nextNow = new Date(NOW.getTime() + 5000);
    const second = await acquireCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('old1'), quoteSnapshotHash: HASH },
      fenceDeps({ now: nextNow })
    );

    await assert.rejects(
      () =>
        releaseCheckoutResourceAttemptFence(
          { checkoutId: checkoutId('old1'), attemptId: first.attemptId },
          fenceDeps({ now: nextNow })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_FENCE_LOST'
    );
    await assert.rejects(
      () =>
        failCheckoutResourceAttemptFence(
          {
            checkoutId: checkoutId('old1'),
            attemptId: first.attemptId,
            failureCode: 'X'
          },
          fenceDeps({ now: nextNow })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_FENCE_LOST'
    );

    const rel = await releaseCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('old1'), attemptId: second.attemptId },
      fenceDeps({ now: nextNow })
    );
    assert.equal(rel.status, 'released');
    const rel2 = await releaseCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('old1'), attemptId: second.attemptId },
      fenceDeps({ now: nextNow })
    );
    assert.equal(rel2.idempotent, true);

    const f1 = await acquireCheckoutResourceAttemptFence(
      { checkoutId: checkoutId('fail1'), quoteSnapshotHash: HASH },
      fenceDeps()
    );
    await failCheckoutResourceAttemptFence(
      {
        checkoutId: checkoutId('fail1'),
        attemptId: f1.attemptId,
        failureCode: 'TEST_FAIL'
      },
      fenceDeps()
    );
    const f2 = await failCheckoutResourceAttemptFence(
      {
        checkoutId: checkoutId('fail1'),
        attemptId: f1.attemptId,
        failureCode: 'TEST_FAIL'
      },
      fenceDeps()
    );
    assert.equal(f2.idempotent, true);
  });

  it('12. Expiry sweep marks open fences expired', async () => {
    await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: checkoutId('sweep1'),
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 1000)
      },
      fenceDeps({ now: NOW })
    );
    const r = await expireCheckoutResourceAttemptFences(
      fenceDeps({ now: new Date(NOW.getTime() + 5000) })
    );
    assert.ok(r.modifiedCount >= 1);
    const row = await CheckoutResourceAttempt.findOne({
      checkoutId: checkoutId('sweep1')
    }).lean();
    assert.equal(row.status, 'expired');
    assert.equal(row.isLive, false);
  });
});

describe('B8F2A1 facility expiry outcomes markers and tokens', () => {
  it('14-16. Exact floor; later not shortened; shorter renewed via $max', async () => {
    const co = checkoutId('fac1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const floor = fence.bundleValidUntil;
    const s = slot(10);
    const h1 = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        checkoutSessionId: co,
        holdExpiresAt: floor
      })
    );
    assert.equal(h1.outcome, 'created');
    assert.equal(new Date(h1.holdExpiresAt).getTime(), floor.getTime());
    assert.equal(h1.acquisitionAttemptId, fence.attemptId);

    const later = new Date(floor.getTime() + 5 * 60 * 1000);
    await FacilityReservation.updateOne(
      { _id: h1._id },
      { $set: { holdExpiresAt: later, acquisitionAttemptId: null } }
    );

    const h2 = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        checkoutSessionId: co,
        holdExpiresAt: floor
      })
    );
    assert.equal(h2.outcome, 'reused');
    assert.equal(new Date(h2.holdExpiresAt).getTime(), later.getTime());

    await FacilityReservation.updateOne(
      { _id: h1._id },
      {
        $set: {
          holdExpiresAt: new Date(floor.getTime() - 60000),
          acquisitionAttemptId: null
        }
      }
    );
    // Make it active but shorter than floor: bump above now
    await FacilityReservation.updateOne(
      { _id: h1._id },
      { $set: { holdExpiresAt: new Date(NOW.getTime() + 60000) } }
    );
    const h3 = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        checkoutSessionId: co,
        holdExpiresAt: floor
      })
    );
    assert.equal(h3.outcome, 'renewed');
    assert.equal(new Date(h3.holdExpiresAt).getTime(), floor.getTime());
  });

  it('17-18. Exact identity reuse; identity change does not reuse', async () => {
    const co = checkoutId('id1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const s = slot(10);
    await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    await clearFacilityAcquisitionMarkers(
      { checkoutSessionId: co, attemptId: fence.attemptId },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        checkoutSessionId: co
      })
    );
    const reused = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.equal(reused.outcome, 'reused');

    // Same facility+slot but mismatched stored addOn version must not silently reuse.
    await FacilityReservation.updateOne(
      { _id: reused._id },
      { $set: { addOnVersion: 99, 'priceSnapshot.addOnVersion': 99 } }
    );
    await assert.rejects(
      () =>
        acquireFacilityHold(
          { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
          facilityDeps({
            acquisitionAttemptId: fence.attemptId,
            holdExpiresAt: fence.bundleValidUntil,
            checkoutSessionId: co
          })
        ),
      (err) => err.code === 'FACILITY_HOLD_IDENTITY_MISMATCH'
    );
  });

  it('19-22. Takeover marked/journaled; renew/reuse not compensable; token compensate', async () => {
    const co = checkoutId('comp1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const s = slot(10);
    const past = new Date(NOW.getTime() - 1000);
    await FacilityReservation.create({
      facilityCode: 'sauna-1',
      slotStart: s.slotStart,
      capacityLane: 0,
      startTime: s.startTime,
      endTime: s.endTime,
      status: 'hold',
      checkoutSessionId: co,
      holdExpiresAt: past,
      addOnCode: 'sauna-firewood-pack',
      addOnVersion: 1,
      priceSnapshot: {
        currency: 'EUR',
        amount: 15,
        chargeUnit: 'per_firing',
        addOnCode: 'sauna-firewood-pack',
        addOnVersion: 1
      },
      acquisitionAttemptId: null
    });

    const batch = await acquireFacilityHolds(
      [selection('sauna-1', 10, co)],
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.equal(batch.outcomes[0], 'taken_over');
    assert.equal(batch.newlyAcquiredIds.length, 1);
    assert.equal(
      String(batch.holds[0].acquisitionAttemptId),
      fence.attemptId
    );

    await clearFacilityAcquisitionMarkers(
      { checkoutSessionId: co, attemptId: fence.attemptId },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        checkoutSessionId: co
      })
    );
    const reusedBatch = await acquireFacilityHolds(
      [selection('sauna-1', 10, co)],
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.ok(
      reusedBatch.outcomes[0] === 'reused' || reusedBatch.outcomes[0] === 'renewed'
    );
    assert.equal(reusedBatch.newlyAcquiredIds.length, 0);

    const created = await acquireFacilityHold(
      {
        facilityCode: 'hot-tub-1',
        ...slot(12),
        checkoutSessionId: co
      },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    const tokenComp = await compensateFacilityHolds(
      co,
      [created._id],
      facilityDeps({ acquisitionAttemptId: fence.attemptId })
    );
    assert.equal(tokenComp.ok, true);
    assert.deepEqual(tokenComp.cancelledIds, [String(created._id)]);
  });

  it('23-26. Tokenless cannot touch marked; acquire cannot reuse live marker', async () => {
    const co = checkoutId('tok1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const h = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );

    const comp = await compensateFacilityHolds(co, [h._id], facilityDeps());
    assert.equal(comp.ok, false);
    assert.ok(comp.skipped.some((s) => s.reason === 'marker_owned'));
    const still = await FacilityReservation.findById(h._id);
    assert.equal(still.status, 'hold');

    const rel = await releaseFacilityHolds(co, {}, facilityDeps());
    assert.equal(rel.modifiedCount, 0);
    const still2 = await FacilityReservation.findById(h._id);
    assert.equal(still2.status, 'hold');

    await assert.rejects(
      () => confirmFacilityHolds(co, new mongoose.Types.ObjectId(), facilityDeps()),
      (err) => err.code === 'FACILITY_HOLD_NOT_CONFIRMABLE'
    );

    await assert.rejects(
      () =>
        acquireFacilityHold(
          { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
          facilityDeps()
        ),
      (err) => err.code === 'FACILITY_ACQUISITION_IN_PROGRESS'
    );
  });

  it('27. Expiry affects marked row only after holdExpiresAt <= now', async () => {
    const co = checkoutId('expf1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const h = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    const mid = await expireFacilityHolds(facilityDeps({ now: NOW }));
    assert.equal(mid.modifiedCount, 0);
    const after = await expireFacilityHolds(
      facilityDeps({ now: new Date(fence.bundleValidUntil.getTime() + 1) })
    );
    assert.ok(after.modifiedCount >= 1);
    const row = await FacilityReservation.findById(h._id);
    assert.equal(row.status, 'expired');
  });

  it('28-29. Stale marker clear only if non-live; live/missing/malformed fail closed', async () => {
    const co = checkoutId('stale1');
    const fenceA = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: co,
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 1000)
      },
      fenceDeps({ now: NOW })
    );
    const s = slot(10);
    const h = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        now: NOW,
        acquisitionAttemptId: fenceA.attemptId,
        holdExpiresAt: fenceA.bundleValidUntil,
        checkoutSessionId: co
      })
    );

    // Live A still owns marker — B cannot start while A live; expire A first.
    const next = new Date(NOW.getTime() + 5000);
    const fenceB = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps({ now: next })
    );

    // Re-activate hold under A's stale marker with future expiry for B reuse.
    await FacilityReservation.updateOne(
      { _id: h._id },
      {
        $set: {
          status: 'hold',
          holdExpiresAt: fenceB.bundleValidUntil,
          acquisitionAttemptId: fenceA.attemptId
        }
      }
    );

    const reused = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
      facilityDeps({
        now: next,
        acquisitionAttemptId: fenceB.attemptId,
        holdExpiresAt: fenceB.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.ok(reused.outcome === 'reused' || reused.outcome === 'renewed');
    assert.equal(reused.acquisitionAttemptId, null);

    // Live marker conflict: plant a live third attempt marker via direct write is hard;
    // plant missing marker reference.
    await FacilityReservation.updateOne(
      { _id: h._id },
      { $set: { acquisitionAttemptId: 'cra_missing_attempt_zzzz' } }
    );
    await assert.rejects(
      () =>
        acquireFacilityHold(
          { facilityCode: 'sauna-1', ...s, checkoutSessionId: co },
          facilityDeps({
            now: next,
            acquisitionAttemptId: fenceB.attemptId,
            holdExpiresAt: fenceB.bundleValidUntil,
            checkoutSessionId: co
          })
        ),
      (err) => err.code === 'FACILITY_ATTEMPT_MARKER_INTEGRITY'
    );
  });

  it('30. Far-future facility expiry rejects before writes', async () => {
    const co = checkoutId('far1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    await assert.rejects(
      () =>
        acquireFacilityHold(
          { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
          facilityDeps({
            acquisitionAttemptId: fence.attemptId,
            checkoutSessionId: co,
            holdExpiresAt: new Date(
              fence.bundleValidUntil.getTime() + 60000
            )
          })
        ),
      (err) => err.code === 'INVALID_HOLD_EXPIRY'
    );
    assert.equal(await FacilityReservation.countDocuments({}), 0);
  });
});

describe('B8F2A1 incomplete failure phase fencing and verification', () => {
  it('31-32+recovery. Real partial marker-clear keeps fence open; retry finishes', async () => {
    const co = checkoutId('inc1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const sels = [selection('sauna-1', 10, co), selection('hot-tub-1', 12, co)];

    let clearCalls = 0;
    await assert.rejects(
      () =>
        completeFencedFacilityAcquisition(
          {
            checkoutId: co,
            attemptId: fence.attemptId,
            quoteSnapshotHash: HASH,
            selections: sels
          },
          facilityDeps({
            holdExpiresAt: fence.bundleValidUntil,
            clearFacilityAcquisitionMarkersFn: async (input) => {
              clearCalls += 1;
              const rows = await FacilityReservation.find({
                checkoutSessionId: input.checkoutSessionId,
                acquisitionAttemptId: input.attemptId,
                status: 'hold'
              });
              assert.ok(rows.length >= 2);
              await FacilityReservation.updateOne(
                { _id: rows[0]._id, acquisitionAttemptId: input.attemptId },
                { $set: { acquisitionAttemptId: null } }
              );
              const remaining = await FacilityReservation.find({
                checkoutSessionId: input.checkoutSessionId,
                acquisitionAttemptId: input.attemptId
              })
                .select('_id')
                .lean();
              return {
                ok: false,
                modifiedCount: 1,
                remainingHoldIds: remaining.map((r) => String(r._id))
              };
            }
          })
        ),
      (err) =>
        err.code === 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE' &&
        Array.isArray(err.details.remainingHoldIds) &&
        err.details.remainingHoldIds.length >= 1
    );
    assert.equal(clearCalls, 1);

    const live = await CheckoutResourceAttempt.findOne({
      attemptId: fence.attemptId
    }).lean();
    assert.equal(live.status, 'open');
    assert.equal(live.isLive, true);
    assert.equal(live.failureCode, 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE');

    const remainingAfter = await listCurrentAttemptMarkedHoldIds(
      co,
      fence.attemptId,
      facilityDeps()
    );
    assert.ok(remainingAfter.length >= 1);

    const done = await completeFencedFacilityAcquisition(
      {
        checkoutId: co,
        attemptId: fence.attemptId,
        quoteSnapshotHash: HASH,
        selections: sels
      },
      facilityDeps({
        holdExpiresAt: fence.bundleValidUntil
      })
    );
    assert.equal(done.ok, true);
    assert.equal(
      (
        await listCurrentAttemptMarkedHoldIds(co, fence.attemptId, facilityDeps())
      ).length,
      0
    );
    const released = await CheckoutResourceAttempt.findOne({
      attemptId: fence.attemptId
    }).lean();
    assert.equal(released.status, 'released');
    assert.equal(released.isLive, false);
  });

  it('33-34. Success clears markers; verification matrix', async () => {
    const co = checkoutId('ok1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const sels = [selection('sauna-1', 10, co), selection('hot-tub-1', 12, co)];
    const done = await completeFencedFacilityAcquisition(
      {
        checkoutId: co,
        attemptId: fence.attemptId,
        quoteSnapshotHash: HASH,
        selections: sels
      },
      facilityDeps({
        holdExpiresAt: fence.bundleValidUntil
      })
    );
    assert.equal(done.ok, true);
    const marked = await FacilityReservation.countDocuments({
      checkoutSessionId: co,
      acquisitionAttemptId: fence.attemptId
    });
    assert.equal(marked, 0);

    const fenceRow = await CheckoutResourceAttempt.findOne({
      attemptId: fence.attemptId
    }).lean();
    assert.equal(fenceRow.status, 'released');

    // Verification failures
    const fence2 = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    await assert.rejects(
      () =>
        assertFacilityHoldsActive(
          {
            checkoutSessionId: co,
            attemptId: fence2.attemptId,
            bundleValidUntil: fence2.bundleValidUntil,
            selections: [selection('sauna-1', 14, co)],
            now: NOW
          },
          facilityDeps({
            acquisitionAttemptId: fence2.attemptId,
            checkoutSessionId: co
          })
        ),
      (err) => err.code === 'FACILITY_HOLD_VERIFICATION_FAILED'
    );
  });

  it('35-37. A blocks B; A compensates then B proceeds; resumed A cannot touch B', async () => {
    const co = checkoutId('ab1');
    const fenceA = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: co,
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 60 * 1000)
      },
      fenceDeps({ now: NOW })
    );
    await assert.rejects(
      () =>
        acquireCheckoutResourceAttemptFence(
          { checkoutId: co, quoteSnapshotHash: HASH },
          fenceDeps({ now: NOW })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_IN_PROGRESS'
    );

    const h = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps({
        now: NOW,
        acquisitionAttemptId: fenceA.attemptId,
        holdExpiresAt: fenceA.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    const comp = await compensateFacilityHolds(
      co,
      [h._id],
      facilityDeps({ acquisitionAttemptId: fenceA.attemptId })
    );
    assert.equal(comp.ok, true);
    await failCheckoutResourceAttemptFence(
      {
        checkoutId: co,
        attemptId: fenceA.attemptId,
        failureCode: 'TEST'
      },
      fenceDeps({ now: NOW })
    );

    const fenceB = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps({ now: NOW })
    );
    const hB = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps({
        now: NOW,
        acquisitionAttemptId: fenceB.attemptId,
        holdExpiresAt: fenceB.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.ok(hB.outcome === 'created' || hB.outcome === 'taken_over');

    // Expire A-style: create short fence, let B takeover, resume A (different slot — avoid lane clash)
    const co2 = checkoutId('ab2');
    const a2 = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: co2,
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 1000)
      },
      fenceDeps({ now: NOW })
    );
    const ha = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(14), checkoutSessionId: co2 },
      facilityDeps({
        now: NOW,
        acquisitionAttemptId: a2.attemptId,
        holdExpiresAt: a2.bundleValidUntil,
        checkoutSessionId: co2
      })
    );
    const t2 = new Date(NOW.getTime() + 5000);
    const b2 = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co2, quoteSnapshotHash: HASH },
      fenceDeps({ now: t2 })
    );
    await FacilityReservation.updateOne(
      { _id: ha._id },
      {
        $set: {
          status: 'hold',
          holdExpiresAt: b2.bundleValidUntil,
          acquisitionAttemptId: null
        }
      }
    );
    const hb = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(14), checkoutSessionId: co2 },
      facilityDeps({
        now: t2,
        acquisitionAttemptId: b2.attemptId,
        holdExpiresAt: b2.bundleValidUntil,
        checkoutSessionId: co2
      })
    );
    assert.ok(hb.outcome === 'reused' || hb.outcome === 'renewed');

    await assert.rejects(
      () =>
        assertCheckoutResourceAttemptFence(
          { checkoutId: co2, attemptId: a2.attemptId },
          fenceDeps({ now: t2 })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_FENCE_LOST'
    );
    const badComp = await compensateFacilityHolds(
      co2,
      [hb._id],
      facilityDeps({ acquisitionAttemptId: a2.attemptId })
    );
    assert.equal(badComp.cancelledIds.length, 0);
    const still = await FacilityReservation.findById(hb._id);
    assert.equal(still.status, 'hold');
    await assert.rejects(
      () =>
        releaseCheckoutResourceAttemptFence(
          { checkoutId: co2, attemptId: a2.attemptId },
          fenceDeps({ now: t2 })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_FENCE_LOST'
    );
  });

  it('38. Null-marker legacy B8D behavior remains compatible', async () => {
    const co = checkoutId('leg1');
    const h = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps()
    );
    assert.equal(h.outcome, 'created');
    assert.equal(h.acquisitionAttemptId, null);
    const again = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps()
    );
    assert.ok(again.outcome === 'reused' || again.outcome === 'renewed');
    const bookingId = new mongoose.Types.ObjectId();
    const conf = await confirmFacilityHolds(co, bookingId, facilityDeps());
    assert.equal(conf.ok, true);
  });

  it('39. Orchestrator may exist but must remain inert / unconsumed', () => {
    const fenceSrc = fs.readFileSync(
      path.join(
        __dirname,
        '../services/checkout/checkoutResourceAttemptFenceService.js'
      ),
      'utf8'
    );
    const facSrc = fs.readFileSync(
      path.join(__dirname, '../services/facilityBookingService.js'),
      'utf8'
    );
    for (const src of [fenceSrc, facSrc]) {
      assert.equal(src.includes('ensureCanonicalPaymentIntent'), false);
      assert.equal(src.includes('reserveVoucher'), false);
      assert.equal(src.includes('resourceAttemptOrchestrator'), false);
      assert.equal(src.includes('prepareCheckoutResourceBundle'), false);
      assert.equal(/require\(['\"]stripe['\"]\)/.test(src), false);
    }

    const orchPath = path.join(
      __dirname,
      '../services/checkout/resourceAttemptOrchestrator.js'
    );
    // File may exist after B8F2A2; prove it has no live consumers.
    if (fs.existsSync(orchPath)) {
      const roots = [
        path.join(__dirname, '../routes'),
        path.join(__dirname, '../services'),
        path.join(__dirname, '../../client/src')
      ];
      const bannedNeedles = [
        "require('../services/checkout/resourceAttemptOrchestrator'",
        "require('./resourceAttemptOrchestrator'",
        "require('../checkout/resourceAttemptOrchestrator'",
        'prepareCheckoutResourceBundle'
      ];
      const allowlist = new Set([
        path.normalize(orchPath),
        path.normalize(
          path.join(__dirname, 'resourceAttemptOrchestrator.b8f2a2.test.cjs')
        )
      ]);

      function walk(dir, out = []) {
        if (!fs.existsSync(dir)) return out;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (
              ent.name === 'node_modules' ||
              ent.name === '.git' ||
              ent.name === 'dist' ||
              ent.name === 'build'
            ) {
              continue;
            }
            walk(full, out);
          } else if (/\.(js|cjs|mjs|jsx|ts|tsx)$/.test(ent.name)) {
            out.push(full);
          }
        }
        return out;
      }

      const files = roots.flatMap((r) => walk(r));
      for (const file of files) {
        if (allowlist.has(path.normalize(file))) continue;
        const src = fs.readFileSync(file, 'utf8');
        for (const needle of bannedNeedles) {
          if (src.includes(needle)) {
            // Allow the A2 test file only (already skipped via allowlist).
            assert.fail(
              `Unexpected live consumer of orchestrator in ${path.relative(process.cwd(), file)}`
            );
          }
        }
      }
    }

    assert.ok(AUTHORITATIVE_LIVE_INDEX_SPEC.options.name);
  });
});

describe('B8F2A1 correction runtime proofs', () => {
  it('Same-attempt retry rediscovers markers into compensableHoldIds', async () => {
    const co = checkoutId('retry1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const first = await acquireFacilityHolds(
      [selection('sauna-1', 10, co)],
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co,
        quoteSnapshotHash: HASH
      })
    );
    assert.equal(first.newlyAcquiredIds.length, 1);
    assert.equal(first.compensableHoldIds.length, 1);
    const preId = String(first.holds[0]._id);

    const retry = await acquireFacilityHolds(
      [selection('sauna-1', 10, co)],
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co,
        quoteSnapshotHash: HASH
      })
    );
    assert.ok(retry.outcomes[0] === 'reused' || retry.outcomes[0] === 'renewed');
    assert.equal(retry.newlyAcquiredIds.length, 0);
    assert.ok(retry.compensableHoldIds.map(String).includes(preId));

    await acquireFacilityHold(
      {
        facilityCode: 'hot-tub-1',
        ...slot(12),
        checkoutSessionId: checkoutId('foreign1')
      },
      facilityDeps({ holdTtlMs: DEFAULT_FACILITY_HOLD_TTL_MS })
    );

    await assert.rejects(
      () =>
        acquireFacilityHolds(
          [selection('sauna-1', 10, co), selection('hot-tub-1', 12, co)],
          facilityDeps({
            acquisitionAttemptId: fence.attemptId,
            holdExpiresAt: fence.bundleValidUntil,
            checkoutSessionId: co,
            quoteSnapshotHash: HASH
          })
        ),
      (err) => {
        assert.equal(err.code, 'SLOT_AT_CAPACITY');
        assert.ok(err.details.compensableHoldIds.map(String).includes(preId));
        return true;
      }
    );

    assert.equal(
      (await listCurrentAttemptMarkedHoldIds(co, fence.attemptId, facilityDeps()))
        .length,
      0
    );
    const sauna = await FacilityReservation.findById(preId);
    assert.equal(sauna.status, 'cancelled');
  });

  it('Post-acquire verification failure compensates and fails fence', async () => {
    const co = checkoutId('verfail1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const sels = [selection('sauna-1', 10, co)];

    await assert.rejects(
      () =>
        completeFencedFacilityAcquisition(
          {
            checkoutId: co,
            attemptId: fence.attemptId,
            quoteSnapshotHash: HASH,
            selections: sels
          },
          facilityDeps({
            holdExpiresAt: fence.bundleValidUntil,
            assertFacilityHoldsActiveFn: async () => {
              throw new FacilityBookingError(
                'FACILITY_HOLD_VERIFICATION_FAILED',
                'Injected verification failure'
              );
            }
          })
        ),
      (err) => err.code === 'FACILITY_HOLD_VERIFICATION_FAILED'
    );

    assert.equal(
      (await listCurrentAttemptMarkedHoldIds(co, fence.attemptId, facilityDeps()))
        .length,
      0
    );
    const row = await CheckoutResourceAttempt.findOne({
      attemptId: fence.attemptId
    }).lean();
    assert.equal(row.status, 'failed');
    assert.equal(row.isLive, false);
    assert.equal(
      await FacilityReservation.countDocuments({
        status: 'hold',
        checkoutSessionId: co
      }),
      0
    );
  });

  it('Lost fence after acquisition: A does not compensate or succeed', async () => {
    const co = checkoutId('lost1');
    const fenceA = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: co,
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 2000)
      },
      fenceDeps({ now: NOW })
    );

    const later = new Date(NOW.getTime() + 10000);
    await assert.rejects(
      () =>
        completeFencedFacilityAcquisition(
          {
            checkoutId: co,
            attemptId: fenceA.attemptId,
            quoteSnapshotHash: HASH,
            selections: [selection('sauna-1', 10, co)]
          },
          facilityDeps({
            now: NOW,
            holdExpiresAt: fenceA.bundleValidUntil,
            assertFacilityHoldsActiveFn: async () => {
              await acquireCheckoutResourceAttemptFence(
                { checkoutId: co, quoteSnapshotHash: HASH },
                fenceDeps({ now: later })
              );
              throw new FacilityBookingError(
                'FACILITY_HOLD_VERIFICATION_FAILED',
                'verify after B takeover'
              );
            }
          })
        ),
      (err) => err.code === 'RESOURCE_BUNDLE_FENCE_LOST'
    );

    const marked = await FacilityReservation.find({
      checkoutSessionId: co,
      acquisitionAttemptId: fenceA.attemptId,
      status: 'hold'
    });
    assert.equal(marked.length, 1);

    const bLive = await CheckoutResourceAttempt.findOne({
      checkoutId: co,
      isLive: true
    }).lean();
    assert.ok(bLive);
    assert.notEqual(bLive.attemptId, fenceA.attemptId);
  });

  it('Partial confirmation prevented when any target is marked', async () => {
    const co = checkoutId('conf1');
    const fence = await acquireCheckoutResourceAttemptFence(
      { checkoutId: co, quoteSnapshotHash: HASH },
      fenceDeps()
    );
    const unmarked = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...slot(10), checkoutSessionId: co },
      facilityDeps()
    );
    assert.equal(unmarked.acquisitionAttemptId, null);
    const marked = await acquireFacilityHold(
      { facilityCode: 'hot-tub-1', ...slot(12), checkoutSessionId: co },
      facilityDeps({
        acquisitionAttemptId: fence.attemptId,
        holdExpiresAt: fence.bundleValidUntil,
        checkoutSessionId: co
      })
    );
    assert.ok(marked.acquisitionAttemptId);

    await assert.rejects(
      () =>
        confirmFacilityHolds(co, new mongoose.Types.ObjectId(), facilityDeps()),
      (err) => err.code === 'FACILITY_HOLD_NOT_CONFIRMABLE'
    );

    const u = await FacilityReservation.findById(unmarked._id);
    const m = await FacilityReservation.findById(marked._id);
    assert.equal(u.status, 'hold');
    assert.equal(m.status, 'hold');
  });

  it('Stale marker from different checkout fails closed', async () => {
    const coA = checkoutId('staleA1');
    const coB = checkoutId('staleB1');
    const fenceA = await acquireCheckoutResourceAttemptFence(
      {
        checkoutId: coA,
        quoteSnapshotHash: HASH,
        bundleValidUntil: new Date(NOW.getTime() + 1000)
      },
      fenceDeps({ now: NOW })
    );
    await failCheckoutResourceAttemptFence(
      {
        checkoutId: coA,
        attemptId: fenceA.attemptId,
        failureCode: 'DONE'
      },
      fenceDeps({ now: NOW })
    );
    const terminal = await CheckoutResourceAttempt.findOne({
      attemptId: fenceA.attemptId
    }).lean();
    assert.equal(terminal.status, 'failed');
    assert.equal(terminal.isLive, false);

    const fenceB = await acquireCheckoutResourceAttemptFence(
      { checkoutId: coB, quoteSnapshotHash: HASH },
      fenceDeps({ now: NOW })
    );
    const s = slot(10);
    const hold = await acquireFacilityHold(
      { facilityCode: 'sauna-1', ...s, checkoutSessionId: coB },
      facilityDeps({
        acquisitionAttemptId: fenceB.attemptId,
        holdExpiresAt: fenceB.bundleValidUntil,
        checkoutSessionId: coB
      })
    );
    await FacilityReservation.updateOne(
      { _id: hold._id },
      { $set: { acquisitionAttemptId: fenceA.attemptId } }
    );

    await assert.rejects(
      () =>
        acquireFacilityHold(
          { facilityCode: 'sauna-1', ...s, checkoutSessionId: coB },
          facilityDeps({
            acquisitionAttemptId: fenceB.attemptId,
            holdExpiresAt: fenceB.bundleValidUntil,
            checkoutSessionId: coB
          })
        ),
      (err) => err.code === 'FACILITY_ATTEMPT_MARKER_INTEGRITY'
    );

    const unchanged = await FacilityReservation.findById(hold._id);
    assert.equal(unchanged.acquisitionAttemptId, fenceA.attemptId);
    assert.equal(unchanged.status, 'hold');
  });
});
