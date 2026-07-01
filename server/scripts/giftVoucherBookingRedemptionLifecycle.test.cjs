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
const bookingQuoteService = require('../services/bookingQuoteService');
const bookingRoutes = require('../routes/bookingRoutes');
const { MIN_GIFT_VOUCHER_AMOUNT_CENTS } = require('../services/giftVouchers/giftVoucherConstants');
const {
  setStripeClientForTesting,
  createGiftVoucherPaymentIntent,
  activatePaidVoucherFromStripeEvent
} = require('../services/giftVouchers/giftVoucherPaymentService');
const {
  previewVoucherApplication,
  reserveVoucherForCheckout,
  confirmVoucherReservation,
  releaseVoucherReservation,
  releaseExpiredVoucherReservations
} = require('../services/bookings/bookingVoucherRedemptionService');

let mongoServer;
let app;
let purchaseCounter = 0;

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

function buildCreatePayload(overrides = {}) {
  purchaseCounter += 1;
  return {
    amountOriginalCents: 5000,
    currency: 'EUR',
    buyerName: 'Buyer One',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient One',
    recipientEmail: 'recipient@example.com',
    message: 'Enjoy your stay',
    deliveryMode: 'email',
    termsAccepted: true,
    termsVersion: 'v1',
    purchaseRequestId: `gvr_lifecycle_${purchaseCounter}_${Date.now()}`,
    ...overrides
  };
}

function buildWebhookEvent({ stripePaymentIntentId, giftVoucherId, purchaseRequestId, amountCents, eventId }) {
  return {
    id: eventId || `evt_${purchaseRequestId}`,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        object: 'payment_intent',
        id: stripePaymentIntentId,
        amount: amountCents,
        amount_received: amountCents,
        currency: 'eur',
        metadata: {
          type: 'gift_voucher',
          giftVoucherId: String(giftVoucherId),
          purchaseRequestId
        }
      }
    }
  };
}

async function createCabin() {
  return Cabin.create({
    name: 'Lifecycle Cabin',
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

async function createPurchasedActiveVoucher(amountOriginalCents) {
  const payload = buildCreatePayload({ amountOriginalCents });
  const created = await createGiftVoucherPaymentIntent(payload);
  await activatePaidVoucherFromStripeEvent(
    buildWebhookEvent({
      stripePaymentIntentId: created.stripePaymentIntentId,
      giftVoucherId: created.giftVoucherId,
      purchaseRequestId: payload.purchaseRequestId,
      amountCents: amountOriginalCents
    })
  );
  return GiftVoucher.findById(created.giftVoucherId).lean();
}

function bookingQuoteBody(cabin, voucher, overrides = {}) {
  return {
    cabinId: String(cabin._id),
    checkIn: nextDate(3).toISOString(),
    checkOut: nextDate(5).toISOString(),
    adults: 2,
    children: 0,
    voucherCode: voucher.code,
    ...overrides
  };
}

const TWO_NIGHT_TOTAL_CENTS = 36000;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await GiftVoucher.syncIndexes();
  await GiftVoucherRedemption.syncIndexes();
  await GiftVoucherEvent.syncIndexes();
  await Cabin.syncIndexes();
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
  await Cabin.deleteMany({});
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => ({
        id: `pi_${payload.metadata?.checkoutId || 'test'}`,
        client_secret: 'cs_test',
        amount: payload.amount
      }),
      retrieve: async (id) => ({ id, client_secret: 'cs_test' }),
      update: async () => ({ ok: true })
    }
  });
  setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => ({ id: `pi_gv_${Date.now()}`, client_secret: 'cs_test' }),
      retrieve: async () => ({ id: 'pi_gv_test', client_secret: 'cs_test' })
    }
  });
});

function buildManualVoucher(overrides = {}) {
  return {
    currency: 'EUR',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    deliveryMode: 'manual',
    expiresAt: nextDate(30),
    ...overrides
  };
}

