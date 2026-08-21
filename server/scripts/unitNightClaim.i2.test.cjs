/**
 * Inventory Integrity I2 — UnitNightClaim shadow dual-write.
 * Run: cd server && node --test scripts/unitNightClaim.i2.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const UnitNightClaim = require('../models/UnitNightClaim');
const Booking = require('../models/Booking');
const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Cabin = require('../models/Cabin');
const ManualReviewItem = require('../models/ManualReviewItem');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const AvailabilityBlock = require('../models/AvailabilityBlock');
const CheckoutSession = require('../models/CheckoutSession');
const {
  claimUnitNights,
  ERR
} = require('../services/inventory/unitNightClaimService');
const {
  ensureUnitNightClaimsShadow,
  SHADOW_OUTCOMES,
  I2_SOURCES,
  MRI_CATEGORY,
  MRI_SOURCE
} = require('../services/inventory/ensureUnitNightClaimsShadow');
const {
  executeBookingFinalizeWork,
  __setExecuteBookingFinalizeWorkDependenciesForTesting,
  __resetExecuteBookingFinalizeWorkDependenciesForTesting
} = require('../services/checkout/executeBookingFinalizeWork');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { normalizeDateToSofiaDayStart, formatSofiaDateOnly } = require('../utils/dateTime');
const { PAID_BOOKING_FINALIZATION_STAGES } = require('../services/payments/paidBookingFinalizationStages');

let mongoServer;

function sofiaDay(isoDateOnly) {
  return normalizeDateToSofiaDayStart(`${isoDateOnly}T12:00:00.000Z`);
}

async function seedCabinTypeAndUnits() {
  const cabinType = await CabinType.create({
    name: 'I2 Test A-Frames',
    slug: `i2-aframes-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    description: 'UnitNightClaim I2 tests',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/i2.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const unitA = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-01',
    displayName: 'A-Frame 1',
    isActive: true
  });
  const unitB = await Unit.create({
    cabinTypeId: cabinType._id,
    unitNumber: 'AF-02',
    displayName: 'A-Frame 2',
    isActive: true
  });
  return { cabinType, unitA, unitB };
}

async function createAllocatedBooking(overrides = {}) {
  const { cabinType, unitA } = overrides._seed || (await seedCabinTypeAndUnits());
  const checkIn = overrides.checkIn || sofiaDay('2026-09-10');
  const checkOut = overrides.checkOut || sofiaDay('2026-09-13');
  const booking = await Booking.create({
    cabinTypeId: overrides.cabinTypeId || cabinType._id,
    unitId: overrides.unitId === undefined ? unitA._id : overrides.unitId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: overrides.status || 'confirmed',
    isTest: false,
    isProductionSafe: false,
    guestInfo: {
      firstName: 'I2',
      lastName: 'Guest',
      email: overrides.email || 'i2-guest@example.com',
      phone: '+359000000001'
    },
    totalPrice: 300,
    checkoutId: overrides.checkoutId || null,
    stripePaymentIntentId: overrides.paymentIntentId || null,
    tripType: 'retreat',
    romanticSetup: false
  });
  return { booking, cabinType, unitA, unitB: overrides._seed?.unitB, checkIn, checkOut };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  const { ensureAuthoritativeUniqueIndexForTests } = require('../services/inventory/unitNightClaimService');
  await ensureAuthoritativeUniqueIndexForTests();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  await Promise.all([
    UnitNightClaim.deleteMany({}),
    Booking.deleteMany({}),
    Unit.deleteMany({}),
    CabinType.deleteMany({}),
    Cabin.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    PaymentResolutionIssue.deleteMany({}),
    AvailabilityBlock.deleteMany({}),
    CheckoutSession.deleteMany({})
  ]);
});

test('helper: allocated multi-unit creates expected claims excluding checkout day', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  const outcome = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.nights, ['2026-09-10', '2026-09-11', '2026-09-12']);
  assert.equal(outcome.nights.includes(formatSofiaDateOnly(checkOut)), false);

  const rows = await UnitNightClaim.find({ bookingId: booking._id }).lean();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => String(r.unitId) === String(unitA._id)));
  assert.ok(rows.every((r) => r.source === 'finalize'));
});

test('helper: replay is already_owned without duplicate rows', async () => {
  const { booking } = await createAllocatedBooking();
  await ensureUnitNightClaimsShadow({ booking, source: I2_SOURCES.FINALIZE });
  const second = await ensureUnitNightClaimsShadow({ booking, source: I2_SOURCES.FINALIZE });
  assert.equal(second.outcome, SHADOW_OUTCOMES.ALREADY_OWNED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('helper: crash-equivalent missing claims repaired on ensure', async () => {
  const { booking, unitA, checkIn, checkOut } = await createAllocatedBooking();
  await claimUnitNights({
    bookingId: booking._id,
    unitId: unitA._id,
    checkIn,
    checkOut: sofiaDay('2026-09-11'),
    source: 'finalize'
  });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 1);
  const outcome = await ensureUnitNightClaimsShadow({ booking, source: I2_SOURCES.FINALIZE });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(outcome.insertedCount, 2);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('helper: claim DB failure preserves Booking and creates MRI (deduped)', async () => {
  const { booking } = await createAllocatedBooking({
    paymentIntentId: 'pi_i2_shadow_fail',
    checkoutId: 'cs_i2_shadow_fail'
  });
  const boom = Object.assign(new Error('insertMany exploded'), {
    code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE'
  });
  const outcome = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE,
    paymentIntentId: 'pi_i2_shadow_fail',
    checkoutId: 'cs_i2_shadow_fail',
    stripePaymentVerified: true,
    claimUnitNightsFn: async () => {
      throw boom;
    },
    throwOnFailure: false
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.WRITE_FAILURE);
  assert.equal(outcome.ok, false);
  assert.ok(await Booking.findById(booking._id));
  assert.equal(await UnitNightClaim.countDocuments({}), 0);

  const mris = await ManualReviewItem.find({
    category: MRI_CATEGORY,
    entityId: String(booking._id),
    status: 'open'
  });
  assert.equal(mris.length, 1);
  assert.ok(mris[0].provenance.source);

  const again = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE,
    paymentIntentId: 'pi_i2_shadow_fail',
    checkoutId: 'cs_i2_shadow_fail',
    stripePaymentVerified: true,
    claimUnitNightsFn: async () => {
      throw boom;
    },
    throwOnFailure: false
  });
  assert.equal(again.outcome, SHADOW_OUTCOMES.WRITE_FAILURE);
  assert.equal(
    await ManualReviewItem.countDocuments({
      category: MRI_CATEGORY,
      entityId: String(booking._id),
      status: 'open'
    }),
    1
  );

  const pri = await PaymentResolutionIssue.findOne({ paymentIntentId: 'pi_i2_shadow_fail' });
  assert.ok(pri);
  assert.equal(pri.issueType, 'paid_booking_unknown_failure');
  assert.equal(pri.finalizationStage, PAID_BOOKING_FINALIZATION_STAGES.UNIT_NIGHT_CLAIM_SHADOW);
});

test('helper: later retry fills missing claims after prior write failure', async () => {
  const { booking } = await createAllocatedBooking();
  let failOnce = true;
  await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE,
    claimUnitNightsFn: async (args) => {
      if (failOnce) {
        failOnce = false;
        throw Object.assign(new Error('transient'), { code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE' });
      }
      return claimUnitNights(args);
    },
    throwOnFailure: false
  });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
  const repaired = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE
  });
  assert.equal(repaired.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('helper: foreign claim preserves Booking and surfaces reconciliation', async () => {
  const seed = await seedCabinTypeAndUnits();
  const holder = await createAllocatedBooking({
    _seed: seed,
    email: 'holder@example.com'
  });
  await claimUnitNights({
    bookingId: holder.booking._id,
    unitId: seed.unitA._id,
    checkIn: holder.checkIn,
    checkOut: holder.checkOut,
    source: 'finalize'
  });
  const other = await createAllocatedBooking({
    _seed: seed,
    email: 'other@example.com',
    unitId: seed.unitA._id,
    checkIn: holder.checkIn,
    checkOut: holder.checkOut
  });
  const outcome = await ensureUnitNightClaimsShadow({
    booking: other.booking,
    source: I2_SOURCES.FINALIZE,
    throwOnFailure: false
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.FOREIGN_OWNER);
  assert.equal(outcome.errorCode, ERR.FOREIGN_OWNER);
  assert.ok(await Booking.findById(other.booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({
      category: MRI_CATEGORY,
      entityId: String(other.booking._id),
      status: 'open'
    }),
    1
  );
});

test('helper: wrong unit/cabinType surfaces integrity MRI', async () => {
  const seed = await seedCabinTypeAndUnits();
  const otherType = await CabinType.create({
    name: 'I2 Other Type',
    slug: `i2-other-${Date.now()}`,
    description: 'mismatch',
    capacity: 2,
    pricePerNight: 80,
    minNights: 1,
    imageUrl: 'https://example.com/other.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley'
  });
  const { booking } = await createAllocatedBooking({
    _seed: seed,
    cabinTypeId: otherType._id,
    unitId: seed.unitA._id
  });
  const outcome = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.FINALIZE,
    throwOnFailure: false
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.INTEGRITY_CABIN_TYPE_MISMATCH);
  assert.ok(await Booking.findById(booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({
      category: MRI_CATEGORY,
      entityId: String(booking._id),
      status: 'open'
    }),
    1
  );
});

test('helper: single-cabin and unallocated skip', async () => {
  const cabin = await Cabin.create({
    name: 'I2 Single',
    slug: `i2-single-${Date.now()}`,
    description: 'single',
    capacity: 2,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/s.jpg',
    location: 'Bulgaria',
    propertyKind: 'valley',
    isActive: true
  });
  const single = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'S',
      lastName: 'G',
      email: 'single@example.com',
      phone: '+3591'
    },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  const skipCabin = await ensureUnitNightClaimsShadow({
    booking: single,
    source: I2_SOURCES.FINALIZE
  });
  assert.equal(skipCabin.outcome, SHADOW_OUTCOMES.SKIPPED_NOT_MULTI_UNIT);

  const seed = await seedCabinTypeAndUnits();
  const unalloc = await Booking.create({
    cabinTypeId: seed.cabinType._id,
    unitId: null,
    checkIn: sofiaDay('2026-09-10'),
    checkOut: sofiaDay('2026-09-12'),
    adults: 2,
    children: 0,
    status: 'pending',
    guestInfo: {
      firstName: 'U',
      lastName: 'G',
      email: 'unalloc@example.com',
      phone: '+3592'
    },
    totalPrice: 100,
    tripType: 'retreat',
    romanticSetup: false
  });
  const skipUnit = await ensureUnitNightClaimsShadow({
    booking: unalloc,
    source: I2_SOURCES.FINALIZE
  });
  assert.equal(skipUnit.outcome, SHADOW_OUTCOMES.SKIPPED_UNALLOCATED);
  assert.equal(await UnitNightClaim.countDocuments({}), 0);
});

test('helper: legacy and location and recovery sources are recorded', async () => {
  const seed = await seedCabinTypeAndUnits();
  for (const source of [
    I2_SOURCES.LEGACY_CREATE,
    I2_SOURCES.LOCATION_CHILD,
    I2_SOURCES.MULTI_UNIT_RECOVERY
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const { booking } = await createAllocatedBooking({
      _seed: seed,
      email: `${source}@example.com`,
      unitId: seed.unitA._id,
      checkIn: sofiaDay('2026-10-01'),
      checkOut: sofiaDay('2026-10-02')
    });
    // eslint-disable-next-line no-await-in-loop
    await UnitNightClaim.deleteMany({});
    // eslint-disable-next-line no-await-in-loop
    const outcome = await ensureUnitNightClaimsShadow({ booking, source });
    assert.equal(outcome.source, source);
    // eslint-disable-next-line no-await-in-loop
    const row = await UnitNightClaim.findOne({ bookingId: booking._id }).lean();
    assert.equal(row.source, source);
  }
});

test('executeBookingFinalizeWork: multi-unit finalize creates claims; replay repairs', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const checkIn = sofiaDay('2026-11-01');
  const checkOut = sofiaDay('2026-11-03');
  const checkoutId = `cs_i2_finalize_${Date.now()}`;
  const email = 'finalize-i2@example.com';
  const fingerprint = buildStayFingerprint({
    guestEmail: email,
    entityType: 'cabinType',
    cabinTypeId: String(cabinType._id),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
  const session = await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    stayFingerprint: fingerprint,
    guestEmail: email,
    quoteSnapshot: {
      cabinTypeId: cabinType._id,
      totalCents: 20000,
      currency: 'eur'
    }
  });

  const AssignmentEngine = require('../services/assignmentEngine');
  const originalAssign = AssignmentEngine.assignUnit;
  AssignmentEngine.assignUnit = async () => unitA;

  try {
    const result = await executeBookingFinalizeWork({
      session,
      checkoutId,
      paymentIntentId: null,
      finalizeContext: {
        cabinTypeId: cabinType._id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: 2,
        children: 0,
        guestInfo: {
          firstName: 'Fin',
          lastName: 'Guest',
          email,
          phone: '+359800000099'
        },
        specialRequests: '',
        totalPrice: 200,
        subtotalPrice: 200,
        discountAmount: 0,
        subtotalCents: 20000,
        discountAmountCents: 0,
        giftVoucherAppliedCents: 0,
        stripePaidAmountCents: 0,
        totalValueCents: 20000,
        paymentMethod: 'stripe',
        stripePaymentVerified: false,
        initialStatus: 'confirmed',
        legalAcceptance: {
          termsVersion: '2024-01',
          activityRiskVersion: '2024-01',
          checkbox1TextSnapshot: 't',
          checkbox2TextSnapshot: 'r',
          locale: 'en'
        },
        transportOptions: []
      },
      source: 'frontend'
    });

    assert.ok(result.bookingId);
    let claims = await UnitNightClaim.find({ bookingId: result.bookingId }).lean();
    assert.equal(claims.length, 2);
    assert.ok(claims.every((c) => c.source === 'finalize'));

    await UnitNightClaim.deleteMany({ bookingId: result.bookingId });
    const replay = await executeBookingFinalizeWork({
      session,
      checkoutId,
      paymentIntentId: null,
      finalizeContext: {
        cabinTypeId: cabinType._id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: 2,
        children: 0,
        guestInfo: {
          firstName: 'Fin',
          lastName: 'Guest',
          email,
          phone: '+359800000099'
        },
        totalPrice: 200,
        subtotalPrice: 200,
        discountAmount: 0,
        subtotalCents: 20000,
        discountAmountCents: 0,
        giftVoucherAppliedCents: 0,
        stripePaidAmountCents: 0,
        totalValueCents: 20000,
        paymentMethod: 'stripe',
        stripePaymentVerified: false,
        initialStatus: 'confirmed',
        legalAcceptance: {
          termsVersion: '2024-01',
          activityRiskVersion: '2024-01',
          checkbox1TextSnapshot: 't',
          checkbox2TextSnapshot: 'r',
          locale: 'en'
        },
        transportOptions: []
      },
      source: 'frontend'
    });
    assert.equal(replay.result?.idempotentReplay, true);
    claims = await UnitNightClaim.find({ bookingId: result.bookingId }).lean();
    assert.equal(claims.length, 2);
  } finally {
    AssignmentEngine.assignUnit = originalAssign;
  }
});

test('executeBookingFinalizeWork: claim conflict prevents allocated Booking', async () => {
  const seed = await seedCabinTypeAndUnits();
  const { cabinType, unitA } = seed;
  const checkIn = sofiaDay('2026-11-10');
  const checkOut = sofiaDay('2026-11-12');
  const holder = await createAllocatedBooking({
    _seed: seed,
    email: 'holder-finalize@example.com',
    checkIn,
    checkOut,
    unitId: unitA._id
  });
  await claimUnitNights({
    bookingId: holder.booking._id,
    unitId: unitA._id,
    checkIn,
    checkOut,
    source: 'finalize'
  });

  const checkoutId = `cs_i2_fail_${Date.now()}`;
  const email = 'finalize-fail-i2@example.com';
  const fingerprint = buildStayFingerprint({
    guestEmail: email,
    entityType: 'cabinType',
    cabinTypeId: String(cabinType._id),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
  const session = await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    stayFingerprint: fingerprint,
    guestEmail: email,
    quoteSnapshot: { cabinTypeId: cabinType._id, totalCents: 20000, currency: 'eur' }
  });

  const AssignmentEngine = require('../services/assignmentEngine');
  const originalAssign = AssignmentEngine.assignUnit;
  AssignmentEngine.assignUnit = async () => unitA;

  try {
    await assert.rejects(
      () =>
        executeBookingFinalizeWork({
          session,
          checkoutId,
          finalizeContext: {
            cabinTypeId: cabinType._id,
            assignedUnitId: unitA._id,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            adults: 2,
            children: 0,
            guestInfo: {
              firstName: 'Fail',
              lastName: 'Guest',
              email,
              phone: '+359800000088'
            },
            totalPrice: 200,
            subtotalPrice: 200,
            discountAmount: 0,
            subtotalCents: 20000,
            discountAmountCents: 0,
            giftVoucherAppliedCents: 0,
            stripePaidAmountCents: 0,
            totalValueCents: 20000,
            paymentMethod: 'stripe',
            stripePaymentVerified: false,
            initialStatus: 'confirmed',
            legalAcceptance: {
              termsVersion: '2024-01',
              activityRiskVersion: '2024-01',
              checkbox1TextSnapshot: 't',
              checkbox2TextSnapshot: 'r',
              locale: 'en'
            },
            transportOptions: []
          },
          source: 'frontend'
        }),
      (err) => err && (err.code === 'NOT_AVAILABLE' || err.code === ERR.FOREIGN_OWNER)
    );
    assert.equal(await Booking.countDocuments({ checkoutId }), 0);
  } finally {
    AssignmentEngine.assignUnit = originalAssign;
    __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  }
});

test('location: post-canonical shadow; claim failure nonfatal; isolates children', async () => {
  const seed = await seedCabinTypeAndUnits();
  const childA = await Booking.create({
    cabinTypeId: seed.cabinType._id,
    unitId: seed.unitA._id,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03'),
    adults: 1,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Loc',
      lastName: 'A',
      email: 'loc-a@example.com',
      phone: '+3591'
    },
    totalPrice: 50,
    tripType: 'retreat',
    romanticSetup: false
  });
  const childB = await Booking.create({
    cabinTypeId: seed.cabinType._id,
    unitId: seed.unitB._id,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03'),
    adults: 1,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Loc',
      lastName: 'B',
      email: 'loc-b@example.com',
      phone: '+3592'
    },
    totalPrice: 50,
    tripType: 'retreat',
    romanticSetup: false
  });
  const cabin = await Cabin.create({
    name: 'Loc Single',
    slug: `loc-single-${Date.now()}`,
    description: 's',
    capacity: 4,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/l.jpg',
    location: 'Valley',
    propertyKind: 'valley',
    isActive: true
  });
  const singleChild = await Booking.create({
    cabinId: cabin._id,
    checkIn: sofiaDay('2026-12-01'),
    checkOut: sofiaDay('2026-12-03'),
    adults: 1,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Loc',
      lastName: 'S',
      email: 'loc-s@example.com',
      phone: '+3593'
    },
    totalPrice: 50,
    tripType: 'retreat',
    romanticSetup: false
  });

  let failFor = String(childA._id);
  const results = [];
  for (const child of [childA, childB, singleChild]) {
    // eslint-disable-next-line no-await-in-loop
    results.push(
      await ensureUnitNightClaimsShadow({
        booking: child,
        source: I2_SOURCES.LOCATION_CHILD,
        claimUnitNightsFn: async (args) => {
          if (String(args.bookingId) === failFor) {
            throw Object.assign(new Error('child A claim fail'), {
              code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE'
            });
          }
          return claimUnitNights(args);
        },
    throwOnFailure: false
  })
    );
  }

  assert.equal(results[0].outcome, SHADOW_OUTCOMES.WRITE_FAILURE);
  assert.equal(results[1].outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(results[2].outcome, SHADOW_OUTCOMES.SKIPPED_NOT_MULTI_UNIT);
  assert.ok(await Booking.findById(childA._id));
  assert.ok(await Booking.findById(childB._id));
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: childA._id }), 0);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: childB._id }), 2);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: singleChild._id }), 0);
});

test('location service acquires claims before canonical LocationBooking persist', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../services/locationCheckout/locationCheckoutService.js'),
    'utf8'
  );
  assert.match(src, /ensureLocationChildShadowClaims/);
  assert.match(src, /claimUnitNights/);
  assert.match(src, /locationClaimAttempts/);
  // Claims must not be inside runFinalize (txn/fallback canonical writes).
  const runFinalizeBodyStart = src.indexOf('const runFinalize = async');
  const runFinalizeBodyEnd = src.indexOf('try {\n    if (usesTransactions)', runFinalizeBodyStart);
  const runFinalizeSlice = src.slice(runFinalizeBodyStart, runFinalizeBodyEnd);
  assert.equal(runFinalizeSlice.includes('ensureUnitNightClaimsShadow'), false);
  assert.equal(runFinalizeSlice.includes('ensureLocationChildShadowClaims'), false);
  assert.equal(runFinalizeSlice.includes('claimUnitNights'), false);
});

test('recovery: create uses finalize source mapping; adopt helper uses multi_unit_recovery', () => {
  const recoverySrc = fs.readFileSync(
    path.join(__dirname, '../services/checkout/multiUnitPaidOrphanRecoveryService.js'),
    'utf8'
  );
  assert.match(recoverySrc, /I2_SOURCES\.MULTI_UNIT_RECOVERY/);
  assert.match(recoverySrc, /ensureUnitNightClaimsShadow/);
  // Create path still goes through executeBookingFinalizeWork only once.
  assert.match(recoverySrc, /executeBookingFinalizeWork\(/);
  const createCore = recoverySrc.indexOf('runMultiUnitPaidOrphanRecoveryBookingFinalizeCore');
  const adoptEnsure = recoverySrc.indexOf('Adopt path: repair missing shadow claims');
  assert.ok(adoptEnsure > 0);
  assert.ok(createCore > 0);
});

test('recovery adopt path repairs missing claims idempotently', async () => {
  const { booking } = await createAllocatedBooking({
    paymentIntentId: 'pi_recover_adopt',
    checkoutId: 'cs_recover_adopt'
  });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);
  const first = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.MULTI_UNIT_RECOVERY,
    paymentIntentId: 'pi_recover_adopt',
    checkoutId: 'cs_recover_adopt'
  });
  assert.equal(first.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(first.source, I2_SOURCES.MULTI_UNIT_RECOVERY);
  const second = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.MULTI_UNIT_RECOVERY
  });
  assert.equal(second.outcome, SHADOW_OUTCOMES.ALREADY_OWNED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('external AvailabilityBlock hold creates no UnitNightClaim', async () => {
  const seed = await seedCabinTypeAndUnits();
  await AvailabilityBlock.create({
    cabinId: new mongoose.Types.ObjectId(),
    unitId: seed.unitA._id,
    startDate: sofiaDay('2026-09-10'),
    endDate: sofiaDay('2026-09-12'),
    blockType: 'external_hold',
    status: 'active',
    source: 'airbnb_ical'
  });
  assert.equal(await UnitNightClaim.countDocuments({}), 0);
});

test('schema documents unique index with autoIndex disabled; CLAIM_SOURCES include I2 values', () => {
  assert.equal(UnitNightClaim.schema.get('autoIndex'), false);
  const indexes = UnitNightClaim.schema.indexes();
  const uniqueUnitNight = indexes.find(
    ([keys, opts]) => keys.unitId === 1 && keys.night === 1 && opts && opts.unique === true
  );
  assert.ok(uniqueUnitNight);
  assert.equal(UnitNightClaim.AUTHORITATIVE_UNIQUE_INDEX_SPEC.cutoverBatch, 'I6');
  for (const s of Object.values(I2_SOURCES)) {
    assert.ok(UnitNightClaim.CLAIM_SOURCES.includes(s), s);
  }
  assert.equal(
    PAID_BOOKING_FINALIZATION_STAGES.UNIT_NIGHT_CLAIM_SHADOW,
    'unit_night_claim_shadow'
  );
});

test('I2 inventory gate: R1 REALLOCATE may exist without changing I2 claim semantics', () => {
  // Historical I2 lock forbade StayChange. R1 landed later; this gate now asserts
  // I2 claim shadow wiring still owns legacy create, not that StayChange is absent.
  const bookingRoutes = fs.readFileSync(path.join(__dirname, '../routes/bookingRoutes.js'), 'utf8');
  assert.match(bookingRoutes, /ensureLegacyBookingShadowClaims|claimUnitNights/);
  const claimSvc = fs.readFileSync(
    path.join(__dirname, '../services/inventory/unitNightClaimService.js'),
    'utf8'
  );
  assert.match(claimSvc, /requireExactStayChangeOwnership/);
  // Ordinary creators keep booking-scoped idempotency (default false).
  assert.match(claimSvc, /requireExactStayChangeOwnership = false/);
});

test('legacy route wires ensureLegacyBookingShadowClaims', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/bookingRoutes.js'), 'utf8');
  assert.match(src, /ensureLegacyBookingShadowClaims/);
  assert.match(src, /source: 'legacy_create'/);
  assert.match(src, /Surviving Booking must receive shadow claims before voucher-failure exit/);
});

test('PRI stripePaymentVerified is null when caller does not verify payment', async () => {
  const { booking } = await createAllocatedBooking({
    paymentIntentId: 'pi_unverified_legacy',
    checkoutId: 'cs_unverified_legacy'
  });
  await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    paymentIntentId: 'pi_unverified_legacy',
    checkoutId: 'cs_unverified_legacy',
    stripePaymentVerified: null,
    claimUnitNightsFn: async () => {
      throw Object.assign(new Error('fail'), { code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE' });
    },
    throwOnFailure: false
  });
  const pri = await PaymentResolutionIssue.findOne({ paymentIntentId: 'pi_unverified_legacy' });
  assert.ok(pri);
  assert.equal(pri.metadata?.observability?.stripePaymentVerified, null);
});

test('legacy allocated Booking create path creates claims (post-survival ensure)', async () => {
  const { booking } = await createAllocatedBooking({
    email: 'legacy-path@example.com',
    checkoutId: `cs_legacy_${Date.now()}`
  });
  // Mirrors legacy route: Booking already saved, then ensure with legacy_create.
  const outcome = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    checkoutId: booking.checkoutId,
    stripePaymentVerified: false
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(outcome.source, I2_SOURCES.LEGACY_CREATE);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('legacy replay repairs missing claims without duplicate ownership', async () => {
  const checkoutId = `cs_legacy_replay_${Date.now()}`;
  const { booking } = await createAllocatedBooking({ checkoutId, email: 'legacy-replay@example.com' });
  await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    checkoutId
  });
  await UnitNightClaim.deleteMany({ bookingId: booking._id });
  const repaired = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    checkoutId
  });
  assert.equal(repaired.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
  const again = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    checkoutId
  });
  assert.equal(again.outcome, SHADOW_OUTCOMES.ALREADY_OWNED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('legacy shadow failure preserves Booking and creates MRI+PRI when verified PI', async () => {
  const { booking } = await createAllocatedBooking({
    paymentIntentId: 'pi_legacy_shadow',
    checkoutId: 'cs_legacy_shadow',
    email: 'legacy-fail@example.com'
  });
  const outcome = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.LEGACY_CREATE,
    paymentIntentId: 'pi_legacy_shadow',
    checkoutId: 'cs_legacy_shadow',
    stripePaymentVerified: true,
    claimUnitNightsFn: async () => {
      throw Object.assign(new Error('legacy shadow boom'), {
        code: 'UNIT_NIGHT_CLAIM_SHADOW_FAILURE'
      });
    },
    throwOnFailure: false
  });
  assert.equal(outcome.outcome, SHADOW_OUTCOMES.WRITE_FAILURE);
  assert.ok(await Booking.findById(booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({
      category: MRI_CATEGORY,
      entityId: String(booking._id),
      status: 'open'
    }),
    1
  );
  const pri = await PaymentResolutionIssue.findOne({ paymentIntentId: 'pi_legacy_shadow' });
  assert.ok(pri);
  assert.equal(pri.metadata?.observability?.stripePaymentVerified, true);
});

test('executeBookingFinalizeWork: voucher confirm failure still shadow-claims surviving Booking', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const checkIn = sofiaDay('2026-11-20');
  const checkOut = sofiaDay('2026-11-22');
  const checkoutId = `cs_i2_voucher_${Date.now()}`;
  const email = 'voucher-fail-i2@example.com';
  const fingerprint = buildStayFingerprint({
    guestEmail: email,
    entityType: 'cabinType',
    cabinTypeId: String(cabinType._id),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
  const session = await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    finalizeStatus: 'open',
    stayFingerprint: fingerprint,
    guestEmail: email,
    quoteSnapshot: { cabinTypeId: cabinType._id, totalCents: 20000, currency: 'eur' }
  });

  const AssignmentEngine = require('../services/assignmentEngine');
  const originalAssign = AssignmentEngine.assignUnit;
  AssignmentEngine.assignUnit = async () => unitA;

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    confirmVoucherReservation: async () => {
      throw new Error('voucher confirm forced failure');
    }
  });

  try {
    await assert.rejects(
      () =>
        executeBookingFinalizeWork({
          session,
          checkoutId,
          finalizeContext: {
            cabinTypeId: cabinType._id,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            adults: 2,
            children: 0,
            guestInfo: {
              firstName: 'Vouch',
              lastName: 'Fail',
              email,
              phone: '+359800000077'
            },
            totalPrice: 200,
            subtotalPrice: 200,
            discountAmount: 0,
            subtotalCents: 20000,
            discountAmountCents: 0,
            giftVoucherAppliedCents: 5000,
            stripePaidAmountCents: 15000,
            totalValueCents: 20000,
            paymentMethod: 'stripe',
            stripePaymentVerified: true,
            paymentIntentId: 'pi_voucher_fail_i2',
            initialStatus: 'confirmed',
            voucherReservationContext: {
              redemptionId: new mongoose.Types.ObjectId().toString(),
              confirmed: false
            },
            voucherEvidence: {},
            legalAcceptance: {
              termsVersion: '2024-01',
              activityRiskVersion: '2024-01',
              checkbox1TextSnapshot: 't',
              checkbox2TextSnapshot: 'r',
              locale: 'en'
            },
            transportOptions: []
          },
          paymentIntentId: 'pi_voucher_fail_i2',
          source: 'frontend'
        }),
      (err) => err && err.code === 'VOUCHER_CONFIRM_FAILED'
    );

    const booking = await Booking.findOne({ checkoutId });
    assert.ok(booking, 'Booking must survive voucher confirm failure');
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 2);
  } finally {
    AssignmentEngine.assignUnit = originalAssign;
    __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  }
});

test('recovery CREATE path: succeeds with claims despite general MRI stub', async () => {
  const { cabinType, unitA } = await seedCabinTypeAndUnits();
  const checkIn = sofiaDay('2026-12-10');
  const checkOut = sofiaDay('2026-12-12');
  const checkoutId = `cs_i2_recovery_${Date.now()}`;
  const email = 'recovery-create-i2@example.com';
  const piId = 'pi_recovery_create_i2';
  const fingerprint = buildStayFingerprint({
    guestEmail: email,
    entityType: 'cabinType',
    cabinTypeId: String(cabinType._id),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
  const session = await CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'paid',
    finalizeStatus: 'open',
    stayFingerprint: fingerprint,
    guestEmail: email,
    quoteSnapshot: { cabinTypeId: cabinType._id, totalCents: 20000, currency: 'eur' }
  });

  const AssignmentEngine = require('../services/assignmentEngine');
  const originalAssign = AssignmentEngine.assignUnit;
  AssignmentEngine.assignUnit = async () => unitA;

  __setExecuteBookingFinalizeWorkDependenciesForTesting({
    openManualReviewItem: async () => null
  });

  try {
    const result = await executeBookingFinalizeWork({
      session,
      checkoutId,
      paymentIntentId: piId,
      finalizeContext: {
        cabinTypeId: cabinType._id,
        assignedUnitId: unitA._id,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        adults: 2,
        children: 0,
        guestInfo: {
          firstName: 'Rec',
          lastName: 'Create',
          email,
          phone: '+359800000066'
        },
        totalPrice: 200,
        subtotalPrice: 200,
        discountAmount: 0,
        subtotalCents: 20000,
        discountAmountCents: 0,
        giftVoucherAppliedCents: 0,
        stripePaidAmountCents: 20000,
        totalValueCents: 20000,
        paymentMethod: 'stripe',
        stripePaymentVerified: true,
        paymentIntentId: piId,
        initialStatus: 'confirmed',
        legalAcceptance: {
          termsVersion: '2024-01',
          activityRiskVersion: '2024-01',
          checkbox1TextSnapshot: 't',
          checkbox2TextSnapshot: 'r',
          locale: 'en'
        },
        transportOptions: []
      },
      source: 'multi_unit_paid_orphan_recovery',
      dependencies: {
        openManualReviewItem: async () => null
      }
    });

    assert.ok(result.bookingId);
    assert.ok(await Booking.findById(result.bookingId));
    assert.equal(await UnitNightClaim.countDocuments({ bookingId: result.bookingId }), 2);
  } finally {
    AssignmentEngine.assignUnit = originalAssign;
    __resetExecuteBookingFinalizeWorkDependenciesForTesting();
  }
});


test('recovery adopt: missing claims repaired; replay idempotent; create uses finalize once', async () => {
  const recoverySrc = fs.readFileSync(
    path.join(__dirname, '../services/checkout/multiUnitPaidOrphanRecoveryService.js'),
    'utf8'
  );
  assert.match(recoverySrc, /openManualReviewItem: async \(\) => null/);
  assert.match(recoverySrc, /ensureUnitNightClaimsShadow/);
  assert.match(recoverySrc, /I2_SOURCES\.MULTI_UNIT_RECOVERY/);
  const createMatches = recoverySrc.match(/executeBookingFinalizeWork\(/g) || [];
  assert.equal(createMatches.length, 1);

  const { booking } = await createAllocatedBooking({
    paymentIntentId: 'pi_adopt_i2',
    checkoutId: 'cs_adopt_i2',
    email: 'adopt-i2@example.com'
  });
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 0);

  // Same contract as recovery ADOPT branch.
  const first = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.MULTI_UNIT_RECOVERY,
    paymentIntentId: 'pi_adopt_i2',
    checkoutId: 'cs_adopt_i2',
    stripePaymentVerified: true
  });
  assert.equal(first.outcome, SHADOW_OUTCOMES.CLAIMED);
  assert.equal(first.source, I2_SOURCES.MULTI_UNIT_RECOVERY);
  const second = await ensureUnitNightClaimsShadow({
    booking,
    source: I2_SOURCES.MULTI_UNIT_RECOVERY,
    paymentIntentId: 'pi_adopt_i2',
    checkoutId: 'cs_adopt_i2',
    stripePaymentVerified: true
  });
  assert.equal(second.outcome, SHADOW_OUTCOMES.ALREADY_OWNED);
  assert.equal(await UnitNightClaim.countDocuments({ bookingId: booking._id }), 3);
});

test('default finalize deps expose dedicated shadow MRI/PRI channels', () => {
  const {
    createDefaultDependencies
  } = require('../services/checkout/executeBookingFinalizeWork');
  const deps = createDefaultDependencies();
  assert.equal(typeof deps.shadowClaimOpenManualReviewItem, 'function');
  assert.equal(typeof deps.shadowClaimRecordPaidBookingResolutionIssue, 'function');
  assert.notEqual(deps.shadowClaimOpenManualReviewItem, deps.openManualReviewItem);
});
