/**
 * B8F2A2 — Inert checkout resource-bundle orchestrator (MongoMemoryServer).
 * Real fence / accommodation / facility services for core transitions.
 * No routes, PI, voucher, Booking, webhook, worker, finalization, or frontend wiring.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const CheckoutResourceAttempt = require('../models/CheckoutResourceAttempt');
const FacilityReservation = require('../models/FacilityReservation');
const AccommodationCheckoutLease = require('../models/AccommodationCheckoutLease');
const UnitNightClaim = require('../models/UnitNightClaim');
const CabinNightClaim = require('../models/CabinNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const CabinType = require('../models/CabinType');

const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  ensureCheckoutResourceAttemptIndexesForTests,
  findLiveFence
} = require('../services/checkout/checkoutResourceAttemptFenceService');
const {
  ensureLeaseIndexesForTests,
  getActiveAccommodationCheckoutHold,
  releaseAccommodationCheckoutHold
} = require('../services/checkout/accommodationCheckoutHoldService');
const {
  ensureFacilityReservationUniqueIndexForTests,
  DEFAULT_FACILITY_HOLD_TTL_MS,
  acquireFacilityHold,
  listCurrentAttemptMarkedHoldIds
} = require('../services/facilityBookingService');
const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');

const {
  DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS,
  CheckoutResourceBundleError,
  prepareCheckoutResourceBundle
} = require('../services/checkout/resourceAttemptOrchestrator');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const DAY = '2027-01-15';
const WIN_START = `${DAY}T10:00:00.000Z`;
const WIN_END = `${DAY}T22:00:00.000Z`;

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let seq = 0;
let frozenNow = new Date('2026-09-06T12:00:00.000Z');

function clock() {
  return new Date(frozenNow.getTime());
}

function advanceMs(ms) {
  frozenNow = new Date(frozenNow.getTime() + ms);
}

function checkoutId(label = 'co') {
  seq += 1;
  return `co_b8f2a2_${label}_${seq}_${crypto.randomBytes(3).toString('hex')}`;
}

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
const FACILITIES = { 'sauna-1': SAUNA, 'hot-tub-1': TUB1 };

function slot(startHour, durationMinutes = 120) {
  const start = new Date(`${DAY}T${String(startHour).padStart(2, '0')}:00:00.000Z`);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    slotStart: start.toISOString(),
    startTime: start.toISOString(),
    endTime: end.toISOString()
  };
}

function facilitySel(facilityCode, startHour) {
  const pack = facilityCode === 'sauna-1' ? saunaPack() : hotTubPack();
  const s = slot(startHour);
  return {
    facilityCode,
    facilityName: FACILITIES[facilityCode].name,
    selfLed: true,
    ...s,
    addOn: {
      code: pack.code,
      version: pack.version,
      publicName: pack.publicName,
      currency: pack.currency,
      amount: pack.amount,
      chargeUnit: pack.chargeUnit,
      includedItems: pack.includedItems
    }
  };
}

function baseSnapshot(overrides = {}) {
  const entityType = overrides.entityType || 'cabinType';
  const snap = {
    schemaVersion: 1,
    entityType,
    cabinId: entityType === 'cabin' ? String(luxCabinId) : null,
    cabinTypeId: entityType === 'cabinType' ? String(cabinTypeId) : null,
    checkInDateOnly: STAY_IN,
    checkOutDateOnly: STAY_OUT,
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    subtotalCents: 20000,
    discountAmountCents: 0,
    totalValueCents: 20000,
    voucherAppliedCents: 0,
    stripeAmountCents: 20000,
    fullVoucherCoverage: false,
    currency: 'EUR',
    ...overrides
  };
  if (overrides.facilitySelections === undefined) {
    delete snap.facilitySelections;
  }
  return snap;
}

async function createSession({
  id,
  snapshot,
  status = 'quoted',
  paymentStatus = 'unpaid',
  finalizeStatus = 'open',
  expiresAt = null,
  canonicalPaymentIntentId = null,
  voucherRedemptionId = null,
  giftVoucherAppliedCents = 0,
  extra = {}
}) {
  const quoteSnapshot = snapshot || baseSnapshot();
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const exp =
    expiresAt === undefined
      ? null
      : expiresAt != null
        ? expiresAt
        : new Date(frozenNow.getTime() + 48 * 60 * 60 * 1000);
  return CheckoutSession.create({
    checkoutId: id,
    status,
    paymentStatus,
    finalizeStatus,
    quoteSnapshot,
    quoteSnapshotHash,
    expiresAt: exp,
    canonicalPaymentIntentId,
    voucherRedemptionId,
    giftVoucherAppliedCents,
    ...extra
  });
}

function depsBase(extra = {}) {
  return {
    clock,
    now: clock(),
    CheckoutSession,
    CheckoutResourceAttempt,
    FacilityReservation,
    AccommodationCheckoutLease,
    loadFacilityByCode: async (code) => FACILITIES[code] || null,
    loadAddOnByCodeVersion: async (code, version) => ADDONS[`${code}@${version}`] || null,
    loadExclusiveFixedPackages: async () => [],
    candidateSoftAvailable: async () => true,
    holdTtlMs: DEFAULT_FACILITY_HOLD_TTL_MS,
    ...extra
  };
}

async function seedInventory({ units = 5 } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `B8F2A2 CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f2a2',
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
}

async function ensureIndexes() {
  await unitClaims.ensureAuthoritativeUniqueIndexForTests();
  await unitClaims.ensureCheckoutLookupIndexesForTests();
  await cabinClaims.ensureAuthoritativeUniqueIndexForTests();
  await cabinClaims.ensureCheckoutLookupIndexesForTests();
  await ensureLeaseIndexesForTests();
  await ensureCheckoutResourceAttemptIndexesForTests();
  await ensureFacilityReservationUniqueIndexForTests();
}

function assertRejectsCode(promise, code) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.name, 'CheckoutResourceBundleError');
    assert.equal(err.code, code);
    return true;
  });
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
  frozenNow = new Date('2026-09-06T12:00:00.000Z');
  await Promise.all([
    CheckoutSession.deleteMany({}),
    CheckoutResourceAttempt.deleteMany({}),
    FacilityReservation.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AccommodationCheckoutLease.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    Booking.deleteMany({})
  ]);
});

describe('B8F2A2 exports and inertness', () => {
  it('61. exports and no production wiring imports in new files', () => {
    assert.equal(typeof prepareCheckoutResourceBundle, 'function');
    assert.equal(typeof CheckoutResourceBundleError, 'function');
    assert.equal(DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS, 60_000);
    const orch = fs.readFileSync(
      path.join(__dirname, '../services/checkout/resourceAttemptOrchestrator.js'),
      'utf8'
    );
    const testSrc = fs.readFileSync(__filename, 'utf8');
    for (const banned of [
      'ensureCanonicalPaymentIntent',
      'createPaymentIntent',
      'stripe',
      'finalizePaidCheckout',
      'webhook',
      'express.Router',
      'completeFencedFacilityAcquisition'
    ]) {
      assert.equal(orch.includes(banned), false, `orchestrator must not reference ${banned}`);
    }
    assert.equal(orch.includes('Booking.create'), false);
    void testSrc;
  });
});

describe('B8F2A2 happy paths', () => {
  it('1. Normal CabinType accommodation only', async () => {
    const id = checkoutId('ct');
    await createSession({ id, snapshot: baseSnapshot({ entityType: 'cabinType' }) });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.resourceBundleReady, true);
    assert.equal(bundle.bookingContext, 'normal');
    assert.equal(bundle.accommodation.entityType, 'unit');
    assert.ok(bundle.accommodation.unitId);
    assert.equal(bundle.facilities.length, 0);
    assert.ok(bundle.bundleValidUntil instanceof Date);
    assert.equal(typeof bundle.accommodation.expiresAt, 'string');
    assert.ok(!('voucherReserved' in bundle));
    assert.ok(!('paymentAttemptCreated' in bundle));
    const live = await findLiveFence(id, depsBase());
    assert.equal(live, null);
  });

  it('2. Normal single Cabin accommodation only', async () => {
    const id = checkoutId('cabin');
    await createSession({
      id,
      snapshot: baseSnapshot({ entityType: 'cabin', cabinId: String(luxCabinId), cabinTypeId: null })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.accommodation.entityType, 'cabin');
    assert.equal(String(bundle.accommodation.cabinId), String(luxCabinId));
    assert.equal(bundle.accommodation.unitId, null);
  });

  it('3. Accommodation plus one facility', async () => {
    const id = checkoutId('fac1');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.facilities.length, 1);
    assert.equal(bundle.facilities[0].facilityCode, 'sauna-1');
    assert.equal(typeof bundle.facilities[0].holdExpiresAt, 'string');
    assert.ok(!('price' in bundle.facilities[0]));
    assert.ok(!('capacityLane' in bundle.facilities[0]));
  });

  it('4. Multiple facilities', async () => {
    const id = checkoutId('facn');
    await createSession({
      id,
      snapshot: baseSnapshot({
        facilitySelections: [facilitySel('sauna-1', 10), facilitySel('hot-tub-1', 12)]
      })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.facilities.length, 2);
  });

  it('5. Seasonal mapping', async () => {
    const id = checkoutId('season');
    await createSession({
      id,
      snapshot: baseSnapshot({
        ratePlan: {
          code: 'winter-valley',
          version: 1,
          type: 'seasonal_stay',
          currency: 'EUR'
        }
      })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.bookingContext, 'seasonal');
  });

  it('6. Fixed-package mapping and live ownership', async () => {
    const id = checkoutId('fp');
    const accommodationKey = 'a-frame';
    const { validateAndNormalizeRatePlan } = require('../services/ratePlanService');
    const plan = validateAndNormalizeRatePlan({
      code: 'parent-child',
      internalName: 'Parent Child',
      version: 1,
      status: 'active',
      type: 'fixed_package',
      currency: 'EUR',
      packageArrivalDate: STAY_IN,
      packageDepartureDate: STAY_OUT,
      minNights: 2,
      inventoryMode: 'exclusive',
      requiresFullPayment: true,
      cancellationPolicyCode: 'parent-child-package',
      cancellationPolicyVersion: 1,
      inclusions: ['programme'],
      accommodations: [
        {
          accommodationKey,
          entityType: 'cabinType',
          pricingMethod: 'fixed_per_unit',
          fixedPerUnitAmount: 420
        }
      ]
    }).value;
    await createSession({
      id,
      snapshot: baseSnapshot({
        bookingType: 'fixed_package',
        ratePlan: {
          code: 'parent-child',
          version: 1,
          type: 'fixed_package',
          currency: 'EUR'
        },
        packageSnapshot: {
          ratePlanCode: 'parent-child',
          ratePlanVersion: 1,
          ratePlanType: 'fixed_package',
          currency: 'EUR',
          arrivalDate: STAY_IN,
          departureDate: STAY_OUT,
          accommodationKey,
          pricingMethod: 'fixed_per_unit',
          inventoryMode: 'exclusive',
          requiresFullPayment: true,
          cancellationPolicyCode: 'parent-child-package',
          cancellationPolicyVersion: 1,
          inclusions: ['programme'],
          participants: [],
          counts: { adults: 2, children: 0, infants: 0, total: 2 },
          capacityUsed: 2,
          capacityMaximum: 4,
          pricingBreakdown: null,
          totalBeforePaymentCredits: 420
        }
      })
    });
    const bundle = await prepareCheckoutResourceBundle(
      { checkoutId: id },
      depsBase({
        loadExclusiveFixedPackages: async () => [plan]
      })
    );
    assert.equal(bundle.bookingContext, 'fixed_package');
  });

  it('10. Exact entity and date mapping', async () => {
    const id = checkoutId('map');
    await createSession({
      id,
      snapshot: baseSnapshot({
        entityType: 'cabin',
        cabinId: String(luxCabinId),
        cabinTypeId: null,
        checkInDateOnly: STAY_IN,
        checkOutDateOnly: STAY_OUT
      })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.accommodation.checkIn, STAY_IN);
    assert.equal(bundle.accommodation.checkOut, STAY_OUT);
    assert.equal(String(bundle.accommodation.cabinId), String(luxCabinId));
  });

  it('45+46. Retry reuses sealed accommodation and facilities', async () => {
    const id = checkoutId('retry');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    const first = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    const second = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(second.accommodation.leaseId, first.accommodation.leaseId);
    assert.ok(['renewed', 'reused'].includes(second.accommodation.outcome));
    assert.equal(second.facilities[0].holdId, first.facilities[0].holdId);
    assert.ok(['renewed', 'reused'].includes(second.facilities[0].outcome));
  });

  it('44. Existing later expiries not shortened', async () => {
    const id = checkoutId('later');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    const first = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    const later = new Date(new Date(first.facilities[0].holdExpiresAt).getTime() + 60 * 60 * 1000);
    await FacilityReservation.updateOne(
      { _id: first.facilities[0].holdId },
      { $set: { holdExpiresAt: later } }
    );
    const leaseLater = new Date(
      new Date(first.accommodation.expiresAt).getTime() + 60 * 60 * 1000
    );
    await AccommodationCheckoutLease.updateOne(
      { leaseId: first.accommodation.leaseId },
      { $set: { expiresAt: leaseLater } }
    );
    const second = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.ok(new Date(second.facilities[0].holdExpiresAt).getTime() >= later.getTime());
    assert.ok(new Date(second.accommodation.expiresAt).getTime() >= leaseLater.getTime());
  });

  it('52. Extra same-owner facility holds preserved', async () => {
    const id = checkoutId('extra');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    // Pre-create an unmarked extra hold for hot-tub owned by same checkout
    await FacilityReservation.create({
      facilityCode: 'hot-tub-1',
      capacityLane: 0,
      slotStart: new Date(`${DAY}T14:00:00.000Z`),
      startTime: new Date(`${DAY}T14:00:00.000Z`),
      endTime: new Date(`${DAY}T16:00:00.000Z`),
      status: 'hold',
      checkoutSessionId: id,
      holdExpiresAt: new Date(frozenNow.getTime() + 60 * 60 * 1000),
      addOnCode: 'hot-tub-firewood-pack',
      addOnVersion: 1,
      acquisitionAttemptId: null,
      priceSnapshot: {
        currency: 'EUR',
        amount: 30,
        chargeUnit: 'per_firing',
        addOnCode: 'hot-tub-firewood-pack',
        addOnVersion: 1
      }
    });
    await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    const extra = await FacilityReservation.findOne({
      checkoutSessionId: id,
      facilityCode: 'hot-tub-1',
      status: 'hold'
    }).lean();
    assert.ok(extra);
  });

  it('58+59. DTO Date/ISO and no voucher/payment/client-price claims', async () => {
    const id = checkoutId('dto');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.ok(bundle.bundleValidUntil instanceof Date);
    assert.match(bundle.accommodation.expiresAt, /Z$/);
    assert.match(bundle.facilities[0].holdExpiresAt, /Z$/);
    assert.match(bundle.facilities[0].startTime, /Z$/);
    const json = JSON.stringify(bundle);
    assert.equal(json.includes('voucherReserved'), false);
    assert.equal(json.includes('paymentAttemptCreated'), false);
    assert.equal(json.includes('clientPrice'), false);
  });

  it('60. No CheckoutSession writes', async () => {
    const id = checkoutId('nowrite');
    await createSession({ id, snapshot: baseSnapshot() });
    const before = await CheckoutSession.findOne({ checkoutId: id }).lean();
    await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    const after = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(String(before.updatedAt), String(after.updatedAt));
    assert.equal(after.quoteSnapshotHash, before.quoteSnapshotHash);
    assert.equal(after.status, before.status);
  });
});

describe('B8F2A2 snapshot classification', () => {
  it('7. Fixed-package mirrored date mismatch', async () => {
    const id = checkoutId('fpdate');
    await createSession({
      id,
      snapshot: baseSnapshot({
        bookingType: 'fixed_package',
        ratePlan: {
          code: 'parent-child',
          version: 1,
          type: 'fixed_package',
          currency: 'EUR'
        },
        packageSnapshot: {
          ratePlanCode: 'parent-child',
          ratePlanVersion: 1,
          ratePlanType: 'fixed_package',
          currency: 'EUR',
          arrivalDate: '2026-11-01',
          departureDate: STAY_OUT,
          accommodationKey: `cabinType:${cabinTypeId}`,
          pricingMethod: 'fixed_per_participant',
          inventoryMode: 'exclusive',
          requiresFullPayment: true,
          cancellationPolicyCode: 'flex',
          cancellationPolicyVersion: 1,
          inclusions: [],
          participants: [],
          counts: { adults: 2, children: 0, infants: 0, total: 2 },
          capacityUsed: 2,
          capacityMaximum: 4,
          pricingBreakdown: null,
          totalBeforePaymentCredits: 200
        }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
  });

  it('8. Conflicting package-type signals', async () => {
    const id = checkoutId('conflict');
    await createSession({
      id,
      snapshot: baseSnapshot({
        bookingType: 'fixed_package',
        ratePlan: {
          code: 'winter-valley',
          version: 1,
          type: 'seasonal_stay',
          currency: 'EUR'
        }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
  });

  it('9. Partial seasonal/package debris', async () => {
    const id = checkoutId('debris');
    await createSession({
      id,
      snapshot: baseSnapshot({
        ratePlanPricingBreakdown: { accommodationKey: 'x', nights: 2 }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
  });

  it('9b. Empty ratePlan object cannot fall through to normal', async () => {
    const id = checkoutId('rp_empty');
    const snap = baseSnapshot();
    await CheckoutSession.create({
      checkoutId: id,
      status: 'quoted',
      paymentStatus: 'unpaid',
      finalizeStatus: 'open',
      quoteSnapshot: snap,
      quoteSnapshotHash: hashQuoteSnapshot(snap),
      expiresAt: new Date(frozenNow.getTime() + 48 * 60 * 60 * 1000)
    });
    // Force a persistent empty ratePlan bag (Mongo Mixed can drop bare {} on create).
    await CheckoutSession.collection.updateOne(
      { checkoutId: id },
      { $set: { 'quoteSnapshot.ratePlan': {} } }
    );
    const lean = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.ok(lean.quoteSnapshot.ratePlan);
    assert.equal(Object.keys(lean.quoteSnapshot.ratePlan).length, 0);
    await CheckoutSession.updateOne(
      { checkoutId: id },
      { $set: { quoteSnapshotHash: hashQuoteSnapshot(lean.quoteSnapshot) } }
    );
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
    assert.equal(await AccommodationCheckoutLease.countDocuments({}), 0);
  });

  it('9c. ratePlan missing type rejected', async () => {
    const id = checkoutId('rp_notype');
    await createSession({
      id,
      snapshot: baseSnapshot({
        ratePlan: { code: 'x', version: 1, currency: 'EUR' }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
  });

  it('9d. Unknown ratePlan type rejected', async () => {
    const id = checkoutId('rp_unk');
    await createSession({
      id,
      snapshot: baseSnapshot({
        ratePlan: { code: 'x', version: 1, type: 'nightly', currency: 'EUR' }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
  });

  it('9e. Seasonal type with missing code rejected before fence', async () => {
    const id = checkoutId('rp_inc');
    await createSession({
      id,
      snapshot: baseSnapshot({
        ratePlan: { version: 1, type: 'seasonal_stay', currency: 'EUR' }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
  });

  it('9f. Same-day stay rejected before fence', async () => {
    const id = checkoutId('sameday');
    await createSession({
      id,
      snapshot: baseSnapshot({
        checkInDateOnly: STAY_IN,
        checkOutDateOnly: STAY_IN
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
    assert.equal(await AccommodationCheckoutLease.countDocuments({}), 0);
    assert.equal(await FacilityReservation.countDocuments({}), 0);
    assert.equal(await UnitNightClaim.countDocuments({}), 0);
    assert.equal(await CabinNightClaim.countDocuments({}), 0);
  });

  it('9g. Inverted stay rejected before fence', async () => {
    const id = checkoutId('invert');
    await createSession({
      id,
      snapshot: baseSnapshot({
        checkInDateOnly: STAY_OUT,
        checkOutDateOnly: STAY_IN
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_SNAPSHOT_INTEGRITY'
    );
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
    assert.equal(await AccommodationCheckoutLease.countDocuments({}), 0);
    assert.equal(await FacilityReservation.countDocuments({}), 0);
  });
});

describe('B8F2A2 validation matrix', () => {
  it('11. Duplicate facility selections before writes', async () => {
    const id = checkoutId('dup');
    await createSession({
      id,
      snapshot: baseSnapshot({
        facilitySelections: [facilitySel('sauna-1', 10), facilitySel('sauna-1', 10)]
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'DUPLICATE_FACILITY_SELECTION'
    );
    assert.equal(await AccommodationCheckoutLease.countDocuments({}), 0);
    assert.equal(await CheckoutResourceAttempt.countDocuments({}), 0);
  });

  it('12. Missing/malformed snapshot', async () => {
    const id = checkoutId('nosnap');
    await CheckoutSession.create({
      checkoutId: id,
      status: 'quoted',
      quoteSnapshot: null,
      quoteSnapshotHash: 'a'.repeat(64),
      expiresAt: new Date(frozenNow.getTime() + 3600000)
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'SNAPSHOT_MISSING'
    );
  });

  it('13. Missing/malformed/recomputed hash mismatch', async () => {
    const id = checkoutId('hash');
    const snap = baseSnapshot();
    await CheckoutSession.create({
      checkoutId: id,
      status: 'quoted',
      quoteSnapshot: snap,
      quoteSnapshotHash: 'b'.repeat(64),
      expiresAt: new Date(frozenNow.getTime() + 3600000)
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'SNAPSHOT_HASH_MISMATCH'
    );
  });

  it('14. Complete allowed session-state matrix', async () => {
    const allowed = [
      ['draft', 'unpaid', 'open'],
      ['quoted', 'unpaid', 'open'],
      ['payment_required', 'unpaid', 'open'],
      ['payment_not_required', 'not_required', 'open']
    ];
    for (const [status, paymentStatus, finalizeStatus] of allowed) {
      const id = checkoutId(`ok_${status}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({ id, status, paymentStatus, finalizeStatus });
      // eslint-disable-next-line no-await-in-loop
      const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
      assert.equal(bundle.resourceBundleReady, true);
    }
  });

  it('15. Every rejected session status', async () => {
    const rejected = [
      'pi_active',
      'voucher_only_reserved',
      'paid',
      'abandoned',
      'expired',
      'needs_review',
      'superseded'
    ];
    for (const status of rejected) {
      const id = checkoutId(`bad_${status}`);
      const extra =
        status === 'voucher_only_reserved'
          ? {}
          : {};
      // eslint-disable-next-line no-await-in-loop
      await createSession({
        id,
        status: status === 'voucher_only_reserved' ? 'quoted' : status,
        ...(status === 'voucher_only_reserved'
          ? { status: 'voucher_only_reserved' }
          : {}),
        ...extra
      });
      // For voucher_only_reserved, voucher error may fire first
      // eslint-disable-next-line no-await-in-loop
      await assert.rejects(() => prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()), (err) => {
        assert.equal(err.name, 'CheckoutResourceBundleError');
        assert.ok(
          err.code === 'CHECKOUT_SESSION_NOT_USABLE' ||
            err.code === 'RESOURCE_BUNDLE_UNSUPPORTED_VOUCHER'
        );
        return true;
      });
    }
  });

  it('16. Rejected payment statuses', async () => {
    for (const paymentStatus of ['processing', 'paid', 'failed']) {
      const id = checkoutId(`pay_${paymentStatus}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({ id, paymentStatus });
      // eslint-disable-next-line no-await-in-loop
      await assertRejectsCode(
        prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
        'CHECKOUT_SESSION_NOT_USABLE'
      );
    }
  });

  it('17. Rejected finalize statuses', async () => {
    for (const finalizeStatus of ['in_progress', 'finalized', 'needs_review']) {
      const id = checkoutId(`fin_${finalizeStatus}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({ id, finalizeStatus });
      // eslint-disable-next-line no-await-in-loop
      await assertRejectsCode(
        prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
        'CHECKOUT_SESSION_NOT_USABLE'
      );
    }
  });

  it('18. Existing canonical PI', async () => {
    const id = checkoutId('pi');
    await createSession({ id, canonicalPaymentIntentId: 'pi_test_12345678' });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_PAYMENT_INTENT_EXISTS'
    );
  });

  it('19. Every voucher indicator', async () => {
    const cases = [
      { snapshot: baseSnapshot({ voucherCode: 'GIFT10' }) },
      { snapshot: baseSnapshot({ voucherAppliedCents: 100 }) },
      { snapshot: baseSnapshot({ fullVoucherCoverage: true }) },
      {
        snapshot: baseSnapshot(),
        voucherRedemptionId: new mongoose.Types.ObjectId()
      },
      { snapshot: baseSnapshot(), giftVoucherAppliedCents: 50 },
      { snapshot: baseSnapshot(), status: 'voucher_only_reserved' }
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      const id = checkoutId(`voucher_${i}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({ id, ...c });
      // eslint-disable-next-line no-await-in-loop
      await assertRejectsCode(
        prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
        'RESOURCE_BUNDLE_UNSUPPORTED_VOUCHER'
      );
    }
  });

  it('20. Invalid session expiry', async () => {
    const id = checkoutId('badexp');
    const snap = baseSnapshot();
    await CheckoutSession.collection.insertOne({
      checkoutId: id,
      flowVersion: 'v2',
      status: 'quoted',
      paymentStatus: 'unpaid',
      finalizeStatus: 'open',
      quoteSnapshot: snap,
      quoteSnapshotHash: hashQuoteSnapshot(snap),
      expiresAt: 'not-a-date',
      giftVoucherAppliedCents: 0,
      stripeAmountCents: 0,
      sessionVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_INVALID_INPUT'
    );
  });

  it('21. Session expiry below 60 seconds', async () => {
    const id = checkoutId('short');
    await createSession({
      id,
      expiresAt: new Date(frozenNow.getTime() + 30_000)
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_LEASE_TOO_SHORT'
    );
  });

  it('22. Exactly 60 seconds accepted', async () => {
    const id = checkoutId('eq60');
    await createSession({
      id,
      expiresAt: new Date(frozenNow.getTime() + 60_000)
    });
    const bundle = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(bundle.resourceBundleReady, true);
    assert.ok(bundle.remainingLeaseMs >= 60_000);
  });
});

describe('B8F2A2 session expiry shortened across phases', () => {
  async function shortenAndExpect(phaseHook) {
    const id = checkoutId(`shorten_${phaseHook}`);
    await createSession({
      id,
      expiresAt: new Date(frozenNow.getTime() + 30 * 60 * 1000)
    });
    const hooks = {};
    hooks[phaseHook] = async () => {
      await CheckoutSession.updateOne(
        { checkoutId: id },
        { $set: { expiresAt: new Date(frozenNow.getTime() + 10_000) } }
      );
    };
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase(hooks)),
      'RESOURCE_BUNDLE_LEASE_TOO_SHORT'
    );
  }

  it('23. Shortened before mutation', async () => {
    await shortenAndExpect('beforeAccommodationAcquire');
  });

  it('24. Shortened after accommodation', async () => {
    await shortenAndExpect('beforeFacilityAcquire');
  });

  it('25. Shortened after facilities', async () => {
    await shortenAndExpect('beforeMarkerClear');
  });

  it('26. Shortened after marker clearing', async () => {
    await shortenAndExpect('beforeFinalSessionCheck');
  });
});

describe('B8F2A2 concurrency', () => {
  it('27. Same-checkout orchestration loser', async () => {
    const id = checkoutId('race');
    await createSession({ id });
    let releaseSecond;
    const gate = new Promise((resolve) => {
      releaseSecond = resolve;
    });
    const p1 = prepareCheckoutResourceBundle(
      { checkoutId: id },
      depsBase({
        beforeAccommodationAcquire: async () => {
          releaseSecond();
          await new Promise((r) => setTimeout(r, 50));
        }
      })
    );
    await gate;
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_IN_PROGRESS'
    );
    const bundle = await p1;
    assert.equal(bundle.resourceBundleReady, true);
  });

  it('28. Different-checkout concurrency', async () => {
    const a = checkoutId('diffa');
    const b = checkoutId('diffb');
    await createSession({ id: a });
    await createSession({ id: b });
    const [ra, rb] = await Promise.all([
      prepareCheckoutResourceBundle({ checkoutId: a }, depsBase()),
      prepareCheckoutResourceBundle({ checkoutId: b }, depsBase())
    ]);
    assert.equal(ra.resourceBundleReady, true);
    assert.equal(rb.resourceBundleReady, true);
  });

  it('29. Foreign accommodation/facility conflict', async () => {
    const owner = checkoutId('owner');
    const foreign = checkoutId('foreign');
    await createSession({
      id: owner,
      snapshot: baseSnapshot({
        entityType: 'cabin',
        cabinId: String(luxCabinId),
        cabinTypeId: null,
        facilitySelections: [facilitySel('sauna-1', 10)]
      })
    });
    await createSession({
      id: foreign,
      snapshot: baseSnapshot({
        entityType: 'cabin',
        cabinId: String(luxCabinId),
        cabinTypeId: null,
        facilitySelections: [facilitySel('sauna-1', 10)]
      })
    });
    await prepareCheckoutResourceBundle({ checkoutId: owner }, depsBase());
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: foreign }, depsBase()),
      'ACCOMMODATION_UNAVAILABLE'
    );
  });
});

describe('B8F2A2 failures and compensation', () => {
  it('30. Accommodation acquisition failure preserves typed NO_ELIGIBLE', async () => {
    const id = checkoutId('accfail');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireAccommodationCheckoutHold: async () => {
            const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
            throw new AccommodationCheckoutHoldError(
              'NO_ELIGIBLE_ACCOMMODATION',
              'none'
            );
          }
        })
      ),
      'NO_ELIGIBLE_ACCOMMODATION'
    );
    const fence = await CheckoutResourceAttempt.findOne({ checkoutId: id }).lean();
    assert.equal(fence.status, 'failed');
    assert.equal(fence.isLive, false);
  });

  it('31+32+33. Real capacity failure after marked hold; compensates exact markers', async () => {
    const id = checkoutId('facfail');
    const foreign = checkoutId('facfail_foreign');
    // Unmarked same-owner leftover that must survive compensation of marked rows
    await FacilityReservation.create({
      facilityCode: 'hot-tub-1',
      capacityLane: 0,
      slotStart: new Date(`${DAY}T16:00:00.000Z`),
      startTime: new Date(`${DAY}T16:00:00.000Z`),
      endTime: new Date(`${DAY}T18:00:00.000Z`),
      status: 'hold',
      checkoutSessionId: id,
      holdExpiresAt: new Date(frozenNow.getTime() + 60 * 60 * 1000),
      addOnCode: 'hot-tub-firewood-pack',
      addOnVersion: 1,
      acquisitionAttemptId: null,
      priceSnapshot: {
        currency: 'EUR',
        amount: 30,
        chargeUnit: 'per_firing',
        addOnCode: 'hot-tub-firewood-pack',
        addOnVersion: 1
      }
    });
    // Foreign capacity on sauna hour 12 — second selection will conflict after first marked acquire
    await acquireFacilityHold(
      {
        facilityCode: 'sauna-1',
        ...{
          slotStart: new Date(`${DAY}T12:00:00.000Z`),
          startTime: new Date(`${DAY}T12:00:00.000Z`),
          endTime: new Date(`${DAY}T14:00:00.000Z`)
        },
        checkoutSessionId: foreign
      },
      {
        now: clock(),
        holdTtlMs: DEFAULT_FACILITY_HOLD_TTL_MS,
        FacilityReservation,
        loadFacilityByCode: async (code) => FACILITIES[code] || null,
        loadAddOnByCodeVersion: async (code, version) =>
          ADDONS[`${code}@${version}`] || null
      }
    );

    await createSession({
      id,
      snapshot: baseSnapshot({
        facilitySelections: [
          facilitySel('hot-tub-1', 10),
          facilitySel('sauna-1', 12)
        ]
      })
    });

    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'FACILITY_UNAVAILABLE'
    );

    const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
    assert.ok(lease);
    assert.equal(lease.status, 'sealed');

    const fence = await CheckoutResourceAttempt.findOne({ checkoutId: id })
      .sort({ generation: -1 })
      .lean();
    assert.equal(fence.status, 'failed');
    assert.equal(fence.isLive, false);

    // Exact attempt markers cleared by production compensation
    const liveFenceAttempt = fence.attemptId;
    assert.equal(
      (await listCurrentAttemptMarkedHoldIds(id, liveFenceAttempt, depsBase())).length,
      0
    );

    // First selection (hot-tub 10:00) cancelled by compensation
    const firstSlot = await FacilityReservation.findOne({
      checkoutSessionId: id,
      facilityCode: 'hot-tub-1',
      slotStart: new Date(`${DAY}T10:00:00.000Z`)
    }).lean();
    assert.ok(!firstSlot || firstSlot.status === 'cancelled');

    // Unmarked same-owner leftover preserved
    const unmarked = await FacilityReservation.findOne({
      checkoutSessionId: id,
      facilityCode: 'hot-tub-1',
      slotStart: new Date(`${DAY}T16:00:00.000Z`),
      status: 'hold'
    }).lean();
    assert.ok(unmarked);
    assert.equal(unmarked.acquisitionAttemptId, null);

    // Foreign row untouched
    const foreignRow = await FacilityReservation.findOne({
      checkoutSessionId: foreign,
      status: 'hold'
    }).lean();
    assert.ok(foreignRow);
  });

  it('34. Snapshot changes before mutation', async () => {
    const id = checkoutId('snap0');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          beforeAccommodationAcquire: async () => {
            const snap = baseSnapshot({ adults: 3 });
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { quoteSnapshot: snap, quoteSnapshotHash: hashQuoteSnapshot(snap) } }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
  });

  it('35. Snapshot changes after accommodation', async () => {
    const id = checkoutId('snap1');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          beforeFacilityAcquire: async () => {
            const snap = baseSnapshot({
              facilitySelections: [facilitySel('sauna-1', 10)],
              adults: 9
            });
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { quoteSnapshot: snap, quoteSnapshotHash: hashQuoteSnapshot(snap) } }
            );
          },
          // Force hash check by injecting assert fence that re-reads? Hash checked on mid re-read after facilities.
          // Change after acc but acquire facilities uses original selections from first re-read.
          // Trigger via beforeMarkerClear path after facilities: change before mid re-read using afterFacilityAcquire
          afterFacilityAcquire: async () => {
            const snap = baseSnapshot({
              facilitySelections: [facilitySel('sauna-1', 10)],
              adults: 8
            });
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { quoteSnapshot: snap, quoteSnapshotHash: hashQuoteSnapshot(snap) } }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
    const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
    assert.ok(lease);
  });

  it('36. Snapshot changes after facilities (via mid re-read)', async () => {
    const id = checkoutId('snap2');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          afterFacilityAcquire: async () => {
            const snap = baseSnapshot({
              facilitySelections: [facilitySel('sauna-1', 10)],
              adults: 7
            });
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { quoteSnapshot: snap, quoteSnapshotHash: hashQuoteSnapshot(snap) } }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
  });

  it('37. Snapshot changes after marker clearing', async () => {
    const id = checkoutId('snap3');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          beforeFinalSessionCheck: async () => {
            const snap = baseSnapshot({ adults: 4 });
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { quoteSnapshot: snap, quoteSnapshotHash: hashQuoteSnapshot(snap) } }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
    const fence = await CheckoutResourceAttempt.findOne({ checkoutId: id }).sort({ generation: -1 }).lean();
    assert.equal(fence.status, 'failed');
    assert.equal(fence.isLive, false);
  });

  it('38. Wrong accommodation leaseId', async () => {
    const id = checkoutId('badlease');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          assertAccommodationCheckoutHoldActive: async (input, d) => {
            const real =
              await require('../services/checkout/accommodationCheckoutHoldService').assertAccommodationCheckoutHoldActive(
                input,
                d
              );
            return { ...real, leaseId: 'lease_forged_other' };
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
  });

  it('39. Wrong accommodation generation', async () => {
    const id = checkoutId('badgen');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          assertAccommodationCheckoutHoldActive: async (input, d) => {
            const real =
              await require('../services/checkout/accommodationCheckoutHoldService').assertAccommodationCheckoutHoldActive(
                input,
                d
              );
            return { ...real, generation: Number(real.generation) + 99 };
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
  });

  it('40. Wrong Unit/Cabin identity', async () => {
    const id = checkoutId('badunit');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          assertAccommodationCheckoutHoldActive: async (input, d) => {
            const real =
              await require('../services/checkout/accommodationCheckoutHoldService').assertAccommodationCheckoutHoldActive(
                input,
                d
              );
            return { ...real, unitId: new mongoose.Types.ObjectId().toString() };
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
  });

  it('41. Accommodation expiry below bundle floor', async () => {
    const id = checkoutId('accfloor');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          assertAccommodationCheckoutHoldActive: async (input, d) => {
            const real =
              await require('../services/checkout/accommodationCheckoutHoldService').assertAccommodationCheckoutHoldActive(
                input,
                d
              );
            return {
              ...real,
              expiresAt: new Date(frozenNow.getTime() + 1000).toISOString()
            };
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
  });

  it('42. Facility verification failure', async () => {
    const id = checkoutId('facver');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          assertFacilityHoldsActive: async () => {
            const { FacilityBookingError } = require('../services/facilityBookingService');
            throw new FacilityBookingError(
              'FACILITY_HOLD_VERIFICATION_FAILED',
              'missing'
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
  });

  it('43. Minimum remaining-time failure', async () => {
    const id = checkoutId('remain');
    await createSession({
      id,
      expiresAt: new Date(frozenNow.getTime() + 90_000)
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          afterFacilityAcquire: async () => {
            advanceMs(50_000);
          }
        })
      ),
      'RESOURCE_BUNDLE_LEASE_TOO_SHORT'
    );
  });

  it('47. Incomplete facility compensation keeps fence live (real compensate path)', async () => {
    const id = checkoutId('compinc');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });

    const cancelBlock = { block: false };
    const FacilityReservationProxy = {
      find: (...a) => FacilityReservation.find(...a),
      findOne: (...a) => FacilityReservation.findOne(...a),
      findById: (...a) => FacilityReservation.findById(...a),
      create: (...a) => FacilityReservation.create(...a),
      updateMany: (...a) => FacilityReservation.updateMany(...a),
      countDocuments: (...a) => FacilityReservation.countDocuments(...a),
      deleteMany: (...a) => FacilityReservation.deleteMany(...a),
      collection: FacilityReservation.collection,
      findOneAndUpdate: async (filter, update, options) => {
        if (
          cancelBlock.block &&
          filter &&
          filter.acquisitionAttemptId &&
          update &&
          update.$set &&
          update.$set.status === 'cancelled'
        ) {
          return null;
        }
        return FacilityReservation.findOneAndUpdate(filter, update, options);
      }
    };

    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          FacilityReservation: FacilityReservationProxy,
          assertFacilityHoldsActive: async () => {
            cancelBlock.block = true;
            const { FacilityBookingError } = require('../services/facilityBookingService');
            throw new FacilityBookingError(
              'FACILITY_HOLD_VERIFICATION_FAILED',
              'force compensate path'
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE'
    );

    const fence = await findLiveFence(id, depsBase());
    assert.ok(fence);
    assert.equal(fence.status, 'open');
    assert.equal(fence.isLive, true);
    assert.equal(fence.failureCode, 'RESOURCE_BUNDLE_COMPENSATION_INCOMPLETE');

    const remaining = await listCurrentAttemptMarkedHoldIds(
      id,
      fence.attemptId,
      depsBase()
    );
    assert.ok(remaining.length >= 1);
    assert.ok(remaining.map(String).includes(String(remaining[0])));

    // Remove injection; expire stuck fence; retry recovery.
    cancelBlock.block = false;
    const {
      expireCheckoutResourceAttemptFences
    } = require('../services/checkout/checkoutResourceAttemptFenceService');
    advanceMs(31 * 60 * 1000);
    await expireCheckoutResourceAttemptFences(depsBase());
    const recovered = await prepareCheckoutResourceBundle({ checkoutId: id }, depsBase());
    assert.equal(recovered.resourceBundleReady, true);
    assert.equal(
      (await listCurrentAttemptMarkedHoldIds(id, fence.attemptId, depsBase())).length,
      0
    );
  });

  it('48. Partial marker clear keeps fence live', async () => {
    const id = checkoutId('clearinc');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          clearFacilityAcquisitionMarkers: async () => ({
            ok: false,
            remainingHoldIds: ['507f1f77bcf86cd799439011'],
            modifiedCount: 0
          })
        })
      ),
      'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
    );
    const fence = await findLiveFence(id, depsBase());
    assert.ok(fence);
    assert.equal(fence.failureCode, 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE');
  });

  it('49. Fence lost during major phases yields RESOURCE_BUNDLE_FENCE_LOST', async () => {
    const phases = [
      'beforeAccommodationAcquire',
      'beforeFacilityAcquire',
      'beforeMarkerClear',
      'beforeFinalSessionCheck'
    ];

    for (let phaseIdx = 0; phaseIdx < phases.length; phaseIdx += 1) {
      const phase = phases[phaseIdx];
      // Isolate each phase from leftover claims/holds/fences of prior iterations.
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        FacilityReservation.deleteMany({}),
        AccommodationCheckoutLease.deleteMany({}),
        UnitNightClaim.deleteMany({}),
        CabinNightClaim.deleteMany({}),
        CheckoutResourceAttempt.deleteMany({}),
        CheckoutSession.deleteMany({})
      ]);

      const id = checkoutId(`lost_${phase}`);
      const foreign = checkoutId(`lost_foreign_${phase}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({
        id,
        snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
      });
      const foreignHour = 14 + phaseIdx;
      // eslint-disable-next-line no-await-in-loop
      await FacilityReservation.create({
        facilityCode: 'hot-tub-1',
        capacityLane: 0,
        slotStart: new Date(
          `${DAY}T${String(foreignHour).padStart(2, '0')}:00:00.000Z`
        ),
        startTime: new Date(
          `${DAY}T${String(foreignHour).padStart(2, '0')}:00:00.000Z`
        ),
        endTime: new Date(
          `${DAY}T${String(foreignHour + 2).padStart(2, '0')}:00:00.000Z`
        ),
        status: 'hold',
        checkoutSessionId: foreign,
        holdExpiresAt: new Date(frozenNow.getTime() + 60 * 60 * 1000),
        addOnCode: 'hot-tub-firewood-pack',
        addOnVersion: 1,
        acquisitionAttemptId: null,
        priceSnapshot: {
          currency: 'EUR',
          amount: 30,
          chargeUnit: 'per_firing',
          addOnCode: 'hot-tub-firewood-pack',
          addOnVersion: 1
        }
      });

      const hooks = {};
      hooks[phase] = async ({ fenceCtx }) => {
        const hash = (await CheckoutSession.findOne({ checkoutId: id }).lean())
          .quoteSnapshotHash;
        await CheckoutResourceAttempt.updateOne(
          { attemptId: fenceCtx.attemptId },
          { $set: { isLive: false, status: 'failed', failureCode: 'TAKEOVER' } }
        );
        await CheckoutResourceAttempt.create({
          attemptId: `cra_replacement_${String(fenceCtx.attemptId).slice(-12)}`,
          checkoutId: id,
          quoteSnapshotHash: hash,
          generation: Number(fenceCtx.generation) + 1,
          status: 'open',
          isLive: true,
          startedAt: clock(),
          bundleValidUntil: new Date(clock().getTime() + 30 * 60 * 1000),
          releasedAt: null,
          failureCode: null
        });
      };

      // eslint-disable-next-line no-await-in-loop
      await assertRejectsCode(
        prepareCheckoutResourceBundle({ checkoutId: id }, depsBase(hooks)),
        'RESOURCE_BUNDLE_FENCE_LOST'
      );

      // eslint-disable-next-line no-await-in-loop
      const replacement = await CheckoutResourceAttempt.findOne({
        checkoutId: id,
        isLive: true
      }).lean();
      assert.ok(replacement);
      assert.equal(replacement.status, 'open');
      assert.match(String(replacement.attemptId), /^cra_replacement_/);

      // eslint-disable-next-line no-await-in-loop
      const foreignHold = await FacilityReservation.findOne({
        checkoutSessionId: foreign,
        status: 'hold'
      }).lean();
      assert.ok(foreignHold);

      // Hook runs before or after accommodation acquire; once acquire returns, lease stays sealed.
      // eslint-disable-next-line no-await-in-loop
      const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
      assert.ok(lease);
      assert.equal(lease.status, 'sealed');
    }
  });

  it('50. Final session failure after marker clear', async () => {
    const id = checkoutId('finalfail');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          beforeFinalSessionCheck: async () => {
            await CheckoutSession.updateOne(
              { checkoutId: id },
              { $set: { status: 'abandoned' } }
            );
          }
        })
      ),
      'CHECKOUT_SESSION_NOT_USABLE'
    );
    const fence = await CheckoutResourceAttempt.findOne({ checkoutId: id }).sort({ generation: -1 }).lean();
    assert.equal(fence.status, 'failed');
    const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
    assert.ok(lease);
  });

  it('51. Fence-release failure', async () => {
    const id = checkoutId('relfail');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          releaseCheckoutResourceAttemptFence: async () => {
            const {
              CheckoutResourceAttemptFenceError,
              FENCE_ERROR_CODES
            } = require('../services/checkout/checkoutResourceAttemptFenceService');
            throw new CheckoutResourceAttemptFenceError(
              FENCE_ERROR_CODES.RESOURCE_ATTEMPT_INTEGRITY,
              'release failed'
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_INTEGRITY'
    );
    const fence = await findLiveFence(id, depsBase());
    assert.ok(fence);
    assert.equal(fence.status, 'open');
  });

  it('53. No accommodation compensation after successful acquire', async () => {
    const id = checkoutId('noacccomp');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    let releaseCalled = false;
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireFacilityHolds: async () => {
            const { FacilityBookingError } = require('../services/facilityBookingService');
            throw new FacilityBookingError('SLOT_AT_CAPACITY', 'full');
          },
          releaseAccommodationCheckoutHold: async () => {
            releaseCalled = true;
          }
        })
      ),
      'FACILITY_UNAVAILABLE'
    );
    assert.equal(releaseCalled, false);
    assert.ok(await getActiveAccommodationCheckoutHold(id, depsBase()));
  });

  it('54. Known night-conflict maps to ACCOMMODATION_UNAVAILABLE', async () => {
    const id = checkoutId('mapcodes');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireAccommodationCheckoutHold: async () => {
            const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
            throw new AccommodationCheckoutHoldError(
              'ACCOMMODATION_NIGHT_CONFLICT',
              'conflict'
            );
          }
        })
      ),
      'ACCOMMODATION_UNAVAILABLE'
    );
  });

  it('54b. NO_ELIGIBLE_ACCOMMODATION does not map to availability', async () => {
    const id = checkoutId('noelig');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireAccommodationCheckoutHold: async () => {
            const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
            throw new AccommodationCheckoutHoldError(
              'NO_ELIGIBLE_ACCOMMODATION',
              'collapsed ownership'
            );
          }
        })
      ),
      'NO_ELIGIBLE_ACCOMMODATION'
    );
  });

  it('54c. Ambiguous exclusive-plan failure does not map to availability', async () => {
    const id = checkoutId('ambig');
    const accommodationKey = 'a-frame';
    await createSession({
      id,
      snapshot: baseSnapshot({
        bookingType: 'fixed_package',
        ratePlan: {
          code: 'parent-child',
          version: 1,
          type: 'fixed_package',
          currency: 'EUR'
        },
        packageSnapshot: {
          ratePlanCode: 'parent-child',
          ratePlanVersion: 1,
          ratePlanType: 'fixed_package',
          currency: 'EUR',
          arrivalDate: STAY_IN,
          departureDate: STAY_OUT,
          accommodationKey,
          pricingMethod: 'fixed_per_unit',
          inventoryMode: 'exclusive',
          requiresFullPayment: true,
          cancellationPolicyCode: 'parent-child-package',
          cancellationPolicyVersion: 1,
          inclusions: ['programme'],
          participants: [],
          counts: { adults: 2, children: 0, infants: 0, total: 2 },
          capacityUsed: 2,
          capacityMaximum: 4,
          pricingBreakdown: null,
          totalBeforePaymentCredits: 420
        }
      })
    });
    await assert.rejects(
      () =>
        prepareCheckoutResourceBundle(
          { checkoutId: id },
          depsBase({
            acquireAccommodationCheckoutHold: async () => {
              const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
              // B8F1 collapses AMBIGUOUS into NO_ELIGIBLE for package ownership path
              throw new AccommodationCheckoutHoldError(
                'NO_ELIGIBLE_ACCOMMODATION',
                'Multiple exclusive packages claim inventory',
                { originalCode: 'AMBIGUOUS_EXCLUSIVE_RATE_PLAN' }
              );
            }
          })
        ),
      (err) => {
        assert.equal(err.name, 'CheckoutResourceBundleError');
        assert.notEqual(err.code, 'ACCOMMODATION_UNAVAILABLE');
        assert.equal(err.code, 'NO_ELIGIBLE_ACCOMMODATION');
        return true;
      }
    );
  });

  it('54d. Package ownership failure does not map to availability', async () => {
    const id = checkoutId('ownfail');
    await createSession({ id });
    await assert.rejects(
      () =>
        prepareCheckoutResourceBundle(
          { checkoutId: id },
          depsBase({
            acquireAccommodationCheckoutHold: async () => {
              const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
              throw new AccommodationCheckoutHoldError(
                'NO_ELIGIBLE_ACCOMMODATION',
                'A different exclusive package owns inventory'
              );
            }
          })
        ),
      (err) => {
        assert.equal(err.code, 'NO_ELIGIBLE_ACCOMMODATION');
        assert.notEqual(err.code, 'ACCOMMODATION_UNAVAILABLE');
        return true;
      }
    );
  });

  it('55. Unknown accommodation failure remains internal', async () => {
    const id = checkoutId('unkacc');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireAccommodationCheckoutHold: async () => {
            throw new Error('unexpected boom');
          }
        })
      ),
      'RESOURCE_BUNDLE_INTEGRITY'
    );
  });

  it('56. Claim/index/integrity failures are not availability', async () => {
    const id = checkoutId('idx');
    await createSession({ id });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireAccommodationCheckoutHold: async () => {
            const { AccommodationCheckoutHoldError } = require('../services/checkout/accommodationCheckoutHoldService');
            throw new AccommodationCheckoutHoldError(
              'ACCOMMODATION_CLAIM_AUTHORITY_UNAVAILABLE',
              'index'
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_INTEGRITY'
    );
  });

  it('57. Unknown facility failure remains internal', async () => {
    const id = checkoutId('unkfac');
    await createSession({
      id,
      snapshot: baseSnapshot({ facilitySelections: [facilitySel('sauna-1', 10)] })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle(
        { checkoutId: id },
        depsBase({
          acquireFacilityHolds: async () => {
            throw new Error('facility boom');
          }
        })
      ),
      'RESOURCE_BUNDLE_INTEGRITY'
    );
  });
});

describe('B8F2A2 missing session', () => {
  it('missing checkout session', async () => {
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: checkoutId('missing') }, depsBase()),
      'CHECKOUT_SESSION_NOT_FOUND'
    );
  });
});
