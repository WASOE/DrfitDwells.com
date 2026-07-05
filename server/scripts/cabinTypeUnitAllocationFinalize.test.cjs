/**
 * Regression: cabinType V2 finalize must auto-assign a free unit when another unit is occupied.
 *
 * Run: node --test server/scripts/cabinTypeUnitAllocationFinalize.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CabinType = require('../models/CabinType');
const Unit = require('../models/Unit');
const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const ManualReviewItem = require('../models/ManualReviewItem');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const bookingRoutes = require('../routes/bookingRoutes');
const bookingQuoteService = require('../services/bookingQuoteService');
const { buildStayFingerprint } = require('../services/checkout/checkoutSessionFingerprints');
const { formatSofiaDateOnly } = require('../utils/dateTime');
const { normalizeGuestStayRange } = require('../services/publicAvailabilityService');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

let mongoServer;
let app;
let savedCheckoutSessionV2;

const GUEST_EMAIL = 'aframe-v2-guest@example.com';
const OTHER_GUEST_EMAIL = 'aframe-existing-guest@example.com';

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
    firstName: 'Aframe',
    lastName: 'Guest',
    email: GUEST_EMAIL,
    phone: '+359811111111',
    ...overrides
  };
}

async function createCabinType(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return CabinType.create({
    name: `A-Frame ${suffix}`,
    slug: `a-frame-${suffix}`,
    description: 'Multi-unit A-frame',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 60,
    minNights: 1,
    imageUrl: '/uploads/cabins/aframe.jpg',
    location: 'The Valley',
    isActive: true,
    transportOptions: [],
    ...overrides
  });
}

async function createUnit(cabinTypeId, overrides = {}) {
  return Unit.create({
    cabinTypeId,
    unitNumber: overrides.unitNumber || 'AF-01',
    displayName: overrides.displayName || 'A-Frame 1',
    isActive: true,
    ...overrides
  });
}

function normalizeStayDates(checkIn, checkOut) {
  const { startDate, endDate } = normalizeGuestStayRange(checkIn.toISOString(), checkOut.toISOString());
  return { checkInDate: startDate, checkOutDate: endDate };
}

function buildStayFingerprintForCabinType({ cabinTypeId, checkIn, checkOut, guestEmail = GUEST_EMAIL }) {
  return buildStayFingerprint({
    guestEmail,
    entityType: 'cabinType',
    cabinTypeId: String(cabinTypeId),
    checkInDateOnly: formatSofiaDateOnly(checkIn),
    checkOutDateOnly: formatSofiaDateOnly(checkOut)
  });
}

async function seedV2FinalizeSession({
  checkoutId,
  cabinTypeId,
  checkIn,
  checkOut,
  guestEmail = GUEST_EMAIL,
  canonicalPaymentIntentId = 'pi_cabin_type_finalize',
  stripeAmountCents = 12000,
  overrides = {}
}) {
  const stayFingerprint = buildStayFingerprintForCabinType({
    cabinTypeId,
    checkIn,
    checkOut,
    guestEmail
  });
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'payment_required',
    paymentStatus: 'unpaid',
    stayFingerprint,
    replayFingerprint: `replay_${checkoutId}`,
    quoteSnapshotHash: `hash_${checkoutId}`,
    stripeAmountCents,
    giftVoucherAppliedCents: 0,
    sessionVersion: 1,
    canonicalPaymentIntentId,
    quoteSnapshot: {
      fullVoucherCoverage: false,
      stripeAmountCents,
      voucherAppliedCents: 0
    },
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides
  });
}

function buildStripeRetrieveMock({
  cabinType,
  checkInDate,
  checkOutDate,
  quote,
  checkoutId,
  paymentIntentId,
  amountCents
}) {
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
            entityType: 'cabinType',
            cabinTypeId: String(cabinType._id),
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

async function buildQuote(cabinType, checkIn, checkOut, extras = {}) {
  return bookingQuoteService.buildPublicBookingQuote({
    cabinTypeId: String(cabinType._id),
    checkIn: checkIn.toISOString(),
    checkOut: checkOut.toISOString(),
    adults: 2,
    children: 0,
    ...extras
  });
}

function buildBookingPostBody({ cabinType, checkIn, checkOut, overrides = {} }) {
  return {
    cabinTypeId: String(cabinType._id),
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
    .set('X-Forwarded-For', `10.90.1.${ipSuffix}`)
    .send(body);
}

function setCheckoutSessionV2Flag(value) {
  if (value === undefined || value === null) {
    delete process.env.CHECKOUT_SESSION_V2;
  } else {
    process.env.CHECKOUT_SESSION_V2 = value;
  }
}

async function createOccupyingBooking({ cabinTypeId, unitId, checkInDate, checkOutDate, guestEmail }) {
  return Booking.create({
    cabinTypeId,
    unitId,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Existing',
      lastName: 'Guest',
      email: guestEmail,
      phone: '+359822222222'
    },
    status: 'confirmed',
    totalPrice: 120,
    subtotalPrice: 120,
    discountAmount: 0,
    totalValueCents: 12000,
    legalAcceptance: {
      ...buildLegalAcceptance(),
      acceptedAt: new Date(),
      firstName: 'Existing',
      lastName: 'Guest'
    }
  });
}

test.before(async () => {
  process.env.NODE_ENV = 'test';
  savedCheckoutSessionV2 = process.env.CHECKOUT_SESSION_V2;
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    CabinType.syncIndexes(),
    Unit.syncIndexes(),
    Booking.syncIndexes(),
    CheckoutSession.syncIndexes(),
    ManualReviewItem.syncIndexes(),
    PaymentResolutionIssue.syncIndexes()
  ]);
  app = buildApp();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    CheckoutSession.deleteMany({}),
    CabinType.deleteMany({}),
    Unit.deleteMany({}),
    ManualReviewItem.deleteMany({}),
    PaymentResolutionIssue.deleteMany({})
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

test('V2 cabinType paid finalize assigns free unit when one of two units is occupied', async () => {
  const cabinType = await createCabinType({ slug: 'a-frame' });
  const unit1 = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const unit2 = await createUnit(cabinType._id, { unitNumber: 'AF-02', displayName: 'A-Frame 2' });

  const checkIn = nextDate(10);
  const checkOut = nextDate(12);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);

  await createOccupyingBooking({
    cabinTypeId: cabinType._id,
    unitId: unit1._id,
    checkInDate,
    checkOutDate,
    guestEmail: OTHER_GUEST_EMAIL
  });

  const quote = await buildQuote(cabinType, checkInDate, checkOutDate);
  assert.equal(quote.ok, true);

  const checkoutId = 'chk_cabin_type_one_free_unit';
  const paymentIntentId = 'pi_cabin_type_one_free_unit';
  const stripeAmountCents = Math.round(quote.totalPrice * 100);

  await seedV2FinalizeSession({
    checkoutId,
    cabinTypeId: cabinType._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabinType,
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
      cabinType,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    21
  );

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  const responseUnitId = res.body.data?.booking?.unitId?._id || res.body.data?.booking?.unitId;
  assert.ok(responseUnitId);
  assert.equal(String(responseUnitId), String(unit2._id));

  const bookings = await Booking.find({ stripePaymentIntentId: paymentIntentId });
  assert.equal(bookings.length, 1);
  assert.equal(String(bookings[0].unitId), String(unit2._id));

  const reviewItems = await ManualReviewItem.find({});
  assert.equal(reviewItems.length, 0);
});

test('V2 cabinType paid finalize with all units occupied creates ManualReviewItem and no duplicate booking', async () => {
  const cabinType = await createCabinType({ slug: 'a-frame' });
  const unit1 = await createUnit(cabinType._id, { unitNumber: 'AF-01', displayName: 'A-Frame 1' });
  const unit2 = await createUnit(cabinType._id, { unitNumber: 'AF-02', displayName: 'A-Frame 2' });

  const checkIn = nextDate(15);
  const checkOut = nextDate(17);
  const { checkInDate, checkOutDate } = normalizeStayDates(checkIn, checkOut);

  await createOccupyingBooking({
    cabinTypeId: cabinType._id,
    unitId: unit1._id,
    checkInDate,
    checkOutDate,
    guestEmail: 'guest-a@example.com'
  });
  await createOccupyingBooking({
    cabinTypeId: cabinType._id,
    unitId: unit2._id,
    checkInDate,
    checkOutDate,
    guestEmail: 'guest-b@example.com'
  });

  const quote = await buildQuote(cabinType, checkInDate, checkOutDate);
  assert.equal(quote.ok, false);
  assert.match(String(quote.message || ''), /No units available/i);

  const checkoutId = 'chk_cabin_type_all_occupied';
  const paymentIntentId = 'pi_cabin_type_all_occupied';
  const stripeAmountCents = 12000;

  await seedV2FinalizeSession({
    checkoutId,
    cabinTypeId: cabinType._id,
    checkIn: checkInDate,
    checkOut: checkOutDate,
    canonicalPaymentIntentId: paymentIntentId,
    stripeAmountCents
  });

  bookingRoutes.__setStripeClientForTesting(
    buildStripeRetrieveMock({
      cabinType,
      checkInDate,
      checkOutDate,
      quote: {
        subtotalPrice: 120,
        discountAmount: 0,
        totalPrice: 120,
        appliedPromoCode: null
      },
      checkoutId,
      paymentIntentId,
      amountCents: stripeAmountCents
    })
  );

  const res = await postBooking(
    buildBookingPostBody({
      cabinType,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      overrides: { checkoutId, paymentIntentId }
    }),
    22
  );

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PAYMENT_RECEIVED_BOOKING_NEEDS_REVIEW');
  assert.equal(res.body.requiresManualReview, true);
  assert.equal(res.body.paymentIntentId, paymentIntentId);

  const bookings = await Booking.find({});
  assert.equal(bookings.length, 2);

  const paidBooking = await Booking.findOne({ stripePaymentIntentId: paymentIntentId });
  assert.equal(paidBooking, null);

  const issues = await PaymentResolutionIssue.find({ paymentIntentId });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].status, 'needs_review');
  assert.equal(issues[0].bookingAttempt?.cabinTypeId, String(cabinType._id));

  const reviewItems = await ManualReviewItem.find({ category: 'payment_finalization_failure' });
  assert.equal(reviewItems.length, 1);
  assert.equal(reviewItems[0].entityType, 'PaymentResolutionIssue');
});
