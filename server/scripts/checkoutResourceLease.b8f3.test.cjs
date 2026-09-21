/**
 * B8F3 — Durable CheckoutSession resource lease + default-off payment gate (MongoMemoryServer).
 *
 * Real fence / accommodation / facility / voucher ledger+attempt / orchestrator / lease /
 * session / canonical PI services. Injected fake Stripe only (no network).
 * Gate enabled ONLY via injected `resourceLeaseGateEnabled: true` (never permanently via env).
 *
 * Run: node --test server/scripts/checkoutResourceLease.b8f3.test.cjs
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

const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  ensureCheckoutResourceAttemptIndexesForTests
} = require('../services/checkout/checkoutResourceAttemptFenceService');
const {
  ensureLeaseIndexesForTests,
  getActiveAccommodationCheckoutHold,
  releaseAccommodationCheckoutHold
} = require('../services/checkout/accommodationCheckoutHoldService');
const {
  ensureFacilityReservationUniqueIndexForTests,
  DEFAULT_FACILITY_HOLD_TTL_MS
} = require('../services/facilityBookingService');
const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');
const {
  ensureVoucherLedgerIndexesForTests
} = require('../services/giftVouchers/giftVoucherLedgerService');

const {
  ensureCanonicalPaymentIntent,
  buildPaymentIntentIdempotencyKey
} = require('../services/checkout/checkoutCanonicalPaymentIntentService');
const {
  refreshCheckoutSessionQuote,
  createCheckoutSession
} = require('../services/checkout/checkoutSessionService');
const {
  RESOURCE_LEASE_ERROR_CODES,
  CheckoutResourceLeaseError,
  isCheckoutResourceLeaseGateEnabled,
  bindPaymentIntentToResourceLease,
  claimLeaseCancellationPending,
  releaseExactResourceLeaseGeneration,
  ensureResourceLeaseIndexesForTests,
  DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS,
  markExactResourceLeasePaidForFinalize
} = require('../services/checkout/checkoutResourceLeaseService');
const {
  reconcileDueResourceLeases,
  reconcileOneResourceLease
} = require('../services/checkout/checkoutResourceLeaseReconciliationService');
const {
  prepareCheckoutResourceBundle,
  prepareCheckoutResourceBundleWithVoucher,
  DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS
} = require('../services/checkout/resourceAttemptOrchestrator');
const { CheckoutSessionError } = require('../services/checkout/checkoutSessionErrors');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const DAY = '2027-01-15';
const WIN_START = `${DAY}T10:00:00.000Z`;
const WIN_END = `${DAY}T22:00:00.000Z`;
const VOUCHER_EXPIRY = new Date('2027-06-01T00:00:00.000Z');
const BUNDLE_TTL_MS = 30 * 60 * 1000;
const LEGACY_ENTITY_ID = new mongoose.Types.ObjectId();

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let seq = 0;
let voucherSeq = 0;
let stripePiSeq = 0;
let frozenNow = new Date('2026-09-06T12:00:00.000Z');
let originalFindOneAndUpdate = null;

function clock() {
  return new Date(frozenNow.getTime());
}

function advanceMs(ms) {
  frozenNow = new Date(frozenNow.getTime() + ms);
}

function checkoutId(label = 'co') {
  seq += 1;
  return `co_b8f3_${label}_${seq}_${crypto.randomBytes(3).toString('hex')}`;
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

/**
 * Fake Stripe — create/retrieve/cancel/update + counters.
 * Supports knownRejection throw, ambiguous create-after-side-effect, setStatus.
 */
function createFakeStripe(options = {}) {
  const store = new Map();
  const idempotencyStore = new Map();
  const calls = { create: 0, uniqueCreated: 0, retrieve: 0, cancel: 0, update: 0 };
  let throwMode = null; // null | 'known' | 'ambiguous' | 'ambiguous_after_create'
  let cancelBehavior = 'default'; // default | throw | succeed_during

  const client = {
    paymentIntents: {
      create: async (payload, createOptions = {}) => {
        calls.create += 1;
        if (typeof options.onCreate === 'function') {
          await options.onCreate(payload, createOptions);
        }
        if (throwMode === 'known') {
          const err = new Error('card declined');
          err.knownRejection = true;
          err.code = 'card_declined';
          err.type = 'StripeCardError';
          throwMode = null;
          throw err;
        }
        const idempotencyKey = createOptions.idempotencyKey || null;
        if (idempotencyKey && idempotencyStore.has(idempotencyKey)) {
          return { ...idempotencyStore.get(idempotencyKey) };
        }
        // Global seq so concurrent FakeStripe instances never collide on unique PI index.
        const id = `pi_b8f3_${++stripePiSeq}`;
        calls.uniqueCreated += 1;
        const pi = {
          id,
          client_secret: `cs_secret_${id}`,
          amount: payload.amount,
          currency: payload.currency,
          metadata: { ...(payload.metadata || {}) },
          status: 'requires_payment_method',
          idempotencyKey
        };
        store.set(id, pi);
        if (idempotencyKey) {
          idempotencyStore.set(idempotencyKey, pi);
        }
        if (throwMode === 'ambiguous_after_create') {
          throwMode = null;
          const err = new Error('socket hang up after create');
          err.ambiguous = true;
          throw err;
        }
        if (throwMode === 'ambiguous') {
          throwMode = null;
          const err = new Error('network timeout before response');
          err.ambiguous = true;
          throw err;
        }
        return pi;
      },
      retrieve: async (id) => {
        calls.retrieve += 1;
        if (typeof options.onRetrieve === 'function') {
          const override = await options.onRetrieve(id);
          if (override !== undefined) return override;
        }
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error(`No such payment_intent: ${id}`);
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi };
      },
      cancel: async (id) => {
        calls.cancel += 1;
        if (cancelBehavior === 'throw') {
          throw new Error('cancel network failure');
        }
        if (cancelBehavior === 'succeed_during') {
          const pi = store.get(String(id));
          if (pi) pi.status = 'succeeded';
          throw new Error('cancel raced with payment');
        }
        if (cancelBehavior === 'processing_during') {
          const pi = store.get(String(id));
          if (pi) pi.status = 'processing';
          throw new Error('cancel raced with processing');
        }
        const pi = store.get(String(id));
        if (pi) {
          pi.status = 'canceled';
        }
        return pi ? { ...pi } : null;
      },
      update: async (id, patch) => {
        calls.update += 1;
        const pi = store.get(String(id));
        if (pi && patch?.metadata) {
          pi.metadata = { ...pi.metadata, ...patch.metadata };
        }
        return pi ? { ...pi } : null;
      }
    },
    __store: store,
    __idempotencyStore: idempotencyStore,
    __calls: calls,
    throwKnownRejection() {
      throwMode = 'known';
    },
    throwAmbiguous() {
      throwMode = 'ambiguous';
    },
    throwAmbiguousAfterCreate() {
      throwMode = 'ambiguous_after_create';
    },
    setCancelBehavior(mode) {
      cancelBehavior = mode;
    },
    setStatus(id, status) {
      const pi = store.get(String(id));
      if (pi) pi.status = status;
    },
    getPi(id) {
      return store.get(String(id)) || null;
    }
  };

  return client;
}

