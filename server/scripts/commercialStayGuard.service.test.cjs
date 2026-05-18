/**
 * C3-C commercial stay guard service.
 *
 * Run: node --test server/scripts/commercialStayGuard.service.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const { CHECKOUT_SESSION_ERROR_CODES, CheckoutSessionError } = require('../services/checkout/checkoutSessionErrors');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { buildCommercialStayFingerprintFromBooking } = require('../services/checkout/bookingCommercialStayFingerprint');
const {
  assertNoCommercialStayConflict,
  findCommercialStayConflicts,
  buildCommercialStayConflictQuery
} = require('../services/checkout/commercialStayGuardService');

let mongoServer;

const STAY_EMAIL = 'guard-test@example.com';
const CHECK_IN = '2026-08-10';
const CHECK_OUT = '2026-08-14';

function futureCheckInOut() {
  const checkIn = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

function buildFingerprintForCabin(cabinId) {
  return buildStayFingerprint({
    guestEmail: STAY_EMAIL,
    entityType: 'cabin',
    cabinId: String(cabinId),
    checkInDateOnly: CHECK_IN,
    checkOutDateOnly: CHECK_OUT
  });
}

function buildMinimalBooking(overrides = {}) {
  const { checkIn, checkOut } = futureCheckInOut();
  return {
    cabinId: overrides.cabinId || new mongoose.Types.ObjectId(),
    checkIn: overrides.checkIn || checkIn,
    checkOut: overrides.checkOut || checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    guestInfo: {
      firstName: 'Guard',
      lastName: 'Test',
      email: STAY_EMAIL,
      phone: '+359800000001'
    },
    ...overrides
  };
}

async function seedBooking(overrides = {}) {
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  const fingerprint =
    overrides.commercialStayFingerprint || buildFingerprintForCabin(cabinId);
  const doc = buildMinimalBooking({ cabinId, commercialStayFingerprint: fingerprint, ...overrides });
  return Booking.create(doc);
}

async function seedSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || `chk_guard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    stayFingerprint: overrides.stayFingerprint ?? buildFingerprintForCabin(new mongoose.Types.ObjectId()),
    finalizeStatus: 'open',
    stripeAmountCents: 5000,
    ...overrides,
    checkoutId
  });
}

async function expectGuardError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof CheckoutSessionError);
    assert.equal(err.code, code);
    return true;
  });
}

function assertDtoHasNoGuestPii(dto) {
  const json = JSON.stringify(dto);
  assert.doesNotMatch(json, /guestInfo/i);
  assert.doesNotMatch(json, /firstName/i);
  assert.doesNotMatch(json, /lastName/i);
  assert.doesNotMatch(json, /phone/i);
  assert.doesNotMatch(json, /@/);
}

let sharedCabinId;
let sharedFingerprint;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.syncIndexes(), CheckoutSession.syncIndexes()]);
  sharedCabinId = new mongoose.Types.ObjectId();
  sharedFingerprint = buildFingerprintForCabin(sharedCabinId);
});

test.beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), CheckoutSession.deleteMany({})]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('missing fingerprint throws COMMERCIAL_STAY_FINGERPRINT_REQUIRED', async () => {
  await expectGuardError(
    assertNoCommercialStayConflict({ commercialStayFingerprint: '' }),
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED
  );
  assert.throws(
    () => buildCommercialStayConflictQuery({ commercialStayFingerprint: '  ' }),
    (err) => err.code === CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED
  );
});

test('no conflict passes', async () => {
  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_no_conflict_01'
  });
  assert.deepEqual(result, { ok: true });

  const conflicts = await findCommercialStayConflicts({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_no_conflict_01'
  });
  assert.equal(conflicts.hasConflict, false);
  assert.deepEqual(conflicts.bookingConflicts, []);
  assert.deepEqual(conflicts.sessionConflicts, []);
});

test('existing confirmed Booking with same commercialStayFingerprint blocks with DUPLICATE_STAY_CONFLICT', async () => {
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'confirmed',
    checkoutId: 'chk_existing_confirmed'
  });

  await expectGuardError(
    assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_new_attempt'
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('existing pending Booking blocks', async () => {
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'pending'
  });

  await expectGuardError(
    assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_pending_block'
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('existing in_house Booking blocks', async () => {
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'in_house'
  });

  await expectGuardError(
    assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_in_house_block'
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('existing cancelled Booking does not block', async () => {
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'cancelled'
  });

  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_after_cancelled'
  });
  assert.deepEqual(result, { ok: true });
});

test('existing completed Booking does not block', async () => {
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'completed'
  });

  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_after_completed'
  });
  assert.deepEqual(result, { ok: true });
});

test('same checkoutId is excluded', async () => {
  const checkoutId = 'chk_same_checkout_exclude';
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'confirmed',
    checkoutId
  });

  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId
  });
  assert.deepEqual(result, { ok: true });
});

test('same bookingId is excluded', async () => {
  const booking = await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'confirmed',
    checkoutId: 'chk_booking_exclude'
  });

  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_other_checkout',
    bookingId: booking._id
  });
  assert.deepEqual(result, { ok: true });
});

test('different commercialStayFingerprint does not block', async () => {
  const otherCabinId = new mongoose.Types.ObjectId();
  await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'confirmed'
  });

  const otherFingerprint = buildFingerprintForCabin(otherCabinId);
  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: otherFingerprint,
    checkoutId: 'chk_other_fp'
  });
  assert.deepEqual(result, { ok: true });
});

test('existing CheckoutSession with same stayFingerprint and finalizeStatus in_progress blocks with FINALIZE_IN_PROGRESS', async () => {
  await seedSession({
    checkoutId: 'chk_session_in_progress',
    stayFingerprint: sharedFingerprint,
    finalizeStatus: 'in_progress'
  });

  await expectGuardError(
    assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_new_while_in_progress'
    }),
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS
  );
});

test('existing CheckoutSession with same stayFingerprint and finalizeStatus finalized blocks with DUPLICATE_STAY_CONFLICT', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  await seedSession({
    checkoutId: 'chk_session_finalized',
    stayFingerprint: sharedFingerprint,
    finalizeStatus: 'finalized',
    bookingId
  });

  await expectGuardError(
    assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_new_after_finalized'
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('existing CheckoutSession with same checkoutId is excluded', async () => {
  const checkoutId = 'chk_session_same_exclude';
  await seedSession({
    checkoutId,
    stayFingerprint: sharedFingerprint,
    finalizeStatus: 'in_progress'
  });

  const result = await assertNoCommercialStayConflict({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId
  });
  assert.deepEqual(result, { ok: true });
});

test('cabinType fingerprint from helper uses cabinTypeId, not unitId', () => {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const unitId = new mongoose.Types.ObjectId();
  const { checkIn, checkOut } = futureCheckInOut();

  const withUnit = {
    cabinTypeId,
    unitId,
    checkIn,
    checkOut,
    guestInfo: { email: 'cabintype@example.com' }
  };
  const withoutUnit = {
    cabinTypeId,
    unitId: new mongoose.Types.ObjectId(),
    checkIn,
    checkOut,
    guestInfo: { email: 'cabintype@example.com' }
  };

  const fpA = buildCommercialStayFingerprintFromBooking(withUnit);
  const fpB = buildCommercialStayFingerprintFromBooking(withoutUnit);
  assert.equal(fpA, fpB);
  assert.ok(fpA);
});

test('conflict DTO does not expose guest PII beyond checkoutId/status/bookingId/dates if included; keep DTO minimal', async () => {
  const booking = await seedBooking({
    cabinId: sharedCabinId,
    commercialStayFingerprint: sharedFingerprint,
    status: 'confirmed',
    checkoutId: 'chk_dto_pii'
  });
  await seedSession({
    checkoutId: 'chk_dto_session',
    stayFingerprint: sharedFingerprint,
    finalizeStatus: 'finalized',
    bookingId: booking._id,
    guestEmail: STAY_EMAIL
  });

  const conflicts = await findCommercialStayConflicts({
    commercialStayFingerprint: sharedFingerprint,
    checkoutId: 'chk_dto_new'
  });

  assert.equal(conflicts.hasConflict, true);
  assertDtoHasNoGuestPii(conflicts);

  try {
    await assertNoCommercialStayConflict({
      commercialStayFingerprint: sharedFingerprint,
      checkoutId: 'chk_dto_new'
    });
    assert.fail('expected conflict');
  } catch (err) {
    assert.ok(err instanceof CheckoutSessionError);
    assertDtoHasNoGuestPii(err.details);
    assert.ok(err.details.bookingConflictCount >= 1);
    assert.ok(err.details.sessionConflictCount >= 1);
    for (const row of err.details.bookingConflicts) {
      assert.ok(row.bookingId);
      assert.ok(['pending', 'confirmed', 'in_house'].includes(row.status));
      assert.equal(row.commercialStayFingerprint, sharedFingerprint);
    }
    for (const row of err.details.sessionConflicts) {
      assert.ok(row.checkoutId);
      assert.ok(['in_progress', 'finalized'].includes(row.finalizeStatus));
    }
  }
});
