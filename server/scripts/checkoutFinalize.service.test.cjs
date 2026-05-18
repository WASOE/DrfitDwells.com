/**
 * C3-D1 checkout finalize service core (lock/replay, no booking create).
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
const {
  FINALIZE_STATUS,
  buildFinalizeReplayResponse,
  loadFinalizableCheckoutSession,
  acquireFinalizeLock,
  releaseFinalizeLock,
  markFinalizeNeedsReview,
  markFinalizeSucceeded,
  assertCheckoutSessionReadyForFinalize
} = require('../services/checkout/checkoutFinalizeService');

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

async function seedSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || `chk_finalize_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cabinId = overrides.cabinId || new mongoose.Types.ObjectId();
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: overrides.status ?? 'payment_required',
    paymentStatus: overrides.paymentStatus ?? 'unpaid',
    stayFingerprint: overrides.stayFingerprint ?? buildFingerprint(cabinId),
    finalizeStatus: overrides.finalizeStatus ?? FINALIZE_STATUS.OPEN,
    stripeAmountCents: overrides.stripeAmountCents ?? 10000,
    canonicalPaymentIntentId: overrides.canonicalPaymentIntentId ?? 'pi_finalize_canonical_1',
    sessionVersion: overrides.sessionVersion ?? 1,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides,
    checkoutId
  });
}

async function expectError(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof CheckoutSessionError);
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

test('service does not send email or import bookingLifecycleEmailService', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/checkoutFinalizeService.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /bookingLifecycleEmailService/);
  assert.doesNotMatch(source, /sendBookingLifecycleEmail/);
  assert.doesNotMatch(source, /require\(['"].*Booking['"]\)/);
});
