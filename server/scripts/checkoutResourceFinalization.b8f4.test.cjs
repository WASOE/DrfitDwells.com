/**
 * B8F4B — Lease-aware paid finalization matrix (MongoMemoryServer).
 * Real production services. Fake Stripe only. Gate env left unset.
 *
 * Run: node --test server/scripts/checkoutResourceFinalization.b8f4.test.cjs
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const CheckoutSession = require('../models/CheckoutSession');
const AccommodationCheckoutLease = require('../models/AccommodationCheckoutLease');
const UnitNightClaim = require('../models/UnitNightClaim');
const CabinNightClaim = require('../models/CabinNightClaim');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const FacilityReservation = require('../models/FacilityReservation');

const {
  CHECKOUT_SESSION_ERROR_CODES,
  CheckoutSessionError
} = require('../services/checkout/checkoutSessionErrors');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');
const { hashQuoteSnapshot } = require('../services/checkout/checkoutSessionSnapshot');
const {
  buildValidatedFinalizeIntent,
  hashFinalizeIntent
} = require('../services/checkout/finalizeIntentService');
const { FINALIZE_STATUS } = require('../services/checkout/checkoutFinalizeService');
const {
  DOMAIN_VERIFICATION_CODES,
  finalizePaidCheckout,
  isLeaseAwareFinalizeSession
} = require('../services/checkout/finalizePaidCheckout');
const {
  acquireAccommodationCheckoutHold,
  ensureLeaseIndexesForTests,
  promoteAccommodationCheckoutHoldToBooking,
  proveFullVoucherPaidAuthority
} = require('../services/checkout/accommodationCheckoutHoldService');
const {
  ensureResourceLeaseIndexesForTests,
  markExactResourceLeasePaidForFinalize
} = require('../services/checkout/checkoutResourceLeaseService');
const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');
const {
  ensureVoucherLedgerIndexesForTests,
  confirmVoucherRedemptionV1
} = require('../services/giftVouchers/giftVoucherLedgerService');
const {
  acquireCheckoutResourceAttemptFence,
  ensureCheckoutResourceAttemptIndexesForTests
} = require('../services/checkout/checkoutResourceAttemptFenceService');
const {
  reserveExactVoucherAmountForAttempt,
  sealAttemptVoucherReservation
} = require('../services/giftVouchers/giftVoucherAttemptReservationService');
const {
  ensureFacilityReservationUniqueIndexForTests,
  confirmExactFacilityHoldsForPaidCheckout
} = require('../services/facilityBookingService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const AMOUNT_CENTS = 20000;
const FAC_DAY = '2027-01-15';

let mongoServer;
let cabinTypeId;
let parentCabinId;
let unitIds = [];
let luxCabinId;
let seq = 0;

const ORIG_SIDE = process.env.FINALIZE_SIDE_EFFECTS;
const ORIG_EXECUTE = process.env.FINALIZE_JOB_EXECUTE;
const ORIG_DOMAIN = process.env.FINALIZE_DOMAIN_SERVICE;
const ORIG_GATE = process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;

function restoreEnv() {
  if (ORIG_SIDE === undefined) delete process.env.FINALIZE_SIDE_EFFECTS;
  else process.env.FINALIZE_SIDE_EFFECTS = ORIG_SIDE;
  if (ORIG_EXECUTE === undefined) delete process.env.FINALIZE_JOB_EXECUTE;
  else process.env.FINALIZE_JOB_EXECUTE = ORIG_EXECUTE;
  if (ORIG_DOMAIN === undefined) delete process.env.FINALIZE_DOMAIN_SERVICE;
  else process.env.FINALIZE_DOMAIN_SERVICE = ORIG_DOMAIN;
  if (ORIG_GATE === undefined) delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  else process.env.CHECKOUT_RESOURCE_LEASE_ENABLED = ORIG_GATE;
}

function checkoutId(label = 'co') {
  seq += 1;
  return `co_b8f4b_${label}_${seq}_${crypto.randomBytes(3).toString('hex')}`;
}

function attemptId(label = 'att') {
  return `att_b8f4b_${label}_${crypto.randomBytes(4).toString('hex')}`;
}

function depsHold(overrides = {}) {
  return {
    now: new Date(),
    loadExclusiveFixedPackages: async () => [],
    candidateSoftAvailable: async () => true,
    ...overrides
  };
}

function buildIntentBody(overrides = {}) {
  return {
    guestInfo: {
      firstName: 'Lease',
      lastName: 'Aware',
      email: 'b8f4b@example.com',
      phone: '+359888000444',
      ...(overrides.guestInfo || {})
    },
    specialRequests: '',
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    },
    experienceKeys: [],
    romanticSetup: false,
    ...overrides
  };
}

function createStripeStub(piById) {
  const store = new Map(Object.entries(piById || {}));
  return {
    paymentIntents: {
      retrieve: async (id) => {
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error('No such payment_intent');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi };
      }
    }
  };
}

function buildSucceededPi({
  session,
  paymentIntentId,
  finalizeIntentHash,
  amountCents = null,
  status = 'succeeded',
  currency = 'eur',
  metadataOverrides = {}
}) {
  const snapshot = session.quoteSnapshot || {};
  const amount = amountCents != null ? amountCents : session.stripeAmountCents;
  return {
    id: paymentIntentId,
    object: 'payment_intent',
    status,
    amount,
    amount_received: amount,
    currency,
    metadata: {
      flowVersion: 'v2',
      checkoutId: session.checkoutId,
      quoteSnapshotHash: session.quoteSnapshotHash,
      finalizeIntentHash: finalizeIntentHash || session.finalizeIntentHash || '',
      cabinId: snapshot.cabinId || '',
      cabinTypeId: snapshot.cabinTypeId || '',
      checkIn: snapshot.checkInISO || `${STAY_IN}T12:00:00.000Z`,
      checkOut: snapshot.checkOutISO || `${STAY_OUT}T12:00:00.000Z`,
      ...metadataOverrides
    }
  };
}

function stripeFor(session, paymentIntentId, piOverrides = {}) {
  const pi = buildSucceededPi({
    session,
    paymentIntentId,
    finalizeIntentHash: session.finalizeIntentHash,
    ...piOverrides
  });
  return { stripe: createStripeStub({ [pi.id]: pi }), pi };
}

function voucherConfirmDeps(extra = {}) {
  return {
    stripe: null,
    confirmVoucherReservation: async ({ redemptionId, actor, note }) =>
      confirmVoucherRedemptionV1({ redemptionId, actor, note }),
    ...extra
  };
}

async function reopenForRetry(cid, status = 'pi_active') {
  await CheckoutSession.updateOne(
    { checkoutId: cid },
    { $set: { finalizeStatus: FINALIZE_STATUS.OPEN, status } }
  );
}

/** Persist resourceLease mutations, bypassing mongoose enum so fail-closed statuses can be seeded. */
async function persistResourceLeaseRaw(checkoutId, resourceLease) {
  await CheckoutSession.collection.updateOne({ checkoutId }, { $set: { resourceLease } });
  return CheckoutSession.findOne({ checkoutId });
}

async function assertCheckoutOwnedClaimsOnly(leaseId) {
  assert.equal(await UnitNightClaim.countDocuments({ leaseId, ownerType: 'booking' }), 0);
  assert.equal(await CabinNightClaim.countDocuments({ leaseId, ownerType: 'booking' }), 0);
  const checkoutUnit = await UnitNightClaim.countDocuments({ leaseId, ownerType: 'checkout' });
  const checkoutCabin = await CabinNightClaim.countDocuments({ leaseId, ownerType: 'checkout' });
  assert.ok(checkoutUnit + checkoutCabin >= 1, 'expected checkout-owned claims to remain');
}

async function crashAfterTombstone({ holdCtx, mode = 'unit', facilityHoldIds = [] }) {
  const seeded = await seedLeasedStripeSession({ holdCtx, mode, facilityHoldIds });
  const { session, paymentIntentId, hold } = seeded;
  const { stripe } = stripeFor(session, paymentIntentId);
  let once = true;
  let bookingId = null;
  await assert.rejects(
    () =>
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: {
          stripe,
          beforeMarkFinalizeSucceeded: async ({ bookingId: id }) => {
            bookingId = String(id);
            if (!once) return;
            once = false;
            const err = new Error('inject_before_success');
            err.needsReview = true;
            throw err;
          }
        }
      }),
    assertNeedsReviewErr
  );
  assert.equal(
    (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
    'converted'
  );
  assert.ok(bookingId);
  return { ...seeded, stripe, bookingId };
}

