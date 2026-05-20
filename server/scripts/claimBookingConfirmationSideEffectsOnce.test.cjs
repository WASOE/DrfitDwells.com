/**
 * C3-F1: claimBookingConfirmationSideEffectsOnce helper (unwired).
 *
 * Run: node --test server/scripts/claimBookingConfirmationSideEffectsOnce.test.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const CheckoutSession = require('../models/CheckoutSession');
const {
  claimBookingConfirmationSideEffectsOnce
} = require('../services/checkout/claimBookingConfirmationSideEffectsOnce');

let mongoServer;

function futureStayDates() {
  const checkIn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 34 * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
}

function buildLegalAcceptance() {
  return {
    termsVersion: '2026-04-19-v2',
    activityRiskVersion: '2026-04-19-v2',
    acceptedAt: new Date(),
    firstName: 'Claim',
    lastName: 'Guest',
    checkbox1TextSnapshot: 'terms',
    checkbox2TextSnapshot: 'risk'
  };
}

async function createBooking(overrides = {}) {
  const { checkIn, checkOut } = futureStayDates();
  return Booking.create({
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 360,
    subtotalPrice: 360,
    status: 'confirmed',
    paymentMethod: 'stripe',
    stripePaymentIntentId: 'pi_claim_test_01',
    commercialStayFingerprint: 'fp_claim_test_stay',
    guestInfo: {
      firstName: 'Claim',
      lastName: 'Guest',
      email: 'claim-guest@example.com',
      phone: '+359800000077'
    },
    legalAcceptance: buildLegalAcceptance(),
    cabinId: new mongoose.Types.ObjectId(),
    ...overrides
  });
}

async function createCheckoutSession(overrides = {}) {
  const checkoutId = overrides.checkoutId || `chk_claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return CheckoutSession.create({
    checkoutId,
    flowVersion: 'v2',
    status: 'paid',
    paymentStatus: 'paid',
    finalizeStatus: 'finalized',
    sessionVersion: 1,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([Booking.syncIndexes(), CheckoutSession.syncIndexes()]);
});

test.beforeEach(async () => {
  await Promise.all([Booking.deleteMany({}), CheckoutSession.deleteMany({})]);
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('claims booking with missing confirmationEmailSentAt', async () => {
  const booking = await createBooking({ confirmationEmailSentAt: null });
  const now = new Date('2026-06-01T12:00:00.000Z');

  const result = await claimBookingConfirmationSideEffectsOnce({
    bookingId: booking._id,
    now
  });

  assert.equal(result.claimed, true);
  assert.equal(result.claimedAt.getTime(), now.getTime());
});

test('sets Booking.confirmationEmailSentAt', async () => {
  const booking = await createBooking();
  const now = new Date('2026-06-02T09:30:00.000Z');

  await claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id, now });

  const reloaded = await Booking.findById(booking._id).lean();
  assert.ok(reloaded.confirmationEmailSentAt);
  assert.equal(reloaded.confirmationEmailSentAt.getTime(), now.getTime());
});

test('sets CheckoutSession.confirmationEmailSentAt when checkoutSessionId provided', async () => {
  const session = await createCheckoutSession();
  const booking = await createBooking();
  const now = new Date('2026-06-03T14:15:00.000Z');

  const result = await claimBookingConfirmationSideEffectsOnce({
    bookingId: booking._id,
    checkoutSessionId: session._id,
    now
  });

  assert.equal(result.claimed, true);

  const reloadedSession = await CheckoutSession.findById(session._id).lean();
  assert.ok(reloadedSession.confirmationEmailSentAt);
  assert.equal(reloadedSession.confirmationEmailSentAt.getTime(), now.getTime());
});

test('does not overwrite existing Booking.confirmationEmailSentAt', async () => {
  const existing = new Date('2026-01-15T08:00:00.000Z');
  const booking = await createBooking({ confirmationEmailSentAt: existing });
  const now = new Date('2026-06-04T10:00:00.000Z');

  const result = await claimBookingConfirmationSideEffectsOnce({
    bookingId: booking._id,
    now
  });

  assert.equal(result.claimed, false);
  assert.equal(result.reason, 'already_claimed_or_missing');

  const reloaded = await Booking.findById(booking._id).lean();
  assert.equal(reloaded.confirmationEmailSentAt.getTime(), existing.getTime());
});

test('returns claimed false when already claimed', async () => {
  const booking = await createBooking();
  const first = await claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id });
  const second = await claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.reason, 'already_claimed_or_missing');
});

test('missing CheckoutSession does not fail if Booking claim succeeds', async () => {
  const booking = await createBooking();
  const missingSessionId = new mongoose.Types.ObjectId();

  const result = await claimBookingConfirmationSideEffectsOnce({
    bookingId: booking._id,
    checkoutSessionId: missingSessionId
  });

  assert.equal(result.claimed, true);
  const reloaded = await Booking.findById(booking._id).lean();
  assert.ok(reloaded.confirmationEmailSentAt);
});

test('concurrent double claim returns one claimed true and one false', async () => {
  const booking = await createBooking();
  const now = new Date('2026-06-05T16:00:00.000Z');

  const [a, b] = await Promise.all([
    claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id, now }),
    claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id, now })
  ]);

  const claimedCount = [a, b].filter((r) => r.claimed === true).length;
  const falseCount = [a, b].filter((r) => r.claimed === false).length;

  assert.equal(claimedCount, 1);
  assert.equal(falseCount, 1);
  assert.equal(
    [a, b].find((r) => r.claimed === false).reason,
    'already_claimed_or_missing'
  );
});

test('does not modify Booking status payment or fingerprint fields', async () => {
  const booking = await createBooking({
    status: 'pending',
    paymentMethod: 'gift_voucher',
    stripePaymentIntentId: 'pi_do_not_touch',
    commercialStayFingerprint: 'fp_preserve_me'
  });

  await claimBookingConfirmationSideEffectsOnce({ bookingId: booking._id });

  const reloaded = await Booking.findById(booking._id).lean();
  assert.equal(reloaded.status, 'pending');
  assert.equal(reloaded.paymentMethod, 'gift_voucher');
  assert.equal(reloaded.stripePaymentIntentId, 'pi_do_not_touch');
  assert.equal(reloaded.commercialStayFingerprint, 'fp_preserve_me');
  assert.ok(reloaded.confirmationEmailSentAt);
});

test('source file imports no email service or lifecycle email', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../services/checkout/claimBookingConfirmationSideEffectsOnce.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /bookingLifecycleEmailService/);
  assert.doesNotMatch(source, /emailService/);
  assert.doesNotMatch(source, /sendBookingLifecycleEmail/);
  assert.doesNotMatch(source, /sendEmail/);
});
