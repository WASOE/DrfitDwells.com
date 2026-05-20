/**
 * C3-E3-A POST /api/bookings V2 finalize orchestration wiring.
 *
 * Run: node --test server/scripts/bookingCreateV2Finalize.test.cjs
 */
'use strict';

const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const GiftVoucher = require('../models/GiftVoucher');
const PromoCode = require('../models/PromoCode');
const bookingRoutes = require('../routes/bookingRoutes');
const bookingQuoteService = require('../services/bookingQuoteService');
const bookingLifecycleEmailService = require('../services/bookingLifecycleEmailService');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { formatSofiaDateOnly } = require('../utils/dateTime');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const { CHECKOUT_SESSION_ERROR_CODES } = require('../services/checkout/checkoutSessionErrors');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');
const {
  reserveVoucherForCheckout
} = require('../services/bookings/bookingVoucherRedemptionService');

let mongoServer;
let app;
let savedCheckoutSessionV2;

const GUEST_EMAIL = 'v2-finalize-guest@example.com';

function buildApp() {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.use(express.json());
  instance.use('/api/bookings', bookingRoutes);
  return instance;
}

function nextDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function buildLegalAcceptance() {
  return {
    acceptedTermsAndCancellation: true,
    acceptedActivityRisk: true,
    termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
    activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
    checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
    checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
  };
}

function buildGuestInfo(overrides = {}) {
  return {
    firstName: 'V2',
    lastName: 'Guest',
    email: GUEST_EMAIL,
    phone: '+359811111111',
    ...overrides
  };
}

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: 'V2 Finalize Cabin',
    description: 'Test cabin',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

function buildStayFingerprintForCabin({ cabinId, checkIn, checkOut, guestEmail = GUEST_EMAIL }) {
  return buildStayFingerprint({
    guestEmail,
    entityType: 'cabin',
    cabinId: String(cabinId),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
}

async function seedV2FinalizeSession({
  checkoutId,
  cabinId,
  checkIn,
  checkOut,
  guestEmail = GUEST_EMAIL,
  canonicalPaymentIntentId = 'pi_v2_finalize_card',
  status = 'payment_required',
  stripeAmountCents = 36000,
  giftVoucherAppliedCents = 0,
  overrides = {}
}) {
  const stayFingerprint = buildStayFingerprintForCabin({
    cabinId,
    checkIn,
    checkOut,
    guestEmail
  });
  const noPayment = status === 'voucher_only_reserved' || status === 'payment_not_required';
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status,
    paymentStatus: noPayment ? 'not_required' : 'unpaid',
    stayFingerprint,
    replayFingerprint: `replay_${checkoutId}`,
    quoteSnapshotHash: `hash_${checkoutId}`,
    stripeAmountCents,
    giftVoucherAppliedCents,
    sessionVersion: 1,
    canonicalPaymentIntentId: noPayment ? null : canonicalPaymentIntentId,
    quoteSnapshot: {
      fullVoucherCoverage: status === 'voucher_only_reserved',
      stripeAmountCents,
      voucherAppliedCents: giftVoucherAppliedCents
    },
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides
  });
}

function normalizeStayDates(checkIn, checkOut) {
  const { startDate, endDate } = normalizeGuestStayRange(checkIn.toISOString(), checkOut.toISOString());
  return { checkInDate: startDate, checkOutDate: endDate };
}

function buildStripeRetrieveMock({ cabin, checkInDate, checkOutDate, quote, checkoutId, paymentIntentId, amountCents }) {
  return {
    paymentIntents: {
      retrieve: async (id) => {
        if (id !== paymentIntentId) {
          throw new Error(`unexpected payment intent ${id}`);
        }
        return {
          id: paymentIntentId,
          status: 'succeeded',
          amount: amountCents,
          currency: 'eur',
          metadata: {
            cabinId: String(cabin._id),
            checkIn: checkInDate.toISOString(),
            checkOut: checkOutDate.toISOString(),
            subtotalCents: String(Math.round(quote.subtotalPrice * 100)),
            discountAmountCents: String(Math.round((quote.discountAmount || 0) * 100)),
            finalTotalCents: String(Math.round(quote.totalPrice * 100)),
            promoCode: quote.appliedPromoCode || '',
            checkoutId: checkoutId || ''
          }
        };
      },
      update: async () => ({ ok: true })
    }
  };
}

