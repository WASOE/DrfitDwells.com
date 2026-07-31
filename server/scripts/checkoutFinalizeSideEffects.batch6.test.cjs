/**
 * Batch 6 — Crash-safe checkout finalization side effects + confirmation delivery.
 *
 * Run: node --test --test-concurrency=1 server/scripts/checkoutFinalizeSideEffects.batch6.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const featureFlags = require('../utils/featureFlags');
const {
  enqueuePostFinalizeSideEffects,
  runCheckoutFinalizeSideEffects
} = require('../services/checkout/checkoutFinalizeSideEffects');
const {
  ensurePendingConfirmationDelivery,
  claimConfirmationDeliveryAttempt,
  markSmtpAttemptStarted,
  markConfirmationDeliverySucceeded,
  reclaimStaleSendingConfirmationDeliveries,
  processBookingConfirmationDelivery
} = require('../services/email/bookingConfirmationDeliveryService');
const { bookingLifecycleCorrelationKey } = require('../services/email/emailDeliveryCorrelation');

let mongoServer;
const ORIG_SIDE = process.env.FINALIZE_SIDE_EFFECTS;
const ORIG_SEND = process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
const ORIG_VT = process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS;

function restoreEnv() {
  if (ORIG_SIDE === undefined) delete process.env.FINALIZE_SIDE_EFFECTS;
  else process.env.FINALIZE_SIDE_EFFECTS = ORIG_SIDE;
  if (ORIG_SEND === undefined) delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  else process.env.FINALIZE_WORKER_SEND_CONFIRMATION = ORIG_SEND;
  if (ORIG_VT === undefined) delete process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS;
  else process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS = ORIG_VT;
}

function futureStayDates() {
  const checkIn = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 44 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

function buildLegalAcceptance() {
  return {
    termsVersion: '2026-04-19-v2',
    activityRiskVersion: '2026-04-19-v2',
    acceptedAt: new Date(),
    firstName: 'Batch',
    lastName: 'Six',
    checkbox1TextSnapshot: 'terms',
    checkbox2TextSnapshot: 'risk'
  };
}

async function createBooking(overrides = {}) {
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
    stripePaymentIntentId: overrides.stripePaymentIntentId || `pi_b6_${suffix}`,
    commercialStayFingerprint: overrides.commercialStayFingerprint || `fp_b6_${suffix}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Six',
      email: overrides.email || `batch6-${suffix}@example.com`,
      phone: '+359800000066',
      ...(overrides.guestInfo || {})
    },
    legalAcceptance: buildLegalAcceptance(),
    cabinId: new mongoose.Types.ObjectId(),
    checkoutId: overrides.checkoutId || `chk_b6_${suffix}`,
    ...overrides
  });
}

function mockSendSuccess({ messageId = 'msg_ok' } = {}) {
  return async () => ({
    success: true,
    method: 'sent',
    messageId,
    sendStatus: 'success',
    sendResult: { messageId, method: 'sent', success: true },
    emailEvent: { _id: new mongoose.Types.ObjectId() }
  });
}

function mockSendFailure(message = 'SMTP rejected') {
  return async () => ({
    success: false,
    method: 'failed',
    sendStatus: 'failed',
    sendResult: { error: message, method: 'failed', success: false }
  });
}

function mockSendThrow(message = 'SMTP crashed') {
  return async () => {
    const err = new Error(message);
    err.code = 'SMTP_FAILURE';
    throw err;
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

test.after(async () => {
  restoreEnv();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  restoreEnv();
  process.env.FINALIZE_SIDE_EFFECTS = '0';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '0';
  delete process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS;
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    EmailDeliveryState.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({})
  ]);
});

test('1) FINALIZE_WORKER_SEND_CONFIRMATION off sends no confirmation', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  process.env.FINALIZE_WORKER_SEND_CONFIRMATION = '0';
  assert.equal(featureFlags.isFinalizeWorkerSendConfirmationEnabled(), false);

  const booking = await createBooking();
  let sendCalls = 0;
  const result = await runCheckoutFinalizeSideEffects({
    booking,
    source: 'webhook_worker',
    sendConfirmation: featureFlags.isFinalizeWorkerSendConfirmationEnabled(),
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess()();
    }
  });

  assert.equal(sendCalls, 0);
  assert.equal(result.confirmationEmail.sent, false);
  assert.equal(result.confirmationEmail.queued, true);
  const states = await EmailDeliveryState.find({ bookingId: booking._id });
  assert.equal(states.length, 1);
  assert.equal(states[0].latestStatus, 'pending');
  const reloaded = await Booking.findById(booking._id);
  assert.equal(reloaded.confirmationEmailSentAt == null, true);
});

test('2) Successful finalized booking sends one confirmation', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  const booking = await createBooking();
  let sendCalls = 0;
  const result = await processBookingConfirmationDelivery({
    booking,
    source: 'frontend',
    send: true,
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess({ messageId: 'msg_one' })();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, true);
  assert.equal(sendCalls, 1);
  const state = await EmailDeliveryState.findOne({ correlationKey: result.correlationKey });
  assert.equal(state.latestStatus, 'succeeded');
  assert.equal(state.providerMessageId, 'msg_one');
  const reloaded = await Booking.findById(booking._id);
  assert.ok(reloaded.confirmationEmailSentAt);
});

test('3) Repeated execution does not resend after definitive sent', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  const booking = await createBooking();
  let sendCalls = 0;
  const sendFn = async () => {
    sendCalls += 1;
    return mockSendSuccess()();
  };

  await processBookingConfirmationDelivery({ booking, send: true, sendFn });
  const second = await processBookingConfirmationDelivery({ booking: await Booking.findById(booking._id), send: true, sendFn });
  assert.equal(second.adoptedSent, true);
  assert.equal(sendCalls, 1);
});

test('4) Existing sent evidence is adopted', async () => {
  const sentAt = new Date('2030-01-01T00:00:00.000Z');
  const booking = await createBooking({ confirmationEmailSentAt: sentAt });
  let sendCalls = 0;
  const result = await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess()();
    }
  });
  assert.equal(result.adoptedSent, true);
  assert.equal(sendCalls, 0);
  const state = await EmailDeliveryState.findOne({ bookingId: booking._id });
  assert.equal(state.latestStatus, 'succeeded');
});

test('5) SMTP failure before acceptance becomes retryable', async () => {
  const booking = await createBooking();
  const result = await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: mockSendFailure('connection reset')
  });
  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  const state = await EmailDeliveryState.findOne({ correlationKey: result.correlationKey });
  assert.equal(state.latestStatus, 'failed');
  assert.ok(state.nextAttemptAt);
  assert.ok(Array.isArray(state.failureHistory));
  assert.ok(state.failureHistory.length >= 1);
  const reloaded = await Booking.findById(booking._id);
  assert.equal(reloaded.status, 'confirmed');
  assert.equal(reloaded.confirmationEmailSentAt == null, true);
});

test('6) Retryable delivery can later succeed', async () => {
  const booking = await createBooking();
  const key = bookingLifecycleCorrelationKey({
    bookingId: booking._id,
    templateKey: 'booking_confirmed',
    recipientEmail: booking.guestInfo.email
  });

  await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: mockSendFailure('temp fail')
  });

  await EmailDeliveryState.updateOne(
    { correlationKey: key },
    { $set: { nextAttemptAt: new Date(Date.now() - 1000) } }
  );

  const retry = await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: mockSendSuccess({ messageId: 'msg_retry' })
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.sent, true);
  const state = await EmailDeliveryState.findOne({ correlationKey: key });
  assert.equal(state.latestStatus, 'succeeded');
  assert.equal(state.providerMessageId, 'msg_retry');
});

test('7) Stale active delivery attempt is recoverable (pre-SMTP)', async () => {
  process.env.CONFIRMATION_DELIVERY_VISIBILITY_TIMEOUT_MS = '1000';
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  const now = new Date();
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: 'worker-a',
    now,
    visibilityTimeoutMs: 1000
  });
  assert.equal(claimed.latestStatus, 'sending');
  assert.equal(claimed.smtpAttemptStartedAt, null);

  const past = new Date(now.getTime() + 2000);
  const reclaim = await reclaimStaleSendingConfirmationDeliveries({ now: past, limit: 10 });
  assert.equal(reclaim.reclaimedPending, 1);
  const state = await EmailDeliveryState.findOne({ correlationKey: ensured.correlationKey });
  assert.equal(state.latestStatus, 'pending');

  const sent = await processBookingConfirmationDelivery({
    booking,
    send: true,
    now: past,
    sendFn: mockSendSuccess()
  });
  assert.equal(sent.sent, true);
});

test('8) Crash before SMTP does not suppress delivery', async () => {
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  const claimedAt = new Date('2030-06-01T12:00:00.000Z');
  await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: 'crashed',
    now: claimedAt,
    visibilityTimeoutMs: 1000
  });
  // Simulate crash: no smtpAttemptStartedAt, VT expired
  const reclaimAt = new Date(claimedAt.getTime() + 5000);
  await reclaimStaleSendingConfirmationDeliveries({ now: reclaimAt });
  const after = await EmailDeliveryState.findOne({ correlationKey: ensured.correlationKey });
  assert.equal(after.latestStatus, 'pending');

  const result = await processBookingConfirmationDelivery({
    booking,
    send: true,
    now: reclaimAt,
    sendFn: mockSendSuccess()
  });
  assert.equal(result.sent, true);
});

test('9) Crash after SMTP with ambiguous persistence is explicit', async () => {
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  const claimedAt = new Date('2030-06-02T12:00:00.000Z');
  await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: 'crashed-after-smtp',
    now: claimedAt,
    visibilityTimeoutMs: 1000
  });
  await markSmtpAttemptStarted({
    correlationKey: ensured.correlationKey,
    now: new Date(claimedAt.getTime() + 10)
  });

  const reclaimAt = new Date(claimedAt.getTime() + 5000);
  const reclaim = await reclaimStaleSendingConfirmationDeliveries({ now: reclaimAt });
  assert.equal(reclaim.markedAmbiguous, 1);
  const state = await EmailDeliveryState.findOne({ correlationKey: ensured.correlationKey });
  assert.equal(state.latestStatus, 'ambiguous');
  assert.ok(state.ambiguousAt);
});

test('10) Ambiguous delivery does not enter uncontrolled resend loop', async () => {
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  await EmailDeliveryState.updateOne(
    { correlationKey: ensured.correlationKey },
    {
      $set: {
        latestStatus: 'ambiguous',
        ambiguousAt: new Date(),
        ambiguousReason: 'AMBIGUOUS_SMTP_RETRY'
      }
    }
  );

  let sendCalls = 0;
  const result = await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess()();
    }
  });
  assert.equal(result.ambiguous, true);
  assert.equal(sendCalls, 0);
  const claimed = await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: 'should-not-claim'
  });
  assert.equal(claimed, null);
});

test('11) Two workers cannot concurrently send the same confirmation', async () => {
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  const now = new Date();
  const [a, b] = await Promise.all([
    claimConfirmationDeliveryAttempt({
      correlationKey: ensured.correlationKey,
      workerId: 'w1',
      now
    }),
    claimConfirmationDeliveryAttempt({
      correlationKey: ensured.correlationKey,
      workerId: 'w2',
      now
    })
  ]);
  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].latestStatus, 'sending');
});

test('12) Frontend and worker converge on one delivery record', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  const booking = await createBooking();

  await enqueuePostFinalizeSideEffects({
    booking,
    source: 'webhook_worker',
    sendConfirmation: false
  });

  const frontend = await runCheckoutFinalizeSideEffects({
    booking,
    source: 'frontend',
    sendConfirmation: true,
    sendFn: mockSendSuccess({ messageId: 'msg_shared' })
  });
  assert.equal(frontend.confirmationEmail.sent, true);

  const worker = await runCheckoutFinalizeSideEffects({
    booking: await Booking.findById(booking._id),
    source: 'webhook_worker',
    sendConfirmation: true,
    sendFn: mockSendSuccess({ messageId: 'msg_dup' })
  });
  assert.equal(worker.confirmationEmail.adoptedSent, true);

  const count = await EmailDeliveryState.countDocuments({ bookingId: booking._id });
  assert.equal(count, 1);
});

test('13) Adopted Booking does not receive a duplicate confirmation', async () => {
  const booking = await createBooking({
    confirmationEmailSentAt: new Date('2030-01-02T00:00:00.000Z')
  });
  let sendCalls = 0;
  await runCheckoutFinalizeSideEffects({
    booking,
    adoptedExisting: true,
    sendConfirmation: true,
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess()();
    }
  });
  // Side effects flag off → stub unless send; force side effects path:
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  sendCalls = 0;
  await runCheckoutFinalizeSideEffects({
    booking,
    adoptedExisting: true,
    sendConfirmation: true,
    sendFn: async () => {
      sendCalls += 1;
      return mockSendSuccess()();
    }
  });
  assert.equal(sendCalls, 0);
});

test('14) Paid Booking remains confirmed when email fails', async () => {
  const booking = await createBooking({ status: 'confirmed' });
  await processBookingConfirmationDelivery({
    booking,
    send: true,
    sendFn: mockSendThrow('smtp down')
  });
  const reloaded = await Booking.findById(booking._id);
  assert.equal(reloaded.status, 'confirmed');
  assert.ok(reloaded);
});

test('15–17) No refund, no PaymentIntent create, no duplicate Booking on email failure', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '1';
  const booking = await createBooking();
  const beforeCount = await Booking.countDocuments({});
  const result = await enqueuePostFinalizeSideEffects({
    booking,
    sendConfirmation: true,
    sendFn: mockSendFailure('boom')
  });
  assert.equal(result.refundAttempted, false);
  assert.equal(result.paymentIntentCreateAttempted, false);
  assert.equal(result.bookingDeleted, false);
  assert.equal(await Booking.countDocuments({}), beforeCount);
  assert.equal((await Booking.findById(booking._id)).status, 'confirmed');

  const sideSrc = fs.readFileSync(
    path.join(__dirname, '../services/checkout/checkoutFinalizeSideEffects.js'),
    'utf8'
  );
  assert.doesNotMatch(sideSrc, /refunds\.create|paymentIntents\.create|Booking\.create/);
  const deliverySrc = fs.readFileSync(
    path.join(__dirname, '../services/email/bookingConfirmationDeliveryService.js'),
    'utf8'
  );
  assert.doesNotMatch(deliverySrc, /refunds\.create|paymentIntents\.create|Booking\.create/);
});

test('flag defaults: FINALIZE_SIDE_EFFECTS and FINALIZE_WORKER_SEND_CONFIRMATION off', () => {
  delete process.env.FINALIZE_SIDE_EFFECTS;
  delete process.env.FINALIZE_WORKER_SEND_CONFIRMATION;
  assert.equal(featureFlags.isFinalizeSideEffectsEnabled(), false);
  assert.equal(featureFlags.isFinalizeWorkerSendConfirmationEnabled(), false);
});

test('enqueue is no-op when FINALIZE_SIDE_EFFECTS off and send false', async () => {
  process.env.FINALIZE_SIDE_EFFECTS = '0';
  const booking = await createBooking();
  const result = await enqueuePostFinalizeSideEffects({ booking, sendConfirmation: false });
  assert.equal(result.deferred, true);
  assert.equal(await EmailDeliveryState.countDocuments({}), 0);
});

test('confirmationEmailSentAt is not set on claim-before-SMTP', async () => {
  const booking = await createBooking();
  const ensured = await ensurePendingConfirmationDelivery({ booking });
  await claimConfirmationDeliveryAttempt({
    correlationKey: ensured.correlationKey,
    workerId: 'pre-smtp'
  });
  const mid = await Booking.findById(booking._id);
  assert.equal(mid.confirmationEmailSentAt == null, true);
  await markConfirmationDeliverySucceeded({
    correlationKey: ensured.correlationKey,
    bookingId: booking._id
  });
  const after = await Booking.findById(booking._id);
  assert.ok(after.confirmationEmailSentAt);
});
