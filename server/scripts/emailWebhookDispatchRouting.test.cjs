/**
 * Batch 9 — email webhook routing tests.
 *
 * Run: npm run test:email-webhook-dispatch-routing (from server/)
 *
 * Covers:
 *   - Legacy booking:* tag → writes EmailEvent, does NOT write MessageDeliveryEvent.
 *   - Legacy untagged event → writes EmailEvent, does NOT write MessageDeliveryEvent.
 *   - New dispatch:* tag → writes MessageDeliveryEvent, does NOT write EmailEvent.
 *   - New Metadata.dispatchId (without dispatch: tag) → same routing.
 *   - Duplicate dispatch event re-ingest → idempotent via providerEventId.
 *   - providerEventId is stable across re-deliveries (clock-free).
 *   - Signature verification still required (401 without signature).
 *   - Email service additive params: legacy headers byte-identical when not supplied.
 *   - Email service additive params: custom headers override legacy.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const express = require('express');
const supertest = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');

const EmailEvent = require('../models/EmailEvent');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const emailWebhookRoutes = require('../routes/emailWebhookRoutes');
const ingest = require('../services/messaging/messageDeliveryEventIngest');

const WEBHOOK_SECRET = 'test-webhook-secret-batch9';
process.env.POSTMARK_WEBHOOK_SECRET = WEBHOOK_SECRET;

const app = express();
app.use('/api/email-webhook', emailWebhookRoutes);

function postPostmark(body, { signed = true } = {}) {
  const raw = JSON.stringify(body);
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('base64');
  const req = supertest(app).post('/api/email-webhook/postmark').set('Content-Type', 'application/json');
  if (signed) req.set('X-Postmark-Signature', sig);
  return req.send(raw);
}

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    EmailEvent.syncIndexes(),
    MessageDeliveryEvent.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    EmailEvent.deleteMany({}),
    MessageDeliveryEvent.deleteMany({})
  ]);
});

// ---------------------------------------------------------------------------
// Routing — legacy booking:* path must remain byte-identical
// ---------------------------------------------------------------------------

test('legacy booking:* delivery event → writes EmailEvent only, never MessageDeliveryEvent', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const res = await postPostmark({
    RecordType: 'Delivery',
    MessageID: 'pm-msg-001',
    Recipient: 'guest@example.com',
    Subject: 'Booking received',
    Tag: `booking:${bookingId}`,
    DeliveredAt: '2026-05-01T10:00:00Z',
    MessageStream: 'outbound'
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.routed, undefined, 'legacy path must not include the new "routed" flag');

  assert.equal(await EmailEvent.countDocuments({}), 1);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
  const stored = await EmailEvent.findOne({}).lean();
  assert.equal(stored.type, 'Delivery');
  assert.equal(stored.tag, `booking:${bookingId}`);
});

test('untagged legacy event → writes EmailEvent only', async () => {
  const res = await postPostmark({
    RecordType: 'Delivery',
    MessageID: 'pm-msg-002',
    Recipient: 'guest@example.com',
    Subject: 'No tag',
    DeliveredAt: '2026-05-01T10:00:00Z'
  });
  assert.equal(res.status, 200);
  assert.equal(await EmailEvent.countDocuments({}), 1);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

test('legacy booking:* bounce → writes EmailEvent only', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const res = await postPostmark({
    RecordType: 'Bounce',
    ID: 9876543210,
    MessageID: 'pm-msg-bounce-001',
    Recipient: 'guest@example.com',
    Subject: 'Some subject',
    Tag: `booking:${bookingId}`,
    Type: 'Bounce',
    BounceType: 'HardBounce',
    BouncedAt: '2026-05-01T10:00:00Z'
  });
  assert.equal(res.status, 200);
  assert.equal(await EmailEvent.countDocuments({}), 1);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

// ---------------------------------------------------------------------------
// Routing — new dispatch:* path
// ---------------------------------------------------------------------------

test('dispatch:* tag delivery → writes MessageDeliveryEvent only, NEVER EmailEvent', async () => {
  const dispatchId = new mongoose.Types.ObjectId();
  const bookingId = new mongoose.Types.ObjectId();
  const res = await postPostmark({
    RecordType: 'Delivery',
    MessageID: 'pm-msg-d-001',
    Recipient: 'guest@example.com',
    Subject: 'Arrival 3d',
    Tag: `dispatch:${String(dispatchId)}`,
    Metadata: {
      dispatchId: String(dispatchId),
      bookingId: String(bookingId),
      ruleKey: 'arrival_instructions_pre_arrival_cabin',
      templateKey: 'arrival_3d_the_cabin',
      channel: 'email'
    },
    DeliveredAt: '2026-05-01T10:00:00Z',
    MessageStream: 'outbound'
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.routed, 'message_delivery_event');
  assert.equal(await EmailEvent.countDocuments({}), 0, 'dispatch:* must NEVER write to EmailEvent');
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 1);
  const stored = await MessageDeliveryEvent.findOne({}).lean();
  assert.equal(stored.provider, 'postmark');
  assert.equal(stored.channel, 'email');
  assert.equal(stored.eventType, 'delivered');
  assert.equal(String(stored.dispatchId), String(dispatchId));
  assert.equal(String(stored.bookingId), String(bookingId));
});

test('dispatch metadata-only (no tag prefix) → routes to MessageDeliveryEvent', async () => {
  const dispatchId = new mongoose.Types.ObjectId();
  const res = await postPostmark({
    RecordType: 'Open',
    MessageID: 'pm-msg-d-002',
    Recipient: 'guest@example.com',
    // No dispatch:* tag, but Metadata.dispatchId is present.
    Metadata: { dispatchId: String(dispatchId), channel: 'email' },
    ReceivedAt: '2026-05-02T08:00:00Z'
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.routed, 'message_delivery_event');
  assert.equal(await EmailEvent.countDocuments({}), 0);
  assert.equal(await MessageDeliveryEvent.countDocuments({ eventType: 'opened' }), 1);
});

test('dispatch:* bounce → uses Postmark ID for providerEventId, NEVER EmailEvent', async () => {
  const dispatchId = new mongoose.Types.ObjectId();
  const res = await postPostmark({
    RecordType: 'Bounce',
    ID: 1122334455,
    MessageID: 'pm-msg-d-bounce',
    Recipient: 'guest@example.com',
    Tag: `dispatch:${String(dispatchId)}`,
    BounceType: 'HardBounce',
    BouncedAt: '2026-05-03T10:00:00Z'
  });
  assert.equal(res.status, 200);
  assert.equal(await EmailEvent.countDocuments({}), 0);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 1);
  const ev = await MessageDeliveryEvent.findOne({}).lean();
  assert.equal(ev.eventType, 'bounced');
  assert.equal(ev.isTerminal, true);
  assert.equal(ev.providerEventId, '1122334455');
});

test('dispatch:* event re-delivered with identical payload → idempotent (no duplicate row)', async () => {
  const dispatchId = new mongoose.Types.ObjectId();
  const body = {
    RecordType: 'Delivery',
    MessageID: 'pm-msg-d-dup',
    Recipient: 'guest@example.com',
    Tag: `dispatch:${String(dispatchId)}`,
    Metadata: { dispatchId: String(dispatchId), channel: 'email' },
    DeliveredAt: '2026-05-04T10:00:00Z'
  };
  await postPostmark(body);
  await postPostmark(body);
  await postPostmark(body);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 1);
  assert.equal(await EmailEvent.countDocuments({}), 0);
});

test('signature failure → 401, neither collection written', async () => {
  const res = await supertest(app)
    .post('/api/email-webhook/postmark')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ RecordType: 'Delivery', Tag: `dispatch:${new mongoose.Types.ObjectId()}` }));
  assert.equal(res.status, 401);
  assert.equal(await EmailEvent.countDocuments({}), 0);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

// ---------------------------------------------------------------------------
// providerEventId — must be clock-free for idempotency
// ---------------------------------------------------------------------------

test('providerEventId for non-bounce events is composed from MessageID + RecordType + stable timestamp from payload', () => {
  const { computeProviderEventId } = ingest.__internals;
  const ev = computeProviderEventId({
    RecordType: 'Delivery',
    MessageID: 'mid-x',
    DeliveredAt: '2026-05-01T10:00:00Z'
  }, 'Delivery');
  assert.equal(ev, 'mid-x:Delivery:2026-05-01T10:00:00Z');

  const ev2 = computeProviderEventId({
    RecordType: 'Open',
    MessageID: 'mid-y',
    ReceivedAt: '2026-05-01T11:00:00Z'
  }, 'Open');
  assert.equal(ev2, 'mid-y:Open:2026-05-01T11:00:00Z');
});

test('providerEventId for Bounce uses Postmark numeric ID', () => {
  const { computeProviderEventId } = ingest.__internals;
  const ev = computeProviderEventId({ ID: 9999, RecordType: 'Bounce' }, 'Bounce');
  assert.equal(ev, '9999');
});

test('providerEventId is stable across multiple computations of identical payload', () => {
  const { computeProviderEventId } = ingest.__internals;
  const body = {
    RecordType: 'Delivery',
    MessageID: 'mid-stable',
    DeliveredAt: '2026-05-01T10:00:00Z',
    Metadata: { dispatchId: 'x' }
  };
  const a = computeProviderEventId(body, 'Delivery');
  // Wait imperceptibly — but providerEventId must NOT use clock.
  const b = computeProviderEventId(body, 'Delivery');
  assert.equal(a, b);
});

test('ingester returns false for unmapped record types and writes nothing', async () => {
  const dispatchId = new mongoose.Types.ObjectId();
  const result = await ingest.ingestPostmarkEvent({
    RecordType: 'SubscriptionChange',
    Tag: `dispatch:${String(dispatchId)}`,
    MessageID: 'mid-z'
  });
  assert.equal(result.ingested, false);
  assert.equal(result.reason, 'unmapped_record_type');
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

test('ingester returns false when dispatchId cannot be resolved', async () => {
  const result = await ingest.ingestPostmarkEvent({
    RecordType: 'Delivery',
    MessageID: 'mid-no-dispatch',
    Tag: 'booking:abc' // not a dispatch tag
  });
  assert.equal(result.ingested, false);
  assert.equal(result.reason, 'no_dispatch_id');
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

// ---------------------------------------------------------------------------
// emailService additive parameters: legacy preserved + custom override
// ---------------------------------------------------------------------------

test('emailService.sendEmail with neither custom tag nor metadata → legacy booking:* header unchanged', async () => {
  const emailService = require('../services/emailService');
  // Stub transporter.sendMail via a temporary hook to capture mailOptions.
  // This proves the header construction is byte-identical to before Batch 9.
  let captured = null;
  // The service may not be configured (no SMTP) — in that case it falls back
  // to log mode, which does NOT touch headers. Inject a fake transporter so
  // we exercise the header-construction branch.
  const prevTransporter = emailService.transporter;
  const prevIsConfigured = emailService.isConfigured;
  emailService.transporter = {
    sendMail: async (opts) => { captured = opts; return { messageId: 'fake-001' }; }
  };
  emailService.isConfigured = true;
  try {
    const result = await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 'Legacy',
      html: '<p>x</p>',
      text: 'x',
      trigger: 'booking_received',
      bookingId: 'abc123'
    });
    assert.equal(result.success, true);
    assert.equal(result.method, 'sent');
    assert.ok(captured.headers);
    assert.equal(captured.headers['X-PM-Tag'], 'booking:abc123');
    const meta = JSON.parse(captured.headers['X-PM-Metadata']);
    assert.equal(meta.bookingId, 'abc123');
    assert.equal(meta.trigger, 'booking_received');
  } finally {
    emailService.transporter = prevTransporter;
    emailService.isConfigured = prevIsConfigured;
  }
});

test('emailService.sendEmail with custom postmarkTag/postmarkMetadata → overrides legacy booking:*', async () => {
  const emailService = require('../services/emailService');
  let captured = null;
  const prevTransporter = emailService.transporter;
  const prevIsConfigured = emailService.isConfigured;
  emailService.transporter = {
    sendMail: async (opts) => { captured = opts; return { messageId: 'fake-002' }; }
  };
  emailService.isConfigured = true;
  try {
    const dispatchId = '6700000000000000000abcde';
    await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 'Custom',
      html: '<p/>',
      text: '',
      trigger: 'message_automation:rule:email:dispatch',
      bookingId: 'abc123', // legacy id supplied; custom params must still override
      skipIdempotencyWindow: true,
      omitBodyFromLogs: true,
      postmarkTag: `dispatch:${dispatchId}`,
      postmarkMetadata: { dispatchId, bookingId: 'abc123', channel: 'email' }
    });
    assert.ok(captured.headers);
    assert.equal(captured.headers['X-PM-Tag'], `dispatch:${dispatchId}`);
    const meta = JSON.parse(captured.headers['X-PM-Metadata']);
    assert.equal(meta.dispatchId, dispatchId);
    assert.equal(meta.channel, 'email');
    // Critical: legacy keys must NOT be present in the custom metadata blob.
    assert.equal(meta.trigger, undefined);
  } finally {
    emailService.transporter = prevTransporter;
    emailService.isConfigured = prevIsConfigured;
  }
});

test('emailService.sendEmail: no bookingId, no custom params → no headers at all (legacy invariant preserved)', async () => {
  const emailService = require('../services/emailService');
  let captured = null;
  const prevTransporter = emailService.transporter;
  const prevIsConfigured = emailService.isConfigured;
  emailService.transporter = {
    sendMail: async (opts) => { captured = opts; return { messageId: 'fake-003' }; }
  };
  emailService.isConfigured = true;
  try {
    await emailService.sendEmail({
      to: 'noheader@example.com',
      subject: 's',
      html: '<p/>',
      text: 't'
    });
    assert.equal(captured.headers, undefined, 'no bookingId and no custom params → no headers (matches legacy behaviour)');
  } finally {
    emailService.transporter = prevTransporter;
    emailService.isConfigured = prevIsConfigured;
  }
});

test('emailService.sendEmail: empty postmarkMetadata object → falls back to legacy booking:* (no empty header value)', async () => {
  const emailService = require('../services/emailService');
  let captured = null;
  const prevTransporter = emailService.transporter;
  const prevIsConfigured = emailService.isConfigured;
  emailService.transporter = {
    sendMail: async (opts) => { captured = opts; return { messageId: 'fake-004' }; }
  };
  emailService.isConfigured = true;
  try {
    await emailService.sendEmail({
      to: 'guest@example.com',
      subject: 's',
      html: '<p/>',
      text: 't',
      trigger: 'booking_confirmed',
      bookingId: 'abc123',
      postmarkMetadata: {} // empty → treat as not-supplied
    });
    assert.ok(captured.headers);
    assert.equal(captured.headers['X-PM-Tag'], 'booking:abc123');
  } finally {
    emailService.transporter = prevTransporter;
    emailService.isConfigured = prevIsConfigured;
  }
});
