/**
 * B8F2B2 — Voucher-aware checkout resource-bundle orchestrator (MongoMemoryServer).
 * Real fence / accommodation / facility / B1B voucher services.
 * No routes, PI, Booking.create, webhook, worker, or frontend wiring.
 *
 * Note: the A2 suite (resourceAttemptOrchestrator.b8f2a2.test.cjs) must remain 67/67 —
 * run it separately; this file must not alter A2 coverage or behavior.
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
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');

const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  ensureCheckoutResourceAttemptIndexesForTests,
  findLiveFence,
  expireCheckoutResourceAttemptFences,
  failCheckoutResourceAttemptFence
} = require('../services/checkout/checkoutResourceAttemptFenceService');
const {
  ensureLeaseIndexesForTests,
  getActiveAccommodationCheckoutHold
} = require('../services/checkout/accommodationCheckoutHoldService');
const {
  ensureFacilityReservationUniqueIndexForTests,
  DEFAULT_FACILITY_HOLD_TTL_MS,
  listCurrentAttemptMarkedHoldIds
} = require('../services/facilityBookingService');
const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');
const {
  ensureVoucherLedgerIndexesForTests,
  __setAfterV1SealPartialClearHookForTests,
  __setBeforeV1SealRedemptionClearHookForTests
} = require('../services/giftVouchers/giftVoucherLedgerService');
const {
  listCurrentAttemptVoucherMarkers,
  releaseAttemptVoucherReservation,
  sealAttemptVoucherReservation,
  __setAfterAttemptFirstMarkerClearHookForTests,
  __setAfterAttemptEventBeforeMarkerClearHookForTests
} = require('../services/giftVouchers/giftVoucherAttemptReservationService');

const {
  CheckoutResourceBundleError,
  prepareCheckoutResourceBundle,
  prepareCheckoutResourceBundleWithVoucher
} = require('../services/checkout/resourceAttemptOrchestrator');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const DAY = '2027-01-15';
const WIN_START = `${DAY}T10:00:00.000Z`;
const WIN_END = `${DAY}T22:00:00.000Z`;
const VOUCHER_EXPIRY = new Date('2027-06-01T00:00:00.000Z');

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let seq = 0;
let voucherSeq = 0;
let frozenNow = new Date('2026-09-06T12:00:00.000Z');

function clock() {
  return new Date(frozenNow.getTime());
}

function advanceMs(ms) {
  frozenNow = new Date(frozenNow.getTime() + ms);
}

function checkoutId(label = 'co') {
  seq += 1;
  return `co_b8f2b2_${label}_${seq}_${crypto.randomBytes(3).toString('hex')}`;
}

function voucherCode() {
  voucherSeq += 1;
  return `DD-A2B3-C4D5-${String(voucherSeq).padStart(4, '0')}`;
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

/** Partial or full voucher quoteSnapshot fields (stripeAmountCents allowed in this test file). */
function voucherSnapshot({
  code,
  appliedCents,
  totalCents = 20000,
  facilities = undefined,
  extra = {}
} = {}) {
  const applied = Number(appliedCents);
  const total = Number(totalCents);
  const remaining = total - applied;
  const full = applied === total;
  return baseSnapshot({
    voucherCode: String(code || '').toUpperCase(),
    totalValueCents: total,
    voucherAppliedCents: applied,
    stripeAmountCents: remaining,
    fullVoucherCoverage: full,
    currency: 'EUR',
    ...(facilities !== undefined ? { facilitySelections: facilities } : {}),
    ...extra
  });
}

async function createVoucher(overrides = {}) {
  const c = Object.prototype.hasOwnProperty.call(overrides, 'code')
    ? overrides.code
    : voucherCode();
  const normalized = c == null ? null : String(c).toUpperCase();
  return GiftVoucher.create({
    code: normalized,
    amountOriginalCents: 20000,
    balanceRemainingCents: 20000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: VOUCHER_EXPIRY,
    reservationLedgerOperations: [],
    ...overrides,
    code: normalized
  });
}