/** Legacy light fixtures (gate-off) — no inventory required. */
function buildFabricatedQuote(overrides = {}) {
  const checkInDate = new Date('2026-06-10T12:00:00.000Z');
  const checkOutDate = new Date('2026-06-12T12:00:00.000Z');
  return {
    entityType: 'cabin',
    entity: {
      _id: LEGACY_ENTITY_ID,
      minNights: 1,
      capacity: 4,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 20,
    totalPrice: 180,
    appliedPromoCode: '',
    promo: { snapshot: null },
    voucherAppliedCents: 0,
    remainingDueCents: 18000,
    fullVoucherCoverage: false,
    ...overrides
  };
}

function legacyInput(overrides = {}) {
  return {
    cabinId: String(LEGACY_ENTITY_ID),
    checkIn: '2026-06-10',
    checkOut: '2026-06-12',
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    guestEmail: 'guest@example.com',
    ...overrides
  };
}

function cabinTypeInput(overrides = {}) {
  return {
    cabinTypeId: String(cabinTypeId),
    cabinId: '',
    checkIn: STAY_IN,
    checkOut: STAY_OUT,
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    guestEmail: 'b8f3@example.com',
    ...overrides
  };
}

function cabinInput(overrides = {}) {
  return {
    cabinId: String(luxCabinId),
    cabinTypeId: '',
    checkIn: STAY_IN,
    checkOut: STAY_OUT,
    adults: 2,
    children: 0,
    experienceKeys: [],
    transportMethod: '',
    romanticSetup: false,
    promoCode: '',
    voucherCode: '',
    guestEmail: 'b8f3@example.com',
    ...overrides
  };
}

function cabinTypeQuote(overrides = {}) {
  const checkInDate = new Date(`${STAY_IN}T12:00:00.000Z`);
  const checkOutDate = new Date(`${STAY_OUT}T12:00:00.000Z`);
  return {
    entityType: 'cabinType',
    entity: {
      _id: cabinTypeId,
      minNights: 1,
      capacity: 2,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 0,
    totalPrice: 200,
    appliedPromoCode: '',
    promo: { snapshot: null },
    voucherAppliedCents: 0,
    remainingDueCents: 20000,
    fullVoucherCoverage: false,
    ...overrides
  };
}

function cabinQuote(overrides = {}) {
  const checkInDate = new Date(`${STAY_IN}T12:00:00.000Z`);
  const checkOutDate = new Date(`${STAY_OUT}T12:00:00.000Z`);
  return {
    entityType: 'cabin',
    entity: {
      _id: luxCabinId,
      minNights: 1,
      capacity: 2,
      pricingModel: 'per_night'
    },
    checkInDate,
    checkOutDate,
    subtotalPrice: 200,
    discountAmount: 0,
    totalPrice: 200,
    appliedPromoCode: '',
    promo: { snapshot: null },
    voucherAppliedCents: 0,
    remainingDueCents: 20000,
    fullVoucherCoverage: false,
    ...overrides
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
  paymentStatus = 'unpaid',
  finalizeStatus = 'open',
  expiresAt = null,
  canonicalPaymentIntentId = null,
  voucherRedemptionId = null,
  giftVoucherAppliedCents = 0,
  stripeAmountCents = undefined,
  sessionVersion = 1,
  extra = {}
}) {
  const quoteSnapshot = snapshot || baseSnapshot();
  const quoteSnapshotHash = hashQuoteSnapshot(quoteSnapshot);
  const remaining =
    stripeAmountCents !== undefined
      ? stripeAmountCents
      : Number(quoteSnapshot.stripeAmountCents ?? 0);
  // Wall-clock based: assertSessionUsable uses real Date(), not the injected lease clock.
  const exp =
    expiresAt != null
      ? expiresAt
      : new Date(Date.now() + 48 * 60 * 60 * 1000);
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
    stripeAmountCents: remaining,
    sessionVersion,
    ...extra
  });
}

function facilityDeps(extra = {}) {
  return {
    loadFacilityByCode: async (code) => FACILITIES[code] || null,
    loadAddOnByCodeVersion: async (code, version) => ADDONS[`${code}@${version}`] || null,
    loadExclusiveFixedPackages: async () => [],
    candidateSoftAvailable: async () => true,
    holdTtlMs: DEFAULT_FACILITY_HOLD_TTL_MS,
    ...extra
  };
}

function gatedArgs({ stripe, input, quote, checkoutId: id = null, extra = {} } = {}) {
  return {
    checkoutId: id,
    input,
    quote,
    stripe,
    resourceLeaseGateEnabled: true,
    clock,
    ...facilityDeps(extra)
  };
}

