/**
 * OPS-PUSH-1 — platform capability tests.
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
const OpsPushSubscription = require('../models/OpsPushSubscription');
const OpsNotification = require('../models/OpsNotification');
const { createOpsUser } = require('../services/ops/opsUserService');
const {
  sendOpsPush,
  sendOpsPushSafely,
  resolveTargetUserIds,
  OPS_PUSH_DELIVERY_OPTIONS,
  __resetWebPushForTesting,
  __setWebPushModuleForTesting,
  __setLogSendAttemptForTesting,
  __resetLogSendAttemptForTesting
} = require('../services/ops/push/opsPushService');
const { isVapidConfigured } = require('../services/ops/push/opsPushVapidConfig');

let mongoServer;
let app;
let vapidKeys;

const SUBSCRIPTION_A = {
  endpoint: 'https://push.example.test/subscription/a',
  keys: { p256dh: 'key-a', auth: 'auth-a' }
};

const SUBSCRIPTION_B = {
  endpoint: 'https://push.example.test/subscription/b',
  keys: { p256dh: 'key-b', auth: 'auth-b' }
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

async function authed(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) {
    return req.send(body);
  }
  return req;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-1-test-secret';
  vapidKeys = webpush.generateVAPIDKeys();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsNotification.syncIndexes();
  await OpsPushSubscription.syncIndexes();

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
  __resetWebPushForTesting();
  __resetLogSendAttemptForTesting();
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_VAPID_SUBJECT;

  await OpsNotification.deleteMany({});
  await OpsPushSubscription.deleteMany({});
  await OpsUser.deleteMany({});
});

test('VAPID unset -> sendOpsPush no-op without throw', async () => {
  assert.equal(isVapidConfigured(), false);
  const result = await sendOpsPush({
    opsUserIds: [new mongoose.Types.ObjectId()],
    title: 'Test',
    body: 'Body',
    url: '/ops',
    source: 'test'
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'vapid_not_configured');
  assert.equal(await OpsNotification.countDocuments({}), 0);
});

test('VAPID set -> pushes once per active subscription (mock web-push)', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  const admin = await OpsUser.create({
    email: 'admin-push@test.local',
    name: 'Admin Push',
    passwordHash: 'hash',
    role: 'admin',
    isActive: true
  });

  await OpsPushSubscription.create({
    opsUserId: admin._id,
    ...SUBSCRIPTION_A
  });
  await OpsPushSubscription.create({
    opsUserId: admin._id,
    ...SUBSCRIPTION_B
  });

  const calls = [];
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification(endpoint, payload, options) {
      calls.push({ endpoint, payload, options });
      return Promise.resolve();
    }
  });

  const result = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'New booking',
    body: 'Booking created',
    url: '/ops/reservations/1',
    tag: 'booking',
    dedupeKey: 'booking:1',
    source: 'booking_created'
  });

  assert.equal(result.skipped, false);
  assert.equal(result.notificationsCreated, 1);
  assert.equal(result.pushAttempts, 2);
  assert.equal(result.pushAccepted, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, OPS_PUSH_DELIVERY_OPTIONS);
  assert.deepEqual(calls[1].options, OPS_PUSH_DELIVERY_OPTIONS);
  assert.equal(calls[0].options.urgency, 'high');
  assert.equal(calls[0].options.TTL, 86400);
  assert.equal(await OpsNotification.countDocuments({ opsUserId: admin._id }), 1);
});

test('sendOpsPush logs structured send_attempt for accepted pushes', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  const admin = await OpsUser.create({
    email: 'admin-log@test.local',
    name: 'Admin Log',
    passwordHash: 'hash',
    role: 'admin',
    isActive: true
  });

  const sub = await OpsPushSubscription.create({
    opsUserId: admin._id,
    ...SUBSCRIPTION_A
  });

  const logCalls = [];
  __setLogSendAttemptForTesting((fields) => logCalls.push(fields));
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      return Promise.resolve();
    }
  });

  await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Log test',
    body: 'Body',
    url: '/ops',
    dedupeKey: 'log:test:1',
    source: 'ops_push_test'
  });

  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].outcome, 'accepted');
  assert.equal(logCalls[0].sourceEvent, 'ops_push_test');
  assert.equal(logCalls[0].subscriptionId, String(sub._id));
  assert.equal(logCalls[0].opsUserId, String(admin._id));
  assert.equal(logCalls[0].dedupeKey, 'log:test:1');
  assert.equal(logCalls[0].endpoint, undefined);
});

test('410 Gone invalidates subscription and excludes it on next send', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  const admin = await OpsUser.create({
    email: 'admin-410@test.local',
    name: 'Admin 410',
    passwordHash: 'hash',
    role: 'admin'
  });

  const sub = await OpsPushSubscription.create({
    opsUserId: admin._id,
    ...SUBSCRIPTION_A
  });

  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      const err = new Error('gone');
      err.statusCode = 410;
      return Promise.reject(err);
    }
  });

  const first = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Alert',
    body: 'One',
    url: '/ops',
    source: 'test'
  });
  assert.equal(first.pushFailed, 1);
  assert.equal(first.subscriptionsInvalidated, 1);

  const reloaded = await OpsPushSubscription.findById(sub._id).lean();
  assert.ok(reloaded.invalidatedAt);

  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      return Promise.resolve();
    }
  });
  __resetWebPushForTesting();
  const calls = [];
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      calls.push(1);
      return Promise.resolve();
    }
  });

  const second = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Alert',
    body: 'Two',
    url: '/ops',
    source: 'test'
  });
  assert.equal(second.pushAttempts, 0);
});

test('dedupeKey prevents duplicate OpsNotification and second push fan-out', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  const admin = await OpsUser.create({
    email: 'admin-dedupe@test.local',
    name: 'Admin Dedupe',
    passwordHash: 'hash',
    role: 'admin'
  });
  await OpsPushSubscription.create({ opsUserId: admin._id, ...SUBSCRIPTION_A });

  let sendCount = 0;
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      sendCount += 1;
      return Promise.resolve();
    }
  });

  const first = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Dedupe',
    body: 'First',
    url: '/ops',
    dedupeKey: 'event:1',
    source: 'test'
  });
  assert.equal(first.notificationsCreated, 1);
  assert.equal(sendCount, 1);

  const second = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Dedupe',
    body: 'Second',
    url: '/ops',
    dedupeKey: 'event:1',
    source: 'test'
  });
  assert.equal(second.notificationsDeduped, 1);
  assert.equal(second.pushAttempts, 0);
  assert.equal(sendCount, 1);
  assert.equal(await OpsNotification.countDocuments({ opsUserId: admin._id }), 1);
});

test('notifications without dedupeKey never collide', async () => {
  const admin = await OpsUser.create({
    email: 'admin-null-dedupe@test.local',
    name: 'Admin Null Dedupe',
    passwordHash: 'hash',
    role: 'admin'
  });

  await OpsNotification.create({
    opsUserId: admin._id,
    title: 'A',
    body: 'A',
    url: '/ops',
    source: 'test'
  });
  await OpsNotification.create({
    opsUserId: admin._id,
    title: 'B',
    body: 'B',
    url: '/ops',
    source: 'test'
  });

  assert.equal(await OpsNotification.countDocuments({ opsUserId: admin._id }), 2);
});

test('sanitizeOpsPushClickUrl rejects external and non-OPS paths', async () => {
  const { sanitizeOpsPushClickUrl } = await import('../../shared/ops/sanitizeOpsPushClickUrl.js');
  const origin = 'https://booking.driftdwells.com';

  assert.equal(sanitizeOpsPushClickUrl('/ops/cleaning', origin), '/ops/cleaning');
  assert.equal(sanitizeOpsPushClickUrl('/ops', origin), '/ops');
  assert.equal(sanitizeOpsPushClickUrl('https://evil.example/phish', origin), '/ops');
  assert.equal(sanitizeOpsPushClickUrl('/bookings/1', origin), '/ops');
  assert.equal(sanitizeOpsPushClickUrl(null, origin), '/ops');
  assert.equal(
    sanitizeOpsPushClickUrl('https://booking.driftdwells.com/ops/reservations/1', origin),
    '/ops/reservations/1'
  );
});

test('role cleaner without propertyKind skips safely with no notification or push', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  await OpsUser.create({
    email: 'orphan-cleaner@test.local',
    name: 'Orphan Cleaner',
    passwordHash: 'hash',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  let sendCount = 0;
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      sendCount += 1;
      return Promise.resolve();
    }
  });

  const result = await sendOpsPush({
    role: 'cleaner',
    title: 'Cleaning',
    body: 'Tomorrow',
    url: '/ops/cleaning',
    source: 'test'
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'cleaner_property_kind_required');
  assert.equal(result.notificationsCreated, 0);
  assert.equal(result.pushAttempts, 0);
  assert.equal(sendCount, 0);
  assert.equal(await OpsNotification.countDocuments({}), 0);

  const cleaner = await OpsUser.findOne({ email: 'orphan-cleaner@test.local' }).lean();
  const explicit = await sendOpsPush({
    opsUserIds: [cleaner._id],
    title: 'Cleaning',
    body: 'Direct',
    url: '/ops/cleaning',
    source: 'test'
  });
  assert.equal(explicit.skipped, false);
  assert.equal(explicit.notificationsCreated, 1);
});

test('role targeting resolves admins and cleaners by propertyKind', async () => {
  const admin = await OpsUser.create({
    email: 'role-admin@test.local',
    name: 'Role Admin',
    passwordHash: 'hash',
    role: 'admin'
  });
  const cabinCleaner = await OpsUser.create({
    email: 'cleaner-cabin@test.local',
    name: 'Cabin Cleaner',
    passwordHash: 'hash',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });
  await OpsUser.create({
    email: 'cleaner-valley@test.local',
    name: 'Valley Cleaner',
    passwordHash: 'hash',
    role: 'cleaner',
    propertyKinds: ['valley']
  });

  const adminIds = await resolveTargetUserIds({ role: 'admin' });
  assert.deepEqual(
    adminIds.map(String).sort(),
    [String(admin._id)].sort()
  );

  const cabinIds = await resolveTargetUserIds({ role: 'cleaner', propertyKind: 'cabin' });
  assert.deepEqual(cabinIds.map(String), [String(cabinCleaner._id)]);

  const noKind = await resolveTargetUserIds({ role: 'cleaner' });
  assert.deepEqual(noKind, []);
});

test('sendOpsPushSafely never throws into caller', async () => {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

  const result = await sendOpsPushSafely({
    title: '',
    body: '',
    url: '/ops'
  });
  assert.equal(result.error, true);
  assert.match(String(result.message), /required/i);
});

test('push subscription routes enforce ownership and module-exempt access', async () => {
  await createOpsUser({
    email: 'cleaner.push@test.local',
    name: 'Cleaner Push',
    password: 'cleaner-pass-123',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });
  await createOpsUser({
    email: 'admin.push@test.local',
    name: 'Admin Push Route',
    password: 'admin-pass-123',
    role: 'admin'
  });

  const cleanerToken = await login('cleaner.push@test.local', 'cleaner-pass-123');
  const adminToken = await login('admin.push@test.local', 'admin-pass-123');

  const registerCleaner = await authed('post', '/api/ops/push-subscriptions', cleanerToken, SUBSCRIPTION_A);
  assert.equal(registerCleaner.status, 201, JSON.stringify(registerCleaner.body));
  assert.equal(registerCleaner.body.success, true);
  assert.ok(registerCleaner.body.data.id);

  const registerAdmin = await authed('post', '/api/ops/push-subscriptions', adminToken, SUBSCRIPTION_B);
  assert.equal(registerAdmin.status, 201);
  const adminSubId = registerAdmin.body.data.id;
  const cleanerSub = await OpsPushSubscription.findOne({ endpoint: SUBSCRIPTION_A.endpoint }).lean();
  const cleanerSubId = String(cleanerSub._id);
  assert.ok(cleanerSubId);

  const crossDelete = await authed('delete', `/api/ops/push-subscriptions/${adminSubId}`, cleanerToken);
  assert.equal(crossDelete.status, 404);
  assert.equal(await OpsPushSubscription.countDocuments({ _id: adminSubId }), 1);

  const ownDelete = await authed('delete', `/api/ops/push-subscriptions/${cleanerSubId}`, cleanerToken);
  assert.equal(ownDelete.status, 200);
  assert.equal(await OpsPushSubscription.countDocuments({ _id: cleanerSubId }), 0);
});

test('requireOpsModuleAccess exempts /push-subscriptions for cleaners', () => {
  const { isModuleExemptPath } = require('../middleware/requireOpsModuleAccess');
  assert.equal(isModuleExemptPath('/push-subscriptions'), true);
  assert.equal(isModuleExemptPath('/push-subscriptions/abc'), true);
  assert.equal(isModuleExemptPath('/push-config'), true);
});

test('GET /push-config returns pushEnabled and public key only', async () => {
  const saved = saveVapidEnv();
  try {
    delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_SUBJECT;

    await createOpsUser({
      email: 'config.off@test.local',
      name: 'Config Off',
      password: 'pass-123456',
      role: 'operator'
    });
    const token = await login('config.off@test.local', 'pass-123456');
    const off = await authed('get', '/api/ops/push-config', token);
    assert.equal(off.status, 200);
    assert.equal(off.body.data.pushEnabled, false);
    assert.equal(off.body.data.vapidPublicKey, null);

    process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
    process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@test.local';

    const on = await authed('get', '/api/ops/push-config', token);
    assert.equal(on.status, 200);
    assert.equal(on.body.data.pushEnabled, true);
    assert.equal(on.body.data.vapidPublicKey, vapidKeys.publicKey);
    const json = JSON.stringify(on.body);
    assert.equal(json.includes(vapidKeys.privateKey), false);
    assert.equal(json.includes('privateKey'), false);
    assert.equal(json.includes('WEB_PUSH_VAPID_SUBJECT'), false);
  } finally {
    restoreVapidEnv(saved);
  }
});

test('GET /push-subscriptions/mine is scoped to session user and omits keys', async () => {
  await createOpsUser({
    email: 'mine.admin@test.local',
    name: 'Mine Admin',
    password: 'pass-123456',
    role: 'admin'
  });
  await createOpsUser({
    email: 'mine.cleaner@test.local',
    name: 'Mine Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const adminToken = await login('mine.admin@test.local', 'pass-123456');
  const cleanerToken = await login('mine.cleaner@test.local', 'pass-123456');

  const adminRegister = await authed('post', '/api/ops/push-subscriptions', adminToken, SUBSCRIPTION_A);
  assert.equal(adminRegister.status, 201);
  const cleanerRegister = await authed('post', '/api/ops/push-subscriptions', cleanerToken, SUBSCRIPTION_B);
  assert.equal(cleanerRegister.status, 201);

  const adminMine = await authed('get', '/api/ops/push-subscriptions/mine', adminToken);
  assert.equal(adminMine.status, 200);
  assert.equal(adminMine.body.data.subscriptions.length, 1);
  assert.equal(adminMine.body.data.subscriptions[0].endpoint, SUBSCRIPTION_A.endpoint);
  assert.equal(adminMine.body.data.subscriptions[0].keys, undefined);
  const adminJson = JSON.stringify(adminMine.body);
  assert.equal(adminJson.includes('p256dh'), false);
  assert.equal(adminJson.includes('"auth"'), false);

  const cleanerMine = await authed('get', '/api/ops/push-subscriptions/mine', cleanerToken);
  assert.equal(cleanerMine.status, 200);
  assert.equal(cleanerMine.body.data.subscriptions.length, 1);
  assert.equal(cleanerMine.body.data.subscriptions[0].endpoint, SUBSCRIPTION_B.endpoint);
});
