/**
 * CheckoutSession model + Booking stripePaymentIntentId index declarations (C2A).
 *
 * Run: cd server && node --test scripts/checkoutSession.model.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const CheckoutSession = require('../models/CheckoutSession');
const Booking = require('../models/Booking');
const { runAudit } = require('./auditBookingStripePaymentIntentUniqueness.cjs');

let mongoServer;

function findIndex(schema, keyShape) {
  const keyJson = JSON.stringify(keyShape);
  return schema.indexes().find(([keys]) => JSON.stringify(keys) === keyJson);
}

function indexOptions(schema, keyShape) {
  const entry = findIndex(schema, keyShape);
  return entry ? entry[1] : null;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await CheckoutSession.syncIndexes();
  await Booking.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

function buildMinimalBooking(overrides = {}) {
  const checkIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  return {
    cabinId: new mongoose.Types.ObjectId(),
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    totalPrice: 100,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: 'guest@example.com',
      phone: '+359800000000'
    },
    ...overrides
  };
}

test.beforeEach(async () => {
  await Promise.all([CheckoutSession.deleteMany({}), Booking.deleteMany({})]);
});

test('CheckoutSession model imports cleanly', () => {
  assert.equal(CheckoutSession.modelName, 'CheckoutSession');
  assert.ok(Array.isArray(CheckoutSession.CHECKOUT_SESSION_STATUSES));
  assert.ok(CheckoutSession.CHECKOUT_SESSION_STATUSES.includes('voucher_only_reserved'));
  assert.ok(CheckoutSession.CHECKOUT_SESSION_STATUSES.includes('payment_not_required'));
});

test('checkoutId is required', async () => {
  const doc = new CheckoutSession({});
  const err = doc.validateSync();
  assert.ok(err?.errors?.checkoutId);
});

test('defaults: flowVersion v2, status draft, paymentStatus unpaid, finalizeStatus open', async () => {
  const doc = await CheckoutSession.create({ checkoutId: 'chk-defaults-001' });
  assert.equal(doc.flowVersion, 'v2');
  assert.equal(doc.status, 'draft');
  assert.equal(doc.paymentStatus, 'unpaid');
  assert.equal(doc.finalizeStatus, 'open');
  assert.equal(doc.sessionVersion, 1);
});

test('full voucher reserved state: voucher_only_reserved + not_required, no canonical PI', async () => {
  const doc = await CheckoutSession.create({
    checkoutId: 'chk-voucher-only-001',
    status: 'voucher_only_reserved',
    paymentStatus: 'not_required',
    stripeAmountCents: 0,
    giftVoucherAppliedCents: 25000,
    canonicalPaymentIntentId: null
  });
  assert.equal(doc.status, 'voucher_only_reserved');
  assert.equal(doc.paymentStatus, 'not_required');
  assert.equal(doc.stripeAmountCents, 0);
  assert.equal(doc.canonicalPaymentIntentId, null);
});

test('payment_not_required state: not_required payment, no canonical PI', async () => {
  const doc = await CheckoutSession.create({
    checkoutId: 'chk-payment-not-required-001',
    status: 'payment_not_required',
    paymentStatus: 'not_required',
    stripeAmountCents: 0,
    giftVoucherAppliedCents: 0,
    canonicalPaymentIntentId: null
  });
  assert.equal(doc.status, 'payment_not_required');
  assert.equal(doc.paymentStatus, 'not_required');
  assert.equal(doc.stripeAmountCents, 0);
  assert.equal(doc.canonicalPaymentIntentId, null);
});

test('guestEmail is stored lowercase', async () => {
  const doc = await CheckoutSession.create({
    checkoutId: 'chk-email-001',
    guestEmail: 'Guest@Example.COM'
  });
  assert.equal(doc.guestEmail, 'guest@example.com');
});

test('checkoutId unique index is declared', () => {
  const opts = indexOptions(CheckoutSession.schema, { checkoutId: 1 });
  assert.equal(opts?.unique, true);
});

test('canonicalPaymentIntentId partial unique index is declared', () => {
  const opts = indexOptions(CheckoutSession.schema, { canonicalPaymentIntentId: 1 });
  assert.equal(opts?.unique, true);
  assert.deepEqual(opts?.partialFilterExpression, {
    canonicalPaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
  });
});

test('expiresAt uses a normal index, not TTL', () => {
  const indexes = CheckoutSession.schema.indexes();
  const expiresEntry = indexes.find(([keys]) => JSON.stringify(keys) === JSON.stringify({ expiresAt: 1 }));
  assert.ok(expiresEntry, 'expected expiresAt index');
  assert.notEqual(expiresEntry[1]?.expireAfterSeconds, 0);
  assert.equal(expiresEntry[1]?.expireAfterSeconds, undefined);
});

test('stayFingerprint + finalizeStatus compound index is declared', () => {
  assert.ok(findIndex(CheckoutSession.schema, { stayFingerprint: 1, finalizeStatus: 1 }));
});

test('guestEmail + createdAt compound index is declared', () => {
  assert.ok(findIndex(CheckoutSession.schema, { guestEmail: 1, createdAt: -1 }));
});

test('status + updatedAt compound index is declared', () => {
  assert.ok(findIndex(CheckoutSession.schema, { status: 1, updatedAt: -1 }));
});

test('checkoutId duplicate key is rejected', async () => {
  await CheckoutSession.create({ checkoutId: 'chk-dup-001' });
  await assert.rejects(
    () => CheckoutSession.create({ checkoutId: 'chk-dup-001' }),
    (err) => err && (err.code === 11000 || /E11000/.test(String(err.message)))
  );
});

test('Booking stripePaymentIntentId unique partial index is declared', () => {
  const opts = indexOptions(Booking.schema, { stripePaymentIntentId: 1 });
  assert.equal(opts?.unique, true);
  assert.deepEqual(opts?.partialFilterExpression, {
    stripePaymentIntentId: { $exists: true, $type: 'string', $gt: '' }
  });
});

test('Booking checkoutId unique partial index still exists', () => {
  const opts = indexOptions(Booking.schema, { checkoutId: 1 });
  assert.equal(opts?.unique, true);
  assert.deepEqual(opts?.partialFilterExpression, { checkoutId: { $type: 'string' } });
});

test('audit script exports runAudit without mutating when no duplicates', async () => {
  await Booking.create(
    buildMinimalBooking({
      guestInfo: {
        firstName: 'A',
        lastName: 'B',
        email: 'audit-a@example.com',
        phone: '+359800000001'
      },
      stripePaymentIntentId: 'pi_audit_unique_a'
    })
  );

  const summary = await runAudit();
  assert.equal(summary.readOnly, true);
  assert.equal(summary.duplicatePaymentIntentCount, 0);
  assert.deepEqual(summary.duplicates, []);
});

test('audit script reports duplicates without mutating data', async () => {
  const sharedPi = 'pi_audit_duplicate_shared';
  const now = new Date();
  const checkIn = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 17 * 24 * 60 * 60 * 1000);

  await Booking.collection.dropIndexes();
  await Booking.collection.insertMany([
    {
      ...buildMinimalBooking({
        guestInfo: {
          firstName: 'Dup',
          lastName: 'A',
          email: 'dup-a@example.com',
          phone: '+359800000002'
        },
        stripePaymentIntentId: sharedPi
      }),
      createdAt: now,
      updatedAt: now
    },
    {
      ...buildMinimalBooking({
        guestInfo: {
          firstName: 'Dup',
          lastName: 'B',
          email: 'dup-b@example.com',
          phone: '+359800000003'
        },
        stripePaymentIntentId: sharedPi
      }),
      createdAt: now,
      updatedAt: now
    }
  ]);

  const summary = await runAudit();
  assert.equal(summary.duplicatePaymentIntentCount, 1);
  assert.equal(summary.duplicates[0].stripePaymentIntentId, sharedPi);
  assert.equal(summary.duplicates[0].count, 2);

  await Booking.deleteMany({});
  await Booking.syncIndexes();
});
