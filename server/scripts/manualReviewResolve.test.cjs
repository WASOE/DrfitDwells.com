/**
 * Manual review manual resolve — Batch 3 tests.
 * Run: cd server && npm run test:manual-review-resolve
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ManualReviewItem = require('../models/ManualReviewItem');
const EmailEvent = require('../models/EmailEvent');
const EmailDeliveryState = require('../models/EmailDeliveryState');
const GiftVoucherEvent = require('../models/GiftVoucherEvent');
const { createToken } = require('../middleware/adminAuth');
const { getDashboardReadModel } = require('../services/ops/readModels/dashboardReadModel');
const { resolveManualReviewItem } = require('../services/ops/ingestion/manualReviewService');
const { SMTP_TRANSPORT_UNHEALTHY } = require('../services/email/smtpHealthService');

let mongoServer;
let app;

function adminToken({ sub = 'admin-resolve-test', role = 'admin' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return createToken(
    {
      sub,
      role,
      modules: ['*'],
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `manual-review-resolve-${sub}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

function manualReviewAlerts(dashboardResult) {
  const alerts = dashboardResult?.dashboard?.alerts || dashboardResult?.sections?.actionNeeded || [];
  return alerts.filter((a) => a.type === 'manual_review');
}

async function createOpenItem(overrides = {}) {
  return ManualReviewItem.create({
    category: 'payment_flow_threshold_warning',
    severity: 'high',
    status: 'open',
    title: 'Test manual review item',
    details: 'Needs operator attention',
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'manual-review-resolve-test-secret';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ManualReviewItem.syncIndexes();
  await EmailEvent.syncIndexes();
  await EmailDeliveryState.syncIndexes();
  await GiftVoucherEvent.syncIndexes();

  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../routes/ops/modules/manualReviewRoutes')];
  delete require.cache[require.resolve('../middleware/adminAuth')];
  delete require.cache[require.resolve('../middleware/requireOpsModuleAccess')];

  app = express();
  app.use(express.json());
  app.use('/api/ops', require('../routes/ops/index'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await ManualReviewItem.deleteMany({});
  await EmailEvent.deleteMany({});
  await EmailDeliveryState.deleteMany({});
});

test('1. resolving open ManualReviewItem sets status resolved and resolution fields', async () => {
  const item = await createOpenItem();
  const token = adminToken();

  const res = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: 'Handled via phone call with guest' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'resolved');
  assert.equal(res.body.data.item.status, 'resolved');
  assert.equal(res.body.data.item.resolution.note, 'Handled via phone call with guest');
  assert.equal(res.body.data.item.resolution.resolvedBy, 'admin-resolve-test');

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.status, 'resolved');
  assert.ok(stored.resolution?.resolvedAt);
  assert.equal(stored.resolution.resolvedBy, 'admin-resolve-test');
  assert.equal(stored.resolution.note, 'Handled via phone call with guest');
});

test('2. resolving requires note', async () => {
  const item = await createOpenItem();
  const token = adminToken();

  const emptyRes = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: '' });
  assert.equal(emptyRes.status, 400);

  const shortRes = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: 'ab' });
  assert.equal(shortRes.status, 400);

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.status, 'open');
  assert.equal(stored.resolution?.note, null);
});

test('3. resolving already resolved item does not corrupt data', async () => {
  const resolvedAt = new Date('2026-06-01T10:00:00.000Z');
  const item = await ManualReviewItem.create({
    category: 'payment_flow_threshold_warning',
    severity: 'high',
    status: 'resolved',
    title: 'Already resolved',
    details: 'Done earlier',
    resolution: {
      resolvedAt,
      resolvedBy: 'ops_user_prev',
      note: 'Original resolution note'
    }
  });

  const token = adminToken();
  const res = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: 'Attempted second resolve' });

  assert.equal(res.status, 409);
  assert.equal(res.body.errorType, 'already_resolved');

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.status, 'resolved');
  assert.equal(stored.resolution.resolvedBy, 'ops_user_prev');
  assert.equal(stored.resolution.note, 'Original resolution note');
  assert.equal(new Date(stored.resolution.resolvedAt).toISOString(), resolvedAt.toISOString());
});

test('4. unauthorized user cannot resolve', async () => {
  const item = await createOpenItem();
  const cleanerToken = adminToken({ sub: 'cleaner-user', role: 'cleaner' });

  const res = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${cleanerToken}`)
    .send({ note: 'Should not apply' });

  assert.equal(res.status, 403);

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.status, 'open');
});

test('5. dashboard no longer shows resolved ManualReviewItem', async () => {
  const item = await createOpenItem({
    category: 'comms_rule_shadow_mismatch',
    title: 'Comms rule needs review'
  });

  const before = await getDashboardReadModel();
  const beforeAlerts = manualReviewAlerts(before);
  assert.ok(beforeAlerts.some((a) => a.manualReviewItemId === String(item._id)));

  await resolveManualReviewItem({
    manualReviewItemId: item._id,
    resolvedBy: 'ops_admin_1',
    note: 'Reviewed and dismissed'
  });

  const after = await getDashboardReadModel();
  const afterAlerts = manualReviewAlerts(after);
  assert.equal(
    afterAlerts.some((a) => a.manualReviewItemId === String(item._id)),
    false
  );
});

test('6. email delivery states and history remain unchanged', async () => {
  const correlationKey = 'booking:abc123:confirmation:guest@example.com';
  const emailEvent = await EmailEvent.create({
    templateKey: 'confirmation',
    to: 'guest@example.com',
    sendStatus: 'failed',
    errorMessage: 'smtp timeout',
    bookingId: new mongoose.Types.ObjectId(),
    deliveryCorrelationKey: correlationKey
  });
  const deliveryState = await EmailDeliveryState.create({
    correlationKey,
    domain: 'booking_lifecycle',
    latestStatus: 'failed',
    recipient: 'guest@example.com',
    templateKey: 'confirmation',
    bookingId: emailEvent.bookingId,
    latestErrorMessage: 'smtp timeout',
    latestEventAt: new Date()
  });
  const item = await createOpenItem({
    category: 'payment_flow_server_error',
    title: 'Unrelated ops alert'
  });

  const token = adminToken();
  const res = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: 'Fixed outside automated flow' });
  assert.equal(res.status, 200);

  const storedEvent = await EmailEvent.findById(emailEvent._id).lean();
  const storedState = await EmailDeliveryState.findById(deliveryState._id).lean();
  assert.equal(storedEvent.sendStatus, 'failed');
  assert.equal(storedEvent.errorMessage, 'smtp timeout');
  assert.equal(storedState.latestStatus, 'failed');
  assert.equal(storedState.latestErrorMessage, 'smtp timeout');
  assert.equal(await GiftVoucherEvent.countDocuments(), 0);
});

test('7. SMTP alert ManualReviewItem can be manually resolved', async () => {
  const entityId = 'smtp.example.com:587';
  const item = await ManualReviewItem.create({
    category: SMTP_TRANSPORT_UNHEALTHY,
    severity: 'critical',
    status: 'open',
    entityType: 'SmtpHealth',
    entityId,
    title: 'SMTP transport unhealthy',
    details: 'Connection refused'
  });

  const token = adminToken({ sub: 'smtp-ops-admin' });
  const res = await request(app)
    .post(`/api/ops/manual-review/${item._id}/resolve`)
    .set('Authorization', `Bearer ${token}`)
    .send({ note: 'Provider fixed firewall rule' });

  assert.equal(res.status, 200);
  assert.equal(res.body.data.item.category, SMTP_TRANSPORT_UNHEALTHY);
  assert.equal(res.body.data.item.status, 'resolved');
  assert.equal(res.body.data.item.resolution.note, 'Provider fixed firewall rule');

  const stored = await ManualReviewItem.findById(item._id).lean();
  assert.equal(stored.status, 'resolved');
  assert.equal(stored.entityType, 'SmtpHealth');
  assert.equal(stored.entityId, entityId);
});
