/**
 * Batch C1 — OpsUser cleaner contact + propertyKind assignment fields.
 * Run: npm run test:ops-user-cleaner-contact (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const OpsUser = require('../models/OpsUser');
const {
  normalizeOpsUserPhone,
  normalizeOpsUserLocale,
  normalizePropertyKinds
} = require('../utils/opsUserContactFields');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await OpsUser.deleteMany({});
});

function legacyUserDoc(overrides = {}) {
  return {
    email: 'legacy@test.com',
    name: 'Legacy User',
    passwordHash: 'hash-placeholder',
    role: 'admin',
    ...overrides
  };
}

test('legacy OpsUser document without new fields validates and defaults apply', async () => {
  const created = await OpsUser.create(legacyUserDoc());
  const lean = await OpsUser.findById(created._id).lean();
  assert.equal(lean.phone, null);
  assert.equal(lean.locale, null);
  assert.deepEqual(lean.propertyKinds, []);
});

test('legacy cleaner row inserted via collection (no new keys) loads with defaults', async () => {
  const oid = new mongoose.Types.ObjectId();
  await OpsUser.collection.insertOne({
    _id: oid,
    email: 'inserted-cleaner@test.com',
    name: 'Inserted Cleaner',
    passwordHash: 'x',
    role: 'cleaner',
    modules: ['cleaning'],
    isActive: true,
    tokenVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  const doc = await OpsUser.findById(oid);
  assert.ok(doc.validateSync() == null);
  assert.equal(doc.phone, null);
  assert.equal(doc.locale, null);
  assert.deepEqual(doc.propertyKinds, []);
});

test('phone: normalizes BG local to E.164 on save', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'phone@test.com', role: 'cleaner' }),
    phone: '088 123 4567'
  });
  assert.match(user.phone, /^\+359/);
});

test('phone: accepts international + format', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'phone2@test.com', role: 'cleaner' }),
    phone: '+359881234567'
  });
  assert.equal(user.phone, '+359881234567');
});

test('phone: empty string becomes null', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'phone3@test.com', role: 'cleaner' }),
    phone: '   '
  });
  assert.equal(user.phone, null);
});

test('phone: rejects malformed', async () => {
  await assert.rejects(
    () =>
      OpsUser.create({
        ...legacyUserDoc({ email: 'badphone@test.com', role: 'cleaner' }),
        phone: 'not-a-phone'
      }),
    /valid E\.164/
  );
});

test('propertyKinds: dedupes and accepts cabin+valley for cleaner', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'kinds@test.com', role: 'cleaner' }),
    propertyKinds: ['cabin', 'valley', 'cabin']
  });
  assert.deepEqual(user.propertyKinds, ['cabin', 'valley']);
});

test('propertyKinds: empty array allowed for cleaner', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'emptykinds@test.com', role: 'cleaner' }),
    propertyKinds: []
  });
  assert.deepEqual(user.propertyKinds, []);
});

test('propertyKinds: rejects invalid enum', async () => {
  await assert.rejects(
    () =>
      OpsUser.create({
        ...legacyUserDoc({ email: 'badkinds@test.com', role: 'cleaner' }),
        propertyKinds: ['mountain']
      }),
    /propertyKinds entries must be one of/
  );
});

test('propertyKinds: cleared for admin even if provided', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'adminkinds@test.com', role: 'admin' }),
    propertyKinds: ['cabin']
  });
  assert.deepEqual(user.propertyKinds, []);
});

test('locale: accepts en and bg', async () => {
  const en = await OpsUser.create({
    ...legacyUserDoc({ email: 'en@test.com', role: 'cleaner' }),
    locale: 'en'
  });
  assert.equal(en.locale, 'en');
  const bg = await OpsUser.create({
    ...legacyUserDoc({ email: 'bg@test.com', role: 'cleaner' }),
    locale: 'BG'
  });
  assert.equal(bg.locale, 'bg');
});

test('locale: null and empty allowed', async () => {
  const user = await OpsUser.create({
    ...legacyUserDoc({ email: 'nolocale@test.com', role: 'cleaner' }),
    locale: null
  });
  assert.equal(user.locale, null);
});

test('locale: rejects invalid', async () => {
  await assert.rejects(
    () =>
      OpsUser.create({
        ...legacyUserDoc({ email: 'badlocale@test.com', role: 'cleaner' }),
        locale: 'de'
      }),
    /Locale must be one of/
  );
});

test('pure helpers: phone rejection', () => {
  const bad = normalizeOpsUserPhone('abc');
  assert.equal(bad.ok, false);
  const empty = normalizeOpsUserPhone('');
  assert.equal(empty.ok, true);
  assert.equal(empty.value, null);
});

test('pure helpers: propertyKinds dedupe', () => {
  const r = normalizePropertyKinds(['valley', 'cabin', 'valley']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, ['valley', 'cabin']);
});

test('pure helpers: locale', () => {
  assert.equal(normalizeOpsUserLocale(null).value, null);
  assert.equal(normalizeOpsUserLocale('en').value, 'en');
  assert.equal(normalizeOpsUserLocale('xx').ok, false);
});
