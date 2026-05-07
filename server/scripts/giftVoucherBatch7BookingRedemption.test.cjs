const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const ManualReviewItem = require('../models/ManualReviewItem');
const bookingQuoteService = require('../services/bookingQuoteService');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  reserveVoucherForCheckout,
  validateReservedRedemptionForBooking,
  confirmVoucherReservation,
  releaseVoucherReservation,
  releaseExpiredVoucherReservations
} = require('../services/bookings/bookingVoucherRedemptionService');

let mongoServer;
let app;

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/bookings', bookingRoutes);
  return instance;
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function createCabin() {
  return Cabin.create({
    name: 'Test Cabin',
    description: 'A quiet place',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
}

async function createVoucher(overrides = {}) {
  return GiftVoucher.create({
    code: 'DD-ABCD-EFGH-IJKL',
    amountOriginalCents: 50000,
    balanceRemainingCents: 50000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(30),
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await Booking.syncIndexes();
  await ManualReviewItem.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await mongoose.connection.db.collection('giftvoucherevents').deleteMany({});
  await GiftVoucherRedemption.deleteMany({});
  await GiftVoucher.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await ManualReviewItem.deleteMany({});
  bookingRoutes.__setStripeClientForTesting(null);
});

test('quote voucher preview does not reserve or mutate balance', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher();

  const quote = await bookingQuoteService.buildPublicBookingQuote({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    voucherCode: voucher.code
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.voucherAppliedCents > 0, true);
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(reloaded.balanceRemainingCents, 50000);
  assert.equal(await GiftVoucherRedemption.countDocuments({}), 0);
});

test('voucher applies after promo and computes remaining amount', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 12000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_apply_after_promo_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });
  assert.equal(reserved.voucherAppliedCents, 12000);
  assert.equal(reserved.remainingDueCents, 24000);
});

test('partial voucher reservation computes residual card amount', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_partial_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });
  assert.equal(reserved.fullVoucherCoverage, false);
  assert.equal(reserved.voucherAppliedCents, 25000);
  assert.equal(reserved.remainingDueCents, 11000);
});

test('full voucher reservation path computes full coverage and no stripe due', async () => {
  const voucher = await createVoucher({ amountOriginalCents: 60000, balanceRemainingCents: 60000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_full_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });
  assert.equal(reserved.fullVoucherCoverage, true);
  assert.equal(reserved.voucherAppliedCents, 36000);
  assert.equal(reserved.remainingDueCents, 0);
});

test('booking success confirms redemption', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_confirm_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  const validated = await validateReservedRedemptionForBooking({
    redemptionId: reserved.redemptionId,
    checkoutId: 'chk_batch7_confirm_1',
    totalValueCents: 36000
  });
  assert.equal(validated.status, 'reserved');

  await confirmVoucherReservation({ redemptionId: reserved.redemptionId, actor: 'test' });
  const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
  assert.equal(redemption.status, 'confirmed');
});

test('booking failure releases redemption', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_release_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  await releaseVoucherReservation({
    redemptionId: reserved.redemptionId,
    reason: 'booking_failed',
    actor: 'test',
    note: 'release after booking failure'
  });

  const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
  const reloadedVoucher = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(redemption.status, 'released');
  assert.equal(reloadedVoucher.balanceRemainingCents, 25000);
});

test('duplicate create-payment-intent reservation does not double reserve', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 30000 });
  const first = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_idempotent_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });
  const second = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_idempotent_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  assert.equal(second.idempotentReplay, true);
  assert.equal(second.redemptionId, first.redemptionId);
  assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId: 'chk_batch7_idempotent_1' }), 1);
});

test('same checkoutId with different voucher/amount returns conflict', async () => {
  const voucher = await createVoucher({ code: 'DD-ZZZZ-YYYY-XXXX', balanceRemainingCents: 30000 });
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_conflict_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  await assert.rejects(() => reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_conflict_1',
    totalValueCents: 35000,
    redemptionExpiresAt: nextDate(1)
  }), (err) => err.code === 'CHECKOUT_ID_CONFLICT');
});

