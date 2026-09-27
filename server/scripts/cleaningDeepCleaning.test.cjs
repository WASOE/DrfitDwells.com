'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

const CabinType = require('../models/CabinType');
const Booking = require('../models/Booking');
const CleaningPayment = require('../models/CleaningPayment');
const CleaningPricingPolicy = require('../models/CleaningPricingPolicy');
const { createOpsUser } = require('../services/ops/opsUserService');
const { normalizeDateToSofiaDayStart } = require('../utils/dateTime');
const { defaultRulesForPropertyKind } = require('../data/cleaning/defaultCleaningPricingPolicy');

let mongoServer;
let app;
let adminToken;
let operatorToken;
let cleanerToken;
let aframeType;
let luxType;
let dayOffset = 40;

function nextDayIso() {
  dayOffset += 1;
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

function checkoutOnDay(dayIso, overrides = {}) {
  const sofiaStart = normalizeDateToSofiaDayStart(dayIso);
  return {
    checkIn: new Date(sofiaStart.getTime() - 2 * 24 * 60 * 60 * 1000),
    checkOut: new Date(sofiaStart.getTime() + 12 * 60 * 60 * 1000),
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Deep',
      lastName: 'Clean',
      email: `deep.${crypto.randomBytes(4).toString('hex')}@example.com`,
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
    unitId: new mongoose.Types.ObjectId(),
    ...overrides
  };
}

async function seedValleyDay({ aframes = 0, lux = 0 } = {}) {
  const dayIso = nextDayIso();
  for (let i = 0; i < aframes; i += 1) {
    await Booking.create(checkoutOnDay(dayIso, { cabinTypeId: aframeType._id }));
  }
  for (let i = 0; i < lux; i += 1) {
    await Booking.create(checkoutOnDay(dayIso, { cabinTypeId: luxType._id }));
  }
  return { date: dayIso, propertyKind: 'valley' };
}

async function createValleyType(tag) {
  return CabinType.create({
    name: `Valley ${tag} ${crypto.randomBytes(3).toString('hex')}`,
    slug: `valley-${tag}-${crypto.randomBytes(4).toString('hex')}`,
    description: 'test type',
    location: 'The Valley',
    capacity: 4,
    pricePerNight: 120,
    imageUrl: 'https://example.com/type.jpg',
    propertyKind: 'valley',
    cleaningTags: [tag]
  });
}

async function login(username, password) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  assert.equal(res.status, 200, res.body?.message);
  return res.body.token;
}

