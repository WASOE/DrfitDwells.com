/**
 * OPS-PUSH-7 — admin self-test push notification.
 * Run: npm run test:ops-push (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const webpush = require('web-push');

const OpsUser = require('../models/OpsUser');
const OpsNotification = require('../models/OpsNotification');
const OpsPushSubscription = require('../models/OpsPushSubscription');
const { createOpsUser } = require('../services/ops/opsUserService');
const { createToken } = require('../middleware/adminAuth');
const {
  __resetWebPushForTesting,
  __setWebPushModuleForTesting
} = require('../services/ops/push/opsPushService');
const {
  buildTestDedupeKey,
  sendOpsPushTestNotification
} = require('../services/ops/push/opsPushTestNotificationService');

let mongoServer;
let app;
let vapidKeys;

const SUBSCRIPTION = {
  endpoint: 'https://push.example.test/subscription/test-self',
  keys: { p256dh: 'key-test', auth: 'auth-test' }
};

function saveVapidEnv() {
  return {
    public: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    private: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: process.env.WEB_PUSH_VAPID_SUBJECT
  };
}

function restoreVapidEnv(saved) {
  if (saved.public == null) delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  else process.env.WEB_PUSH_VAPID_PUBLIC_KEY = saved.public;
  if (saved.private == null) delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  else process.env.WEB_PUSH_VAPID_PRIVATE_KEY = saved.private;
  if (saved.subject == null) delete process.env.WEB_PUSH_VAPID_SUBJECT;
  else process.env.WEB_PUSH_VAPID_SUBJECT = saved.subject;
}

async function login(email, password) {
  const res = await request(app).post('/api/admin/login').send({ username: email, password });
  assert.equal(res.status, 200, res.body?.message);
  return res.body.token;
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
      jti: 'legacy-push-test'
    },
    process.env.ADMIN_JWT_SECRET
  );
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-7-test-secret';
  vapidKeys = webpush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsNotification.syncIndexes();
  await OpsPushSubscription.syncIndexes();

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];
  delete require.cache[require.resolve('../services/ops/push/opsPushVapidConfig')];
  delete require.cache[require.resolve('../services/ops/push/opsPushService')];
  delete require.cache[require.resolve('../services/ops/push/opsPushTestNotificationService')];
  delete require.cache[require.resolve('../routes/ops/modules/notificationsRoutes')];

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
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';
  __resetWebPushForTesting();
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      return Promise.resolve();
    }
  });
  await OpsNotification.deleteMany({});
  await OpsPushSubscription.deleteMany({});
  await OpsUser.deleteMany({});
});

test('buildTestDedupeKey is stable within the same minute', () => {
  const userId = new mongoose.Types.ObjectId();
  const now = new Date('2026-06-15T10:42:30.000Z');
  const keyA = buildTestDedupeKey(userId, now);
  const keyB = buildTestDedupeKey(userId, new Date('2026-06-15T10:42:59.000Z'));
  assert.equal(keyA, keyB);
  assert.match(keyA, /^ops_push_test:[a-f0-9]{24}:2026-06-15T10:42$/);
});

test('sendOpsPushTestNotification delivers push to active subscription', async () => {
  const admin = await createOpsUser({
    email: 'push.test.service@test.local',
    name: 'Push Test Service',
    password: 'pass-123456',
    role: 'admin'
  });
  await OpsPushSubscription.create({
    opsUserId: new mongoose.Types.ObjectId(admin.id),
    endpoint: SUBSCRIPTION.endpoint,
    keys: SUBSCRIPTION.keys,
    userAgent: 'Test/1.0'
  });

  const result = await sendOpsPushTestNotification({
    opsUserId: new mongoose.Types.ObjectId(admin.id)
  });

  assert.equal(result.success, true);
  assert.equal(result.notificationsCreated, 1);
  assert.equal(result.pushAttempts, 1);
  assert.equal(result.pushAccepted, 1);
  assert.equal(result.pushFailed, 0);
});

test('admin can send test notification to self with inbox row via API', async () => {
  const admin = await createOpsUser({
    email: 'push.test.admin@test.local',
    name: 'Push Test Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  await OpsPushSubscription.create({
    opsUserId: new mongoose.Types.ObjectId(admin.id),
    endpoint: SUBSCRIPTION.endpoint,
    keys: SUBSCRIPTION.keys,
    userAgent: 'Test/1.0'
  });

  const token = await login('push.test.admin@test.local', 'pass-123456');
  const res = await request(app)
    .post('/api/ops/notifications/test')
    .set('Authorization', `Bearer ${token}`)
    .send({ opsUserId: '507f1f77bcf86cd799439099' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.notificationsCreated, 1);
  assert.ok(res.body.data.pushAttempts >= 0);
  assert.equal(res.body.data.vapidPublicKey, undefined);
  assert.equal(res.body.data.endpoint, undefined);

  const rows = await OpsNotification.find({ opsUserId: admin.id }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'OPS push test');
  assert.equal(rows[0].source, 'ops_push_test');
  assert.equal(rows[0].url, '/ops');
});

test('duplicate test within the same minute returns 429', async () => {
  const admin = await createOpsUser({
    email: 'push.test.rate@test.local',
    name: 'Push Test Rate',
    password: 'pass-123456',
    role: 'admin'
  });

  const token = await login('push.test.rate@test.local', 'pass-123456');
  const first = await request(app)
    .post('/api/ops/notifications/test')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(first.status, 200);

  const second = await request(app)
    .post('/api/ops/notifications/test')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(second.status, 429);
  assert.equal(second.body.errorType, 'rate_limited');
  assert.equal(second.body.data.notificationsDeduped, 1);

  const rows = await OpsNotification.find({ opsUserId: admin.id }).lean();
  assert.equal(rows.length, 1);
});

test('cleaner receives 403 on test endpoint', async () => {
  await createOpsUser({
    email: 'push.test.cleaner@test.local',
    name: 'Push Test Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const token = await login('push.test.cleaner@test.local', 'pass-123456');
  const res = await request(app)
    .post('/api/ops/notifications/test')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.errorType, 'forbidden');
});

test('legacy env-admin token receives 403 without OpsUser id', async () => {
  const res = await request(app)
    .post('/api/ops/notifications/test')
    .set('Authorization', `Bearer ${legacyAdminToken()}`);

  assert.equal(res.status, 403);
});
