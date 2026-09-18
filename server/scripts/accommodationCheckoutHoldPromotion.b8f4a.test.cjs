/**
 * B8F4A correction — irreversible accommodation claim promotion (MongoMemoryServer).
 * Real production services. Durable CheckoutSession authority. No Stripe/routes/finalize wiring.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const AccommodationCheckoutLease = require('../models/AccommodationCheckoutLease');
const UnitNightClaim = require('../models/UnitNightClaim');
const CabinNightClaim = require('../models/CabinNightClaim');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const Unit = require('../models/Unit');
const CabinType = require('../models/CabinType');
const CheckoutSession = require('../models/CheckoutSession');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const {
  ensureVoucherLedgerIndexesForTests,
  findEmbeddedOperation
} = require('../services/giftVouchers/giftVoucherLedgerService');
const {
  acquireCheckoutResourceAttemptFence,
  ensureCheckoutResourceAttemptIndexesForTests
} = require('../services/checkout/checkoutResourceAttemptFenceService');
const {
  reserveExactVoucherAmountForAttempt,
  sealAttemptVoucherReservation
} = require('../services/giftVouchers/giftVoucherAttemptReservationService');

const unitClaims = require('../services/inventory/unitNightClaimService');
const cabinClaims = require('../services/inventory/cabinNightClaimService');
const {
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
  AccommodationCheckoutHoldError,
  RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT,
  RELEASED_CLEANUP_RETRY_BASE_MS,
  RELEASED_CLEANUP_RETRY_MAX_MS,
  computeReleasedCleanupRetryDelayMs,
  acquireAccommodationCheckoutHold,
  releaseAccommodationCheckoutHold,
  expireAccommodationCheckoutHolds,
  promoteAccommodationCheckoutHoldToBooking,
  tombstonePromotedAccommodationCheckoutHold,
  ensureLeaseIndexesForTests,
  proveFullVoucherPaidAuthority
} = require('../services/checkout/accommodationCheckoutHoldService');

const STAY_IN = '2026-10-10';
const STAY_OUT = '2026-10-12';
const QS = 'qs_b8f4a_corr_01';

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

function attemptId(label = 'att') {
  return `att_${label}_${crypto.randomBytes(4).toString('hex')}`;
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
    name: `B8F4A CT ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'b8f4a',
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
    depsBase()
  );
  assert.equal(hold.status, 'sealed');
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
      checkOut: STAY_OUT
    },
    depsBase()
  );
  assert.equal(hold.status, 'sealed');
  assert.equal(hold.unitId, null);
  return { checkoutId: id, hold, attemptId: attemptId(label) };
}

async function createSealedFullVoucher({
  checkoutId: cid,
  quoteSnapshotHash = QS,
  amountCents = 15000
} = {}) {
  await ensureVoucherLedgerIndexesForTests();
  await ensureCheckoutResourceAttemptIndexesForTests();
  const code = `DD-B8F4-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${String(seq).padStart(4, '0')}`;
  const voucher = await GiftVoucher.create({
    code,
    amountOriginalCents: Math.max(20000, amountCents),
    balanceRemainingCents: Math.max(20000, amountCents),
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
  assert.equal(sealed.sealed, true);
  return {
    voucher,
    redemptionId: String(sealed.redemptionId),
    operationId: String(sealed.operationId),
    fenceAttemptId: fence.attemptId
  };
}

async function createPaidSession({
  checkoutId: cid,
  hold,
  attemptId: att,
  bookingId,
  mode = 'stripe',
  finalizeStatus = 'in_progress',
  resourceLeaseStatus = 'paid',
  quoteSnapshotHash = QS,
  generation = null,
  canonicalPaymentIntentId = null,
  paymentStatus = null,
  stripeAmountCents = null,
  giftVoucherAppliedCents = null,
  remainingDueCents = null,
  totalCents = null,
  voucherRedemptionId = null,
  voucherOperationId = null,
  skipAutoVoucher = false
} = {}) {
  const gen = generation != null ? generation : hold.generation;
  const pi =
    canonicalPaymentIntentId != null
      ? canonicalPaymentIntentId
      : mode === 'stripe'
        ? `pi_${crypto.randomBytes(8).toString('hex')}`
        : null;

  let redId = voucherRedemptionId;
  let opId = voucherOperationId;
  let applied = giftVoucherAppliedCents;
  let total = totalCents;
  let remaining = remainingDueCents;
  let stripeAmt = stripeAmountCents;

  if (mode === 'voucher' && !skipAutoVoucher && redId == null) {
    const amount = total != null ? total : applied != null ? applied : 15000;
    const sealed = await createSealedFullVoucher({
      checkoutId: cid,
      quoteSnapshotHash,
      amountCents: amount
    });
    redId = sealed.redemptionId;
    opId = sealed.operationId;
    applied = amount;
    total = amount;
    remaining = 0;
    stripeAmt = 0;
  }

  const doc = {
    checkoutId: cid,
    flowVersion: 'v2',
    status: mode === 'stripe' ? 'paid' : 'voucher_only_reserved',
    quoteSnapshot: {
      remainingDueCents:
        remaining != null ? remaining : mode === 'stripe' ? 10000 : 0,
      totalCents: total != null ? total : mode === 'stripe' ? 10000 : 15000,
      totalPrice: ((total != null ? total : mode === 'stripe' ? 10000 : 15000) / 100)
    },
    quoteSnapshotHash,
    bookingId,
    finalizeStatus,
    paymentStatus:
      paymentStatus != null ? paymentStatus : mode === 'stripe' ? 'paid' : 'not_required',
    stripeAmountCents:
      stripeAmt != null ? stripeAmt : mode === 'stripe' ? 10000 : 0,
    giftVoucherAppliedCents:
      applied != null ? applied : mode === 'stripe' ? 0 : 15000,
    canonicalPaymentIntentId: pi,
    voucherRedemptionId: redId,
    resourceLease: {
      status: resourceLeaseStatus,
      generation: gen,
      attemptId: att,
      quoteSnapshotHash,
      paymentIntentId: pi,
      voucherRedemptionId: redId,
      voucherOperationId: opId,
      accommodation: {
        holdId: hold.leaseId,
        leaseId: hold.leaseId,
        generation: gen,
        cabinId: hold.cabinId,
        unitId: hold.unitId,
        entityType: hold.entityType
      }
    }
  };
  return CheckoutSession.create(doc);
}

function promoteInput(ctx, bookingId, overrides = {}) {
  return {
    checkoutId: ctx.checkoutId,
    leaseId: ctx.hold.leaseId,
    holdId: ctx.hold.holdId,
    generation: ctx.hold.generation,
    attemptId: ctx.attemptId,
    quoteSnapshotHash: QS,
    cabinId: ctx.hold.cabinId,
    unitId: ctx.hold.entityType === 'unit' ? ctx.hold.unitId : null,
    checkIn: ctx.hold.checkIn,
    checkOut: ctx.hold.checkOut,
    bookingId,
    ...overrides
  };
}

async function createDurableBooking({ bookingId, checkoutId: cid, cabinId, unitId }) {
  const doc = {
    _id: bookingId,
    checkoutId: cid,
    checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
    checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'b8f4a@example.com',
      phone: '+359888000000'
    },
    totalPrice: 100
  };
  if (unitId) {
    doc.cabinTypeId = cabinTypeId;
    doc.unitId = unitId;
  } else {
    doc.cabinId = cabinId;
  }
  return Booking.create(doc);
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
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({})
  ]);
});

describe('B8F4A authorization', () => {
  it('1. Unit promotion with exact paid-finalization authority', async () => {
    const ctx = await acquireUnitHold('authu');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'stripe'
    });
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.ok, true);
    assert.equal(res.headerStatus, 'converting');
    assert.equal(res.paymentMode, 'stripe');
    assert.equal(res.unitId, String(ctx.hold.unitId));
    const rows = await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => String(r.bookingId) === String(bookingId)));
    assert.ok(rows.every((r) => String(r.convertedFromLeaseId) === ctx.hold.leaseId));
  });

  it('2. Cabin promotion with exact paid-finalization authority', async () => {
    const ctx = await acquireCabinHold('authc');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'stripe'
    });
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.ok, true);
    assert.equal(res.unitId, null);
    const rows = await CabinNightClaim.find({ cabinId: ctx.hold.cabinId }).lean();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => String(r.convertedFromAttemptId) === ctx.attemptId));
  });

  it('3. Missing CheckoutSession fails before mutation', async () => {
    const ctx = await acquireUnitHold('nosess');
    const bookingId = new mongoose.Types.ObjectId();
    const before = await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err instanceof AccommodationCheckoutHoldError && err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      before
    );
  });

  it('4. Finalize status not in_progress fails', async () => {
    const ctx = await acquireUnitHold('nofin');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      finalizeStatus: 'open'
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('5. Wrong target Booking fails', async () => {
    const ctx = await acquireUnitHold('wrongbk');
    const sessionBooking = new mongoose.Types.ObjectId();
    const other = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId: sessionBooking
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, other)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('6. Resource lease not paid fails', async () => {
    const ctx = await acquireUnitHold('notpaid');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      resourceLeaseStatus: 'active'
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('7-12. Wrong generation/attempt/hash/lease/resource/dates fail', async () => {
    const ctx = await acquireUnitHold('mismatch');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId, { generation: 99 })),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { attemptId: 'att_wrong' })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { quoteSnapshotHash: 'qs_wrong' })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { leaseId: 'lease_missing', holdId: 'lease_missing' })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    const otherUnit = String(unitIds.find((u) => String(u) !== String(ctx.hold.unitId)));
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId, { unitId: otherUnit })),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { checkIn: '2026-10-11', checkOut: '2026-10-13' })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('13. Caller boolean cannot authorize expired promotion', async () => {
    const ctx = await acquireUnitHold('bool');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { allowExpiredPaidOverride: true })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('14. Paid expired lease succeeds only with durable authority', async () => {
    const ctx = await acquireUnitHold('expired');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.ok, true);
    assert.equal(res.headerStatus, 'converting');
  });

  it('15. Full-voucher paid authority succeeds without a PaymentIntent', async () => {
    const ctx = await acquireUnitHold('voucher');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'voucher'
    });
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.paymentMode, 'full_voucher');
    assert.equal(res.canonicalPaymentIntentId, null);
  });

  it('16. Payment-required authority requires the exact canonical PaymentIntent', async () => {
    const ctx = await acquireUnitHold('pi');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'stripe',
      canonicalPaymentIntentId: 'pi_exact_1'
    });
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(
          promoteInput(ctx, bookingId, { canonicalPaymentIntentId: 'pi_wrong' })
        ),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    const res = await promoteAccommodationCheckoutHoldToBooking(
      promoteInput(ctx, bookingId, { canonicalPaymentIntentId: 'pi_exact_1' })
    );
    assert.equal(res.canonicalPaymentIntentId, 'pi_exact_1');
  });
});

describe('B8F4A preflight and concurrency', () => {
  async function readyUnit() {
    const ctx = await acquireUnitHold('pref');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    return { ctx, bookingId };
  }

  it('17. Missing night fails before mutation', async () => {
    const { ctx, bookingId } = await readyUnit();
    const nights = await UnitNightClaim.find({ leaseId: ctx.hold.leaseId }).lean();
    await UnitNightClaim.deleteOne({ _id: nights[0]._id });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY' ||
        err.code === 'ACCOMMODATION_PROMOTION_INCOMPLETE'
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    // Stage-1 preflight fails while still sealed — no converting strand.
    assert.equal(header.status, 'sealed');
    assert.equal(header.isLive, true);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
  });

  it('18. Foreign checkout row fails before mutation', async () => {
    const { ctx, bookingId } = await readyUnit();
    const nights = await UnitNightClaim.find({ leaseId: ctx.hold.leaseId }).sort({ night: 1 }).lean();
    await UnitNightClaim.updateOne(
      { _id: nights[0]._id },
      { $set: { checkoutId: checkoutId('foreign'), leaseId: 'lease_foreign' } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_FOREIGN'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'sealed');
  });

  it('19. Foreign Booking row fails before mutation', async () => {
    const { ctx, bookingId } = await readyUnit();
    const nights = await UnitNightClaim.find({ leaseId: ctx.hold.leaseId }).sort({ night: 1 }).lean();
    await UnitNightClaim.updateOne(
      { _id: nights[0]._id },
      {
        $set: {
          ownerType: 'booking',
          bookingId: new mongoose.Types.ObjectId(),
          checkoutId: null,
          leaseId: null,
          acquisitionId: null,
          expiresAt: null,
          source: 'finalize'
        }
      }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_FOREIGN'
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean()).status,
      'sealed'
    );
  });

  it('20. Extra lease night fails before mutation', async () => {
    const { ctx, bookingId } = await readyUnit();
    await UnitNightClaim.create({
      unitId: ctx.hold.unitId,
      night: unitClaims.nightDateFromDateOnly('2026-10-12'),
      ownerType: 'checkout',
      bookingId: null,
      checkoutId: ctx.checkoutId,
      leaseId: ctx.hold.leaseId,
      acquisitionId: null,
      expiresAt: new Date(Date.now() + 3600000),
      source: 'checkout_lease'
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY' ||
        err.code === 'ACCOMMODATION_PROMOTION_INCOMPLETE'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean()).status,
      'sealed'
    );
  });

  it('21. Same Booking concurrent promotion is idempotent', async () => {
    const { ctx, bookingId } = await readyUnit();
    const input = promoteInput(ctx, bookingId);
    const [a, b] = await Promise.all([
      promoteAccommodationCheckoutHoldToBooking(input),
      promoteAccommodationCheckoutHoldToBooking(input)
    ]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(await UnitNightClaim.countDocuments({ unitId: ctx.hold.unitId }), 2);
    assert.deepEqual(a.claimIds.sort(), b.claimIds.sort());
  });

  it('22. Different Booking concurrent promotion has exactly one winner', async () => {
    const ctx = await acquireUnitHold('race');
    const bookingA = new mongoose.Types.ObjectId();
    const bookingB = new mongoose.Types.ObjectId();
    // Two sessions cannot share one live lease; simulate race on same converting by
    // creating session for A, then attempting B against same hold with forged session.
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId: bookingA
    });
    const results = await Promise.allSettled([
      promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingA)),
      promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingB))
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const owner = fulfilled[0].value.bookingId;
    assert.equal(owner, String(bookingA));
    const rows = await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean();
    assert.ok(rows.every((r) => String(r.bookingId) === String(bookingA)));
  });
});

describe('B8F4A crash recovery', () => {
  it('23. Crash after header enters converting, before claims', async () => {
    const ctx = await acquireUnitHold('crash0');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId), depsBase({
          onAfterHeaderConverting: async () => {
            throw new Error('inject_crash_after_converting');
          }
        })),
      /inject_crash_after_converting/
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(String(header.conversionBookingId), String(bookingId));
    assert.equal(await UnitNightClaim.countDocuments({ ownerType: 'checkout', leaseId: ctx.hold.leaseId }), 2);

    const retry = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(retry.ok, true);
    assert.equal(retry.promotedCount, 2);
  });

  it('24-25. Crash after partial real promotion retries (unit and cabin)', async () => {
    async function partial(kind) {
      const ctx = kind === 'unit' ? await acquireUnitHold('partu') : await acquireCabinHold('partc');
      const bookingId = new mongoose.Types.ObjectId();
      await createPaidSession({
        checkoutId: ctx.checkoutId,
        hold: ctx.hold,
        attemptId: ctx.attemptId,
        bookingId
      });
      await assert.rejects(
        () =>
          promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId), depsBase({
            onAfterClaimPromoted: async ({ promotedCount }) => {
              if (promotedCount === 1) throw new Error('inject_crash_partial');
            }
          })),
        /inject_crash_partial/
      );
      const Model = kind === 'unit' ? UnitNightClaim : CabinNightClaim;
      const filter = kind === 'unit' ? { unitId: ctx.hold.unitId } : { cabinId: ctx.hold.cabinId };
      const mid = await Model.find(filter).lean();
      assert.equal(mid.filter((r) => String(r.bookingId) === String(bookingId)).length, 1);
      assert.equal(mid.filter((r) => r.ownerType === 'checkout').length, 1);
      const beforeIds = mid.map((r) => String(r._id)).sort();

      const retry = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
      assert.equal(retry.ok, true);
      assert.equal(retry.promotedCount, 1);
      assert.equal(retry.alreadyOwnedCount, 1);
      const after = await Model.find(filter).lean();
      assert.deepEqual(after.map((r) => String(r._id)).sort(), beforeIds);
      assert.ok(after.every((r) => String(r.bookingId) === String(bookingId)));
    }
    await partial('unit');
    await partial('cabin');
  });

  it('26-28. Crash after all claims before Booking; retry preserves IDs; tombstone after Booking', async () => {
    const ctx = await acquireUnitHold('allclaims');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.headerStatus, 'converting');
    const ids = res.claimIds.slice().sort();
    assert.equal(await Booking.countDocuments({ _id: bookingId }), 0);

    const retry = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(retry.promotedCount, 0);
    assert.equal(retry.alreadyOwnedCount, 2);
    assert.deepEqual(retry.claimIds.slice().sort(), ids);

    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    const tomb = await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    assert.equal(tomb.headerStatus, 'converted');
    assert.equal(tomb.headerIsLive, false);
    assert.deepEqual(
      (await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean()).map((r) => String(r._id)).sort(),
      ids
    );
  });

  it('29. Row count remains unchanged', async () => {
    const ctx = await acquireUnitHold('count');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    assert.equal(await UnitNightClaim.countDocuments({ unitId: ctx.hold.unitId }), 2);
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(await UnitNightClaim.countDocuments({ unitId: ctx.hold.unitId }), 2);
  });
});

describe('B8F4A irreversibility and races', () => {
  it('30. No rollback API is exported', () => {
    const hold = require('../services/checkout/accommodationCheckoutHoldService');
    const unit = require('../services/inventory/unitNightClaimService');
    const cabin = require('../services/inventory/cabinNightClaimService');
    assert.equal(typeof hold.revertAccommodationBookingPromotionToCheckout, 'undefined');
    assert.equal(typeof hold.demoteUnitBookingClaimsToCheckout, 'undefined');
    assert.equal(typeof unit.demoteUnitBookingClaimsToCheckout, 'undefined');
    assert.equal(typeof cabin.demoteCabinBookingClaimsToCheckout, 'undefined');
    const holdSrc = fs.readFileSync(
      path.join(__dirname, '../services/checkout/accommodationCheckoutHoldService.js'),
      'utf8'
    );
    assert.equal(holdSrc.includes('revertAccommodation'), false);
    assert.equal(holdSrc.includes('demoteUnit'), false);
    assert.equal(holdSrc.includes('demoteCabin'), false);
  });

  it('31-32. Release and expiry after promotion cannot demote claims', async () => {
    const ctx = await acquireUnitHold('norelease');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    const ids = (await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean())
      .map((r) => String(r._id))
      .sort();

    await assert.rejects(
      () => releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId }),
      (err) => err.code === 'ACCOMMODATION_LEASE_CONVERSION_PROTECTED'
    );
    assert.deepEqual(
      (await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean()).map((r) => String(r._id)).sort(),
      ids
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    await expireAccommodationCheckoutHolds({ now: new Date() });
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(header.isLive, true);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);
  });

  it('33. Foreign target cannot reuse converting header', async () => {
    const ctx = await acquireUnitHold('foreignconv');
    const bookingA = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId: bookingA
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingA));
    const bookingB = new mongoose.Types.ObjectId();
    await CheckoutSession.updateOne(
      { checkoutId: ctx.checkoutId },
      { $set: { bookingId: bookingB } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingB)),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_FOREIGN' ||
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('34. Stale generation cannot alter promoted claims', async () => {
    const ctx = await acquireUnitHold('stale');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId, { generation: 99 })),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('17b. Release wins before conversion causes zero promotion', async () => {
    const ctx = await acquireUnitHold('relwin');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId });
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId }), 0);
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY' ||
        err.code === 'ACCOMMODATION_PROMOTION_FOREIGN'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
  });
});

describe('B8F4A visibility', () => {
  it('35-37. Promoted claims block guest availability; checkout lists stay empty', async () => {
    const ctx = await acquireUnitHold('visu');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(await Booking.countDocuments({ _id: bookingId }), 0);
    assert.equal(
      await isUnitGuestStayAvailable(ctx.hold.unitId, cabinTypeId, STAY_IN, STAY_OUT, {
        _id: parentCabinId
      }, { skipCommercialCapacity: true }),
      false
    );
    assert.equal(
      (
        await listBlockingUnitCheckoutClaims({
          unitId: ctx.hold.unitId,
          startDate: STAY_IN,
          endDate: STAY_OUT
        })
      ).length,
      0
    );
    const cap = await evaluateCabinTypeCommercialCapacity({
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT
    });
    assert.equal(cap.freePhysicalUnitIds.includes(String(ctx.hold.unitId)), false);

    const cabinCtx = await acquireCabinHold('visc');
    const cabinBookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: cabinCtx.checkoutId,
      hold: cabinCtx.hold,
      attemptId: cabinCtx.attemptId,
      bookingId: cabinBookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(cabinCtx, cabinBookingId));
    const lux = await Cabin.findById(cabinCtx.hold.cabinId).lean();
    assert.equal(await isSingleCabinGuestStayAvailable(lux, STAY_IN, STAY_OUT), false);
    assert.equal(
      (
        await listBlockingCabinCheckoutClaims({
          cabinId: cabinCtx.hold.cabinId,
          startDate: STAY_IN,
          endDate: STAY_OUT
        })
      ).length,
      0
    );
  });

  it('38-39. Guest/commercial remain blocked after Booking and tombstone', async () => {
    const ctx = await acquireUnitHold('aftertomb');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    assert.equal(
      await isUnitGuestStayAvailable(ctx.hold.unitId, cabinTypeId, STAY_IN, STAY_OUT, {
        _id: parentCabinId
      }, { skipCommercialCapacity: true }),
      false
    );
    const cap = await evaluateCabinTypeCommercialCapacity({
      cabinTypeId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT
    });
    assert.equal(cap.freePhysicalUnitIds.includes(String(ctx.hold.unitId)), false);
  });
});

describe('B8F4A tombstone', () => {
  async function promotedUnit() {
    const ctx = await acquireUnitHold('tomb');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    return { ctx, bookingId };
  }

  it('40. Tombstone fails without a durable Booking', async () => {
    const { ctx, bookingId } = await promotedUnit();
    await assert.rejects(
      () => tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_TOMBSTONE_IDENTITY'
    );
  });

  it('41-42. Tombstone fails if claim ownership or provenance incomplete', async () => {
    const { ctx, bookingId } = await promotedUnit();
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    const rows = await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean();
    await UnitNightClaim.updateOne(
      { _id: rows[0]._id },
      { $set: { convertedFromAttemptId: 'att_tampered' } }
    );
    await assert.rejects(
      () => tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId)),
      (err) =>
        err.code === 'ACCOMMODATION_TOMBSTONE_IDENTITY' ||
        err.code === 'ACCOMMODATION_TOMBSTONE_INCOMPLETE'
    );
  });

  it('43-45. Exact tombstone succeeds, is idempotent, refuses different identity', async () => {
    const { ctx, bookingId } = await promotedUnit();
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    const first = await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    assert.equal(first.ok, true);
    assert.equal(first.headerStatus, 'converted');
    assert.ok(first.convertedAt);
    const second = await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    assert.equal(second.idempotent, true);

    await assert.rejects(
      () =>
        tombstonePromotedAccommodationCheckoutHold(
          promoteInput(ctx, bookingId, {
            attemptId: 'att_other',
            quoteSnapshotHash: QS
          })
        ),
      (err) => err.code === 'ACCOMMODATION_TOMBSTONE_IDENTITY' || err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );

    await releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId });
    await expireAccommodationCheckoutHolds({ now: new Date(Date.now() + 86400000) });
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 2);
  });
});

describe('B8F4A compatibility', () => {
  it('ordinary Unit/Cabin claim APIs remain unchanged', async () => {
    const bookingId = new mongoose.Types.ObjectId();
    const claimed = await unitClaims.claimUnitNights({
      bookingId,
      unitId: unitIds[0],
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      source: 'finalize'
    });
    assert.equal(claimed.ok, true);
    const cabinBookingId = new mongoose.Types.ObjectId();
    const cabinClaimed = await cabinClaims.claimCabinNights({
      bookingId: cabinBookingId,
      cabinId: stoneCabinId,
      checkIn: STAY_IN,
      checkOut: STAY_OUT,
      source: 'finalize'
    });
    assert.equal(cabinClaimed.ok, true);
  });

  it('no finalization/Stripe/facility/voucher/route/email/public-enablement call in promotion path sources', () => {
    for (const rel of [
      '../services/checkout/accommodationCheckoutHoldService.js',
      '../services/inventory/unitNightClaimService.js',
      '../services/inventory/cabinNightClaimService.js'
    ]) {
      const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      assert.equal(/require\(['"][^'"]*PaymentIntent/.test(src), false);
      assert.equal(src.includes('facilityBookingService'), false);
      assert.equal(src.includes('giftVoucherAttempt'), false);
      assert.equal(src.includes('giftVoucherPaymentService'), false);
      assert.equal(src.includes('finalizePaidCheckout'), false);
      assert.equal(src.includes('executeBookingFinalizeWork'), false);
      assert.equal(src.includes('sendConfirmationEmail'), false);
      assert.equal(src.includes('express.Router'), false);
      assert.equal(src.includes('CHECKOUT_RESOURCE_LEASE_ENABLED'), false);
    }
  });
});

describe('B8F4A correction-2 expiry fencing', () => {
  async function partialPromoteUnit() {
    const ctx = await acquireUnitHold('exp_partial_u');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    let promoted = 0;
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId), {
          onAfterClaimPromoted: async () => {
            promoted += 1;
            if (promoted === 1) {
              const err = new Error('inject_crash_partial_unit');
              err.code = 'inject_crash_partial_unit';
              throw err;
            }
          }
        }),
      (err) => /inject_crash_partial_unit/.test(err.message) || err.code === 'inject_crash_partial_unit'
    );
    return { ctx, bookingId };
  }

  async function partialPromoteCabin() {
    const ctx = await acquireCabinHold('exp_partial_c');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    let promoted = 0;
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId), {
          onAfterClaimPromoted: async () => {
            promoted += 1;
            if (promoted === 1) {
              const err = new Error('inject_crash_partial_cabin');
              err.code = 'inject_crash_partial_cabin';
              throw err;
            }
          }
        }),
      (err) => /inject_crash_partial_cabin/.test(err.message) || err.code === 'inject_crash_partial_cabin'
    );
    return { ctx, bookingId };
  }

  it('partial unit promotion survives expiry; remaining nights blocked; retry completes', async () => {
    const { ctx, bookingId } = await partialPromoteUnit();
    const beforeIds = (await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean())
      .map((r) => String(r._id))
      .sort();
    assert.equal(beforeIds.length, 2);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 1);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      1
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    await UnitNightClaim.updateMany(
      { leaseId: ctx.hold.leaseId, ownerType: 'checkout' },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(exp.skippedConverting >= 1 || exp.expiredCount === 0, true);

    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(header.isLive, true);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 1);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      1
    );

    const challengerCheckout = checkoutId('exp_challenger');
    const challengerLease = `acl_chal_${crypto.randomBytes(3).toString('hex')}`;
    await assert.rejects(
      () =>
        unitClaims.acquireUnitCheckoutNights({
          unitId: ctx.hold.unitId,
          checkoutId: challengerCheckout,
          leaseId: challengerLease,
          acquisitionId: `acq_${crypto.randomBytes(3).toString('hex')}`,
          checkIn: STAY_IN,
          checkOut: STAY_OUT,
          expiresAt: new Date(Date.now() + 3600000),
          now: new Date()
        }),
      () => true
    );

    const retry = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(retry.ok, true);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);
    assert.equal(await UnitNightClaim.countDocuments({ unitId: ctx.hold.unitId }), 2);
    const afterIds = (await UnitNightClaim.find({ unitId: ctx.hold.unitId }).lean())
      .map((r) => String(r._id))
      .sort();
    assert.deepEqual(afterIds, beforeIds);
  });

  it('partial cabin promotion survives expiry; retry completes', async () => {
    const { ctx, bookingId } = await partialPromoteCabin();
    const beforeIds = (await CabinNightClaim.find({ cabinId: ctx.hold.cabinId }).lean())
      .map((r) => String(r._id))
      .sort();
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    await CabinNightClaim.updateMany(
      { leaseId: ctx.hold.leaseId, ownerType: 'checkout' },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    await expireAccommodationCheckoutHolds({ now: new Date() });
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      1
    );
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(await CabinNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);
    const afterIds = (await CabinNightClaim.find({ cabinId: ctx.hold.cabinId }).lean())
      .map((r) => String(r._id))
      .sort();
    assert.deepEqual(afterIds, beforeIds);
  });

  it('expiry wins header CAS first; promotion cannot enter converting; no partial booking ownership', async () => {
    const ctx = await acquireUnitHold('exp_wins');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    const claimCount = await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId });
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(exp.expiredCount, 1);
    assert.ok(exp.expiredUnitClaims >= claimCount);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'released');
    assert.equal(header.isLive, false);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId }), 0);
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
  });
});

describe('B8F4A correction-2 two-stage preflight', () => {
  it('race after initial preflight is caught by protected second preflight and annotated', async () => {
    const ctx = await acquireUnitHold('stage2');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await assert.rejects(
      () =>
        promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId), {
          onAfterInitialPreflight: async () => {
            const nights = await UnitNightClaim.find({ leaseId: ctx.hold.leaseId })
              .sort({ night: 1 })
              .lean();
            await UnitNightClaim.deleteOne({ _id: nights[0]._id });
          }
        }),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY' ||
        err.code === 'ACCOMMODATION_PROMOTION_INCOMPLETE'
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converting');
    assert.equal(header.isLive, true);
    assert.ok(header.conversionFailureCode);
    assert.ok(header.conversionFailedAt);
    assert.equal(await UnitNightClaim.countDocuments({ bookingId }), 0);
    await assert.rejects(
      () => releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId }),
      (err) => err.code === 'ACCOMMODATION_LEASE_CONVERSION_PROTECTED'
    );
  });
});

describe('B8F4A correction-2 full-voucher negatives and positive', () => {
  async function voucherCtx(label = 'vn') {
    const ctx = await acquireUnitHold(label);
    const bookingId = new mongoose.Types.ObjectId();
    return { ctx, bookingId };
  }

  async function mutateSession(cid, patch) {
    await CheckoutSession.updateOne({ checkoutId: cid }, { $set: patch });
  }

  it('positive sealed voucher reserve+seal path authorizes promotion', async () => {
    const { ctx, bookingId } = await voucherCtx('vpos');
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'voucher'
    });
    const session = await CheckoutSession.findOne({ checkoutId: ctx.checkoutId }).lean();
    assert.ok(session.voucherRedemptionId);
    assert.ok(session.resourceLease.voucherOperationId);
    const red = await GiftVoucherRedemption.findById(session.voucherRedemptionId).lean();
    assert.equal(red.status, 'reserved');
    assert.equal(red.acquisitionAttemptId, null);
    const voucher = await GiftVoucher.findById(red.giftVoucherId).lean();
    const op = findEmbeddedOperation(voucher, {
      operationId: red.operationId,
      redemptionId: red._id
    });
    assert.equal(op.state, 'debited');
    assert.equal(op.acquisitionAttemptId, null);
    const res = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(res.paymentMode, 'full_voucher');
  });

  it('missing/mismatched monetary and redemption fields fail closed', async () => {
    const cases = [
      { name: 'missing total', patch: { 'quoteSnapshot.totalCents': null } },
      { name: 'missing applied', patch: { giftVoucherAppliedCents: null } },
      { name: 'missing remaining', patch: { 'quoteSnapshot.remainingDueCents': null } },
      { name: 'nonzero remaining', patch: { 'quoteSnapshot.remainingDueCents': 1 } },
      { name: 'applied below', patch: { giftVoucherAppliedCents: 14999 } },
      { name: 'applied above', patch: { giftVoucherAppliedCents: 15001 } },
      { name: 'missing redemption', patch: { voucherRedemptionId: null, 'resourceLease.voucherRedemptionId': null } },
      { name: 'stripe nonzero', patch: { stripeAmountCents: 1 } }
    ];
    for (const c of cases) {
      const label = `neg_${c.name.replace(/\s+/g, '_')}`;
      const { ctx, bookingId } = await voucherCtx(label);
      await createPaidSession({
        checkoutId: ctx.checkoutId,
        hold: ctx.hold,
        attemptId: ctx.attemptId,
        bookingId,
        mode: 'voucher'
      });
      await mutateSession(ctx.checkoutId, c.patch);
      await assert.rejects(
        () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
        (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY',
        c.name
      );
      await UnitNightClaim.deleteMany({ leaseId: ctx.hold.leaseId });
      await AccommodationCheckoutLease.deleteMany({ leaseId: ctx.hold.leaseId });
      await CheckoutSession.deleteMany({ checkoutId: ctx.checkoutId });
    }
  });

  it('wrong redemption / checkout / amount / currency / reserved-unsealed / restored / voided / markers fail', async () => {
    const { ctx, bookingId } = await voucherCtx('vbad');
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'voucher'
    });
    const session = await CheckoutSession.findOne({ checkoutId: ctx.checkoutId }).lean();
    const redId = session.voucherRedemptionId;

    await mutateSession(ctx.checkoutId, {
      'resourceLease.voucherRedemptionId': new mongoose.Types.ObjectId()
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await mutateSession(ctx.checkoutId, { 'resourceLease.voucherRedemptionId': redId });

    await GiftVoucherRedemption.collection.updateOne(
      { _id: redId },
      { $set: { checkoutId: checkoutId('other') } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucherRedemption.collection.updateOne(
      { _id: redId },
      { $set: { checkoutId: ctx.checkoutId } }
    );

    await GiftVoucherRedemption.collection.updateOne(
      { _id: redId },
      { $set: { amountAppliedCents: 1 } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucherRedemption.collection.updateOne(
      { _id: redId },
      { $set: { amountAppliedCents: 15000 } }
    );

    await GiftVoucherRedemption.collection.updateOne(
      { _id: redId },
      { $set: { currency: 'USD' } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucherRedemption.updateOne({ _id: redId }, { $set: { currency: 'EUR' } });

    await GiftVoucherRedemption.updateOne(
      { _id: redId },
      { $set: { acquisitionAttemptId: 'still_marked' } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucherRedemption.updateOne(
      { _id: redId },
      { $set: { acquisitionAttemptId: null } }
    );

    const red = await GiftVoucherRedemption.findById(redId).lean();
    await GiftVoucher.updateOne(
      { _id: red.giftVoucherId, 'reservationLedgerOperations.operationId': red.operationId },
      { $set: { 'reservationLedgerOperations.$.state': 'restored' } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucher.updateOne(
      { _id: red.giftVoucherId, 'reservationLedgerOperations.operationId': red.operationId },
      { $set: { 'reservationLedgerOperations.$.state': 'voided' } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    await GiftVoucher.updateOne(
      { _id: red.giftVoucherId, 'reservationLedgerOperations.operationId': red.operationId },
      {
        $set: {
          'reservationLedgerOperations.$.state': 'debited',
          'reservationLedgerOperations.$.acquisitionAttemptId': 'op_marked'
        }
      }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('wrong voucherOperationId on resource lease fails', async () => {
    const { ctx, bookingId } = await voucherCtx('vop');
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'voucher'
    });
    await mutateSession(ctx.checkoutId, { 'resourceLease.voucherOperationId': 'op_wrong' });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('missing voucherOperationId fails before header or claim mutation', async () => {
    const { ctx, bookingId } = await voucherCtx('vopmiss');
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId,
      mode: 'voucher'
    });
    const beforeHeader = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    const beforeClaims = await UnitNightClaim.countDocuments({
      leaseId: ctx.hold.leaseId,
      ownerType: 'checkout'
    });
    await mutateSession(ctx.checkoutId, {
      'resourceLease.voucherOperationId': null
    });
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) => err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
    const afterHeader = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(afterHeader.status, beforeHeader.status);
    assert.equal(afterHeader.isLive, beforeHeader.isLive);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      beforeClaims
    );
  });
});

describe('B8F4A correction-3 expiry authorization and orphan cleanup', () => {
  async function expireSealedUnitHold(label) {
    const ctx = await acquireUnitHold(label);
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    return ctx;
  }

  async function expireSealedCabinHold(label) {
    const ctx = await acquireCabinHold(label);
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    return ctx;
  }

  it('1-2. crash after unit header release; retry deletes exact claims', async () => {
    const ctx = await expireSealedUnitHold('c3_u_crash');
    let crashed = false;
    await assert.rejects(
      () =>
        expireAccommodationCheckoutHolds({
          now: new Date(),
          onAfterHeaderReleasedBeforeClaimDelete: async () => {
            if (!crashed) {
              crashed = true;
              throw new Error('inject_crash_after_header_release_unit');
            }
          }
        }),
      /inject_crash_after_header_release_unit/
    );
    const mid = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(mid.status, 'released');
    assert.equal(mid.isLive, false);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      2
    );

    const exp = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(exp.expiredUnitClaims >= 2, true);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
  });

  it('3-5. crash after cabin header release; retry cleans; idempotent', async () => {
    const ctx = await expireSealedCabinHold('c3_c_crash');
    let crashed = false;
    await assert.rejects(
      () =>
        expireAccommodationCheckoutHolds({
          now: new Date(),
          onAfterHeaderReleasedBeforeClaimDelete: async () => {
            if (!crashed) {
              crashed = true;
              throw new Error('inject_crash_after_header_release_cabin');
            }
          }
        }),
      /inject_crash_after_header_release_cabin/
    );
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      2
    );
    await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const again = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(again.expiredCabinClaims, 0);
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
  });

  it('6-9. acquire expires unit header, deletes claims, then new generation acquires', async () => {
    const ctx = await expireSealedUnitHold('c3_acq_u');
    const gen1 = ctx.hold.generation;
    const lease1 = ctx.hold.leaseId;
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }),
      2
    );

    const next = await acquireAccommodationCheckoutHold(
      {
        checkoutId: ctx.checkoutId,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase({ now: new Date() })
    );
    assert.equal(next.outcome, 'created');
    assert.equal(next.generation, gen1 + 1);
    assert.notEqual(next.leaseId, lease1);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }), 0);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: next.leaseId, ownerType: 'checkout' }),
      2
    );
    const old = await AccommodationCheckoutLease.findOne({ leaseId: lease1 }).lean();
    assert.equal(old.status, 'released');
    assert.equal(old.isLive, false);
  });

  it('10. acquire expires cabin header and reacquires', async () => {
    const ctx = await expireSealedCabinHold('c3_acq_c');
    const lease1 = ctx.hold.leaseId;
    const next = await acquireAccommodationCheckoutHold(
      {
        checkoutId: ctx.checkoutId,
        bookingContext: 'normal',
        entityType: 'cabin',
        cabinId: luxCabinId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT
      },
      depsBase({ now: new Date() })
    );
    assert.equal(next.outcome, 'created');
    assert.equal(await CabinNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }), 0);
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: next.leaseId, ownerType: 'checkout' }),
      2
    );
  });

  it('11-13. acquire-path crash after release resumes cleanup; no orphan generation', async () => {
    const ctx = await expireSealedUnitHold('c3_acq_crash');
    const lease1 = ctx.hold.leaseId;
    const gen1 = ctx.hold.generation;
    let crashed = false;
    await assert.rejects(
      () =>
        acquireAccommodationCheckoutHold(
          {
            checkoutId: ctx.checkoutId,
            bookingContext: 'normal',
            entityType: 'cabinType',
            cabinTypeId,
            checkIn: STAY_IN,
            checkOut: STAY_OUT,
            accommodationKey: 'a-frame'
          },
          depsBase({
            now: new Date(),
            onAfterHeaderReleasedBeforeClaimDelete: async () => {
              if (!crashed) {
                crashed = true;
                throw new Error('inject_crash_acquire_after_release');
              }
            }
          })
        ),
      /inject_crash_acquire_after_release/
    );
    const midHeader = await AccommodationCheckoutLease.findOne({ leaseId: lease1 }).lean();
    assert.equal(midHeader.status, 'released');
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }),
      2
    );
    assert.equal(
      await AccommodationCheckoutLease.countDocuments({
        checkoutId: ctx.checkoutId,
        isLive: true
      }),
      0
    );

    const next = await acquireAccommodationCheckoutHold(
      {
        checkoutId: ctx.checkoutId,
        bookingContext: 'normal',
        entityType: 'cabinType',
        cabinTypeId,
        checkIn: STAY_IN,
        checkOut: STAY_OUT,
        accommodationKey: 'a-frame'
      },
      depsBase({ now: new Date() })
    );
    assert.equal(next.generation, gen1 + 1);
    assert.equal(await UnitNightClaim.countDocuments({ leaseId: lease1, ownerType: 'checkout' }), 0);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: next.leaseId, ownerType: 'checkout' }),
      2
    );
  });

  it('14-19. direct expiry rejects sealed/converting/converted/stale/foreign/boolean-only', async () => {
    const ctx = await acquireUnitHold('c3_direct');
    const sealed = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    const claimsBefore = await UnitNightClaim.countDocuments({
      leaseId: ctx.hold.leaseId,
      ownerType: 'checkout'
    });

    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: sealed.generation,
          unitId: ctx.hold.unitId
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'converting',
          conversionBookingId: new mongoose.Types.ObjectId(),
          conversionAttemptId: 'att_x',
          conversionStartedAt: new Date()
        }
      }
    );
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: sealed.generation,
          unitId: ctx.hold.unitId
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'converted',
          isLive: false,
          convertedAt: new Date()
        }
      }
    );
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: sealed.generation,
          unitId: ctx.hold.unitId
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          conversionBookingId: null,
          conversionAttemptId: null,
          conversionStartedAt: null,
          convertedAt: null
        }
      }
    );
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: sealed.generation + 1,
          unitId: ctx.hold.unitId
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: sealed.generation,
          unitId: unitIds[1]
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          headerExpiryAuthorized: true
        }),
      (err) =>
        err.code === 'UNIT_CHECKOUT_CLAIM_VALIDATION' || /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      claimsBefore
    );
  });

  it('20. booking-owned claims survive every expiry path', async () => {
    const ctx = await acquireUnitHold('c3_book');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));

    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);

    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: ctx.hold.generation,
          unitId: ctx.hold.unitId
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          expiresAt: new Date(Date.now() - 60_000)
        }
      }
    );
    await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
  });
});

describe('B8F4A correction-4 authorization hardening', () => {
  function fakeReleasedLeaseModel(shape) {
    return {
      findOne: async () => shape
    };
  }

  async function markReleased(leaseId, extras = {}) {
    await AccommodationCheckoutLease.updateOne(
      { leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          expiresAt: new Date(Date.now() - 60_000),
          ...extras
        }
      }
    );
  }

  async function assertExpireAuthMatrix(kind) {
    const ctx =
      kind === 'unit' ? await acquireUnitHold(`c4_${kind}_auth`) : await acquireCabinHold(`c4_${kind}_auth`);
    const expireFn =
      kind === 'unit' ? unitClaims.expireUnitCheckoutClaims : cabinClaims.expireCabinCheckoutClaims;
    const resourceKey = kind === 'unit' ? 'unitId' : 'cabinId';
    const resourceId = ctx.hold[resourceKey];
    const ClaimModel = kind === 'unit' ? UnitNightClaim : CabinNightClaim;
    const claimsBefore = await ClaimModel.countDocuments({
      leaseId: ctx.hold.leaseId,
      ownerType: 'checkout'
    });
    const sealed = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();

    const base = {
      checkoutId: ctx.checkoutId,
      leaseId: ctx.hold.leaseId,
      generation: sealed.generation,
      [resourceKey]: resourceId
    };

    await assert.rejects(
      () => expireFn({ ...base, AccommodationCheckoutLease: fakeReleasedLeaseModel({
        status: 'released',
        isLive: false,
        generation: sealed.generation,
        entityType: kind,
        checkoutId: ctx.checkoutId,
        leaseId: ctx.hold.leaseId,
        [resourceKey]: resourceId
      }) }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () => expireFn({ ...base, headerExpiryAuthorized: true }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code) || /VALIDATION/.test(err.code)
    );
    await assert.rejects(
      () => expireFn({ ...base, header: { status: 'released', isLive: false } }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(() => expireFn(base), (err) => /EXPIRY_UNAUTHORIZED/.test(err.code));

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'converting',
          conversionBookingId: new mongoose.Types.ObjectId(),
          conversionAttemptId: 'att_c4',
          conversionStartedAt: new Date()
        }
      }
    );
    await assert.rejects(() => expireFn(base), (err) => /EXPIRY_UNAUTHORIZED/.test(err.code));

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { status: 'converted', isLive: false, convertedAt: new Date() } }
    );
    await assert.rejects(() => expireFn(base), (err) => /EXPIRY_UNAUTHORIZED/.test(err.code));

    await markReleased(ctx.hold.leaseId, {
      conversionBookingId: null,
      conversionAttemptId: null,
      conversionStartedAt: null,
      convertedAt: null
    });
    await assert.rejects(
      () => expireFn({ ...base, generation: sealed.generation + 1 }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () => expireFn({ ...base, checkoutId: checkoutId('foreign') }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () => expireFn({ ...base, leaseId: `acl_foreign_${crypto.randomBytes(3).toString('hex')}` }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
    const wrongResource =
      kind === 'unit' ? unitIds.find((id) => String(id) !== String(resourceId)) : stoneCabinId;
    await assert.rejects(
      () => expireFn({ ...base, [resourceKey]: wrongResource }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );

    assert.equal(
      await ClaimModel.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      claimsBefore
    );

    const ok = await expireFn(base);
    assert.equal(ok.ok, true);
    assert.equal(
      await ClaimModel.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
  }

  it('Unit expiry rejects injection/foreign identity; succeeds only on real released header', async () => {
    await assertExpireAuthMatrix('unit');
  });

  it('Cabin expiry rejects injection/foreign identity; succeeds only on real released header', async () => {
    await assertExpireAuthMatrix('cabin');
  });

  it('Unit release: CAS before delete; crash recoverable; injection rejected', async () => {
    const ctx = await acquireUnitHold('c4_rel_u');
    let crashed = false;
    await assert.rejects(
      () =>
        releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId }, {
          onAfterHeaderReleasedBeforeClaimDelete: async () => {
            if (!crashed) {
              crashed = true;
              throw new Error('inject_crash_release_unit');
            }
          }
        }),
      /inject_crash_release_unit/
    );
    const mid = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(mid.status, 'released');
    assert.equal(mid.isLive, false);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      2
    );

    await assert.rejects(
      () =>
        unitClaims.releaseUnitCheckoutLeaseClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: mid.generation,
          unitId: ctx.hold.unitId,
          AccommodationCheckoutLease: fakeReleasedLeaseModel(mid)
        }),
      (err) => /RELEASE_UNAUTHORIZED/.test(err.code)
    );

    await releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId });
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const again = await releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId });
    assert.equal(again.releasedCount, 0);
  });

  it('Cabin release: CAS before delete; converting/converted/stale rejected; booking survives', async () => {
    const ctx = await acquireCabinHold('c4_rel_c');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      cabinId: ctx.hold.cabinId
    });
    await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    assert.equal(await CabinNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);

    await assert.rejects(
      () =>
        cabinClaims.releaseCabinCheckoutLeaseClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: ctx.hold.generation,
          cabinId: ctx.hold.cabinId
        }),
      (err) => /RELEASE_UNAUTHORIZED/.test(err.code)
    );

    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { status: 'released', isLive: false } }
    );
    await assert.rejects(
      () =>
        cabinClaims.releaseCabinCheckoutLeaseClaims({
          checkoutId: ctx.checkoutId,
          leaseId: ctx.hold.leaseId,
          generation: ctx.hold.generation + 1,
          cabinId: ctx.hold.cabinId
        }),
      (err) => /RELEASE_UNAUTHORIZED/.test(err.code)
    );

    await cabinClaims.releaseCabinCheckoutLeaseClaims({
      checkoutId: ctx.checkoutId,
      leaseId: ctx.hold.leaseId,
      generation: ctx.hold.generation,
      cabinId: ctx.hold.cabinId
    });
    assert.equal(await CabinNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);
  });

  it('Concurrent expiry workers are idempotent for Unit', async () => {
    const ctx = await acquireUnitHold('c4_conc_exp');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );
    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({ now: new Date() }),
      expireAccommodationCheckoutHolds({ now: new Date() })
    ]);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'released');
    assert.equal(header.isLive, false);
    assert.equal((a.expiredCount || 0) + (b.expiredCount || 0) <= 1, true);
  });

  it('Concurrent release-cleanup workers are idempotent for Cabin', async () => {
    const ctx = await acquireCabinHold('c4_conc_rel');
    const [a, b] = await Promise.all([
      releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId }),
      releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId })
    ]);
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'released');
    assert.equal((a.releasedCount || 0) + (b.releasedCount || 0) <= 1, true);
  });

  it('Promotion versus expiry: exactly one durable winner', async () => {
    const ctx = await acquireUnitHold('c4_race_pe');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { expiresAt: new Date(Date.now() - 60_000) } }
    );

    const results = await Promise.allSettled([
      promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      expireAccommodationCheckoutHolds({ now: new Date() })
    ]);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.ok(header.status === 'converting' || header.status === 'released');
    if (header.status === 'converting') {
      assert.equal(header.isLive, true);
      assert.equal(
        await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }) >= 1,
        true
      );
      const promoteOk = results.some((r) => r.status === 'fulfilled' && r.value && r.value.ok);
      assert.equal(promoteOk, true);
    } else {
      assert.equal(header.isLive, false);
      assert.equal(
        await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
        0
      );
    }
  });

  it('Promotion versus intentional release: exactly one durable winner', async () => {
    const ctx = await acquireUnitHold('c4_race_pr');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });

    const results = await Promise.allSettled([
      promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      releaseAccommodationCheckoutHold(ctx.checkoutId, { leaseId: ctx.hold.leaseId })
    ]);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.ok(header.status === 'converting' || header.status === 'released');
    if (header.status === 'converting') {
      assert.equal(
        results.some((r) => r.status === 'fulfilled' && r.value && r.value.ok === true),
        true
      );
    } else {
      assert.equal(header.isLive, false);
      assert.equal(
        await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
        0
      );
    }
  });

  it('Direct release cleanup without released header is rejected for Unit and Cabin', async () => {
    const unitCtx = await acquireUnitHold('c4_dir_rel_u');
    const cabinCtx = await acquireCabinHold('c4_dir_rel_c');
    await assert.rejects(
      () =>
        unitClaims.releaseUnitCheckoutLeaseClaims({
          checkoutId: unitCtx.checkoutId,
          leaseId: unitCtx.hold.leaseId,
          generation: unitCtx.hold.generation,
          unitId: unitCtx.hold.unitId
        }),
      (err) => /RELEASE_UNAUTHORIZED/.test(err.code)
    );
    await assert.rejects(
      () =>
        cabinClaims.releaseCabinCheckoutLeaseClaims({
          checkoutId: cabinCtx.checkoutId,
          leaseId: cabinCtx.hold.leaseId,
          generation: cabinCtx.hold.generation,
          cabinId: cabinCtx.hold.cabinId
        }),
      (err) => /RELEASE_UNAUTHORIZED/.test(err.code)
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: unitCtx.hold.leaseId, ownerType: 'checkout' }),
      2
    );
    assert.equal(
      await CabinNightClaim.countDocuments({ leaseId: cabinCtx.hold.leaseId, ownerType: 'checkout' }),
      2
    );
  });
});

describe('B8F4A correction-5 durable cleanup progress', () => {
  function padLease(i) {
    return `acl_c5_${String(i).padStart(3, '0')}`;
  }

  function padCheckout(i) {
    return `co_c5_${String(i).padStart(3, '0')}`;
  }

  function pendingCleanupFilter() {
    return {
      status: 'released',
      isLive: false,
      $or: [
        { checkoutClaimCleanupStatus: 'pending' },
        { checkoutClaimCleanupStatus: null },
        { checkoutClaimCleanupStatus: { $exists: false } }
      ]
    };
  }

  async function createCheckoutUnitClaims({ checkoutId: cid, leaseId, unitId, generation = 1 }) {
    const expiresAt = new Date(Date.now() + 3600_000);
    await UnitNightClaim.create({
      unitId,
      night: unitClaims.nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      bookingId: null,
      checkoutId: cid,
      leaseId,
      acquisitionId: null,
      expiresAt,
      source: 'checkout_lease'
    });
    await UnitNightClaim.create({
      unitId,
      night: unitClaims.nightDateFromDateOnly('2026-10-11'),
      ownerType: 'checkout',
      bookingId: null,
      checkoutId: cid,
      leaseId,
      acquisitionId: null,
      expiresAt,
      source: 'checkout_lease'
    });
    return generation;
  }

  async function createCheckoutCabinClaims({ checkoutId: cid, leaseId, cabinId }) {
    const expiresAt = new Date(Date.now() + 3600_000);
    await CabinNightClaim.create({
      cabinId,
      night: cabinClaims.nightDateFromDateOnly(STAY_IN),
      ownerType: 'checkout',
      bookingId: null,
      checkoutId: cid,
      leaseId,
      acquisitionId: null,
      expiresAt,
      source: 'checkout_lease'
    });
    await CabinNightClaim.create({
      cabinId,
      night: cabinClaims.nightDateFromDateOnly('2026-10-11'),
      ownerType: 'checkout',
      bookingId: null,
      checkoutId: cid,
      leaseId,
      acquisitionId: null,
      expiresAt,
      source: 'checkout_lease'
    });
  }

  async function seedReleasedCleanupDataset() {
    const TOTAL = 205;
    const UNIT_CLAIM_IDX = 105;
    const CABIN_CLAIM_IDX = 110;
    const docs = [];
    for (let i = 0; i < TOTAL; i += 1) {
      const isUnitClaim = i === UNIT_CLAIM_IDX;
      const isCabinClaim = i === CABIN_CLAIM_IDX;
      docs.push({
        leaseId: padLease(i),
        checkoutId: padCheckout(i),
        generation: 1,
        status: 'released',
        isLive: false,
        entityType: isCabinClaim ? 'cabin' : 'unit',
        unitId: isCabinClaim ? null : unitIds[0],
        cabinId: isCabinClaim ? luxCabinId : null,
        checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
        checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
        expectedNightCount: 2,
        // Future expiry: intentional-release style must still be recoverable.
        expiresAt: new Date(Date.now() + 3600_000),
        activeAcquisitionId: null,
        acquisitionStartedAt: null
      });
    }
    await AccommodationCheckoutLease.insertMany(docs);
    await createCheckoutUnitClaims({
      checkoutId: padCheckout(UNIT_CLAIM_IDX),
      leaseId: padLease(UNIT_CLAIM_IDX),
      unitId: unitIds[0]
    });
    await createCheckoutCabinClaims({
      checkoutId: padCheckout(CABIN_CLAIM_IDX),
      leaseId: padLease(CABIN_CLAIM_IDX),
      cabinId: luxCabinId
    });
    return { TOTAL, UNIT_CLAIM_IDX, CABIN_CLAIM_IDX };
  }

  it('Multi-page starvation: completed pages leave the queue; Unit and Cabin claims are reached', async () => {
    const { TOTAL, UNIT_CLAIM_IDX, CABIN_CLAIM_IDX } = await seedReleasedCleanupDataset();
    assert.equal(RELEASED_HEADER_CLAIM_CLEANUP_BATCH_LIMIT, 100);
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: padLease(UNIT_CLAIM_IDX),
        ownerType: 'checkout'
      }),
      2
    );
    assert.equal(
      await CabinNightClaim.countDocuments({
        leaseId: padLease(CABIN_CLAIM_IDX),
        ownerType: 'checkout'
      }),
      2
    );

    const page1 = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(page1.releasedCleanupBatchLimit, 100);
    assert.equal(page1.releasedCleanupAttempted, 100);
    assert.equal(page1.releasedCleanupCompleted, 100);
    assert.equal(page1.releasedCleanupFailed, 0);
    assert.equal(page1.releasedCleanupHasMore, true);
    assert.equal(page1.releasedCleanupPending, TOTAL - 100);

    for (let i = 0; i < 100; i += 1) {
      const h = await AccommodationCheckoutLease.findOne({ leaseId: padLease(i) }).lean();
      assert.equal(h.checkoutClaimCleanupStatus, 'complete');
      assert.ok(h.checkoutClaimCleanupCompletedAt);
    }
    const stillPendingPage1 = await AccommodationCheckoutLease.find(pendingCleanupFilter())
      .sort({ leaseId: 1 })
      .limit(5)
      .lean();
    assert.equal(stillPendingPage1[0].leaseId, padLease(100));
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: padLease(UNIT_CLAIM_IDX),
        ownerType: 'checkout'
      }),
      2
    );

    const page2 = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(page2.releasedCleanupAttempted, 100);
    assert.equal(page2.releasedCleanupCompleted, 100);
    assert.equal(page2.releasedCleanupFailed, 0);
    assert.equal(page2.releasedCleanupHasMore, true);
    assert.equal(page2.releasedCleanupPending, TOTAL - 200);

    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: padLease(UNIT_CLAIM_IDX),
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      await CabinNightClaim.countDocuments({
        leaseId: padLease(CABIN_CLAIM_IDX),
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: padLease(UNIT_CLAIM_IDX) }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: padLease(CABIN_CLAIM_IDX) }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );

    // Completed headers from page 1 must not be selected again.
    const selectedAfterPage2 = await AccommodationCheckoutLease.find(pendingCleanupFilter())
      .sort({ leaseId: 1 })
      .limit(100)
      .lean();
    assert.equal(selectedAfterPage2.every((h) => h.leaseId >= padLease(200)), true);

    const page3 = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(page3.releasedCleanupAttempted, 5);
    assert.equal(page3.releasedCleanupCompleted, 5);
    assert.equal(page3.releasedCleanupFailed, 0);
    assert.equal(page3.releasedCleanupPending, 0);
    assert.equal(page3.releasedCleanupHasMore, false);

    const again = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(again.releasedCleanupAttempted, 0);
    assert.equal(again.releasedCleanupCompleted, 0);
    assert.equal(again.releasedCleanupPending, 0);
    assert.equal(again.releasedCleanupHasMore, false);
    assert.equal(await AccommodationCheckoutLease.countDocuments(pendingCleanupFilter()), 0);
    assert.equal(
      await AccommodationCheckoutLease.countDocuments({
        status: 'released',
        checkoutClaimCleanupStatus: 'complete'
      }),
      TOTAL
    );
  });

  it('Crash recovery: pending claims, missing completion marker, intentional release, batch continue', async () => {
    const pendingClaims = await acquireUnitHold('c5_crash_claims');
    let crashed = false;
    await assert.rejects(
      () =>
        releaseAccommodationCheckoutHold(
          pendingClaims.checkoutId,
          { leaseId: pendingClaims.hold.leaseId },
          {
            onAfterHeaderReleasedBeforeClaimDelete: async () => {
              if (!crashed) {
                crashed = true;
                throw new Error('inject_c5_crash_before_delete');
              }
            }
          }
        ),
      /inject_c5_crash_before_delete/
    );
    const mid = await AccommodationCheckoutLease.findOne({
      leaseId: pendingClaims.hold.leaseId
    }).lean();
    assert.equal(mid.status, 'released');
    assert.equal(mid.isLive, false);
    assert.equal(mid.checkoutClaimCleanupStatus, 'pending');
    assert.equal(mid.checkoutClaimCleanupCompletedAt, null);
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: pendingClaims.hold.leaseId,
        ownerType: 'checkout'
      }),
      2
    );

    // Intentional release before expiry must be recoverable immediately (no expiresAt gate).
    assert.equal(new Date(mid.expiresAt).getTime() > Date.now(), true);
    const recovered = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(recovered.releasedCleanupCompleted >= 1, true);
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: pendingClaims.hold.leaseId,
        ownerType: 'checkout'
      }),
      0
    );
    const done = await AccommodationCheckoutLease.findOne({
      leaseId: pendingClaims.hold.leaseId
    }).lean();
    assert.equal(done.checkoutClaimCleanupStatus, 'complete');
    assert.ok(done.checkoutClaimCleanupCompletedAt);

    // Claims deleted but completion marker not written → mark complete.
    const markerOnly = await acquireCabinHold('c5_marker');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: markerOnly.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          checkoutClaimCleanupStatus: 'pending',
          checkoutClaimCleanupCompletedAt: null,
          checkoutClaimCleanupFailureCode: null
        }
      }
    );
    await cabinClaims.expireCabinCheckoutClaims({
      checkoutId: markerOnly.checkoutId,
      leaseId: markerOnly.hold.leaseId,
      generation: markerOnly.hold.generation,
      cabinId: markerOnly.hold.cabinId
    });
    assert.equal(
      await CabinNightClaim.countDocuments({
        leaseId: markerOnly.hold.leaseId,
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: markerOnly.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'pending'
    );
    await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: markerOnly.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );

    // Crash after completion is idempotent.
    const after = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(after.releasedCleanupAttempted, 0);
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: markerOnly.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );

    // Failure on one selected header does not prevent later selected headers.
    const failLease = 'acl_c5f_a_fail';
    const okLease = 'acl_c5f_b_ok';
    const ok2Lease = 'acl_c5f_c_ok';
    await AccommodationCheckoutLease.create({
      leaseId: failLease,
      checkoutId: 'co_c5f_fail',
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[1],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(Date.now() + 3600_000),
      checkoutClaimCleanupStatus: 'pending'
    });
    await createCheckoutUnitClaims({
      checkoutId: 'co_c5f_fail',
      leaseId: failLease,
      unitId: unitIds[1]
    });
    for (const [leaseId, cid] of [
      [okLease, 'co_c5f_ok1'],
      [ok2Lease, 'co_c5f_ok2']
    ]) {
      await AccommodationCheckoutLease.create({
        leaseId,
        checkoutId: cid,
        generation: 1,
        status: 'released',
        isLive: false,
        entityType: 'unit',
        unitId: unitIds[2],
        cabinId: null,
        checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
        checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
        expectedNightCount: 2,
        expiresAt: new Date(Date.now() + 3600_000),
        checkoutClaimCleanupStatus: 'pending'
      });
    }

    const batch = await expireAccommodationCheckoutHolds({
      now: new Date(),
      onAfterHeaderReleasedBeforeClaimDelete: async ({ leaseId }) => {
        if (leaseId === failLease) {
          const err = new Error('inject_batch_fail');
          err.code = 'INJECTED_CLEANUP_FAIL';
          throw err;
        }
      }
    });
    assert.equal(batch.releasedCleanupFailed >= 1, true);
    assert.equal(batch.releasedCleanupCompleted >= 2, true);
    assert.equal(
      batch.failedCleanupIdentities.some(
        (x) => x.leaseId === failLease && x.failureCode === 'INJECTED_CLEANUP_FAIL'
      ),
      true
    );
    const failedHeader = await AccommodationCheckoutLease.findOne({ leaseId: failLease }).lean();
    assert.equal(failedHeader.checkoutClaimCleanupStatus, 'pending');
    assert.equal(failedHeader.checkoutClaimCleanupFailureCode, 'INJECTED_CLEANUP_FAIL');
    assert.ok(failedHeader.checkoutClaimCleanupLastAttemptAt);
    assert.equal(Number(failedHeader.checkoutClaimCleanupAttemptCount) >= 1, true);
    assert.ok(failedHeader.checkoutClaimCleanupNextAttemptAt);
    assert.equal(
      new Date(failedHeader.checkoutClaimCleanupNextAttemptAt).getTime() > Date.now(),
      true
    );
    // Failed header must not be immediately eligible again.
    const againSameNow = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(
      againSameNow.releasedCleanupFailedIdentities.some((x) => x.leaseId === failLease),
      false
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: failLease, ownerType: 'checkout' }),
      2
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: okLease }).lean())
        .checkoutClaimCleanupStatus,
      'complete'
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: ok2Lease }).lean())
        .checkoutClaimCleanupStatus,
      'complete'
    );
  });

  it('Safety: sealed/converting/converted/live excluded; booking and foreign claims survive', async () => {
    const sealed = await acquireUnitHold('c5_safe_sealed');
    const converting = await acquireUnitHold('c5_safe_conv');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: converting.hold.leaseId },
      {
        $set: {
          status: 'converting',
          conversionBookingId: new mongoose.Types.ObjectId(),
          conversionAttemptId: 'att_c5',
          conversionStartedAt: new Date(),
          expiresAt: new Date(Date.now() - 60_000)
        }
      }
    );
    const converted = await acquireCabinHold('c5_safe_converted');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: converted.hold.leaseId },
      {
        $set: {
          status: 'converted',
          isLive: false,
          convertedAt: new Date(),
          checkoutClaimCleanupStatus: 'pending'
        }
      }
    );

    // Booking-owned claim on a night outside the hold stay window.
    const bookingId = new mongoose.Types.ObjectId();
    await UnitNightClaim.create({
      unitId: sealed.hold.unitId,
      night: unitClaims.nightDateFromDateOnly('2026-11-01'),
      ownerType: 'booking',
      bookingId,
      checkoutId: null,
      leaseId: null,
      acquisitionId: null,
      expiresAt: null,
      source: 'finalize'
    });

    // Live foreign lease claims must survive cleanup of a different released header.
    const foreignLive = await acquireCabinHold('c5_safe_foreign', stoneCabinId);

    const target = await acquireUnitHold('c5_safe_target');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: target.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          checkoutClaimCleanupStatus: 'pending',
          expiresAt: new Date(Date.now() - 60_000)
        }
      }
    );

    // Newer live sealed generation/lease claims must survive.
    const newer = await acquireUnitHold('c5_safe_newer');
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: newer.hold.leaseId,
        ownerType: 'checkout'
      }),
      2
    );

    await expireAccommodationCheckoutHolds({ now: new Date() });

    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: sealed.hold.leaseId }).lean()).status,
      'sealed'
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: converting.hold.leaseId }).lean())
        .status,
      'converting'
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: converted.hold.leaseId }).lean())
        .status,
      'converted'
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: converted.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'pending'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 1);
    assert.equal(
      await CabinNightClaim.countDocuments({
        leaseId: foreignLive.hold.leaseId,
        ownerType: 'checkout'
      }),
      2
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: foreignLive.hold.leaseId }).lean())
        .status,
      'sealed'
    );
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: target.hold.leaseId,
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: target.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: newer.hold.leaseId,
        ownerType: 'checkout'
      }),
      2
    );
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: newer.hold.leaseId }).lean()).status,
      'sealed'
    );

    // Fixed-model authorization still rejects caller-supplied model override.
    await assert.rejects(
      () =>
        unitClaims.expireUnitCheckoutClaims({
          checkoutId: target.checkoutId,
          leaseId: target.hold.leaseId,
          generation: target.hold.generation,
          unitId: target.hold.unitId,
          AccommodationCheckoutLease: {
            findOne: async () => ({
              status: 'released',
              isLive: false,
              generation: target.hold.generation,
              entityType: 'unit',
              checkoutId: target.checkoutId,
              leaseId: target.hold.leaseId,
              unitId: target.hold.unitId
            })
          }
        }),
      (err) => /EXPIRY_UNAUTHORIZED/.test(err.code)
    );
  });

  it('Concurrency: two recovery workers complete one durable cleanup state', async () => {
    const ctx = await acquireUnitHold('c5_conc');
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          checkoutClaimCleanupStatus: 'pending',
          checkoutClaimCleanupCompletedAt: null,
          checkoutClaimCleanupFailureCode: null,
          expiresAt: new Date(Date.now() + 3600_000)
        }
      }
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      2
    );

    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({ now: new Date() }),
      expireAccommodationCheckoutHolds({ now: new Date() })
    ]);
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'released');
    assert.equal(header.isLive, false);
    assert.equal(header.checkoutClaimCleanupStatus, 'complete');
    assert.ok(header.checkoutClaimCleanupCompletedAt);
    assert.equal(header.checkoutClaimCleanupFailureCode, null);
    assert.equal(
      (a.releasedCleanupCompleted || 0) + (b.releasedCleanupCompleted || 0) >= 1,
      true
    );

    const again = await expireAccommodationCheckoutHolds({ now: new Date() });
    assert.equal(again.releasedCleanupAttempted, 0);
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );

    // Promotion vs release mutual exclusion remains intact.
    const race = await acquireUnitHold('c5_race');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: race.checkoutId,
      hold: race.hold,
      attemptId: race.attemptId,
      bookingId
    });
    const results = await Promise.allSettled([
      promoteAccommodationCheckoutHoldToBooking(promoteInput(race, bookingId)),
      releaseAccommodationCheckoutHold(race.checkoutId, { leaseId: race.hold.leaseId })
    ]);
    const raceHeader = await AccommodationCheckoutLease.findOne({
      leaseId: race.hold.leaseId
    }).lean();
    assert.ok(raceHeader.status === 'converting' || raceHeader.status === 'released');
    if (raceHeader.status === 'released') {
      assert.equal(raceHeader.checkoutClaimCleanupStatus, 'complete');
      assert.equal(
        await UnitNightClaim.countDocuments({
          leaseId: race.hold.leaseId,
          ownerType: 'checkout'
        }),
        0
      );
    } else {
      assert.equal(
        results.some((r) => r.status === 'fulfilled' && r.value && r.value.ok === true),
        true
      );
    }
  });

describe('B8F5A — starvation-safe released-header cleanup', () => {
  function eligibleCleanupFilter(now) {
    return {
      status: 'released',
      isLive: false,
      $or: [
        { checkoutClaimCleanupStatus: 'pending' },
        { checkoutClaimCleanupStatus: null },
        { checkoutClaimCleanupStatus: { $exists: false } }
      ],
      $and: [
        {
          $or: [
            { checkoutClaimCleanupNextAttemptAt: null },
            { checkoutClaimCleanupNextAttemptAt: { $exists: false } },
            { checkoutClaimCleanupNextAttemptAt: { $lte: now } }
          ]
        }
      ]
    };
  }

  it('Backoff formula doubles then caps at one hour', () => {
    assert.equal(computeReleasedCleanupRetryDelayMs(1), RELEASED_CLEANUP_RETRY_BASE_MS);
    assert.equal(computeReleasedCleanupRetryDelayMs(2), RELEASED_CLEANUP_RETRY_BASE_MS * 2);
    assert.equal(computeReleasedCleanupRetryDelayMs(3), RELEASED_CLEANUP_RETRY_BASE_MS * 4);
    assert.equal(computeReleasedCleanupRetryDelayMs(100), RELEASED_CLEANUP_RETRY_MAX_MS);
    let prev = 0;
    for (let n = 1; n <= 20; n += 1) {
      const d = computeReleasedCleanupRetryDelayMs(n);
      assert.equal(d >= prev, true);
      assert.equal(d <= RELEASED_CLEANUP_RETRY_MAX_MS, true);
      prev = d;
    }
  });

  it('Poison-pill batch defers failures so later Unit/Cabin claims are cleaned', async () => {
    const TOTAL = 205;
    const POISON = 100;
    const UNIT_IDX = 105;
    const CABIN_IDX = 110;
    const t0 = new Date('2026-06-01T12:00:00.000Z');

    const docs = [];
    for (let i = 0; i < TOTAL; i += 1) {
      const isUnit = i === UNIT_IDX;
      const isCabin = i === CABIN_IDX;
      docs.push({
        leaseId: padLease(i),
        checkoutId: padCheckout(i),
        generation: 1,
        status: 'released',
        isLive: false,
        entityType: isCabin ? 'cabin' : 'unit',
        unitId: isCabin ? null : unitIds[i % unitIds.length],
        cabinId: isCabin ? luxCabinId : null,
        checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
        checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
        expectedNightCount: 2,
        expiresAt: new Date(t0.getTime() + 3600_000),
        activeAcquisitionId: null,
        acquisitionStartedAt: null,
        checkoutClaimCleanupStatus: 'pending',
        checkoutClaimCleanupAttemptCount: 0,
        checkoutClaimCleanupNextAttemptAt: null
      });
    }
    await AccommodationCheckoutLease.insertMany(docs);
    await createCheckoutUnitClaims({
      checkoutId: padCheckout(UNIT_IDX),
      leaseId: padLease(UNIT_IDX),
      unitId: unitIds[0]
    });
    await createCheckoutCabinClaims({
      checkoutId: padCheckout(CABIN_IDX),
      leaseId: padLease(CABIN_IDX),
      cabinId: luxCabinId
    });

    const poisonLeaseIds = new Set(
      Array.from({ length: POISON }, (_, i) => padLease(i))
    );

    const pass1 = await expireAccommodationCheckoutHolds({
      now: t0,
      onAfterCleanupAttemptReserved: async ({ leaseId }) => {
        if (poisonLeaseIds.has(leaseId)) {
          const err = new Error('poison');
          err.code = 'POISON_CLEANUP_FAIL';
          throw err;
        }
      }
    });
    assert.equal(pass1.releasedCleanupSelected, 100);
    assert.equal(pass1.releasedCleanupAttempted, 100);
    assert.equal(pass1.releasedCleanupFailed, 100);
    assert.equal(pass1.releasedCleanupCompleted, 0);
    assert.equal(pass1.releasedCleanupEligibleHasMore, true);
    assert.equal(pass1.releasedCleanupPendingTotal, TOTAL);
    assert.ok(pass1.releasedCleanupNextRetryAt);
    assert.equal(
      new Date(pass1.releasedCleanupNextRetryAt).getTime(),
      t0.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS
    );

    for (let i = 0; i < POISON; i += 1) {
      const h = await AccommodationCheckoutLease.findOne({ leaseId: padLease(i) }).lean();
      assert.equal(h.checkoutClaimCleanupStatus, 'pending');
      assert.equal(Number(h.checkoutClaimCleanupAttemptCount), 1);
      assert.equal(
        new Date(h.checkoutClaimCleanupNextAttemptAt).getTime(),
        t0.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS
      );
    }
    // Poison headers are no longer immediately eligible.
    assert.equal(
      await AccommodationCheckoutLease.countDocuments(eligibleCleanupFilter(t0)),
      TOTAL - POISON
    );

    const pass2 = await expireAccommodationCheckoutHolds({
      now: t0,
      onAfterCleanupAttemptReserved: async ({ leaseId }) => {
        if (poisonLeaseIds.has(leaseId)) {
          const err = new Error('poison');
          err.code = 'POISON_CLEANUP_FAIL';
          throw err;
        }
      }
    });
    assert.equal(pass2.releasedCleanupAttempted, 100);
    assert.equal(pass2.releasedCleanupFailed, 0);
    assert.equal(pass2.releasedCleanupCompleted, 100);
    assert.equal(
      await UnitNightClaim.countDocuments({
        leaseId: padLease(UNIT_IDX),
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      await CabinNightClaim.countDocuments({
        leaseId: padLease(CABIN_IDX),
        ownerType: 'checkout'
      }),
      0
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: padLease(UNIT_IDX) }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );
    assert.equal(
      (
        await AccommodationCheckoutLease.findOne({ leaseId: padLease(CABIN_IDX) }).lean()
      ).checkoutClaimCleanupStatus,
      'complete'
    );

    const pass3 = await expireAccommodationCheckoutHolds({
      now: t0,
      onAfterCleanupAttemptReserved: async ({ leaseId }) => {
        if (poisonLeaseIds.has(leaseId)) {
          const err = new Error('poison');
          err.code = 'POISON_CLEANUP_FAIL';
          throw err;
        }
      }
    });
    assert.equal(pass3.releasedCleanupCompleted, 5);
    assert.equal(pass3.releasedCleanupEligibleHasMore, false);
    assert.equal(pass3.releasedCleanupPendingTotal, POISON);

    // Only deferred poison remains — no eligible work → no busy loop.
    const idle = await expireAccommodationCheckoutHolds({ now: t0 });
    assert.equal(idle.releasedCleanupSelected, 0);
    assert.equal(idle.releasedCleanupAttempted, 0);
    assert.equal(idle.releasedCleanupEligibleHasMore, false);
    assert.equal(idle.releasedCleanupPendingTotal, POISON);

    // Advancing now re-enables poison retries; repeated failures stay non-terminal.
    const tRetry = new Date(t0.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS);
    const retry = await expireAccommodationCheckoutHolds({
      now: tRetry,
      onAfterCleanupAttemptReserved: async ({ leaseId }) => {
        if (poisonLeaseIds.has(leaseId)) {
          const err = new Error('poison');
          err.code = 'POISON_CLEANUP_FAIL';
          throw err;
        }
      }
    });
    assert.equal(retry.releasedCleanupAttempted, 100);
    assert.equal(retry.releasedCleanupFailed, 100);
    const poisonAfter = await AccommodationCheckoutLease.findOne({
      leaseId: padLease(0)
    }).lean();
    assert.equal(poisonAfter.checkoutClaimCleanupStatus, 'pending');
    assert.equal(Number(poisonAfter.checkoutClaimCleanupAttemptCount), 2);
    assert.equal(
      new Date(poisonAfter.checkoutClaimCleanupNextAttemptAt).getTime(),
      tRetry.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS * 2
    );
  });

  it('Annotation failure preserves retry time and does not abort later headers', async () => {
    const failLease = 'acl_b8f5a_ann_fail';
    const okLease = 'acl_b8f5a_ann_ok';
    const t0 = new Date('2026-07-01T00:00:00.000Z');
    await AccommodationCheckoutLease.create({
      leaseId: failLease,
      checkoutId: 'co_b8f5a_ann_fail',
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[1],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(t0.getTime() + 3600_000),
      checkoutClaimCleanupStatus: 'pending',
      checkoutClaimCleanupAttemptCount: 0,
      checkoutClaimCleanupNextAttemptAt: null
    });
    await createCheckoutUnitClaims({
      checkoutId: 'co_b8f5a_ann_fail',
      leaseId: failLease,
      unitId: unitIds[1]
    });
    await AccommodationCheckoutLease.create({
      leaseId: okLease,
      checkoutId: 'co_b8f5a_ann_ok',
      generation: 1,
      status: 'released',
      isLive: false,
      entityType: 'unit',
      unitId: unitIds[2],
      cabinId: null,
      checkIn: new Date(`${STAY_IN}T12:00:00.000Z`),
      checkOut: new Date(`${STAY_OUT}T12:00:00.000Z`),
      expectedNightCount: 2,
      expiresAt: new Date(t0.getTime() + 3600_000),
      checkoutClaimCleanupStatus: 'pending',
      checkoutClaimCleanupAttemptCount: 0,
      checkoutClaimCleanupNextAttemptAt: null
    });

    let annotateThrows = true;
    const origUpdateOne = AccommodationCheckoutLease.updateOne.bind(AccommodationCheckoutLease);
    AccommodationCheckoutLease.updateOne = async function patchedUpdateOne(filter, update, opts) {
      const setsFailure =
        update &&
        update.$set &&
        Object.prototype.hasOwnProperty.call(update.$set, 'checkoutClaimCleanupFailureCode') &&
        update.$set.checkoutClaimCleanupFailureCode != null &&
        !Object.prototype.hasOwnProperty.call(update.$set, 'checkoutClaimCleanupNextAttemptAt');
      if (annotateThrows && setsFailure && filter && filter.leaseId === failLease) {
        annotateThrows = false;
        throw new Error('inject_annotation_fail');
      }
      return origUpdateOne(filter, update, opts);
    };

    try {
      const batch = await expireAccommodationCheckoutHolds({
        now: t0,
        onAfterHeaderReleasedBeforeClaimDelete: async ({ leaseId }) => {
          if (leaseId === failLease) {
            const err = new Error('cleanup boom');
            err.code = 'INJECTED_CLEANUP_FAIL';
            throw err;
          }
        }
      });
      assert.equal(batch.releasedCleanupFailed >= 1, true);
      assert.equal(batch.releasedCleanupAnnotationFailed >= 1, true);
      assert.equal(batch.releasedCleanupCompleted >= 1, true);
      assert.equal(
        (
          await AccommodationCheckoutLease.findOne({ leaseId: okLease }).lean()
        ).checkoutClaimCleanupStatus,
        'complete'
      );
      const failed = await AccommodationCheckoutLease.findOne({ leaseId: failLease }).lean();
      assert.equal(failed.checkoutClaimCleanupStatus, 'pending');
      assert.equal(Number(failed.checkoutClaimCleanupAttemptCount), 1);
      assert.ok(failed.checkoutClaimCleanupNextAttemptAt);
      assert.equal(
        new Date(failed.checkoutClaimCleanupNextAttemptAt).getTime(),
        t0.getTime() + RELEASED_CLEANUP_RETRY_BASE_MS
      );
    } finally {
      AccommodationCheckoutLease.updateOne = origUpdateOne;
    }
  });

  it('Concurrent workers reserve at most one attempt for the same due header', async () => {
    const ctx = await acquireUnitHold('b8f5a_conc');
    const t0 = new Date();
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      {
        $set: {
          status: 'released',
          isLive: false,
          checkoutClaimCleanupStatus: 'pending',
          checkoutClaimCleanupAttemptCount: 0,
          checkoutClaimCleanupNextAttemptAt: null,
          checkoutClaimCleanupCompletedAt: null,
          checkoutClaimCleanupFailureCode: null,
          expiresAt: new Date(t0.getTime() + 3600_000)
        }
      }
    );

    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({ now: t0 }),
      expireAccommodationCheckoutHolds({ now: t0 })
    ]);
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.checkoutClaimCleanupStatus, 'complete');
    assert.equal(header.checkoutClaimCleanupNextAttemptAt, null);
    // At most one successful attempt reservation path increments count before complete.
    assert.equal(Number(header.checkoutClaimCleanupAttemptCount) >= 1, true);
    assert.equal(Number(header.checkoutClaimCleanupAttemptCount) <= 2, true);
    assert.equal(
      (a.releasedCleanupCompleted || 0) + (b.releasedCleanupCompleted || 0) >= 1,
      true
    );
    assert.equal(
      await UnitNightClaim.countDocuments({ leaseId: ctx.hold.leaseId, ownerType: 'checkout' }),
      0
    );
  });

  it('Correction 1: expire rejects caller cleanup-authority injection', async () => {
    await assert.rejects(
      () =>
        expireAccommodationCheckoutHolds({
          now: new Date(),
          skipCleanupAttemptReservation: true
        }),
      (err) =>
        err instanceof AccommodationCheckoutHoldError &&
        err.code === 'ACCOMMODATION_LEASE_CLEANUP_AUTHORITY_INJECTION'
    );
  });

  it('Correction 1: concurrent workers on malformed negative count reserve once → 1', async () => {
    const leaseId = `acl_b8f5a_neg_${crypto.randomBytes(3).toString('hex')}`;
    const t0 = new Date('2026-08-15T00:00:00.000Z');
    await AccommodationCheckoutLease.collection.insertOne({
      leaseId,
      checkoutId: `co_${leaseId}`,
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
      checkoutClaimCleanupAttemptCount: -3,
      checkoutClaimCleanupNextAttemptAt: null,
      createdAt: t0,
      updatedAt: t0
    });
    const [a, b] = await Promise.all([
      expireAccommodationCheckoutHolds({ now: t0 }),
      expireAccommodationCheckoutHolds({ now: t0 })
    ]);
    const header = await AccommodationCheckoutLease.findOne({ leaseId }).lean();
    assert.equal(header.checkoutClaimCleanupStatus, 'complete');
    assert.equal(Number(header.checkoutClaimCleanupAttemptCount), 1);
    assert.equal(
      (a.releasedCleanupAttempted || 0) + (b.releasedCleanupAttempted || 0),
      1
    );
  });
});
});

describe('B8F4A Correction 1 — converted replay (minimal)', () => {
  it('Converted-header promote is idempotent without rewind', async () => {
    const ctx = await acquireUnitHold('corr1_conv');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    const header = await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean();
    assert.equal(header.status, 'converted');
    assert.equal(header.isLive, false);

    const replay = await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotentConvertedReplay, true);
    assert.equal(replay.promotedCount, 0);
    assert.equal(replay.headerStatus, 'converted');
    assert.equal(
      (await AccommodationCheckoutLease.findOne({ leaseId: ctx.hold.leaseId }).lean()).status,
      'converted'
    );
    assert.equal(await UnitNightClaim.countDocuments({ bookingId, ownerType: 'booking' }), 2);
  });

  it('Converted-header promote rejects foreign conversionBookingId', async () => {
    const ctx = await acquireUnitHold('corr1_foreign');
    const bookingId = new mongoose.Types.ObjectId();
    await createPaidSession({
      checkoutId: ctx.checkoutId,
      hold: ctx.hold,
      attemptId: ctx.attemptId,
      bookingId
    });
    await promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId));
    await createDurableBooking({
      bookingId,
      checkoutId: ctx.checkoutId,
      unitId: ctx.hold.unitId
    });
    await tombstonePromotedAccommodationCheckoutHold(promoteInput(ctx, bookingId));
    await AccommodationCheckoutLease.updateOne(
      { leaseId: ctx.hold.leaseId },
      { $set: { conversionBookingId: new mongoose.Types.ObjectId() } }
    );
    await assert.rejects(
      () => promoteAccommodationCheckoutHoldToBooking(promoteInput(ctx, bookingId)),
      (err) =>
        err.code === 'ACCOMMODATION_PROMOTION_FOREIGN' ||
        err.code === 'ACCOMMODATION_PROMOTION_IDENTITY'
    );
  });

  it('proveFullVoucherPaidAuthority is exported', () => {
    assert.equal(typeof proveFullVoucherPaidAuthority, 'function');
  });
});