async function buildQuote(cabin, checkIn, checkOut, extras = {}) {
  return bookingQuoteService.buildPublicBookingQuote({
    cabinId: String(cabin._id),
    checkIn: checkIn.toISOString(),
    checkOut: checkOut.toISOString(),
    adults: 2,
    children: 0,
    ...extras
  });
}

function buildBookingPostBody({ cabin, checkIn, checkOut, overrides = {} }) {
  return {
    cabinId: String(cabin._id),
    checkIn: checkIn.toISOString(),
    checkOut: checkOut.toISOString(),
    adults: 2,
    children: 0,
    guestInfo: buildGuestInfo(),
    legalAcceptance: buildLegalAcceptance(),
    ...overrides
  };
}

function postBooking(body, ipSuffix = 1) {
  return request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', `10.88.1.${ipSuffix}`)
    .send(body);
}

function setCheckoutSessionV2Flag(value) {
  if (value === undefined || value === null) {
    delete process.env.CHECKOUT_SESSION_V2;
  } else {
    process.env.CHECKOUT_SESSION_V2 = value;
  }
}

test.before(async () => {
  savedCheckoutSessionV2 = process.env.CHECKOUT_SESSION_V2;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    Cabin.syncIndexes(),
    Booking.syncIndexes(),
    CheckoutSession.syncIndexes(),
    GiftVoucher.syncIndexes(),
    PromoCode.syncIndexes()
  ]);
  app = buildApp();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    Cabin.deleteMany({}),
    GiftVoucher.deleteMany({}),
    PromoCode.deleteMany({})
  ]);
  setCheckoutSessionV2Flag('1');
  bookingRoutes.__resetStripeClientForTesting();
  bookingRoutes.__resetClaimBookingConfirmationSideEffectsForTesting();
});

test.afterEach(() => {
  bookingRoutes.__resetStripeClientForTesting();
  bookingRoutes.__resetClaimBookingConfirmationSideEffectsForTesting();
});

test.after(async () => {
  setCheckoutSessionV2Flag(savedCheckoutSessionV2);
  bookingRoutes.__resetStripeClientForTesting();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('V2 card finalize creates one Booking and marks session finalized', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(10);
  const checkOut = nextDate(12);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_card_finalize_01';
  const paymentIntentId = 'pi_v2_finalize_card';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    11
  );

  assert.equal(res.status, 201);
  assert.equal(res.body.success, true);
  assert.equal(res.body.idempotentReplay, false);

  const bookings = await Booking.find({ checkoutId });
  assert.equal(bookings.length, 1);
  assert.ok(bookings[0].commercialStayFingerprint);
  assert.ok(bookings[0].checkoutSessionId);

  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  assert.equal(session.finalizeStatus, 'finalized');
  assert.equal(String(session.bookingId), String(bookings[0]._id));
  assert.ok(bookings[0].confirmationEmailSentAt);
  assert.ok(session.confirmationEmailSentAt);
});

test('retry same checkoutId returns 200 replay with one Booking', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(14);
  const checkOut = nextDate(16);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_replay_01';
  const paymentIntentId = 'pi_v2_replay_card';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  const body = buildBookingPostBody({
    cabin,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    overrides: { checkoutId, paymentIntentId }
  });

  const first = await postBooking(body, 21);
  assert.equal(first.status, 201);

  const second = await postBooking(body, 22);
  assert.equal(
    second.status,
    200,
    `expected replay 200, got ${second.status}: ${JSON.stringify(second.body)}`
  );
  assert.equal(second.body.idempotentReplay, true);
  assert.equal(await Booking.countDocuments({ checkoutId }), 1);
});

