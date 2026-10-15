/**
 * Ops dashboard + reservations list: voucher / stay-credit coverage classification.
 * Run: cd server && node --test scripts/opsVoucherPaymentClassification.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const Payment = require('../models/Payment');
const GiftVoucherRedemption = require('../models/GiftVoucherRedemption');
const StayCreditReservation = require('../models/StayCreditReservation');
require('../models/Unit');
require('../models/CabinType');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const { getReservationsWorkspaceReadModel } = require('../services/ops/readModels/reservationsReadModel');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');

let mongoServer;
let cabin;

function addSofiaDays(days) {
  const d = normalizeDateToSofiaDayStart(new Date());
  d.setUTCDate(d.getUTCDate() + days);
  return normalizeDateToSofiaDayStart(d);
}

async function insertBooking(fields) {
  const _id = fields._id || new mongoose.Types.ObjectId();
  const now = new Date();
  await Booking.collection.insertOne({
    _id,
    cabinId: cabin._id,
    checkIn: addSofiaDays(3),
    checkOut: addSofiaDays(5),
    adults: 2,
    children: 0,
    status: 'confirmed',
    isTest: false,
    guestInfo: { firstName: 'Voucher', lastName: 'Guest', email: `guest-${_id}@example.org`, phone: '+359123456789' },
    totalPrice: 110,
    totalValueCents: 11000,
    stripePaidAmountCents: 0,
    stripePaymentIntentId: null,
    giftVoucherAppliedCents: 0,
    giftVoucherRedemptionId: null,
    stayCreditAppliedCents: 0,
    provenance: { source: 'guest_portal' },
    createdAt: now,
    updatedAt: now,
    ...fields
  });
  return _id;
}

async function insertRedemption(fields) {
  const _id = fields._id || new mongoose.Types.ObjectId();
  await GiftVoucherRedemption.collection.insertOne({
    _id,
    giftVoucherId: new mongoose.Types.ObjectId(),
    bookingId: null,
    reservationId: null,
    status: 'confirmed',
    createdAt: new Date(),
    ...fields
  });
  return _id;
}

function findAlerts(result) {
  if (Array.isArray(result.alerts)) return result.alerts;
  if (Array.isArray(result.dashboard?.alerts)) return result.dashboard.alerts;
  const found = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (Array.isArray(node.alerts)) found.push(...node.alerts);
    for (const v of Object.values(node)) if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
  })(result);
  return found;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    Payment.deleteMany({}),
    GiftVoucherRedemption.collection.deleteMany({}),
    StayCreditReservation.collection.deleteMany({})
  ]);
  cabin = await Cabin.create({
    name: 'Voucher Classification Cabin',
    description: 'test',
    capacity: 2,
    pricePerNight: 55,
    minNights: 1,
    imageUrl: 'https://example.com/c.jpg',
    location: 'Bulgaria',
    geoLocation: { latitude: 42.6977, longitude: 23.3219 }
  });
});

async function seedScenario() {
  const ids = {};
  // Mirrors production booking 6ab97bb39da21ab9cc0040de (legacy redemption without back-link).
  ids.fullVoucherRedemption = await insertRedemption({
    _id: new mongoose.Types.ObjectId('6ab97bb19da21ab9cc0040af'),
    checkoutId: 'c0a0e935-54d8-417b-9ddb-10e75b936acc',
    amountAppliedCents: 11000
  });
  ids.fullVoucher = await insertBooking({
    _id: new mongoose.Types.ObjectId('6ab97bb39da21ab9cc0040de'),
    checkoutId: 'c0a0e935-54d8-417b-9ddb-10e75b936acc',
    giftVoucherAppliedCents: 11000,
    giftVoucherRedemptionId: ids.fullVoucherRedemption,
    paymentMethod: 'gift_voucher',
    paymentSettlementStatus: 'not_required'
  });

  ids.partialVoucherRedemption = await insertRedemption({ checkoutId: 'co-partial', amountAppliedCents: 5000 });
  ids.partialVoucher = await insertBooking({
    checkoutId: 'co-partial',
    giftVoucherAppliedCents: 5000,
    giftVoucherRedemptionId: ids.partialVoucherRedemption,
    paymentMethod: 'gift_voucher'
  });

  ids.releasedRedemption = await insertRedemption({ checkoutId: 'co-released', amountAppliedCents: 11000, status: 'released' });
  ids.releasedVoucher = await insertBooking({
    checkoutId: 'co-released',
    giftVoucherAppliedCents: 11000,
    giftVoucherRedemptionId: ids.releasedRedemption,
    paymentMethod: 'gift_voucher',
    paymentSettlementStatus: 'not_required'
  });

  ids.unpaid = await insertBooking({});

  ids.stayCredit = await insertBooking({ stayCreditAppliedCents: 11000, checkoutId: 'co-sc' });
  await StayCreditReservation.collection.insertOne({
    stayCreditId: new mongoose.Types.ObjectId(),
    stayCreditCode: 'SC-TEST',
    checkoutSessionId: 'co-sc',
    reservationKey: 'rk-sc',
    amountCents: 11000,
    currency: 'EUR',
    guestEmail: 'sc@example.org',
    status: 'consumed',
    bookingId: ids.stayCredit,
    expiresAt: new Date(Date.now() + 3600e3),
    reservedAt: new Date()
  });

  ids.mixedRedemption = await insertRedemption({ checkoutId: 'co-mixed', amountAppliedCents: 4000 });
  ids.mixed = await insertBooking({
    checkoutId: 'co-mixed',
    giftVoucherAppliedCents: 4000,
    giftVoucherRedemptionId: ids.mixedRedemption,
    stripePaidAmountCents: 7000,
    stripePaymentIntentId: 'pi_mixed_test',
    paymentMethod: 'stripe_plus_gift_voucher'
  });
  await Payment.create({
    reservationId: ids.mixed,
    provider: 'stripe',
    providerReference: 'pi_mixed_test',
    status: 'paid',
    amount: 70
  });

  ids.failed = await insertBooking({ stripePaymentIntentId: 'pi_failed_test', stripePaidAmountCents: 0 });
  await Payment.create({ reservationId: ids.failed, provider: 'stripe', providerReference: 'pi_failed_test', status: 'failed', amount: 110 });

  ids.cancelledVoucherRedemption = await insertRedemption({ checkoutId: 'co-cancel', amountAppliedCents: 11000 });
  ids.cancelledVoucher = await insertBooking({
    status: 'cancelled',
    checkoutId: 'co-cancel',
    giftVoucherAppliedCents: 11000,
    giftVoucherRedemptionId: ids.cancelledVoucherRedemption,
    paymentMethod: 'gift_voucher'
  });
  return ids;
}

test('dashboard: voucher/stay-credit paid bookings emit no unpaid alert; genuine/partial/released still alert; other alerts intact', async () => {
  const ids = await seedScenario();
  const result = await getDashboardReadModel();
  const alerts = findAlerts(result);
  const unpaid = alerts.filter((a) => a.type === 'unpaid_upcoming').map((a) => String(a.entityId));

  assert.ok(!unpaid.includes(String(ids.fullVoucher)), 'full voucher booking must not be unpaid');
  assert.ok(!unpaid.includes(String(ids.stayCredit)), 'stay credit booking must not be unpaid');
  assert.ok(!unpaid.includes(String(ids.mixed)), 'voucher + verified Stripe must not be unpaid');
  assert.ok(unpaid.includes(String(ids.unpaid)), 'genuinely unpaid booking still alerts');
  assert.ok(unpaid.includes(String(ids.releasedVoucher)), 'released redemption gives no coverage');
  assert.ok(unpaid.includes(String(ids.partialVoucher)), 'partial voucher with outstanding balance alerts');
  const partialAlert = alerts.find((a) => a.type === 'unpaid_upcoming' && String(a.entityId) === String(ids.partialVoucher));
  assert.match(partialAlert.detail, /outstanding balance/);

  assert.ok(
    alerts.some((a) => a.type === 'payment_failed' && String(a.entityId) === String(ids.failed)),
    'failed payment alert intact'
  );
  assert.ok(
    alerts.some((a) => a.type === 'refund_follow_up' && String(a.entityId) === String(ids.cancelledVoucher)),
    'cancelled voucher-paid booking raises refund/credit follow-up'
  );
});

test('reservations list: voucher bookings classified from ledger evidence and attention buckets correct', async () => {
  const ids = await seedScenario();
  const before = mongoose.connection.db;
  const redemptionSnapshot = await before.collection('giftvoucherredemptions').find({}).sort({ _id: 1 }).toArray();
  const bookingSnapshot = await before.collection('bookings').find({}).sort({ _id: 1 }).toArray();

  const result = await getReservationsWorkspaceReadModel({ limit: 100 });
  const items = result.items || result.reservations || result.rows || result.data?.items;
  assert.ok(Array.isArray(items), 'reservation rows array');
  const byId = new Map(items.map((r) => [String(r.reservationId), r]));

  const expect = (id, status, attention) => {
    const row = byId.get(String(id));
    assert.ok(row, `row ${id}`);
    assert.equal(row.paymentStatus, status, `status for ${id}`);
    assert.equal(row.operational.paymentAttention, attention, `attention for ${id}`);
  };
  expect(ids.fullVoucher, 'paid', false);
  expect(ids.stayCredit, 'paid', false);
  expect(ids.mixed, 'paid', false);
  expect(ids.partialVoucher, 'partial', true);
  expect(ids.releasedVoucher, 'unpaid', true);
  expect(ids.unpaid, 'unpaid', true);
  expect(ids.failed, 'failed', true);
  expect(ids.cancelledVoucher, 'paid', true);
  assert.equal(byId.get(String(ids.fullVoucher)).operational.opsBucket !== 'payment_attention', true);

  // Read model performs no writes.
  assert.deepEqual(await before.collection('giftvoucherredemptions').find({}).sort({ _id: 1 }).toArray(), redemptionSnapshot);
  assert.deepEqual(await before.collection('bookings').find({}).sort({ _id: 1 }).toArray(), bookingSnapshot);
});

test('evidence is batch-loaded (constant query count regardless of booking count)', async () => {
  await seedScenario();
  const counts = { redemption: 0, stayCredit: 0 };
  const origR = GiftVoucherRedemption.find;
  const origS = StayCreditReservation.find;
  GiftVoucherRedemption.find = function (...a) { counts.redemption += 1; return origR.apply(this, a); };
  StayCreditReservation.find = function (...a) { counts.stayCredit += 1; return origS.apply(this, a); };
  try {
    await getReservationsWorkspaceReadModel({ limit: 100 });
    assert.equal(counts.redemption, 1);
    assert.equal(counts.stayCredit, 1);
    counts.redemption = 0;
    counts.stayCredit = 0;
    await getDashboardReadModel();
    assert.equal(counts.redemption, 1);
    assert.equal(counts.stayCredit, 1);
  } finally {
    GiftVoucherRedemption.find = origR;
    StayCreditReservation.find = origS;
  }
});
