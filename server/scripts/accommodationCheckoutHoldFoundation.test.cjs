/**
 * B8F1A correction — authoritative accommodation night leases (MongoMemoryServer).
 * Real exported APIs only. No conversion/reversal. No Stripe/CheckoutSession/finalize.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AvailabilityBlock = require('../models/AvailabilityBlock');
const AccommodationCheckoutLease = require('../models/AccommodationCheckoutLease');
const UnitNightClaim = require('../models/UnitNightClaim');
const CabinNightClaim = require('../models/CabinNightClaim');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const CabinType = require('../models/CabinType');

const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');
const {
  DEFAULT_ACCOMMODATION_HOLD_TTL_MS,
  RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT,
  RELEASED_CLEANUP_RETRY_BASE_MS,
  computeReleasedCleanupRetryDelayMs,
  AccommodationCheckoutHoldError,
  acquireAccommodationCheckoutHold,
  getActiveAccommodationCheckoutHold,
  assertAccommodationCheckoutHoldActive,
  releaseAccommodationCheckoutHold,
  expireAccommodationCheckoutHolds,
  ensureLeaseIndexesForTests
} = require('../services/checkout/accommodationCheckoutHoldService');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const STAY_MID = '2026-10-11';
const STAY_OUT_LONG = '2026-10-14';

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let stoneCabinId;
let seq = 0;

function checkoutId(label = 'co') {
  seq += 1;
  return `co_${label}_${seq}_${crypto.randomBytes(4).toString('hex')}`;
}

function depsBase(overrides = {}) {
  return {
    now: new Date(),
    loadExclusiveFixedPackages: async () => [],
    candidateSoftAvailable: async () => true,
    ...overrides
  };
}

async function seedInventory({ units = 5 } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `B8F1A CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f1a',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/a.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  cabinTypeId = cabinType._id;

  const parent = await Cabin.create({
    name: `Parent ${suffix}`,
    slug: `parent-${suffix}`,
    description: 'parent',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/p.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true,
    salesStatus: 'ready',
    cabinTypeId: cabinType._id
  });
  parentCabinId = parent._id;

  unitIds = [];
  for (let i = 0; i < units; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const u = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: `AF-${suffix}-${String(i + 1).padStart(2, '0')}`,
      isActive: true,
      salesStatus: 'ready'
    });
    unitIds.push(u._id);
  }

  luxCabinId = (
    await Cabin.create({
      name: `Lux ${suffix}`,
      slug: `lux-${suffix}`,
      description: 'lux',
      capacity: 2,
      pricePerNight: 150,
      minNights: 1,
      imageUrl: 'https://example.com/l.jpg',
      location: 'Bulgaria',
      propertyKind: 'valley',
      isActive: true,
      salesStatus: 'ready'
    })
  )._id;

  stoneCabinId = (
    await Cabin.create({
      name: `Stone ${suffix}`,
      slug: `stone-${suffix}`,
      description: 'stone',
      capacity: 6,
      pricePerNight: 40,
      minNights: 1,
      imageUrl: 'https://example.com/s.jpg',
      location: 'Bulgaria',
      propertyKind: 'valley',
      isActive: true,
      salesStatus: 'ready'
    })
  )._id;
}

async function ensureIndexes() {
  await unitClaims.ensureAuthoritativeUniqueIndexForTests();
  await unitClaims.ensureCheckoutLookupIndexesForTests();
  await cabinClaims.ensureAuthoritativeUniqueIndexForTests();
  await cabinClaims.ensureCheckoutLookupIndexesForTests();
  await ensureLeaseIndexesForTests();
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { directConnection: true });
  await ensureIndexes();
  await seedInventory({ units: 5 });
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    UnitNightClaim.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AccommodationCheckoutLease.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    Booking.deleteMany({})
  ]);
});

describe('B8F1A indexes and exports', () => {
  it('30. missing authoritative index fails closed', async () => {
    await UnitNightClaim.collection.dropIndex('unitNightClaim_unitId_night_unique');
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: checkoutId('noidx'),
            bookingContext: 'normal',
            entityType: 'cabinType',
            cabinTypeId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT,
            accommodationKey: 'a-frame'
          },
          depsBase()
        ),
      (err) =>
        err instanceof AccommodationCheckoutHoldError &&
        err.code === 'ACCOMMODATION_CLAIM_AUTHORITY_UNAVAILABLE'
    );
    await unitClaims.ensureAuthoritativeUniqueIndexForTests();
  });

  it('25. no conversion or reversal export remains', () => {
    const hold = require('../services/checkout/accommodationCheckoutHoldService');
    assert.equal(typeof hold.convertAccommodationCheckoutLeaseToBooking, 'undefined');
    assert.equal(typeof hold.reverseAccommodationBookingClaimsToCheckout, 'undefined');
    assert.equal(typeof unitClaims.convertUnitCheckoutClaimsToBooking, 'undefined');
    assert.equal(typeof cabinClaims.reverseCabinBookingClaimsToCheckout, 'undefined');
  });

  it('26-27. no AvailabilityBlock checkout_hold; no live wiring imports', async () => {
    await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('noblock'),
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    assert.equal(await AvailabilityBlock.countDocuments({ blockType: 'checkout_hold' }), 0);
    const src = fs.readFileSync(
      path.join(__dirname, '../services/checkout/accommodationCheckoutHoldService.js'),
      'utf8'
    );
    assert.equal(src.includes('publicAvailabilityService'), false);
    assert.equal(/require\(['"][^'"]*PaymentIntent/.test(src), false);
    assert.equal(src.includes('convertAccommodation'), false);
    assert.equal(/startSession\s*\(/.test(src), false);
  });
});

describe('B8F1A legacy and booking safety', () => {
  it('23. legacy Booking claims remain compatible', async () => {
    const bookingId = new mongoose.Types.ObjectId();
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: unitClaims.nightDateFromDateOnly(STAY_IN),
      bookingId,
      source: 'legacy_create',
      createdAt: new Date()
    });
    const row = await UnitNightClaim.findOne({ unitId: unitIds[0] }).lean();
    assert.equal(unitClaims.isBookingOwnedClaim(row), true);

    const res = await unitClaims.claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unitIds[1],
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      source: 'finalize'
    });
    assert.equal(res.ok, true);
    assert.ok(Array.isArray(res.claims));
    assert.ok('insertedCount' in res);
  });

  it('15-16. booking ownership rejects checkout fields; checkout rejects bookingId', async () => {
    await assert.rejects(
      () =>
        UnitNightClaim.create({
          unitId: unitIds[0],
          night: unitClaims.nightDateFromDateOnly(STAY_IN),
          ownerType: 'booking',
          bookingId: new mongoose.Types.ObjectId(),
          checkoutId: 'co_bad',
          source: 'finalize'
        }),
      /checkoutId/
    );
    await assert.rejects(
      () =>
        CabinNightClaim.create({
          cabinId: luxCabinId,
          night: cabinClaims.nightDateFromDateOnly(STAY_IN),
          ownerType: 'checkout',
          bookingId: new mongoose.Types.ObjectId(),
          checkoutId: checkoutId('x'),
          leaseId: 'acl_x',
          expiresAt: new Date(Date.now() + 60000),
          source: 'checkout_lease'
        }),
      /bookingId/
    );
  });

  it('17. ownership updates cannot bypass validation', async () => {
    const bookingId = new mongoose.Types.ObjectId();
    const created = await UnitNightClaim.create({
      unitId: unitIds[0],
      night: unitClaims.nightDateFromDateOnly(STAY_IN),
      bookingId,
      source: 'finalize'
    });
    await assert.rejects(
      () =>
        UnitNightClaim.findOneAndUpdate(
          { _id: created._id },
          {
            $set: {
              ownerType: 'checkout',
              bookingId: null,
              checkoutId: 'co_bypass',
              leaseId: 'acl_bypass',
              expiresAt: null
            }
          },
          { new: true, runValidators: true }
        ),
      /expiresAt|validation/i
    );
  });

  it('21. booking acquisition conflicts with live checkout claim', async () => {
    await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('liveblk'),
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    const leased = await UnitNightClaim.findOne({ ownerType: 'checkout' }).lean();
    await assert.rejects(
      () =>
        unitClaims.claimUnitNights({
          bookingId: new mongoose.Types.ObjectId(),
          unitId: leased.unitId,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          source: 'finalize'
        }),
      (err) => err.code === unitClaims.ERR.FOREIGN_OWNER
    );
  });

  it('22. booking release and compensation cannot delete checkout rows', async () => {
    const r = await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('nodelete'),
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    const before = await CabinNightClaim.countDocuments({ leaseId: r.leaseId });
    await cabinClaims.releaseCabinNights({ bookingId: new mongoose.Types.ObjectId() });
    await cabinClaims.compensateCabinClaimAttempt({
      bookingId: new mongoose.Types.ObjectId(),
      cabinId: luxCabinId,
      nights: [STAY_IN, STAY_MID]
    });
    assert.equal(await CabinNightClaim.countDocuments({ leaseId: r.leaseId }), before);
  });
});

describe('B8F1A partial acquisition and candidate retry', () => {
  it('1. mid-loop Unit conflict after inserted night leaves zero acquisition rows', async () => {
    const co = checkoutId('midu');
    const leaseId = `acl_${crypto.randomBytes(4).toString('hex')}`;
    const acq = `acq_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS);
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'open',
      isLive: true,
      entityType: 'unit',
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      expectedNightCount: 2,
      expiresAt,
      activeAcquisitionId: acq,
      acquisitionStartedAt: new Date()
    });
    // Block second night with booking claim.
    await unitClaims.claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unitIds[0],
      nights: [STAY_MID],
      source: 'finalize'
    });
    await assert.rejects(
      () =>
        unitClaims.acquireUnitCheckoutNights({
          unitId: unitIds[0],
          checkoutId: co,
          leaseId,
          acquisitionId: acq,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          expiresAt,
          now: new Date()
        }),
      (err) => err.code === unitClaims.CHECKOUT_CLAIM_ERR.FOREIGN_OWNER
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId, acquisitionId: acq }),
      0
    );
  });

  it('2. mid-loop Cabin conflict leaves zero acquisition rows', async () => {
    const co = checkoutId('midc');
    const leaseId = `acl_${crypto.randomBytes(4).toString('hex')}`;
    const acq = `acq_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS);
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'open',
      isLive: true,
      entityType: 'cabin',
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      expectedNightCount: 2,
      expiresAt,
      activeAcquisitionId: acq,
      acquisitionStartedAt: new Date()
    });
    await cabinClaims.claimCabinNights({
      cabinId: luxCabinId,
      bookingId: new mongoose.Types.ObjectId(),
      nights: [STAY_MID],
      source: 'finalize'
    });
    await assert.rejects(
      () =>
        cabinClaims.acquireCabinCheckoutNights({
          cabinId: luxCabinId,
          checkoutId: co,
          leaseId,
          acquisitionId: acq,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          expiresAt,
          now: new Date()
        }),
      (err) => err.code === cabinClaims.CHECKOUT_CLAIM_ERR.FOREIGN_OWNER
    );
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId, acquisitionId: acq }),
      0
    );
  });

  it('3. candidate retry begins only after successful compensation', async () => {
    // Pre-block unit 0 night2 so first candidate inserts night1 then conflicts.
    await unitClaims.claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unitIds[0],
      nights: [STAY_MID],
      source: 'finalize'
    });
    const r = await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('retry'),
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    assert.equal(r.outcome, 'created');
    assert.notEqual(String(r.unitId), String(unitIds[0]));
    assert.equal(
      await UnitNightClaim.countDocuments({
        unitId: unitIds[0],
        ownerType: 'checkout'
      }),
      0
    );
  });

  it('4. failed compensation stops candidate traversal before second Unit', async () => {
    const co = checkoutId('compfail');
    // Force first Unit mid-loop failure after night 1 insert.
    await unitClaims.claimUnitNights({
      bookingId: new mongoose.Types.ObjectId(),
      unitId: unitIds[0],
      nights: [STAY_MID],
      source: 'finalize'
    });

    const unitPath = require.resolve('../services/inventory/unitNightClaimService');
    const holdPath = require.resolve('../services/checkout/accommodationCheckoutHoldService');
    const unitMod = require(unitPath);
    const realAcquire = unitMod.acquireUnitCheckoutNights;
    const realCompensate = unitMod.compensateUnitCheckoutAcquisition;

    const attemptsByUnit = new Map();
    unitMod.acquireUnitCheckoutNights = async (opts) => {
      const id = String(opts.unitId);
      attemptsByUnit.set(id, (attemptsByUnit.get(id) || 0) + 1);
      return realAcquire(opts);
    };
    unitMod.compensateUnitCheckoutAcquisition = async () => {
      const err = new Error('forced compensation backstop failure');
      err.code = unitMod.CHECKOUT_CLAIM_ERR.COMPENSATION_FAILED;
      throw err;
    };

    delete require.cache[holdPath];
    const holdReloaded = require('../services/checkout/accommodationCheckoutHoldService');

    let rejected;
    try {
      await holdReloaded.acquireAccommodationCheckoutHold(
        {
          checkoutId: co,
          bookingContext: 'normal',
          entityType: 'cabinType',
          cabinTypeId,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          accommodationKey: 'a-frame'
        },
        depsBase()
      );
      assert.fail('expected acquire to reject');
    } catch (err) {
      rejected = err;
    }

    assert.ok(rejected instanceof holdReloaded.AccommodationCheckoutHoldError);
    assert.equal(rejected.code, 'ACCOMMODATION_LEASE_COMPENSATION_FAILED');
    assert.notEqual(rejected.code, 'NO_ELIGIBLE_ACCOMMODATION');
    assert.equal(attemptsByUnit.get(String(unitIds[0])) || 0, 1);
    assert.equal(attemptsByUnit.get(String(unitIds[1])) || 0, 0);
    assert.equal(
      await UnitNightClaim.countDocuments({
        unitId: unitIds[1],
        ownerType: 'checkout'
      }),
      0
    );

    const headers = await AccommodationCheckoutLease.find({ checkoutId: co }).lean();
    assert.equal(headers.length, 1);
    assert.equal(headers[0].status, 'failed');
    assert.equal(headers[0].isLive, false);
    assert.equal(headers[0].activeAcquisitionId, null);

    const residual = await UnitNightClaim.find({
      checkoutId: co,
      ownerType: 'checkout'
    }).lean();
    for (const row of residual) {
      assert.equal(String(row.checkoutId), co);
      assert.equal(String(row.leaseId), headers[0].leaseId);
    }

    unitMod.acquireUnitCheckoutNights = realAcquire;
    unitMod.compensateUnitCheckoutAcquisition = realCompensate;
    delete require.cache[holdPath];
    require('../services/checkout/accommodationCheckoutHoldService');
  });

  it('5. unknown Mongo failure is not mapped to no availability', async () => {
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: checkoutId('unk'),
            bookingContext: 'normal',
            entityType: 'cabinType',
            cabinTypeId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT,
            accommodationKey: 'a-frame'
          },
          depsBase({
            candidateSoftAvailable: async () => {
              const err = new Error('simulated driver failure');
              err.code = 'ECONNREFUSED';
              throw err;
            }
          })
        ),
      (err) =>
        err instanceof AccommodationCheckoutHoldError &&
        err.code === 'ACCOMMODATION_LEASE_INTERNAL_ERROR'
    );
  });
});

describe('B8F1A reuse fencing release expiry', () => {
  it('6-7. reused claims never receive retry acquisitionId; failed compensate cannot delete sealed', async () => {
    const co = checkoutId('reuse');
    const first = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    const second = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        ttlMs: DEFAULT_ACCOMMODATION_HOLD_TTL_MS
      },
      depsBase({ now: new Date(Date.now() + 30_000) })
    );
    assert.equal(second.leaseId, first.leaseId);
    const rows = await CabinNightClaim.find({ leaseId: first.leaseId }).lean();
    for (const row of rows) {
      assert.equal(row.acquisitionId, null);
    }
    const ids = rows.map((r) => String(r._id));
    const comp = await cabinClaims.compensateCabinCheckoutAcquisition({
      leaseId: first.leaseId,
      acquisitionId: `acq_fake_${crypto.randomBytes(2).toString('hex')}`,
      claimIds: ids
    });
    assert.equal(comp.deletedCount, 0);
    assert.equal(await CabinNightClaim.countDocuments({ leaseId: first.leaseId }), ids.length);
  });

  it('8. release during active acquisition fails without deactivating header', async () => {
    const co = checkoutId('fence');
    const leaseId = `acl_${crypto.randomBytes(3).toString('hex')}`;
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'open',
      isLive: true,
      entityType: 'cabin',
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      expectedNightCount: 2,
      expiresAt: new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS),
      activeAcquisitionId: 'acq_active',
      acquisitionStartedAt: new Date()
    });
    await assert.rejects(
      () => releaseAccommodationCheckoutHold(co, { leaseId }),
      (err) => err.code === 'ACCOMMODATION_LEASE_ACQUISITION_IN_PROGRESS'
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(header.isLive, true);
    assert.equal(header.activeAcquisitionId, 'acq_active');
  });

  it('9-10. delayed op after expiry cannot seal; cannot create live future claim after release', async () => {
    const co = checkoutId('delay');
    const leaseId = `acl_${crypto.randomBytes(3).toString('hex')}`;
    const acq = `acq_${crypto.randomBytes(3).toString('hex')}`;
    const past = new Date(Date.now() - 1000);
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'open',
      isLive: true,
      entityType: 'cabin',
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      expectedNightCount: 2,
      expiresAt: past,
      activeAcquisitionId: acq,
      acquisitionStartedAt: new Date(Date.now() - 5000)
    });
    // Expire header.
    await expireAccommodationCheckoutHolds(depsBase({ now: new Date() }));
    const header = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(header.isLive, false);

    await assert.rejects(
      () =>
        cabinClaims.acquireCabinCheckoutNights({
          cabinId: luxCabinId,
          checkoutId: co,
          leaseId,
          acquisitionId: acq,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          expiresAt: new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS),
          now: new Date()
        }),
      (err) => err.code === 'CHECKOUT_NIGHT_CLAIM_INTEGRITY'
    );
    assert.equal(await CabinNightClaim.countDocuments({ leaseId }), 0);
  });

  it('11-13. null checkout expiry integrity; not takeable; not silently expired', async () => {
    const night = cabinClaims.nightDateFromDateOnly(STAY_IN);
    await CabinNightClaim.collection.insertOne({
      cabinId: luxCabinId,
      night,
      ownerType: 'checkout',
      checkoutId: checkoutId('nullxp'),
      leaseId: `acl_null_${crypto.randomBytes(2).toString('hex')}`,
      acquisitionId: null,
      expiresAt: null,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    const co = checkoutId('take');
    const leaseId = `acl_take_${crypto.randomBytes(2).toString('hex')}`;
    const acq = `acq_take_${crypto.randomBytes(2).toString('hex')}`;
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'open',
      isLive: true,
      entityType: 'cabin',
      checkIn: STAY_IN,
      checkOut: '2026-10-11',
      expectedNightCount: 1,
      expiresAt: new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS),
      activeAcquisitionId: acq,
      acquisitionStartedAt: new Date()
    });
    await assert.rejects(
      () =>
        cabinClaims.acquireCabinCheckoutNights({
          cabinId: luxCabinId,
          checkoutId: co,
          leaseId,
          acquisitionId: acq,
          nights: [STAY_IN],
          expiresAt: new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS),
          now: new Date()
        }),
      (err) => err.code === 'CHECKOUT_NIGHT_CLAIM_INTEGRITY'
    );
    const before = await CabinNightClaim.countDocuments({ cabinId: luxCabinId, expiresAt: null });
    await expireAccommodationCheckoutHolds(depsBase({ now: new Date() }));
    assert.equal(
      await CabinNightClaim.countDocuments({ cabinId: luxCabinId, expiresAt: null }),
      before
    );
  });

  it('14. two concurrent expired takeovers produce one winner', async () => {
    const night = unitClaims.nightDateFromDateOnly(STAY_IN);
    const past = new Date(Date.now() - 60_000);
    await UnitNightClaim.create({
      unitId: unitIds[0],
      night,
      ownerType: 'checkout',
      checkoutId: checkoutId('old'),
      leaseId: `acl_old_${crypto.randomBytes(2).toString('hex')}`,
      acquisitionId: null,
      expiresAt: past,
      source: 'checkout_lease',
      bookingId: null
    });
    const future = new Date(Date.now() + DEFAULT_ACCOMMODATION_HOLD_TTL_MS);
    const now = new Date();
    async function setupAcq(label) {
      const co = checkoutId(label);
      const leaseId = `acl_${label}_${crypto.randomBytes(2).toString('hex')}`;
      const acq = `acq_${label}_${crypto.randomBytes(2).toString('hex')}`;
      await AccommodationCheckoutLease.create({
        leaseId,
        checkoutId: co,
        generation: 1,
        status: 'open',
        isLive: true,
        entityType: 'unit',
        checkIn: STAY_IN,
        checkOut: '2026-10-11',
        expectedNightCount: 1,
        expiresAt: future,
        activeAcquisitionId: acq,
        acquisitionStartedAt: now
      });
      return { co, leaseId, acq };
    }
    const a = await setupAcq('ta');
    const b = await setupAcq('tb');
    // Second live header for same nights different checkouts — OK (different checkoutId).
    // But only one live per checkout — these are different checkouts.
    const results = await Promise.allSettled([
      unitClaims.acquireUnitCheckoutNights({
        unitId: unitIds[0],
        checkoutId: a.co,
        leaseId: a.leaseId,
        acquisitionId: a.acq,
        nights: [STAY_IN],
        expiresAt: future,
        now
      }),
      unitClaims.acquireUnitCheckoutNights({
        unitId: unitIds[0],
        checkoutId: b.co,
        leaseId: b.leaseId,
        acquisitionId: b.acq,
        nights: [STAY_IN],
        expiresAt: future,
        now
      })
    ]);
    const wins = results.filter((r) => r.status === 'fulfilled');
    const losses = results.filter((r) => r.status === 'rejected');
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    assert.equal(await UnitNightClaim.countDocuments({ unitId: unitIds[0], night }), 1);
  });

  it('18. release CAS-first: incomplete claim cleanup leaves released header recoverable', async () => {
    const co = checkoutId('incomp');
    const r = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    assert.equal(r.outcome, 'created');

    const holdPath = require.resolve('../services/checkout/accommodationCheckoutHoldService');
    const cabinPath = require.resolve('../services/inventory/cabinNightClaimService');
    const cabinMod = require(cabinPath);
    const realRelease = cabinMod.releaseCabinCheckoutLeaseClaims;

    cabinMod.releaseCabinCheckoutLeaseClaims = async () => ({
      ok: false,
      deletedCount: 0,
      remaining: 2
    });
    delete require.cache[holdPath];
    const holdReloaded = require('../services/checkout/accommodationCheckoutHoldService');

    await assert.rejects(
      () => holdReloaded.releaseAccommodationCheckoutHold(co, { leaseId: r.leaseId }),
      (err) =>
        err instanceof holdReloaded.AccommodationCheckoutHoldError &&
        err.code === 'ACCOMMODATION_LEASE_RELEASE_INCOMPLETE'
    );

    const headerAfterIncomplete = await AccommodationCheckoutLease.findOne({
      leaseId: r.leaseId
    }).lean();
    assert.ok(headerAfterIncomplete);
    // Header CAS wins before claim cleanup — claims remain for retry.
    assert.equal(headerAfterIncomplete.isLive, false);
    assert.equal(headerAfterIncomplete.status, 'released');
    assert.equal(headerAfterIncomplete.activeAcquisitionId, null);

    const remainingClaims = await CabinNightClaim.find({
      ownerType: 'checkout',
      checkoutId: co,
      leaseId: r.leaseId
    }).lean();
    assert.ok(remainingClaims.length >= 2);

    cabinMod.releaseCabinCheckoutLeaseClaims = realRelease;
    delete require.cache[holdPath];
    const holdRetry = require('../services/checkout/accommodationCheckoutHoldService');
    const retry = await holdRetry.releaseAccommodationCheckoutHold(co, { leaseId: r.leaseId });
    assert.equal(retry.releasedCount, 0); // already released; cleanup resume only

    assert.equal(
      await CabinNightClaim.countDocuments({
        ownerType: 'checkout',
        checkoutId: co,
        leaseId: r.leaseId
      }),
      0
    );
    const headerAfterRetry = await AccommodationCheckoutLease.findOne({
      leaseId: r.leaseId
    }).lean();
    assert.equal(headerAfterRetry.status, 'released');
    assert.equal(headerAfterRetry.isLive, false);

    delete require.cache[holdPath];
    require('../services/checkout/accommodationCheckoutHoldService');
  });

  it('19. sealed marker-clearing failure preserves the lease', async () => {
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: checkoutId('markfail'),
            bookingContext: 'normal',
            entityType: 'cabin',
            cabinId: luxCabinId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT
          },
          depsBase({
            clearAcquisitionMarkers: async () => {
              throw new Error('marker clear boom');
            }
          })
        ),
      (err) =>
        err instanceof AccommodationCheckoutHoldError &&
        err.code === 'ACCOMMODATION_LEASE_INTEGRITY' &&
        /markers failed/i.test(err.message)
    );
    const live = await AccommodationCheckoutLease.findOne({
      isLive: true,
      status: 'sealed'
    }).lean();
    assert.ok(live);
    assert.equal(await CabinNightClaim.countDocuments({ leaseId: live.leaseId }), 2);
  });

  it('20. sealed retry repairs safe leftover markers', async () => {
    const co = checkoutId('repair');
    const first = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    await CabinNightClaim.updateMany(
      { leaseId: first.leaseId },
      { $set: { acquisitionId: 'acq_leftover' } }
    );
    const second = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase({ now: new Date(Date.now() + 10_000) })
    );
    assert.equal(second.leaseId, first.leaseId);
    const rows = await CabinNightClaim.find({ leaseId: first.leaseId }).lean();
    for (const row of rows) {
      assert.equal(row.acquisitionId, null);
    }
  });
});

describe('B8F1A concurrency and DTO integrity', () => {
  it('28-29. same-owner concurrency and DTO maps to surviving claims', async () => {
    const co = checkoutId('conc');
    const input = {
      checkoutId: co,
      bookingContext: 'normal',
      entityType: 'cabin',
      cabinId: luxCabinId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT
    };
    const results = await Promise.allSettled([
      acquireAccommodationCheckoutHold(input, depsBase()),
      acquireAccommodationCheckoutHold(input, depsBase())
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    assert.ok(fulfilled.length >= 1);
    const leaseIds = new Set(fulfilled.map((f) => f.leaseId));
    assert.equal(leaseIds.size, 1);
    const leaseId = fulfilled[0].leaseId;
    const claims = await CabinNightClaim.find({ leaseId }).lean();
    assert.equal(claims.length, fulfilled[0].expectedNightCount);
    assert.equal(fulfilled[0].claimIds.length, claims.length);
    assert.equal(await AccommodationCheckoutLease.countDocuments({ checkoutId: co, isLive: true }), 1);
  });

  it('24. Unit and Cabin wrappers produce equivalent behavior', async () => {
    const u = await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('wrapu'),
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    const c = await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('wrapc'),
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: stoneCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    assert.equal(u.outcome, 'created');
    assert.equal(c.outcome, 'created');
    assert.equal(u.expectedNightCount, c.expectedNightCount);
    assert.ok(u.unitId);
    assert.ok(c.cabinId);
    assert.equal(c.unitId, null);
  });

  it('different-owner exclusivity still holds', async () => {
    await acquireAccommodationCheckoutHold(
      {
        checkoutId: checkoutId('a'),
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: checkoutId('b'),
            bookingContext: 'normal',
            entityType: 'cabin',
            cabinId: luxCabinId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT
          },
          depsBase()
        ),
      (err) =>
        err instanceof AccommodationCheckoutHoldError &&
        (err.code === 'ACCOMMODATION_NIGHT_CONFLICT' ||
          err.code === 'NO_ELIGIBLE_ACCOMMODATION')
    );
  });
});

describe('B8F4A correction-3 acquire-time expired header cleanup', () => {
  it('acquire releases expired sealed unit hold and clears claims before new generation', async () => {
    const co = checkoutId('c3acq');
    const first = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    assert.equal(first.status, 'sealed');
    const lease1 = first.leaseId;
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }), 2);

    await AccommodationCheckoutLease.updateOne(
      { leaseId: lease1 },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );

    const second = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase({ now: new Date() })
    );
    assert.equal(second.outcome, 'created');
    assert.equal(second.generation, first.generation + 1);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }), 0);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: second.leaseId, ownerType: 'checkout' }),
      2
    );
    const old = await AccommodationCheckoutLease.findOne({ leaseId: lease1 }).lean();
    assert.equal(old.status, 'released');
    assert.equal(old.isLive, false);
  });

  it('acquire resumes claim cleanup after crash between header release and delete', async () => {
    const co = checkoutId('c3crash');
    const first = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase()
    );
    await AccommodationCheckoutLease.updateOne(
      { leaseId: first.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );

    let crashed = false;
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: co,
            bookingContext: 'normal',
            entityType: 'cabin',
            cabinId: luxCabinId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT
          },
          depsBase({
            now: new Date(),
            onAfterHeaderReleasedBeforeClaimDelete: async () => {
              if (!crashed) {
                crashed = true;
                throw new Error('inject_foundation_acquire_crash');
              }
            }
          })
        ),
      /inject_foundation_acquire_crash/
    );

    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: first.leaseId, ownerType: 'checkout' }),
      2
    );
    assert.equal(
      await AccommodationCheckoutLease.countDocuments({ checkoutId: co, isLive: true }),
      0
    );

    const second = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase({ now: new Date() })
    );
    assert.equal(second.generation, first.generation + 1);
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: first.leaseId, ownerType: 'checkout' }),
      0
    );
  });

  it('converting header is not released or cleaned by acquire', async () => {
    const co = checkoutId('c3conv');
    const first = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    await AccommodationCheckoutLease.updateOne(
      { leaseId: first.leaseId },
      {
        $set: {
          status: 'converting',
          expiresAt: new Date(Date.now() - 60_000),
          conversionBookingId: new mongoose.Types.ObjectId(),
          conversionAttemptId: 'att_c3',
          conversionStartedAt: new Date()
        }
      }
    );
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: co,
            bookingContext: 'normal',
            entityType: 'cabinType',
            cabinTypeId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT,
            accommodationKey: 'a-frame'
          },
          depsBase({ now: new Date() })
        ),
      (err) => err.code === 'ACCOMMODATION_LEASE_CONVERSION_IN_PROGRESS'
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: first.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(header.isLive, true);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: first.leaseId, ownerType: 'checkout' }),
      2
    );
  });
});

describe('B8F4A correction-5 durable cleanup progress (foundation)', () => {
  it('release transition sets cleanup pending; complete after cleanup', async () => {
    const co = checkoutId('c5rel');
    const hold = await acquireAccommodationCheckoutHold(
      {
        checkoutId: co,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase()
    );
    let crashed = false;
    await assert.rejects(
      () =>
        releaseAccommodationCheckoutHold(
          co,
          { leaseId: hold.leaseId },
          {
            onAfterHeaderReleasedBeforeClaimDelete: async () => {
              if (!crashed) {
                crashed = true;
                throw new Error('inject_c5_foundation_crash');
              }
            }
          }
        ),
      /inject_c5_foundation_crash/
    );
    const mid = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(mid.status, 'released');
    assert.equal(mid.isLive, false);
    assert.equal(mid.checkoutClaimCleanupStatus, 'pending');
    assert.equal(mid.checkoutClaimCleanupCompletedAt, null);
    assert.equal(mid.checkoutClaimCleanupFailureCode, null);
    assert.equal(new Date(mid.expiresAt).getTime() > Date.now(), true);

    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(exp.releasedCleanupBatchLimit, RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT);
    assert.equal(exp.releasedCleanupCompleted >= 1, true);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const done = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(done.checkoutClaimCleanupStatus, 'complete');
    assert.ok(done.checkoutClaimCleanupCompletedAt);
    assert.equal(done.checkoutClaimCleanupFailureCode, null);
    assert.equal(done.checkoutClaimCleanupNextAttemptAt, null);
    assert.equal(Number(done.checkoutClaimCleanupAttemptCount) >= 1, true);
  });

  it('legacy released header without cleanup fields is completed after zero-claim proof', async () => {
    const leaseId = `acl_c5_legacy_${crypto.randomBytes(3).toString('hex')}`;
    const co = checkoutId('c5leg');
    await AccommodationCheckoutLease.collection.insertOne({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[0],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    const before = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(before.checkoutClaimCleanupStatus, undefined);
    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(exp.releasedCleanupCompleted >= 1, true);
    const after = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(after.checkoutClaimCleanupStatus, 'complete');
  });

  it('cleanup recovery index is created for tests', async () => {
    await ensureLeaseIndexesForTests();
    const indexes = await AccommodationCheckoutLease.collection.indexes();
    assert.equal(
      indexes.some((idx) => idx.name === 'accommodationCheckoutLease_released_cleanup_v2'),
      true
    );
  });

  it('B8F5A backoff formula is deterministic and capped', () => {
    assert.equal(computeReleasedCleanupRetryDelayMs(1), RELEASED_CLEANUP_RETRY_BASE_MS);
    assert.equal(computeReleasedCleanupRetryDelayMs(2), RELEASED_CLEANUP_RETRY_BASE_MS * 2);
    assert.equal(computeReleasedCleanupRetryDelayMs(50) <= 60 * 60 * 1000, true);
  });
});

describe('B8F5A Correction 1 — cleanup-authority injection closed', () => {
  const FORBIDDEN_KEYS = [
    'skipCleanupAttemptReservation',
    'ignoreCleanupNextAttemptAt',
    'cleanupAttemptAuthority',
    'cleanupReservationAuthority',
    'headerCleanupAuthority',
    'releasedHeaderCleanupAuthority'
  ];

  const INJECTION_VALUES = [
    ['true', true],
    ['false', false],
    ['string', 'skip'],
    ['object', { ok: true }],
    ['function', () => true],
    ['fakeSymbol', Symbol('B8F5A_PRIVATE_RELEASED_CLEANUP_AUTHORITY')]
  ];

  function acquireInput(co) {
    return {
      checkoutId: co,
      bookingContext: 'normal',
      entityType: 'cabinType',
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      accommodationKey: 'a-frame'
    };
  }

  for (const key of FORBIDDEN_KEYS) {
    for (const [label, value] of INJECTION_VALUES) {
      it(`acquire rejects ${key}=${label} before lease/claim mutation`, async () => {
        const co = checkoutId(`inj_${key}_${label}`);
        const beforeLeases = await AccommodationCheckoutLease.countDocuments({ checkoutId: co });
        const beforeClaims = await UnitNightClaim.countDocuments({ checkoutId: co });
        await assert.rejects(
          () => acquireAccommodationCheckoutHold(acquireInput(co), depsBase({ [key]: value })),
          (err) =>
            err instanceof AccommodationCheckoutHoldError &&
            err.code === 'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_INJECTION' &&
            err.details &&
            err.details.key === key
        );
        assert.equal(await AccommodationCheckoutLease.countDocuments({ checkoutId: co }), beforeLeases);
        assert.equal(await UnitNightClaim.countDocuments({ checkoutId: co }), beforeClaims);
      });
    }
  }

  it('null/undefined forbidden keys are ignored; acquire still works', async () => {
    const co = checkoutId('inj_null_ok');
    const hold = await acquireAccommodationCheckoutHold(
      acquireInput(co),
      depsBase({
        skipCleanupAttemptReservation: null,
        ignoreCleanupNextAttemptAt: undefined
      })
    );
    assert.ok(hold.leaseId);
    assert.equal(hold.checkoutId, co);
  });

  it('private capability Symbol is not exported', () => {
    const exported = require('../services/checkout/accommodationCheckoutHoldService');
    assert.equal(exported.PRIVATE_RELEASED_CLEANUP_AUTHORITY, undefined);
    assert.equal(exported.privateReleasedCleanupArgs, undefined);
    assert.equal(exported.finalizeReleasedHeaderClaimCleanup, undefined);
    assert.equal(exported.reserveReleasedHeaderCleanupAttempt, undefined);
    for (const key of Object.keys(exported)) {
      assert.equal(typeof exported[key] === 'symbol', false);
      assert.equal(String(key).includes('PRIVATE_RELEASED'), false);
    }
  });

  it('acquire-time durable release cleanup still works', async () => {
    const co = checkoutId('acq_rel_cleanup');
    const hold = await acquireAccommodationCheckoutHold(acquireInput(co), depsBase());
    await AccommodationCheckoutLease.updateOne(
      { leaseId: hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    const next = await acquireAccommodationCheckoutHold(
      acquireInput(co),
      depsBase({ now: new Date() })
    );
    assert.ok(next.leaseId);
    assert.notEqual(next.leaseId, hold.leaseId);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const old = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(old.status, 'released');
    assert.equal(old.checkoutClaimCleanupStatus, 'complete');
  });

  it('intentional release still completes cleanup', async () => {
    const co = checkoutId('int_rel');
    const hold = await acquireAccommodationCheckoutHold(acquireInput(co), depsBase());
    await releaseAccommodationCheckoutHold(co, { leaseId: hold.leaseId }, depsBase());
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(header.status, 'released');
    assert.equal(header.checkoutClaimCleanupStatus, 'complete');
  });

  it('same-checkout released resume still works after crash mid-release', async () => {
    const co = checkoutId('resume_rel');
    const hold = await acquireAccommodationCheckoutHold(acquireInput(co), depsBase());
    let crashed = false;
    await assert.rejects(
      () =>
        releaseAccommodationCheckoutHold(co, { leaseId: hold.leaseId }, {
          onAfterHeaderReleasedBeforeClaimDelete: async () => {
            if (!crashed) {
              crashed = true;
              throw new Error('inject_resume_crash');
            }
          }
        }),
      /inject_resume_crash/
    );
    const mid = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(mid.checkoutClaimCleanupStatus, 'pending');
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }),
      2
    );
    // Second acquire resumes same-checkout released cleanup then creates new generation.
    const next = await acquireAccommodationCheckoutHold(acquireInput(co), depsBase());
    assert.ok(next.leaseId);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }),
      0
    );
  });

  it('normal expiry batch always reserves (attempt count increments)', async () => {
    const leaseId = `acl_corr1_reserve_${crypto.randomBytes(3).toString('hex')}`;
    const co = checkoutId('corr1_reserve');
    const t0 = new Date('2026-09-01T00:00:00.000Z');
    await AccommodationCheckoutLease.create({
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[0],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(t0.getTime() + 3600_000),
      checkoutClaimCleanupStatus: 'pending',
      checkoutClaimCleanupAttemptCount: 0,
      checkoutClaimCleanupNextAttemptAt: null
    });
    const batch = await expireAccommodationCheckoutHolds({
      now: t0,
      onAfterCleanupAttemptReserved: async () => {
        const err = new Error('force_fail');
        err.code = 'FORCE_FAIL';
        throw err;
      }
    });
    assert.equal(batch.releasedCleanupAttempted >= 1, true);
    assert.equal(batch.releasedCleanupFailed >= 1, true);
    const h = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(Number(h.checkoutClaimCleanupAttemptCount), 1);
    assert.ok(h.checkoutClaimCleanupNextAttemptAt);
  });

  it('service return values never include private capability', async () => {
    const co = checkoutId('no_sym_ret');
    const hold = await acquireAccommodationCheckoutHold(acquireInput(co), depsBase());
    const blob = JSON.stringify(hold);
    assert.equal(blob.includes('PRIVATE_RELEASED'), false);
    assert.equal(blob.includes('Symbol('), false);
    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(JSON.stringify(exp).includes('Symbol('), false);
    assert.equal(Object.values(exp).some((v) => typeof v === 'symbol'), false);
  });
});

describe('B8F5A Correction 1 — attempt counter normalization', () => {
  async function seedReleased(leaseId, co, attemptRaw, { omitCount = false } = {}) {
    const t0 = new Date('2026-09-02T00:00:00.000Z');
    const doc = {
      leaseId,
      checkoutId: co,
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[0],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(t0.getTime() + 3600_000),
      checkoutClaimCleanupStatus: 'pending',
      checkoutClaimCleanupNextAttemptAt: null,
      createdAt: t0,
      updatedAt: t0
    };
    if (!omitCount) {
      doc.checkoutClaimCleanupAttemptCount = attemptRaw;
    }
    await AccommodationCheckoutLease.collection.insertOne(doc);
    return t0;
  }

  const cases = [
    { name: 'missing', omitCount: true, expected: 1, delayMult: 1 },
    { name: 'null', raw: null, expected: 1, delayMult: 1 },
    { name: 'negative', raw: -3, expected: 1, delayMult: 1 },
    { name: 'zero', raw: 0, expected: 1, delayMult: 1 },
    { name: 'positive_int', raw: 2, expected: 3, delayMult: 4 },
    { name: 'positive_decimal', raw: 2.9, expected: 3, delayMult: 4 },
    { name: 'large_int', raw: 100, expected: 101, delayMult: null },
    { name: 'string', raw: 'nope', expected: 1, delayMult: 1 }
  ];

  for (const c of cases) {
    it(`normalizes stored ${c.name} → reserved ${c.expected}`, async () => {
      const leaseId = `acl_norm_${c.name}_${crypto.randomBytes(2).toString('hex')}`;
      const co = checkoutId(`norm_${c.name}`);
      const t0 = await seedReleased(leaseId, co, c.raw, { omitCount: c.omitCount === true });
      const batch = await expireAccommodationCheckoutHolds({
        now: t0,
        onAfterCleanupAttemptReserved: async () => {
          const err = new Error('stop_after_reserve');
          err.code = 'STOP_AFTER_RESERVE';
          throw err;
        }
      });
      assert.equal(batch.releasedCleanupAttempted >= 1, true);
      const h = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
      assert.equal(Number(h.checkoutClaimCleanupAttemptCount), c.expected);
      assert.equal(Number.isInteger(h.checkoutClaimCleanupAttemptCount), true);
      assert.equal(h.checkoutClaimCleanupAttemptCount >= 1, true);
      if (c.delayMult != null) {
        assert.equal(
          new Date(h.checkoutClaimCleanupNextAttemptAt).getTime(),
          t0.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS * c.delayMult
        );
      } else {
        assert.equal(
          new Date(h.checkoutClaimCleanupNextAttemptAt).getTime(),
          t0.getTime() + computeReleasedCleanupRetryDelayMs(c.expected)
        );
      }
    });
  }

  it('concurrent workers on negative count produce exactly one reservation → 1', async () => {
    const leaseId = `acl_norm_conc_${crypto.randomBytes(2).toString('hex')}`;
    const co = checkoutId('norm_conc');
    const t0 = await seedReleased(leaseId, co, -3);
    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({ now: t0 }),
      expireAccommodationCheckoutHolds({ now: t0 })
    ]);
    const h = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(h.checkoutClaimCleanupStatus, 'complete');
    assert.equal(Number(h.checkoutClaimCleanupAttemptCount), 1);
    assert.equal(
      (a.releasedCleanupAttempted || 0) + (b.releasedCleanupAttempted || 0),
      1
    );
    assert.equal(
      (a.releasedCleanupCompleted || 0) + (b.releasedCleanupCompleted || 0) >= 1,
      true
    );
  });

  it('concurrent workers on valid count preserve history (2 → 3)', async () => {
    const leaseId = `acl_norm_hist_${crypto.randomBytes(2).toString('hex')}`;
    const co = checkoutId('norm_hist');
    const t0 = await seedReleased(leaseId, co, 2);
    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({
        now: t0,
        onAfterCleanupAttemptReserved: async () => {
          const err = new Error('fail');
          err.code = 'X';
          throw err;
        }
      }),
      expireAccommodationCheckoutHolds({
        now: t0,
        onAfterCleanupAttemptReserved: async () => {
          const err = new Error('fail');
          err.code = 'X';
          throw err;
        }
      })
    ]);
    const h = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(Number(h.checkoutClaimCleanupAttemptCount), 3);
    assert.equal(
      (a.releasedCleanupAttempted || 0) + (b.releasedCleanupAttempted || 0),
      1
    );
  });
});
