/**
 * OPS-PUSH-8 — admin read-only OPS push health endpoint.
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
const OpsPushScheduledJob = require('../models/OpsPushScheduledJob');
const { createOpsUser } = require('../services/ops/opsUserService');
const { createToken } = require('../middleware/adminAuth');

let mongoServer;
let app;
let vapidKeys;

function saveVapidEnv() {
  return {
    public: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    private: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: process.env.WEB_PUSH_VAPID_SUBJECT,
    scheduled: process.env.OPS_PUSH_SCHEDULED_ENABLED,
    worker: process.env.OPS_PUSH_SCHEDULER_WORKER_ENABLED
  };
}

function restoreVapidEnv(saved) {
  for (const [key, value] of Object.entries({
    WEB_PUSH_VAPID_PUBLIC_KEY: saved.public,
    WEB_PUSH_VAPID_PRIVATE_KEY: saved.private,
    WEB_PUSH_VAPID_SUBJECT: saved.subject,
    OPS_PUSH_SCHEDULED_ENABLED: saved.scheduled,
    OPS_PUSH_SCHEDULER_WORKER_ENABLED: saved.worker
  })) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
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
      jti: 'legacy-push-health'
    },
    process.env.ADMIN_JWT_SECRET
  );
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-8-test-secret';
  vapidKeys = webpush.generateVAPIDKeys();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsPushSubscription.syncIndexes();
  await OpsPushScheduledJob.syncIndexes();

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];
  delete require.cache[require.resolve('../services/ops/push/opsPushHealthService')];
  delete require.cache[require.resolve('../services/ops/push/opsPushVapidConfig')];

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
  process.env.OPS_PUSH_SCHEDULED_ENABLED = '1';
  process.env.OPS_PUSH_SCHEDULER_WORKER_ENABLED = '0';
  await OpsPushSubscription.deleteMany({});
  await OpsPushScheduledJob.deleteMany({});
  await OpsUser.deleteMany({});
});

test('admin receives OPS push health payload without secrets', async () => {
  const admin = await createOpsUser({
    email: 'health.admin@test.local',
    name: 'Health Admin',
    password: 'pass-123456',
    role: 'admin'
  });

  await OpsPushSubscription.create({
    opsUserId: new mongoose.Types.ObjectId(admin.id),
    endpoint: 'https://push.example.test/active',
    keys: { p256dh: 'a', auth: 'b' }
  });
  await OpsPushSubscription.create({
    opsUserId: new mongoose.Types.ObjectId(admin.id),
    endpoint: 'https://push.example.test/expired',
    keys: { p256dh: 'c', auth: 'd' },
    invalidatedAt: new Date()
  });

  const bookingId = new mongoose.Types.ObjectId();
  await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId,
    scheduledFor: new Date(),
    status: 'scheduled',
    dedupeKey: `ops_push_health:${bookingId}:scheduled`
  });
  await OpsPushScheduledJob.create({
    jobType: 'cleaning_checkout_day',
    bookingId,
    propertyKind: 'cabin',
    scheduledFor: new Date(),
    status: 'failed',
    dedupeKey: `ops_push_health:${bookingId}:failed`
  });
  await OpsPushScheduledJob.create({
    jobType: 'cleaning_checkout_day',
    bookingId,
    propertyKind: 'valley',
    scheduledFor: new Date(),
    status: 'cancelled',
    dedupeKey: `ops_push_health:${bookingId}:cancelled`
  });

  const token = await login('health.admin@test.local', 'pass-123456');
  const res = await request(app)
    .get('/api/ops/push-health')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  const data = res.body.data;
  assert.equal(data.pushEnabled, true);
  assert.equal(data.vapidPublicKeyPresent, true);
  assert.equal(data.scheduledEnabled, true);
  assert.equal(data.workerEnabled, false);
  assert.equal(typeof data.worker.running, 'boolean');
  assert.equal(data.subscriptions.active, 1);
  assert.equal(data.subscriptions.invalidated, 1);
  assert.equal(data.subscriptions.total, 2);
  assert.equal(data.scheduledJobs.scheduled, 1);
  assert.equal(data.scheduledJobs.failed, 1);
  assert.equal(data.scheduledJobs.canceled, 1);
  assert.equal(data.scheduledJobs.total, 3);
  assert.equal(data.vapidPublicKey, undefined);
  assert.equal(data.vapidPrivateKey, undefined);
});

test('cleaner receives 403 on push health endpoint', async () => {
  await createOpsUser({
    email: 'health.cleaner@test.local',
    name: 'Health Cleaner',
    password: 'pass-123456',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const token = await login('health.cleaner@test.local', 'pass-123456');
  const res = await request(app)
    .get('/api/ops/push-health')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.errorType, 'forbidden');
});

test('legacy env-admin token receives 403 without OpsUser id', async () => {
  const res = await request(app)
    .get('/api/ops/push-health')
    .set('Authorization', `Bearer ${legacyAdminToken()}`);

  assert.equal(res.status, 403);
});

test.after(() => {
  restoreVapidEnv(saveVapidEnv());
});