async function seedInventory({ units = 5 } = {}) {
  seq += 1;
  const suffix = `${Date.now().toString(36)}-${seq}`;
  const cabinType = await CabinType.create({
    name: `B8F4B CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f4b',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/a.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  cabinTypeId = cabinType._id;
  parentCabinId = (
    await Cabin.create({
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
    })
  )._id;
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
  await ensureResourceLeaseIndexesForTests();
  await ensureVoucherLedgerIndexesForTests();
  await ensureCheckoutResourceAttemptIndexesForTests();
  await ensureFacilityReservationUniqueIndexForTests();
}

async function acquireUnitHold(label = 'unit') {
  const id = checkoutId(label);
  const hold = await acquireAccommodationCheckoutHold(
    {
      checkoutId: id,
      bookingContext: 'normal',
      entityType: 'cabinType',
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      accommodationKey: 'a-frame'
    },
    depsHold()
  );
  assert.equal(hold.status, 'sealed');
  assert.equal(hold.entityType, 'unit');
  return { checkoutId: id, hold, attemptId: attemptId(label) };
}

async function acquireCabinHold(label = 'cabin', cabinId = luxCabinId) {
  const id = checkoutId(label);
  const hold = await acquireAccommodationCheckoutHold(
    {
      checkoutId: id,
      bookingContext: 'normal',
      entityType: 'cabin',
      cabinId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      accommodationKey: 'luxury'
    },
    depsHold()
  );
  assert.equal(hold.status, 'sealed');
  assert.equal(hold.unitId, null);
  assert.equal(hold.entityType, 'cabin');
  return { checkoutId: id, hold, attemptId: attemptId(label) };
}

async function createSealedFullVoucher({ checkoutId: cid, quoteSnapshotHash, amountCents = AMOUNT_CENTS }) {
  const code = `DD-B8F4B-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${String(seq).padStart(4, '0')}`;
  const voucher = await GiftVoucher.create({
    code,
    amountOriginalCents: Math.max(25000, amountCents),
    balanceRemainingCents: Math.max(25000, amountCents),
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: new Date('2027-12-01T00:00:00.000Z'),
    reservationLedgerOperations: []
  });
  const now = new Date();
  const fence = await acquireCheckoutResourceAttemptFence(
    {
      checkoutId: cid,
      quoteSnapshotHash,
      bundleValidUntil: new Date(now.getTime() + 30 * 60 * 1000)
    },
    { now }
  );
  const reserved = await reserveExactVoucherAmountForAttempt(
    {
      checkoutId: cid,
      acquisitionAttemptId: fence.attemptId,
      quoteSnapshotHash,
      voucherCode: voucher.code,
      amountCents,
      currency: 'EUR'
    },
    { now }
  );
  const sealed = await sealAttemptVoucherReservation(
    {
      checkoutId: cid,
      acquisitionAttemptId: fence.attemptId,
      quoteSnapshotHash,
      redemptionId: reserved.redemptionId
    },
    { now }
  );
  return {
    redemptionId: String(sealed.redemptionId),
    operationId: String(sealed.operationId)
  };
}

function cabinTypeQuote(overrides = {}) {
  return {
    entityType: 'cabinType',
    entity: {
      _id: cabinTypeId,
      minNights: 1,
      capacity: 2,
      pricingModel: 'per_night'
    },
    checkInDate: new Date(`${STAY_IN}T12:00:00.000Z`),
    checkOutDate: new Date(`${STAY_OUT}T12:00:00.000Z`),
    subtotalPrice: AMOUNT_CENTS / 100,
    discountAmount: 0,
    totalPrice: AMOUNT_CENTS / 100,
    remainingDueCents: AMOUNT_CENTS,
    voucherAppliedCents: 0,
    fullVoucherCoverage: false,
    appliedPromoCode: '',
    ...overrides
  };
}

function cabinQuote(cabinId, overrides = {}) {
  return {
    entityType: 'cabin',
    entity: {
      _id: cabinId,
      minNights: 1,
      capacity: 2,
      pricingModel: 'per_night'
    },
    checkInDate: new Date(`${STAY_IN}T12:00:00.000Z`),
    checkOutDate: new Date(`${STAY_OUT}T12:00:00.000Z`),
    subtotalPrice: AMOUNT_CENTS / 100,
    discountAmount: 0,
    totalPrice: AMOUNT_CENTS / 100,
    remainingDueCents: AMOUNT_CENTS,
    voucherAppliedCents: 0,
    fullVoucherCoverage: false,
    appliedPromoCode: '',
    ...overrides
  };
}

async function attachFinalizeIntent(session, bodyOverrides = {}) {
  const intent = buildValidatedFinalizeIntent({
    body: buildIntentBody(bodyOverrides),
    requestMeta: { ip: '127.0.0.1', userAgent: 'B8F4BTest', acceptLanguage: 'en' },
    capturedAt: new Date('2026-01-01T00:00:00.000Z'),
    quoteSnapshot: session.quoteSnapshot
  });
  session.finalizeIntent = intent;
  session.finalizeIntentHash = hashFinalizeIntent(intent);
  session.finalizeIntentCapturedAt = intent.capturedAt;
  return intent;
}

function legalAcceptanceBlock(firstName = 'Lease', lastName = 'Aware') {
  return {
    termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
    activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
    acceptedAt: new Date(),
    firstName,
    lastName,
    checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
    checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
  };
}

async function createFacilityHold(cid, lane = 0, overrides = {}) {
  const start =
    overrides.startTime ||
    new Date(`${FAC_DAY}T${String(10 + lane).padStart(2, '0')}:00:00.000Z`);
  const end = overrides.endTime || new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return FacilityReservation.create({
    facilityCode: overrides.facilityCode || 'sauna-1',
    slotStart: start,
    capacityLane: lane,
    startTime: start,
    endTime: end,
    status: 'hold',
    checkoutSessionId: cid,
    holdExpiresAt: overrides.holdExpiresAt || new Date(Date.now() + 60 * 60 * 1000),
    addOnCode: overrides.addOnCode || 'sauna-firewood-pack',
    addOnVersion: overrides.addOnVersion != null ? overrides.addOnVersion : 1,
    acquisitionAttemptId:
      overrides.acquisitionAttemptId !== undefined ? overrides.acquisitionAttemptId : null,
    priceSnapshot: {
      currency: 'EUR',
      amount: overrides.amount != null ? overrides.amount : 15,
      chargeUnit: overrides.chargeUnit || 'per_firing',
      addOnCode: overrides.addOnCode || 'sauna-firewood-pack',
      addOnVersion: overrides.addOnVersion != null ? overrides.addOnVersion : 1
    }
  });
}

function quoteSelectionFromHold(hold) {
  const start = new Date(hold.startTime || hold.slotStart);
  const end = new Date(hold.endTime);
  const amount = hold.priceSnapshot && hold.priceSnapshot.amount != null ? hold.priceSnapshot.amount : 15;
  const chargeUnit =
    (hold.priceSnapshot && hold.priceSnapshot.chargeUnit) || 'per_firing';
  const addOnCode = hold.addOnCode || 'sauna-firewood-pack';
  const addOnVersion = hold.addOnVersion != null ? hold.addOnVersion : 1;
  return {
    facilityCode: hold.facilityCode,
    facilityName: 'Sauna',
    selfLed: true,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    slotStart: start.toISOString(),
    addOn: {
      code: addOnCode,
      version: addOnVersion,
      publicName: 'Firewood pack',
      currency: 'EUR',
      amount,
      chargeUnit,
      includedItems: []
    },
    addOnCode,
    addOnVersion,
    amount,
    currency: 'EUR',
    chargeUnit,
    priceSnapshot: {
      currency: 'EUR',
      amount,
      chargeUnit,
      addOnCode,
      addOnVersion
    }
  };
}

async function seedLeasedStripeSession({
  holdCtx,
  amountCents = AMOUNT_CENTS,
  resourceLeaseStatus = 'active',
  mode = 'unit',
  facilityHoldIds = [],
  quoteSnapshotPatch = null,
  autoFacilitySelections = true
} = {}) {
  const { checkoutId: cid, hold, attemptId: att } = holdCtx;
  const paymentIntentId = `pi_b8f4b_${crypto.randomBytes(8).toString('hex')}`;
  const isCabin = mode === 'cabin';
  const created = await createCheckoutSession({
    checkoutId: cid,
    input: isCabin
      ? {
          cabinId: String(hold.cabinId || luxCabinId),
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          adults: 2,
          children: 0,
          experienceKeys: [],
          guestEmail: 'b8f4b@example.com'
        }
      : {
          cabinTypeId: String(cabinTypeId),
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          adults: 2,
          children: 0,
          experienceKeys: [],
          guestEmail: 'b8f4b@example.com'
        },
    quote: isCabin
      ? cabinQuote(hold.cabinId || luxCabinId, {
          remainingDueCents: amountCents,
          totalPrice: amountCents / 100
        })
      : cabinTypeQuote({ remainingDueCents: amountCents, totalPrice: amountCents / 100 })
  });
  const session = created.session;

  const patch = { ...(quoteSnapshotPatch || {}) };
  if (
    autoFacilitySelections &&
    Array.isArray(facilityHoldIds) &&
    facilityHoldIds.length > 0 &&
    patch.facilitySelections == null
  ) {
    const holds = await FacilityReservation.find({ _id: { $in: facilityHoldIds } });
    patch.facilitySelections = holds.map((h) => quoteSelectionFromHold(h));
  }

  if (Object.keys(patch).length > 0) {
    const snap =
      session.quoteSnapshot && typeof session.quoteSnapshot.toObject === 'function'
        ? session.quoteSnapshot.toObject()
        : { ...(session.quoteSnapshot || {}) };
    Object.assign(snap, patch);
    session.quoteSnapshot = snap;
    session.markModified('quoteSnapshot');
    session.quoteSnapshotHash = hashQuoteSnapshot(snap);
  }

  await attachFinalizeIntent(session);
  const validUntil = new Date(Date.now() + 60 * 60 * 1000);
  session.canonicalPaymentIntentId = paymentIntentId;
  session.status = 'pi_active';
  session.paymentStatus = 'paid';
  session.stripeAmountCents = amountCents;
  session.giftVoucherAppliedCents = 0;
  session.finalizeStatus = FINALIZE_STATUS.OPEN;
  session.bookingId = null;
  session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  session.resourceLease = {
    status: resourceLeaseStatus,
    generation: hold.generation,
    attemptId: att,
    quoteSnapshotHash: session.quoteSnapshotHash,
    validUntil,
    activatedAt: new Date(),
    updatedAt: new Date(),
    paymentIntentId,
    facilityHoldIds: facilityHoldIds.map(String),
    voucherRedemptionId: null,
    voucherOperationId: null,
    accommodation: {
      holdId: hold.leaseId,
      leaseId: hold.leaseId,
      generation: hold.generation,
      cabinId: hold.cabinId,
      unitId: hold.unitId,
      entityType: hold.entityType
    }
  };
  await session.save();
  return {
    session,
    paymentIntentId,
    finalizeIntentHash: session.finalizeIntentHash,
    hold,
    attemptId: att
  };
}

async function seedLeasedVoucherSession({ holdCtx, amountCents = AMOUNT_CENTS } = {}) {
  const { checkoutId: cid, hold, attemptId: att } = holdCtx;
  const created = await createCheckoutSession({
    checkoutId: cid,
    input: {
      cabinTypeId: String(cabinTypeId),
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      adults: 2,
      children: 0,
      experienceKeys: [],
      guestEmail: 'b8f4b@example.com'
    },
    quote: cabinTypeQuote({
      remainingDueCents: 0,
      voucherAppliedCents: amountCents,
      fullVoucherCoverage: true,
      totalPrice: amountCents / 100
    })
  });
  const session = created.session;
  const snap =
    session.quoteSnapshot && typeof session.quoteSnapshot.toObject === 'function'
      ? session.quoteSnapshot.toObject()
      : { ...(session.quoteSnapshot || {}) };
  snap.totalCents = amountCents;
  snap.remainingDueCents = 0;
  snap.voucherAppliedCents = amountCents;
  snap.stripeAmountCents = 0;
  snap.fullVoucherCoverage = true;
  session.quoteSnapshot = snap;
  session.markModified('quoteSnapshot');
  session.quoteSnapshotHash = hashQuoteSnapshot(snap);

  const sealed = await createSealedFullVoucher({
    checkoutId: cid,
    quoteSnapshotHash: session.quoteSnapshotHash,
    amountCents
  });

  await attachFinalizeIntent(session);
  const validUntil = new Date(Date.now() + 60 * 60 * 1000);
  session.status = 'voucher_only_reserved';
  session.paymentStatus = 'not_required';
  session.stripeAmountCents = 0;
  session.giftVoucherAppliedCents = amountCents;
  session.canonicalPaymentIntentId = null;
  session.voucherRedemptionId = sealed.redemptionId;
  session.finalizeStatus = FINALIZE_STATUS.OPEN;
  session.bookingId = null;
  session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  session.resourceLease = {
    status: 'active',
    generation: hold.generation,
    attemptId: att,
    quoteSnapshotHash: session.quoteSnapshotHash,
    validUntil,
    activatedAt: new Date(),
    updatedAt: new Date(),
    paymentIntentId: null,
    facilityHoldIds: [],
    voucherRedemptionId: sealed.redemptionId,
    voucherOperationId: sealed.operationId,
    accommodation: {
      holdId: hold.leaseId,
      leaseId: hold.leaseId,
      generation: hold.generation,
      cabinId: hold.cabinId,
      unitId: hold.unitId,
      entityType: hold.entityType
    }
  };
  await session.save();
  return { session, hold, attemptId: att, sealed };
}

async function seedLegacyCabinSession() {
  const cabin = await Cabin.create({
    name: `Legacy ${seq}`,
    description: 'legacy',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const paymentIntentId = `pi_legacy_${crypto.randomBytes(6).toString('hex')}`;
  const created = await createCheckoutSession({
    input: {
      cabinId: String(cabin._id),
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      adults: 2,
      children: 0,
      experienceKeys: [],
      guestEmail: 'legacy@example.com'
    },
    quote: cabinQuote(cabin._id)
  });
  const session = created.session;
  await attachFinalizeIntent(session, {
    guestInfo: {
      firstName: 'Legacy',
      lastName: 'Guest',
      email: 'legacy@example.com',
      phone: '+359888000111'
    }
  });
  session.canonicalPaymentIntentId = paymentIntentId;
  session.status = 'pi_active';
  session.paymentStatus = 'paid';
  session.stripeAmountCents = AMOUNT_CENTS;
  session.finalizeStatus = FINALIZE_STATUS.OPEN;
  session.bookingId = null;
  session.expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  await session.save();
  return { session, paymentIntentId, cabin };
}

async function createExactBooking({ session, paymentIntentId, hold, bookingId = null }) {
  const doc = {
    checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
    checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Lease',
      lastName: 'Aware',
      email: 'b8f4b@example.com',
      phone: '+359888000444'
    },
    totalPrice: 200,
    subtotalPrice: 200,
    paymentMethod: 'stripe',
    status: 'confirmed',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: session.stayFingerprint,
    legalAcceptance: legalAcceptanceBlock()
  };
  if (bookingId) doc._id = bookingId;
  if (hold.entityType === 'unit') {
    doc.cabinTypeId = cabinTypeId;
    doc.unitId = hold.unitId;
  } else {
    doc.cabinId = hold.cabinId || luxCabinId;
  }
  return Booking.create(doc);
}

function assertNeedsReviewErr(err) {
  return (
    err.needsReview === true ||
    err.requiresManualReview === true ||
    [
      'LEASE_FINALIZE_NEEDS_REVIEW',
      'RESOURCE_LEASE_PAID_FAILED',
      'ACCOMMODATION_PROMOTION_FAILED',
      'FACILITY_CONFIRM_FAILED',
      'ACCOMMODATION_TOMBSTONE_FAILED',
      'VOUCHER_CONFIRM_FAILED',
      CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
    ].includes(err.code)
  );
}

before(async () => {
  delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { directConnection: true });
  await ensureIndexes();
  await seedInventory({ units: 5 });
});

after(async () => {
  restoreEnv();
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  restoreEnv();
  delete process.env.CHECKOUT_RESOURCE_LEASE_ENABLED;
  process.env.FINALIZE_JOB_EXECUTE = '0';
  process.env.FINALIZE_SIDE_EFFECTS = '0';
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    UnitNightClaim.deleteMany({}),
    CabinNightClaim.deleteMany({}),
    AccommodationCheckoutLease.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    GiftVoucher.deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    FacilityReservation.deleteMany({})
  ]);
});

describe('B8F4B happy paths (1–6, 11, 14, 20, 42)', () => {
  it('1. Legacy no-lease finalization', async () => {
    const { session, paymentIntentId } = await seedLegacyCabinSession();
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.ok(await Booking.findById(result.bookingId));
    const reloaded = await CheckoutSession.findOne({ checkoutId: session.checkoutId });
    assert.equal(reloaded.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  });

  it('2. Lease-aware Stripe success', async () => {
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    const holdCtx = await acquireUnitHold('stripe_ok');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal(result.jobHints?.sideEffects?.confirmationEmail?.queued, true);
    const booking = await Booking.findById(result.bookingId);
    assert.equal(String(booking.unitId), String(hold.unitId));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id, ownerType: 'booking' }), 2);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.resourceLease.status, 'paid');
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  });

  it('3. Full-voucher without Stripe', async () => {
    const holdCtx = await acquireUnitHold('voucher_ok');
    const { session, hold } = await seedLeasedVoucherSession({ holdCtx });
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      source: 'frontend',
      dependencies: voucherConfirmDeps()
    });
    assert.equal(result.ok, true);
    const booking = await Booking.findById(result.bookingId);
    assert.equal(booking.paymentMethod, 'gift_voucher');
    assert.equal(String(booking.unitId), String(hold.unitId));
    assert.equal((await GiftVoucherRedemption.findById(session.voucherRedemptionId).lean()).status, 'confirmed');
  });

  it('4. Stable Booking ID before promotion (hooks)', async () => {
    const holdCtx = await acquireUnitHold('bind');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let boundId = null;
    let atPromote = null;
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        afterBookingIdBind: async ({ bookingId }) => {
          boundId = String(bookingId);
          assert.equal(await Booking.countDocuments({}), 0);
        },
        afterAccommodationPromote: async ({ bookingId }) => {
          atPromote = String(bookingId);
          assert.equal(await Booking.countDocuments({}), 0);
        }
      }
    });
    assert.equal(String(result.bookingId), boundId);
    assert.equal(atPromote, boundId);
  });

  it('5. Concurrent workers → one Booking ID', async () => {
    const holdCtx = await acquireUnitHold('conc_id');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const settled = await Promise.allSettled([
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      }),
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'webhook_worker',
        dependencies: { stripe }
      })
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    assert.ok(ok.length >= 1);
    assert.equal(new Set(ok.map((r) => String(r.bookingId))).size, 1);
  });

  it('6. Concurrent workers → one Booking', async () => {
    const holdCtx = await acquireUnitHold('conc_doc');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    await Promise.allSettled([
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      }),
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      }),
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      })
    ]);
    assert.equal(await Booking.countDocuments({}), 1);
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  });

  it('11. Existing exact Booking adoption continues lease work', async () => {
    const holdCtx = await acquireUnitHold('adopt');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const existing = await createExactBooking({ session, paymentIntentId, hold });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal(String(result.bookingId), String(existing._id));
    assert.equal(await Booking.countDocuments({}), 1);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: existing._id, ownerType: 'booking' }), 2);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }), 0);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.FINALIZED);
    assert.equal(live.resourceLease.status, 'paid');
  });

  it('14. No-facility path skips confirmation', async () => {
    const holdCtx = await acquireUnitHold('nofac');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let confirmed = null;
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        afterFacilityConfirm: async ({ confirmedIds }) => {
          confirmed = confirmedIds;
        }
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(confirmed, []);
    const booking = await Booking.findById(result.bookingId);
    assert.deepEqual(booking.resourceFinalizationSnapshot.expectedFacilityReservationIds, []);
    assert.deepEqual(booking.resourceFinalizationSnapshot.confirmedFacilityReservationIds, []);
  });

  it('20. Tombstone success', async () => {
    const holdCtx = await acquireUnitHold('tomb_ok');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let tombstoned = false;
    await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        afterAccommodationTombstone: async () => {
          tombstoned = true;
        }
      }
    });
    assert.equal(tombstoned, true);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.equal(header.status, 'converted');
    assert.equal(header.isLive, false);
  });

  it('42. Gate disabled after payment still finalizes', async () => {
    assert.equal(process.env.CHECKOUT_RESOURCE_LEASE_ENABLED, undefined);
    const holdCtx = await acquireUnitHold('gate_off');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
  });
});

describe('B8F4B crash / recovery (7–10, 12, 17–19, 21–23)', () => {
  it('7. Partial Unit promotion recovery', async () => {
    const holdCtx = await acquireUnitHold('partial_u');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let promoted = 0;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            onAfterClaimPromoted: async () => {
              promoted += 1;
              if (promoted === 1) {
                const err = new Error('inject_partial_unit');
                err.code = 'inject_partial_unit';
                throw err;
              }
            }
          }
        }),
      assertNeedsReviewErr
    );
    const mid = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.ok(mid.bookingId);
    assert.equal(mid.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
    assert.ok(await UnitNightClaim.countDocuments({ bookingId: mid.bookingId, ownerType: 'booking' }) >= 1);

    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(String(retry.bookingId), String(mid.bookingId));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: mid.bookingId, ownerType: 'booking' }), 2);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
  });

  it('8. Partial Cabin promotion recovery', async () => {
    const holdCtx = await acquireCabinHold('partial_c');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      mode: 'cabin'
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    let promoted = 0;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            onAfterClaimPromoted: async () => {
              promoted += 1;
              if (promoted === 1) {
                const err = new Error('inject_partial_cabin');
                err.code = 'inject_partial_cabin';
                throw err;
              }
            }
          }
        }),
      assertNeedsReviewErr
    );
    const mid = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.ok(mid.bookingId);
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(String(retry.bookingId), String(mid.bookingId));
    assert.equal(await CabinNightClaim.countDocuments({ bookingId: mid.bookingId, ownerType: 'booking' }), 2);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
  });

  it('9. Crash after promotion before Booking', async () => {
    const holdCtx = await acquireUnitHold('crash_promo');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let boundId = null;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterBookingIdBind: async ({ bookingId }) => {
              boundId = String(bookingId);
            },
            afterAccommodationPromote: async () => {
              const err = new Error('inject_after_promote');
              err.code = 'ACCOMMODATION_PROMOTION_FAILED';
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    const mid = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(mid.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
    assert.equal(String(mid.bookingId), boundId);
    assert.equal(await Booking.countDocuments({}), 0);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: boundId, ownerType: 'booking' }), 2);

    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(String(retry.bookingId), boundId);
    assert.ok(await Booking.findById(boundId));
  });

  it('10. Booking retry uses same _id', async () => {
    const holdCtx = await acquireUnitHold('same_id');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let boundId = null;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterBookingIdBind: async ({ bookingId }) => {
              boundId = String(bookingId);
            },
            afterBookingSave: async () => {
              const err = new Error('inject_after_save');
              err.code = 'PAID_BOOKING_SAVE_FAILED';
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    assert.ok(await Booking.findById(boundId));
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(String(retry.bookingId), boundId);
    assert.equal(await Booking.countDocuments({}), 1);
  });

  it('12. Foreign Booking conflict', async () => {
    const holdCtx = await acquireUnitHold('foreign');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterAccommodationPromote: async ({ bookingId }) => {
              await Booking.create({
                _id: new mongoose.Types.ObjectId(String(bookingId)),
                cabinTypeId,
                unitId: unitIds[0],
                checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
                checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
                adults: 2,
                children: 0,
                guestInfo: {
                  firstName: 'Foreign',
                  lastName: 'Owner',
                  email: 'foreign@example.com',
                  phone: '+359888000999'
                },
                totalPrice: 200,
                paymentMethod: 'stripe',
                status: 'confirmed',
                checkoutId: checkoutId('foreign_owner'),
                legalAcceptance: legalAcceptanceBlock('Foreign', 'Owner')
              });
            }
          }
        }),
      assertNeedsReviewErr
    );
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
    assert.ok(live.bookingId);
  });

  it('17. Facility confirmation retry (afterFacilityConfirm crash)', async () => {
    const holdCtx = await acquireUnitHold('fac_retry');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    let once = true;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterFacilityConfirm: async () => {
              if (!once) return;
              once = false;
              const err = new Error('inject_fac_confirm');
              err.code = 'FACILITY_CONFIRM_FAILED';
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: holdCtx.hold.leaseId }).lean()).status,
      'converting'
    );
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: holdCtx.hold.leaseId }).lean()).status,
      'converted'
    );
  });

  it('18. Crash after facility confirmation', async () => {
    const holdCtx = await acquireUnitHold('fac_crash');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    let once = true;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterBookingFacilitySnapshot: async () => {
              if (!once) return;
              once = false;
              const err = new Error('inject_after_fac_snap');
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
  });

  it('19. Confirmed IDs persisted before tombstone', async () => {
    const holdCtx = await acquireUnitHold('fac_order');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    let sawSnapshot = false;
    let headerAtSnapshot = null;
    await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        afterBookingFacilitySnapshot: async ({ bookingId, confirmedIds }) => {
          sawSnapshot = true;
          assert.ok(confirmedIds.map(String).includes(String(fac._id)));
          const booking = await Booking.findById(bookingId).lean();
          assert.ok(
            (booking.resourceFinalizationSnapshot.confirmedFacilityReservationIds || [])
              .map(String)
              .includes(String(fac._id))
          );
          headerAtSnapshot = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
          assert.equal(headerAtSnapshot.status, 'converting');
        },
        afterAccommodationTombstone: async () => {
          assert.equal(sawSnapshot, true);
          assert.equal(headerAtSnapshot.status, 'converting');
        }
      }
    });
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
  });

  it('21. Tombstone failure and retry', async () => {
    const holdCtx = await acquireUnitHold('tomb_fail');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    let once = true;
    // Fail before tombstone CAS so header stays converting (retryable tombstone stage).
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterBookingFacilitySnapshot: async () => {
              if (!once) return;
              once = false;
              const err = new Error('inject_tombstone_stage');
              err.code = 'ACCOMMODATION_TOMBSTONE_FAILED';
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converting');
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
  });

  it('22. Crash after tombstone (beforeMarkFinalizeSucceeded)', async () => {
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    const holdCtx = await acquireUnitHold('after_tomb');
    const { session, paymentIntentId, hold, stripe, bookingId } = await crashAfterTombstone({
      holdCtx
    });
    assert.ok(await Booking.countDocuments({ checkoutId: session.checkoutId }) >= 1);
    assert.equal(await EmailDeliveryState.countDocuments({}), 0);

    // Natural retry only — header stays converted (no converted→converting rewind).
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
    assert.equal(String(retry.bookingId), String(bookingId));
    assert.equal(
      (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).finalizeStatus,
      FINALIZE_STATUS.FINALIZED
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
      'converted'
    );
    assert.equal(await EmailDeliveryState.countDocuments({}), 1);
  });

  it('23. Session-success retry', async () => {
    const holdCtx = await acquireUnitHold('success_retry');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const first = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    const second = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(second.idempotentReplay, true);
    assert.equal(String(second.bookingId), String(first.bookingId));
    assert.equal(await Booking.countDocuments({}), 1);
  });
});

describe('B8F4B facilities (13, 15–16)', () => {
  it('13. Facility success', async () => {
    const holdCtx = await acquireUnitHold('fac_ok');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    const booking = await Booking.findById(result.bookingId).lean();
    assert.ok(
      booking.resourceFinalizationSnapshot.confirmedFacilityReservationIds
        .map(String)
        .includes(String(fac._id))
    );
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
    assert.equal(String((await FacilityReservation.findById(fac._id).lean()).bookingId), String(result.bookingId));
  });

  it('15. Facility missing failure', async () => {
    const holdCtx = await acquireUnitHold('fac_miss');
    const fakeId = new mongoose.Types.ObjectId();
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fakeId]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await EmailDeliveryState.countDocuments({}), 0);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converting');
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
  });

  it('16. Facility foreign-owner failure', async () => {
    const holdCtx = await acquireUnitHold('fac_foreign');
    const foreign = await createFacilityHold(checkoutId('other_fac'), 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [foreign._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await FacilityReservation.findById(foreign._id).lean()).status, 'hold');
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converting');
  });
});

describe('B8F4B email ordering (24–25)', () => {
  it('24. Email only after all resource steps', async () => {
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    const holdCtx = await acquireUnitHold('email_order');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const order = [];
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterAccommodationPromote: async () => order.push('promote'),
            afterBookingSave: async () => order.push('save'),
            afterBookingFacilitySnapshot: async () => {
              order.push('fac_snap');
              const err = new Error('inject_before_tombstone');
              err.needsReview = true;
              throw err;
            },
            afterAccommodationTombstone: async () => order.push('tombstone')
          }
        }),
      assertNeedsReviewErr
    );
    assert.ok(order.includes('promote'));
    assert.ok(order.includes('save'));
    assert.equal(order.includes('tombstone'), false);
    assert.equal(await EmailDeliveryState.countDocuments({}), 0);

    await reopenForRetry(session.checkoutId);
    const ok = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(ok.jobHints?.sideEffects?.confirmationEmail?.queued, true);
    assert.ok(await EmailDeliveryState.countDocuments({}) >= 1);
  });

  it('25. Email replay protection preserved', async () => {
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    const holdCtx = await acquireUnitHold('email_replay');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const first = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(first.jobHints?.sideEffects?.confirmationEmail?.queued, true);
    const emailCount = await EmailDeliveryState.countDocuments({});
    assert.ok(emailCount >= 1);
    const second = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(second.idempotentReplay, true);
    assert.equal(await EmailDeliveryState.countDocuments({}), emailCount);
  });
});

describe('B8F4B payment / lease rejection (26–37, 43–44)', () => {
  it('26. Wrong canonical PI rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_pi');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    const wrongId = `pi_other_${crypto.randomBytes(4).toString('hex')}`;
    const pi = buildSucceededPi({
      session,
      paymentIntentId: wrongId,
      finalizeIntentHash: session.finalizeIntentHash
    });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId: wrongId,
          source: 'frontend',
          dependencies: { stripe: createStripeStub({ [wrongId]: pi }) }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.NONCANONICAL_PAYMENT_INTENT
    );
    assert.equal(await Booking.countDocuments({ checkoutId: session.checkoutId }), 0);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'booking' }), 0);
    void paymentIntentId;
  });

  it('27. Wrong amount rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_amt');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId, { amountCents: 19999 });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.AMOUNT_MISMATCH
    );
  });

  it('28. Wrong currency rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_cur');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId, { currency: 'usd' });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.CURRENCY_MISMATCH
    );
  });

  it('29. Wrong quote hash rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_qhash');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId, {
      metadataOverrides: { quoteSnapshotHash: 'qs_tampered_hash' }
    });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.QUOTE_SNAPSHOT_HASH_MISMATCH
    );
  });

  it('30. Wrong generation rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_gen');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    session.resourceLease.generation = hold.generation + 99;
    session.resourceLease.accommodation.generation = hold.generation + 99;
    session.markModified('resourceLease');
    await session.save();
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await Booking.countDocuments({ checkoutId: session.checkoutId }), 0);
  });

  it('31. Wrong attempt rejection', async () => {
    const holdCtx = await acquireUnitHold('bad_att');
    const { session, paymentIntentId, hold, attemptId: correctAtt } = await seedLeasedStripeSession({
      holdCtx
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    // Fence converting under the correct attempt, then crash before claim mutation.
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            onAfterHeaderConverting: async () => {
              const err = new Error('inject_after_converting');
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
      'converting'
    );
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }), 2);

    const wrongAtt = `att_wrong_${crypto.randomBytes(4).toString('hex')}`;
    assert.notEqual(wrongAtt, correctAtt);
    await CheckoutSession.updateOne(
      { checkoutId: session.checkoutId },
      {
        $set: {
          finalizeStatus: FINALIZE_STATUS.OPEN,
          status: 'pi_active',
          'resourceLease.attemptId': wrongAtt
        }
      }
    );

    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) =>
        assertNeedsReviewErr(err) ||
        err.code === 'RESOURCE_LEASE_PAID_FAILED' ||
        err.code === 'ACCOMMODATION_PROMOTION_FAILED' ||
        /attemptId/i.test(err.message || '')
    );
    assert.equal(await Booking.countDocuments({ checkoutId: session.checkoutId }), 0);
    assert.equal(await UnitNightClaim.countDocuments({ ownerType: 'booking', convertedFromLeaseId: hold.leaseId }), 0);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }), 2);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.notEqual(header.status, 'converted');
    assert.equal(String(header.conversionAttemptId || ''), String(correctAtt));
  });

  it('32. Expired but succeeded paid lease finalizes', async () => {
    const holdCtx = await acquireUnitHold('expired_ok');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      resourceLeaseStatus: 'expired'
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status, 'converted');
  });

  it('33. Processing PI does not finalize', async () => {
    const holdCtx = await acquireUnitHold('proc');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId, { status: 'processing' });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.PAYMENT_NOT_SUCCEEDED
    );
  });

  it('34. Cancelled PI does not finalize', async () => {
    const holdCtx = await acquireUnitHold('cancel');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId, { status: 'canceled' });
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      (err) => err.verificationErrorCode === DOMAIN_VERIFICATION_CODES.PAYMENT_NOT_SUCCEEDED
    );
  });

  it('35. Full-voucher amount mismatch rejection', async () => {
    const holdCtx = await acquireUnitHold('v_amt');
    const { session } = await seedLeasedVoucherSession({ holdCtx });
    session.giftVoucherAppliedCents = AMOUNT_CENTS - 1;
    await session.save();
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          source: 'frontend',
          dependencies: voucherConfirmDeps()
        }),
      assertNeedsReviewErr
    );
    assert.equal(await Booking.countDocuments({}), 0);
  });

  it('36. Full-voucher redemption mismatch rejection', async () => {
    const holdCtx = await acquireUnitHold('v_red');
    const { session } = await seedLeasedVoucherSession({ holdCtx });
    session.resourceLease.voucherRedemptionId = new mongoose.Types.ObjectId();
    session.markModified('resourceLease');
    await session.save();
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          source: 'frontend',
          dependencies: voucherConfirmDeps()
        }),
      assertNeedsReviewErr
    );
  });

  it('37. Full-voucher operation mismatch rejection', async () => {
    const holdCtx = await acquireUnitHold('v_op');
    const { session } = await seedLeasedVoucherSession({ holdCtx });
    session.resourceLease.voucherOperationId = 'op_tampered';
    session.markModified('resourceLease');
    await session.save();
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          source: 'frontend',
          dependencies: voucherConfirmDeps()
        }),
      assertNeedsReviewErr
    );
  });

  it('43. Released lease fails closed', async () => {
    const holdCtx = await acquireUnitHold('released');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      resourceLeaseStatus: 'released'
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'checkout' }), 2);
    assert.equal(await Booking.countDocuments({}), 0);
  });

  it('44. Needs-review lease fails closed', async () => {
    const holdCtx = await acquireUnitHold('nr_lease');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      resourceLeaseStatus: 'needs_review'
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'booking' }), 0);
  });
});

describe('B8F4B snapshot / client fields (38–41)', () => {
  it('38. Booking financial snapshot exactness', async () => {
    const holdCtx = await acquireUnitHold('fin_snap');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    const snap = (await Booking.findById(result.bookingId).lean()).resourceFinalizationSnapshot;
    assert.equal(snap.currency, 'EUR');
    assert.equal(snap.paymentAuthorityType, 'stripe');
    assert.equal(snap.stripeAmountCents, AMOUNT_CENTS);
    assert.equal(snap.canonicalPaymentIntentId, paymentIntentId);
    assert.equal(Number(snap.resourceLeaseGeneration), Number(session.resourceLease.generation));
  });

  it('39. Facility snapshot exactness', async () => {
    const holdCtx = await acquireUnitHold('fac_snap');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    const snap = (await Booking.findById(result.bookingId).lean()).resourceFinalizationSnapshot;
    assert.deepEqual(snap.expectedFacilityReservationIds.map(String), [String(fac._id)]);
    assert.deepEqual(snap.confirmedFacilityReservationIds.map(String), [String(fac._id)]);
  });

  it('40. Package/rate-plan/policy snapshot exactness when present', async () => {
    const holdCtx = await acquireUnitHold('rate_snap');
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      quoteSnapshotPatch: {
        ratePlan: { code: 'STD', version: 1, type: 'nightly', currency: 'EUR' },
        ratePlanCode: 'STD',
        ratePlanVersion: '1',
        cancellationPolicySnapshot: { code: 'flex', version: 1 },
        bookingType: null
      }
    });
    // Keep lease hash aligned after snapshot patch.
    session.resourceLease.quoteSnapshotHash = session.quoteSnapshotHash;
    session.markModified('resourceLease');
    await session.save();
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    const snap = (await Booking.findById(result.bookingId).lean()).resourceFinalizationSnapshot;
    assert.equal(snap.ratePlanCode, 'STD');
    assert.ok(snap.cancellationPolicy);
  });

  it('41. Client commercial fields ignored', async () => {
    const holdCtx = await acquireUnitHold('client_ign');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      confirmBody: {
        guestInfo: {
          firstName: 'Lease',
          lastName: 'Aware',
          email: 'b8f4b@example.com',
          phone: '+359888000444'
        },
        totalPrice: 9999,
        remainingDueCents: 1,
        participants: [{ category: 'evil', count: 99 }],
        facilitySelections: [{ facilityCode: 'evil-facility', quantity: 9 }],
        ratePlan: { code: 'EVIL', version: 99 },
        package: { code: 'EVIL_PKG' },
        cancellationPolicy: { code: 'evil-policy' }
      },
      dependencies: { stripe }
    });
    const booking = await Booking.findById(result.bookingId);
    assert.equal(booking.guestInfo.email, 'b8f4b@example.com');
    assert.equal(Number(booking.totalPrice), 200);
    const snap = booking.resourceFinalizationSnapshot;
    assert.notEqual(snap.ratePlanCode, 'EVIL');
    assert.equal(snap.participants == null || !Array.isArray(snap.participants) || snap.participants.every((p) => p.category !== 'evil'), true);
  });
});

describe('B8F4B Correction 1 — fail-closed selector (never legacy)', () => {
  async function assertFailClosedMutation(label, mutate) {
    const holdCtx = await acquireUnitHold(label);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    assert.equal(isLeaseAwareFinalizeSession(session), true);
    const rl =
      session.resourceLease && typeof session.resourceLease.toObject === 'function'
        ? session.resourceLease.toObject()
        : { ...(session.resourceLease || {}) };
    mutate(rl, session);
    const live = await persistResourceLeaseRaw(session.checkoutId, rl);
    assert.equal(isLeaseAwareFinalizeSession(live), true, `${label} must stay lease-aware`);
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await Booking.countDocuments({ checkoutId: session.checkoutId }), 0);
    await assertCheckoutOwnedClaimsOnly(hold.leaseId);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: hold.leaseId, ownerType: 'booking' }), 0);
  }

  it('resourceLease: {} fails closed', async () => {
    const holdCtx = await acquireUnitHold('fc_empty');
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({ holdCtx });
    await persistResourceLeaseRaw(session.checkoutId, {});
    assert.equal(
      isLeaseAwareFinalizeSession(await CheckoutSession.findOne({ checkoutId: session.checkoutId })),
      true
    );
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(await Booking.countDocuments({}), 0);
    await assertCheckoutOwnedClaimsOnly(hold.leaseId);
  });

  it('missing status fails closed', async () => {
    await assertFailClosedMutation('fc_miss_st', (rl) => {
      delete rl.status;
    });
  });

  it('null status fails closed', async () => {
    await assertFailClosedMutation('fc_null_st', (rl) => {
      rl.status = null;
    });
  });

  it('empty-string status fails closed', async () => {
    await assertFailClosedMutation('fc_empty_st', (rl) => {
      rl.status = '';
    });
  });

  it('typo status paidish fails closed', async () => {
    await assertFailClosedMutation('fc_paidish', (rl) => {
      rl.status = 'paidish';
    });
  });

  it('unknown future status fails closed', async () => {
    await assertFailClosedMutation('fc_future', (rl) => {
      rl.status = 'future_status_x';
    });
  });

  it('missing accommodation lease identity fails closed', async () => {
    await assertFailClosedMutation('fc_no_acc', (rl) => {
      rl.accommodation = {};
    });
  });

  it('malformed generation fails closed', async () => {
    await assertFailClosedMutation('fc_gen_str', (rl) => {
      rl.generation = 'x';
      if (rl.accommodation) rl.accommodation.generation = 'x';
    });
    await assertFailClosedMutation('fc_gen_0', (rl) => {
      rl.generation = 0;
      if (rl.accommodation) rl.accommodation.generation = 0;
    });
  });

  it('malformed attempt null fails closed', async () => {
    await assertFailClosedMutation('fc_att_null', (rl) => {
      rl.attemptId = null;
    });
  });
});

describe('B8F4B Correction 1 — converted header', () => {
  it('Cabin converted-header retry without rewind', async () => {
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    const holdCtx = await acquireCabinHold('after_tomb_cabin');
    const { session, paymentIntentId, hold, stripe, bookingId } = await crashAfterTombstone({
      holdCtx,
      mode: 'cabin'
    });
    assert.equal(await EmailDeliveryState.countDocuments({}), 0);
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
    assert.equal(String(retry.bookingId), String(bookingId));
    assert.equal(
      (await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean()).finalizeStatus,
      FINALIZE_STATUS.FINALIZED
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
      'converted'
    );
    assert.equal(await EmailDeliveryState.countDocuments({}), 1);
  });

  it('Converted + foreign booking rejects via promote', async () => {
    const holdCtx = await acquireUnitHold('conv_foreign');
    const { session, paymentIntentId, hold, attemptId: att, bookingId } = await crashAfterTombstone({
      holdCtx
    });
    await CheckoutSession.updateOne(
      { checkoutId: session.checkoutId },
      { $set: { finalizeStatus: 'in_progress' } }
    );
    await AccommodationCheckoutLease.updateOne(
      { leaseId: hold.leaseId },
      { $set: { conversionBookingId: new mongoose.Types.ObjectId() } }
    );
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking({
          checkoutId: session.checkoutId,
          leaseId: hold.leaseId,
          holdId: hold.leaseId,
          generation: hold.generation,
          attemptId: att,
          quoteSnapshotHash: session.quoteSnapshotHash,
          bookingId,
          unitId: hold.unitId,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          canonicalPaymentIntentId: paymentIntentId
        }),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_FOREIGN' ||
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY' ||
        /converted|foreign|authority/i.test(err.message || '')
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
      'converted'
    );
  });

  it('Converted + partial claims rejects on finalize retry', async () => {
    const holdCtx = await acquireUnitHold('conv_partial');
    const { session, paymentIntentId, hold, stripe, bookingId } = await crashAfterTombstone({
      holdCtx
    });
    const deleted = await UnitNightClaim.findOneAndDelete({
      bookingId,
      ownerType: 'booking',
      convertedFromLeaseId: hold.leaseId
    });
    assert.ok(deleted);
    assert.equal(
      await UnitNightClaim.countDocuments({
        bookingId,
        ownerType: 'booking',
        convertedFromLeaseId: hold.leaseId
      }),
      1
    );
    await reopenForRetry(session.checkoutId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean()).status,
      'converted'
    );
  });
});

describe('B8F4B Correction 1 — exact facilities', () => {
  it('Exact two-hold success; surplus same-checkout hold remains hold', async () => {
    const holdCtx = await acquireUnitHold('fac_two');
    const fac1 = await createFacilityHold(holdCtx.checkoutId, 0);
    const fac2 = await createFacilityHold(holdCtx.checkoutId, 1);
    const surplus = await createFacilityHold(holdCtx.checkoutId, 2);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac1._id, fac2._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await FacilityReservation.findById(fac1._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(fac2._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(surplus._id).lean()).status, 'hold');
    assert.equal((await FacilityReservation.findById(surplus._id).lean()).bookingId, null);
  });

  it('Stale-generation surplus: facilityHoldIds lists only lease set; extra held untouched', async () => {
    // No durable generation marker on FacilityReservation — surplus hold stands in for
    // stale-generation leftovers that must not be confirmed.
    const holdCtx = await acquireUnitHold('fac_stale');
    const fac1 = await createFacilityHold(holdCtx.checkoutId, 0);
    const fac2 = await createFacilityHold(holdCtx.checkoutId, 1);
    const staleExtra = await createFacilityHold(holdCtx.checkoutId, 2);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac1._id, fac2._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal((await FacilityReservation.findById(staleExtra._id).lean()).status, 'hold');
  });

  it('Foreign hold id in facilityHoldIds fails; foreign row untouched', async () => {
    const holdCtx = await acquireUnitHold('fac_foreign_id');
    const own = await createFacilityHold(holdCtx.checkoutId, 0);
    const foreign = await createFacilityHold(checkoutId('other_fac2'), 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [own._id, foreign._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await FacilityReservation.findById(foreign._id).lean()).status, 'hold');
    assert.equal((await FacilityReservation.findById(foreign._id).lean()).bookingId, null);
  });

  it('Missing expected facility ID fails', async () => {
    const holdCtx = await acquireUnitHold('fac_miss_exact');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const missing = new mongoose.Types.ObjectId();
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id, missing]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'hold');
  });

  it('Duplicate facilityHoldIds rejected', async () => {
    const holdCtx = await acquireUnitHold('fac_dup');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold, attemptId: att } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    session.resourceLease.facilityHoldIds = [String(fac._id), String(fac._id)];
    session.markModified('resourceLease');
    await session.save();
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );

    // Direct exact-confirm also rejects duplicates once paid mid-flight shape is set.
    const bookingId = new mongoose.Types.ObjectId();
    await CheckoutSession.updateOne(
      { checkoutId: session.checkoutId },
      {
        $set: {
          finalizeStatus: 'in_progress',
          bookingId,
          'resourceLease.status': 'paid',
          'resourceLease.facilityHoldIds': [String(fac._id)]
        }
      }
    );
    await assert.rejects(
      () =>
        confirmExactFacilityHoldsForPaidCheckout({
          checkoutId: session.checkoutId,
          bookingId,
          facilityReservationIds: [fac._id, fac._id],
          generation: hold.generation,
          attemptId: att,
          quoteSnapshotHash: session.quoteSnapshotHash
        }),
      (err) => err.code === 'DUPLICATE_FACILITY_SELECTION'
    );
  });

  it('Hold confirmed to foreign Booking rejects', async () => {
    const holdCtx = await acquireUnitHold('fac_foreign_bk');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const foreignBooking = await Booking.create({
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      adults: 2,
      children: 0,
      guestInfo: {
        firstName: 'Other',
        lastName: 'Guest',
        email: 'other@example.com',
        phone: '+359888000222'
      },
      totalPrice: 100,
      paymentMethod: 'stripe',
      status: 'confirmed',
      cabinTypeId,
      unitId: unitIds[1],
      checkoutId: checkoutId('foreign_fac_bk'),
      legalAcceptance: legalAcceptanceBlock('Other', 'Guest')
    });
    await FacilityReservation.updateOne(
      { _id: fac._id },
      { $set: { status: 'confirmed', bookingId: foreignBooking._id, holdExpiresAt: null } }
    );
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    assert.equal(
      String((await FacilityReservation.findById(fac._id).lean()).bookingId),
      String(foreignBooking._id)
    );
  });

  it('Same Booking facility replay leaves extras untouched', async () => {
    const holdCtx = await acquireUnitHold('fac_replay_extra');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const extra = await createFacilityHold(holdCtx.checkoutId, 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    let once = true;
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: {
            stripe,
            afterFacilityConfirm: async () => {
              if (!once) return;
              once = false;
              const err = new Error('inject_fac_confirm');
              err.code = 'FACILITY_CONFIRM_FAILED';
              err.needsReview = true;
              throw err;
            }
          }
        }),
      assertNeedsReviewErr
    );
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(extra._id).lean()).status, 'hold');
    await reopenForRetry(session.checkoutId);
    const retry = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(retry.ok, true);
    assert.equal((await FacilityReservation.findById(extra._id).lean()).status, 'hold');
  });

  it('Paid lease + expired holdExpiresAt still confirms', async () => {
    const holdCtx = await acquireUnitHold('fac_expired_hold');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    await FacilityReservation.updateOne(
      { _id: fac._id },
      { $set: { holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000) } }
    );
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
  });

  it('Concurrent exact facility confirmation has one durable outcome', async () => {
    const holdCtx = await acquireUnitHold('fac_conc');
    const fac1 = await createFacilityHold(holdCtx.checkoutId, 0);
    const fac2 = await createFacilityHold(holdCtx.checkoutId, 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac1._id, fac2._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const settled = await Promise.allSettled([
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      }),
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'webhook_worker',
        dependencies: { stripe }
      })
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    assert.ok(ok.length >= 1);
    assert.equal(await Booking.countDocuments({}), 1);
    assert.equal((await FacilityReservation.findById(fac1._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(fac2._id).lean()).status, 'confirmed');
  });
});

describe('B8F4B Correction 1 — exact lease-paid CAS', () => {
  it('Concurrent markExactResourceLeasePaidForFinalize: only matching attempt wins', async () => {
    const holdCtx = await acquireUnitHold('cas_paid');
    const { session, paymentIntentId, hold, attemptId: att } = await seedLeasedStripeSession({
      holdCtx
    });
    const bookingId = new mongoose.Types.ObjectId();
    await CheckoutSession.updateOne(
      { checkoutId: session.checkoutId },
      {
        $set: {
          finalizeStatus: 'in_progress',
          bookingId,
          'resourceLease.status': 'active'
        }
      }
    );
    const base = {
      checkoutId: session.checkoutId,
      expectedGeneration: hold.generation,
      expectedQuoteSnapshotHash: session.quoteSnapshotHash,
      expectedAccommodationLeaseId: hold.leaseId,
      expectedBookingId: bookingId,
      paymentMode: 'stripe',
      expectedPaymentIntentId: paymentIntentId
    };
    const wrongAtt = `att_wrong_${crypto.randomBytes(4).toString('hex')}`;
    const settled = await Promise.allSettled([
      markExactResourceLeasePaidForFinalize({ ...base, expectedAttemptId: att }),
      markExactResourceLeasePaidForFinalize({ ...base, expectedAttemptId: wrongAtt })
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.resourceLease.status, 'paid');
    assert.equal(live.resourceLease.attemptId, att);
  });
});

describe('B8F4B Correction 1 — voucher parity', () => {
  it('proveFullVoucherPaidAuthority and finalizePaidCheckout accept sealed voucher', async () => {
    const holdCtx = await acquireUnitHold('v_parity_ok');
    const { session, hold, attemptId: att } = await seedLeasedVoucherSession({ holdCtx });
    const proof = await proveFullVoucherPaidAuthority(
      session.toObject ? session.toObject() : session,
      session.resourceLease.toObject
        ? session.resourceLease.toObject()
        : session.resourceLease,
      session.checkoutId
    );
    assert.ok(proof.voucherRedemptionId);
    assert.ok(proof.voucherOperationId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      source: 'frontend',
      dependencies: voucherConfirmDeps()
    });
    assert.equal(result.ok, true);
    assert.equal(String(result.bookingId ? (await Booking.findById(result.bookingId)).unitId : ''), String(hold.unitId));
    void att;
  });

  it('Redemption mismatch rejects prove and finalize similarly', async () => {
    const holdCtx = await acquireUnitHold('v_parity_bad');
    const { session } = await seedLeasedVoucherSession({ holdCtx });
    session.resourceLease.voucherRedemptionId = new mongoose.Types.ObjectId();
    session.markModified('resourceLease');
    await session.save();
    const lean = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    await assert.rejects(
      () =>
        proveFullVoucherPaidAuthority(lean, lean.resourceLease, lean.checkoutId),
      (err) => /voucher|redemption|match/i.test(err.message || '') || Boolean(err.code)
    );
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          source: 'frontend',
          dependencies: voucherConfirmDeps()
        }),
      assertNeedsReviewErr
    );
    assert.equal(await Booking.countDocuments({}), 0);
  });
});

describe('B8F4B Correction 1 — immutable snapshot', () => {
  it('Booking.resourceFinalizationSnapshot uses quote values not finalizeIntent', async () => {
    const holdCtx = await acquireUnitHold('imm_snap');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id],
      quoteSnapshotPatch: {
        participants: [{ categoryKey: 'adult', count: 2, label: 'Adult' }],
        facilitySelections: [quoteSelectionFromHold(fac)],
        ratePlan: { code: 'GOOD', version: 2, type: 'nightly', currency: 'EUR' },
        ratePlanCode: 'GOOD',
        ratePlanVersion: '2',
        packageDates: null,
        packageInclusions: null,
        cancellationPolicySnapshot: { code: 'flex', version: 3 },
        bookingType: null
      },
      autoFacilitySelections: false
    });
    session.resourceLease.quoteSnapshotHash = session.quoteSnapshotHash;
    session.markModified('resourceLease');
    const intent =
      session.finalizeIntent && typeof session.finalizeIntent.toObject === 'function'
        ? session.finalizeIntent.toObject()
        : { ...(session.finalizeIntent || {}) };
    intent.participants = [{ categoryKey: 'evil', count: 99 }];
    intent.facilitySelections = [{ facilityCode: 'evil' }];
    intent.ratePlan = { code: 'EVIL', version: 99 };
    intent.package = { code: 'EVIL_PKG' };
    intent.cancellationPolicy = { code: 'evil' };
    session.finalizeIntent = intent;
    session.markModified('finalizeIntent');
    await session.save();

    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      confirmBody: {
        participants: [{ categoryKey: 'client_evil', count: 7 }],
        facilitySelections: [{ facilityCode: 'client-evil' }],
        ratePlan: { code: 'CLIENT_EVIL' },
        package: { code: 'CLIENT_PKG' },
        cancellationPolicy: { code: 'client-evil' }
      },
      dependencies: { stripe }
    });
    const snap = (await Booking.findById(result.bookingId).lean()).resourceFinalizationSnapshot;
    assert.equal(snap.ratePlanCode, 'GOOD');
    assert.equal(String(snap.ratePlanVersion), '2');
    assert.equal(snap.cancellationPolicy && snap.cancellationPolicy.code, 'flex');
    assert.ok(Array.isArray(snap.participants));
    assert.equal(snap.participants.some((p) => p.categoryKey === 'evil' || p.categoryKey === 'client_evil'), false);
    assert.ok(Array.isArray(snap.facilitySelections));
    assert.equal(snap.facilitySelections.some((f) => String(f.facilityCode).includes('evil')), false);
    assert.equal(snap.facilitySelections[0].facilityCode, 'sauna-1');
  });
});

describe('B8F4B Correction 2 — quote↔lease facility consistency', () => {
  async function assertMismatchFailClosed({
    session,
    paymentIntentId,
    hold,
    reservationIds,
    mutate = null
  }) {
    if (typeof mutate === 'function') {
      await mutate(session);
      if (typeof session.save === 'function') {
        await session.save();
      }
    }
    const ids = (reservationIds || []).map(String);
    const before = {};
    for (const id of ids) {
      const row = await FacilityReservation.findById(id).lean();
      if (row) before[id] = { status: row.status, bookingId: row.bookingId };
    }
    const { stripe } = stripeFor(session, paymentIntentId);
    process.env.FINALIZE_SIDE_EFFECTS = '1';
    await assert.rejects(
      () =>
        finalizePaidCheckout({
          checkoutId: session.checkoutId,
          paymentIntentId,
          source: 'frontend',
          dependencies: { stripe }
        }),
      assertNeedsReviewErr
    );
    for (const id of ids) {
      const row = await FacilityReservation.findById(id).lean();
      assert.ok(row);
      assert.equal(row.status, before[id] ? before[id].status : 'hold');
      assert.equal(
        row.bookingId == null ? null : String(row.bookingId),
        before[id] && before[id].bookingId != null ? String(before[id].bookingId) : null
      );
    }
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
    assert.notEqual(live.finalizeStatus, FINALIZE_STATUS.FINALIZED);
    assert.equal(await EmailDeliveryState.countDocuments({}), 0);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: hold.leaseId }).lean();
    assert.ok(header);
    assert.equal(header.status, 'converting');
    assert.equal(header.isLive, true);
  }

  async function patchQuoteSelections(session, nextSelections) {
    const snap =
      session.quoteSnapshot && typeof session.quoteSnapshot.toObject === 'function'
        ? session.quoteSnapshot.toObject()
        : { ...(session.quoteSnapshot || {}) };
    snap.facilitySelections = nextSelections;
    session.quoteSnapshot = snap;
    session.markModified('quoteSnapshot');
    session.quoteSnapshotHash = hashQuoteSnapshot(snap);
    session.resourceLease.quoteSnapshotHash = session.quoteSnapshotHash;
    session.markModified('resourceLease');
    await session.save();
  }

  it('C2-1. Both collections empty: skip facility confirmation and succeed', async () => {
    const holdCtx = await acquireUnitHold('c2_empty');
    const { session, paymentIntentId } = await seedLeasedStripeSession({ holdCtx });
    assert.deepEqual(session.resourceLease.facilityHoldIds, []);
    const snap = session.quoteSnapshot.toObject
      ? session.quoteSnapshot.toObject()
      : session.quoteSnapshot;
    assert.ok(!Array.isArray(snap.facilitySelections) || snap.facilitySelections.length === 0);
    const { stripe } = stripeFor(session, paymentIntentId);
    let confirmed = null;
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: {
        stripe,
        afterFacilityConfirm: async ({ confirmedIds }) => {
          confirmed = confirmedIds;
        }
      }
    });
    assert.equal(result.ok, true);
    assert.deepEqual(confirmed, []);
  });

  it('C2-2. Quote selections non-empty, lease IDs empty: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_xor_q');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: []
    });
    await patchQuoteSelections(session, [quoteSelectionFromHold(fac)]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-3. Quote selections empty, lease IDs non-empty: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_xor_l');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id],
      autoFacilitySelections: false,
      quoteSnapshotPatch: { facilitySelections: [] }
    });
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-4. Invalid quote-selection shape: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_shape_q');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const seeded = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const lean = await CheckoutSession.findOne({ checkoutId: seeded.session.checkoutId }).lean();
    const snap = {
      ...(lean.quoteSnapshot && typeof lean.quoteSnapshot === 'object' ? lean.quoteSnapshot : {}),
      facilitySelections: { not: 'an-array' }
    };
    const nextHash = hashQuoteSnapshot(snap);
    await CheckoutSession.collection.updateOne(
      { checkoutId: seeded.session.checkoutId },
      {
        $set: {
          quoteSnapshot: snap,
          quoteSnapshotHash: nextHash,
          'resourceLease.quoteSnapshotHash': nextHash
        }
      }
    );
    const session = await CheckoutSession.findOne({ checkoutId: seeded.session.checkoutId });
    await assertMismatchFailClosed({
      session,
      paymentIntentId: seeded.paymentIntentId,
      hold: seeded.hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-5. Invalid lease-ID shape: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_shape_l');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const seeded = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    await CheckoutSession.collection.updateOne(
      { checkoutId: seeded.session.checkoutId },
      { $set: { 'resourceLease.facilityHoldIds': { not: 'an-array' } } }
    );
    const session = await CheckoutSession.findOne({ checkoutId: seeded.session.checkoutId });
    await assertMismatchFailClosed({
      session,
      paymentIntentId: seeded.paymentIntentId,
      hold: seeded.hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-6. Duplicate quote selections: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_dup_q');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    await patchQuoteSelections(session, [sel, { ...sel }]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-7. Duplicate lease IDs: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_dup_l');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    session.resourceLease.facilityHoldIds = [String(fac._id), String(fac._id)];
    session.markModified('resourceLease');
    await session.save();
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-8. Same count but wrong facility identity: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_fac');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    sel.facilityCode = 'hot-tub-1';
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-9. Same facility but wrong start time: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_start');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    const badStart = new Date(new Date(sel.startTime).getTime() + 60 * 60 * 1000);
    sel.startTime = badStart.toISOString();
    sel.slotStart = badStart.toISOString();
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-10. Same facility but wrong end time: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_end');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    const badEnd = new Date(new Date(sel.endTime).getTime() + 60 * 60 * 1000);
    sel.endTime = badEnd.toISOString();
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-11. Wrong add-on identity: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_addon');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    sel.addOnCode = 'other-addon';
    sel.addOn = { ...sel.addOn, code: 'other-addon' };
    sel.priceSnapshot = { ...sel.priceSnapshot, addOnCode: 'other-addon' };
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-12. Wrong add-on version: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_ver');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    sel.addOnVersion = 99;
    sel.addOn = { ...sel.addOn, version: 99 };
    sel.priceSnapshot = { ...sel.priceSnapshot, addOnVersion: 99 };
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-13. Wrong quantity/firewood amount identity: fail closed', async () => {
    const holdCtx = await acquireUnitHold('c2_wrong_amt');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    sel.amount = 999;
    sel.addOn = { ...sel.addOn, amount: 999 };
    sel.priceSnapshot = { ...sel.priceSnapshot, amount: 999 };
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-14. One correct selection and hold: succeeds', async () => {
    const holdCtx = await acquireUnitHold('c2_one_ok');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
  });

  it('C2-15. Multiple correct selections and holds: succeeds', async () => {
    const holdCtx = await acquireUnitHold('c2_multi_ok');
    const fac1 = await createFacilityHold(holdCtx.checkoutId, 0);
    const fac2 = await createFacilityHold(holdCtx.checkoutId, 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac1._id, fac2._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await FacilityReservation.findById(fac1._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(fac2._id).lean()).status, 'confirmed');
  });

  it('C2-16. Different ordering with the same exact set: succeeds', async () => {
    const holdCtx = await acquireUnitHold('c2_order');
    const fac1 = await createFacilityHold(holdCtx.checkoutId, 0);
    const fac2 = await createFacilityHold(holdCtx.checkoutId, 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac1._id, fac2._id],
      autoFacilitySelections: false,
      quoteSnapshotPatch: {
        facilitySelections: [quoteSelectionFromHold(fac2), quoteSelectionFromHold(fac1)]
      }
    });
    session.resourceLease.facilityHoldIds = [String(fac2._id), String(fac1._id)];
    session.markModified('resourceLease');
    await session.save();
    const { stripe } = stripeFor(session, paymentIntentId);
    const result = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(result.ok, true);
    assert.equal((await FacilityReservation.findById(fac1._id).lean()).status, 'confirmed');
    assert.equal((await FacilityReservation.findById(fac2._id).lean()).status, 'confirmed');
  });

  it('C2-17. Extra same-checkout hold outside lease IDs remains unmodified', async () => {
    const holdCtx = await acquireUnitHold('c2_surplus');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const surplus = await createFacilityHold(holdCtx.checkoutId, 1);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal((await FacilityReservation.findById(surplus._id).lean()).status, 'hold');
    assert.equal((await FacilityReservation.findById(surplus._id).lean()).bookingId, null);
  });

  it('C2-18. Foreign checkout hold remains unmodified', async () => {
    const holdCtx = await acquireUnitHold('c2_foreign');
    const own = await createFacilityHold(holdCtx.checkoutId, 0);
    const foreign = await createFacilityHold(checkoutId('c2_other'), 1);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [own._id, foreign._id]
    });
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [own._id, foreign._id]
    });
  });

  it('C2-19. Stale-generation surplus hold remains unmodified', async () => {
    const holdCtx = await acquireUnitHold('c2_stale');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const stale = await createFacilityHold(holdCtx.checkoutId, 2);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal((await FacilityReservation.findById(stale._id).lean()).status, 'hold');
  });

  it('C2-20. Acquisition-marked hold cannot be confirmed', async () => {
    const holdCtx = await acquireUnitHold('c2_acq');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0, {
      acquisitionAttemptId: `acq_${crypto.randomBytes(4).toString('hex')}`
    });
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });

  it('C2-21. Concurrent exact confirmation is idempotent', async () => {
    const holdCtx = await acquireUnitHold('c2_conc');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const settled = await Promise.allSettled([
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'frontend',
        dependencies: { stripe }
      }),
      finalizePaidCheckout({
        checkoutId: session.checkoutId,
        paymentIntentId,
        source: 'webhook_worker',
        dependencies: { stripe }
      })
    ]);
    const ok = settled.filter((s) => s.status === 'fulfilled' && s.value && s.value.ok);
    assert.ok(ok.length >= 1);
    assert.equal((await FacilityReservation.findById(fac._id).lean()).status, 'confirmed');
    const live = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
    assert.equal(live.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  });

  it('C2-22. Retry after successful exact confirmation returns the same confirmed set', async () => {
    const holdCtx = await acquireUnitHold('c2_retry');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const { stripe } = stripeFor(session, paymentIntentId);
    const first = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    const snap1 = (await Booking.findById(first.bookingId).lean()).resourceFinalizationSnapshot;
    const second = await finalizePaidCheckout({
      checkoutId: session.checkoutId,
      paymentIntentId,
      source: 'frontend',
      dependencies: { stripe }
    });
    assert.equal(second.idempotentReplay, true);
    const snap2 = (await Booking.findById(second.bookingId).lean()).resourceFinalizationSnapshot;
    assert.deepEqual(
      [...snap2.confirmedFacilityReservationIds].map(String).sort(),
      [...snap1.confirmedFacilityReservationIds].map(String).sort()
    );
  });

  it('C2-23–25. Mismatch leaves facilities unmutated, lease untombstoned, no success/email', async () => {
    const holdCtx = await acquireUnitHold('c2_bundle');
    const fac = await createFacilityHold(holdCtx.checkoutId, 0);
    const { session, paymentIntentId, hold } = await seedLeasedStripeSession({
      holdCtx,
      facilityHoldIds: [fac._id]
    });
    const sel = quoteSelectionFromHold(fac);
    sel.facilityCode = 'wrong-code';
    await patchQuoteSelections(session, [sel]);
    await assertMismatchFailClosed({
      session,
      paymentIntentId,
      hold,
      reservationIds: [fac._id]
    });
  });
});

describe('B8F4B source guards (45–48 + Correction 2)', () => {
  it('45–48 + C2. Lease path authority, exact confirm, no demotion/email-before-success', () => {
    const files = [
      'finalizePaidCheckout.js',
      'executeBookingFinalizeWork.js',
      'checkoutFinalizeService.js'
    ].map((f) => path.join(__dirname, '../services/checkout', f));

    const banned = [
      'CHECKOUT_RESOURCE_LEASE_ENABLED',
      'FIXED_PACKAGE_PUBLICLY',
      'multi-a-frame',
      'multiAFrame',
      "require('../routes",
      "require('../../routes",
      'express.Router',
      'webhookHandler',
      'node-cron',
      'setInterval('
    ];

    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const token of banned) {
        assert.equal(src.includes(token), false, `${path.basename(file)} must not include ${token}`);
      }
    }

    const workSrc = fs.readFileSync(files[1], 'utf8');
    const leaseStart = workSrc.indexOf('async function executeLeaseAwareFinalizeWork');
    const workStart = workSrc.indexOf('async function executeBookingFinalizeWork');
    assert.ok(leaseStart > 0 && workStart > leaseStart);
    const leaseRegion = workSrc.slice(leaseStart, workStart);
    assert.equal(leaseRegion.includes('claimUnitNights'), false);
    assert.equal(leaseRegion.includes('preAcquireCabinNightsForCreate'), false);
    assert.equal(leaseRegion.includes('compensateClaimAttempt'), false);
    assert.equal(/demote|rollbackCheckoutClaims|releaseUnitNightsAfterPromote/i.test(leaseRegion), false);
    assert.ok(
      leaseRegion.includes('confirmExactFacilityHoldsForPaidCheckout'),
      'lease path must call confirmExactFacilityHoldsForPaidCheckout'
    );
    assert.equal(/\bconfirmFacilityHolds\b/.test(leaseRegion), false);
    assert.ok(
      leaseRegion.includes('assertQuoteLeaseFacilityConsistency'),
      'lease path must validate quote↔lease facility consistency'
    );
    assert.ok(
      /Never skip solely on empty lease IDs/.test(leaseRegion) ||
        /both empty/.test(leaseRegion),
      'lease path must not skip solely because facilityHoldIds is empty'
    );
    assert.equal(
      /facilityHoldIds\.length\s*===\s*0/.test(leaseRegion) &&
        !leaseRegion.includes('assertQuoteLeaseFacilityConsistency'),
      false,
      'must not skip facilities solely on empty facilityHoldIds'
    );
    assert.equal(
      /quoteSelections\.length\s*===\s*facilityHoldIds\.length/.test(leaseRegion),
      false,
      'no count-only quote-to-lease comparison'
    );
    assert.equal(
      /finalizeIntent\.facilitySelections|confirmBody\.facilitySelections|req\.body\.facility/.test(
        leaseRegion
      ),
      false,
      'no facility data from finalizeIntent or request input'
    );

    const facConfirmIdx = leaseRegion.indexOf('confirmExactFacilityHoldsForPaidCheckout');
    const tombstoneIdx = leaseRegion.indexOf('tombstonePromotedAccommodationCheckoutHold');
    const emailIdx = Math.max(
      leaseRegion.indexOf('enqueueBookingConfirmation'),
      leaseRegion.indexOf('confirmationEmail'),
      leaseRegion.indexOf('queueConfirmation')
    );
    assert.ok(facConfirmIdx > 0);
    assert.ok(tombstoneIdx > facConfirmIdx, 'tombstone after facility confirm');
    if (emailIdx > 0) {
      assert.ok(emailIdx > tombstoneIdx, 'email after tombstone');
    }

    const leaseBranch = workSrc.indexOf('return executeLeaseAwareFinalizeWork');
    const claimCall = workSrc.indexOf('await claimUnitNights(');
    assert.ok(leaseBranch > 0);
    assert.ok(claimCall < 0 || leaseBranch < claimCall);

    const finalizeSrc = fs.readFileSync(files[0], 'utf8');
    assert.ok(finalizeSrc.includes('!isLeaseAwareFinalizeSession(session)'));

    const facilitySrc = fs.readFileSync(
      path.join(__dirname, '../services/facilityBookingService.js'),
      'utf8'
    );
    assert.ok(facilitySrc.includes('assertQuoteLeaseFacilityConsistency'));
    assert.ok(facilitySrc.includes('FACILITY_QUOTE_LEASE_XOR'));
    assert.ok(facilitySrc.includes('facilityCommercialIdentityKeyFromSelection'));
    assert.equal(
      /selections\.length\s*===\s*leaseIds/.test(facilitySrc) &&
        !facilitySrc.includes('assertMultisetEqual'),
      false,
      'facility service must not use count-only agreement'
    );

    const selfSrc = fs.readFileSync(__filename, 'utf8');
    assert.equal(
      /status:\s*['"]converting['"],\s*isLive:\s*true,\s*convertedAt:\s*null/.test(selfSrc),
      false,
      'test file must not rewind converted → converting'
    );
    assert.equal(
      /AccommodationCheckoutLease\.updateOne\([\s\S]{0,200}status:\s*['"]converting['"]/.test(selfSrc),
      false,
      'test file must not updateOne header status back to converting'
    );
  });
});
