/**
 * B8F1B — checkout-night claim visibility (MongoMemoryServer).
 * Real production APIs only. No CheckoutSession / Stripe / finalize / route wiring.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const UnitNightClaim = require('../models/UnitNightClaim');
const CabinNightClaim = require('../models/CabinNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const CabinType = require('../models/CabinType');
const AuditEvent = require('../models/AuditEvent');

const {
  CLASSIFICATION,
  classifyCheckoutClaimVisibility,
  listBlockingUnitCheckoutClaims,
  listBlockingCabinCheckoutClaims
} = require('../services/inventory/checkoutNightClaimVisibility');
const {
  evaluateCabinTypeCommercialCapacity
} = require('../services/inventory/cabinTypeCommercialCapacity');
const {
  isUnitGuestStayAvailable,
  isSingleCabinGuestStayAvailable
} = require('../services/publicAvailabilityService');
const {
  evaluateTargetConflicts,
  evaluateCabinConflicts
} = require('../services/ops/domain/conflictService');
const { evaluateLocationConflicts } = require('../services/ops/domain/locationConflictService');
const { createBlock, editBlock } = require('../services/ops/domain/availabilityWriteService');
const { nightDateFromDateOnly } = require('../services/inventory/unitNightClaimService');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const STAY_MID = '2026-10-11';
const ADJACENT_IN = '2026-10-12';
const ADJACENT_OUT = '2026-10-13';
const LONG_OUT = '2026-10-14';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const EXPIRES_LIVE = new Date('2026-12-01T12:00:00.000Z');
const EXPIRES_PAST = new Date('2026-08-01T12:00:00.000Z');

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let stoneCabinId;
let seq = 0;

function opsCtx(route = 'POST /api/ops/availability/manual-blocks') {
  return {
    user: { id: 'admin', role: 'admin' },
    route,
    req: { user: { id: 'admin', role: 'admin' }, headers: {} }
  };
}

async function seedInventory({ units = 3 } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `B8F1B CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f1b',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/a.jpg',
    location: 'The Valley',
    propertyKind: 'valley',
    isActive: true
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
    location: 'The Valley',
    propertyKind: 'valley',
    inventoryType: 'multi',
    cabinTypeId: cabinType._id,
    isActive: true,
    salesStatus: 'ready'
  });
  parentCabinId = parent._id;

  unitIds = [];
  for (let i = 0; i < units; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const u = await Unit.create({
      cabinTypeId: cabinType._id,
      unitNumber: `AF-${suffix}-${String(i + 1).padStart(2, '0')}`,
      displayName: `A-Frame ${i + 1}`,
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
      location: 'The Valley',
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
      location: 'The Valley',
      propertyKind: 'valley',
      isActive: true,
      salesStatus: 'ready'
    })
  )._id;
}

async function insertUnitCheckoutClaim({
  unitId,
  night = STAY_IN,
  checkoutId = 'co_live',
  leaseId = 'lease_live',
  expiresAt = EXPIRES_LIVE,
  raw = false
} = {}) {
  const doc = {
    unitId,
    night: nightDateFromDateOnly(night),
    ownerType: 'checkout',
    checkoutId,
    leaseId,
    acquisitionId: null,
    expiresAt,
    source: 'checkout_lease',
    bookingId: null,
    createdAt: new Date()
  };
  if (raw) {
    await UnitNightClaim.collection.insertOne(doc);
    return doc;
  }
  return UnitNightClaim.create(doc);
}

async function insertCabinCheckoutClaim({
  cabinId,
  night = STAY_IN,
  checkoutId = 'co_cabin',
  leaseId = 'lease_cabin',
  expiresAt = EXPIRES_LIVE,
  raw = false
} = {}) {
  const doc = {
    cabinId,
    night: nightDateFromDateOnly(night),
    ownerType: 'checkout',
    checkoutId,
    leaseId,
    acquisitionId: null,
    expiresAt,
    source: 'checkout_lease',
    bookingId: null,
    createdAt: new Date()
  };
  if (raw) {
    await CabinNightClaim.collection.insertOne(doc);
    return doc;
  }
  return CabinNightClaim.create(doc);
}

const availOpts = {
  now: NOW,
  skipExclusivePackageCheck: true
};

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { dbName: 'b8f1b_visibility' });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    UnitNightClaim.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    Booking.deleteMany({}),
    Unit.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    AuditEvent.collection.deleteMany({})
  ]);
  await seedInventory({ units: 3 });
});

describe('B8F1B classifier and exclusion', () => {
  it('7-10. malformed checkoutId/leaseId/expiresAt classify as blocking integrity', () => {
    const base = {
      _id: new mongoose.Types.ObjectId(),
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_x',
      leaseId: 'lease_x',
      expiresAt: EXPIRES_LIVE
    };
    assert.equal(
      classifyCheckoutClaimVisibility({ ...base, checkoutId: '' }, { now: NOW }).classification,
      CLASSIFICATION.MALFORMED
    );
    assert.equal(
      classifyCheckoutClaimVisibility({ ...base, leaseId: null }, { now: NOW }).classification,
      CLASSIFICATION.MALFORMED
    );
    assert.equal(
      classifyCheckoutClaimVisibility({ ...base, expiresAt: null }, { now: NOW }).classification,
      CLASSIFICATION.MALFORMED
    );
    assert.equal(
      classifyCheckoutClaimVisibility({ ...base, expiresAt: 'not-a-date' }, { now: NOW })
        .classification,
      CLASSIFICATION.MALFORMED
    );

    const wsCheckout = classifyCheckoutClaimVisibility(
      { ...base, checkoutId: '   ' },
      { now: NOW, excludeCheckoutId: '   ', excludeLeaseId: 'lease_x' }
    );
    assert.equal(wsCheckout.classification, CLASSIFICATION.MALFORMED);
    assert.equal(wsCheckout.blocking, true);
    assert.equal(wsCheckout.excluded, false);

    const wsLease = classifyCheckoutClaimVisibility(
      { ...base, leaseId: '\t  ' },
      { now: NOW, excludeCheckoutId: 'co_x', excludeLeaseId: '\t  ' }
    );
    assert.equal(wsLease.classification, CLASSIFICATION.MALFORMED);
    assert.equal(wsLease.blocking, true);
    assert.equal(wsLease.excluded, false);
  });

  it('6. valid expired does not block; active does', () => {
    const row = {
      _id: new mongoose.Types.ObjectId(),
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_a',
      leaseId: 'lease_a',
      expiresAt: EXPIRES_PAST
    };
    const expired = classifyCheckoutClaimVisibility(row, { now: NOW });
    assert.equal(expired.classification, CLASSIFICATION.EXPIRED);
    assert.equal(expired.blocking, false);

    const live = classifyCheckoutClaimVisibility({ ...row, expiresAt: EXPIRES_LIVE }, { now: NOW });
    assert.equal(live.classification, CLASSIFICATION.ACTIVE);
    assert.equal(live.blocking, true);
  });

  it('11-16. exclusion requires exact checkout+lease pair; malformed never excluded', async () => {
    await insertUnitCheckoutClaim({
      unitId: unitIds[0],
      checkoutId: 'co_own',
      leaseId: 'lease_own'
    });
    const exact = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeCheckoutId: 'co_own',
      excludeLeaseId: 'lease_own'
    });
    assert.equal(exact.length, 0);

    const coOnly = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeCheckoutId: 'co_own'
    });
    assert.equal(coOnly.length, 1);

    const leaseOnly = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeLeaseId: 'lease_own'
    });
    assert.equal(leaseOnly.length, 1);

    const otherLease = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeCheckoutId: 'co_own',
      excludeLeaseId: 'lease_other'
    });
    assert.equal(otherLease.length, 1);

    const foreign = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeCheckoutId: 'co_foreign',
      excludeLeaseId: 'lease_foreign'
    });
    assert.equal(foreign.length, 1);

    await UnitNightClaim.deleteMany({});
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_own',
      leaseId: '',
      expiresAt: EXPIRES_LIVE,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    const malformedOwn = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW,
      excludeCheckoutId: 'co_own',
      excludeLeaseId: 'lease_anything'
    });
    assert.equal(malformedOwn.length, 1);
    assert.equal(malformedOwn[0].classification, CLASSIFICATION.MALFORMED);
  });
});

describe('B8F1B public availability', () => {
  it('1-3. active Unit claim blocks that Unit; sibling available; all claimed unavailable', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0] });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[1], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      true
    );

    await insertUnitCheckoutClaim({
      unitId: unitIds[1],
      checkoutId: 'co_u1',
      leaseId: 'lease_u1'
    });
    await insertUnitCheckoutClaim({
      unitId: unitIds[2],
      checkoutId: 'co_u2',
      leaseId: 'lease_u2'
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[1], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[2], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );
  });

  it('4-5. Luxury and Stone cabin claims are resource-scoped', async () => {
    const lux = await Cabin.findById(luxCabinId);
    const stone = await Cabin.findById(stoneCabinId);
    await insertCabinCheckoutClaim({ cabinId: luxCabinId, checkoutId: 'co_lux', leaseId: 'lease_lux' });
    assert.equal(
      await isSingleCabinGuestStayAvailable(lux, STAY_IN, STAY_OUT, availOpts),
      false
    );
    assert.equal(
      await isSingleCabinGuestStayAvailable(stone, STAY_IN, STAY_OUT, availOpts),
      true
    );

    await insertCabinCheckoutClaim({
      cabinId: stoneCabinId,
      checkoutId: 'co_stone',
      leaseId: 'lease_stone'
    });
    assert.equal(
      await isSingleCabinGuestStayAvailable(stone, STAY_IN, STAY_OUT, availOpts),
      false
    );
  });

  it('6. expired claim does not block public availability', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0], expiresAt: EXPIRES_PAST });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      true
    );
  });

  it('7-10. malformed claims block fail-closed on public availability', async () => {
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: null,
      leaseId: 'lease_x',
      expiresAt: EXPIRES_LIVE,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );

    await UnitNightClaim.deleteMany({});
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_x',
      leaseId: null,
      expiresAt: EXPIRES_LIVE,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );

    await UnitNightClaim.deleteMany({});
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_x',
      leaseId: 'lease_x',
      expiresAt: null,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );

    await UnitNightClaim.deleteMany({});
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_x',
      leaseId: 'lease_x',
      expiresAt: 'bogus',
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      false
    );
  });

  it('12. exact pair excludes own live claim from public availability', async () => {
    await insertUnitCheckoutClaim({
      unitId: unitIds[0],
      checkoutId: 'co_self',
      leaseId: 'lease_self'
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, {
        ...availOpts,
        excludeCheckoutId: 'co_self',
        excludeLeaseId: 'lease_self',
        skipCommercialCapacity: true
      }),
      true
    );
  });

  it('17. booking-owned claim is not a checkout-lease conflict but blocks guest availability', async () => {
    await UnitNightClaim.create({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'booking',
      bookingId: new mongoose.Types.ObjectId(),
      source: 'finalize'
    });
    const blocking = await listBlockingUnitCheckoutClaims({
      unitId: unitIds[0],
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    assert.equal(blocking.length, 0);
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, {
        ...availOpts,
        skipCommercialCapacity: true
      }),
      false
    );
  });

  it('17b. booking-owned cabin claim is not a checkout conflict but blocks guest availability', async () => {
    await CabinNightClaim.create({
      cabinId: luxCabinId,
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'booking',
      bookingId: new mongoose.Types.ObjectId(),
      source: 'finalize'
    });
    const blocking = await listBlockingCabinCheckoutClaims({
      cabinId: luxCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    assert.equal(blocking.length, 0);
    const lux = await Cabin.findById(luxCabinId).lean();
    assert.equal(await isSingleCabinGuestStayAvailable(lux, STAY_IN, STAY_OUT, availOpts), false);
  });

  it('18-19. half-open adjacent available; partial multi-night overlap blocks', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0], night: STAY_IN });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, ADJACENT_IN, ADJACENT_OUT, null, availOpts),
      true
    );
    // Stay Oct 10–14 occupies nights 10,11,12; claim only on mid night still blocks.
    await insertUnitCheckoutClaim({
      unitId: unitIds[0],
      night: STAY_MID,
      checkoutId: 'co_mid',
      leaseId: 'lease_mid'
    });
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, LONG_OUT, null, availOpts),
      false
    );
  });

  it('36. no checkout claims preserves baseline availability', async () => {
    assert.equal(
      await isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
      true
    );
    const lux = await Cabin.findById(luxCabinId);
    assert.equal(await isSingleCabinGuestStayAvailable(lux, STAY_IN, STAY_OUT, availOpts), true);
  });

  it('37. visibility database failure is not interpreted as available', async () => {
    const original = UnitNightClaim.find;
    UnitNightClaim.find = () => {
      throw new Error('forced visibility db failure');
    };
    try {
      await assert.rejects(
        () =>
          isUnitGuestStayAvailable(unitIds[0], cabinTypeId, STAY_IN, STAY_OUT, null, availOpts),
        (err) => /forced visibility db failure/.test(String(err.message))
      );
    } finally {
      UnitNightClaim.find = original;
    }
  });

  it('35. public routes do not accept or forward exclusion fields', () => {
    const routesPath = path.join(__dirname, '../routes/availabilityRoutes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    assert.equal(src.includes('excludeCheckoutId'), false);
    assert.equal(src.includes('excludeLeaseId'), false);
    const opsPath = path.join(__dirname, '../routes/ops/modules/availabilityActionsRoutes.js');
    const opsSrc = fs.readFileSync(opsPath, 'utf8');
    assert.equal(opsSrc.includes('excludeCheckoutId'), false);
    assert.equal(opsSrc.includes('excludeLeaseId'), false);
  });
});

describe('B8F1B commercial capacity', () => {
  it('20-22. capacity decreases by distinct claimed units; no double-subtract; baseline preserved', async () => {
    const baseline = await evaluateCabinTypeCommercialCapacity({
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      now: NOW
    });
    assert.equal(baseline.totalUnits, 3);
    assert.equal(baseline.commerciallyAvailableSlots, 3);
    assert.equal(baseline.freePhysicalUnitIds.length, 3);

    await insertUnitCheckoutClaim({ unitId: unitIds[0], night: STAY_IN });
    await insertUnitCheckoutClaim({
      unitId: unitIds[0],
      night: STAY_MID,
      checkoutId: 'co_u0b',
      leaseId: 'lease_u0b'
    });
    const afterOne = await evaluateCabinTypeCommercialCapacity({
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      now: NOW
    });
    assert.equal(afterOne.commerciallyAvailableSlots, 2);
    assert.equal(afterOne.freePhysicalUnitIds.includes(String(unitIds[0])), false);

    await Booking.create({
      cabinTypeId,
      unitId: unitIds[0],
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        phone: '+359800000000'
      },
      totalPrice: 200,
      checkIn: nightDateFromDateOnly(STAY_IN),
      checkOut: nightDateFromDateOnly(STAY_OUT)
    });
    const withBooking = await evaluateCabinTypeCommercialCapacity({
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      now: NOW
    });
    assert.equal(withBooking.commerciallyAvailableSlots, 2);
    assert.equal(withBooking.allocatedUnitIds.filter((id) => id === String(unitIds[0])).length, 1);
  });
});

describe('B8F1B OPS conflicts and writes', () => {
  it('23-25. unit / parent / single-cabin conflict resource mapping', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0], checkoutId: 'co_u0', leaseId: 'lease_u0' });
    await insertUnitCheckoutClaim({ unitId: unitIds[1], checkoutId: 'co_u1', leaseId: 'lease_u1' });

    const unitOnly = await evaluateTargetConflicts({
      cabinId: parentCabinId,
      unitId: unitIds[0],
      cabinTypeId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    const unitClaimKinds = unitOnly.hardConflicts.filter((c) =>
      ['checkout_night_claim', 'malformed_checkout_claim'].includes(c.kind)
    );
    assert.ok(unitClaimKinds.every((c) => c.unitId === String(unitIds[0])));
    assert.ok(unitClaimKinds.length >= 1);

    const parentWide = await evaluateCabinConflicts({
      cabinId: parentCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    const parentUnits = new Set(
      parentWide.hardConflicts
        .filter((c) => c.kind === 'checkout_night_claim')
        .map((c) => c.unitId)
    );
    assert.ok(parentUnits.has(String(unitIds[0])));
    assert.ok(parentUnits.has(String(unitIds[1])));

    await insertCabinCheckoutClaim({ cabinId: luxCabinId });
    const cabinConflict = await evaluateCabinConflicts({
      cabinId: luxCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    assert.ok(
      cabinConflict.hardConflicts.some(
        (c) => c.kind === 'checkout_night_claim' && c.cabinId === String(luxCabinId)
      )
    );
  });

  it('26. location conflict reads include Unit and Cabin claims', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0], checkoutId: 'co_loc_u', leaseId: 'lease_loc_u' });
    await insertCabinCheckoutClaim({
      cabinId: luxCabinId,
      checkoutId: 'co_loc_c',
      leaseId: 'lease_loc_c'
    });
    const evaluation = await evaluateLocationConflicts('valley', STAY_IN, STAY_OUT);
    assert.equal(evaluation.canBlock, false);

    const claimConflicts = evaluation.conflicts.flatMap((t) =>
      (t.hardConflicts || []).filter((c) =>
        ['checkout_night_claim', 'malformed_checkout_claim'].includes(c.kind)
      )
    );
    const unitClaim = claimConflicts.find((c) => c.unitId === String(unitIds[0]));
    const cabinClaim = claimConflicts.find((c) => c.cabinId === String(luxCabinId));
    assert.ok(unitClaim, 'location result must include Unit checkout conflict');
    assert.equal(unitClaim.kind, 'checkout_night_claim');
    assert.equal(unitClaim.cabinId, null);
    assert.ok(cabinClaim, 'location result must include Cabin checkout conflict');
    assert.equal(cabinClaim.kind, 'checkout_night_claim');
    assert.equal(cabinClaim.unitId, null);
    assert.notEqual(unitClaim.unitId, cabinClaim.cabinId);
  });

  it('mis-tagged single Cabin with stale type ref still uses CabinNightClaim', async () => {
    // Stale A-frame type ref on a canonically single Luxury Cabin.
    await Cabin.findByIdAndUpdate(luxCabinId, {
      $set: { cabinTypeRef: cabinTypeId },
      $unset: { cabinTypeId: 1, inventoryType: 1 }
    });
    const lux = await Cabin.findById(luxCabinId).lean();
    assert.notEqual(lux.inventoryType, 'multi');
    assert.ok(lux.cabinTypeRef);

    await insertCabinCheckoutClaim({
      cabinId: luxCabinId,
      checkoutId: 'co_mistag',
      leaseId: 'lease_mistag'
    });
    await insertUnitCheckoutClaim({
      unitId: unitIds[0],
      checkoutId: 'co_unrelated_u',
      leaseId: 'lease_unrelated_u'
    });

    const conflict = await evaluateCabinConflicts({
      cabinId: luxCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    const checkoutHard = conflict.hardConflicts.filter((c) =>
      ['checkout_night_claim', 'malformed_checkout_claim'].includes(c.kind)
    );
    assert.equal(checkoutHard.length, 1);
    assert.equal(checkoutHard[0].kind, 'checkout_night_claim');
    assert.equal(checkoutHard[0].cabinId, String(luxCabinId));
    assert.equal(checkoutHard[0].unitId, null);
    assert.ok(!checkoutHard.some((c) => c.unitId === String(unitIds[0])));

    const before = await AvailabilityBlock.countDocuments();
    await assert.rejects(
      () =>
        createBlock({
          blockType: 'manual_block',
          cabinId: luxCabinId,
          startDate: STAY_IN,
          endDate: STAY_OUT,
          ctx: opsCtx()
        }),
      (err) => err.type === 'conflict' && err.status === 409
    );
    assert.equal(await AvailabilityBlock.countDocuments(), before);
  });

  it('cabinTypeRef-only multi parent expands to child UnitNightClaim', async () => {
    await Cabin.findByIdAndUpdate(parentCabinId, {
      $set: { inventoryType: 'multi', cabinTypeRef: cabinTypeId },
      $unset: { cabinTypeId: 1 }
    });
    const parent = await Cabin.findById(parentCabinId).lean();
    assert.equal(parent.inventoryType, 'multi');
    assert.equal(parent.cabinTypeId, undefined);
    assert.ok(parent.cabinTypeRef);

    await insertUnitCheckoutClaim({
      unitId: unitIds[1],
      checkoutId: 'co_ref_u',
      leaseId: 'lease_ref_u'
    });

    const parentWide = await evaluateCabinConflicts({
      cabinId: parentCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    const unitClaims = parentWide.hardConflicts.filter(
      (c) => c.kind === 'checkout_night_claim' && c.unitId === String(unitIds[1])
    );
    assert.ok(unitClaims.length >= 1);
    assert.equal(unitClaims[0].unitId, String(unitIds[1]));
    assert.equal(unitClaims[0].cabinId, null);

    const before = await AvailabilityBlock.countDocuments();
    await assert.rejects(
      () =>
        createBlock({
          blockType: 'manual_block',
          cabinId: parentCabinId,
          unitId: null,
          startDate: STAY_IN,
          endDate: STAY_OUT,
          ctx: opsCtx()
        }),
      (err) => err.type === 'conflict' && err.status === 409
    );
    assert.equal(await AvailabilityBlock.countDocuments(), before);
  });

  it('27-29. OPS create rejects active/malformed claims with 409 and writes no block', async () => {
    await insertUnitCheckoutClaim({ unitId: unitIds[0] });
    const before = await AvailabilityBlock.countDocuments();
    await assert.rejects(
      () =>
        createBlock({
          blockType: 'manual_block',
          cabinId: parentCabinId,
          unitId: unitIds[0],
          startDate: STAY_IN,
          endDate: STAY_OUT,
          ctx: opsCtx()
        }),
      (err) => err.type === 'conflict' && err.status === 409
    );
    assert.equal(await AvailabilityBlock.countDocuments(), before);

    await UnitNightClaim.deleteMany({});
    await UnitNightClaim.collection.insertOne({
      unitId: unitIds[0],
      night: nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      checkoutId: 'co_bad',
      leaseId: 'lease_bad',
      expiresAt: null,
      source: 'checkout_lease',
      bookingId: null,
      createdAt: new Date()
    });
    await assert.rejects(
      () =>
        createBlock({
          blockType: 'manual_block',
          cabinId: parentCabinId,
          unitId: unitIds[0],
          startDate: STAY_IN,
          endDate: STAY_OUT,
          ctx: opsCtx()
        }),
      (err) =>
        err.type === 'conflict' &&
        err.status === 409 &&
        (err.details.hardConflicts || []).some((c) => c.kind === 'malformed_checkout_claim')
    );
    assert.equal(await AvailabilityBlock.countDocuments(), before);
    assert.equal(await UnitNightClaim.countDocuments({ unitId: unitIds[0] }), 1);
  });

  it('30-32. OPS edit checks proposed dates; rejected edit preserves block and claims', async () => {
    const created = await createBlock({
      blockType: 'manual_block',
      cabinId: luxCabinId,
      startDate: '2026-11-01',
      endDate: '2026-11-03',
      ctx: opsCtx()
    });
    const original = await AvailabilityBlock.findById(created.blockId).lean();

    await insertCabinCheckoutClaim({
      cabinId: luxCabinId,
      night: STAY_IN,
      checkoutId: 'co_edit',
      leaseId: 'lease_edit'
    });
    const claimCount = await CabinNightClaim.countDocuments({ cabinId: luxCabinId });

    await assert.rejects(
      () =>
        editBlock({
          blockId: created.blockId,
          startDate: STAY_IN,
          endDate: STAY_OUT,
          ctx: opsCtx('POST /api/ops/availability/manual-blocks/:id/edit')
        }),
      (err) => err.type === 'conflict' && err.status === 409
    );

    const after = await AvailabilityBlock.findById(created.blockId).lean();
    assert.equal(String(after.startDate), String(original.startDate));
    assert.equal(String(after.endDate), String(original.endDate));
    assert.equal(await CabinNightClaim.countDocuments({ cabinId: luxCabinId }), claimCount);
  });

  it('33-34. existing Booking and AvailabilityBlock conflicts remain present', async () => {
    await Booking.create({
      cabinId: luxCabinId,
      adults: 2,
      children: 0,
      status: 'confirmed',
      guestInfo: {
        firstName: 'A',
        lastName: 'B',
        email: 'b@example.com',
        phone: '+359800000001'
      },
      totalPrice: 200,
      checkIn: nightDateFromDateOnly(STAY_IN),
      checkOut: nightDateFromDateOnly(STAY_OUT)
    });
    const withBooking = await evaluateCabinConflicts({
      cabinId: luxCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    assert.ok(withBooking.hardConflicts.some((c) => c.kind === 'reservation'));

    await AvailabilityBlock.create({
      cabinId: stoneCabinId,
      unitId: null,
      blockType: 'manual_block',
      startDate: nightDateFromDateOnly(STAY_IN),
      endDate: nightDateFromDateOnly(STAY_OUT),
      source: 'internal_admin',
      status: 'active'
    });
    const withBlock = await evaluateCabinConflicts({
      cabinId: stoneCabinId,
      startDate: STAY_IN,
      endDate: STAY_OUT,
      now: NOW
    });
    assert.ok(withBlock.hardConflicts.some((c) => c.kind === 'availability_block'));
  });
});