async function seedInventory({ units = 5 } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `B8F3 CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f3',
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
  await ensureResourceLeaseIndexesForTests();
}

function restoreFindOneAndUpdate() {
  if (originalFindOneAndUpdate) {
    CheckoutSession.findOneAndUpdate = originalFindOneAndUpdate;
    originalFindOneAndUpdate = null;
  }
}

async function createFullVoucherSession({ id, code, extraQuote = {} } = {}) {
  const input = cabinTypeInput({ voucherCode: code });
  const quote = cabinTypeQuote({
    voucherAppliedCents: 20000,
    remainingDueCents: 0,
    fullVoucherCoverage: true,
    totalPrice: 200,
    ...extraQuote
  });
  const created = await createCheckoutSession({
    input,
    quote,
    checkoutId: id
  });
  return { created, input, quote };
}

before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { directConnection: true });
  await ensureIndexes();
  await seedInventory({ units: 5 });
});

after(async () => {
  restoreFindOneAndUpdate();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  frozenNow = new Date('2026-09-06T12:00:00.000Z');
  restoreFindOneAndUpdate();
  delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
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

describe('B8F3 gate-off legacy parity (1–3, 40)', () => {
  it('1+2. Gate absent / false → legacy PI, no resourceLease, no orchestrator inventory', async () => {
    const stripeA = createFakeStripe();
    const dtoAbsent = await ensureCanonicalPaymentIntent({
      input: legacyInput(),
      quote: buildFabricatedQuote(),
      stripe: stripeA
    });
    assert.equal(stripeA.__calls.create, 1);
    assert.ok(dtoAbsent.canonicalPaymentIntentId);
    assert.ok(dtoAbsent.clientSecret);
    assert.equal(dtoAbsent.resourceLease, undefined);
    const storedA = await CheckoutSession.findOne({ checkoutId: dtoAbsent.checkoutId }).lean();
    assert.equal(storedA.resourceLease, null);
    assert.equal(await AccommodationCheckoutLease.countDocuments({}), 0);

    const stripeB = createFakeStripe();
    const dtoFalse = await ensureCanonicalPaymentIntent({
      input: legacyInput(),
      quote: buildFabricatedQuote(),
      stripe: stripeB,
      resourceLeaseGateEnabled: false
    });
    assert.equal(stripeB.__calls.create, 1);
    assert.ok(dtoFalse.canonicalPaymentIntentId);
    const storedB = await CheckoutSession.findOne({ checkoutId: dtoFalse.checkoutId }).lean();
    assert.equal(storedB.resourceLease, null);
  });

  it("3. Unknown injected / env gate values are OFF", async () => {
    assert.equal(
      isCheckoutResourceLeaseGateEnabled({ resourceLeaseGateEnabled: 'nope' }),
      false
    );
    const prev = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
    try {
      process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = 'maybe';
      assert.equal(isCheckoutResourceLeaseGateEnabled({}), false);
      const stripe = createFakeStripe();
      const dto = await ensureCanonicalPaymentIntent({
        input: legacyInput(),
        quote: buildFabricatedQuote(),
        stripe
      });
      assert.equal(stripe.__calls.create, 1);
      const stored = await CheckoutSession.findOne({ checkoutId: dto.checkoutId }).lean();
      assert.equal(stored.resourceLease, null);
    } finally {
      if (prev === undefined) delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
      else process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = prev;
    }
  });

  it('40. Gate-off after gated lease left on session still uses legacy ensure (no cleanup required)', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    assert.equal(first.resourceLease?.status, 'active');
    const piId = first.canonicalPaymentIntentId;
    const createsAfterGateOn = stripe.__calls.create;

    const replay = await ensureCanonicalPaymentIntent({
      checkoutId: first.checkoutId,
      input: cabinTypeInput(),
      quote: cabinTypeQuote(),
      stripe,
      resourceLeaseGateEnabled: false
    });
    assert.equal(stripe.__calls.create, createsAfterGateOn);
    assert.equal(replay.canonicalPaymentIntentId, piId);
    assert.equal(replay.resourceLease, undefined);
  });
});

describe('B8F3 gate-on happy paths (4–8, 17–19)', () => {
  it('4+5+8. Gate on: A2 non-voucher acquires lease before Stripe; lease durable', async () => {
    const id = checkoutId('a2');
    let sawLeaseBeforeStripe = false;
    const stripe = createFakeStripe({
      onCreate: async () => {
        const s = await CheckoutSession.findOne({ checkoutId: id }).lean();
        assert.equal(s?.resourceLease?.status, 'active');
        assert.ok(s.resourceLease.accommodation?.leaseId);
        assert.equal(s.resourceLease.voucherRedemptionId, null);
        sawLeaseBeforeStripe = true;
        assert.equal(stripe.__calls.create, 1);
      }
    });

    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote(),
        checkoutId: id
      })
    );

    assert.equal(sawLeaseBeforeStripe, true);
    assert.equal(stripe.__calls.create, 1);
    assert.equal(dto.resourceLease?.status, 'active');
    assert.ok(dto.canonicalPaymentIntentId);
    assert.ok(dto.clientSecret);
    assert.equal(dto.noPaymentRequired, false);
    const stored = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(stored.resourceLease.status, 'active');
    assert.equal(String(stored.resourceLease.paymentIntentId), dto.canonicalPaymentIntentId);
    assert.equal(await Booking.countDocuments({}), 0);
  });

  it('6. Voucher gated session uses B2 path (partial)', async () => {
    const voucher = await createVoucher();
    const stripe = createFakeStripe();
    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput({ voucherCode: voucher.code }),
        quote: cabinTypeQuote({
          voucherAppliedCents: 5000,
          remainingDueCents: 15000,
          fullVoucherCoverage: false,
          facilitySelections: [facilitySel('sauna-1', 10)],
          facilityTotal: 15
        })
      })
    );
    assert.equal(stripe.__calls.create, 1);
    assert.equal(dto.resourceLease?.status, 'active');
    assert.ok(dto.resourceLease.voucherRedemptionId);
    assert.ok(Array.isArray(
      (await CheckoutSession.findOne({ checkoutId: dto.checkoutId }).lean()).resourceLease
        .facilityHoldIds
    ));
    const v = await GiftVoucher.findById(voucher._id).lean();
    assert.equal(v.balanceRemainingCents, 15000);
  });

  it('7. Full voucher cold start from voucher_only_reserved: no PI / no secret', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('fullv');
    const { created, input, quote } = await createFullVoucherSession({
      id,
      code: voucher.code
    });
    assert.equal(created.session.status, 'voucher_only_reserved');
    assert.equal(created.session.paymentStatus, 'not_required');
    assert.equal(created.session.canonicalPaymentIntentId, null);

    const stripe = createFakeStripe();
    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: id,
        input,
        quote
      })
    );
    assert.equal(stripe.__calls.create, 0);
    assert.equal(stripe.__calls.retrieve, 0);
    assert.equal(dto.noPaymentRequired, true);
    assert.equal(dto.clientSecret, null);
    assert.equal(dto.canonicalPaymentIntentId, null);
    assert.equal(dto.resourceLease?.status, 'active');
    assert.ok(dto.resourceLease.voucherRedemptionId);
    const stored = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(stored.status, 'voucher_only_reserved');
    assert.ok(stored.resourceLease.accommodation?.leaseId);
    assert.equal(await Booking.countDocuments({}), 0);
  });

  it('7b. Ordinary non-voucher orchestrator rejects voucher_only_reserved', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('reject-vor');
    const { created } = await createFullVoucherSession({ id, code: voucher.code });
    assert.equal(created.session.status, 'voucher_only_reserved');
    await assert.rejects(
      () =>
        prepareCheckoutResourceBundle(
          { checkoutId: id },
          { clock, now: clock(), CheckoutSession, ...facilityDeps() }
        ),
      (err) => {
        assert.equal(err.code, 'RESOURCE_BUNDLE_UNSUPPORTED_VOUCHER');
        return true;
      }
    );
  });

  it('17+16. Exactly 60s remaining accepted; <60s → zero Stripe', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    assert.equal(stripe.__calls.create, 1);
    const id = first.checkoutId;

    // Leave exactly 60s on the lease / hold.
    advanceMs(BUNDLE_TTL_MS - DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS);
    stripe.__calls.create = 0;
    const atFloor = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: id,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    assert.equal(stripe.__calls.create, 0);
    assert.equal(atFloor.idempotentReplay, true);
    assert.equal(atFloor.canonicalPaymentIntentId, first.canonicalPaymentIntentId);

    // One more ms → below floor.
    advanceMs(1);
    stripe.__calls.create = 0;
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            checkoutId: id,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED);
        return true;
      }
    );
    assert.equal(stripe.__calls.create, 0);
  });

  it('18+19. Same generation reuses PI; lost-response replay returns same secret', async () => {
    const stripe = createFakeStripe();
    const input = cabinTypeInput();
    const quote = cabinTypeQuote();
    const first = await ensureCanonicalPaymentIntent(gatedArgs({ stripe, input, quote }));
    const gen = first.resourceLease.generation;
    stripe.__calls.create = 0;

    const replay = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: first.checkoutId,
        input,
        quote
      })
    );
    assert.equal(stripe.__calls.create, 0);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
    assert.equal(replay.clientSecret, first.clientSecret);
    assert.equal(replay.resourceLease.generation, gen);
  });
});

describe('B8F3 CAS / snapshot protection (9–13)', () => {
  it('9. Attach CAS failure → zero Stripe', async () => {
    const stripe = createFakeStripe();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote(),
            extra: {
              beforeFinalSessionCheck: async ({ checkoutId: cid }) => {
                await CheckoutSession.updateOne(
                  { checkoutId: cid },
                  { $inc: { sessionVersion: 1 } }
                );
              }
            }
          })
        ),
      (err) => {
        assert.ok(
          err.code === RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_SESSION_CAS_CONFLICT ||
            err.name === 'CheckoutResourceBundleError' ||
            err.name === 'CheckoutResourceLeaseError'
        );
        return true;
      }
    );
    assert.equal(stripe.__calls.create, 0);
  });

  it('10+12. Active lease blocks different-hash refresh; same-hash refresh idempotent', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );

    const same = await refreshCheckoutSessionQuote({
      checkoutId: first.checkoutId,
      input: cabinTypeInput(),
      quote: cabinTypeQuote()
    });
    assert.equal(same.idempotentLeaseProtectedRefresh, true);
    assert.equal(same.quoteSnapshotHashChanged, false);

    await assert.rejects(
      () =>
        refreshCheckoutSessionQuote({
          checkoutId: first.checkoutId,
          input: cabinTypeInput({ promoCode: 'SAVE10' }),
          quote: cabinTypeQuote({
            discountAmount: 10,
            totalPrice: 190,
            remainingDueCents: 19000,
            appliedPromoCode: 'SAVE10'
          })
        }),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_ACTIVE);
        return true;
      }
    );
  });

  it('11. Past validUntil with active lease + uncancelled PI still blocks snapshot refresh', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    advanceMs(BUNDLE_TTL_MS + 5_000);
    // Lease still status=active (reconciler not run); PI still open.
    await assert.rejects(
      () =>
        refreshCheckoutSessionQuote({
          checkoutId: first.checkoutId,
          input: cabinTypeInput({ promoCode: 'LATER' }),
          quote: cabinTypeQuote({
            discountAmount: 5,
            totalPrice: 195,
            remainingDueCents: 19500,
            appliedPromoCode: 'LATER'
          })
        }),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_ACTIVE);
        return true;
      }
    );
  });

  it('13. Concurrent refresh(new hash) vs lease attach — exactly one commercial winner', async () => {
    const stripe = createFakeStripe();
    // Start with an open session via ensure (gate off) so commercial boundary is established,
    // then race gated lease-attach against a different-hash refresh.
    const cold = await ensureCanonicalPaymentIntent({
      input: cabinTypeInput(),
      quote: cabinTypeQuote(),
      stripe: createFakeStripe(),
      resourceLeaseGateEnabled: false
    });
    const id = cold.checkoutId;
    // Clear legacy PI so gated acquire is allowed.
    await CheckoutSession.updateOne(
      { checkoutId: id },
      {
        $set: {
          canonicalPaymentIntentId: null,
          status: 'payment_required',
          paymentStatus: 'unpaid',
          resourceLease: null
        }
      }
    );

    let attachSawConflict = false;
    const refreshP = (async () => {
      // Slight delay so ensure can open the fence / approach attach.
      await new Promise((r) => setTimeout(r, 30));
      return refreshCheckoutSessionQuote({
        checkoutId: id,
        input: cabinTypeInput({ promoCode: 'RACE' }),
        quote: cabinTypeQuote({
          discountAmount: 20,
          totalPrice: 180,
          remainingDueCents: 18000,
          appliedPromoCode: 'RACE'
        })
      });
    })();
    const ensureP = ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: id,
        input: cabinTypeInput(),
        quote: cabinTypeQuote(),
        extra: {
          beforeFinalSessionCheck: async () => {
            // Give refresh a turn while fence is held, before durable lease attach.
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      })
    ).catch((err) => {
      if (err?.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_ACTIVE) {
        attachSawConflict = true;
      }
      throw err;
    });

    const settled = await Promise.allSettled([refreshP, ensureP]);
    const live = await CheckoutSession.findOne({ checkoutId: id }).lean();
    const leaseActive = live.resourceLease?.status === 'active';
    const refreshOk = settled[0].status === 'fulfilled';
    const ensureOk = settled[1].status === 'fulfilled';

    // Exactly one commercial identity must win: either lease protects original hash,
    // or refresh committed the new hash and lease attach lost.
    if (leaseActive) {
      assert.equal(live.quoteSnapshotHash, live.resourceLease.quoteSnapshotHash);
      assert.ok(ensureOk || attachSawConflict || settled[1].status === 'rejected');
      if (refreshOk && settled[0].value.quoteSnapshotHashChanged) {
        assert.fail('refresh must not change hash while protected lease is active');
      }
    } else {
      assert.equal(refreshOk, true);
      assert.equal(ensureOk, false);
      assert.equal(live.quoteSnapshot?.promoCode || live.quoteSnapshot?.appliedPromoCode, 'RACE');
    }
  });
});

describe('B8F3 PI / generation (14–15, 20–21, 35–39)', () => {
  it('14. PI claim includes lease generation in metadata + lease.paymentIntentId', async () => {
    const stripe = createFakeStripe();
    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    const pi = stripe.getPi(dto.canonicalPaymentIntentId);
    assert.equal(String(pi.metadata.resourceLeaseGeneration), String(dto.resourceLease.generation));
    assert.ok(pi.metadata.resourceLeaseValidUntil);
    const key = buildPaymentIntentIdempotencyKey(
      dto.checkoutId,
      dto.resourceLease.quoteSnapshotHash,
      dto.resourceLease.generation
    );
    assert.ok(stripe.__idempotencyStore.has(key));
    const stored = await CheckoutSession.findOne({ checkoutId: dto.checkoutId }).lean();
    assert.equal(String(stored.resourceLease.paymentIntentId), dto.canonicalPaymentIntentId);
  });

  it('15. Resource mismatch → zero Stripe on retry', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    const leaseId = first.resourceLease
      ? (await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean()).resourceLease
          .accommodation.leaseId
      : null;
    await releaseAccommodationCheckoutHold(
      first.checkoutId,
      { leaseId: String(leaseId) },
      { now: clock() }
    );
    // Clear PI so gated path does not take reuse; force re-verify / re-acquire path.
    await CheckoutSession.updateOne(
      { checkoutId: first.checkoutId },
      {
        $set: {
          canonicalPaymentIntentId: null,
          'resourceLease.paymentIntentId': null,
          status: 'payment_required',
          paymentStatus: 'unpaid'
        }
      }
    );

    stripe.__calls.create = 0;
    // Active lease still present but accommodation backing gone → verify fails before Stripe.
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            checkoutId: first.checkoutId,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.ok(
          err.code === RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED ||
            err.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH ||
            err.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_REQUIRED
        );
        return true;
      }
    );
    assert.equal(stripe.__calls.create, 0);
  });

  it('20. Expired lease never returns the old client secret', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    advanceMs(BUNDLE_TTL_MS + 1_000);
    stripe.__calls.create = 0;
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            checkoutId: first.checkoutId,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED);
        return true;
      }
    );
    assert.equal(stripe.__calls.create, 0);
  });

  it('21. Released generation automatically clears canonical PI; new gen uses new key without DB edits', async () => {
    const stripe = createFakeStripe();
    const input = cabinTypeInput();
    const quote = cabinTypeQuote();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input, quote })
    );
    const gen1 = first.resourceLease.generation;
    const piA = first.canonicalPaymentIntentId;
    const key1 = buildPaymentIntentIdempotencyKey(
      first.checkoutId,
      first.resourceLease.quoteSnapshotHash,
      gen1
    );
    assert.ok(stripe.__idempotencyStore.has(key1));

    advanceMs(BUNDLE_TTL_MS + 1_000);
    const recon = await reconcileDueResourceLeases({ stripe, limit: 10 }, { clock });
    const mine = recon.results.find((r) => r.checkoutId === first.checkoutId);
    assert.equal(mine.outcome, 'released');

    const afterRelease = await CheckoutSession.findOne({
      checkoutId: first.checkoutId
    }).lean();
    assert.equal(afterRelease.resourceLease.status, 'released');
    assert.equal(afterRelease.canonicalPaymentIntentId, null);
    assert.equal(afterRelease.status, 'payment_required');
    assert.equal(afterRelease.paymentStatus, 'unpaid');
    assert.ok((afterRelease.supersededPaymentIntentIds || []).map(String).includes(String(piA)));

    const second = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: first.checkoutId,
        input,
        quote
      })
    );
    const gen2 = second.resourceLease.generation;
    assert.ok(gen2 > gen1);
    const key2 = buildPaymentIntentIdempotencyKey(
      second.checkoutId,
      second.resourceLease.quoteSnapshotHash,
      gen2
    );
    assert.notEqual(key1, key2);
    assert.ok(stripe.__idempotencyStore.has(key2));
    assert.notEqual(second.canonicalPaymentIntentId, piA);
    assert.equal(second.resourceLease.status, 'active');
  });

  it('21b. Released partial-voucher session returns to payment_required/unpaid; new gen without DB edits', async () => {
    const voucher = await createVoucher();
    const stripe = createFakeStripe();
    const input = cabinTypeInput({ voucherCode: voucher.code });
    const quote = cabinTypeQuote({
      voucherAppliedCents: 5000,
      remainingDueCents: 15000,
      fullVoucherCoverage: false
    });
    const first = await ensureCanonicalPaymentIntent(gatedArgs({ stripe, input, quote }));
    const piA = first.canonicalPaymentIntentId;
    const gen1 = first.resourceLease.generation;
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const recon = await reconcileDueResourceLeases({ stripe, limit: 10 }, { clock });
    const mine = recon.results.find((r) => r.checkoutId === first.checkoutId);
    assert.equal(mine.outcome, 'released');
    const afterRelease = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(afterRelease.resourceLease.status, 'released');
    assert.equal(afterRelease.status, 'payment_required');
    assert.equal(afterRelease.paymentStatus, 'unpaid');
    assert.equal(afterRelease.canonicalPaymentIntentId, null);
    assert.ok((afterRelease.supersededPaymentIntentIds || []).map(String).includes(String(piA)));

    const second = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, checkoutId: first.checkoutId, input, quote })
    );
    assert.ok(second.resourceLease.generation > gen1);
    assert.notEqual(second.canonicalPaymentIntentId, piA);
    assert.equal(second.resourceLease.status, 'active');
  });

  it('35–39. Crash after attach before fence release is retryable without duplicate hold/voucher/PI', async () => {
    const voucher = await createVoucher();
    const stripe = createFakeStripe();
    let releaseCalls = 0;
    const releaseOnce = async (...args) => {
      releaseCalls += 1;
      if (releaseCalls === 1) {
        throw new Error('simulated crash after lease attach before fence release');
      }
      const fence = require('../services/checkout/checkoutResourceAttemptFenceService');
      return fence.releaseCheckoutResourceAttemptFence(...args);
    };

    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput({ voucherCode: voucher.code }),
            quote: cabinTypeQuote({
              voucherAppliedCents: 5000,
              remainingDueCents: 15000,
              facilitySelections: [facilitySel('sauna-1', 10)],
              facilityTotal: 15
            }),
            extra: {
              releaseCheckoutResourceAttemptFence: releaseOnce
            }
          })
        ),
      /simulated crash/
    );
    assert.equal(stripe.__calls.create, 0);

    const mid = await CheckoutSession.findOne({
      'resourceLease.status': 'active'
    }).lean();
    assert.ok(mid, 'lease should be attached before fence-release crash');
    const midGen = mid.resourceLease.generation;
    const midAttempt = mid.resourceLease.attemptId;
    const midVoucher = mid.resourceLease.voucherRedemptionId;
    const midFacilities = [...(mid.resourceLease.facilityHoldIds || [])];
    const midLeaseId = mid.resourceLease.accommodation?.leaseId;

    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: mid.checkoutId,
        input: cabinTypeInput({ voucherCode: voucher.code }),
        quote: cabinTypeQuote({
          voucherAppliedCents: 5000,
          remainingDueCents: 15000,
          facilitySelections: [facilitySel('sauna-1', 10)],
          facilityTotal: 15
        })
      })
    );

    assert.equal(stripe.__calls.uniqueCreated, 1);
    assert.equal(dto.resourceLease.generation, midGen);
    assert.equal(dto.resourceLease.attemptId, midAttempt);
    assert.equal(String(dto.resourceLease.voucherRedemptionId), String(midVoucher));

    const after = await CheckoutSession.findOne({ checkoutId: mid.checkoutId }).lean();
    assert.equal(String(after.resourceLease.accommodation.leaseId), String(midLeaseId));
    assert.deepEqual(
      (after.resourceLease.facilityHoldIds || []).map(String).sort(),
      midFacilities.map(String).sort()
    );

    const holds = await AccommodationCheckoutLease.countDocuments({
      checkoutId: mid.checkoutId,
      status: { $in: ['sealed', 'active', 'open'] }
    });
    assert.ok(holds <= 1);
    const v = await GiftVoucher.findById(voucher._id).lean();
    const debited = (v.reservationLedgerOperations || []).filter((o) => o.state === 'debited');
    assert.equal(debited.length, 1);
    assert.equal(await Booking.countDocuments({}), 0);
  });
});

describe('B8F3 Stripe failure + reconcile (22–34)', () => {
  it('22. Known Stripe rejection releases voucher→facilities→accommodation then lease released', async () => {
    const voucher = await createVoucher();
    const order = [];
    const stripe = createFakeStripe();
    stripe.throwKnownRejection();

    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput({ voucherCode: voucher.code }),
            quote: cabinTypeQuote({
              voucherAppliedCents: 5000,
              remainingDueCents: 15000,
              facilitySelections: [facilitySel('sauna-1', 10)],
              facilityTotal: 15
            }),
            extra: {
              releaseVoucherRedemptionV1: async (...args) => {
                order.push('voucher');
                const real = require('../services/giftVouchers/giftVoucherLedgerService');
                return real.releaseVoucherRedemptionV1(...args);
              },
              releaseFacilityHolds: async (...args) => {
                order.push('facilities');
                const real = require('../services/facilityBookingService');
                return real.releaseFacilityHolds(...args);
              },
              releaseAccommodationCheckoutHold: async (...args) => {
                order.push('accommodation');
                return releaseAccommodationCheckoutHold(...args);
              }
            }
          })
        ),
      (err) => {
        assert.ok(err.knownRejection || err.code === 'card_declined');
        return true;
      }
    );

    assert.deepEqual(order, ['voucher', 'facilities', 'accommodation']);
    const sessions = await CheckoutSession.find({}).lean();
    const withLease = sessions.find((s) => s.resourceLease);
    if (withLease) {
      assert.equal(withLease.resourceLease.status, 'released');
    }
    assert.equal(await getActiveAccommodationCheckoutHold(sessions[0]?.checkoutId, { now: clock() }), null);
  });

  it('23. Ambiguous Stripe create keeps resources / lease active', async () => {
    const stripe = createFakeStripe();
    stripe.throwAmbiguousAfterCreate();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS);
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({ 'resourceLease.status': 'active' }).lean();
    assert.ok(stored);
    assert.ok(await getActiveAccommodationCheckoutHold(stored.checkoutId, { now: clock() }));
  });

  it('24+25. PI created + claim fail → cancel success releases resources', async () => {
    originalFindOneAndUpdate = CheckoutSession.findOneAndUpdate.bind(CheckoutSession);
    let failBind = true;
    CheckoutSession.findOneAndUpdate = async function claimFailProxy(filter, update, options) {
      if (
        failBind &&
        filter &&
        filter['resourceLease.status'] === 'active' &&
        update?.$set?.canonicalPaymentIntentId
      ) {
        failBind = false;
        return null;
      }
      return originalFindOneAndUpdate(filter, update, options);
    };

    const stripe = createFakeStripe();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.ok(
          err instanceof CheckoutSessionError ||
            err.code === 'CHECKOUT_SESSION_CONCURRENCY_CONFLICT'
        );
        return true;
      }
    );
    assert.ok(stripe.__calls.cancel >= 1);
    const stored = await CheckoutSession.findOne({}).lean();
    assert.ok(stored);
    assert.equal(stored.resourceLease?.status, 'released');
    assert.equal(stored.canonicalPaymentIntentId, null);
  });

  it('26. Claim fail + cancel failure → cancel_pending, resources kept', async () => {
    originalFindOneAndUpdate = CheckoutSession.findOneAndUpdate.bind(CheckoutSession);
    let failBind = true;
    CheckoutSession.findOneAndUpdate = async function claimFailProxy(filter, update, options) {
      if (
        failBind &&
        filter &&
        filter['resourceLease.status'] === 'active' &&
        update?.$set?.canonicalPaymentIntentId
      ) {
        failBind = false;
        return null;
      }
      return originalFindOneAndUpdate(filter, update, options);
    };

    const stripe = createFakeStripe();
    stripe.setCancelBehavior('throw');
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS);
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({}).lean();
    assert.equal(stored.resourceLease.status, 'cancel_pending');
    assert.ok(await getActiveAccommodationCheckoutHold(stored.checkoutId, { now: clock() }));
  });

  it('27+28. Session paid / PI succeeded before expiry → marked paid, resources kept', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    advanceMs(BUNDLE_TTL_MS + 1_000);

    await CheckoutSession.updateOne(
      { checkoutId: first.checkoutId },
      { $set: { paymentStatus: 'paid', status: 'paid' } }
    );
    const paid = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.equal(paid.outcome, 'marked_paid_session');
    let stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'paid');

    // Fresh session for PI-succeeded path.
    frozenNow = new Date('2026-09-06T12:00:00.000Z');
    const stripe2 = createFakeStripe();
    const second = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe: stripe2,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    stripe2.setStatus(second.canonicalPaymentIntentId, 'succeeded');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const piPaid = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: second.checkoutId }).lean(),
        stripe: stripe2
      },
      { clock }
    );
    assert.equal(piPaid.outcome, 'marked_paid_pi_succeeded');
    stored = await CheckoutSession.findOne({ checkoutId: second.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'paid');
  });

  it('29+30. PI succeeded during cancel → paid; processing keeps resources', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    stripe.setCancelBehavior('succeed_during');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const during = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.equal(during.outcome, 'marked_paid_during_cancel');

    frozenNow = new Date('2026-09-06T12:00:00.000Z');
    const stripe2 = createFakeStripe();
    const second = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe: stripe2,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    stripe2.setStatus(second.canonicalPaymentIntentId, 'processing');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const proc = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: second.checkoutId }).lean(),
        stripe: stripe2
      },
      { clock }
    );
    assert.equal(proc.outcome, 'kept_processing');
    const stored = await CheckoutSession.findOne({ checkoutId: second.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'active');
  });

  it('31. Already-cancelled PI releases resources', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    stripe.setStatus(first.canonicalPaymentIntentId, 'canceled');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const result = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.equal(result.outcome, 'released');
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'released');
  });

  it('32. No-PI full-voucher expiry releases the bundle and restores voucher_only_reserved', async () => {
    const voucher = await createVoucher();
    const id = checkoutId('fvexp');
    const { input, quote } = await createFullVoucherSession({ id, code: voucher.code });
    const stripe = createFakeStripe();
    const dto = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, checkoutId: id, input, quote })
    );
    assert.equal(dto.noPaymentRequired, true);
    assert.equal(stripe.__calls.create, 0);
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const result = await reconcileDueResourceLeases({ stripe, limit: 10 }, { clock });
    const mine = result.results.find((r) => r.checkoutId === id);
    assert.ok(mine);
    assert.equal(mine.outcome, 'released');
    const stored = await CheckoutSession.findOne({ checkoutId: id }).lean();
    assert.equal(stored.resourceLease.status, 'released');
    assert.equal(stored.status, 'voucher_only_reserved');
    assert.equal(stored.paymentStatus, 'not_required');
    assert.equal(stored.canonicalPaymentIntentId, null);
    assert.equal(await getActiveAccommodationCheckoutHold(id, { now: clock() }), null);

    const again = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, checkoutId: id, input, quote })
    );
    assert.equal(again.noPaymentRequired, true);
    assert.equal(again.clientSecret, null);
    assert.equal(again.canonicalPaymentIntentId, null);
    assert.equal(again.resourceLease.status, 'active');
    assert.ok(again.resourceLease.generation > dto.resourceLease.generation);
    assert.equal(stripe.__calls.create, 0);
  });

  it('33. Stale reconciler cannot release a newer lease generation', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    const staleDoc = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    // Bump live generation without the stale doc knowing.
    await CheckoutSession.updateOne(
      { checkoutId: first.checkoutId },
      {
        $set: {
          'resourceLease.generation': Number(staleDoc.resourceLease.generation) + 1,
          'resourceLease.validUntil': new Date(clock().getTime() - 1000)
        }
      }
    );
    advanceMs(1);
    const result = await reconcileOneResourceLease(
      { sessionDoc: staleDoc, stripe },
      { clock }
    );
    assert.equal(result.outcome, 'skipped_stale_generation');
  });

  it('34. Partial resource release becomes needs_review', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    const live = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    await claimLeaseCancellationPending(
      {
        checkoutId: first.checkoutId,
        expectedGeneration: first.resourceLease.generation,
        quoteSnapshotHash: live.quoteSnapshotHash,
        paymentIntentId: first.canonicalPaymentIntentId,
        expectedSessionVersion: live.sessionVersion,
        reason: 'partial_test',
        allowNotDue: true
      },
      { clock }
    );
    await assert.rejects(
      () =>
        releaseExactResourceLeaseGeneration(
          {
            checkoutId: first.checkoutId,
            expectedGeneration: first.resourceLease.generation,
            reason: 'partial_test'
          },
          {
            clock,
            releaseAccommodationCheckoutHold: async () => {
              throw new Error('acc release failed');
            }
          }
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_RELEASE_INCOMPLETE);
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'needs_review');
    assert.ok(stored.canonicalPaymentIntentId);
  });
});

describe('B8F3 inertness (41)', () => {
  it('41. Lease services stay inert; FIXED_PACKAGE_NOT_PUBLICLY_ENABLED unchanged', async () => {
    const root = path.join(__dirname, '..');
    const leaseFiles = [
      path.join(root, 'services/checkout/checkoutResourceLeaseService.js'),
      path.join(root, 'services/checkout/checkoutResourceLeaseReconciliationService.js')
    ];
    const banned = [
      "require('../routes",
      "require('../../routes",
      'webhookHandler',
      'Booking.finalize',
      'finalizePaidCheckout',
      'executeBookingFinalizeWork',
      'node-cron',
      'setInterval(',
      'FIXED_PACKAGE_PUBLICLY'
    ];
    for (const file of leaseFiles) {
      const src = fs.readFileSync(file, 'utf8');
      for (const token of banned) {
        assert.equal(
          src.includes(token),
          false,
          `${path.basename(file)} must not reference ${token}`
        );
      }
    }
    const reconSrc = fs.readFileSync(leaseFiles[1], 'utf8');
    assert.ok(
      /No scheduler|never auto-runs/i.test(reconSrc),
      'reconciliation must remain callable-only (no auto scheduler)'
    );

    // Gated ensure path must not import Booking finalization / routes.
    const piSrc = fs.readFileSync(
      path.join(root, 'services/checkout/checkoutCanonicalPaymentIntentService.js'),
      'utf8'
    );
    const gatedSlice = piSrc.slice(
      piSrc.indexOf('ensureCanonicalPaymentIntentWithResourceLease'),
      piSrc.indexOf('async function assertCanonicalPaymentIntentForSession')
    );
    assert.equal(gatedSlice.includes("require('./finalizePaidCheckout')"), false);
    assert.equal(gatedSlice.includes('Booking.create'), false);
    assert.equal(gatedSlice.includes('../routes'), false);

    const quoteSrc = fs.readFileSync(
      path.join(root, 'services/bookingQuoteService.js'),
      'utf8'
    );
    assert.ok(quoteSrc.includes('FIXED_PACKAGE_NOT_PUBLICLY_ENABLED'));

    assert.equal(DEFAULT_RESOURCE_BUNDLE_MINIMUM_REMAINING_MS, 60_000);
    assert.equal(DEFAULT_RESOURCE_LEASE_MINIMUM_REMAINING_MS, 60_000);
    assert.equal(await Booking.countDocuments({}), 0);
  });
});

describe('B8F3 correction proofs (bind CAS, cancel-claim, acc generation)', () => {
  it('Bind CAS rejects wrong lease hash; no secret; orphan cancelled', async () => {
    const stripe = createFakeStripe();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote(),
            extra: {
              beforeBindPaymentIntent: async ({ checkoutId: cid }) => {
                await CheckoutSession.updateOne(
                  { checkoutId: cid },
                  { $set: { 'resourceLease.quoteSnapshotHash': 'ab'.repeat(32) } }
                );
              }
            }
          })
        ),
      (err) => {
        assert.ok(
          err.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH ||
            err.code === 'CHECKOUT_SESSION_CONCURRENCY_CONFLICT' ||
            err.code === RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS
        );
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({}).lean();
    assert.ok(stored);
    assert.notEqual(stored.resourceLease?.status, 'active');
    assert.equal(stored.canonicalPaymentIntentId, null);
    assert.ok(stripe.__calls.create >= 1);
    assert.ok(stripe.__calls.cancel >= 1);
  });

  it('Bind CAS rejects expired lease; no secret; PI not canonical until cancel proven', async () => {
    const stripe = createFakeStripe();
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            input: cabinTypeInput(),
            quote: cabinTypeQuote(),
            extra: {
              beforeBindPaymentIntent: async () => {
                advanceMs(BUNDLE_TTL_MS + 5_000);
              }
            }
          })
        ),
      (err) => {
        assert.ok(
          err.code === RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_EXPIRED ||
            err.code === 'CHECKOUT_SESSION_CONCURRENCY_CONFLICT' ||
            err.code === RESOURCE_LEASE_ERROR_CODES.PAYMENT_INTENT_OUTCOME_AMBIGUOUS
        );
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({}).lean();
    assert.equal(stored.canonicalPaymentIntentId, null);
    assert.ok(stripe.__calls.create >= 1);
    if (stored.resourceLease.status === 'cancel_pending') {
      assert.ok(await getActiveAccommodationCheckoutHold(stored.checkoutId, { now: clock() }));
    }
    if (stored.resourceLease.status === 'released') {
      assert.equal(await getActiveAccommodationCheckoutHold(stored.checkoutId, { now: clock() }), null);
    }
  });

  it('Bind CAS rejects wrong generation', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    const live = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    await assert.rejects(
      () =>
        bindPaymentIntentToResourceLease(
          {
            checkoutId: first.checkoutId,
            expectedGeneration: Number(first.resourceLease.generation) + 7,
            expectedQuoteSnapshotHash: live.quoteSnapshotHash,
            expectedAttemptId: first.resourceLease.attemptId,
            paymentIntentId: 'pi_wrong_gen',
            expectedSessionVersion: live.sessionVersion
          },
          { clock }
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_MISMATCH);
        return true;
      }
    );
    const after = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(after.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
  });

  it('Bind CAS accepts exact idempotent replay only', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    const live = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    const replay = await bindPaymentIntentToResourceLease(
      {
        checkoutId: first.checkoutId,
        expectedGeneration: first.resourceLease.generation,
        expectedQuoteSnapshotHash: live.quoteSnapshotHash,
        expectedAttemptId: first.resourceLease.attemptId,
        paymentIntentId: first.canonicalPaymentIntentId,
        expectedSessionVersion: live.sessionVersion
      },
      { clock }
    );
    assert.equal(String(replay.canonicalPaymentIntentId), first.canonicalPaymentIntentId);
    assert.equal(replay.resourceLease.status, 'active');
  });

  it('Reconciler writes cancel_pending before Stripe cancel; ensure returns no secret', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    advanceMs(BUNDLE_TTL_MS + 1_000);
    let sawPendingBeforeCancel = false;
    let ensureDuring = null;
    const recon = reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      {
        clock,
        beforeStripeCancel: async () => {
          const mid = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
          assert.equal(mid.resourceLease.status, 'cancel_pending');
          sawPendingBeforeCancel = true;
          ensureDuring = await ensureCanonicalPaymentIntent(
            gatedArgs({
              stripe: createFakeStripe(),
              checkoutId: first.checkoutId,
              input: cabinTypeInput(),
              quote: cabinTypeQuote()
            })
          ).catch((err) => err);
        }
      }
    );
    const result = await recon;
    assert.equal(sawPendingBeforeCancel, true);
    assert.equal(result.outcome, 'released');
    assert.ok(ensureDuring);
    assert.equal(ensureDuring.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING);
    assert.equal(ensureDuring.clientSecret, undefined);
  });

  it('Snapshot refresh and new generation are blocked during cancel_pending', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    const live = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    await claimLeaseCancellationPending(
      {
        checkoutId: first.checkoutId,
        expectedGeneration: first.resourceLease.generation,
        quoteSnapshotHash: live.quoteSnapshotHash,
        paymentIntentId: first.canonicalPaymentIntentId,
        expectedSessionVersion: live.sessionVersion,
        reason: 'barrier_test',
        allowNotDue: true
      },
      { clock }
    );
    await assert.rejects(
      () =>
        refreshCheckoutSessionQuote({
          checkoutId: first.checkoutId,
          input: cabinTypeInput({ promoCode: 'BLOCKED' }),
          quote: cabinTypeQuote({
            discountAmount: 10,
            totalPrice: 190,
            remainingDueCents: 19000,
            appliedPromoCode: 'BLOCKED'
          })
        }),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_ACTIVE);
        return true;
      }
    );
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            checkoutId: first.checkoutId,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(
          err.code,
          RESOURCE_LEASE_ERROR_CODES.CHECKOUT_RESOURCE_LEASE_CANCELLATION_PENDING
        );
        return true;
      }
    );
  });

  it('Crash after cancellation claim resumes safely without duplicate release', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const crashDoc = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    await assert.rejects(
      () =>
        reconcileOneResourceLease(
          { sessionDoc: crashDoc, stripe },
          {
            clock,
            afterClaimCancellation: async () => {
              throw new Error('crash after cancel claim');
            }
          }
        ),
      /crash after cancel claim/
    );
    const mid = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(mid.resourceLease.status, 'cancel_pending');
    assert.ok(mid.canonicalPaymentIntentId);

    const resumed = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.equal(resumed.outcome, 'released');
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'released');
    assert.equal(stored.canonicalPaymentIntentId, null);
  });

  it('Two reconcilers cannot both authorize resource release', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const doc = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    let releaseGate;
    const wait = new Promise((resolve) => {
      releaseGate = resolve;
    });
    let firstInCancel = false;
    const p1 = reconcileOneResourceLease(
      { sessionDoc: doc, stripe },
      {
        clock,
        beforeStripeCancel: async () => {
          firstInCancel = true;
          await wait;
        }
      }
    );
    while (!firstInCancel) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10));
    }
    const p2 = reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    releaseGate();
    const settled = await Promise.all([p1, p2]);
    const released = settled.filter((r) => r.outcome === 'released');
    assert.ok(released.length >= 1);
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'released');
    assert.equal(stored.canonicalPaymentIntentId, null);
    assert.equal(await getActiveAccommodationCheckoutHold(first.checkoutId, { now: clock() }), null);
  });

  it('Payment succeeds during cancellation; resources remain held', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    stripe.setCancelBehavior('succeed_during');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const result = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.equal(result.outcome, 'marked_paid_during_cancel');
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'paid');
    assert.equal(stored.canonicalPaymentIntentId, first.canonicalPaymentIntentId);
    const hold = await AccommodationCheckoutLease.findOne({
      checkoutId: first.checkoutId,
      status: { $in: ['sealed', 'active', 'open'] }
    }).lean();
    assert.ok(hold, 'payment-wins must not release the accommodation hold');
    assert.notEqual(hold.status, 'released');
  });

  it('PI becomes processing during cancellation; resources remain held', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    stripe.setCancelBehavior('processing_during');
    advanceMs(BUNDLE_TTL_MS + 1_000);
    const result = await reconcileOneResourceLease(
      {
        sessionDoc: await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean(),
        stripe
      },
      { clock }
    );
    assert.ok(
      result.outcome === 'kept_processing_after_cancel' || result.outcome === 'marked_paid_during_cancel'
    );
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.ok(['paid', 'cancel_pending'].includes(stored.resourceLease.status));
    assert.ok(stored.canonicalPaymentIntentId);
    const hold = await AccommodationCheckoutLease.findOne({
      checkoutId: first.checkoutId,
      status: { $in: ['sealed', 'active', 'open'] }
    }).lean();
    assert.ok(hold, 'processing-wins must not release the accommodation hold');
    assert.notEqual(hold.status, 'released');
  });

  it('Stale reconciler cannot clear a newer canonical PI', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    const staleDoc = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    advanceMs(BUNDLE_TTL_MS + 1_000);
    await reconcileDueResourceLeases({ stripe, limit: 5 }, { clock });
    const second = await ensureCanonicalPaymentIntent(
      gatedArgs({
        stripe,
        checkoutId: first.checkoutId,
        input: cabinTypeInput(),
        quote: cabinTypeQuote()
      })
    );
    const newerPi = second.canonicalPaymentIntentId;
    const stale = await reconcileOneResourceLease({ sessionDoc: staleDoc, stripe }, { clock });
    assert.equal(stale.outcome, 'skipped_stale_generation');
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.canonicalPaymentIntentId, newerPi);
    assert.equal(stored.resourceLease.status, 'active');
  });

  it('Accommodation generation mismatch blocks Stripe and release', async () => {
    const stripe = createFakeStripe();
    const first = await ensureCanonicalPaymentIntent(
      gatedArgs({ stripe, input: cabinTypeInput(), quote: cabinTypeQuote() })
    );
    await CheckoutSession.updateOne(
      { checkoutId: first.checkoutId },
      { $set: { 'resourceLease.accommodation.generation': 999 } }
    );
    stripe.__calls.create = 0;
    await assert.rejects(
      () =>
        ensureCanonicalPaymentIntent(
          gatedArgs({
            stripe,
            checkoutId: first.checkoutId,
            input: cabinTypeInput(),
            quote: cabinTypeQuote()
          })
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_VERIFICATION_FAILED);
        return true;
      }
    );
    assert.equal(stripe.__calls.create, 0);

    const live = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    await claimLeaseCancellationPending(
      {
        checkoutId: first.checkoutId,
        expectedGeneration: first.resourceLease.generation,
        quoteSnapshotHash: live.quoteSnapshotHash,
        paymentIntentId: first.canonicalPaymentIntentId,
        expectedSessionVersion: live.sessionVersion,
        reason: 'acc_gen_mismatch',
        allowNotDue: true
      },
      { clock }
    );
    await assert.rejects(
      () =>
        releaseExactResourceLeaseGeneration(
          {
            checkoutId: first.checkoutId,
            expectedGeneration: first.resourceLease.generation
          },
          { clock }
        ),
      (err) => {
        assert.equal(err.code, RESOURCE_LEASE_ERROR_CODES.RESOURCE_LEASE_RELEASE_INCOMPLETE);
        return true;
      }
    );
    const stored = await CheckoutSession.findOne({ checkoutId: first.checkoutId }).lean();
    assert.equal(stored.resourceLease.status, 'needs_review');
    assert.ok(await getActiveAccommodationCheckoutHold(first.checkoutId, { now: clock() }));
  });
});

describe('B8F3 Correction 1 — markExactResourceLeasePaidForFinalize CAS', () => {
  it('Concurrent different attemptIds: only matching attempt wins', async () => {
    const created = await createCheckoutSession({
      input: {
        cabinTypeId: String(cabinTypeId),
        checkIn: '2026-10-10',
        checkOut: '2026-10-12',
        adults: 2,
        children: 0,
        experienceKeys: [],
        guestEmail: 'b8f3cas@example.com'
      },
      quote: {
        entityType: 'cabinType',
        entity: {
          _id: cabinTypeId,
          minNights: 1,
          capacity: 2,
          pricingModel: 'per_night'
        },
        checkInDate: new Date('2026-10-10T12:00:00.000Z'),
        checkOutDate: new Date('2026-10-12T12:00:00.000Z'),
        subtotalPrice: 200,
        discountAmount: 0,
        totalPrice: 200,
        remainingDueCents: 20000,
        voucherAppliedCents: 0,
        fullVoucherCoverage: false,
        appliedPromoCode: ''
      }
    });
    const session = created.session;
    const bookingId = new mongoose.Types.ObjectId();
    const attemptId = `att_b8f3_cas_${crypto.randomBytes(4).toString('hex')}`;
    const wrongAttempt = `att_b8f3_wrong_${crypto.randomBytes(4).toString('hex')}`;
    const leaseId = `lease_b8f3_cas_${crypto.randomBytes(4).toString('hex')}`;
    const pi = `pi_b8f3_cas_${crypto.randomBytes(4).toString('hex')}`;
    const generation = 1;
    session.flowVersion = 'v2';
    session.finalizeStatus = 'in_progress';
    session.bookingId = bookingId;
    session.canonicalPaymentIntentId = pi;
    session.paymentStatus = 'paid';
    session.stripeAmountCents = 20000;
    session.resourceLease = {
      status: 'active',
      generation,
      attemptId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      validUntil: new Date(Date.now() + 60 * 60 * 1000),
      activatedAt: new Date(),
      updatedAt: new Date(),
      paymentIntentId: pi,
      facilityHoldIds: [],
      accommodation: {
        holdId: leaseId,
        leaseId,
        generation,
        entityType: 'unit',
        unitId: unitIds[0]
      }
    };
    await session.save();

    const base = {
      checkoutId: session.checkoutId,
      expectedGeneration: generation,
      expectedQuoteSnapshotHash: session.quoteSnapshotHash,
      expectedAccommodationLeaseId: leaseId,
      expectedBookingId: bookingId,
      paymentMode: 'stripe',
      expectedPaymentIntentId: pi
    };
    const settled = await Promise.allSettled([
      markExactResourceLeasePaidForFinalize({ ...base, expectedAttemptId: attemptId }),
      markExactResourceLeasePaidForFinalize({ ...base, expectedAttemptId: wrongAttempt })
    ]);
    assert.equal(settled.filter((s) => s.status === 'fulfilled').length, 1);
    assert.equal(settled.filter((s) => s.status === 'rejected').length, 1);
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.resourceLease.status, 'paid');
    assert.equal(live.resourceLease.attemptId, attemptId);
  });
});
