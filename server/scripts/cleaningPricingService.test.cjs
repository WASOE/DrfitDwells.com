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
const CleaningPayment = require('../models/CleaningPayment');
const CleaningDaySheet = require('../models/CleaningDaySheet');
const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const { createOpsUser } = require('../services/ops/opsUserService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const {
  priceDay,
  toPricingFacts,
  calculatePolicyLineItems,
  calculateCleaningPaymentSummary,
  calculateGlobalPayoutSummary,
  calculateForMarkPaid,
  checkoutMatchesSelector,
  NoActivePricingPolicyError
} = require('../services/ops/cleaning/cleaningPricingService');
const { defaultRulesForPropertyKind } = require('../data/cleaning/defaultCleaningPricingPolicy');

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

function valleyPolicy(rules) {
  return {
    propertyKind: 'valley',
    _id: new mongoose.Types.ObjectId(),
    version: 'v1',
    currency: 'EUR',
    rules
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

test('cleaning pricing Batch 1 — checkout-driven engine', async (t) => {
  const TEST_DAY = testDayIso(14);

  await t.test('no active policy returns noPolicy summary (no legacy fallback)', async () => {
    await CleaningPricingPolicy.updateMany({ propertyKind: 'cabin' }, { $set: { isActive: false } });
    const cabin = await createCabin({ propertyKind: 'cabin' });
    await Booking.create(checkoutOnDay(TEST_DAY, { cabinId: cabin._id }));

    const summary = await calculateCleaningPaymentSummary({
      date: TEST_DAY,
      propertyKind: 'cabin'
    });
    assert.equal(summary.noPolicy, true);
    assert.equal(summary.totalAmount, 0);
    assert.equal(summary.lineItems.length, 0);
  });

  await t.test('daily_fixed without requiresCheckouts still emits on zero checkouts', () => {
    const policy = {
      propertyKind: 'cabin',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 8
        }
      ]
    };
    const calc = priceDay([], policy);
    assert.equal(calc.totalAmountEUR, 8);
    assert.equal(calc.lineItems[0].ruleKey, 'transport');
    assert.equal(calc.lineItems[0].amountType, 'cleaner_payout');
  });

  await t.test('daily_fixed with requiresCheckouts skips transport when no checkouts', () => {
    const policy = valleyPolicy(defaultRulesForPropertyKind('valley'));
    const calc = priceDay([], policy);
    assert.equal(calc.totalAmountEUR, 0);
    assert.ok(!calc.lineItems.some((li) => li.ruleKey === 'transport'));
  });

  await t.test('priceDay ignores quantity and optional_addon rules', () => {
    const policy = {
      propertyKind: 'cabin',
      rules: [
        {
          ruleKey: 'laundry',
          type: 'quantity',
          label: 'Laundry',
          unitAmountEUR: 2,
          inputKey: 'laundryLoads'
        },
        {
          ruleKey: 'deep_cleaning',
          type: 'optional_addon',
          label: 'Deep cleaning',
          amountEUR: 150,
          inputKey: 'deepCleaning'
        }
      ]
    };
    const calc = priceDay([], policy);
    assert.equal(calc.totalAmountEUR, 0);
    assert.equal(calc.lineItems.length, 0);
  });

  await t.test('tiered_per_event rule for a-frame tag uses 20/10 tiers', () => {
    const policy = valleyPolicy([
      {
        ruleKey: 'aframe_clean',
        type: 'tiered_per_event',
        label: 'A-frame cleaning',
        selector: { cleaningTags: ['a-frame'] },
        tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
      }
    ]);
    const checkouts = [
      { bookingId: 'b2', cabinName: 'AF-02', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b3', cabinName: 'Stone', propertyKind: 'valley', cleaningTags: ['stone-house'] }
    ];
    const calc = priceDay(checkouts, policy);
    assert.equal(calc.lineItems.length, 2);
    assert.equal(calc.totalAmountEUR, 30);
    const amounts = calc.lineItems.map((li) => li.amountEUR).sort((a, b) => b - a);
    assert.deepEqual(amounts, [20, 10]);
  });

  await t.test('a-frame tier edge cases: 0, 1, 2, N', () => {
    const policy = valleyPolicy([
      {
        ruleKey: 'aframe_clean',
        type: 'tiered_per_event',
        label: 'A-frame cleaning',
        selector: { cleaningTags: ['a-frame'] },
        tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
      }
    ]);

    assert.equal(priceDay([], policy).totalAmountEUR, 0);

    const one = priceDay(
      [{ bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] }],
      policy
    );
    assert.equal(one.totalAmountEUR, 20);

    const two = priceDay(
      [
        { bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] },
        { bookingId: 'b2', cabinName: 'AF-02', propertyKind: 'valley', cleaningTags: ['a-frame'] }
      ],
      policy
    );
    assert.equal(two.totalAmountEUR, 30);

    const four = priceDay(
      ['b1', 'b2', 'b3', 'b4'].map((id, i) => ({
        bookingId: id,
        cabinName: `AF-0${i + 1}`,
        propertyKind: 'valley',
        cleaningTags: ['a-frame']
      })),
      policy
    );
    assert.equal(four.totalAmountEUR, 50);
  });

  await t.test('€81 valley day: 3 a-frames + 1 lux + laundry', () => {
    const policy = valleyPolicy(defaultRulesForPropertyKind('valley'));
    const checkouts = [
      { bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b2', cabinName: 'AF-02', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b3', cabinName: 'AF-03', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b4', cabinName: 'Lux', propertyKind: 'valley', cleaningTags: ['lux-cabin'] }
    ];
    const calc = priceDay(checkouts, policy);
    assert.equal(calc.totalAmountEUR, 81);
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'transport' && li.amountEUR === 8));
    assert.equal(
      calc.lineItems.filter((li) => li.ruleKey === 'aframe_clean').reduce((s, li) => s + li.amountEUR, 0),
      40
    );
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'lux_cabin' && li.amountEUR === 25));
    assert.equal(
      calc.lineItems.filter((li) => li.ruleKey === 'laundry').reduce((s, li) => s + li.amountEUR, 0),
      8
    );
  });

  await t.test('unmatchedCheckouts when valley checkout has no priced tag', () => {
    const policy = valleyPolicy(defaultRulesForPropertyKind('valley'));
    const checkouts = [
      { bookingId: 'b1', cabinName: 'Mystery unit', propertyKind: 'valley', cleaningTags: [] }
    ];
    const calc = priceDay(checkouts, policy);
    assert.equal(calc.unmatchedCheckouts.length, 1);
    assert.equal(calc.unmatchedCheckouts[0].bookingId, 'b1');
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'laundry'));
  });

  await t.test('cabinId-only booking with tags matches tag selector', () => {
    const policy = valleyPolicy([
      {
        ruleKey: 'aframe_clean',
        type: 'tiered_per_event',
        label: 'A-frame cleaning',
        selector: { cleaningTags: ['a-frame'] },
        tiers: [{ amountEUR: 20 }, { amountEUR: 10 }]
      }
    ]);
    const checkouts = [
      {
        bookingId: 'b1',
        cabinId: String(new mongoose.Types.ObjectId()),
        cabinName: 'AF cabin',
        propertyKind: 'valley',
        cleaningTags: ['a-frame']
      }
    ];
    const calc = priceDay(checkouts, policy);
    assert.equal(calc.lineItems.length, 1);
    assert.equal(calc.totalAmountEUR, 20);
    assert.deepEqual(calc.unmatchedCheckouts, []);
  });

  await t.test('toPricingFacts normalizes tags like the read model', () => {
    const facts = toPricingFacts({
      bookingId: 'b1',
      cabinName: 'AF-01',
      propertyKind: 'valley',
      cleaningTags: ['A-Frame', 'lux-cabin'],
      cabinId: 'abc',
      cabinTypeId: null
    });
    assert.deepEqual(facts.tags, ['a-frame', 'lux-cabin']);
    assert.equal(facts.cabinId, 'abc');
    assert.equal(facts.cabinTypeId, null);
  });

  await t.test('per_event_fixed rule standalone', () => {
    const policy = valleyPolicy([
      {
        ruleKey: 'turnover',
        type: 'per_event_fixed',
        label: 'Turnover clean',
        amountEUR: 18,
        selector: { cleaningTags: ['a-frame'] }
      }
    ]);
    const checkouts = [
      { bookingId: 'b1', cabinName: 'AF-01', propertyKind: 'valley', cleaningTags: ['a-frame'] },
      { bookingId: 'b2', cabinName: 'Stone', propertyKind: 'valley', cleaningTags: ['stone-house'] }
    ];
    const calc = priceDay(checkouts, policy);
    assert.equal(calc.lineItems.length, 1);
    assert.equal(calc.totalAmountEUR, 18);
    assert.equal(calc.lineItems[0].bookingId, 'b1');
    assert.equal(calc.lineItems[0].propertyKind, 'valley');
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

  await t.test('mark-paid returns 422 when no active policy', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const dayIso = testDayIso(29);
    await CleaningPricingPolicy.updateMany({ propertyKind: 'cabin' }, { $set: { isActive: false } });

    const markRes = await authed('post', '/api/ops/cleaning/payments/mark-paid', adminToken, {
      date: dayIso,
      propertyKind: 'cabin'
    });
    assert.equal(markRes.status, 422);
    assert.equal(markRes.body.errorType, 'no_policy');
  });

  await t.test('removed day-inputs route returns 404', async () => {
    const operatorToken = await login('operator', 'operatorpassword123');
    const res = await authed('put', '/api/ops/cleaning/day-inputs', operatorToken, {
      date: TEST_DAY,
      propertyKind: 'cabin',
      inputs: { laundryLoads: 1 }
    });
    assert.equal(res.status, 404);
  });

  await t.test('mark-paid freezes snapshot; policy change does not alter paid summary', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const sofiaStart = normalizeDateToSofiaDayStart(TEST_DAY);

    await CleaningPricingPolicy.deleteMany({});
    await CleaningPayment.deleteMany({});
    await CleaningDaySheet.deleteMany({});
    await Booking.deleteMany({});

    const cabinType = await createValleyCabinType({ cleaningTags: ['a-frame'] });
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
    assert.ok(summaryRes.body.data.lineItems.some((li) => li.amountEUR === 8));
    assert.ok(
      summaryRes.body.data.lineItems.every(
        (li) => li.amountType === 'cleaner_payout' && li.propertyKind === 'valley'
      )
    );
    assert.equal(summaryRes.body.data.editableInputFields, undefined);
    assert.equal(summaryRes.body.data.inputs, undefined);

    const payment = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.equal(payment.pricingVersion, 'v1-test');
    assert.ok(payment.lineItems.length >= 2);
    assert.ok(
      payment.lineItems.every((li) => li.amountType === 'cleaner_payout' && li.propertyKind === 'valley')
    );
    assert.ok(payment.calculatedAt);
  });

  await t.test('payment summary returns lineItems via API', async () => {
    const adminToken = await login('admin', 'securepassword123');
    await CleaningPricingPolicy.updateMany({ propertyKind: 'cabin' }, { $set: { isActive: false } });
    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'api-line-items',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });

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

  await t.test('cleaner cannot mark paid', async () => {
    const cleanerToken = await login('cleaner.batch-e@test.com', 'cleaner-pass-123');
    const res = await authed('post', '/api/ops/cleaning/payments/mark-paid', cleanerToken, {
      date: TEST_DAY,
      propertyKind: 'cabin'
    });
    assert.equal(res.status, 403);
  });

  await t.test('global payout equals sum of cabin and valley zones', async () => {
    const dayIso = testDayIso(35);
    await CleaningPricingPolicy.deleteMany({});
    await Booking.deleteMany({});

    const cabin = await createCabin({ propertyKind: 'cabin' });
    await Booking.create(checkoutOnDay(dayIso, { cabinId: cabin._id }));

    const valleyType = await createValleyCabinType({ cleaningTags: ['a-frame'] });
    await Booking.create(
      checkoutOnDay(dayIso, { cabinTypeId: valleyType._id, unitId: new mongoose.Types.ObjectId() })
    );

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'global-cabin',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });
    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'global-valley',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('valley')
    });

    const cabinSummary = await calculateCleaningPaymentSummary({ date: dayIso, propertyKind: 'cabin' });
    const valleySummary = await calculateCleaningPaymentSummary({ date: dayIso, propertyKind: 'valley' });
    const global = await calculateGlobalPayoutSummary({ date: dayIso });

    assert.equal(cabinSummary.totalAmount, 35);
    assert.equal(valleySummary.totalAmount, 30);
    assert.equal(global.totalAmount, 65);
    assert.equal(global.totalAmount, cabinSummary.totalAmount + valleySummary.totalAmount);
    assert.ok(global.lineItems.some((li) => li.propertyKind === 'cabin'));
    assert.ok(global.lineItems.some((li) => li.propertyKind === 'valley'));
    assert.equal(global.readOnly, true);
  });

  await t.test('zone without active policy contributes €0 to global payout', async () => {
    const dayIso = testDayIso(36);
    await CleaningPricingPolicy.deleteMany({});
    await Booking.deleteMany({});

    const cabin = await createCabin({ propertyKind: 'cabin' });
    await Booking.create(checkoutOnDay(dayIso, { cabinId: cabin._id }));

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'global-cabin-only',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });

    const global = await calculateGlobalPayoutSummary({ date: dayIso });
    assert.equal(global.totalAmount, 35);
    assert.deepEqual(global.noPolicyZones, ['valley']);
    assert.equal(global.zones.valley.noPolicy, true);
    assert.equal(global.zones.valley.totalAmount, 0);
    assert.ok(global.zones.cabin.totalAmount > 0);
  });

  await t.test('cleaner can read global payout via API; not zone payment summary', async () => {
    const dayIso = testDayIso(37);
    await CleaningPricingPolicy.deleteMany({});
    await Booking.deleteMany({});

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'cleaner-payout-cabin',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });
    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'cleaner-payout-valley',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [
        {
          ruleKey: 'transport',
          type: 'daily_fixed',
          label: 'Transport',
          amountEUR: 8,
          requiresCheckouts: true,
          amountType: 'cleaner_payout',
          selector: {},
          enabled: true
        }
      ]
    });

    const cleanerToken = await login('cleaner.batch-e@test.com', 'cleaner-pass-123');

    const payoutRes = await authed('get', `/api/ops/cleaning/payout-summary?date=${dayIso}`, cleanerToken);
    assert.equal(payoutRes.status, 200);
    assert.ok(typeof payoutRes.body.data.totalAmount === 'number');
    assert.ok(Array.isArray(payoutRes.body.data.lineItems));
    assert.equal(payoutRes.body.data.readOnly, true);
    assert.ok(Array.isArray(payoutRes.body.data.noPolicyZones));

    const paymentRes = await authed(
      'get',
      `/api/ops/cleaning/payment-summary?date=${dayIso}&propertyKind=cabin`,
      cleanerToken
    );
    assert.equal(paymentRes.status, 403);
  });

  await t.test('admin retains mark-paid on zone payment', async () => {
    const dayIso = testDayIso(38);
    const adminToken = await login('admin', 'securepassword123');
    await CleaningPricingPolicy.deleteMany({ propertyKind: 'cabin' });
    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'admin-mark-paid',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });

    const markRes = await authed('post', '/api/ops/cleaning/payments/mark-paid', adminToken, {
      date: dayIso,
      propertyKind: 'cabin'
    });
    assert.equal(markRes.status, 200, markRes.body?.message);
  });

  await t.test('calculateForMarkPaid throws when no active policy', async () => {
    await CleaningPricingPolicy.updateMany({ propertyKind: 'cabin' }, { $set: { isActive: false } });
    await assert.rejects(
      () => calculateForMarkPaid({ date: TEST_DAY, propertyKind: 'cabin' }),
      (err) => err instanceof NoActivePricingPolicyError
    );
  });

  await t.test('calculateForMarkPaid uses checkout-driven policy rules', async () => {
    await CleaningPricingPolicy.deleteMany({});
    await Booking.deleteMany({});
    const cabin = await createCabin({ propertyKind: 'cabin' });
    await Booking.create(checkoutOnDay(TEST_DAY, { cabinId: cabin._id }));

    await CleaningPricingPolicy.create({
      propertyKind: 'cabin',
      version: 'checkout-v1',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    });

    const calc = await calculateForMarkPaid({ date: TEST_DAY, propertyKind: 'cabin' });
    assert.equal(calc.totalAmountEUR, 35);
    assert.equal(calc.pricingVersion, 'checkout-v1');
    assert.ok(calc.lineItems.some((li) => li.ruleKey === 'cabin_clean'));
  });

  await t.test('calculatePolicyLineItems delegates to priceDay (day sheet ignored)', () => {
    const policy = {
      propertyKind: 'cabin',
      _id: new mongoose.Types.ObjectId(),
      version: 'v1',
      currency: 'EUR',
      rules: defaultRulesForPropertyKind('cabin')
    };
    const daySheet = { inputs: { laundryLoads: 99 }, perCheckoutInputs: [] };
    const calc = calculatePolicyLineItems(
      [{ bookingId: 'b1', cabinName: 'Cabin', propertyKind: 'cabin', cleaningTags: [] }],
      policy,
      daySheet
    );
    assert.equal(calc.totalAmountEUR, 35);
    assert.equal(calc.lineItems.length, 2);
  });
});
