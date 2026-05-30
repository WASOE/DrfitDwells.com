const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const ManualReviewItem = require('../models/ManualReviewItem');
const StripeEventEvidence = require('../models/StripeEventEvidence');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const { processStripeWebhookEvent } = require('../services/ops/ingestion/stripeIngestionService');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent
} = require('../services/giftVouchers/giftVoucherPaymentService');

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
      firstName: 'Ingestion',
      lastName: 'Tester',
      email: `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
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
  await GiftVoucher.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
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
  await GiftVoucher.deleteMany({});
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_gv_test', client_secret: 'cs_gv_test' }),
      retrieve: async () => ({ id: 'pi_gv_test', client_secret: 'cs_gv_test' })
    }
  });
});

test('gift voucher payment_intent.succeeded upserts Payment without payment_unlinked review', async () => {
  setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_gv_ingest_1', client_secret: 'cs_gv_ingest_1' }),
      retrieve: async () => ({ id: 'pi_gv_ingest_1', client_secret: 'cs_gv_ingest_1' })
    }
  });

  const created = await createGiftVoucherPaymentIntent({
    amountOriginalCents: 15000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: 'gvr_req_ingest_1'
  });

  const event = makeStripeEvent({
    id: 'evt_gv_ingest_1',
    paymentIntentId: created.stripePaymentIntentId,
    amountCents: 15000,
    metadata: {
      type: 'gift_voucher',
      giftVoucherId: created.giftVoucherId,
      purchaseRequestId: created.purchaseRequestId
    }
  });

  const result = await processStripeWebhookEvent(event);
  assert.equal(result.ok, true);
  assert.equal(result.deduped, false);

  const payment = await Payment.findOne({ providerReference: created.stripePaymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.status, 'paid');
  assert.equal(payment.amount, 150);
  assert.equal(payment.reservationId, null);

  const unlinkedCount = await ManualReviewItem.countDocuments({
    category: 'payment_unlinked',
    status: 'open'
  });
  assert.equal(unlinkedCount, 0);

  const voucher = await GiftVoucher.findById(created.giftVoucherId).lean();
  assert.equal(voucher.status, 'active');
  assert.equal(voucher.stripePaymentIntentId, created.stripePaymentIntentId);
});

test('normal booking payment without reservationId still creates payment_unlinked', async () => {
  const paymentIntentId = `pi_booking_unlinked_${Date.now()}`;

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_booking_unlinked_${Date.now()}`,
      paymentIntentId,
      amountCents: 25000
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(payment.reservationId, null);

  const unlinkedCount = await ManualReviewItem.countDocuments({
    category: 'payment_unlinked',
    status: 'open'
  });
  assert.equal(unlinkedCount, 1);
});

test('booking payment with reservationId metadata does not create payment_unlinked', async () => {
  const paymentIntentId = `pi_booking_resmeta_${Date.now()}`;
  const booking = await createBooking({ stripePaymentIntentId: paymentIntentId, totalPrice: 180 });

  await processStripeWebhookEvent(
    makeStripeEvent({
      id: `evt_booking_resmeta_${Date.now()}`,
      paymentIntentId,
      amountCents: 18000,
      metadata: { reservationId: String(booking._id) }
    })
  );

  const payment = await Payment.findOne({ providerReference: paymentIntentId }).lean();
  assert.ok(payment);
  assert.equal(String(payment.reservationId), String(booking._id));

  const unlinkedCount = await ManualReviewItem.countDocuments({
    category: 'payment_unlinked',
    status: 'open'
  });
  assert.equal(unlinkedCount, 0);
});