test('orphan booking with open session returns 200 worker replay without lifecycle email', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(18);
  const checkOut = nextDate(20);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_orphan_worker_replay';
  const paymentIntentId = 'pi_v2_orphan_worker_replay';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);
  const stayFingerprint = buildStayFingerprintForCabin({
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate
  });

  const session = await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents,
    overrides: {
      finalizeStatus: 'open',
      bookingId: null,
      finalizedAt: null
    }
  });

  await Booking.create({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    adults: 2,
    children: 0,
    totalPrice: quote.totalPrice,
    status: 'confirmed',
    commercialStayFingerprint: stayFingerprint,
    stripePaymentIntentId: paymentIntentId,
    guestInfo: buildGuestInfo(),
    legalAcceptance: {
      ...buildLegalAcceptance(),
      acceptedAt: new Date(),
      firstName: 'V2',
      lastName: 'Guest'
    }
  });

  assert.equal(session.finalizeStatus, 'open');

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  let claimCalls = 0;
  bookingRoutes.__setClaimBookingConfirmationSideEffectsForTesting(async () => {
    claimCalls += 1;
    return { claimed: true, claimedAt: new Date() };
  });
  const sendLifecycleEmail = mock.method(
    bookingLifecycleEmailService,
    'sendBookingLifecycleEmail',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );
  const sendInternal = mock.method(
    bookingLifecycleEmailService,
    'sendInternalNewBookingNotification',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    31
  );

  assert.equal(
    res.status,
    200,
    `expected worker replay 200, got ${res.status}: ${JSON.stringify(res.body)}`
  );
  assert.equal(res.body.idempotentReplay, true);
  assert.equal(await Booking.countDocuments({ checkoutId }), 1);

  const reloadedSession = await CheckoutSession.findOne({ checkoutId }).lean();
  assert.equal(reloadedSession.finalizeStatus, 'finalized');
  assert.ok(reloadedSession.bookingId);

  assert.equal(claimCalls, 0);
  assert.equal(sendLifecycleEmail.mock.calls.length, 0);
  assert.equal(sendInternal.mock.calls.length, 0);

  sendLifecycleEmail.mock.restore();
  sendInternal.mock.restore();
});

