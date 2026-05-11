const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const { linkStripePaymentToBooking } = require('../services/payments/paymentLinkingService');
const { resolvePaymentUnlinkedReviews } = require('../services/payments/paymentReviewResolutionService');

let mongoServer;

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function makeStripeEvent({
  id,
  type = 'payment_intent.succeeded',
  paymentIntentId,
  amountCents,
  amountReceivedCents = amountCents,
  metadata = {}
}) {
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: paymentIntentId,
        amount: amountCents,
        amount_received: amountReceivedCents,
        currency: 'eur',
        metadata
      }
    }
  };
}

async function createBooking({
  stripePaymentIntentId,
  totalPrice,
  status = 'confirmed',
  stripePaidAmountCents
}) {
  const payload = {
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: plusDays(5),
    checkOut: plusDays(7),
    adults: 2,
    children: 0,
    status,
    isTest: false,
    archivedAt: null,
    guestInfo: {
      firstName: 'Race',
      lastName: 'Tester',
      email: `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      phone: '+3590000000'
    },
    totalPrice,
    stripePaidAmountCents: Number.isFinite(stripePaidAmountCents)
      ? stripePaidAmountCents
      : Math.round(Number(totalPrice) * 100)
  };
  if (stripePaymentIntentId) payload.stripePaymentIntentId = stripePaymentIntentId;
  return Booking.create(payload);
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Booking.syncIndexes();
  await Payment.syncIndexes();
  await ManualReviewItem.syncIndexes();
  await StripeEventEvidence.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Booking.deleteMany({});
  await Payment.deleteMany({});
  await ManualReviewItem.deleteMany({});
});

test('booking before webhook auto-links payment and keeps payment_unlinked clear', async () => {
  const paymentIntentId = `pi_befwh_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 240 });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_befwh_${Date.now()}`,
      paymentIntentId,
      amountCents: 24000
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));
  const openUnlinked = await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' });
  assert.equal(openUnlinked, 0);
});

test('webhook before booking: later link resolves stale payment_unlinked review', async () => {
  const paymentIntentId = `pi_whbef_${Date.now()}`;
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_whbef_${Date.now()}`,
      paymentIntentId,
      amountCents: 30000
    })
  );

  let payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.reservationId, null);
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    1
  );

  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 300 });
  const linkResult = await linkStripePaymentToBooking({
    booking,
    linkedBy: 'test_webhook_before_booking'
  });
  assert.ok(['linked', 'already_linked'].includes(linkResult.status));
  assert.equal(linkResult.reviewResolution.attempted, true);

  payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.equal(String(payment.reservationId), String(booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    0
  );
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'resolved' }),
    1
  );
});

test('already_linked path resolves stale payment_unlinked review', async () => {
  const paymentIntentId = `pi_already_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 125 });
  const payment = await Payment.create({
    reservationId: booking._id,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 125,
    currency: 'eur',
    source: 'webhook',
    metadata: { stripePaymentIntentId: paymentIntentId }
  });
  await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'stale review'
  });

  const result = await linkStripePaymentToBooking({
    booking,
    linkedBy: 'test_already_linked_cleanup'
  });

  assert.equal(result.status, 'already_linked');
  assert.equal(result.reviewResolution.attempted, true);
  const review = await ManualReviewItem.findOne({ entityId: String(payment._id) }).lean();
  assert.equal(review.status, 'resolved');
});

test('conflict: does not overwrite existing reservation and does not resolve review', async () => {
  const paymentIntentId = `pi_conflict_${Date.now()}`;
  const bookingA = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 199, status: 'confirmed' });
  const bookingB = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 199, status: 'cancelled' });
  const payment = await Payment.create({
    reservationId: bookingA._id,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 199,
    currency: 'eur',
    source: 'webhook',
    metadata: { stripePaymentIntentId: paymentIntentId }
  });
  await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'should stay open'
  });

  const result = await linkStripePaymentToBooking({
    booking: bookingB,
    linkedBy: 'test_conflict'
  });

  assert.equal(result.status, 'conflict');
  const latestPayment = await Payment.findById(payment._id).lean();
  assert.equal(String(latestPayment.reservationId), String(bookingA._id));
  const review = await ManualReviewItem.findOne({ entityId: String(payment._id) }).lean();
  assert.equal(review.status, 'open');
});

test('multiple booking candidates: webhook does not auto-link and opens high-severity review', async () => {
  const paymentIntentId = `pi_multi_${Date.now()}`;
  await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 100, status: 'confirmed' });
  await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 100, status: 'cancelled' });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_multi_${Date.now()}`,
      paymentIntentId,
      amountCents: 10000
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.reservationId, null);
  const review = await ManualReviewItem.findOne({
    category: 'payment_unlinked',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id)
  }).lean();
  assert.ok(review);
  assert.equal(review.severity, 'high');
  assert.ok(Array.isArray(review.evidence?.bookingCandidateIds));
  assert.equal(review.evidence.bookingCandidateIds.length, 2);
});

