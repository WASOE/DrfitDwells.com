/**
 * OPS-PUSH-3 — real-time event hook tests.
 * Run: node --test scripts/opsPushEventHooks.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const GiftVoucher = require('../models/GiftVoucher');
const Payment = require('../models/Payment');
const Review = require('../models/Review');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const { createOpsUser } = require('../services/ops/opsUserService');
const { createManualReservation } = require('../services/ops/domain/reservationWriteService');
const { createReviewForModeration } = require('../services/reviews/reviewModerationService');
const { activatePaidVoucherFromStripeEvent } = require('../services/giftVouchers/giftVoucherPaymentService');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const {
  notifyOpsPushBookingCreated,
  notifyOpsPushManualReservationCreated,
  notifyOpsPushGiftVoucherSold,
  notifyOpsPushPaymentAlert,
  notifyOpsPushReviewCreated,
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting
} = require('../services/ops/push/opsPushEventNotifications');

let mongoServer;
const pushCalls = [];

async function createTestCabin(overrides = {}) {
  return Cabin.create({
    name: 'Hook Test Cabin',
    description: 'Test cabin for OPS push hooks',
    location: 'Bansko',
    imageUrl: '/uploads/cabins/test.jpg',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function flushAsyncHooks() {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

function uniqueEventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function capturePushCalls() {
  pushCalls.length = 0;
  __setSendOpsPushSafelyForTesting(async (params) => {
    pushCalls.push(params);
    return { skipped: false, usersTargeted: 1 };
  });
}

function makeStripeEvent({ id, type, paymentIntentId, amountCents, metadata = {}, amountRefunded = null }) {
  const obj = {
    object: 'payment_intent',
    id: paymentIntentId,
    amount: amountCents,
    amount_received: type === 'payment_intent.succeeded' ? amountCents : 0,
    currency: 'eur',
    metadata
  };
  if (type === 'charge.refunded') {
    return {
      id,
      type,
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          object: 'charge',
          id: `ch_${id}`,
          payment_intent: paymentIntentId,
          amount: amountCents,
          amount_refunded: amountRefunded ?? amountCents,
          currency: 'eur',
          metadata
        }
      }
    };
  }
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: obj }
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-3-hooks-test';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await StripeEventEvidence.syncIndexes();
});

test.after(async () => {
  __resetSendOpsPushSafelyForTesting();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  capturePushCalls();
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await GiftVoucher.deleteMany({});
  await Payment.deleteMany({});
  await Review.deleteMany({});
});

test('notifyOpsPushBookingCreated sends admin payload with dedupeKey', async () => {
  const cabin = await createTestCabin({ name: 'The Cabin' });
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-07-10T00:00:00.000Z'),
    checkOut: new Date('2026-07-13T00:00:00.000Z'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@test.local',
      phone: '+359881234567'
    },
    totalPrice: 300
  });

  await notifyOpsPushBookingCreated({ bookingId: booking._id });

  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].role, 'admin');
  assert.equal(pushCalls[0].title, 'New reservation');
  assert.match(pushCalls[0].body, /Ada Lovelace/);
  assert.match(pushCalls[0].body, /The Cabin/);
  assert.match(pushCalls[0].body, /confirmed/);
  assert.equal(pushCalls[0].url, `/ops/reservations/${booking._id}`);
  assert.equal(pushCalls[0].dedupeKey, `booking_created:${booking._id}`);
  assert.equal(pushCalls[0].source, 'booking_created');
});

test('manual reservation hook fires after success but not on idempotent remembered result', async () => {
  const admin = await createOpsUser({
    email: 'ops.manual@test.local',
    name: 'Ops Manual',
    password: 'ops-pass-12345',
    role: 'admin'
  });

  const cabin = await createTestCabin({ name: 'Valley Unit' });

  const ctx = {
    user: { id: String(admin.id), role: 'admin' },
    route: 'POST /api/ops/reservations/manual',
    idempotencyKey: 'manual-res-idem-1'
  };

  const first = await createManualReservation({
    cabinId: String(cabin._id),
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-04',
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Manual',
      lastName: 'Guest',
      email: 'manual.guest@test.local',
      phone: '+359881234567'
    },
    initialStatus: 'pending',
    ctx
  });
  await flushAsyncHooks();

  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Manual reservation');
  assert.equal(pushCalls[0].dedupeKey, `manual_reservation_created:${first.reservationId}`);
  assert.equal(pushCalls[0].source, 'manual_reservation_created');

  pushCalls.length = 0;
  const second = await createManualReservation({
    cabinId: String(cabin._id),
    checkInDate: '2026-08-01',
    checkOutDate: '2026-08-04',
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Manual',
      lastName: 'Guest',
      email: 'manual.guest@test.local',
      phone: '+359881234567'
    },
    initialStatus: 'pending',
    ctx
  });
  await flushAsyncHooks();

  assert.equal(second.reservationId, first.reservationId);
  assert.equal(pushCalls.length, 0);
});

test('gift voucher activation hook fires on activationCompleted success only', async () => {
  await flushAsyncHooks();
  pushCalls.length = 0;

  const voucher = await GiftVoucher.create({
    status: 'pending_payment',
    amountOriginalCents: 15000,
    balanceRemainingCents: 15000,
    currency: 'EUR',
    purchaseRequestId: 'gvr_test_001',
    stripePaymentIntentId: 'pi_gv_test_001',
    recipientEmail: 'gift@test.local',
    deliveryMode: 'email',
    issuanceSource: 'purchase'
  });

  const event = {
    id: uniqueEventId('evt_gv_success'),
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_gv_test_001',
        amount: 15000,
        amount_received: 15000,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(voucher._id),
          purchaseRequestId: 'gvr_test_001'
        }
      }
    }
  };

  const result = await activatePaidVoucherFromStripeEvent(event);
  assert.equal(result.ok, true);
  assert.equal(result.activationCompleted, true);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Gift voucher sold');
  assert.match(pushCalls[0].body, /€150\.00/);
  assert.equal(pushCalls[0].dedupeKey, `gift_voucher_sold:${voucher._id}`);

  pushCalls.length = 0;
  const failEvent = {
    ...event,
    id: 'evt_gv_fail_1',
    data: {
      object: {
        ...event.data.object,
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(new mongoose.Types.ObjectId()),
          purchaseRequestId: 'gvr_missing'
        }
      }
    }
  };
  const failResult = await activatePaidVoucherFromStripeEvent(failEvent);
  assert.equal(failResult.ok, false);
  assert.equal(pushCalls.length, 0);
});

test('linked failed and refunded payments notify admin; unlinked and deduped events do not', async () => {
  await flushAsyncHooks();
  pushCalls.length = 0;

  const booking = await Booking.create({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: new Date('2026-09-01'),
    checkOut: new Date('2026-09-04'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Pay',
      lastName: 'Tester',
      email: 'pay@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200,
    stripePaymentIntentId: 'pi_booking_fail_1'
  });

  const failedEventId = uniqueEventId('evt_pi_failed');
  const failedEvent = makeStripeEvent({
    id: failedEventId,
    type: 'payment_intent.payment_failed',
    paymentIntentId: 'pi_booking_fail_1',
    amountCents: 20000,
    metadata: {
      bookingId: String(booking._id),
      reservationId: String(booking._id)
    }
  });

  await processStripeWebhookEvent(failedEvent);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Payment failed');
  assert.equal(pushCalls[0].dedupeKey, `stripe_payment_event:${failedEventId}`);
  assert.equal(pushCalls[0].url, `/ops/reservations/${booking._id}`);

  pushCalls.length = 0;
  await processStripeWebhookEvent(failedEvent);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 0, 'alreadyProcessed Stripe event must not notify again');

  const refundedEvent = makeStripeEvent({
    id: uniqueEventId('evt_pi_refunded'),
    type: 'charge.refunded',
    paymentIntentId: 'pi_booking_fail_1',
    amountCents: 20000,
    metadata: {
      bookingId: String(booking._id)
    }
  });
  await processStripeWebhookEvent(refundedEvent);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Payment refunded');

  pushCalls.length = 0;
  const partialEvent = makeStripeEvent({
    id: uniqueEventId('evt_pi_partial'),
    type: 'charge.refunded',
    paymentIntentId: 'pi_booking_partial_1',
    amountCents: 20000,
    amountRefunded: 5000,
    metadata: {
      bookingId: String(booking._id)
    }
  });
  await processStripeWebhookEvent(partialEvent);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Partial refund');

  pushCalls.length = 0;
  const unlinkedEvent = makeStripeEvent({
    id: uniqueEventId('evt_unlinked'),
    type: 'payment_intent.payment_failed',
    paymentIntentId: 'pi_unlinked_noise_1',
    amountCents: 9900,
    metadata: {}
  });
  await processStripeWebhookEvent(unlinkedEvent);
  await flushAsyncHooks();
  assert.equal(pushCalls.length, 0);
});

test('notifyOpsPushBookingCreated is the same hook used after V2 claimResult.claimed side effects', async () => {
  await flushAsyncHooks();
  pushCalls.length = 0;

  const cabin = await createTestCabin();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: new Date('2026-10-01'),
    checkOut: new Date('2026-10-04'),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'V2',
      lastName: 'Claim',
      email: 'v2.claim@test.local',
      phone: '+359881234567'
    },
    totalPrice: 300
  });

  await notifyOpsPushBookingCreated({ bookingId: booking._id });
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].dedupeKey, `booking_created:${booking._id}`);
});

test('review save hook calls push; mocked push failure does not break review create', async () => {
  const cabin = await createTestCabin({ name: 'Review Cabin' });

  __setSendOpsPushSafelyForTesting(async () => {
    throw new Error('push exploded');
  });

  const review = await createReviewForModeration({
    body: {
      cabinId: String(cabin._id),
      rating: 5,
      text: 'Wonderful stay',
      reviewerName: 'Guest Reviewer'
    },
    ctx: { editedBy: 'admin@test.local' }
  });

  assert.ok(review._id);

  __setSendOpsPushSafelyForTesting(async (params) => {
    pushCalls.push(params);
    return { skipped: false };
  });

  await notifyOpsPushReviewCreated({ reviewId: review._id });
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'New review');
  assert.match(pushCalls[0].body, /Review Cabin/);
  assert.match(pushCalls[0].body, /5★/);
  assert.equal(pushCalls[0].url, '/ops/reviews');
  assert.equal(pushCalls[0].dedupeKey, `review_created:${review._id}`);
});

test('notifyOpsPushPaymentAlert handles refund.failed title', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const payment = await Payment.create({
    reservationId: bookingId,
    provider: 'stripe',
    providerReference: 'pi_refund_fail_1',
    status: 'failed',
    amount: 50,
    currency: 'eur',
    metadata: {
      bookingId: String(bookingId)
    }
  });

  await notifyOpsPushPaymentAlert({
    eventId: 'evt_refund_failed_1',
    eventType: 'refund.failed',
    paymentId: payment._id
  });

  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].title, 'Refund failed');
  assert.equal(pushCalls[0].source, 'stripe_payment_failed');
});

test('mocked sendOpsPushSafely rejection does not throw from notifyOpsPushBookingCreated', async () => {
  __setSendOpsPushSafelyForTesting(() => Promise.reject(new Error('safe push reject')));
  await assert.doesNotReject(async () => {
    await notifyOpsPushBookingCreated({ bookingId: new mongoose.Types.ObjectId() });
  });
});