test('duplicate stay with different checkoutId returns DUPLICATE_STAY_CONFLICT', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(20);
  const checkOut = nextDate(22);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const stripeAmountCents = Math.round(quote.totalPrice * 100);
  const paymentIntentId1 = 'pi_v2_dup_stay_a';
  const paymentIntentId2 = 'pi_v2_dup_stay_b';
  const checkoutId1 = 'chk_v2_dup_stay_a';
  const checkoutId2 = 'chk_v2_dup_stay_b';

  await seedV2FinalizeSession({
    checkoutId: checkoutId1,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId1,
    stripeAmountCents
  });
  await seedV2FinalizeSession({
    checkoutId: checkoutId2,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId2,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting({
    paymentIntents: {
      retrieve: async (id) => {
        const isFirst = id === paymentIntentId1;
        return {
          id,
          status: 'succeeded',
          amount: stripeAmountCents,
          currency: 'eur',
          metadata: {
            cabinId: String(cabin._id),
            checkIn: checkInDate.toISOString(),
            checkOut: checkOutDate.toISOString(),
            subtotalCents: String(Math.round(quote.subtotalPrice * 100)),
            discountAmountCents: String(Math.round((quote.discountAmount || 0) * 100)),
            finalTotalCents: String(stripeAmountCents),
            promoCode: '',
            checkoutId: isFirst ? checkoutId1 : checkoutId2
          }
        };
      },
      update: async () => ({ ok: true })
    }
  });

  const postBody = buildBookingPostBody({ cabin, checkIn: checkInDate, checkOut: checkOutDate });
  const first = await postBooking(
    { ...postBody, checkoutId: checkoutId1, paymentIntentId: paymentIntentId1 },
    41
  );
  assert.equal(first.status, 201);

  const second = await postBooking(
    { ...postBody, checkoutId: checkoutId2, paymentIntentId: paymentIntentId2 },
    42
  );
  assert.equal(
    second.status,
    409,
    `expected duplicate stay 409, got ${second.status}: ${JSON.stringify(second.body)}`
  );
  const duplicateCode =
    second.body.code || second.body.error?.code || second.body.details?.code || null;
  assert.equal(
    duplicateCode,
    CHECKOUT_SESSION_ERROR_CODES.DUPLICATE_STAY_CONFLICT,
    `expected DUPLICATE_STAY_CONFLICT, body=${JSON.stringify(second.body)}`
  );
  assert.equal(await Booking.countDocuments({}), 1);
});

test('V2 full voucher finalizes without paymentIntentId', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(24);
  const checkOut = nextDate(26);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const totalValueCents = Math.round(quote.totalPrice * 100);
  const checkoutId = 'chk_v2_full_voucher_01';

  const voucher = await GiftVoucher.create({
    code: 'DD-V2FV-0001-ABCD',
    amountOriginalCents: 80000,
    balanceRemainingCents: 80000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(60)
  });

  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId,
    totalValueCents,
    redemptionExpiresAt: nextDate(2)
  });

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    status: 'voucher_only_reserved',
    stripeAmountCents: 0,
    giftVoucherAppliedCents: totalValueCents
  });

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: {
        checkoutId,
        voucherCode: voucher.code,
        voucherRedemptionId: reserved.redemptionId
      }
    }),
    51
  );

  assert.equal(res.status, 201);
  const booking = await Booking.findOne({ checkoutId }).lean();
  assert.ok(booking);
  assert.equal(booking.paymentMethod, 'gift_voucher');
  assert.equal(booking.stripePaymentIntentId, null);
});

test('V2 zero-due promo finalizes without paymentIntentId', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(28);
  const checkOut = nextDate(30);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const promoCode = 'V2ZERO100';
  await PromoCode.create({
    code: promoCode,
    internalName: 'V2 zero due promo',
    discountType: 'percent',
    discountValue: 100,
    isActive: true,
    maxUses: 100,
    usedCount: 0
  });

  const quote = await buildQuote(cabin, checkInDate, checkOutDate, { promoCode });
  assert.equal(quote.ok, true);
  assert.equal(quote.totalPrice, 0);

  const checkoutId = 'chk_v2_zero_promo_01';
  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    status: 'payment_not_required',
    stripeAmountCents: 0,
    giftVoucherAppliedCents: 0
  });

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, promoCode }
    }),
    61
  );

  assert.equal(res.status, 201);
  const booking = await Booking.findOne({ checkoutId }).lean();
  assert.ok(booking);
  assert.equal(booking.stripePaymentIntentId, null);
  assert.equal(booking.promoCode, promoCode);
});

test('legacy flag-off path does not set V2 commercial-stay fields', async () => {
  setCheckoutSessionV2Flag('0');
  const cabin = await createCabin();
  const checkIn = nextDate(32);
  const checkOut = nextDate(34);
  const checkoutId = 'chk_v2_legacy_flag_off';

  let claimCalls = 0;
  bookingRoutes.__setClaimBookingConfirmationSideEffectsForTesting(async () => {
    claimCalls += 1;
    return { claimed: true, claimedAt: new Date() };
  });

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn,
      checkOut,
      overrides: { checkoutId }
    }),
    71
  );

  assert.equal(res.status, 201);
  const booking = await Booking.findOne({ checkoutId }).lean();
  assert.ok(booking);
  assert.equal(booking.commercialStayFingerprint, null);
  assert.equal(booking.checkoutSessionId, null);
  assert.equal(await CheckoutSession.countDocuments({ checkoutId }), 0);
  assert.equal(claimCalls, 0);
});