test('zero booking match keeps payment unlinked and review open', async () => {
  const paymentIntentId = `pi_nomatch_${Date.now()}`;
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_nomatch_${Date.now()}`,
      paymentIntentId,
      amountCents: 7000
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.reservationId, null);
  const openCount = await ManualReviewItem.countDocuments({
    category: 'payment_unlinked',
    status: 'open'
  });
  assert.equal(openCount, 1);
});

test('resolver safety: only target open payment_unlinked records and remains idempotent', async () => {
  const paymentIntentId = `pi_resolver_${Date.now()}`;
  const payment = await Payment.create({
    reservationId: null,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 50,
    currency: 'eur',
    source: 'webhook',
    metadata: { stripePaymentIntentId: paymentIntentId }
  });
  const reservationId = String(new mongoose.Types.ObjectId());

  const targetByEntity = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'target by entity'
  });
  const targetByEvidence = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'open',
    entityType: null,
    entityId: null,
    title: 'target by evidence',
    evidence: { providerReference: paymentIntentId }
  });
  const unrelated = await ManualReviewItem.create({
    category: 'payout_unlinked',
    severity: 'medium',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'unrelated category'
  });
  const alreadyResolved = await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'resolved',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'already resolved'
  });

  const first = await resolvePaymentUnlinkedReviews({
    paymentId: String(payment._id),
    paymentIntentId,
    reservationId,
    resolvedBy: 'test_resolver_safety',
    note: 'resolved in test'
  });
  assert.equal(first.attempted, true);
  assert.equal(first.resolvedCount, 2);

  const second = await resolvePaymentUnlinkedReviews({
    paymentId: String(payment._id),
    paymentIntentId,
    reservationId,
    resolvedBy: 'test_resolver_safety',
    note: 'resolved in test'
  });
  assert.equal(second.attempted, true);
  assert.equal(second.resolvedCount, 0);

  const afterTargetEntity = await ManualReviewItem.findById(targetByEntity._id).lean();
  const afterTargetEvidence = await ManualReviewItem.findById(targetByEvidence._id).lean();
  const afterUnrelated = await ManualReviewItem.findById(unrelated._id).lean();
  const afterAlreadyResolved = await ManualReviewItem.findById(alreadyResolved._id).lean();

  assert.equal(afterTargetEntity.status, 'resolved');
  assert.equal(afterTargetEvidence.status, 'resolved');
  assert.equal(afterUnrelated.status, 'open');
  assert.equal(afterAlreadyResolved.status, 'resolved');
});

test('later webhook without reservation metadata must not clear existing reservation linkage', async () => {
  const paymentIntentId = `pi_preserve_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 222, status: 'confirmed' });
  await Payment.create({
    reservationId: booking._id,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 222,
    currency: 'eur',
    source: 'webhook',
    metadata: { bookingId: String(booking._id) }
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_preserve_${Date.now()}`,
      paymentIntentId,
      amountCents: 22200,
      metadata: {}
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    0
  );
});

test('later webhook metadata conflict must not overwrite existing reservation linkage', async () => {
  const paymentIntentId = `pi_conflict_meta_${Date.now()}`;
  const bookingA = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 333, status: 'confirmed' });
  const bookingB = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 333, status: 'cancelled' });
  await Payment.create({
    reservationId: bookingA._id,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 333,
    currency: 'eur',
    source: 'webhook',
    metadata: { bookingId: String(bookingA._id) }
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_conflict_meta_${Date.now()}`,
      paymentIntentId,
      amountCents: 33300,
      metadata: {
        bookingId: String(bookingB._id),
        reservationId: String(bookingB._id)
      }
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(bookingA._id));

  const conflictReview = await ManualReviewItem.findOne({
    category: 'payment_unlinked',
    status: 'open',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'Stripe webhook reservation metadata conflicts with existing linkage'
  }).lean();
  assert.ok(conflictReview);
  assert.equal(conflictReview.severity, 'high');
  assert.equal(conflictReview.evidence?.existingReservationId, String(bookingA._id));
  assert.equal(conflictReview.evidence?.incomingReservationId, String(bookingB._id));
  assert.equal(conflictReview.evidence?.paymentIntentId, paymentIntentId);
  assert.equal(conflictReview.evidence?.paymentId, String(payment._id));
  assert.ok(conflictReview.evidence?.eventId);

  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'resolved' }),
    0
  );
});

test('incoming metadata sets reservationId only when currently null', async () => {
  const paymentIntentId = `pi_meta_sets_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 111, status: 'confirmed' });
  await Payment.create({
    reservationId: null,
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'unpaid',
    amount: 111,
    currency: 'eur',
    source: 'webhook',
    metadata: {}
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_meta_sets_${Date.now()}`,
      paymentIntentId,
      amountCents: 11100,
      metadata: {
        bookingId: String(booking._id),
        reservationId: String(booking._id)
      }
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    0
  );
});
