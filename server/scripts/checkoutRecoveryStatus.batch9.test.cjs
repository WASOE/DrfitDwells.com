/**
 * Batch 9 — Public checkout recovery status endpoint.
 *
 * Run: node --test --test-concurrency=1 server/scripts/checkoutRecoveryStatus.batch9.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CheckoutSession = require('../models/CheckoutSession');
const CheckoutFinalizationJob = require('../models/CheckoutFinalizationJob');
const Payment = require('../models/Payment');
const PaymentResolutionIssue = require('../models/PaymentResolutionIssue');
const { FINALIZE_STATUS } = require('../services/checkout/checkoutFinalizeService');
const { createCheckoutSession } = require('../services/checkout/checkoutSessionService');
const {
  getPublicCheckoutRecoveryStatus,
  PUBLIC_CHECKOUT_RECOVERY_STATUSES
} = require('../services/checkout/checkoutRecoveryStatusService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const featureFlags = require('../utils/featureFlags');

let mongoServer;
let app;

function buildQuote(cabinId, amountCents = 20000) {
  return {
    entityType: 'cabin',
    entity: { _id: cabinId },
    checkInDate: new Date('2030-11-10T12:00:00.000Z'),
    checkOutDate: new Date('2030-11-12T12:00:00.000Z'),
    subtotalPrice: amountCents / 100,
    discountAmount: 0,
    totalPrice: amountCents / 100,
    remainingDueCents: amountCents,
    voucherAppliedCents: 0,
    fullVoucherCoverage: false,
    appliedPromoCode: ''
  };
}

async function createCabin() {
  return Cabin.create({
    name: 'Batch9 Cabin',
    description: 'Test',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: '/uploads/cabins/test.jpg',
    location: 'Bansko',
    isActive: true,
    transportOptions: []
  });
}

async function seedSession({
  cabin,
  paymentStatus = 'unpaid',
  finalizeStatus = 'open',
  bookingId = null
} = {}) {
  const created = await createCheckoutSession({
    input: {
      cabinId: String(cabin._id),
      checkIn: '2030-11-10',
      checkOut: '2030-11-12',
      adults: 2,
      children: 0,
      guestEmail: 'batch9@example.com'
    },
    quote: buildQuote(cabin._id)
  });
  const session = created.session || created;
  const piId = `pi_b9_${String(session.checkoutId).slice(0, 8)}`;
  const updated = await CheckoutSession.findOneAndUpdate(
    { checkoutId: session.checkoutId },
    {
      $set: {
        flowVersion: 'v2',
        canonicalPaymentIntentId: piId,
        stripeAmountCents: 20000,
        paymentStatus,
        finalizeStatus,
        bookingId: bookingId || null,
        paymentSucceededAt: paymentStatus === 'paid' ? new Date() : null
      }
    },
    { new: true }
  );
  return { session: updated, paymentIntentId: piId };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  // Mount only the booking router path we need
  const bookingRoutes = require('../routes/bookingRoutes');
  app = express();
  app.use(express.json());
  app.use('/api/bookings', bookingRoutes);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CheckoutSession.deleteMany({}),
    CheckoutFinalizationJob.deleteMany({}),
    Payment.deleteMany({}),
    PaymentResolutionIssue.deleteMany({})
  ]);
});

test('flag CHECKOUT_RECOVERY_UX defaults off', () => {
  const prev = process.env.CHECKOUT_RECOVERY_UX;
  delete process.env.CHECKOUT_RECOVERY_UX;
  assert.equal(featureFlags.isCheckoutRecoveryUxEnabled(), false);
  if (prev !== undefined) process.env.CHECKOUT_RECOVERY_UX = prev;
});

test('1) Unauthorized / invalid status request is rejected', async () => {
  const res = await request(app).get('/api/bookings/checkout-sessions/bad/status');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('2) A checkout credential cannot access another checkout', async () => {
  const cabin = await createCabin();
  const a = await seedSession({ cabin, paymentStatus: 'paid' });
  const b = await seedSession({ cabin, paymentStatus: 'paid' });
  const bookingB = await Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-11-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-11-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: b.paymentIntentId,
    checkoutId: b.session.checkoutId,
    commercialStayFingerprint: `fp_b9_${b.session.checkoutId}`,
    guestInfo: {
      firstName: 'Other',
      lastName: 'Guest',
      email: 'other-guest@example.com',
      phone: '+359800000099'
    },
    legalAcceptance: {
      termsVersion: '2026-04-19-v2',
      activityRiskVersion: '2026-04-19-v2',
      acceptedAt: new Date(),
      firstName: 'Other',
      lastName: 'Guest',
      checkbox1TextSnapshot: 't',
      checkbox2TextSnapshot: 'r'
    },
    cabinId: cabin._id
  });
  await CheckoutSession.updateOne(
    { checkoutId: b.session.checkoutId },
    { $set: { bookingId: bookingB._id, finalizeStatus: FINALIZE_STATUS.FINALIZED } }
  );

  const resA = await request(app).get(
    `/api/bookings/checkout-sessions/${a.session.checkoutId}/status`
  );
  assert.equal(resA.status, 200);
  assert.equal(resA.body.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.FINALIZING);
  assert.notEqual(resA.body.bookingId, String(bookingB._id));

  const resB = await request(app).get(
    `/api/bookings/checkout-sessions/${b.session.checkoutId}/status`
  );
  assert.equal(resB.body.bookingId, String(bookingB._id));
});

test('3) Paid session without Booking returns finalizing', async () => {
  const cabin = await createCabin();
  const { session } = await seedSession({ cabin, paymentStatus: 'paid' });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.FINALIZING);
  assert.equal(status.paymentReceived, true);
  assert.equal(status.canRetryPayment, false);
  assert.equal(status.bookingId, null);
});

test('4) Booking linked by checkoutId returns confirmed', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  const booking = await Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-11-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-11-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    checkoutId: session.checkoutId,
    commercialStayFingerprint: `fp_b9c_${session.checkoutId}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Nine',
      email: 'batch9@example.com',
      phone: '+359800000091'
    },
    legalAcceptance: {
      termsVersion: '2026-04-19-v2',
      activityRiskVersion: '2026-04-19-v2',
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Nine',
      checkbox1TextSnapshot: 't',
      checkbox2TextSnapshot: 'r'
    },
    cabinId: cabin._id
  });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.CONFIRMED);
  assert.equal(status.bookingId, String(booking._id));
  assert.ok(status.bookingReference);
});

test('5) Booking linked by paymentIntentId returns confirmed', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  const booking = await Booking.create({
    checkIn: normalizeDateToSofiaDayStart('2030-11-10'),
    checkOut: normalizeDateToSofiaDayStart('2030-11-12'),
    adults: 2,
    children: 0,
    totalPrice: 200,
    subtotalPrice: 200,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: paymentIntentId,
    // no checkoutId on booking
    commercialStayFingerprint: `fp_b9p_${session.checkoutId}`,
    guestInfo: {
      firstName: 'Batch',
      lastName: 'Nine',
      email: 'batch9-pi@example.com',
      phone: '+359800000092'
    },
    legalAcceptance: {
      termsVersion: '2026-04-19-v2',
      activityRiskVersion: '2026-04-19-v2',
      acceptedAt: new Date(),
      firstName: 'Batch',
      lastName: 'Nine',
      checkbox1TextSnapshot: 't',
      checkbox2TextSnapshot: 'r'
    },
    cabinId: cabin._id
  });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.CONFIRMED);
  assert.equal(status.bookingId, String(booking._id));
});

test('6) Unknown payment delay returns checking_payment, not payment_failed', async () => {
  const cabin = await createCabin();
  const { session } = await seedSession({ cabin, paymentStatus: 'unpaid' });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.CHECKING_PAYMENT);
  assert.equal(status.canRetryPayment, false);
});

test('7) Permanent safe review state returns needs_review', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({
    cabin,
    paymentStatus: 'paid',
    finalizeStatus: FINALIZE_STATUS.NEEDS_REVIEW
  });
  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 200,
    currency: 'eur',
    source: 'webhook',
    metadata: { checkoutId: session.checkoutId }
  });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.NEEDS_REVIEW);
  assert.equal(status.paymentReceived, true);
  assert.equal(status.canRetryPayment, false);
});

test('8) Definitive failed payment returns payment_failed', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({
    cabin,
    paymentStatus: 'failed'
  });
  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'failed',
    amount: 200,
    currency: 'eur',
    source: 'webhook',
    metadata: { checkoutId: session.checkoutId }
  });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.status, PUBLIC_CHECKOUT_RECOVERY_STATUSES.PAYMENT_FAILED);
  assert.equal(status.canRetryPayment, true);
});

test('9) Succeeded/captured payment can never return canRetryPayment=true', async () => {
  const cabin = await createCabin();
  const { session } = await seedSession({ cabin, paymentStatus: 'paid' });
  const status = await getPublicCheckoutRecoveryStatus(session.checkoutId);
  assert.equal(status.paymentReceived, true);
  assert.equal(status.canRetryPayment, false);
});

test('10) Response contains no PII, client_secret or raw Stripe object', async () => {
  const cabin = await createCabin();
  const { session } = await seedSession({ cabin, paymentStatus: 'paid' });
  const res = await request(app).get(
    `/api/bookings/checkout-sessions/${session.checkoutId}/status`
  );
  const text = JSON.stringify(res.body);
  assert.doesNotMatch(text, /batch9@example\.com/);
  assert.doesNotMatch(text, /client_secret/i);
  assert.doesNotMatch(text, /"charges"/);
  assert.doesNotMatch(text, /guestInfo/);
  assert.equal(res.body.success, true);
});

test('11) Status endpoint performs no Booking creation or payment mutation', async () => {
  const cabin = await createCabin();
  const { session } = await seedSession({ cabin, paymentStatus: 'paid' });
  const beforeBookings = await Booking.countDocuments({});
  const beforeSessions = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  await request(app).get(`/api/bookings/checkout-sessions/${session.checkoutId}/status`);
  assert.equal(await Booking.countDocuments({}), beforeBookings);
  const after = await CheckoutSession.findOne({ checkoutId: session.checkoutId }).lean();
  assert.equal(String(after.paymentStatus), String(beforeSessions.paymentStatus));
  assert.equal(String(after.finalizeStatus), String(beforeSessions.finalizeStatus));

  const src = fs.readFileSync(
    path.join(__dirname, '../services/checkout/checkoutRecoveryStatusService.js'),
    'utf8'
  );
  assert.doesNotMatch(src, /Booking\.create|paymentIntents\.create|refunds\.create/);
});

test('12) Gift-voucher/location flows are not incorrectly treated as accommodation recovery', async () => {
  const cabin = await createCabin();
  const { session, paymentIntentId } = await seedSession({ cabin, paymentStatus: 'paid' });
  await Payment.create({
    provider: 'stripe',
    providerReference: paymentIntentId,
    status: 'paid',
    amount: 50,
    currency: 'eur',
    source: 'webhook',
    metadata: { type: 'gift_voucher', checkoutId: session.checkoutId }
  });
  await assert.rejects(
    () => getPublicCheckoutRecoveryStatus(session.checkoutId),
    (err) => err.code === 'NOT_ACCOMMODATION_CHECKOUT'
  );
});
