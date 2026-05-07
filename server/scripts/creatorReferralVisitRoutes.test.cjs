const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const creatorReferralVisitRoutes = require('../routes/creatorReferralVisitRoutes');
const CreatorPartner = require('../models/CreatorPartner');
const CreatorReferralVisit = require('../models/CreatorReferralVisit');

let mongoServer;
let app;

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/creator-referral-visits', creatorReferralVisitRoutes);
  return instance;
}

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createActiveCreator(referralCode = 'diana.bosa') {
  const slug = uniqueKey('creator');
  return CreatorPartner.create({
    name: 'Diana',
    slug,
    status: 'active',
    referral: { code: referralCode, cookieDays: 60 },
    promo: { code: null, promoCodeId: null },
    commission: { rateBps: 1000, basis: 'accommodation_net', eligibleAfter: 'stay_completed' }
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    serverSelectionTimeoutMS: 10000
  });
  await CreatorReferralVisit.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await CreatorPartner.deleteMany({});
  await CreatorReferralVisit.deleteMany({});
});

test('valid referral visit creates row with linked creator and visitCount 1', async () => {
  const creator = await createActiveCreator('diana.bosa');
  const visitorKey = uniqueKey('visitor');
  const sessionKey = uniqueKey('session');

  const response = await request(app).post('/api/creator-referral-visits').send({
    referralCode: 'diana.bosa',
    landingPath: '/?ref=diana.bosa',
    referrer: '',
    visitorKey,
    sessionKey
  });

  assert.equal(response.status, 202);
  assert.equal(response.body?.success, true);

  const rows = await CreatorReferralVisit.find({ referralCode: 'diana.bosa', visitorKey }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].referralCode, 'diana.bosa');
  assert.equal(String(rows[0].creatorPartnerId), String(creator._id));
  assert.equal(rows[0].visitCount, 1);
});

test('same visitor/day increments existing row instead of creating a duplicate', async () => {
  await createActiveCreator('diana.bosa');
  const visitorKey = uniqueKey('visitor');
  const sessionKey = uniqueKey('session');

  const payload = {
    referralCode: 'diana.bosa',
    landingPath: '/?ref=diana.bosa',
    referrer: '',
    visitorKey,
    sessionKey
  };

  const first = await request(app).post('/api/creator-referral-visits').send(payload);
  const second = await request(app).post('/api/creator-referral-visits').send(payload);
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  assert.equal(first.body?.success, true);
  assert.equal(second.body?.success, true);

  const rows = await CreatorReferralVisit.find({ referralCode: 'diana.bosa', visitorKey }).lean();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].visitCount >= 2);
  assert.equal(rows[0].visitCount, 2);
});

test('session-only path works and stores a row without operator conflict', async () => {
  await createActiveCreator('diana.bosa');
  const sessionKey = uniqueKey('session-only');

  const response = await request(app).post('/api/creator-referral-visits').send({
    referralCode: 'diana.bosa',
    landingPath: '/?ref=diana.bosa',
    referrer: '',
    sessionKey
  });

  assert.equal(response.status, 202);
  assert.equal(response.body?.success, true);

  const row = await CreatorReferralVisit.findOne({ referralCode: 'diana.bosa', sessionKey }).lean();
  assert.ok(row);
});

test('invalid referral is rejected with 400 and no visit row is created', async () => {
  await createActiveCreator('diana.bosa');

  const response = await request(app).post('/api/creator-referral-visits').send({
    referralCode: 'diana bosa',
    landingPath: '/?ref=diana bosa'
  });

  assert.equal(response.status, 400);
  const rowCount = await CreatorReferralVisit.countDocuments({});
  assert.equal(rowCount, 0);
});

test('dot and @ referral forms normalize and store as diana.bosa', async () => {
  await createActiveCreator('diana.bosa');

  const visitorA = uniqueKey('visitor-dot');
  const visitorB = uniqueKey('visitor-at');

  const dotResponse = await request(app).post('/api/creator-referral-visits').send({
    referralCode: 'diana.bosa',
    landingPath: '/?ref=diana.bosa',
    visitorKey: visitorA,
    sessionKey: uniqueKey('session-dot')
  });
  const atResponse = await request(app).post('/api/creator-referral-visits').send({
    referralCode: '@diana.bosa',
    landingPath: '/?ref=@diana.bosa',
    visitorKey: visitorB,
    sessionKey: uniqueKey('session-at')
  });

  assert.equal(dotResponse.status, 202);
  assert.equal(atResponse.status, 202);
  assert.equal(dotResponse.body?.success, true);
  assert.equal(atResponse.body?.success, true);

  const rows = await CreatorReferralVisit.find({ visitorKey: { $in: [visitorA, visitorB] } }).lean();
  assert.equal(rows.length, 2);
  rows.forEach((row) => assert.equal(row.referralCode, 'diana.bosa'));
});

test('route update object does not duplicate fields across $setOnInsert and $set', async () => {
  await createActiveCreator('diana.bosa');
  const visitorKey = uniqueKey('visitor-introspect');
  const sessionKey = uniqueKey('session-introspect');

  const original = CreatorReferralVisit.findOneAndUpdate.bind(CreatorReferralVisit);
  let capturedUpdate = null;

  CreatorReferralVisit.findOneAndUpdate = async (filter, update, options) => {
    capturedUpdate = update;
    return original(filter, update, options);
  };

  try {
    const response = await request(app).post('/api/creator-referral-visits').send({
      referralCode: 'diana.bosa',
      landingPath: '/?ref=diana.bosa',
      referrer: '',
      visitorKey,
      sessionKey
    });
    assert.equal(response.status, 202);
    assert.equal(response.body?.success, true);
  } finally {
    CreatorReferralVisit.findOneAndUpdate = original;
  }

  assert.ok(capturedUpdate);
  const insertKeys = Object.keys(capturedUpdate.$setOnInsert || {});
  const setKeys = Object.keys(capturedUpdate.$set || {});
  const duplicateKeys = insertKeys.filter((key) => setKeys.includes(key));
  assert.deepEqual(duplicateKeys, []);
});

test('CreatorReferralVisit partial indexes are Mongo-compatible and omit $ne', async () => {
  const indexes = CreatorReferralVisit.schema.indexes();

  const visitorIdx = indexes.find(([spec]) => spec?.referralCode === 1 && spec?.visitorKey === 1 && spec?.dayBucket === 1);
  const sessionIdx = indexes.find(([spec]) => spec?.referralCode === 1 && spec?.sessionKey === 1 && spec?.dayBucket === 1);

  assert.ok(visitorIdx, 'Missing referralCode/visitorKey/dayBucket index');
  assert.ok(sessionIdx, 'Missing referralCode/sessionKey/dayBucket index');

  const visitorPartial = visitorIdx[1]?.partialFilterExpression?.visitorKey || {};
  const sessionPartial = sessionIdx[1]?.partialFilterExpression?.sessionKey || {};

  assert.equal(visitorPartial.$exists, true);
  assert.equal(visitorPartial.$type, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(visitorPartial, '$ne'), false);

  assert.equal(sessionPartial.$exists, true);
  assert.equal(sessionPartial.$type, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(sessionPartial, '$ne'), false);

  await CreatorReferralVisit.syncIndexes();
});