test('expired reservation is rejected at final booking validation', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 30000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_expired_1',
    totalValueCents: 36000,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });

  await assert.rejects(
    () =>
      validateReservedRedemptionForBooking({
        redemptionId: reserved.redemptionId,
        checkoutId: 'chk_batch7_expired_1',
        totalValueCents: 36000
      }),
    (err) => err.code === 'REDEMPTION_EXPIRED'
  );
});

test('stale reservation cleanup releases balance', async () => {
  const voucher = await createVoucher({ balanceRemainingCents: 40000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_stale_1',
    totalValueCents: 10000,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const before = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(before.balanceRemainingCents, 30000);

  const summary = await releaseExpiredVoucherReservations({ now: new Date(), limit: 10 });
  assert.equal(summary.released >= 1, true);

  const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
  const after = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(redemption.status, 'released');
  assert.equal(after.balanceRemainingCents, 40000);
});

test('full voucher booking split stores stripePaidAmountCents as 0', async () => {
  const booking = await Booking.create({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: nextDate(3),
    checkOut: nextDate(5),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'A', lastName: 'B', email: 'guest@example.com', phone: '+359111111' },
    totalPrice: 360,
    subtotalPrice: 360,
    discountAmount: 0,
    subtotalCents: 36000,
    discountAmountCents: 0,
    giftVoucherAppliedCents: 36000,
    stripePaidAmountCents: 0,
    totalValueCents: 36000,
    paymentMethod: 'gift_voucher'
  });
  assert.equal(booking.stripePaidAmountCents, 0);
});

test('partial voucher booking split stores correct cents fields', async () => {
  const booking = await Booking.create({
    cabinId: new mongoose.Types.ObjectId(),
    checkIn: nextDate(3),
    checkOut: nextDate(5),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'A', lastName: 'B', email: 'guest2@example.com', phone: '+359222222' },
    totalPrice: 360,
    subtotalPrice: 360,
    discountAmount: 0,
    subtotalCents: 36000,
    discountAmountCents: 0,
    giftVoucherAppliedCents: 25000,
    stripePaidAmountCents: 11000,
    totalValueCents: 36000,
    paymentMethod: 'stripe_plus_gift_voucher'
  });
  assert.equal(booking.giftVoucherAppliedCents, 25000);
  assert.equal(booking.stripePaidAmountCents, 11000);
});

test('no-voucher booking quote flow still works', async () => {
  const cabin = await createCabin();
  const quote = await bookingQuoteService.buildPublicBookingQuote({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0
  });
  assert.equal(quote.ok, true);
  assert.equal(typeof quote.totalPrice, 'number');
  assert.equal(quote.voucherAppliedCents, 0);
});

test('route-level partial voucher creates Stripe PI only for residual', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  let capturedCreatePayload = null;
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => {
        capturedCreatePayload = payload;
        return { id: 'pi_route_partial_1', client_secret: 'cs_route_partial_1' };
      },
      retrieve: async () => ({ id: 'pi_route_partial_1', client_secret: 'cs_route_partial_1' }),
      update: async () => ({ ok: true })
    }
  });

  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_batch7_route_partial_1',
    voucherCode: voucher.code
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.fullVoucherCoverage, false);
  assert.equal(response.body.voucherAppliedCents, 25000);
  assert.equal(response.body.stripeAmountCents, 11000);
  assert.equal(capturedCreatePayload.amount, 11000);
});

test('route-level full voucher creates no Stripe PI and returns full coverage', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ amountOriginalCents: 60000, balanceRemainingCents: 60000 });
  let createCalls = 0;
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        createCalls += 1;
        return { id: 'pi_route_full_1', client_secret: 'cs_route_full_1' };
      },
      retrieve: async () => ({ id: 'pi_route_full_1', client_secret: 'cs_route_full_1' }),
      update: async () => ({ ok: true })
    }
  });

  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_batch7_route_full_1',
    voucherCode: voucher.code
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.fullVoucherCoverage, true);
  assert.equal(response.body.stripeAmountCents, 0);
  assert.equal(createCalls, 0);
});