for (const [label, amountCents, expectedApplied] of [
  ['€15 purchased voucher', 1500, 1500],
  ['€50 purchased voucher', 5000, 5000],
  ['€100 purchased voucher', 10000, 10000],
  ['€250 purchased voucher', 25000, 25000]
]) {
  test(`${label} -> quote applies`, async () => {
    const cabin = await createCabin();
    const voucher = await createPurchasedActiveVoucher(amountCents);
    const quote = await bookingQuoteService.buildPublicBookingQuote(bookingQuoteBody(cabin, voucher));
    assert.equal(quote.ok, true);
    assert.equal(quote.voucherAppliedCents, expectedApplied);
    assert.equal(quote.remainingDueCents, TWO_NIGHT_TOTAL_CENTS - expectedApplied);
    assert.equal(quote.voucherPreviewError, null);
  });
}

test('€50 voucher -> create-payment-intent charges only residual', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  let capturedAmount = null;
  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      create: async (payload) => {
        capturedAmount = payload.amount;
        return { id: 'pi_residual_50', client_secret: 'cs_residual_50' };
      },
      retrieve: async () => ({ id: 'pi_residual_50', client_secret: 'cs_residual_50' }),
      update: async () => ({ ok: true })
    }
  });

  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    ...bookingQuoteBody(cabin, voucher),
    checkoutId: 'chk_lifecycle_residual_50'
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.voucherAppliedCents, 5000);
  assert.equal(response.body.stripeAmountCents, 31000);
  assert.equal(capturedAmount, 31000);
});

test('€50 partially redeemed voucher -> quote applies remaining balance', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  await GiftVoucher.updateOne(
    { _id: voucher._id },
    { $set: { balanceRemainingCents: 3000, status: 'partially_redeemed' } }
  );
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  const quote = await bookingQuoteService.buildPublicBookingQuote(bookingQuoteBody(cabin, reloaded));
  assert.equal(quote.voucherAppliedCents, 3000);
  assert.equal(quote.remainingDueCents, TWO_NIGHT_TOTAL_CENTS - 3000);
});

test('quote/apply does not mutate balance or ledger', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  const before = await GiftVoucher.findById(voucher._id).lean();
  const eventsBefore = await GiftVoucherEvent.countDocuments({ giftVoucherId: voucher._id });

  await bookingQuoteService.buildPublicBookingQuote(bookingQuoteBody(cabin, voucher));

  const after = await GiftVoucher.findById(voucher._id).lean();
  const eventsAfter = await GiftVoucherEvent.countDocuments({ giftVoucherId: voucher._id });
  assert.equal(after.balanceRemainingCents, before.balanceRemainingCents);
  assert.equal(eventsAfter, eventsBefore);
  assert.equal(await GiftVoucherRedemption.countDocuments({ giftVoucherId: voucher._id }), 0);
});

test('create-payment-intent creates one hold', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    ...bookingQuoteBody(cabin, voucher),
    checkoutId: 'chk_lifecycle_one_hold'
  });
  assert.equal(response.status, 200);
  assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId: 'chk_lifecycle_one_hold' }), 1);
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(reloaded.balanceRemainingCents, 0);
});

test('repeated create-payment-intent for same checkout does not double-hold', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  const body = { ...bookingQuoteBody(cabin, voucher), checkoutId: 'chk_lifecycle_idempotent' };
  const first = await request(app).post('/api/bookings/create-payment-intent').send(body);
  const second = await request(app).post('/api/bookings/create-payment-intent').send(body);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.redemptionId, second.body.redemptionId);
  assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId: 'chk_lifecycle_idempotent' }), 1);
});

test('expired hold released before quote', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_stale_quote',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const held = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(held.balanceRemainingCents, 0);

  const preview = await previewVoucherApplication({
    voucherCode: voucher.code,
    totalValueCents: TWO_NIGHT_TOTAL_CENTS
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.voucherAppliedCents, 5000);
  const after = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(after.balanceRemainingCents, 5000);
});

