'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const CleaningSettings = require('../models/CleaningSettings');
const CleaningPayment = require('../models/CleaningPayment');
const CleaningDaySheet = require('../models/CleaningDaySheet');
const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const { createOpsUser } = require('../services/ops/opsUserService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  calculateLegacyLineItems,
  calculatePolicyLineItems,
  calculateCleaningPaymentSummary,
  calculateForMarkPaid,
  checkoutMatchesSelector
} = require('../services/ops/cleaning/cleaningPricingService');

let mongoServer;
let app;

function testDayIso(offsetDays = 14) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function checkoutOnDay(dayIso, overrides = {}) {
  const sofiaStart = normalizeDateToSofiaDayStart(dayIso);
  let checkOut = new Date(sofiaStart.getTime() + 12 * 60 * 60 * 1000);
  let checkIn = new Date(sofiaStart.getTime() - 2 * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (checkIn <= now) {
    checkIn = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    checkOut = new Date(checkIn.getTime() + 2 * 24 * 60 * 60 * 1000);
  }
  return {
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Test',
      lastName: 'Guest',
      email: `cleaning.${crypto.randomBytes(4).toString('hex')}@example.com`,
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(6).toString('hex')}`,
    ...overrides
  };
}

async function login(username, password) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  assert.equal(res.status, 200, res.body?.message);
  return res.body.token;
}

async function authed(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) return req.send(body);
  return req;
}

async function createValleyCabinType(overrides = {}) {
  return CabinType.create({
    name: `Valley Type ${crypto.randomBytes(3).toString('hex')}`,
    slug: `valley-type-${crypto.randomBytes(4).toString('hex')}`,
    description: 'test type',
    location: 'The Valley',
    capacity: 4,
    pricePerNight: 120,
    imageUrl: 'https://example.com/type.jpg',
    propertyKind: 'valley',
    ...overrides
  });
}

async function createCabin(overrides = {}) {
  return Cabin.create({
    name: `Cabin ${crypto.randomBytes(3).toString('hex')}`,
    description: 'test',
    location: 'Rhodopes',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg',
    propertyKind: 'cabin',
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'cleaning-pricing-batch-e';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));

  await createOpsUser({
    email: 'cleaner.batch-e@test.com',
    name: 'Batch E Cleaner',
    password: 'cleaner-pass-123',
    role: 'cleaner'
  });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('cleaning pricing Batch E', async (t) => {
  const TEST_DAY = testDayIso(14);

  await t.test('legacy fallback returns base fee and property line items', async () => {
    await CleaningPricingPolicy.updateMany({ propertyKind: 'cabin' }, { $set: { isActive: false } });
    await CleaningSettings.findOneAndUpdate(
      { propertyKind: 'cabin' },
      { $set: { baseFee: 15 } },
      { upsert: true }
    );
    const cabin = await createCabin({ cleaningFee: 40, propertyKind: 'cabin' });
    await Booking.create(checkoutOnDay(TEST_DAY, { cabinId: cabin._id }));

    const calc = await calculateLegacyLineItems(
      [
        {
          bookingId: 'b1',
          cabinName: 'Test Cabin',
          cleaningFee: 40
        }
      ],
      'cabin'
    );

    assert.equal(calc.pricingVersion, 'legacy');
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'legacy_base_fee' && li.amountEUR === 15));
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'legacy_property_fee' && li.amountEUR === 40));
    assert.equal(calc.totalAmountEUR, 55);

    const summary = await calculateCleaningPaymentSummary({
      date: TEST_DAY,
      propertyKind: 'cabin'
    });
    assert.equal(summary.currency, 'EUR');
    assert.ok(Array.isArray(summary.lineItems));
    assert.equal(summary.lineItems.length, 2);
    assert.equal(summary.totalAmount, 55);
    assert.equal(summary.canEditInputs, true);
  });

  await t.test('daily_fixed rule', async () => {
    const lineItems = [];
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 8
        }
      ]
    };
    const calc = calculatePolicyLineItems([], policy, null);
    assert.equal(calc.totalAmountEUR, 8);
    assert.equal(calc.lineItems[0].ruleKey, 'transport');
  });

  await t.test('quantity rule uses day sheet inputs', async () => {
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'laundry',
          type: 'quantity',
          label: 'Laundry',
          unitAmountEUR: 2,
          inputKey: 'laundryLoads'
        }
      ]
    };
    const daySheet = { inputs: { laundryLoads: 3 }, perCheckoutInputs: [] };
    const calc = calculatePolicyLineItems([], policy, daySheet);
    assert.equal(calc.totalAmountEUR, 6);
    assert.equal(calc.lineItems[0].quantity, 3);
  });

  await t.test('tiered_per_event rule for a-frame tag', async () => {
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'aframe_clean',
          type: 'tiered_per_event',
          label: 'A-frame cleaning',
          selector: { cleaningTags: ['a-frame'] },
          tiers: [{ amountEUR: 25 }, { amountEUR: 10 }]
        }
      ]
    };
    const checkouts = [
      { bookingId: 'b2', cabinName: 'AF-02', cleaningTags: ['a-frame'] },
      { bookingId: 'b1', cabinName: 'AF-01', cleaningTags: ['a-frame'] },
      { bookingId: 'b3', cabinName: 'Stone', cleaningTags: ['stone-house'] }
    ];
    const calc = calculatePolicyLineItems(checkouts, policy, null);
    assert.equal(calc.lineItems.length, 2);
    assert.equal(calc.totalAmountEUR, 35);
    const amounts = calc.lineItems.map((li) => li.amountEUR).sort((a, b) => b - a);
    assert.deepEqual(amounts, [25, 10]);
  });

  await t.test('optional_addon rule day-level and per-checkout', async () => {
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'stone_kitchen',
          type: 'optional_addon',
          label: 'Stone kitchen',
          amountEUR: 12,
          inputKey: 'stoneKitchen'
        }
      ]
    };
    const daySheet = {
      inputs: {},
      perCheckoutInputs: [{ bookingId: 'b1', inputs: { stoneKitchen: true } }]
    };
    const checkouts = [{ bookingId: 'b1', cabinName: 'Stone House' }];
    const calc = calculatePolicyLineItems(checkouts, policy, daySheet);
    assert.equal(calc.totalAmountEUR, 12);
  });

  await t.test('per_event_fixed rule standalone', async () => {
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'turnover',
          type: 'per_event_fixed',
          label: 'Turnover clean',
          amountEUR: 18,
          selector: { cleaningTags: ['a-frame'] }
        }
      ]
    };
    const checkouts = [
      { bookingId: 'b1', cabinName: 'AF-01', cleaningTags: ['a-frame'] },
      { bookingId: 'b2', cabinName: 'Stone', cleaningTags: ['stone-house'] }
    ];
    const calc = calculatePolicyLineItems(checkouts, policy, null);
    assert.equal(calc.lineItems.length, 1);
    assert.equal(calc.totalAmountEUR, 18);
    assert.equal(calc.lineItems[0].bookingId, 'b1');
  });

  await t.test('cabinId selector matches only targeted checkout', () => {
    const cabinId = new mongoose.Types.ObjectId();
    const otherCabinId = new mongoose.Types.ObjectId();
    const ev = { bookingId: 'b1', cabinId: String(cabinId), cleaningTags: [] };
    assert.equal(checkoutMatchesSelector(ev, { cabinId }), true);
    assert.equal(checkoutMatchesSelector(ev, { cabinId: otherCabinId }), false);
  });

  await t.test('cabinTypeId selector matches only targeted checkout', () => {
    const cabinTypeId = new mongoose.Types.ObjectId();
    const otherTypeId = new mongoose.Types.ObjectId();
    const ev = { bookingId: 'b1', cabinTypeId: String(cabinTypeId), cleaningTags: [] };
    assert.equal(checkoutMatchesSelector(ev, { cabinTypeId }), true);
    assert.equal(checkoutMatchesSelector(ev, { cabinTypeId: otherTypeId }), false);
  });

  await t.test('cabinTypeId selector applies per_event_fixed amount', () => {
    const cabinTypeId = new mongoose.Types.ObjectId();
    const policy = {
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'type_clean',
          type: 'per_event_fixed',
          label: 'Type clean',
          amountEUR: 22,
          selector: { cabinTypeId }
        }
      ]
    };
    const checkouts = [
      { bookingId: 'b1', cabinName: 'Unit A', cabinTypeId: String(cabinTypeId), cleaningTags: [] },
      { bookingId: 'b2', cabinName: 'Other', cabinTypeId: String(new mongoose.Types.ObjectId()), cleaningTags: [] }
    ];
    const calc = calculatePolicyLineItems(checkouts, policy, null);
    assert.equal(calc.lineItems.length, 1);
    assert.equal(calc.totalAmountEUR, 22);
    assert.equal(calc.lineItems[0].bookingId, 'b1');
  });

  await t.test('pre-Batch-E paid row returns stored total without recalculation', async () => {
    const dayIso = testDayIso(21);
    const sofiaStart = normalizeDateToSofiaDayStart(dayIso);

    await CleaningPayment.deleteMany({ date: sofiaStart, propertyKind: 'cabin' });
    await CleaningPricingPolicy.deleteMany({ propertyKind: 'cabin' });

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'would-be-99',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 99
        }
      ]
    });

    await CleaningPayment.create({
      date: sofiaStart,
      propertyKind: 'cabin',
      totalAmount: 42,
      paidAmount: 42,
      status: 'paid',
      currency: 'EUR',
      lineItems: [],
      markedPaidAt: new Date('2025-01-01')
    });

    const summary = await calculateCleaningPaymentSummary({ date: dayIso, propertyKind: 'cabin' });
    assert.equal(summary.totalAmount, 42);
    assert.equal(summary.status, 'paid');
    assert.equal(summary.isSnapshot, true);
    assert.deepEqual(summary.lineItems, []);
    assert.notEqual(summary.totalAmount, 99);
  });

  await t.test('mark-paid stores currency EUR on snapshot', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const dayIso = testDayIso(28);
    const sofiaStart = normalizeDateToSofiaDayStart(dayIso);

    await CleaningPayment.deleteMany({ date: sofiaStart, propertyKind: 'valley' });
    await CleaningPricingPolicy.deleteMany({ propertyKind: 'valley' });
    await Booking.deleteMany({});

    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'currency-v1',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 5
        }
      ]
    });

    const markRes = await authed('post', '/api/ops/cleaning/payments/mark-paid', adminToken, {
      date: dayIso,
      propertyKind: 'valley'
    });
    assert.equal(markRes.status, 200, markRes.body?.message);
    assert.equal(markRes.body.data.currency, 'EUR');

    const payment = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.equal(payment.currency, 'EUR');
  });

  await t.test('PUT day-inputs returns 409 when payment is already paid', async () => {
    const operatorToken = await login('operator', 'operatorpassword123');
    const dayIso = testDayIso(35);
    const sofiaStart = normalizeDateToSofiaDayStart(dayIso);

    await CleaningPayment.deleteMany({ date: sofiaStart, propertyKind: 'cabin' });
    await CleaningDaySheet.deleteMany({ date: sofiaStart, propertyKind: 'cabin' });

    await CleaningPayment.create({
      date: sofiaStart,
      propertyKind: 'cabin',
      totalAmount: 10,
      paidAmount: 10,
      status: 'paid',
      currency: 'EUR'
    });

    const res = await authed('put', '/api/ops/cleaning/day-inputs', operatorToken, {
      date: dayIso,
      propertyKind: 'cabin',
      inputs: { laundryLoads: 1 }
    });
    assert.equal(res.status, 409);
    assert.match(res.body.message, /paid/i);
  });

  await t.test('mark-paid freezes snapshot; policy change does not alter paid summary', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const sofiaStart = normalizeDateToSofiaDayStart(TEST_DAY);

    await CleaningPricingPolicy.deleteMany({});
    await CleaningPayment.deleteMany({});
    await CleaningDaySheet.deleteMany({});
    await Booking.deleteMany({});
    await CleaningSettings.findOneAndUpdate(
      { propertyKind: 'valley' },
      { $set: { baseFee: 0 } },
      { upsert: true }
    );

    const cabinType = await createValleyCabinType({ cleaningFee: 20, cleaningTags: ['a-frame'] });
    await Booking.create(checkoutOnDay(TEST_DAY, { cabinTypeId: cabinType._id }));

    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'v1-test',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 8
        },
        {
          ruleKey: 'unit_fee',
          type: 'per_event_fixed',
          label: 'Unit clean',
          amountEUR: 20,
          selector: { cleaningTags: ['a-frame'] }
        }
      ]
    });

    const markRes = await authed('post', '/api/ops/cleaning/payments/mark-paid', adminToken, {
      date: TEST_DAY,
      propertyKind: 'valley'
    });
    assert.equal(markRes.status, 200, markRes.body?.message);
    assert.equal(markRes.body.data.totalAmount, 28);
    assert.ok(markRes.body.data.lineItems.length >= 2);

    await CleaningPricingPolicy.updateOne({ version: 'v1-test' }, { $set: { isActive: false } });
    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'v2-test',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 99
        }
      ]
    });

    const summaryRes = await authed(
      'get',
      `/api/ops/cleaning/payment-summary?date=${TEST_DAY}&propertyKind=valley`,
      adminToken
    );
    assert.equal(summaryRes.status, 200);
    assert.equal(summaryRes.body.data.totalAmount, 28);
    assert.equal(summaryRes.body.data.isSnapshot, true);
    assert.equal(summaryRes.body.data.canEditInputs, false);
    assert.ok(summaryRes.body.data.lineItems.some((li) => li.amountEUR === 8));

    const payment = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.equal(payment.pricingVersion, 'v1-test');
    assert.ok(payment.lineItems.length >= 2);
    assert.ok(payment.inputsSnapshot);
    assert.ok(payment.calculatedAt);
  });

  await t.test('payment summary returns lineItems via API', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const res = await authed(
      'get',
      `/api/ops/cleaning/payment-summary?date=${TEST_DAY}&propertyKind=cabin`,
      adminToken
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.lineItems));
    assert.equal(res.body.data.currency, 'EUR');
  });

  await t.test('operator can update day inputs; cleaner cannot', async () => {
    const operatorToken = await login('operator', 'operatorpassword123');
    const cleanerToken = await login('cleaner.batch-e@test.com', 'cleaner-pass-123');

    const putOp = await authed('put', '/api/ops/cleaning/day-inputs', operatorToken, {
      date: TEST_DAY,
      propertyKind: 'cabin',
      inputs: { laundryLoads: 2 }
    });
    assert.equal(putOp.status, 200, putOp.body?.message);
    assert.equal(putOp.body.data.daySheet.inputs.laundryLoads, 2);
    assert.ok(Array.isArray(putOp.body.data.paymentSummary.lineItems));

    const putCleaner = await authed('put', '/api/ops/cleaning/day-inputs', cleanerToken, {
      date: TEST_DAY,
      propertyKind: 'cabin',
      inputs: { laundryLoads: 5 }
    });
    assert.equal(putCleaner.status, 403);

    const sheet = await CleaningDaySheet.findOne({
      date: normalizeDateToSofiaDayStart(TEST_DAY),
      propertyKind: 'cabin'
    }).lean();
    assert.equal(sheet.inputs.laundryLoads, 2);
  });

  await t.test('cleaner cannot mark paid', async () => {
    const cleanerToken = await login('cleaner.batch-e@test.com', 'cleaner-pass-123');
    const res = await authed('post', '/api/ops/cleaning/payments/mark-paid', cleanerToken, {
      date: TEST_DAY,
      propertyKind: 'cabin'
    });
    assert.equal(res.status, 403);
  });

  await t.test('calculateForMarkPaid uses active policy with quantity inputs', async () => {
    await CleaningPricingPolicy.deleteMany({});
    await CleaningDaySheet.deleteMany({});

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'qty-v1',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'laundry',
          type: 'quantity',
          label: 'Laundry',
          unitAmountEUR: 2,
          inputKey: 'laundryLoads'
        }
      ]
    });

    await CleaningDaySheet.findOneAndUpdate(
      { date: normalizeDateToSofiaDayStart(TEST_DAY), propertyKind: 'cabin' },
      { $set: { inputs: { laundryLoads: 4 } } },
      { upsert: true }
    );

    const calc = await calculateForMarkPaid({ date: TEST_DAY, propertyKind: 'cabin' });
    assert.equal(calc.totalAmountEUR, 8);
    assert.equal(calc.pricingVersion, 'qty-v1');
  });
});
