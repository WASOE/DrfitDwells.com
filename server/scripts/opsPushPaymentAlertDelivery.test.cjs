/**
 * Payment-alert delivery must not look like a dedupe skip unless a prior
 * push was actually accepted inside the dedupe window.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const webpush = require('web-push');

const OpsUser = require('../models/OpsUser');
const OpsPushSubscription = require('../models/OpsPushSubscription');
const OpsNotification = require('../models/OpsNotification');
const {
  sendOpsPush,
  __resetWebPushForTesting,
  __setWebPushModuleForTesting,
  __setLogSendAttemptForTesting,
  __resetLogSendAttemptForTesting
} = require('../services/ops/push/opsPushService');

const DEDUPE_KEY = 'payment_flow_immediate:/api/bookings/create-payment-intent::Payment setup failed';

let mongoServer;
let logs;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsNotification.syncIndexes();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  logs = [];
  __resetWebPushForTesting();
  __setLogSendAttemptForTesting((fields) => {
    logs.push(fields);
  });
  const vapid = webpush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:ops@example.test';
  await OpsNotification.deleteMany({});
  await OpsPushSubscription.deleteMany({});
  await OpsUser.deleteMany({});
});

test.afterEach(() => {
  __resetLogSendAttemptForTesting();
  __resetWebPushForTesting();
});

function dedupedLogs() {
  return logs.filter((entry) => entry.skipReason === 'deduped');
}

test('no subscription stays observable and is not reported as deduped', async () => {
  const admin = await OpsUser.create({
    email: 'admin-nosub@example.test',
    name: 'Admin',
    passwordHash: 'hash',
    role: 'admin'
  });

  const first = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(first.deliveryOutcome, 'no_subscription');
  assert.equal(first.notificationsDeduped, 0);
  assert.equal(dedupedLogs().length, 0);

  const second = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(second.deliveryOutcome, 'no_subscription');
  assert.equal(second.notificationsDeduped, 0);
  assert.equal(second.deliveryRetried, 1);
  assert.equal(dedupedLogs().length, 0);
  assert.ok(logs.some((entry) => entry.outcome === 'no_subscription'));
});

test('provider failure stays observable until a confirmed delivery, then dedupes', async () => {
  const admin = await OpsUser.create({
    email: 'admin-fail@example.test',
    name: 'Admin',
    passwordHash: 'hash',
    role: 'admin'
  });
  await OpsPushSubscription.create({
    opsUserId: admin._id,
    endpoint: 'https://push.example.test/subscription/a',
    keys: { p256dh: 'key-a', auth: 'auth-a' }
  });

  let mode = 'fail';
  __setWebPushModuleForTesting({
    setVapidDetails() {},
    sendNotification() {
      if (mode === 'fail') {
        const err = new Error('provider down');
        err.statusCode = 500;
        return Promise.reject(err);
      }
      return Promise.resolve();
    }
  });

  const failed = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(failed.deliveryOutcome, 'provider_failure');
  assert.equal(dedupedLogs().length, 0);

  const retried = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(retried.deliveryOutcome, 'provider_failure');
  assert.equal(retried.deliveryRetried, 1);
  assert.equal(dedupedLogs().length, 0);
  assert.ok(logs.some((entry) => entry.outcome === 'failed' || entry.outcome === 'provider_failure'));

  mode = 'ok';
  const delivered = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(delivered.deliveryOutcome, 'delivered');
  assert.equal(delivered.pushAccepted, 1);

  const deduped = await sendOpsPush({
    opsUserIds: [admin._id],
    title: 'Payment flow error',
    body: 'Payment initialization failed.',
    url: '/ops/manual-review',
    dedupeKey: DEDUPE_KEY,
    source: 'payment_flow_immediate'
  });
  assert.equal(deduped.deliveryOutcome, 'deduped');
  assert.equal(deduped.pushAttempts, 0);
  assert.equal(dedupedLogs().length, 1);
  assert.equal(dedupedLogs()[0].priorDeliveryConfirmed, true);
  assert.ok(dedupedLogs()[0].priorDeliveredAt);
});
