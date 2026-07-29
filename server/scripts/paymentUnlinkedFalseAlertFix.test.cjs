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
const { openManualReviewItem } = require('../services/ops/ingestion/manualReviewService');
const {
  isDefinitivelySuccessfulPaymentStatus,
  shouldRequireBookingLinkage,
  shouldResolvePaymentUnlinkedAsNonPaid,
  NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
} = require('../services/payments/paymentLinkageRequirementPolicy');
const {
  resolvePaymentUnlinkedReviewsForNonPaidPayment
} = require('../services/payments/paymentReviewResolutionService');

let mongoServer;

const stripeCreateCalls = [];
const stripeChargeCalls = [];
const stripeRefundCalls = [];

function plusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function makeStripeEvent({
  id,
  type = 'payment_intent.succeeded',
  paymentIntentId,
  amountCents = 0,
  amountReceivedCents = amountCents,
  status = null,
  metadata = {}
}) {
  const object = {
    object: 'payment_intent',
    id: paymentIntentId,
    amount: amountCents,
    amount_received: amountReceivedCents,
    currency: 'eur',
    metadata
  };
  if (status != null) object.status = status;
  return {
    id,
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object }
  };
}

async function createBooking({ stripePaymentIntentId, totalPrice, status = 'confirmed' }) {
  return Booking.create({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: plusDays(5),
    checkOut: plusDays(7),
    adults: 2,
    children: 0,
    status,
    isTest: false,
    archivedAt: null,
    guestInfo: {
      firstName: 'Link',
      lastName: 'Tester',
      email: `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
      phone: '+3590000000'
    },
    totalPrice,
    stripePaidAmountCents: Math.round(Number(totalPrice) * 100),
    stripePaymentIntentId
  });
}

async function seedOpenPaymentUnlinked({ paymentId, paymentIntentId, sourceReference }) {
  return openManualReviewItem({
    category: 'payment_unlinked',
    severity: 'high',
    entityType: 'Payment',
    entityId: paymentId,
    title: 'Seeded false unlinked alert',
    details: 'test seed',
    provenance: {
      source: 'stripe_webhook',
      sourceReference: sourceReference || `evt_seed_${Date.now()}`
    },
    evidence: {
      providerReference: paymentIntentId,
      paymentIntentId,
      paymentId: String(paymentId)
    }
  });
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
  // StripeEventEvidence is append-only; do not delete — use unique event ids per test.
  await CheckoutFinalizationJob.deleteMany({});
  stripeCreateCalls.length = 0;
  stripeChargeCalls.length = 0;
  stripeRefundCalls.length = 0;
});

test('policy: only paid/succeeded/captured are definitive success', () => {
  assert.equal(isDefinitivelySuccessfulPaymentStatus('paid'), true);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('succeeded'), true);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('captured'), true);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('failed'), false);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('unpaid'), false);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('requires_action'), false);
  assert.equal(isDefinitivelySuccessfulPaymentStatus('processing'), false);
  assert.equal(isDefinitivelySuccessfulPaymentStatus(null), false);
  assert.equal(isDefinitivelySuccessfulPaymentStatus(''), false);
  assert.equal(shouldRequireBookingLinkage({ paymentStatus: 'paid', amountReceived: 10 }), true);
  assert.equal(shouldRequireBookingLinkage({ paymentStatus: 'paid', amountReceived: 0 }), false);
  assert.equal(shouldRequireBookingLinkage({ paymentStatus: 'failed', amountReceived: 10 }), false);
  assert.equal(shouldRequireBookingLinkage({ paymentStatus: 'paid', amountReceived: 10, isGiftVoucher: true }), false);
  assert.equal(shouldResolvePaymentUnlinkedAsNonPaid('failed'), true);
  assert.equal(shouldResolvePaymentUnlinkedAsNonPaid('paid'), false);
  assert.equal(shouldResolvePaymentUnlinkedAsNonPaid('refunded'), false);
});

test('1. payment_intent.payment_failed updates Payment as failed and creates no payment_unlinked', async () => {
  const paymentIntentId = 'pi_test_failed_unlinked_1';
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_failed_unlinked_1',
      type: 'payment_intent.payment_failed',
      paymentIntentId,
      amountCents: 20000,
      amountReceivedCents: 0,
      status: 'requires_payment_method'
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'failed');
  assert.equal(payment.amount, 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 0);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('2. Failed payment with existing open payment_unlinked resolves with deterministic note', async () => {
  const paymentIntentId = 'pi_test_failed_resolve_1';
  const payment = await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'unpaid',
    amount: 0,
    currency: 'eur',
    source: 'webhook'
  });
  await seedOpenPaymentUnlinked({
    paymentId: payment._id,
    paymentIntentId,
    sourceReference: 'evt_seed_false_alert_1'
  });
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }), 1);

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_failed_resolve_1',
      type: 'payment_intent.payment_failed',
      paymentIntentId,
      amountCents: 18000,
      amountReceivedCents: 0,
      status: 'requires_payment_method'
    })
  );

  const openCount = await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' });
  const resolved = await ManualReviewItem.findOne({ category: 'payment_unlinked', status: 'resolved' }).lean();
  assert.equal(openCount, 0);
  assert.ok(resolved);
  assert.equal(resolved.resolution.note, NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('3. Reprocessing the same failed webhook is idempotent', async () => {
  const paymentIntentId = 'pi_test_failed_idem_1';
  const payment = await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'unpaid',
    amount: 0,
    currency: 'eur',
    source: 'webhook'
  });
  await seedOpenPaymentUnlinked({
    paymentId: payment._id,
    paymentIntentId,
    sourceReference: 'evt_seed_false_alert_idem'
  });

  const event = makeStripeEvent({
    id: 'evt_test_failed_idem_1',
    type: 'payment_intent.payment_failed',
    paymentIntentId,
    amountCents: 9900,
    amountReceivedCents: 0
  });

  const first = await processStripeWebhookEvent(event);
  const second = await processStripeWebhookEvent(event);
  assert.equal(first.ok, true);
  assert.equal(first.deduped, false);
  assert.equal(second.ok, true);
  assert.equal(second.deduped, true);

  const reviews = await ManualReviewItem.find({ category: 'payment_unlinked' }).lean();
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].status, 'resolved');
  assert.equal(reviews[0].resolution.note, NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE);

  const again = await resolvePaymentUnlinkedReviewsForNonPaidPayment({
    paymentId: payment._id,
    paymentIntentId
  });
  assert.equal(again.attempted, true);
  assert.equal(again.resolvedCount, 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }), 0);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

async function assertNoUnlinkedForNonPaid({ type, status, paymentIntentId, eventId }) {
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: eventId,
      type,
      paymentIntentId,
      amountCents: 12000,
      amountReceivedCents: 0,
      status
    })
  );
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 0);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
}

test('4. requires_payment_method creates no payment_unlinked', async () => {
  await assertNoUnlinkedForNonPaid({
    type: 'payment_intent.created',
    status: 'requires_payment_method',
    paymentIntentId: 'pi_test_rpm_1',
    eventId: 'evt_test_rpm_1'
  });
  const payment = await Payment.findOne({ providerReference: 'pi_test_rpm_1' }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'unpaid');
});

test('5. requires_action creates no payment_unlinked', async () => {
  await assertNoUnlinkedForNonPaid({
    type: 'payment_intent.requires_action',
    status: 'requires_action',
    paymentIntentId: 'pi_test_ra_1',
    eventId: 'evt_test_ra_1'
  });
});

test('6. processing creates no payment_unlinked', async () => {
  await assertNoUnlinkedForNonPaid({
    type: 'payment_intent.processing',
    status: 'processing',
    paymentIntentId: 'pi_test_proc_1',
    eventId: 'evt_test_proc_1'
  });
});

test('7. canceled status creates no payment_unlinked', async () => {
  await assertNoUnlinkedForNonPaid({
    type: 'payment_intent.canceled',
    status: 'canceled',
    paymentIntentId: 'pi_test_canceled_1',
    eventId: 'evt_test_canceled_1'
  });
  const payment = await Payment.findOne({ providerReference: 'pi_test_canceled_1' }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'failed');
});

test('8. Unknown or missing status creates no payment_unlinked', async () => {
  const result = await processStripeWebhookEvent({
    id: 'evt_test_unknown_status_1',
    type: 'payment_intent.amount_capturable_updated',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        object: 'payment_intent',
        id: 'pi_test_unknown_status_1',
        amount: 5000,
        amount_received: 0,
        currency: 'eur',
        status: 'unknown_weird_status',
        metadata: {}
      }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(await Payment.countDocuments({ providerReference: 'pi_test_unknown_status_1' }), 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 0);
  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
});

test('9. succeeded unlinked accommodation payment creates payment_unlinked', async () => {
  const paymentIntentId = 'pi_test_succeeded_unlinked_1';
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_succeeded_unlinked_1',
      type: 'payment_intent.succeeded',
      paymentIntentId,
      amountCents: 25000,
      amountReceivedCents: 25000,
      status: 'succeeded',
      metadata: { checkoutId: 'chk_test_succeeded_unlinked_1' }
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'paid');
  assert.equal(payment.reservationId, null);

  const review = await ManualReviewItem.findOne({ category: 'payment_unlinked', status: 'open' }).lean();
  assert.ok(review);
  assert.equal(review.evidence.paymentIntentId, paymentIntentId);
  assert.equal(review.evidence.checkoutId, 'chk_test_succeeded_unlinked_1');
});

test('9b. succeeded after resolved still reopens payment_unlinked when still unlinked', async () => {
  const paymentIntentId = 'pi_test_reopen_unlinked_1';
  const payment = await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 110,
    currency: 'eur',
    source: 'webhook'
  });
  await ManualReviewItem.create({
    category: 'payment_unlinked',
    severity: 'high',
    status: 'resolved',
    entityType: 'Payment',
    entityId: String(payment._id),
    title: 'previously resolved',
    details: 'x',
    provenance: { source: 'stripe_webhook', sourceReference: 'evt_old' },
    evidence: { providerReference: paymentIntentId, paymentIntentId },
    resolution: {
      resolvedAt: new Date(),
      resolvedBy: 'test',
      note: NON_PAID_PAYMENT_UNLINKED_RESOLUTION_NOTE
    }
  });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_reopen_unlinked_1',
      type: 'payment_intent.succeeded',
      paymentIntentId,
      amountCents: 11000,
      amountReceivedCents: 11000,
      status: 'succeeded'
    })
  );

  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked', status: 'open' }), 1);
});

test('10. Paid payment already linked to a Booking creates no alert', async () => {
  const paymentIntentId = 'pi_test_linked_paid_1';
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 180 });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_linked_paid_1',
      type: 'payment_intent.succeeded',
      paymentIntentId,
      amountCents: 18000,
      amountReceivedCents: 18000,
      status: 'succeeded'
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 0);
});

test('11-15. Failed/unpaid creates no Booking, finalization job, PaymentIntent, charge, or refund', async () => {
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_side_effects_failed_1',
      type: 'payment_intent.payment_failed',
      paymentIntentId: 'pi_test_side_effects_failed_1',
      amountCents: 77700,
      amountReceivedCents: 0,
      status: 'requires_payment_method'
    })
  );
  await processStripeWebhookEvent(
    makeStripeEvent({
      id: 'evt_test_side_effects_unpaid_1',
      type: 'payment_intent.created',
      paymentIntentId: 'pi_test_side_effects_unpaid_1',
      amountCents: 88800,
      amountReceivedCents: 0,
      status: 'requires_payment_method'
    })
  );

  assert.equal(await Booking.countDocuments({}), 0);
  assert.equal(await CheckoutFinalizationJob.countDocuments({}), 0);
  assert.equal(stripeCreateCalls.length, 0);
  assert.equal(stripeChargeCalls.length, 0);
  assert.equal(stripeRefundCalls.length, 0);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_unlinked' }), 0);
});
