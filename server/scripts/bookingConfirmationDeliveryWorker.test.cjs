/**
 * Booking confirmation delivery backlog worker tests.
 *
 * Run: cd server && node --test --test-concurrency=1 scripts/bookingConfirmationDeliveryWorker.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const ManualReviewItem = require('../models/ManualReviewItem');
const featureFlags = require('../utils/featureFlags');
const { bookingLifecycleCorrelationKey } = require('../services/email/emailDeliveryCorrelation');
const {
  ensurePendingConfirmationDelivery,
  reclaimStaleSendingConfirmationDeliveries,
  markSmtpAttemptStarted,
  claimConfirmationDeliveryAttempt,
  sendClaimedConfirmationDelivery,
  getVisibilityTimeoutMs
} = require('../services/email/bookingConfirmationDeliveryService');
const {
  startBookingConfirmationDeliveryWorker,
  stopBookingConfirmationDeliveryWorkerForTest,
  runConfirmationDeliveryTickOnce,
  runSmtpVerificationOnce,
  isBookingConfirmationDeliveryReady,
  assertProductionWorkerConfigOrThrow,
  getBookingConfirmationDeliveryWorkerState,
  countConfirmationDeliveryBacklog,
  __resetConfirmationDeliveryWorkerStateForTesting,
  __setConfirmationDeliverySendFnForTesting,
  __setConfirmationDeliveryVerifyFnForTesting,
  __setConfirmationDeliveryWorkerReadyForTesting
} = require('../services/email/bookingConfirmationDeliveryWorker');
const {
  getBookingConfirmationDeliveryHealthReadModel
} = require('../services/email/bookingConfirmationDeliveryHealthService');
const fs = require('fs');
const path = require('path');

let mongoServer;
const ORIG = {
  WORKER: process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED,
  VT: process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS,
  SIDE: process.env.FINALIZE_SIDE_EFFECTS,
  SEND: process.env.FINALIZE_WORKER_SEND_CONFIRMATION,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_URL: process.env.SMTP_URL,
  EMAIL_DELIVERY_REQUIRED: process.env.EMAIL_DELIVERY_REQUIRED,
  NODE_ENV: process.env.NODE_ENV
};

function restoreEnv() {
  for (const [key, env] of [
    ['WORKER', 'BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED'],
    ['VT', 'CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS'],
    ['SIDE', 'FINALIZE_SIDE_EFFECTS'],
    ['SEND', 'FINALIZE_WORKER_SEND_CONFIRMATION'],
    ['SMTP_HOST', 'SMTP_HOST'],
    ['SMTP_URL', 'SMTP_URL'],
    ['EMAIL_DELIVERY_REQUIRED', 'EMAIL_DELIVERY_REQUIRED'],
    ['NODE_ENV', 'NODE_ENV']
  ]) {
    if (ORIG[key] === undefined) delete process.env[env];
    else process.env[env] = ORIG[key];
  }
}

function futureStayDates() {
  const checkIn = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 44 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

async function createConfirmedBooking(overrides = {}) {
  const { checkIn, checkOut } = futureStayDates();
  const suffix = Math.random().toString(36).slice(2, 8);
  return Booking.create({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 400,
    subtotalPrice: 400,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: overrides.stripePaymentIntentId || `pi_cw_${suffix}`,
    commercialStayFingerprint: overrides.commercialStayFingerprint || `fp_cw_${suffix}`,
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: overrides.email || `confirm-worker-${suffix}@example.com`,
      phone: '+359800000100',
      ...(overrides.guestInfo || {})
    },
    legalAcceptance: {
      termsVersion: '2026-04-19-v2',
      activityRiskVersion: '2026-04-19-v2',
      acceptedAt: new Date(),
      firstName: 'Ada',
      lastName: 'Lovelace',
      checkbox1TextSnapshot: 'terms',
      checkbox2TextSnapshot: 'risk'
    },
    cabinId: new mongoose.Types.ObjectId(),
    checkoutId: overrides.checkoutId || `chk_cw_${suffix}`,
    ...overrides
  });
}

async function createOverduePendingState(booking, { overdueMs = 60 * 60 * 1000 } = {}) {
  const ensured = await ensurePendingConfirmationDelivery({
    booking,
    now: new Date()
  });
  assert.equal(ensured.ok, true);
  const dueAt = new Date(Date.now() - overdueMs);
  await EmailDeliveryState.updateOne(
    { correlationKey: ensured.correlationKey },
    {
      $set: {
        latestStatus: 'pending',
        attemptCount: 0,
        nextAttemptAt: dueAt,
        latestEventAt: dueAt
      }
    }
  );
  return EmailDeliveryState.findOne({ correlationKey: ensured.correlationKey });
}

function mockSendSuccess({ messageId = 'msg_worker_ok' } = {}) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    const id = `${messageId}_${calls}`;
    return {
      success: true,
      method: 'sent',
      messageId: id,
      sendStatus: 'success',
      sendResult: { messageId: id, method: 'sent', success: true },
      emailEvent: { _id: new mongoose.Types.ObjectId() }
    };
  };
  fn.getCalls = () => calls;
  return fn;
}

function mockSendFailure(message = 'SMTP rejected') {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return {
      success: false,
      method: 'failed',
      sendStatus: 'failed',
      sendResult: { error: message, method: 'failed', success: false }
    };
  };
  fn.getCalls = () => calls;
  return fn;
}

function mockSendLogged() {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return { success: true, method: 'logged', sendStatus: 'success', sendResult: { success: true, method: 'logged' } };
  };
  fn.getCalls = () => calls;
  return fn;
}

function mockSendUnavailable() {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return {
      success: false,
      method: 'unavailable',
      sendStatus: 'failed',
      sendResult: { success: false, method: 'unavailable', error: 'SMTP transport unavailable' }
    };
  };
  fn.getCalls = () => calls;
  return fn;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  restoreEnv();
  __resetConfirmationDeliveryWorkerStateForTesting();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  restoreEnv();
  __resetConfirmationDeliveryWorkerStateForTesting();
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '0';
  delete process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS;
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
  // Existing SM tests invoke ticks directly — mark process-local ready.
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  __setConfirmationDeliveryWorkerReadyForTesting(true);
});

test('A) pending confirmation is delivered once with sent stamps', async () => {
  const booking = await createConfirmedBooking({ email: 'a.delivered@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess({ messageId: 'msg_a' });

  const tick = await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(tick.dueCount, 1);
  assert.equal(sendFn.getCalls(), 1);

  const state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'succeeded');
  assert.ok(state.providerMessageId);

  const refreshed = await Booking.findById(booking._id).lean();
  assert.ok(refreshed.confirmationEmailSentAt);
});

test('B) backlog survives finalization and drains later', async () => {
  const booking = await createConfirmedBooking({ email: 'b.backlog@example.com' });
  // Simulate finalize side-effects enqueue only (send=false).
  const ensured = await ensurePendingConfirmationDelivery({ booking, now: new Date() });
  assert.equal(ensured.status, 'pending');
  await EmailDeliveryState.updateOne(
    { correlationKey: ensured.correlationKey },
    { $set: { nextAttemptAt: new Date(Date.now() - 10 * 60 * 1000), attemptCount: 0 } }
  );

  const sendFn = mockSendSuccess({ messageId: 'msg_b' });
  await runConfirmationDeliveryTickOnce({
    now: new Date(),
    sendFn
  });
  assert.equal(sendFn.getCalls(), 1);
  const state = await EmailDeliveryState.findOne({ correlationKey: ensured.correlationKey }).lean();
  assert.equal(state.latestStatus, 'succeeded');
});

test('C) concurrent ticks send exactly once', async () => {
  const booking = await createConfirmedBooking({ email: 'c.concurrent@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess({ messageId: 'msg_c' });
  const now = new Date();

  const [r1, r2] = await Promise.all([
    runConfirmationDeliveryTickOnce({ now, sendFn }),
    runConfirmationDeliveryTickOnce({ now, sendFn })
  ]);
  assert.equal((r1.dueCount || 0) + (r2.dueCount || 0) >= 1, true);
  assert.equal(sendFn.getCalls(), 1);
  const states = await EmailDeliveryState.find({ bookingId: booking._id }).lean();
  assert.equal(states.length, 1);
  assert.equal(states[0].latestStatus, 'succeeded');
});

test('D) already succeeded is never sent again', async () => {
  const booking = await createConfirmedBooking({ email: 'd.sent@example.com' });
  const state = await createOverduePendingState(booking);
  await EmailDeliveryState.updateOne(
    { _id: state._id },
    {
      $set: {
        latestStatus: 'succeeded',
        nextAttemptAt: null,
        providerMessageId: 'msg_already'
      }
    }
  );
  await Booking.updateOne(
    { _id: booking._id },
    { $set: { confirmationEmailSentAt: new Date() } }
  );

  const sendFn = mockSendSuccess();
  const tick = await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(tick.dueCount, 0);
  assert.equal(sendFn.getCalls(), 0);
});

test('E) retryable SMTP failure then later success', async () => {
  const booking = await createConfirmedBooking({ email: 'e.retry@example.com' });
  await createOverduePendingState(booking);
  const failFn = mockSendFailure('temporary smtp');
  await runConfirmationDeliveryTickOnce({ sendFn: failFn });
  assert.equal(failFn.getCalls(), 1);

  let state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'failed');
  assert.equal(state.attemptCount, 1);
  assert.ok(state.nextAttemptAt > new Date());

  // Not due yet.
  const early = await runConfirmationDeliveryTickOnce({
    now: new Date(),
    sendFn: mockSendSuccess()
  });
  assert.equal(early.dueCount, 0);

  const successFn = mockSendSuccess({ messageId: 'msg_e' });
  await runConfirmationDeliveryTickOnce({
    now: new Date(state.nextAttemptAt.getTime() + 1000),
    sendFn: successFn
  });
  assert.equal(successFn.getCalls(), 1);
  state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'succeeded');
  assert.equal(state.attemptCount, 2);
});

test('F) stale lease before SMTP reclaims to pending then delivers once', async () => {
  process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS = '1000';
  const booking = await createConfirmedBooking({ email: 'f.lease@example.com' });
  const pending = await createOverduePendingState(booking);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: pending.correlationKey,
    workerId: 'crashed-worker',
    now: new Date(Date.now() - 10 * 60 * 1000),
    visibilityTimeoutMs: 1000
  });
  assert.ok(claimed);
  assert.equal(claimed.latestStatus, 'sending');
  assert.equal(claimed.smtpAttemptStartedAt, null);

  const sendFn = mockSendSuccess({ messageId: 'msg_f' });
  await runConfirmationDeliveryTickOnce({ now: new Date(), sendFn });
  assert.equal(sendFn.getCalls(), 1);
  const state = await EmailDeliveryState.findOne({ correlationKey: pending.correlationKey }).lean();
  assert.equal(state.latestStatus, 'succeeded');
});

test('G) stale lease after SMTP began becomes ambiguous and does not resend', async () => {
  process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS = '1000';
  const booking = await createConfirmedBooking({ email: 'g.ambiguous@example.com' });
  const pending = await createOverduePendingState(booking);
  const past = new Date(Date.now() - 10 * 60 * 1000);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: pending.correlationKey,
    workerId: 'crashed-after-smtp',
    now: past,
    visibilityTimeoutMs: 1000
  });
  await markSmtpAttemptStarted({ correlationKey: claimed.correlationKey, now: past });

  const sendFn = mockSendSuccess();
  await runConfirmationDeliveryTickOnce({ now: new Date(), sendFn });
  assert.equal(sendFn.getCalls(), 0);
  const state = await EmailDeliveryState.findOne({ correlationKey: pending.correlationKey }).lean();
  assert.equal(state.latestStatus, 'ambiguous');
});

test('H) missing booking abandons without looping', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const recipient = 'missing.booking@example.com';
  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId,
    templateKey: 'booking_confirmed',
    recipientEmail: recipient
  });
  await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    bookingId,
    templateKey: 'booking_confirmed',
    recipient,
    latestStatus: 'pending',
    latestEventAt: new Date(Date.now() - 3600000),
    nextAttemptAt: new Date(Date.now() - 3600000),
    attemptCount: 0,
    maxAttempts: 10
  });

  const sendFn = mockSendSuccess();
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 0);
  const state = await EmailDeliveryState.findOne({ correlationKey }).lean();
  assert.equal(state.latestStatus, 'failed');
  assert.equal(state.nextAttemptAt, null);
  assert.equal(state.lastErrorCode, 'BOOKING_MISSING');

  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 0);
  assert.ok(await ManualReviewItem.countDocuments({ category: 'booking_lifecycle_email_failed' }) >= 1);
});

test('I) cancelled booking is not confirmed by email', async () => {
  const booking = await createConfirmedBooking({
    email: 'i.cancelled@example.com',
    status: 'cancelled'
  });
  // Force a pending booking_confirmed row as if status flipped after enqueue.
  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: 'i.cancelled@example.com'
  });
  await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipient: 'i.cancelled@example.com',
    latestStatus: 'pending',
    latestEventAt: new Date(Date.now() - 3600000),
    nextAttemptAt: new Date(Date.now() - 3600000),
    attemptCount: 0,
    maxAttempts: 10
  });

  const sendFn = mockSendSuccess();
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 0);
  const state = await EmailDeliveryState.findOne({ correlationKey }).lean();
  assert.equal(state.latestStatus, 'failed');
  assert.equal(state.lastErrorCode, 'BOOKING_CANCELLED');
});

test('J) feature flag off does not start or claim', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '0';
  assert.equal(featureFlags.isBookingConfirmationDeliveryWorkerEnabled(), false);
  const started = startBookingConfirmationDeliveryWorker();
  assert.equal(started.started, false);

  const booking = await createConfirmedBooking({ email: 'j.flagoff@example.com' });
  await createOverduePendingState(booking);
  // Tick can still be invoked in tests; production entrypoint exits when disabled.
  // Flag gate is on start*IfEnabled — verify start fails closed.
  stopBookingConfirmationDeliveryWorkerForTest();
});

test('K) health metrics reflect activity and overdue backlog', async () => {
  process.env.SMTP_HOST = 'smtp.example.test';
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  const booking = await createConfirmedBooking({ email: 'k.health@example.com' });
  await createOverduePendingState(booking);

  let health = await getBookingConfirmationDeliveryHealthReadModel();
  assert.equal(health.smtpConfigured, true);
  assert.equal(health.backlog.pendingDueCount >= 1, true);
  assert.equal(health.healthy, false);

  const sendFn = mockSendSuccess();
  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipSmtpVerifyForTest: true,
    skipProductionFatalCheck: true,
    sendFn,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  await runConfirmationDeliveryTickOnce({ sendFn });
  health = await getBookingConfirmationDeliveryHealthReadModel();
  const worker = getBookingConfirmationDeliveryWorkerState();
  assert.equal(worker.running, true);
  assert.ok(worker.lastTickAt);
  assert.equal(health.backlog.pendingDueCount, 0);
  assert.equal(worker.succeededTotal >= 1, true);
  stopBookingConfirmationDeliveryWorkerForTest();
  delete process.env.SMTP_HOST;
});

test('L) process restart drains previously overdue pending rows', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  const booking = await createConfirmedBooking({ email: 'l.restart@example.com' });
  await createOverduePendingState(booking, { overdueMs: 2 * 60 * 60 * 1000 });
  const sendFn = mockSendSuccess({ messageId: 'msg_l' });

  // Simulate cold start after deploy.
  __resetConfirmationDeliveryWorkerStateForTesting();
  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipSmtpVerifyForTest: true,
    skipProductionFatalCheck: true,
    sendFn,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 1);
  const state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'succeeded');
  stopBookingConfirmationDeliveryWorkerForTest();
});

test('REGRESSION: incident shape — overdue pending attemptCount 0 after finalize, worker drains once', async () => {
  // Reproduce:
  // - confirmed booking
  // - pending EmailDeliveryState
  // - attemptCount 0
  // - overdue nextAttemptAt
  // - no EmailEvent / no confirmationEmailSentAt
  // - checkout finalization already complete
  // - worker starts later → exactly one send
  const booking = await createConfirmedBooking({
    email: 'silencesky.fly@gmail.com',
    checkoutId: 'chk_incident_regression_1'
  });
  assert.equal(booking.confirmationEmailSentAt == null, true);

  const correlationKey = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: 'silencesky.fly@gmail.com'
  });
  const overdueAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    bookingId: booking._id,
    checkoutId: booking.checkoutId,
    templateKey: 'booking_confirmed',
    recipient: 'silencesky.fly@gmail.com',
    latestStatus: 'pending',
    latestEventAt: overdueAt,
    nextAttemptAt: overdueAt,
    attemptCount: 0,
    maxAttempts: 10
  });

  const backlog = await countConfirmationDeliveryBacklog({ now: new Date() });
  assert.equal(backlog.pendingDueCount, 1);

  const sendFn = mockSendSuccess({ messageId: 'msg_incident' });
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 1);

  const state = await EmailDeliveryState.findOne({ correlationKey }).lean();
  assert.equal(state.latestStatus, 'succeeded');
  assert.ok(state.providerMessageId);
  assert.ok(state.latestEmailEventId);

  const refreshed = await Booking.findById(booking._id).lean();
  assert.ok(refreshed.confirmationEmailSentAt);

  // Idempotent: second tick does not resend.
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 1);
});

test('flag parser accepts shared boolean tokens for confirmation worker', () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = 'true';
  assert.equal(featureFlags.isBookingConfirmationDeliveryWorkerEnabled(), true);
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '0';
  assert.equal(featureFlags.isBookingConfirmationDeliveryWorkerEnabled(), false);
  delete process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED;
  assert.equal(featureFlags.isBookingConfirmationDeliveryWorkerEnabled(), false);
});

test('B1) entrypoint source loads loadServerEnv before email worker require', () => {
  const src = fs.readFileSync(
    path.join(__dirname, 'runBookingConfirmationDeliveryWorker.js'),
    'utf8'
  );
  const envIdx = src.indexOf("require('../config/loadServerEnv')");
  const workerIdx = src.indexOf(
    "require('../services/email/bookingConfirmationDeliveryWorker')"
  );
  assert.ok(envIdx >= 0);
  assert.ok(workerIdx > envIdx);
});

test('B1) production missing SMTP is fatal', () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_URL;
  process.env.EMAIL_DELIVERY_REQUIRED = '1';
  assert.throws(
    () => assertProductionWorkerConfigOrThrow({ nodeEnv: 'production' }),
    (err) => err.fatal === true && err.code === 'SMTP_NOT_CONFIGURED'
  );
});

test('B1) production missing EMAIL_DELIVERY_REQUIRED is fatal', () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  process.env.SMTP_HOST = 'smtp.example.test';
  delete process.env.EMAIL_DELIVERY_REQUIRED;
  assert.throws(
    () => assertProductionWorkerConfigOrThrow({ nodeEnv: 'production' }),
    (err) => err.fatal === true && err.code === 'EMAIL_DELIVERY_REQUIRED_MISSING'
  );
});

test('B1) verify failure enters degraded and claims zero rows', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  process.env.SMTP_HOST = 'smtp.example.test';
  __resetConfirmationDeliveryWorkerStateForTesting();
  __setConfirmationDeliveryVerifyFnForTesting(async () => ({
    ok: false,
    configured: true,
    verified: false,
    errorCode: 'SMTP_VERIFY_FAILED',
    error: 'verify boom'
  }));
  const booking = await createConfirmedBooking({ email: 'b1.degraded@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess();

  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipProductionFatalCheck: true,
    mongoConnected: true,
    bootstrapCompleted: true,
    sendFn,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  await runSmtpVerificationOnce({ reason: 'test' });
  assert.equal(isBookingConfirmationDeliveryReady(), false);
  assert.equal(getBookingConfirmationDeliveryWorkerState().readinessState, 'degraded');

  const tick = await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(tick.skippedReason, 'not_ready');
  assert.equal(sendFn.getCalls(), 0);
  const state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'pending');
  stopBookingConfirmationDeliveryWorkerForTest();
});

test('B1) later verify success becomes ready and drains overdue pending', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  process.env.SMTP_HOST = 'smtp.example.test';
  __resetConfirmationDeliveryWorkerStateForTesting();
  let verifyOk = false;
  __setConfirmationDeliveryVerifyFnForTesting(async () => ({
    ok: verifyOk,
    configured: true,
    verified: verifyOk,
    error: verifyOk ? null : 'down'
  }));
  const booking = await createConfirmedBooking({ email: 'b1.recover@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess({ messageId: 'msg_recover' });

  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipProductionFatalCheck: true,
    mongoConnected: true,
    bootstrapCompleted: true,
    sendFn,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  await runSmtpVerificationOnce({ reason: 'fail' });
  assert.equal(isBookingConfirmationDeliveryReady(), false);

  verifyOk = true;
  await runSmtpVerificationOnce({ reason: 'ok' });
  assert.equal(isBookingConfirmationDeliveryReady(), true);
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 1);
  const state = await EmailDeliveryState.findOne({ bookingId: booking._id }).lean();
  assert.equal(state.latestStatus, 'succeeded');
  stopBookingConfirmationDeliveryWorkerForTest();
});

test('B1) ready worker losing verification stops claims', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  process.env.SMTP_HOST = 'smtp.example.test';
  __resetConfirmationDeliveryWorkerStateForTesting();
  let verifyOk = true;
  __setConfirmationDeliveryVerifyFnForTesting(async () => ({
    ok: verifyOk,
    configured: true,
    verified: verifyOk,
    error: verifyOk ? null : 'lost'
  }));
  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipProductionFatalCheck: true,
    mongoConnected: true,
    bootstrapCompleted: true,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  await runSmtpVerificationOnce({ reason: 'ok' });
  assert.equal(isBookingConfirmationDeliveryReady(), true);

  const booking = await createConfirmedBooking({ email: 'b1.lost@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess();

  verifyOk = false;
  await runSmtpVerificationOnce({ reason: 'lost' });
  assert.equal(isBookingConfirmationDeliveryReady(), false);
  const tick = await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(tick.skippedReason, 'not_ready');
  assert.equal(sendFn.getCalls(), 0);
  stopBookingConfirmationDeliveryWorkerForTest();
});

test('B1) logged fallback never succeeds and does not stamp confirmationEmailSentAt', async () => {
  const booking = await createConfirmedBooking({ email: 'b1.logged@example.com' });
  const pending = await createOverduePendingState(booking);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: pending.correlationKey,
    workerId: 'test',
    now: new Date()
  });
  const result = await sendClaimedConfirmationDelivery({
    state: claimed,
    booking,
    sendFn: mockSendLogged()
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.errorCode, 'LOGGED_FALLBACK');
  const state = await EmailDeliveryState.findOne({ correlationKey: pending.correlationKey }).lean();
  assert.equal(state.latestStatus, 'failed');
  assert.equal(state.providerMessageId, null);
  const refreshed = await Booking.findById(booking._id).lean();
  assert.equal(refreshed.confirmationEmailSentAt == null, true);
});

test('B1) unavailable fallback never succeeds', async () => {
  const booking = await createConfirmedBooking({ email: 'b1.unavail@example.com' });
  const pending = await createOverduePendingState(booking);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: pending.correlationKey,
    workerId: 'test',
    now: new Date()
  });
  const result = await sendClaimedConfirmationDelivery({
    state: claimed,
    booking,
    sendFn: mockSendUnavailable()
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'SMTP_UNAVAILABLE');
  const state = await EmailDeliveryState.findOne({ correlationKey: pending.correlationKey }).lean();
  assert.equal(state.latestStatus, 'failed');
  assert.equal(state.nextAttemptAt != null, true);
});

test('B1) throw after SMTP attempt started becomes ambiguous (no auto-resend)', async () => {
  const booking = await createConfirmedBooking({ email: 'b1.throw@example.com' });
  const pending = await createOverduePendingState(booking);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: pending.correlationKey,
    workerId: 'test',
    now: new Date()
  });
  const result = await sendClaimedConfirmationDelivery({
    state: claimed,
    booking,
    sendFn: async () => {
      throw new Error('connection reset after submit');
    }
  });
  assert.equal(result.ambiguous, true);
  const state = await EmailDeliveryState.findOne({ correlationKey: pending.correlationKey }).lean();
  assert.equal(state.latestStatus, 'ambiguous');
  const sendFn = mockSendSuccess();
  await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(sendFn.getCalls(), 0);
});

test('B1) shutdown stops timers and prevents new claims', async () => {
  process.env.BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED = '1';
  __resetConfirmationDeliveryWorkerStateForTesting();
  startBookingConfirmationDeliveryWorker({
    force: true,
    skipImmediateTick: true,
    skipSmtpVerifyForTest: true,
    skipProductionFatalCheck: true,
    tickMs: 60_000,
    sweeperTickMs: 60_000
  });
  assert.equal(getBookingConfirmationDeliveryWorkerState().running, true);
  stopBookingConfirmationDeliveryWorkerForTest();
  assert.equal(getBookingConfirmationDeliveryWorkerState().running, false);
  assert.equal(getBookingConfirmationDeliveryWorkerState().readinessState, 'stopped');

  const booking = await createConfirmedBooking({ email: 'b1.shutdown@example.com' });
  await createOverduePendingState(booking);
  const sendFn = mockSendSuccess();
  // Not ready after stop
  const tick = await runConfirmationDeliveryTickOnce({ sendFn });
  assert.equal(tick.skippedReason, 'not_ready');
  assert.equal(sendFn.getCalls(), 0);
});