test('first V2 success sends lifecycle email once and claims side effects', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(35);
  const checkOut = nextDate(37);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_first_claim_01';
  const paymentIntentId = 'pi_v2_first_claim';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  const sendLifecycleEmail = mock.method(
    bookingLifecycleEmailService,
    'sendBookingLifecycleEmail',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );
  const sendInternal = mock.method(
    bookingLifecycleEmailService,
    'sendInternalNewBookingNotification',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    80
  );

  assert.equal(res.status, 201);

  const booking = await Booking.findOne({ checkoutId }).lean();
  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  assert.ok(booking.confirmationEmailSentAt);
  assert.ok(session.confirmationEmailSentAt);
  assert.ok(sendLifecycleEmail.mock.calls.length >= 1);
  assert.ok(sendInternal.mock.calls.length >= 1);

  sendLifecycleEmail.mock.restore();
  sendInternal.mock.restore();
});

test('V2 replay does not call claim helper and sends zero emails', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(36);
  const checkOut = nextDate(38);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_replay_email_01';
  const paymentIntentId = 'pi_v2_replay_email';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  let claimCalls = 0;
  bookingRoutes.__setClaimBookingConfirmationSideEffectsForTesting(async () => {
    claimCalls += 1;
    return { claimed: true, claimedAt: new Date() };
  });
  const sendLifecycleEmail = mock.method(
    bookingLifecycleEmailService,
    'sendBookingLifecycleEmail',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );
  const sendInternal = mock.method(
    bookingLifecycleEmailService,
    'sendInternalNewBookingNotification',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );

  const body = buildBookingPostBody({
    cabin,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    overrides: { checkoutId, paymentIntentId }
  });

  const first = await postBooking(body, 81);
  assert.equal(first.status, 201);
  assert.equal(claimCalls, 1);
  assert.ok(sendLifecycleEmail.mock.calls.length >= 1, 'first finalize should send guest lifecycle email');

  sendLifecycleEmail.mock.resetCalls();
  sendInternal.mock.resetCalls();

  const second = await postBooking(body, 82);
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotentReplay, true);
  assert.equal(claimCalls, 1);
  assert.equal(sendLifecycleEmail.mock.calls.length, 0);
  assert.equal(sendInternal.mock.calls.length, 0);

  sendLifecycleEmail.mock.restore();
  sendInternal.mock.restore();
});

test('V2 success skips side effects when booking confirmation already claimed', async () => {
  const cabin = await createCabin();
  const checkIn = nextDate(39);
  const checkOut = nextDate(41);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);
  const quote = await buildQuote(cabin, checkInDate, checkOutDate);
  const checkoutId = 'chk_v2_already_claimed_01';
  const paymentIntentId = 'pi_v2_already_claimed';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);
  const existingClaimedAt = new Date('2025-06-01T10:00:00.000Z');

  await seedV2FinalizeSession({
    checkoutId,
    cabinId: cabin._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents,
    overrides: { confirmationEmailSentAt: existingClaimedAt }
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabin,
      checkInDate,
      checkOutDate,
      quote,
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  let claimCalls = 0;
  bookingRoutes.__setClaimBookingConfirmationSideEffectsForTesting(async () => {
    claimCalls += 1;
    return { claimed: false, reason: 'already_claimed_or_missing' };
  });
  const sendLifecycleEmail = mock.method(
    bookingLifecycleEmailService,
    'sendBookingLifecycleEmail',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );
  const sendInternal = mock.method(
    bookingLifecycleEmailService,
    'sendInternalNewBookingNotification',
    async () => ({ success: true, sendResult: { method: 'mock' } })
  );

  const res = await postBooking(
    buildBookingPostBody({
      cabin,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    83
  );

  assert.equal(res.status, 201);
  assert.equal(claimCalls, 1);
  assert.equal(sendLifecycleEmail.mock.calls.length, 0);
  assert.equal(sendInternal.mock.calls.length, 0);

  sendLifecycleEmail.mock.restore();
  sendInternal.mock.restore();
});