test('PI creation failure after reserve releases redemption and restores balance', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async () => {
        throw new Error('forced_pi_failure');
      },
      retrieve: async () => ({ id: 'pi_route_fail_1', client_secret: 'cs_route_fail_1' }),
      update: async () => ({ ok: true })
    }
  });

  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    checkoutId: 'chk_batch7_route_fail_1',
    voucherCode: voucher.code
  });

  assert.equal(response.status, 500);
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(reloaded.balanceRemainingCents, 25000);
  const reservedCount = await GiftVoucherRedemption.countDocuments({ checkoutId: 'chk_batch7_route_fail_1', status: 'reserved' });
  assert.equal(reservedCount, 0);
  const releasedCount = await GiftVoucherRedemption.countDocuments({ checkoutId: 'chk_batch7_route_fail_1', status: 'released' });
  assert.equal(releasedCount >= 1, true);
});

test('expired/missing reservation with paid PI opens payment_finalization_failure and returns guest-safe response', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => ({ id: 'pi_route_paid_1', client_secret: 'cs_route_paid_1', amount: payload.amount, metadata: payload.metadata }),
      retrieve: async () => ({
        id: 'pi_route_paid_1',
        status: 'succeeded',
        amount: 11000,
        currency: 'eur',
        metadata: {
          cabinId: String(cabin._id),
          checkIn: '',
          checkOut: '',
          subtotalCents: '36000',
          discountAmountCents: '0',
          finalTotalCents: '36000',
          voucherAppliedCents: '25000',
          checkoutId: 'chk_batch7_route_paid_1',
          redemptionId: String(new mongoose.Types.ObjectId()),
          promoCode: ''
        }
      }),
      update: async () => ({ ok: true })
    }
  });

  const badRedemptionId = String(new mongoose.Types.ObjectId());
  const response = await request(app).post('/api/bookings').send({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    paymentIntentId: 'pi_route_paid_1',
    checkoutId: 'chk_batch7_route_paid_1',
    voucherCode: voucher.code,
    voucherRedemptionId: badRedemptionId,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'paid@example.com', phone: '+359333333' },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  assert.equal(response.status, 409);
  assert.equal(response.body?.code, 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW');
  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).lean();
  assert.ok(review);
  const createdBookings = await Booking.countDocuments({ checkoutId: 'chk_batch7_route_paid_1' });
  assert.equal(createdBookings, 0);
});

test('partial paid booking rejects PI metadata/redemption mismatch and opens manual review', async () => {
  const cabin = await createCabin();
  const voucher = await createVoucher({ balanceRemainingCents: 25000 });
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_batch7_paid_mismatch_1',
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1)
  });

  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async () => ({ id: 'pi_route_mismatch_1', client_secret: 'cs_route_mismatch_1' }),
      retrieve: async () => ({
        id: 'pi_route_mismatch_1',
        status: 'succeeded',
        amount: 11000,
        currency: 'eur',
        metadata: {
          cabinId: String(cabin._id),
          checkIn: '',
          checkOut: '',
          subtotalCents: '36000',
          discountAmountCents: '0',
          finalTotalCents: '36000',
          voucherAppliedCents: '25000',
          checkoutId: 'chk_batch7_paid_mismatch_1',
          redemptionId: String(new mongoose.Types.ObjectId()),
          promoCode: ''
        }
      }),
      update: async () => ({ ok: true })
    }
  });

  const response = await request(app).post('/api/bookings').send({
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    paymentIntentId: 'pi_route_mismatch_1',
    checkoutId: 'chk_batch7_paid_mismatch_1',
    voucherCode: voucher.code,
    voucherRedemptionId: reserved.redemptionId,
    guestInfo: { firstName: 'A', lastName: 'B', email: 'mismatch@example.com', phone: '+359444444' },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
    }
  });

  assert.equal(response.status, 409);
  assert.equal(response.body?.code, 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW');
  const review = await ManualReviewItem.findOne({ category: 'payment_finalization_failure' }).sort({ createdAt: -1 }).lean();
  assert.ok(review);
});
