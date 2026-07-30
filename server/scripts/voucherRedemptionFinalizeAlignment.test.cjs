/**
 * Reproduce V2 voucher redemption → booking finalization metadata alignment.
 * Run: cd server && node --test scripts/voucherRedemptionFinalizeAlignment.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const GiftVoucher = require('../models/GiftVoucher');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const CheckoutSession = require('../models/CheckoutSession');
const Booking = require('../models/Booking');
const ManualReviewItem = require('../models/ManualReviewItem');
const bookingRoutes = require('../routes/bookingRoutes');
const {
  LEGAL_ACCEPTANCE_TERMS_VERSION,
  LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
  LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
  LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
} = require('../config/legalAcceptance');

let mongoServer;
let app;
const ORIG = {
  V2: process.env.CHECKOUT_SESSION_V2,
  PERSIST: process.env.FINALIZE_INTENT_PERSIST,
  REQUIRED: process.env.FINALIZE_INTENT_REQUIRED_FOR_PI
};

function setFlags() {
  process.env.CHECKOUT_SESSION_V2 = '1';
  process.env.FINALIZE_INTENT_PERSIST = '1';
  process.env.FINALIZE_INTENT_REQUIRED_FOR_PI = '1';
}

function restoreFlags() {
  for (const [k, e] of [
    ['V2', 'CHECKOUT_SESSION_V2'],
    ['PERSIST', 'FINALIZE_INTENT_PERSIST'],
    ['REQUIRED', 'FINALIZE_INTENT_REQUIRED_FOR_PI']
  ]) {
    if (ORIG[k] === undefined) delete process.env[e];
    else process.env[e] = ORIG[k];
  }
}

function nextDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function makeStripe() {
  const store = new Map();
  let n = 0;
  return {
    paymentIntents: {
      create: async (args) => {
        n += 1;
        const id = `pi_vouch_align_${n}`;
        const pi = {
          id,
          client_secret: `${id}_secret`,
          status: 'requires_payment_method',
          amount: args.amount,
          currency: args.currency || 'eur',
          metadata: { ...(args.metadata || {}) }
        };
        store.set(id, { ...pi });
        return { ...pi, metadata: { ...pi.metadata } };
      },
      retrieve: async (id) => {
        const pi = store.get(String(id));
        if (!pi) {
          const err = new Error('missing');
          err.code = 'resource_missing';
          throw err;
        }
        return { ...pi, metadata: { ...pi.metadata } };
      },
      update: async (id, patch) => {
        const pi = store.get(String(id));
        if (patch?.metadata) pi.metadata = { ...pi.metadata, ...patch.metadata };
        if (patch?.amount != null) pi.amount = patch.amount;
        return { ...pi, metadata: { ...pi.metadata } };
      },
      cancel: async (id) => {
        const pi = store.get(String(id));
        if (pi) pi.status = 'canceled';
        return pi;
      },
      __succeed(id) {
        const pi = store.get(String(id));
        if (pi) pi.status = 'succeeded';
      },
      __store: store
    }
  };
}

test.before(async () => {
  setFlags();
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 15000 });
  await CheckoutSession.syncIndexes();
  await Booking.syncIndexes();
  app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
});

test.after(async () => {
  bookingRoutes.__setStripeClientForTesting(null);
  restoreFlags();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  setFlags();
  await Promise.all([
    Cabin.deleteMany({}),
    GiftVoucher.deleteMany({}),
    GiftVoucherRedemption.deleteMany({}),
    CheckoutSession.deleteMany({}),
    Booking.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

test('V2: PI created without voucher then voucher applied must align or supersede (no false MRI)', async () => {
  const cabin = await Cabin.create({
    name: 'Voucher Late Cabin',
    description: 't',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const voucher = await GiftVoucher.create({
    code: 'DD-ALIGN-LATE-0002',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(60)
  });
  const stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  const checkIn = dateOnly(nextDate(21));
  const checkOut = dateOnly(nextDate(23));
  const checkoutId = 'chk_vouch_align_late_02';
  const guestLegal = {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.late@example.com',
      phone: '+359888000222'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    }
  };

  const first = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.1.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      expectedSessionVersion: 1,
      ...guestLegal
    });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const firstPi = first.body.canonicalPaymentIntentId;
  assert.ok(firstPi);
  assert.equal(Number(first.body.giftVoucherAppliedCents || 0), 0);

  const sessionAfterFirst = await CheckoutSession.findOne({ checkoutId }).lean();
  const second = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.1.2')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      voucherCode: voucher.code,
      expectedSessionVersion: sessionAfterFirst.sessionVersion,
      ...guestLegal
    });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const secondPi = second.body.canonicalPaymentIntentId;
  assert.ok(secondPi);
  assert.notEqual(secondPi, firstPi, 'voucher apply should supersede unpaid PI');
  assert.ok(Number(second.body.giftVoucherAppliedCents || second.body.voucherAppliedCents || 0) > 0);

  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  const redemptionId = String(session.voucherRedemptionId);
  const pi = await stripe.paymentIntents.retrieve(secondPi);
  const probe = {
    firstPi,
    secondPi,
    piAmount: pi.amount,
    meta: pi.metadata,
    sessionStripe: session.stripeAmountCents,
    sessionVoucher: session.giftVoucherAppliedCents,
    redemptionId
  };
  stripe.paymentIntents.__succeed(secondPi);

  const bookRes = await request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', '10.77.1.3')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      paymentIntentId: secondPi,
      checkoutId,
      voucherCode: voucher.code,
      voucherRedemptionId: redemptionId,
      guestInfo: guestLegal.guestInfo,
      legalAcceptance: guestLegal.legalAcceptance
    });

  const reviews = await ManualReviewItem.find({ category: 'payment_finalization_failure' }).lean();
  if (bookRes.status !== 201 && bookRes.status !== 200) {
    assert.fail(JSON.stringify({ bookStatus: bookRes.status, bookBody: bookRes.body, probe, reviews }, null, 2));
  }
  assert.equal(reviews.length, 0, JSON.stringify({ reviews, probe }));
  assert.equal(await Booking.countDocuments({ checkoutId }), 1);
});

test('FORENSIC: booking date ISO vs PI metadata checkIn mismatch classification', async () => {
  // Documents whether date formatting alone opens MRI vs 400.
  const cabin = await Cabin.create({
    name: 'Date Mismatch Cabin',
    description: 't',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  const checkIn = dateOnly(nextDate(30));
  const checkOut = dateOnly(nextDate(32));
  const checkoutId = 'chk_date_mismatch_03';
  const guestLegal = {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.date@example.com',
      phone: '+359888000333'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    }
  };
  const piRes = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.2.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      expectedSessionVersion: 1,
      ...guestLegal
    });
  assert.equal(piRes.status, 200);
  const piId = piRes.body.canonicalPaymentIntentId;
  stripe.paymentIntents.__succeed(piId);

  // Corrupt stored PI metadata (retrieve returns a copy — mutate the store).
  const stored = stripe.paymentIntents.__store.get(piId);
  const corrupted = new Date(stored.metadata.checkIn);
  corrupted.setUTCHours(corrupted.getUTCHours() + 3);
  stored.metadata.checkIn = corrupted.toISOString();

  const bookRes = await request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', '10.77.2.2')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      paymentIntentId: piId,
      checkoutId,
      guestInfo: guestLegal.guestInfo,
      legalAcceptance: guestLegal.legalAcceptance
    });

  assert.equal(bookRes.status, 400);
  assert.match(String(bookRes.body?.message || ''), /dates do not match/i);
  assert.equal(await ManualReviewItem.countDocuments({ category: 'payment_finalization_failure' }), 0);
});

test('V2 partial voucher: create-PI then paid booking must not open metadata mismatch MRI', async () => {
  const cabin = await Cabin.create({
    name: 'Voucher Align Cabin',
    description: 't',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const voucher = await GiftVoucher.create({
    code: 'DD-ALIGN-PARTIAL-0001',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(60)
  });

  const stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);

  const checkIn = dateOnly(nextDate(14));
  const checkOut = dateOnly(nextDate(16));
  const checkoutId = 'chk_vouch_align_partial_01';

  const piRes = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.0.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      voucherCode: voucher.code,
      expectedSessionVersion: 1,
      guestInfo: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.vouch@example.com',
        phone: '+359888000111'
      },
      legalAcceptance: {
        acceptedTermsAndCancellation: true,
        acceptedActivityRisk: true,
        termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
        activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
        checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
        checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
        locale: 'en'
      },
      consents: {
        quoteDeliveryRequested: false,
        bookingReminderConsent: false,
        marketingConsent: false
      }
    });

  assert.equal(piRes.status, 200, JSON.stringify(piRes.body));
  assert.ok(piRes.body.canonicalPaymentIntentId);

  const piId = piRes.body.canonicalPaymentIntentId;
  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  const redemptionId = String(session.voucherRedemptionId);
  stripe.paymentIntents.__succeed(piId);

  const bookRes = await request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', '10.77.0.2')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      paymentIntentId: piId,
      checkoutId,
      voucherCode: voucher.code,
      voucherRedemptionId: redemptionId,
      guestInfo: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada.vouch@example.com',
        phone: '+359888000111'
      },
      legalAcceptance: {
        acceptedTermsAndCancellation: true,
        acceptedActivityRisk: true,
        termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
        activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
        checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
        checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT
      }
    });

  const reviews = await ManualReviewItem.find({ category: 'payment_finalization_failure' }).lean();
  assert.equal(bookRes.status === 200 || bookRes.status === 201, true, JSON.stringify(bookRes.body));
  assert.equal(reviews.length, 0, JSON.stringify(reviews));
  assert.equal(await Booking.countDocuments({ checkoutId }), 1);
});

test('ROOT CAUSE: voucher apply after paid full-amount PI is rejected (no reservation / no second charge)', async () => {
  const cabin = await Cabin.create({
    name: 'Paid Then Voucher Cabin',
    description: 't',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const voucher = await GiftVoucher.create({
    code: 'DD-ALIGN-AFTERPAY-0005',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(60)
  });
  const stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  const checkIn = dateOnly(nextDate(45));
  const checkOut = dateOnly(nextDate(47));
  const checkoutId = 'chk_vouch_after_pay_05';
  const guestLegal = {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.afterpay@example.com',
      phone: '+359888000555'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    }
  };
  const first = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.5.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      expectedSessionVersion: 1,
      ...guestLegal
    });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  stripe.paymentIntents.__succeed(first.body.canonicalPaymentIntentId);
  const sessionAfterPay = await CheckoutSession.findOne({ checkoutId }).lean();
  const withVoucher = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.5.2')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      voucherCode: voucher.code,
      expectedSessionVersion: sessionAfterPay.sessionVersion,
      ...guestLegal
    });
  assert.notEqual(withVoucher.status, 200, JSON.stringify(withVoucher.body));
  assert.match(
    String(withVoucher.body?.error?.code || withVoucher.body?.code || ''),
    /CANONICAL_PAYMENT_INTENT_MISMATCH|CHECKOUT_SESSION/
  );
  const session = await CheckoutSession.findOne({ checkoutId }).lean();
  assert.equal(session.voucherRedemptionId, null);
  assert.equal(await GiftVoucherRedemption.countDocuments({ checkoutId }), 0);
  assert.equal(await ManualReviewItem.countDocuments({}), 0);
});

test('FORENSIC: stale full-amount PI + voucher reservation opens MRI with field diagnosis', async () => {
  const {
    reserveVoucherForCheckout
  } = require('../services/bookings/bookingVoucherRedemptionService');
  const {
    diagnoseVoucherPaymentIntentAlignment
  } = require('../services/checkout/voucherPaymentIntentAlignment');

  const cabin = await Cabin.create({
    name: 'Stale PI Cabin',
    description: 't',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 180,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
  const voucher = await GiftVoucher.create({
    code: 'DD-ALIGN-STALE-0004',
    amountOriginalCents: 25000,
    balanceRemainingCents: 25000,
    currency: 'EUR',
    status: 'active',
    buyerName: 'Buyer',
    buyerEmail: 'buyer@example.com',
    recipientName: 'Recipient',
    recipientEmail: 'recipient@example.com',
    expiresAt: nextDate(60)
  });
  const stripe = makeStripe();
  bookingRoutes.__setStripeClientForTesting(stripe);
  const checkIn = dateOnly(nextDate(40));
  const checkOut = dateOnly(nextDate(42));
  const checkoutId = 'chk_vouch_stale_pi_04';
  const guestLegal = {
    guestInfo: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada.stale@example.com',
      phone: '+359888000444'
    },
    legalAcceptance: {
      acceptedTermsAndCancellation: true,
      acceptedActivityRisk: true,
      termsVersion: LEGAL_ACCEPTANCE_TERMS_VERSION,
      activityRiskVersion: LEGAL_ACCEPTANCE_ACTIVITY_RISK_VERSION,
      checkbox1TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_1_TEXT,
      checkbox2TextSnapshot: LEGAL_ACCEPTANCE_CHECKBOX_2_TEXT,
      locale: 'en'
    },
    consents: {
      quoteDeliveryRequested: false,
      bookingReminderConsent: false,
      marketingConsent: false
    }
  };

  const first = await request(app)
    .post('/api/bookings/create-payment-intent')
    .set('X-Forwarded-For', '10.77.4.1')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      checkoutId,
      expectedSessionVersion: 1,
      ...guestLegal
    });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const stalePi = first.body.canonicalPaymentIntentId;
  stripe.paymentIntents.__succeed(stalePi);

  // Historical race: reservation exists while client finalizes a pre-voucher paid PI.
  const reserved = await reserveVoucherForCheckout({
    voucherCode: voucher.code,
    checkoutId,
    totalValueCents: 36000,
    redemptionExpiresAt: nextDate(1),
    actor: 'guest'
  });
  const redemptionId = String(reserved.redemptionId);

  const bookRes = await request(app)
    .post('/api/bookings')
    .set('X-Forwarded-For', '10.77.4.3')
    .send({
      cabinId: String(cabin._id),
      checkIn,
      checkOut,
      adults: 2,
      children: 0,
      experienceKeys: [],
      paymentIntentId: stalePi,
      checkoutId,
      voucherCode: voucher.code,
      voucherRedemptionId: redemptionId,
      guestInfo: guestLegal.guestInfo,
      legalAcceptance: guestLegal.legalAcceptance
    });

  const reviews = await ManualReviewItem.find({ category: 'payment_finalization_failure' }).lean();
  const stale = stripe.paymentIntents.__store.get(stalePi);
  const alignment = diagnoseVoucherPaymentIntentAlignment({
    paymentIntent: stale,
    checkoutId,
    redemptionId,
    giftVoucherAppliedCents: reserved.voucherAppliedCents,
    stripePaidAmountCents: Math.max(0, 36000 - reserved.voucherAppliedCents)
  });
  const diagnosis = {
    bookStatus: bookRes.status,
    reviewCount: reviews.length,
    primaryMismatchField: alignment.primaryMismatchField,
    mismatchedFields: alignment.mismatchedFields,
    evidenceFailedInvariant: reviews[0]?.evidence?.failedInvariant || null,
    fields: alignment.fields
  };

  assert.equal(bookRes.status, 409, JSON.stringify(diagnosis));
  assert.equal(alignment.aligned, false);
  assert.ok(alignment.mismatchedFields.includes('redemptionId'));
  assert.ok(alignment.mismatchedFields.includes('voucherAppliedCents'));
  assert.ok(alignment.mismatchedFields.includes('stripeAmountCents'));
  assert.equal(
    reviews.some((r) =>
      String(r.details || '').includes(
        'Stripe PaymentIntent metadata or amount does not align with voucher reservation'
      )
    ),
    true,
    JSON.stringify(diagnosis, null, 2)
  );
  assert.equal(reviews[0]?.evidence?.failedInvariant, alignment.primaryMismatchField);
});