test('expired hold released before new payment-intent reservation', async () => {
  const cabin = await createCabin();
  const voucher = await createPurchasedActiveVoucher(5000);
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_stale_pi',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const held = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(held.balanceRemainingCents, 0);

  const response = await request(app).post('/api/bookings/create-payment-intent').send({
    ...bookingQuoteBody(cabin, voucher),
    checkoutId: 'chk_lifecycle_stale_pi_new'
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.voucherAppliedCents, 5000);
});

test('booking confirmation consumes voucher once', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_confirm_once',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: nextDate(1)
  });
  const before = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(before.balanceRemainingCents, 0);

  await confirmVoucherReservation({ redemptionId: reserved.redemptionId, actor: 'test' });
  const after = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(after.balanceRemainingCents, 0);
  assert.equal(after.status, 'redeemed');
});

test('second confirmation attempt does not consume again', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_confirm_twice',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: nextDate(1)
  });
  const first = await confirmVoucherReservation({ redemptionId: reserved.redemptionId, actor: 'test' });
  const second = await confirmVoucherReservation({ redemptionId: reserved.redemptionId, actor: 'test' });
  assert.equal(first.alreadyConfirmed, false);
  assert.equal(second.alreadyConfirmed, true);
  const confirmedEvents = await GiftVoucherEvent.countDocuments({
    giftVoucherId: voucher._id,
    type: 'redeemed_confirmed'
  });
  assert.equal(confirmedEvents, 1);
});

test('abandoned checkout releases hold and restores balance', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_abandon',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: nextDate(1)
  });
  await releaseVoucherReservation({
    redemptionId: reserved.redemptionId,
    reason: 'booking_failed',
    actor: 'test'
  });
  const redemption = await GiftVoucherRedemption.findById(reserved.redemptionId).lean();
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(redemption.status, 'released');
  assert.equal(reloaded.balanceRemainingCents, 5000);
});

test('invalid/redeemed/expired voucher returns safe guest message on quote', async () => {
  const cabin = await createCabin();
  const cases = [
    { code: 'DD-NOT-FOUND-CODE', internalCode: 'NOT_FOUND' },
    {
      voucher: buildManualVoucher({
        code: 'DD-EXPIRED-VOUCHER',
        amountOriginalCents: 5000,
        balanceRemainingCents: 5000,
        status: 'active',
        expiresAt: new Date(Date.now() - 1000)
      }),
      internalCode: 'EXPIRED'
    },
    {
      voucher: buildManualVoucher({
        code: 'DD-REDEEMED-VOUCHER',
        amountOriginalCents: 5000,
        balanceRemainingCents: 0,
        status: 'redeemed'
      }),
      internalCode: 'NOT_REDEEMABLE_STATUS'
    }
  ];

  for (const item of cases) {
    if (item.voucher) {
      await GiftVoucher.create(item.voucher);
      const quote = await bookingQuoteService.buildPublicBookingQuote(
        bookingQuoteBody(cabin, { code: item.voucher.code })
      );
      assert.equal(quote.voucherPreviewError, 'This voucher cannot be used.');
      const preview = await previewVoucherApplication({
        voucherCode: item.voucher.code,
        totalValueCents: TWO_NIGHT_TOTAL_CENTS
      });
      assert.equal(preview.internalCode, item.internalCode);
    } else {
      const preview = await previewVoucherApplication({
        voucherCode: item.code,
        totalValueCents: TWO_NIGHT_TOTAL_CENTS
      });
      assert.equal(preview.internalCode, item.internalCode);
      assert.equal(preview.publicMessage, 'This voucher cannot be used.');
    }
  }
});

