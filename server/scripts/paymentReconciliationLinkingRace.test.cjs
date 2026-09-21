const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const {
  linkStripePaymentToBooking,
  verifyPaymentLinkedToBooking
} = require('../services/payments/paymentLinkingService');
const { resolvePaymentUnlinkedReviews } = require('../services/payments/paymentReviewResolutionService');
const {
  classifyReservationPaymentStatus
} = require('../services/ops/payment/reservationPaymentSignals');

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
  await CheckoutFinalizationJob.syncIndexes();
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
  await CheckoutFinalizationJob.deleteMany({});
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
  const bookingB = await createBooking({ totalPrice: 199, status: 'cancelled' });
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
    booking: { _id: bookingB._id, stripePaymentIntentId: paymentIntentId },
    linkedBy: 'test_conflict'
  });

  assert.equal(result.status, 'conflict');
  const latestPayment = await Payment.findById(payment._id).lean();
  assert.equal(String(latestPayment.reservationId), String(bookingA._id));
  const review = await ManualReviewItem.findOne({ entityId: String(payment._id) }).lean();
  assert.equal(review.status, 'open');
});

test('booking schema rejects duplicate stripePaymentIntentId rows', async () => {
  const paymentIntentId = `pi_unique_${Date.now()}`;
  await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 100, status: 'confirmed' });

  await assert.rejects(
    () => createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 100, status: 'cancelled' }),
    (err) => err?.code === 11000
  );

  const candidates = await Booking.find({ stripePaymentIntentId: paymentIntentId }).lean();
  assert.equal(candidates.length, 1);
});

test('webhook auto-links when exactly one booking candidate exists for payment intent', async () => {
  const paymentIntentId = `pi_single_candidate_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 100, status: 'confirmed' });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_single_candidate_${Date.now()}`,
      paymentIntentId,
      amountCents: 10000
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
  const bookingB = await createBooking({ totalPrice: 333, status: 'cancelled' });
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

test('finalize-before-Payment not_found catch-up: late webhook auto-links, clears MRI + dashboard signal', async () => {
  // Lifecycle under audit:
  // Stripe succeeds → finalize runs before Payment row exists → linker not_found
  // → booking confirmed → late payment_intent.succeeded upsert → auto-link.
  const paymentIntentId = `pi_finalize_first_${Date.now()}`;
  const checkoutId = `chk_finalize_first_${Date.now()}`;
  const totalPrice = 170;

  // Post-finalize booking state (stripePaymentIntentId already stamped; Payment absent).
  const booking = await createBooking({
    stripePaymentIntentId: paymentIntentId,
    totalPrice,
    status: 'confirmed',
    stripePaidAmountCents: 17000
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { checkoutId } });

  // Simulate linker not_found verification after finalize.
  const preWebhookVerify = await verifyPaymentLinkedToBooking({
    booking,
    paymentIntentId
  });
  assert.equal(preWebhookVerify.linked, false);
  assert.equal(preWebhookVerify.reason, 'not_found');

  // Worker already marked the job succeeded without paymentLinkedAt (truthful).
  const job = await CheckoutFinalizationJob.create({
    checkoutId,
    paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    bookingId: booking._id,
    paymentLinkedAt: null,
    sessionFinalizedAt: new Date(),
    createdReason: 'webhook',
    nextAttemptAt: new Date()
  });

  // Dashboard would classify as pending_verification (PI present, no unlinked Payment row yet).
  assert.equal(
    classifyReservationPaymentStatus({
      booking: { ...booking.toObject(), checkoutId },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: false
    }),
    'pending_verification'
  );

  // Late webhook: original succeeded payload typically lacks bookingId (patched after finalize).
  // Catch-up must use Booking.stripePaymentIntentId, not PI metadata / checkoutId.
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_finalize_first_${Date.now()}`,
      paymentIntentId,
      amountCents: 17000,
      metadata: {
        checkoutId,
        flowVersion: 'v2'
        // intentionally no bookingId / reservationId
      }
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));
  assert.equal(payment.metadata?.linkedBy, 'stripe_webhook_reconciliation');

  const postVerify = await verifyPaymentLinkedToBooking({ booking, paymentIntentId });
  assert.equal(postVerify.linked, true);

  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    0
  );

  assert.equal(
    classifyReservationPaymentStatus({
      booking: { ...booking.toObject(), checkoutId, stripePaymentIntentId: paymentIntentId },
      linkedPaymentTrail: [payment],
      hasUnlinkedStripePayment: false
    }),
    'paid'
  );

  // Late webhook backfills paymentLinkedAt on the succeeded finalize job.
  const reloadedJob = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.ok(reloadedJob.paymentLinkedAt instanceof Date);
  assert.equal(reloadedJob.status, 'succeeded');
});

test('late webhook without matching booking amount leaves Payment unlinked (no false auto-link)', async () => {
  const paymentIntentId = `pi_amt_mismatch_${Date.now()}`;
  const checkoutId = `chk_amt_mismatch_${Date.now()}`;
  const booking = await createBooking({
    stripePaymentIntentId: paymentIntentId,
    totalPrice: 170,
    status: 'confirmed',
    stripePaidAmountCents: 17000
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { checkoutId } });

  const job = await CheckoutFinalizationJob.create({
    checkoutId,
    paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    bookingId: booking._id,
    paymentLinkedAt: null,
    sessionFinalizedAt: new Date(),
    createdReason: 'webhook',
    nextAttemptAt: new Date()
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_amt_mismatch_${Date.now()}`,
      paymentIntentId,
      amountCents: 9900 // mismatch → no auto-link
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.reservationId, null);
  assert.equal(
    await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }),
    1
  );
  assert.equal(
    classifyReservationPaymentStatus({
      booking: { stripePaymentIntentId: paymentIntentId, totalPrice: 170 },
      linkedPaymentTrail: [],
      hasUnlinkedStripePayment: true
    }),
    'unlinked_payment'
  );

  const reloadedJob = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(reloadedJob.paymentLinkedAt, null);
});

test('paymentLinkedAt backfill never overwrites an existing timestamp', async () => {
  const paymentIntentId = `pi_plink_keep_${Date.now()}`;
  const checkoutId = `chk_plink_keep_${Date.now()}`;
  const priorLinkedAt = new Date('2026-01-15T12:00:00.000Z');
  const booking = await createBooking({
    stripePaymentIntentId: paymentIntentId,
    totalPrice: 88,
    status: 'confirmed',
    stripePaidAmountCents: 8800
  });
  await Booking.updateOne({ _id: booking._id }, { $set: { checkoutId } });

  const job = await CheckoutFinalizationJob.create({
    checkoutId,
    paymentIntentId,
    status: 'succeeded',
    stage: 'succeeded',
    bookingId: booking._id,
    paymentLinkedAt: priorLinkedAt,
    sessionFinalizedAt: new Date(),
    createdReason: 'webhook',
    nextAttemptAt: new Date()
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_plink_keep_${Date.now()}`,
      paymentIntentId,
      amountCents: 8800
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.equal(String(payment.reservationId), String(booking._id));

  const reloadedJob = await CheckoutFinalizationJob.findById(job._id).lean();
  assert.equal(new Date(reloadedJob.paymentLinkedAt).toISOString(), priorLinkedAt.toISOString());
});
