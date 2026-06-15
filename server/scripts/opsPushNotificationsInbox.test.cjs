/**
 * OPS-PUSH-5 — notification inbox API tests.
 * Run: npm run test:ops-push (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const OpsUser = require('../models/OpsUser');
const OpsNotification = require('../models/OpsNotification');
const OpsPushSubscription = require('../models/OpsPushSubscription');
const { createOpsUser } = require('../services/ops/opsUserService');
const { createToken } = require('../middleware/adminAuth');

let mongoServer;
let app;

async function login(email, password) {
  const res = await request(app).post('/api/admin/login').send({ username: email, password });
  assert.equal(res.status, 200, res.body?.message);
  return res.body.token;
}

async function authed(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) {
    return req.send(body);
  }
  return req;
}

async function seedNotification({ opsUserId, title, message, url, readAt = null, createdAt }) {
  const payload = {
    opsUserId,
    title,
    body: message,
    url,
    source: 'test_inbox',
    readAt
  };
  if (createdAt) {
    payload.createdAt = createdAt;
  }
  return OpsNotification.create(payload);
}

function legacyAdminToken() {
  const now = Math.floor(Date.now() / 1000);
  return createToken(
    {
      sub: 'legacy-admin-subject',
      role: 'admin',
      modules: ['*'],
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: 'legacy-inbox-test'
    },
    process.env.ADMIN_JWT_SECRET
  );
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-5-inbox-test';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsNotification.syncIndexes();

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await OpsNotification.deleteMany({});
  await OpsPushSubscription.deleteMany({});
  await OpsUser.deleteMany({});
});

test('list scoped to current user', async () => {
  const admin = await createOpsUser({
    email: 'inbox.admin@test.local',
    name: 'Inbox Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  const cleaner = await createOpsUser({
    email: 'inbox.cleaner@test.local',
    name: 'Inbox Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  await seedNotification({
    opsUserId: admin.id,
    title: 'Admin alert',
    message: 'Admin body',
    url: '/ops/reservations/1'
  });
  await seedNotification({
    opsUserId: cleaner.id,
    title: 'Cleaner alert',
    message: 'Cleaner body',
    url: '/ops/cleaning'
  });

  const adminToken = await login('inbox.admin@test.local', 'pass-123456');
  const res = await authed('get', '/api/ops/notifications', adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.notifications.length, 1);
  assert.equal(res.body.data.notifications[0].title, 'Admin alert');
});

test('unreadOnly filter excludes read notifications', async () => {
  const admin = await createOpsUser({
    email: 'unread.filter@test.local',
    name: 'Unread Filter',
    password: 'pass-123456',
    role: 'admin'
  });

  await seedNotification({
    opsUserId: admin.id,
    title: 'Unread one',
    message: 'Body',
    url: '/ops'
  });
  await seedNotification({
    opsUserId: admin.id,
    title: 'Read one',
    message: 'Body',
    url: '/ops',
    readAt: new Date()
  });

  const token = await login('unread.filter@test.local', 'pass-123456');
  const res = await authed('get', '/api/ops/notifications?unreadOnly=1', token);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.notifications.length, 1);
  assert.equal(res.body.data.notifications[0].title, 'Unread one');
});

test('unread count scoped to current user', async () => {
  const admin = await createOpsUser({
    email: 'count.admin@test.local',
    name: 'Count Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  const cleaner = await createOpsUser({
    email: 'count.cleaner@test.local',
    name: 'Count Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  await seedNotification({
    opsUserId: admin.id,
    title: 'A1',
    message: 'B',
    url: '/ops'
  });
  await seedNotification({
    opsUserId: admin.id,
    title: 'A2',
    message: 'B',
    url: '/ops',
    readAt: new Date()
  });
  await seedNotification({
    opsUserId: cleaner.id,
    title: 'C1',
    message: 'B',
    url: '/ops/cleaning'
  });

  const adminToken = await login('count.admin@test.local', 'pass-123456');
  const res = await authed('get', '/api/ops/notifications/unread-count', adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.unreadCount, 1);
});

test('mark one read own-user only', async () => {
  const admin = await createOpsUser({
    email: 'read.one@test.local',
    name: 'Read One',
    password: 'pass-123456',
    role: 'admin'
  });

  const note = await seedNotification({
    opsUserId: admin.id,
    title: 'Mark me',
    message: 'Body',
    url: '/ops/reservations/abc'
  });

  const token = await login('read.one@test.local', 'pass-123456');
  const res = await authed('patch', `/api/ops/notifications/${note._id}/read`, token);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.notification.readAt);
  assert.equal(res.body.data.notification.id, String(note._id));

  const again = await authed('patch', `/api/ops/notifications/${note._id}/read`, token);
  assert.equal(again.status, 200);
  assert.ok(again.body.data.notification.readAt);
});

test('cross-user mark read returns 404', async () => {
  const admin = await createOpsUser({
    email: 'owner.admin@test.local',
    name: 'Owner Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  await createOpsUser({
    email: 'other.cleaner@test.local',
    name: 'Other Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const note = await seedNotification({
    opsUserId: admin.id,
    title: 'Private',
    message: 'Body',
    url: '/ops'
  });

  const cleanerToken = await login('other.cleaner@test.local', 'pass-123456');
  const res = await authed('patch', `/api/ops/notifications/${note._id}/read`, cleanerToken);
  assert.equal(res.status, 404);

  const unchanged = await OpsNotification.findById(note._id).lean();
  assert.equal(unchanged.readAt, null);
});

test('mark all read affects only current user', async () => {
  const admin = await createOpsUser({
    email: 'readall.admin@test.local',
    name: 'Read All Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  const cleaner = await createOpsUser({
    email: 'readall.cleaner@test.local',
    name: 'Read All Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  await seedNotification({
    opsUserId: admin.id,
    title: 'Admin unread',
    message: 'Body',
    url: '/ops'
  });
  await seedNotification({
    opsUserId: cleaner.id,
    title: 'Cleaner unread',
    message: 'Body',
    url: '/ops/cleaning'
  });

  const adminToken = await login('readall.admin@test.local', 'pass-123456');
  const res = await authed('post', '/api/ops/notifications/read-all', adminToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.modifiedCount, 1);

  assert.equal(
    await OpsNotification.countDocuments({ opsUserId: admin.id, readAt: null }),
    0
  );
  assert.equal(
    await OpsNotification.countDocuments({ opsUserId: cleaner.id, readAt: null }),
    1
  );
});

test('pagination limit and cursor', async () => {
  const admin = await createOpsUser({
    email: 'page.admin@test.local',
    name: 'Page Admin',
    password: 'pass-123456',
    role: 'admin'
  });

  const base = Date.now();
  for (let i = 0; i < 5; i += 1) {
    await seedNotification({
      opsUserId: admin.id,
      title: `Note ${i}`,
      message: 'Body',
      url: '/ops',
      createdAt: new Date(base - i * 1000)
    });
  }

  const token = await login('page.admin@test.local', 'pass-123456');
  const page1 = await authed('get', '/api/ops/notifications?limit=2', token);
  assert.equal(page1.status, 200);
  assert.equal(page1.body.data.notifications.length, 2);
  assert.equal(page1.body.data.notifications[0].title, 'Note 0');
  assert.ok(page1.body.data.nextCursor);

  const page2 = await authed(
    'get',
    `/api/ops/notifications?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
    token
  );
  assert.equal(page2.status, 200);
  assert.equal(page2.body.data.notifications.length, 2);
  assert.equal(page2.body.data.notifications[0].title, 'Note 2');
});

test('cleaner can access /notifications because route is module-exempt', async () => {
  await createOpsUser({
    email: 'exempt.cleaner@test.local',
    name: 'Exempt Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const token = await login('exempt.cleaner@test.local', 'pass-123456');
  const res = await authed('get', '/api/ops/notifications', token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.notifications, []);
});

test('invalid legacy session id returns 403', async () => {
  const token = legacyAdminToken();
  const res = await authed('get', '/api/ops/notifications', token);
  assert.equal(res.status, 403);
  assert.match(String(res.body.message), /OPS user/i);
});

test('response does not expose opsUserId, dedupeKey, endpoint, or keys', async () => {
  const admin = await createOpsUser({
    email: 'safe.admin@test.local',
    name: 'Safe Admin',
    password: 'pass-123456',
    role: 'admin'
  });

  await OpsNotification.create({
    opsUserId: admin.id,
    title: 'Safe row',
    body: 'Body',
    url: '/ops/reservations/1',
    source: 'ops_push_test',
    dedupeKey: 'dedupe-key-secret'
  });
  await OpsPushSubscription.create({
    opsUserId: admin.id,
    endpoint: 'https://push.example.test/subscription/inbox',
    keys: { p256dh: 'p256dh-secret', auth: 'auth-secret' }
  });

  const token = await login('safe.admin@test.local', 'pass-123456');
  const list = await authed('get', '/api/ops/notifications', token);
  assert.equal(list.status, 200);
  assert.equal(list.body.data.notifications.length, 1);
  const row = list.body.data.notifications[0];
  const rowJson = JSON.stringify(row);
  assert.equal(rowJson.includes('dedupeKey'), false);
  assert.equal(rowJson.includes('opsUserId'), false);
  assert.equal(rowJson.includes('p256dh'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'endpoint'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'keys'), false);

  const keys = Object.keys(row).sort();
  assert.deepEqual(keys, ['body', 'createdAt', 'id', 'readAt', 'source', 'title', 'url'].sort());
});

test('requireOpsModuleAccess exempts /notifications for cleaners', () => {
  const { isModuleExemptPath } = require('../middleware/requireOpsModuleAccess');
  assert.equal(isModuleExemptPath('/notifications'), true);
  assert.equal(isModuleExemptPath('/notifications/unread-count'), true);
  assert.equal(isModuleExemptPath('/notifications/abc/read'), true);
});