function call(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

const summary = (token, bucket) =>
  call(
    'get',
    `/api/ops/cleaning/payment-summary?date=${bucket.date}&propertyKind=${bucket.propertyKind}`,
    token
  );
const addDeep = (token, bucket) => call('post', '/api/ops/cleaning/payments/deep-cleaning', token, bucket);
const removeDeep = (token, bucket) =>
  call('delete', '/api/ops/cleaning/payments/deep-cleaning', token, bucket);
const markPaid = (token, bucket) => call('post', '/api/ops/cleaning/payments/mark-paid', token, bucket);
const unmarkPaid = (token, bucket) => call('post', '/api/ops/cleaning/payments/unmark-paid', token, bucket);

function deepItems(lineItems) {
  return (lineItems || []).filter((li) => li.ruleKey === 'deep_clean');
}

async function activateDefaultValleyPolicy(version) {
  await CleaningPricingPolicy.updateMany({ propertyKind: 'valley' }, { $set: { isActive: false } });
  await CleaningPricingPolicy.create({
    propertyKind: 'valley',
    version,
    isActive: true,
    effectiveFrom: new Date('2020-01-01'),
    currency: 'EUR',
    rules: defaultRulesForPropertyKind('valley')
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'cleaning-deep-cleaning-batch-2';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));

  await createOpsUser({
    email: 'cleaner.batch2@test.com',
    name: 'Batch 2 Cleaner',
    password: 'cleaner-pass-123',
    role: 'cleaner'
  });

  aframeType = await createValleyType('a-frame');
  luxType = await createValleyType('lux-cabin');
  await activateDefaultValleyPolicy('batch2-default');

  adminToken = await login('admin', 'securepassword123');
  operatorToken = await login('operator', 'operatorpassword123');
  cleanerToken = await login('cleaner.batch2@test.com', 'cleaner-pass-123');
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('Cleaning Batch 2 — manual Deep/Main cleaning and paid-snapshot lifecycle', async (t) => {
  await t.test('1. unpaid summary without deep cleaning is the normal calculated total', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    const res = await summary(adminToken, bucket);
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.totalAmount, 32);
    assert.equal(deepItems(res.body.data.lineItems).length, 0);
    assert.ok(res.body.data.lineItems.every((li) => li.source === 'policy'));
  });

  await t.test('2 + 5. add deep cleaning: +€150 once, manual source, stable key, audit; 1 A-frame => €182', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    const before = Date.now();
    const res = await addDeep(adminToken, bucket);
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.data.totalAmount, 182);

    const items = deepItems(res.body.data.lineItems);
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'manual');
    assert.equal(items[0].ruleKey, 'deep_clean');
    assert.equal(items[0].amountEUR, 150);
    assert.equal(items[0].propertyKind, 'valley');
    assert.equal(items[0].label, 'Deep/Main cleaning');
    assert.equal(items[0].amountType, 'cleaner_payout');
    assert.ok(items[0].addedBy);
    assert.ok(new Date(items[0].addedAt).getTime() >= before - 1000);
    // Deep cleaning is appended after the generated policy lines.
    assert.equal(res.body.data.lineItems.at(-1).ruleKey, 'deep_clean');

    const stored = await CleaningPayment.findOne({
      date: normalizeDateToSofiaDayStart(bucket.date),
      propertyKind: 'valley'
    }).lean();
    assert.equal(stored.manualLineItems.length, 1);
    assert.deepEqual(stored.lineItems, []);
    assert.equal(stored.status, 'pending');

    const reread = await summary(adminToken, bucket);
    assert.equal(reread.body.data.totalAmount, 182);
  });

  await t.test('3. adding deep cleaning twice does not duplicate or change the total', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    const first = await addDeep(adminToken, bucket);
    const second = await addDeep(adminToken, bucket);
    const concurrent = await Promise.all([addDeep(adminToken, bucket), addDeep(adminToken, bucket)]);
    assert.equal(first.body.changed, true);
    assert.equal(second.status, 200);
    assert.equal(second.body.changed, false);
    assert.equal(second.body.data.totalAmount, first.body.data.totalAmount);
    assert.ok(concurrent.every((r) => r.status === 200 && r.body.changed === false));

    const stored = await CleaningPayment.findOne({
      date: normalizeDateToSofiaDayStart(bucket.date),
      propertyKind: 'valley'
    }).lean();
    assert.equal(stored.manualLineItems.length, 1);
    assert.equal(deepItems((await summary(adminToken, bucket)).body.data.lineItems).length, 1);
  });

  await t.test('4. removing deep cleaning while unpaid restores the normal total', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    await addDeep(adminToken, bucket);
    const res = await removeDeep(adminToken, bucket);
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.data.totalAmount, 32);
    assert.equal(deepItems(res.body.data.lineItems).length, 0);

    const again = await removeDeep(adminToken, bucket);
    assert.equal(again.status, 200);
    assert.equal(again.body.changed, false);
  });

  await t.test('6. deep cleaning + 2 A-frames + Lux => €75 + €150 = €225', async () => {
    const bucket = await seedValleyDay({ aframes: 2, lux: 1 });
    assert.equal((await summary(adminToken, bucket)).body.data.totalAmount, 75);
    const res = await addDeep(adminToken, bucket);
    assert.equal(res.body.data.totalAmount, 225);
    assert.equal(deepItems(res.body.data.lineItems).length, 1);
    assert.equal(res.body.data.lineItems.filter((li) => li.ruleKey === 'transport').length, 1);
  });

  await t.test('7-11. mark-paid freezes, repeat is a no-op, paid is locked, unmark archives', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    await addDeep(adminToken, bucket);
    const sofiaStart = normalizeDateToSofiaDayStart(bucket.date);

    // 7. generated + manual frozen together.
    const paid = await markPaid(adminToken, bucket);
    assert.equal(paid.status, 200, paid.body?.message);
    assert.equal(paid.body.data.alreadyPaid, false);
    assert.equal(paid.body.data.totalAmount, 182);
    const frozen = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.equal(frozen.status, 'paid');
    assert.equal(frozen.totalAmount, 182);
    assert.equal(frozen.paidAmount, 182);
    assert.equal(frozen.pricingVersion, 'batch2-default');
    assert.deepEqual(
      frozen.lineItems.map((li) => [li.ruleKey, li.source, li.amountEUR]),
      [
        ['transport', 'policy', 8],
        ['aframe_clean', 'policy', 20],
        ['laundry', 'policy', 4],
        ['deep_clean', 'manual', 150]
      ]
    );
    const frozenDeep = frozen.lineItems.find((li) => li.ruleKey === 'deep_clean');
    assert.ok(frozenDeep.addedAt && frozenDeep.addedBy);

    // 8. policy change after paid does not alter history.
    await CleaningPricingPolicy.updateMany({ propertyKind: 'valley' }, { $set: { isActive: false } });
    await CleaningPricingPolicy.create({
      propertyKind: 'valley',
      version: 'batch2-hiked',
      isActive: true,
      effectiveFrom: new Date('2020-01-01'),
      currency: 'EUR',
      rules: [{ ruleKey: 'transport', type: 'daily_fixed', label: 'Transport', amountEUR: 99 }]
    });
    const afterPolicy = await summary(adminToken, bucket);
    assert.equal(afterPolicy.body.data.isSnapshot, true);
    assert.equal(afterPolicy.body.data.totalAmount, 182);
    assert.equal(afterPolicy.body.data.lineItems.length, 4);
    assert.equal(afterPolicy.body.data.pricingVersion, 'batch2-default');

    // 9. repeated mark-paid never recalculates or overwrites.
    const repeat = await markPaid(adminToken, bucket);
    assert.equal(repeat.status, 200, repeat.body?.message);
    assert.equal(repeat.body.data.alreadyPaid, true);
    assert.equal(repeat.body.data.totalAmount, 182);
    const afterRepeat = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.deepEqual(afterRepeat.lineItems, frozen.lineItems);
    assert.equal(afterRepeat.pricingVersion, 'batch2-default');
    assert.equal(afterRepeat.markedPaidAt.getTime(), frozen.markedPaidAt.getTime());
    assert.equal(afterRepeat.markedPaidBy, frozen.markedPaidBy);

    // 10. manual edits rejected once paid.
    const addAfterPaid = await addDeep(adminToken, bucket);
    assert.equal(addAfterPaid.status, 409);
    assert.equal(addAfterPaid.body.errorType, 'payment_locked');
    const removeAfterPaid = await removeDeep(adminToken, bucket);
    assert.equal(removeAfterPaid.status, 409);
    assert.equal(removeAfterPaid.body.errorType, 'payment_locked');
    const stillFrozen = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.deepEqual(stillFrozen.lineItems, frozen.lineItems);
    assert.equal(stillFrozen.manualLineItems.length, 1);

    // 11. unmark archives the exact snapshot, reopens, and keeps manual items.
    const unmark = await unmarkPaid(adminToken, bucket);
    assert.equal(unmark.status, 200, unmark.body?.message);
    assert.equal(unmark.body.data.changed, true);
    const reopened = await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean();
    assert.equal(reopened.status, 'pending');
    assert.equal(reopened.paidAmount, 0);
    assert.equal(reopened.paidSnapshotHistory.length, 1);
    const archived = reopened.paidSnapshotHistory[0];
    assert.equal(archived.totalAmount, 182);
    assert.equal(archived.paidAmount, 182);
    assert.deepEqual(archived.lineItems, frozen.lineItems);
    assert.equal(archived.pricingVersion, 'batch2-default');
    assert.equal(archived.markedPaidAt.getTime(), frozen.markedPaidAt.getTime());
    assert.equal(archived.markedPaidBy, frozen.markedPaidBy);
    assert.ok(archived.unmarkedAt instanceof Date);
    assert.ok(archived.unmarkedBy);
    assert.equal(reopened.manualLineItems.length, 1);

    // Unmarking an unpaid day is a no-op that preserves history.
    const unmarkAgain = await unmarkPaid(adminToken, bucket);
    assert.equal(unmarkAgain.body.data.changed, false);
    assert.equal(
      (await CleaningPayment.findOne({ date: sofiaStart, propertyKind: 'valley' }).lean())
        .paidSnapshotHistory.length,
      1
    );

    // Reopened day recalculates live under the new policy and still carries deep cleaning.
    const live = await summary(adminToken, bucket);
    assert.equal(live.body.data.isSnapshot, false);
    assert.equal(live.body.data.totalAmount, 99 + 150);

    await activateDefaultValleyPolicy('batch2-default-restored');
  });

  await t.test('cleaner payout breakdown shows deep cleaning in the global total', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    await addDeep(adminToken, bucket);
    const res = await call('get', `/api/ops/cleaning/payout-summary?date=${bucket.date}`, cleanerToken);
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.zones.valley.totalAmount, 182);
    assert.equal(deepItems(res.body.data.lineItems).length, 1);
  });

  await t.test('12. only payment_write roles can add/remove deep cleaning', async () => {
    const bucket = await seedValleyDay({ aframes: 1 });
    for (const token of [cleanerToken, operatorToken]) {
      assert.equal((await addDeep(token, bucket)).status, 403);
      assert.equal((await removeDeep(token, bucket)).status, 403);
    }
    assert.equal(
      await CleaningPayment.countDocuments({
        date: normalizeDateToSofiaDayStart(bucket.date),
        propertyKind: 'valley'
      }),
      0
    );

    const added = await addDeep(adminToken, bucket);
    assert.equal(added.status, 200);
    assert.equal(added.body.data.totalAmount, 182);
    assert.equal((await removeDeep(cleanerToken, bucket)).status, 403);
    const removed = await removeDeep(adminToken, bucket);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.totalAmount, 32);
  });

  await t.test('invalid bucket input is rejected', async () => {
    assert.equal((await addDeep(adminToken, { date: 'nope', propertyKind: 'valley' })).status, 400);
    assert.equal((await addDeep(adminToken, { date: nextDayIso(), propertyKind: 'x' })).status, 400);
  });
});