test('reserveVoucherForCheckout throws guest-safe codes for known validation failures', async () => {
  const cases = [
    { voucherCode: 'DD-MISSING-1', code: 'NOT_FOUND' },
    {
      setup: async () =>
        GiftVoucher.create(
          buildManualVoucher({
            code: 'DD-EXPIRED-RESERVE',
            amountOriginalCents: 5000,
            balanceRemainingCents: 5000,
            status: 'active',
            expiresAt: new Date(Date.now() - 1000)
          })
        ),
      voucherCode: 'DD-EXPIRED-RESERVE',
      code: 'EXPIRED'
    },
    {
      setup: async () =>
        GiftVoucher.create(
          buildManualVoucher({
            code: 'DD-NO-BALANCE-RESERVE',
            amountOriginalCents: 5000,
            balanceRemainingCents: 0,
            status: 'partially_redeemed'
          })
        ),
      voucherCode: 'DD-NO-BALANCE-RESERVE',
      code: 'NO_BALANCE'
    }
  ];

  for (const item of cases) {
    if (item.setup) await item.setup();
    await assert.rejects(
      () =>
        reserveVoucherForCheckout({
          voucherCode: item.voucherCode,
          checkoutId: `chk_safe_${item.code}`,
          totalValueCents: TWO_NIGHT_TOTAL_CENTS,
          redemptionExpiresAt: nextDate(1)
        }),
      (err) => err.code === item.code
    );
  }
});

test('concurrent reserve on last balance yields RESERVE_FAILED for loser', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  const results = await Promise.allSettled([
    reserveVoucherForCheckout({
      voucherCode: voucher.code,
      checkoutId: 'chk_lifecycle_concurrent_a',
      totalValueCents: TWO_NIGHT_TOTAL_CENTS,
      redemptionExpiresAt: nextDate(1)
    }),
    reserveVoucherForCheckout({
      voucherCode: voucher.code,
      checkoutId: 'chk_lifecycle_concurrent_b',
      totalValueCents: TWO_NIGHT_TOTAL_CENTS,
      redemptionExpiresAt: nextDate(1)
    })
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, 'RESERVE_FAILED');
});

test('fully held voucher returns NO_BALANCE on second checkout reserve', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_other_checkout',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: nextDate(1)
  });

  await assert.rejects(
    () =>
      reserveVoucherForCheckout({
        voucherCode: voucher.code,
        checkoutId: 'chk_lifecycle_reserve_failed',
        totalValueCents: TWO_NIGHT_TOTAL_CENTS,
        redemptionExpiresAt: nextDate(1)
      }),
    (err) => err.code === 'NO_BALANCE'
  );
});

test('guest-safe voucher failure codes include expected redemption errors', async () => {
  const { isGuestSafeVoucherFailureCode } = require('../services/giftVouchers/giftVoucherConstants');
  for (const code of [
    'NOT_FOUND',
    'NOT_REDEEMABLE_STATUS',
    'EXPIRED',
    'MISSING_EXPIRY',
    'NO_BALANCE',
    'INVALID_VOUCHER_AMOUNT',
    'RESERVE_FAILED'
  ]) {
    assert.equal(isGuestSafeVoucherFailureCode(code), true, code);
  }
});

test('shared minimum constant is 1500 cents everywhere', () => {
  assert.equal(MIN_GIFT_VOUCHER_AMOUNT_CENTS, 1500);
});

test('releaseExpiredVoucherReservations is idempotent on second pass', async () => {
  const voucher = await createPurchasedActiveVoucher(5000);
  await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId: 'chk_lifecycle_release_idempotent',
    totalValueCents: TWO_NIGHT_TOTAL_CENTS,
    redemptionExpiresAt: new Date(Date.now() - 1000)
  });
  const first = await releaseExpiredVoucherReservations({ now: new Date(), limit: 10 });
  const second = await releaseExpiredVoucherReservations({ now: new Date(), limit: 10 });
  assert.equal(first.released >= 1, true);
  assert.equal(second.released, 0);
  assert.equal(second.alreadyReleased >= 0, true);
  const reloaded = await GiftVoucher.findById(voucher._id).lean();
  assert.equal(reloaded.balanceRemainingCents, 5000);
});
