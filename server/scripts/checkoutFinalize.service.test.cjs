/**
 * C3-D1/D2/D3 checkout finalize service (lock/replay, fingerprint freeze, orchestration).
 *
 * Run: node --test server/scripts/checkoutFinalize.service.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const { CHECKOUT_SESSION_ERROR_CODES, CheckoutSessionError } = require('../services/checkout/checkoutSessionErrors');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { buildCommercialStayFingerprintFromBookingPayload } = require('../services/checkout/bookingCommercialStayFingerprint');
const {
  FINALIZE_STATUS,
  buildFinalizeReplayResponse,
  deriveCommercialStayFingerprintForFinalize,
  ensureCheckoutSessionStayFingerprint,
  loadFinalizableCheckoutSession,
  acquireFinalizeLock,
  releaseFinalizeLock,
  markFinalizeNeedsReview,
  markFinalizeSucceeded,
  assertCheckoutSessionReadyForFinalize,
  runCheckoutFinalizeOrchestration
} = require('../services/checkout/checkoutFinalizeService');
const { assertNoCommercialStayConflict } = require('../services/checkout/commercialStayGuardService');

let mongoServer;

const STAY_EMAIL = 'finalize-test@example.com';
const CHECK_IN = '2026-09-01';
const CHECK_OUT = '2026-09-05';

function buildFingerprint(cabinId) {
  return buildStayFingerprint({
    guestEmail: STAY_EMAIL,
    entityType: 'cabin',
    cabinId: String(cabinId),
    checkInDateOnly: CHECK_IN,
    checkOutDateOnly: CHECK_OUT
  });
}

function futureStayDates() {
  return {
    checkIn: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    checkOut: new Date(Date.now() + 24 * 24 * 60 * 60 * 1000)
  };
}

function buildBookingPayload({ cabinId, cabinTypeId, email = STAY_EMAIL, checkIn, checkOut } = {}) {
  const dates = futureStayDates();
  return {
    cabinId: cabinId || null,
    cabinTypeId: cabinTypeId || null,
    checkIn: checkIn || dates.checkIn,
    checkOut: checkOut || dates.checkOut,
    guestInfo: {
      firstName: 'Finalize',
      lastName: 'Guest',
      email,
      phone: '+359800000003'
    }
  };
}

async function seedSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || `chk_finalize_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  const base = {
    checkoutId,
    flowVersion: 'v2',
    status: overrides.status ?? 'payment_required',
    paymentStatus: overrides.paymentStatus ?? 'unpaid',
    finalizeStatus: overrides.finalizeStatus ?? FINALIZE_STATUS.OPEN,
    stripeAmountCents: overrides.stripeAmountCents ?? 10000,
    canonicalPaymentIntentId: overrides.canonicalPaymentIntentId ?? 'pi_finalize_canonical_1',
    sessionVersion: overrides.sessionVersion ?? 1,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000)
  };
  if (!('stayFingerprint' in overrides)) {
    base.stayFingerprint = buildFingerprint(cabinId);
  }
  return CheckoutSession.create({ ...base, ...overrides, checkoutId });
}

async function expectError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof CheckoutSessionError);
    assert.equal(err.code, code);
    return true;
  });
}

async function expectThrownCode(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.syncIndexes(), CheckoutSession.syncIndexes()]);
});

test.beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), CheckoutSession.deleteMany({})]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('loadFinalizableCheckoutSession returns V2 open session', async () => {
  const doc = await seedSession({ checkoutId: 'chk_load_open' });
  const session = await loadFinalizableCheckoutSession({ checkoutId: doc.checkoutId });
  assert.equal(session.flowVersion, 'v2');
  assert.equal(session.finalizeStatus, FINALIZE_STATUS.OPEN);
  assert.ok(!session.toObject || session.checkoutId);
});

test('missing session throws CHECKOUT_SESSION_NOT_FOUND', async () => {
  await expectError(
    loadFinalizableCheckoutSession({ checkoutId: 'chk_missing_finalize' }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_FOUND
  );
});

test('acquireFinalizeLock changes open -> in_progress and increments sessionVersion', async () => {
  const doc = await seedSession({ checkoutId: 'chk_acquire_1', sessionVersion: 2 });
  const locked = await acquireFinalizeLock({
    checkoutId: doc.checkoutId,
    expectedSessionVersion: 2,
    now: new Date('2026-05-01T12:00:00.000Z')
  });
  assert.equal(locked.finalizeStatus, FINALIZE_STATUS.IN_PROGRESS);
  assert.equal(locked.sessionVersion, 3);
});

test('acquireFinalizeLock sets finalizeStartedAt', async () => {
  const now = new Date('2026-05-02T10:00:00.000Z');
  const doc = await seedSession({ checkoutId: 'chk_acquire_started_at' });
  const locked = await acquireFinalizeLock({
    checkoutId: doc.checkoutId,
    expectedSessionVersion: 1,
    now
  });
  assert.equal(locked.finalizeStartedAt.toISOString(), now.toISOString());
});

test('acquireFinalizeLock with wrong expectedSessionVersion rejects safely', async () => {
  const doc = await seedSession({ checkoutId: 'chk_acquire_version', sessionVersion: 4 });
  await expectError(
    acquireFinalizeLock({
      checkoutId: doc.checkoutId,
      expectedSessionVersion: 99
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_CONCURRENCY_CONFLICT
  );
});

test('acquireFinalizeLock on already in_progress throws FINALIZE_IN_PROGRESS', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_acquire_in_progress',
    finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
    finalizeStartedAt: new Date()
  });
  await expectError(
    acquireFinalizeLock({ checkoutId: doc.checkoutId }),
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS
  );
});

test('acquireFinalizeLock on finalized with bookingId returns/throws replay classification tested through buildFinalizeReplayResponse', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_acquire_finalized_replay',
    finalizeStatus: FINALIZE_STATUS.FINALIZED,
    bookingId,
    finalizedAt: new Date()
  });

  const replay = buildFinalizeReplayResponse(doc);
  assert.deepEqual(replay, {
    ok: true,
    idempotentReplay: true,
    bookingId: String(bookingId),
    checkoutId: doc.checkoutId
  });

  await assert.rejects(acquireFinalizeLock({ checkoutId: doc.checkoutId }), (err) => {
    assert.equal(err.code, CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE);
    assert.equal(err.details?.idempotentReplay, true);
    assert.deepEqual(err.details?.replay, replay);
    return true;
  });
});

test('releaseFinalizeLock changes in_progress -> open and clears finalizeStartedAt', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_release_1',
    finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
    finalizeStartedAt: new Date(),
    sessionVersion: 5
  });
  const released = await releaseFinalizeLock({ checkoutId: doc.checkoutId, note: 'test release' });
  assert.equal(released.finalizeStatus, FINALIZE_STATUS.OPEN);
  assert.equal(released.finalizeStartedAt, null);
  assert.equal(released.sessionVersion, 6);
});

test('releaseFinalizeLock does not modify finalized session', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_release_finalized',
    finalizeStatus: FINALIZE_STATUS.FINALIZED,
    bookingId,
    finalizedAt: new Date(),
    sessionVersion: 8
  });
  const result = await releaseFinalizeLock({ checkoutId: doc.checkoutId });
  assert.equal(result.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(result.sessionVersion, 8);
  assert.equal(String(result.bookingId), String(bookingId));
});

test('markFinalizeSucceeded changes in_progress -> finalized, sets bookingId/finalizedAt, increments version', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_mark_success',
    finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
    finalizeStartedAt: new Date(),
    sessionVersion: 3
  });
  const bookingId = new mongoose.Types.ObjectId();
  const at = new Date('2026-05-03T08:00:00.000Z');
  const updated = await markFinalizeSucceeded({
    checkoutId: doc.checkoutId,
    bookingId,
    now: at
  });
  assert.equal(updated.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(String(updated.bookingId), String(bookingId));
  assert.equal(updated.finalizedAt.toISOString(), at.toISOString());
  assert.equal(updated.sessionVersion, 4);
});

test('markFinalizeNeedsReview sets needs_review and increments version', async () => {
  const doc = await seedSession({ checkoutId: 'chk_needs_review', sessionVersion: 2 });
  const updated = await markFinalizeNeedsReview({
    checkoutId: doc.checkoutId,
    reason: 'pi_mismatch',
    details: { code: 'test_only' }
  });
  assert.equal(updated.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
  assert.equal(updated.status, 'needs_review');
  assert.equal(updated.sessionVersion, 3);
  assert.equal(updated.metadata?.finalizeNeedsReview?.reason, 'pi_mismatch');
});

test('buildFinalizeReplayResponse returns replay DTO for finalized + bookingId', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_replay_dto',
    finalizeStatus: FINALIZE_STATUS.FINALIZED,
    bookingId
  });
  assert.deepEqual(buildFinalizeReplayResponse(doc), {
    ok: true,
    idempotentReplay: true,
    bookingId: String(bookingId),
    checkoutId: doc.checkoutId
  });
  assert.equal(buildFinalizeReplayResponse({ finalizeStatus: 'open' }), null);
});

test('assertCheckoutSessionReadyForFinalize calls canonical PI guard and passes with matching PI', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_ready_pi_ok',
    canonicalPaymentIntentId: 'pi_ready_match'
  });
  const result = await assertCheckoutSessionReadyForFinalize({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_ready_match',
    bookingPayload: null
  });
  assert.equal(result.ok, true);
  assert.equal(result.session.checkoutId, doc.checkoutId);
});

test('assertCheckoutSessionReadyForFinalize rejects superseded/wrong PI', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_ready_pi_bad',
    canonicalPaymentIntentId: 'pi_ready_canonical',
    supersededPaymentIntentIds: ['pi_old_superseded']
  });
  await expectError(
    assertCheckoutSessionReadyForFinalize({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_old_superseded'
    }),
    CHECKOUT_SESSION_ERROR_CODES.SUPERSEDED_PAYMENT_INTENT
  );
  await expectError(
    assertCheckoutSessionReadyForFinalize({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_wrong_other'
    }),
    CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH
  );
});

test('derives and persists stayFingerprint when missing using bookingPayload', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const expected = buildCommercialStayFingerprintFromBookingPayload(payload);
  const doc = await seedSession({
    checkoutId: 'chk_ensure_persist_fp',
    stayFingerprint: null,
    guestEmail: null
  });

  const updated = await ensureCheckoutSessionStayFingerprint({
    checkoutId: doc.checkoutId,
    bookingPayload: payload
  });

  assert.equal(updated.stayFingerprint, expected);
  assert.equal(updated.sessionVersion, 2);
  const reloaded = await CheckoutSession.findOne({ checkoutId: doc.checkoutId });
  assert.equal(reloaded.stayFingerprint, expected);
});

test('stores normalized guestEmail when missing', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId, email: '  MixedCase@Example.COM  ' });
  const doc = await seedSession({
    checkoutId: 'chk_ensure_guest_email',
    stayFingerprint: null,
    guestEmail: null
  });

  const updated = await ensureCheckoutSessionStayFingerprint({
    checkoutId: doc.checkoutId,
    bookingPayload: payload
  });

  assert.equal(updated.guestEmail, 'mixedcase@example.com');
});

test('cabinType fingerprint uses cabinTypeId, not unitId', async () => {
  const cabinTypeId = new mongoose.Types.ObjectId();
  const unitA = new mongoose.Types.ObjectId();
  const unitB = new mongoose.Types.ObjectId();
  const payloadA = buildBookingPayload({ cabinTypeId, cabinId: null });
  payloadA.unitId = unitA;
  const payloadB = buildBookingPayload({ cabinTypeId, cabinId: null });
  payloadB.unitId = unitB;

  const fpA = deriveCommercialStayFingerprintForFinalize({ session: {}, bookingPayload: payloadA });
  const fpB = deriveCommercialStayFingerprintForFinalize({ session: {}, bookingPayload: payloadB });
  assert.equal(fpA, fpB);
  assert.ok(fpA);
});

test('missing guest email throws COMMERCIAL_STAY_FINGERPRINT_REQUIRED', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId, email: '' });
  const doc = await seedSession({ checkoutId: 'chk_missing_email', stayFingerprint: null });

  await expectError(
    ensureCheckoutSessionStayFingerprint({ checkoutId: doc.checkoutId, bookingPayload: payload }),
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED
  );
});

test('missing entity/date data throws COMMERCIAL_STAY_FINGERPRINT_REQUIRED', async () => {
  const doc = await seedSession({ checkoutId: 'chk_missing_entity', stayFingerprint: null });

  await expectError(
    ensureCheckoutSessionStayFingerprint({
      checkoutId: doc.checkoutId,
      bookingPayload: { guestInfo: { email: STAY_EMAIL } }
    }),
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_REQUIRED
  );
});

test('existing stayFingerprint is reused and not overwritten', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const existing = buildFingerprint(cabinId);
  const otherCabinId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_reuse_fp',
    stayFingerprint: existing,
    sessionVersion: 3
  });

  const result = await ensureCheckoutSessionStayFingerprint({
    checkoutId: doc.checkoutId
  });

  assert.equal(result.stayFingerprint, existing);
  assert.equal(result.sessionVersion, 3);
});

test('existing different stayFingerprint is not overwritten', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const otherCabinId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_mismatch_fp',
    stayFingerprint: buildFingerprint(cabinId)
  });

  await expectError(
    ensureCheckoutSessionStayFingerprint({
      checkoutId: doc.checkoutId,
      bookingPayload: buildBookingPayload({ cabinId: otherCabinId })
    }),
    CHECKOUT_SESSION_ERROR_CODES.COMMERCIAL_STAY_FINGERPRINT_MISMATCH
  );
});

test('concurrent calls where one sets fingerprint and second reloads returns same fingerprint', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const expected = buildCommercialStayFingerprintFromBookingPayload(payload);
  const doc = await seedSession({
    checkoutId: 'chk_concurrent_fp',
    stayFingerprint: null
  });

  const [a, b] = await Promise.all([
    ensureCheckoutSessionStayFingerprint({ checkoutId: doc.checkoutId, bookingPayload: payload }),
    ensureCheckoutSessionStayFingerprint({ checkoutId: doc.checkoutId, bookingPayload: payload })
  ]);

  assert.equal(a.stayFingerprint, expected);
  assert.equal(b.stayFingerprint, expected);
});

test('assertCheckoutSessionReadyForFinalize calls commercial guard even when session initially had null stayFingerprint', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_ready_guard_persist',
    stayFingerprint: null,
    guestEmail: null,
    canonicalPaymentIntentId: 'pi_ready_guard_persist'
  });

  const result = await assertCheckoutSessionReadyForFinalize({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_ready_guard_persist',
    bookingPayload: payload
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.session.stayFingerprint,
    buildCommercialStayFingerprintFromBookingPayload(payload)
  );
});

test('assertCheckoutSessionReadyForFinalize rejects duplicate stay conflict after deriving fingerprint', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const fingerprint = buildCommercialStayFingerprintFromBookingPayload(payload);
  const { checkIn, checkOut } = futureStayDates();

  await Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'confirmed',
    commercialStayFingerprint: fingerprint,
    guestInfo: {
      firstName: 'Other',
      lastName: 'Guest',
      email: STAY_EMAIL,
      phone: '+359800000004'
    }
  });

  const doc = await seedSession({
    checkoutId: 'chk_ready_dup_derived',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_ready_dup_derived'
  });

  await expectError(
    assertCheckoutSessionReadyForFinalize({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_ready_dup_derived',
      bookingPayload: payload
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('assertCheckoutSessionReadyForFinalize calls commercial stay guard and rejects duplicate stay conflict', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const fingerprint = buildFingerprint(cabinId);
  const checkIn = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 24 * 24 * 60 * 60 * 1000);

  await Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'confirmed',
    commercialStayFingerprint: fingerprint,
    guestInfo: {
      firstName: 'Other',
      lastName: 'Guest',
      email: STAY_EMAIL,
      phone: '+359800000002'
    }
  });

  const doc = await seedSession({
    checkoutId: 'chk_ready_dup_stay',
    stayFingerprint: fingerprint,
    canonicalPaymentIntentId: 'pi_dup_stay'
  });

  await expectError(
    assertCheckoutSessionReadyForFinalize({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_dup_stay'
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
});

test('service does not create Booking rows', async () => {
  const before = await Booking.countDocuments({});
  const doc = await seedSession({ checkoutId: 'chk_no_booking_create' });
  const now = new Date();
  await acquireFinalizeLock({
    checkoutId: doc.checkoutId,
    expectedSessionVersion: 1,
    now
  });
  const released = await releaseFinalizeLock({ checkoutId: doc.checkoutId });
  await acquireFinalizeLock({
    checkoutId: doc.checkoutId,
    expectedSessionVersion: released.sessionVersion,
    now
  });
  const bookingId = new mongoose.Types.ObjectId();
  await markFinalizeSucceeded({ checkoutId: doc.checkoutId, bookingId, now });
  const after = await Booking.countDocuments({});
  assert.equal(after, before);
});

function buildSuccessfulFinalizeWork(bookingId = new mongoose.Types.ObjectId()) {
  return async (ctx) => ({
    bookingId,
    booking: { _id: bookingId, checkoutId: ctx.checkoutId },
    result: { ok: true }
  });
}

test('runCheckoutFinalizeOrchestration successful path', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const bookingId = new mongoose.Types.ObjectId();
  let workCalls = 0;

  const doc = await seedSession({
    checkoutId: 'chk_orch_success',
    stayFingerprint: null,
    guestEmail: null,
    canonicalPaymentIntentId: 'pi_orch_success'
  });

  const result = await runCheckoutFinalizeOrchestration({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_orch_success',
    bookingPayload: payload,
    finalizeWork: async (ctx) => {
      workCalls += 1;
      return {
        bookingId,
        booking: { _id: bookingId, checkoutId: ctx.checkoutId },
        result: { ok: true }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.idempotentReplay, false);
  assert.equal(String(result.bookingId), String(bookingId));
  assert.equal(workCalls, 1);
  assert.equal(result.session.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(String(result.session.bookingId), String(bookingId));
});

test('runCheckoutFinalizeOrchestration propagates worker idempotentReplay and still marks session finalized', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const bookingId = new mongoose.Types.ObjectId();
  const stayFingerprint = buildCommercialStayFingerprintFromBookingPayload(payload);

  const doc = await seedSession({
    checkoutId: 'chk_orch_worker_replay',
    stayFingerprint,
    canonicalPaymentIntentId: 'pi_orch_worker_replay'
  });

  let workCalls = 0;
  const result = await runCheckoutFinalizeOrchestration({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_orch_worker_replay',
    bookingPayload: payload,
    finalizeWork: async () => {
      workCalls += 1;
      return {
        bookingId,
        booking: { _id: bookingId, checkoutId: doc.checkoutId },
        result: { idempotentReplay: true }
      };
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.idempotentReplay, true);
  assert.equal(String(result.bookingId), String(bookingId));
  assert.equal(workCalls, 1);
  assert.equal(result.session.finalizeStatus, FINALIZE_STATUS.FINALIZED);
  assert.equal(String(result.session.bookingId), String(bookingId));
  assert.ok(result.session.finalizedAt);
});

test('runCheckoutFinalizeOrchestration returns replay when session already finalized with bookingId', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const doc = await seedSession({
    checkoutId: 'chk_orch_replay',
    finalizeStatus: FINALIZE_STATUS.FINALIZED,
    bookingId,
    finalizedAt: new Date()
  });

  let workCalls = 0;
  const result = await runCheckoutFinalizeOrchestration({
    checkoutId: doc.checkoutId,
    bookingPayload: buildBookingPayload({ cabinId: new mongoose.Types.ObjectId() }),
    finalizeWork: async () => {
      workCalls += 1;
      return { bookingId: new mongoose.Types.ObjectId() };
    }
  });

  assert.equal(result.idempotentReplay, true);
  assert.equal(String(result.bookingId), String(bookingId));
  assert.equal(workCalls, 0);
});

test('runCheckoutFinalizeOrchestration throws FINALIZE_IN_PROGRESS when session already in_progress', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_orch_in_progress',
    finalizeStatus: FINALIZE_STATUS.IN_PROGRESS,
    finalizeStartedAt: new Date()
  });

  let workCalls = 0;
  await expectError(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      bookingPayload: buildBookingPayload({ cabinId: new mongoose.Types.ObjectId() }),
      finalizeWork: async () => {
        workCalls += 1;
        return { bookingId: new mongoose.Types.ObjectId() };
      }
    }),
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS
  );
  assert.equal(workCalls, 0);
});

test('runCheckoutFinalizeOrchestration does not call finalizeWork when canonical PI mismatches', async () => {
  const doc = await seedSession({
    checkoutId: 'chk_orch_pi_mismatch',
    canonicalPaymentIntentId: 'pi_canonical_orch',
    stayFingerprint: null
  });

  let workCalls = 0;
  await expectError(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_wrong_orch',
      bookingPayload: buildBookingPayload({ cabinId: new mongoose.Types.ObjectId() }),
      finalizeWork: async () => {
        workCalls += 1;
        return { bookingId: new mongoose.Types.ObjectId() };
      }
    }),
    CHECKOUT_SESSION_ERROR_CODES.CANONICAL_PAYMENT_INTENT_MISMATCH
  );
  assert.equal(workCalls, 0);
});

test('runCheckoutFinalizeOrchestration does not call finalizeWork when duplicate commercial stay conflict exists before lock', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const fingerprint = buildCommercialStayFingerprintFromBookingPayload(
    buildBookingPayload({ cabinId })
  );
  const { checkIn, checkOut } = futureStayDates();

  await Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'confirmed',
    commercialStayFingerprint: fingerprint,
    guestInfo: {
      firstName: 'Block',
      lastName: 'Guest',
      email: STAY_EMAIL,
      phone: '+359800000010'
    }
  });

  const doc = await seedSession({
    checkoutId: 'chk_orch_prelock_dup',
    stayFingerprint: fingerprint,
    canonicalPaymentIntentId: 'pi_prelock_dup'
  });

  let workCalls = 0;
  await expectError(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_prelock_dup',
      bookingPayload: buildBookingPayload({ cabinId }),
      finalizeWork: async () => {
        workCalls += 1;
        return { bookingId: new mongoose.Types.ObjectId() };
      }
    }),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );
  assert.equal(workCalls, 0);
});

test('releases lock if duplicate commercial stay conflict appears after lock', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_postlock_dup',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_postlock_dup'
  });

  const ready = await assertCheckoutSessionReadyForFinalize({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_postlock_dup',
    bookingPayload: payload
  });
  const locked = await acquireFinalizeLock({
    checkoutId: doc.checkoutId,
    expectedSessionVersion: ready.session.sessionVersion
  });

  const { checkIn, checkOut } = futureStayDates();
  await Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    status: 'confirmed',
    commercialStayFingerprint: locked.stayFingerprint,
    guestInfo: {
      firstName: 'Late',
      lastName: 'Block',
      email: STAY_EMAIL,
      phone: '+359800000011'
    }
  });

  await expectError(
    (async () => {
      await assertNoCommercialStayConflict({
        commercialStayFingerprint: String(locked.stayFingerprint).trim(),
        checkoutId: doc.checkoutId
      });
    })(),
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT
  );

  const released = await releaseFinalizeLock({
    checkoutId: doc.checkoutId,
    note: 'commercial_stay_conflict_after_lock'
  });
  assert.equal(released.finalizeStatus, FINALIZE_STATUS.OPEN);
  assert.equal(released.finalizeStartedAt, null);
});

test('runCheckoutFinalizeOrchestration releases lock if finalizeWork throws normal error', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_work_fail',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_work_fail'
  });

  await expectThrownCode(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_work_fail',
      bookingPayload: payload,
      finalizeWork: async () => {
        const err = new Error('worker failed');
        err.code = 'WORKER_FAILED';
        throw err;
      }
    }),
    'WORKER_FAILED'
  );

  const session = await CheckoutSession.findOne({ checkoutId: doc.checkoutId });
  assert.equal(session.finalizeStatus, FINALIZE_STATUS.OPEN);
});

test('runCheckoutFinalizeOrchestration marks needs_review if finalizeWork throws needsReview error', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_needs_review_err',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_needs_review_err'
  });

  await expectThrownCode(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_needs_review_err',
      bookingPayload: payload,
      finalizeWork: async () => {
        const err = new Error('paid save failed');
        err.code = 'PAID_BOOKING_SAVE_FAILED';
        err.needsReview = true;
        throw err;
      }
    }),
    'PAID_BOOKING_SAVE_FAILED'
  );

  const session = await CheckoutSession.findOne({ checkoutId: doc.checkoutId });
  assert.equal(session.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
  assert.equal(session.status, 'needs_review');
});

test('runCheckoutFinalizeOrchestration marks needs_review if finalizeWork returns no bookingId', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_no_booking_id',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_no_booking_id'
  });

  await expectError(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_no_booking_id',
      bookingPayload: payload,
      finalizeWork: async () => ({ booking: null, result: null })
    }),
    CHECKOUT_SESSION_ERROR_CODES.CHECKOUT_SESSION_NOT_USABLE
  );

  const session = await CheckoutSession.findOne({ checkoutId: doc.checkoutId });
  assert.equal(session.finalizeStatus, FINALIZE_STATUS.NEEDS_REVIEW);
  assert.equal(session.status, 'needs_review');
  assert.equal(session.metadata?.finalizeNeedsReview?.reason, 'finalize_work_missing_booking_id');
  assert.ok(session.finalizeStartedAt instanceof Date);
  assert.equal(session.metadata?.finalizeReleaseNote, undefined);
});

test('runCheckoutFinalizeOrchestration concurrent same checkout only runs finalizeWork once', async () => {
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_concurrent',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_orch_concurrent'
  });

  let workCalls = 0;
  let releaseGate;
  const releasePromise = new Promise((resolve) => {
    releaseGate = resolve;
  });

  const slowWork = async () => {
    workCalls += 1;
    await releasePromise;
    return { bookingId: new mongoose.Types.ObjectId() };
  };

  const first = runCheckoutFinalizeOrchestration({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_orch_concurrent',
    bookingPayload: payload,
    finalizeWork: slowWork
  });

  await new Promise((r) => setTimeout(r, 25));

  await expectError(
    runCheckoutFinalizeOrchestration({
      checkoutId: doc.checkoutId,
      paymentIntentId: 'pi_orch_concurrent',
      bookingPayload: payload,
      finalizeWork: buildSuccessfulFinalizeWork()
    }),
    CHECKOUT_SESSION_ERROR_CODES.FINALIZE_IN_PROGRESS
  );

  releaseGate();
  const firstResult = await first;
  assert.equal(workCalls, 1);
  assert.equal(firstResult.ok, true);
});

test('runCheckoutFinalizeOrchestration does not create Booking rows', async () => {
  const before = await Booking.countDocuments({});
  const cabinId = new mongoose.Types.ObjectId();
  const payload = buildBookingPayload({ cabinId });
  const doc = await seedSession({
    checkoutId: 'chk_orch_no_booking_rows',
    stayFingerprint: null,
    canonicalPaymentIntentId: 'pi_orch_no_booking_rows'
  });

  await runCheckoutFinalizeOrchestration({
    checkoutId: doc.checkoutId,
    paymentIntentId: 'pi_orch_no_booking_rows',
    bookingPayload: payload,
    finalizeWork: buildSuccessfulFinalizeWork()
  });

  const after = await Booking.countDocuments({});
  assert.equal(after, before);
});

test('orchestration does not import bookingLifecycleEmailService or emailService', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/checkoutFinalizeService.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /bookingLifecycleEmailService/);
  assert.doesNotMatch(source, /emailService/);
  assert.doesNotMatch(source, /sendBookingLifecycleEmail/);
  assert.doesNotMatch(source, /require\(['"].*Booking['"]\)/);
});

test('service does not send email or import bookingLifecycleEmailService', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/checkoutFinalizeService.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /bookingLifecycleEmailService/);
  assert.doesNotMatch(source, /sendBookingLifecycleEmail/);
  assert.doesNotMatch(source, /require\(['"].*Booking['"]\)/);
});