async function createSession({
  id,
  snapshot,
  status = 'quoted',
  paymentStatus = null,
  finalizeStatus = 'open',
  expiresAt = null,
  canonicalPaymentIntentId = null,
  voucherRedemptionId = null,
  giftVoucherAppliedCents = 0,
  stripeAmountCents = undefined,
  extra = {}
}) {
  const quoteSnapshot = snapshot || baseSnapshot();
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const remaining =
    stripeAmountCents !== undefined
      ? stripeAmountCents
      : Number(quoteSnapshot.stripeAmountCents ?? 0);
  const full = quoteSnapshot.fullVoucherCoverage === true;
  const payStatus =
    paymentStatus != null
      ? paymentStatus
      : full
        ? 'not_required'
        : Number(quoteSnapshot.voucherAppliedCents) > 0
          ? 'unpaid'
          : 'unpaid';
  const exp =
    expiresAt === undefined
      ? null
      : expiresAt != null
        ? expiresAt
        : new Date(frozenNow.getTime() + 48 * 60 * 60 * 1000);
  return CheckoutSession.create({
    checkoutId: id,
    status,
    paymentStatus: payStatus,
    finalizeStatus,
    quoteSnapshot,
    quoteSnapshotHash,
    expiresAt: exp,
    canonicalPaymentIntentId,
    voucherRedemptionId,
    giftVoucherAppliedCents,
    stripeAmountCents: remaining,
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
    name: `B8F2B2 CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f2b2',
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
  await ensureVoucherLedgerIndexesForTests();
}

function assertRejectsCode(promise, code) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.name, 'CheckoutResourceBundleError');
    assert.equal(err.code, code);
    return true;
  });
}

function resetVoucherHooks() {
  __setAfterV1SealPartialClearHookForTests(null);
  __setBeforeV1SealRedemptionClearHookForTests(null);
  __setAfterAttemptFirstMarkerClearHookForTests(null);
  __setAfterAttemptEventBeforeMarkerClearHookForTests(null);
}

async function assertSuccessBundle(bundle, {
  appliedCents,
  totalCents,
  code,
  full = false
} = {}) {
  assert.equal(bundle.resourceBundleReady, true);
  assert.equal(bundle.voucher.sealed, true);
  assert.equal(bundle.voucher.status, 'reserved');
  assert.equal(bundle.voucher.amountAppliedCents, appliedCents);
  assert.equal(bundle.voucher.currency, 'EUR');
  assert.equal(typeof bundle.voucher.expiresAt, 'string');
  assert.match(bundle.voucher.expiresAt, /Z$/);
  assert.equal(bundle.voucher.voucherCode, String(code).toUpperCase());
  assert.equal(bundle.voucherCoverage.totalValueCents, totalCents);
  assert.equal(bundle.voucherCoverage.voucherAppliedCents, appliedCents);
  assert.equal(bundle.voucherCoverage.fullVoucherCoverage, full);
  assert.equal(bundle.voucherCoverage.stripeAmountCents, totalCents - appliedCents);
  assert.equal(await findLiveFence(bundle.checkoutId, depsBase()), null);
  const lease = await getActiveAccommodationCheckoutHold(bundle.checkoutId, depsBase());
  assert.ok(lease);
  assert.equal(lease.status, 'sealed');
  const markedFac = await listCurrentAttemptMarkedHoldIds(
    bundle.checkoutId,
    bundle.attemptId,
    depsBase()
  );
  assert.equal(markedFac.length, 0);
  const vMarkers = await listCurrentAttemptVoucherMarkers({
    checkoutId: bundle.checkoutId,
    acquisitionAttemptId: bundle.attemptId
  });
  assert.equal(
    vMarkers.filter(
      (m) =>
        m.redemptionMarker === bundle.attemptId || m.operationMarker === bundle.attemptId
    ).length,
    0
  );
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { directConnection: true });
  await ensureIndexes();
  await seedInventory({ units: 5 });
});

after(async () => {
  resetVoucherHooks();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  frozenNow = new Date('2026-09-06T12:00:00.000Z');
  resetVoucherHooks();
  await Promise.all([
    CheckoutSession.deleteMany({}),
    CheckoutResourceAttempt.deleteMany({}),
    FacilityReservation.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AccommodationCheckoutLease.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    Booking.deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    GiftVoucher.deleteMany({})
  ]);
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
});

describe('B8F2B2 happy paths', () => {
  it('1. Partial coverage reserves exact cents', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('partial');
    const applied = 5000;
    const snap = voucherSnapshot({
      code: voucher.code,
      appliedCents: applied,
      facilities: [facilitySel('sauna-1', 10)]
    });
    await createSession({ id, snapshot: snap });
    const bundle = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    await assertSuccessBundle(bundle, {
      appliedCents: applied,
      totalCents: 20000,
      code: voucher.code,
      full: false
    });
    const v = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(v.balanceRemainingCents, 15000);
    assert.equal(v.reservationLedgerOperations[0].state, 'debited');
    const session = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(session.voucherRedemptionId, null);
    assert.equal(session.giftVoucherAppliedCents, 0);
    assert.equal(await Booking.countDocuments({}), 0);
  });

  it('2. Full coverage reserves exact cents; no PI/Booking; session voucher fields unchanged', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('full');
    const snap = voucherSnapshot({ code: voucher.code, appliedCents: 20000 });
    await createSession({ id, snapshot: snap });
    const before = await CheckoutSession.findOne({ checkoutId: id }).lean();
    const bundle = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    await assertSuccessBundle(bundle, {
      appliedCents: 20000,
      totalCents: 20000,
      code: voucher.code,
      full: true
    });
    const after = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(after.voucherRedemptionId, null);
    assert.equal(after.giftVoucherAppliedCents, 0);
    assert.equal(after.canonicalPaymentIntentId, before.canonicalPaymentIntentId);
    assert.equal(await Booking.countDocuments({}), 0);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 0);
  });

  it('3. Voucher reserve only AFTER accommodation+facility verification', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('order');
    const snap = voucherSnapshot({
      code: voucher.code,
      appliedCents: 3000,
      facilities: [facilitySel('sauna-1', 10)]
    });
    await createSession({ id, snapshot: snap });
    let sawPreReserve = false;
    await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase({
        beforeVoucherReserve: async ({ fenceCtx, bundleValidUntil }) => {
          const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
          assert.ok(lease);
          assert.equal(lease.status, 'sealed');
          assert.ok(new Date(lease.expiresAt).getTime() >= bundleValidUntil.getTime());
          const holds = await listCurrentAttemptMarkedHoldIds(
            id,
            fenceCtx.attemptId,
            depsBase()
          );
          assert.equal(holds.length, 1);
          const bal = (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents;
          assert.equal(bal, 20000);
          sawPreReserve = true;
        }
      })
    );
    assert.equal(sawPreReserve, true);
  });

  it('4+5. Voucher expiresAt >= bundleValidUntil; sealed reuse never shortens', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('expiry');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 4000 })
    });
    const first = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.ok(
      new Date(first.voucher.expiresAt).getTime() >= first.bundleValidUntil.getTime()
    );
    const firstExp = new Date(first.voucher.expiresAt).getTime();
    const red = await GiftVoucherRedemption.findById(first.voucher.redemptionId).lean();
    await GiftVoucherRedemption.updateOne(
      { _id: red._id },
      { $set: { expiresAt: new Date(firstExp + 60 * 60 * 1000) } }
    );
    const later = firstExp + 60 * 60 * 1000;
    const second = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(second.voucher.redemptionId, first.voucher.redemptionId);
    assert.ok(new Date(second.voucher.expiresAt).getTime() >= later);
  });
});

describe('B8F2B2 voucher validation failures', () => {
  it('6. Insufficient balance fails without reducing amount', async () => {
    const voucher = await createVoucher({
      amountOriginalCents: 5000,
      balanceRemainingCents: 1600
    });
    const id = checkoutId('insuf');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 4000,
        totalCents: 20000
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_INSUFFICIENT_BALANCE'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 1600);
    assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId: id }), 0);
  });

  it('7. Inactive voucher → VOUCHER_INACTIVE', async () => {
    const voucher = await createVoucher({ status: 'voided' });
    const id = checkoutId('inactive');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 2000 })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_INACTIVE'
    );
  });

  it('8. Expired voucher → VOUCHER_EXPIRED', async () => {
    const voucher = await createVoucher({
      expiresAt: new Date('2020-01-01T00:00:00.000Z')
    });
    const id = checkoutId('expired');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 2000 })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_EXPIRED'
    );
  });

  it('9. Currency mismatch on snapshot → VOUCHER_CURRENCY_MISMATCH', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('cur');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 2000,
        extra: { currency: 'USD' }
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_CURRENCY_MISMATCH'
    );
  });

  it('10+11. Code without amount; amount without code', async () => {
    const voucher = await createVoucher();
    const idA = checkoutId('codeonly');
    await createSession({
      id: idA,
      snapshot: baseSnapshot({
        voucherCode: voucher.code,
        voucherAppliedCents: null,
        stripeAmountCents: 20000,
        fullVoucherCoverage: false
      }),
      stripeAmountCents: 20000
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: idA }, depsBase()),
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
    );

    const idB = checkoutId('amtonly');
    await createSession({
      id: idB,
      snapshot: baseSnapshot({
        voucherCode: '',
        voucherAppliedCents: 1000,
        stripeAmountCents: 19000,
        fullVoucherCoverage: false
      }),
      stripeAmountCents: 19000
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: idB }, depsBase()),
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
    );
  });

  it('12. Zero, negative, fractional, excessive amounts', async () => {
    const voucher = await createVoucher();
    for (const applied of [0, -100, 10.5, 25000]) {
      const id = checkoutId(`amt_${String(applied).replace('.', '_')}`);
      // eslint-disable-next-line no-await-in-loop
      await createSession({
        id,
        snapshot: baseSnapshot({
          voucherCode: voucher.code,
          voucherAppliedCents: applied,
          totalValueCents: 20000,
          stripeAmountCents:
            Number.isInteger(applied) && applied >= 0 && applied <= 20000
              ? 20000 - applied
              : 0,
          fullVoucherCoverage: false
        }),
        stripeAmountCents: 0,
        paymentStatus: 'unpaid'
      });
      // eslint-disable-next-line no-await-in-loop
      await assertRejectsCode(
        prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
        'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
      );
    }
  });

  it('13. Incorrect remaining due (stripeAmountCents wrong)', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('remain');
    await createSession({
      id,
      snapshot: baseSnapshot({
        voucherCode: voucher.code,
        voucherAppliedCents: 5000,
        totalValueCents: 20000,
        stripeAmountCents: 9999,
        fullVoucherCoverage: false
      }),
      stripeAmountCents: 9999,
      paymentStatus: 'unpaid'
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
    );
  });

  it('14. Incorrect fullVoucherCoverage flag', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('flag');
    await createSession({
      id,
      snapshot: baseSnapshot({
        voucherCode: voucher.code,
        voucherAppliedCents: 5000,
        totalValueCents: 20000,
        stripeAmountCents: 15000,
        fullVoucherCoverage: true
      }),
      stripeAmountCents: 15000,
      paymentStatus: 'not_required'
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
    );
  });

  it('15. Session giftVoucherAppliedCents disagreement', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('sessdisc');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 5000 }),
      giftVoucherAppliedCents: 4000
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_SNAPSHOT_AMOUNT_MISMATCH'
    );
  });

  it('16. Existing different voucherRedemptionId → VOUCHER_SESSION_CAS_CONFLICT', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('casdiff');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 3500 }),
      voucherRedemptionId: new mongoose.Types.ObjectId()
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_SESSION_CAS_CONFLICT'
    );
  });

  it('17. Existing same redemption ID accepted idempotently', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('cassame');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 3500 })
    });
    const first = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    await CheckoutSession.updateOne(
      { checkoutId: id },
      { $set: { voucherRedemptionId: first.voucher.redemptionId } }
    );
    const second = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(second.voucher.redemptionId, first.voucher.redemptionId);
    assert.equal(second.resourceBundleReady, true);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      16500
    );
  });
});

describe('B8F2B2 compensation and mid-path failures', () => {
  it('18+19. Voucher failure compensates facilities / reserve-never-succeeded leaves no redemption', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('compfac');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 2500,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          afterVoucherReserve: async () => {
            const err = new CheckoutResourceBundleError(
              'RESOURCE_BUNDLE_VERIFICATION_FAILED',
              'forced post-reserve failure'
            );
            throw err;
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
    const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
    assert.ok(lease);
    assert.equal(lease.status, 'sealed');
    assert.equal(
      (await FacilityReservation.countDocuments({ checkoutSessionId: id, status: 'hold' })),
      0
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    const fence = await CheckoutResourceAttempt.findOne({ checkoutId: id })
      .sort({ generation: -1 })
      .lean();
    assert.equal(fence.isLive, false);

    // 19: reserve never succeeded — fail before reserve; no redemption for checkout
    const voucher2 = await createVoucher();
    const id2 = checkoutId('never');
    await createSession({
      id: id2,
      snapshot: voucherSnapshot({
        code: voucher2.code,
        appliedCents: 2500,
        facilities: [facilitySel('hot-tub-1', 12)]
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id2 },
        depsBase({
          beforeVoucherReserve: async () => {
            throw new CheckoutResourceBundleError(
              'RESOURCE_BUNDLE_VERIFICATION_FAILED',
              'abort before voucher reserve'
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_VERIFICATION_FAILED'
    );
    assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId: id2 }), 0);
    assert.equal((await GiftVoucher.findById(voucher2._id).lean()).balanceRemainingCents, 20000);
  });

  it('20+21. Snapshot change after voucher reserve compensates; balance restored exactly once', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('snapchg');
    const snap = voucherSnapshot({
      code: voucher.code,
      appliedCents: 2800,
      facilities: [facilitySel('sauna-1', 10)]
    });
    await createSession({ id, snapshot: snap });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          afterVoucherReserve: async () => {
            const mutated = {
              ...snap,
              adults: 3
            };
            await CheckoutSession.updateOne(
              { checkoutId: id },
              {
                $set: {
                  quoteSnapshot: mutated,
                  quoteSnapshotHash: hashQuoteSnapshot(mutated)
                }
              }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 20000);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      1
    );
    assert.equal(
      (await FacilityReservation.countDocuments({ checkoutSessionId: id, status: 'hold' })),
      0
    );
  });

  it('22. Fence loss after voucher reserve: no voucher release, no facility compensate', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('fencelost');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 3200,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    let attemptId = null;
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          afterVoucherReserve: async ({ fenceCtx }) => {
            attemptId = fenceCtx.attemptId;
            await CheckoutResourceAttempt.updateOne(
              { attemptId: fenceCtx.attemptId },
              { $set: { isLive: false, status: 'failed', failureCode: 'TAKEOVER' } }
            );
            await CheckoutResourceAttempt.create({
              attemptId: `cra_replacement_${String(fenceCtx.attemptId).slice(-12)}`,
              checkoutId: id,
              quoteSnapshotHash: (await CheckoutSession.findOne({ checkoutId: id }).lean())
                .quoteSnapshotHash,
              generation: Number(fenceCtx.generation) + 1,
              status: 'open',
              isLive: true,
              startedAt: clock(),
              bundleValidUntil: new Date(clock().getTime() + 30 * 60 * 1000),
              releasedAt: null,
              failureCode: null
            });
          }
        })
      ),
      'RESOURCE_BUNDLE_FENCE_LOST'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 16800);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      0
    );
    const marked = await listCurrentAttemptMarkedHoldIds(id, attemptId, depsBase());
    assert.ok(marked.length >= 1);
  });

  it('23+24. Facility marker-clear failure leaves voucher marked; retry repairs', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('markerclear');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 3100,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    let stuckAttemptId = null;
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          clearFacilityAcquisitionMarkers: async ({ attemptId }) => {
            stuckAttemptId = attemptId;
            return {
              ok: false,
              remainingHoldIds: ['507f1f77bcf86cd799439011'],
              modifiedCount: 0
            };
          }
        })
      ),
      'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE'
    );
    const live = await findLiveFence(id, depsBase());
    assert.ok(live);
    assert.equal(live.failureCode, 'RESOURCE_BUNDLE_MARKER_CLEAR_INCOMPLETE');
    const vMarkers = await listCurrentAttemptVoucherMarkers({
      checkoutId: id,
      acquisitionAttemptId: stuckAttemptId
    });
    assert.ok(
      vMarkers.some(
        (m) =>
          m.redemptionMarker === stuckAttemptId || m.operationMarker === stuckAttemptId
      )
    );

    advanceMs(31 * 60 * 1000);
    await expireCheckoutResourceAttemptFences(depsBase());
    const recovered = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(recovered.resourceBundleReady, true);
    assert.equal(recovered.voucher.sealed, true);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      16900
    );
  });

  it('25+26. Seal partial-clear failure leaves fence open; retry repairs without re-debit', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('sealpartial');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 2700,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    let hooked = false;
    __setAfterV1SealPartialClearHookForTests(async () => {
      if (hooked) return;
      hooked = true;
      const err = new Error('seal_partial');
      err.code = 'VOUCHER_MARKER_CLEAR_INCOMPLETE';
      throw err;
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher({ checkoutId: id }, depsBase()),
      'VOUCHER_MARKER_CLEAR_INCOMPLETE'
    );
    const live = await findLiveFence(id, depsBase());
    assert.ok(live && live.isLive === true);
    assert.equal(live.failureCode, 'VOUCHER_MARKER_CLEAR_INCOMPLETE');
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 17300);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_reserved'
        }).lean()
      ).length,
      1
    );
    const midRed = await GiftVoucherRedemption.findOne({ checkoutId: id, status: 'reserved' }).lean();
    assert.equal(midRed.acquisitionAttemptId, null);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0]
        .acquisitionAttemptId,
      live.attemptId
    );

    // Same live fence repairs the partial seal (orchestrator cannot re-acquire while live).
    __setAfterV1SealPartialClearHookForTests(null);
    const session = await CheckoutSession.findOne({ checkoutId: id }).lean();
    const sealed = await sealAttemptVoucherReservation(
      {
        checkoutId: id,
        acquisitionAttemptId: live.attemptId,
        quoteSnapshotHash: session.quoteSnapshotHash,
        redemptionId: midRed._id
      },
      { now: clock() }
    );
    assert.equal(sealed.sealed, true);
    assert.equal(sealed.acquisitionAttemptId, null);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).reservationLedgerOperations[0]
        .acquisitionAttemptId,
      null
    );

    advanceMs(31 * 60 * 1000);
    await expireCheckoutResourceAttemptFences(depsBase());
    const recovered = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(recovered.resourceBundleReady, true);
    assert.equal(recovered.voucher.sealed, true);
    assert.equal(String(recovered.voucher.redemptionId), String(midRed._id));
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 17300);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_reserved'
        }).lean()
      ).length,
      1
    );
  });
  it('27. Final session/hash failure after seal keeps resources, does not restore balance', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('finalhash');
    const snap = voucherSnapshot({
      code: voucher.code,
      appliedCents: 2600,
      facilities: [facilitySel('sauna-1', 10)]
    });
    await createSession({ id, snapshot: snap });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          beforeFinalSessionCheck: async () => {
            const mutated = { ...snap, children: 1 };
            await CheckoutSession.updateOne(
              { checkoutId: id },
              {
                $set: {
                  quoteSnapshot: mutated,
                  quoteSnapshotHash: hashQuoteSnapshot(mutated)
                }
              }
            );
          }
        })
      ),
      'SNAPSHOT_HASH_MISMATCH'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 17400);
    assert.equal(
      (
        await GiftVoucherEvent.find({
          giftVoucherId: voucher._id,
          type: 'redeemed_released'
        }).lean()
      ).length,
      0
    );
    const lease = await getActiveAccommodationCheckoutHold(id, depsBase());
    assert.ok(lease);
    assert.equal(lease.status, 'sealed');
    assert.ok(
      (await FacilityReservation.countDocuments({ checkoutSessionId: id, status: 'hold' })) >= 1
    );
    const red = await GiftVoucherRedemption.findOne({ checkoutId: id, status: 'reserved' }).lean();
    assert.ok(red);
    assert.equal(red.acquisitionAttemptId, null);
  });

  it('28. Fence release failure after seal — no success; resources kept', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('relfail');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 2400,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
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
    const live = await findLiveFence(id, depsBase());
    assert.ok(live);
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 17600);
    const red = await GiftVoucherRedemption.findOne({ checkoutId: id, status: 'reserved' }).lean();
    assert.ok(red);
    assert.equal(red.acquisitionAttemptId, null);
  });
});

describe('B8F2B2 concurrency and reuse', () => {
  it('29. Same-checkout retry reuses exact redemption', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('reuse');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 3300 })
    });
    const first = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    const second = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(second.voucher.redemptionId, first.voucher.redemptionId);
    assert.equal(second.voucher.reservationKey, first.voucher.reservationKey);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      16700
    );
  });

  it('30+31. New attempt takeover after mid-flight fence fail; old attempt cannot succeed', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('takeover');
    await createSession({
      id,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 3600,
        facilities: [facilitySel('sauna-1', 10)]
      })
    });
    let oldAttemptId = null;
    let oldHash = null;
    let oldRedemptionId = null;
    await assertRejectsCode(
      prepareCheckoutResourceBundleWithVoucher(
        { checkoutId: id },
        depsBase({
          afterVoucherReserve: async ({ fenceCtx, voucherReserveResult }) => {
            oldAttemptId = fenceCtx.attemptId;
            oldHash = (await CheckoutSession.findOne({ checkoutId: id }).lean())
              .quoteSnapshotHash;
            oldRedemptionId = voucherReserveResult.redemptionId;
            await CheckoutResourceAttempt.updateOne(
              { attemptId: fenceCtx.attemptId },
              { $set: { isLive: false, status: 'failed', failureCode: 'TEST_KILL' } }
            );
          }
        })
      ),
      'RESOURCE_BUNDLE_FENCE_LOST'
    );

    const second = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: id },
      depsBase()
    );
    assert.equal(second.voucher.redemptionId, String(oldRedemptionId));
    assert.equal(second.resourceBundleReady, true);
    assert.notEqual(second.attemptId, oldAttemptId);
    assert.equal(
      (await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents,
      16400
    );

    await assert.rejects(
      () =>
        releaseAttemptVoucherReservation(
          {
            checkoutId: id,
            acquisitionAttemptId: oldAttemptId,
            quoteSnapshotHash: oldHash
          },
          { now: clock() }
        ),
      (e) => e.code === 'RESOURCE_BUNDLE_FENCE_LOST' || e.code === 'VOUCHER_ATTEMPT_MARKER_MISMATCH' || e.code === 'VOUCHER_COMPENSATION_SEAL_COMPLETED' || e.code === 'VOUCHER_COMPENSATION_STATE_UNPROVEN'
    );
    await assert.rejects(
      () =>
        sealAttemptVoucherReservation(
          {
            checkoutId: id,
            acquisitionAttemptId: oldAttemptId,
            quoteSnapshotHash: oldHash,
            redemptionId: oldRedemptionId
          },
          { now: clock() }
        ),
      (e) =>
        e.code === 'RESOURCE_BUNDLE_FENCE_LOST' ||
        e.code === 'VOUCHER_ATTEMPT_MARKER_MISMATCH' ||
        e.code === 'VOUCHER_COMPENSATION_SEAL_COMPLETED'
    );
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 16400);
  });

  it('32. Different checkout balance race cannot overspend', async () => {
    const voucher = await createVoucher({
      amountOriginalCents: 10000,
      balanceRemainingCents: 10000
    });
    const a = checkoutId('racea');
    const b = checkoutId('raceb');
    await createSession({
      id: a,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 7000,
        totalCents: 20000
      })
    });
    await createSession({
      id: b,
      snapshot: voucherSnapshot({
        code: voucher.code,
        appliedCents: 7000,
        totalCents: 20000
      })
    });

    let releaseB;
    const gate = new Promise((resolve) => {
      releaseB = resolve;
    });
    const pA = prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: a },
      depsBase({
        beforeVoucherReserve: async () => {
          releaseB();
          await new Promise((r) => setTimeout(r, 40));
        }
      })
    );
    await gate;
    const pB = prepareCheckoutResourceBundleWithVoucher({ checkoutId: b }, depsBase());
    const settled = await Promise.allSettled([pA, pB]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.name, 'CheckoutResourceBundleError');
    assert.equal(rejected[0].reason.code, 'VOUCHER_INSUFFICIENT_BALANCE');
    assert.equal((await GiftVoucher.findById(voucher._id).lean()).balanceRemainingCents, 3000);
  });
});

describe('B8F2B2 DTO / session / inertness', () => {
  it('33+34. Partial and full DTO exactness; no CheckoutSession mutation', async () => {
    const voucher = await createVoucher();
    const partialId = checkoutId('dto_p');
    const partialSnap = voucherSnapshot({
      code: voucher.code,
      appliedCents: 4500,
      facilities: [facilitySel('sauna-1', 10)]
    });
    await createSession({ id: partialId, snapshot: partialSnap });
    const beforeP = await CheckoutSession.findOne({ checkoutId: partialId }).lean();
    const partial = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: partialId },
      depsBase()
    );
    assert.equal(partial.voucherCoverage.stripeAmountCents, 15500);
    assert.equal(partial.voucherCoverage.fullVoucherCoverage, false);
    assert.equal(partial.voucher.amountAppliedCents, 4500);
    const afterP = await CheckoutSession.findOne({ checkoutId: partialId }).lean();
    assert.equal(String(beforeP.updatedAt), String(afterP.updatedAt));
    assert.equal(afterP.voucherRedemptionId, null);
    assert.equal(afterP.giftVoucherAppliedCents, 0);
    assert.equal(afterP.quoteSnapshotHash, beforeP.quoteSnapshotHash);

    const voucher2 = await createVoucher();
    const fullId = checkoutId('dto_f');
    await createSession({
      id: fullId,
      snapshot: voucherSnapshot({ code: voucher2.code, appliedCents: 20000 })
    });
    const beforeF = await CheckoutSession.findOne({ checkoutId: fullId }).lean();
    const full = await prepareCheckoutResourceBundleWithVoucher(
      { checkoutId: fullId },
      depsBase()
    );
    assert.equal(full.voucherCoverage.stripeAmountCents, 0);
    assert.equal(full.voucherCoverage.fullVoucherCoverage, true);
    const afterF = await CheckoutSession.findOne({ checkoutId: fullId }).lean();
    assert.equal(String(beforeF.updatedAt), String(afterF.updatedAt));
    assert.equal(afterF.voucherRedemptionId, null);
  });

  it('35. Source inertness: orchestrator must not contain banned strings', async () => {
    assert.equal(typeof prepareCheckoutResourceBundleWithVoucher, 'function');
    assert.equal(typeof CheckoutResourceBundleError, 'function');
    const orch = fs.readFileSync(
      path.join(__dirname, '../services/checkout/resourceAttemptOrchestrator.js'),
      'utf8'
    );
    for (const banned of [
      'ensureCanonicalPaymentIntent',
      'createPaymentIntent',
      'finalizePaidCheckout',
      'webhook',
      'express.Router',
      'completeFencedFacilityAcquisition',
      'Booking.create'
    ]) {
      assert.equal(orch.includes(banned), false, `orchestrator must not reference ${banned}`);
    }
    // Test file may mention stripeAmountCents in snapshots (allowed).
    assert.equal(fs.readFileSync(__filename, 'utf8').includes('stripeAmountCents'), true);
  });

  it('36. Non-voucher prepareCheckoutResourceBundle still rejects voucher input', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('novoucher');
    await createSession({
      id,
      snapshot: voucherSnapshot({ code: voucher.code, appliedCents: 2000 })
    });
    await assertRejectsCode(
      prepareCheckoutResourceBundle({ checkoutId: id }, depsBase()),
      'RESOURCE_BUNDLE_UNSUPPORTED_VOUCHER'
    );
  });
});
