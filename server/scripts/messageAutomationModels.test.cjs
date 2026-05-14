/**
 * Message automation data-model tests.
 *
 * Runs against an in-memory MongoDB to exercise schema validation AND the
 * load-bearing unique indexes that protect the guest message automation
 * pipeline from duplicate sends.
 *
 * Run: npm run test:messaging-models (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const MessageTemplate = require('../models/MessageTemplate');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const GuestContactPreference = require('../models/GuestContactPreference');

// Legacy models — imported only to assert their schema is unchanged.
const EmailEvent = require('../models/EmailEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    MessageTemplate.syncIndexes(),
    MessageAutomationRule.syncIndexes(),
    ScheduledMessageJob.syncIndexes(),
    MessageDispatch.syncIndexes(),
    MessageDeliveryEvent.syncIndexes(),
    GuestContactPreference.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    MessageTemplate.deleteMany({}),
    MessageAutomationRule.deleteMany({}),
    ScheduledMessageJob.deleteMany({}),
    MessageDispatch.deleteMany({}),
    MessageDeliveryEvent.deleteMany({}),
    GuestContactPreference.deleteMany({})
  ]);
});

async function assertDuplicateKey(fn) {
  await assert.rejects(fn, (err) => err && (err.code === 11000 || /E11000/.test(String(err.message))));
}

// ---------------------------------------------------------------------------
// MessageTemplate
// ---------------------------------------------------------------------------

test('MessageTemplate accepts a valid email + en + cabin row', async () => {
  const doc = await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'approved',
    emailSubject: 'Welcome',
    emailBodyMarkup: '<p>hi</p>'
  });
  assert.equal(doc.key, 'arrival_3d_the_cabin');
  assert.equal(doc.status, 'approved');
});

test('MessageTemplate locale accepts both "en" and "bg"', async () => {
  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft'
  });
  await MessageTemplate.create({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'bg',
    propertyKind: 'cabin',
    status: 'draft'
  });
  const count = await MessageTemplate.countDocuments({});
  assert.equal(count, 2);
});

test('MessageTemplate rejects unknown locale', async () => {
  const doc = new MessageTemplate({
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'email',
    locale: 'fr',
    propertyKind: 'cabin'
  });
  const err = doc.validateSync();
  assert.ok(err?.errors?.locale, 'expected locale enum error');
});

test('MessageTemplate unique on (key, channel, locale, propertyKind, version)', async () => {
  const row = {
    key: 'arrival_3d_the_cabin',
    version: 1,
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'approved',
    whatsappTemplateName: 'arrival_3d_the_cabin_v1',
    whatsappLocale: 'en'
  };
  await MessageTemplate.create(row);
  await assertDuplicateKey(() => MessageTemplate.create(row));
});

test('MessageTemplate allows a new version of the same (key, channel, locale, propertyKind)', async () => {
  const base = {
    key: 'arrival_3d_the_cabin',
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'approved',
    whatsappTemplateName: 'arrival_3d_the_cabin_v1',
    whatsappLocale: 'en'
  };
  await MessageTemplate.create({ ...base, version: 1 });
  await MessageTemplate.create({ ...base, version: 2 });
  const count = await MessageTemplate.countDocuments({});
  assert.equal(count, 2);
});

// ---------------------------------------------------------------------------
// MessageAutomationRule
// ---------------------------------------------------------------------------

test('MessageAutomationRule persists with shadow defaults', async () => {
  const rule = await MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 },
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' },
    audience: 'guest'
  });
  assert.equal(rule.enabled, false);
  assert.equal(rule.mode, 'shadow');
  assert.equal(rule.requiresConsent, 'transactional');
  assert.equal(rule.requirePaidIfStripe, false);
});

test('MessageAutomationRule ruleKey is unique', async () => {
  const row = {
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72 },
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'a', email: 'a' },
    audience: 'guest'
  };
  await MessageAutomationRule.create(row);
  await assertDuplicateKey(() => MessageAutomationRule.create(row));
});

test('MessageAutomationRule rejects unknown enums', async () => {
  const doc = new MessageAutomationRule({
    ruleKey: 'x',
    triggerType: 'nope',
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    audience: 'guest'
  });
  const err = doc.validateSync();
  assert.ok(err?.errors?.triggerType);
});

// ---------------------------------------------------------------------------
// ScheduledMessageJob — load-bearing idempotency tests
// ---------------------------------------------------------------------------

function bookingJob(overrides = {}) {
  return {
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    ruleVersionAtSchedule: 1,
    bookingId: new mongoose.Types.ObjectId(),
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor: new Date('2026-07-01T14:00:00Z'),
    payloadSnapshot: { variables: { foo: 'bar' } },
    ...overrides
  };
}

function noBookingJob(overrides = {}) {
  return {
    ruleKey: 'ops_alert_guest_check_in_tomorrow',
    ruleVersionAtSchedule: 1,
    bookingId: null,
    audience: 'ops',
    propertyKind: 'any',
    scheduledFor: new Date('2026-07-01T06:00:00Z'),
    ...overrides
  };
}

test('ScheduledMessageJob: duplicate per-booking job fails (channel-agnostic)', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const scheduledFor = new Date('2026-07-01T14:00:00Z');
  await ScheduledMessageJob.create(bookingJob({ bookingId, scheduledFor }));
  await assertDuplicateKey(() =>
    ScheduledMessageJob.create(bookingJob({ bookingId, scheduledFor }))
  );
});

test('ScheduledMessageJob: duplicate per-booking job fails even with different payload (channel excluded from key)', async () => {
  const bookingId = new mongoose.Types.ObjectId();
  const scheduledFor = new Date('2026-07-01T14:00:00Z');
  // The would-be channel split is represented here purely as a payload
  // difference — the unique key must still trip because channel is NOT part
  // of the index (this is the regression guard for the Batch 1 patch).
  await ScheduledMessageJob.create(
    bookingJob({ bookingId, scheduledFor, payloadSnapshot: { plannedChannel: 'whatsapp' } })
  );
  await assertDuplicateKey(() =>
    ScheduledMessageJob.create(
      bookingJob({ bookingId, scheduledFor, payloadSnapshot: { plannedChannel: 'email' } })
    )
  );
});

test('ScheduledMessageJob: duplicate no-booking job fails', async () => {
  const scheduledFor = new Date('2026-07-01T06:00:00Z');
  await ScheduledMessageJob.create(noBookingJob({ scheduledFor }));
  await assertDuplicateKey(() => ScheduledMessageJob.create(noBookingJob({ scheduledFor })));
});

test('ScheduledMessageJob: a booking job and a no-booking job with same (ruleKey, scheduledFor) coexist', async () => {
  const scheduledFor = new Date('2026-07-01T06:00:00Z');
  await ScheduledMessageJob.create(
    bookingJob({ ruleKey: 'shared_rule', scheduledFor, propertyKind: 'any' })
  );
  await ScheduledMessageJob.create(
    noBookingJob({ ruleKey: 'shared_rule', scheduledFor })
  );
  const count = await ScheduledMessageJob.countDocuments({});
  assert.equal(count, 2);
});

test('ScheduledMessageJob: two no-booking jobs with same ruleKey but different scheduledFor coexist', async () => {
  await ScheduledMessageJob.create(noBookingJob({ scheduledFor: new Date('2026-07-01T06:00:00Z') }));
  await ScheduledMessageJob.create(noBookingJob({ scheduledFor: new Date('2026-07-02T06:00:00Z') }));
  const count = await ScheduledMessageJob.countDocuments({});
  assert.equal(count, 2);
});

test('ScheduledMessageJob: defaults are sane', async () => {
  const job = await ScheduledMessageJob.create(bookingJob());
  assert.equal(job.status, 'scheduled');
  assert.equal(job.attemptCount, 0);
  assert.equal(job.maxAttempts, 3);
  assert.equal(job.ruleVersionAtSchedule, 1);
});

// ---------------------------------------------------------------------------
// MessageDispatch
// ---------------------------------------------------------------------------

function dispatch(overrides = {}) {
  return {
    bookingId: new mongoose.Types.ObjectId(),
    templateKey: 'arrival_3d_the_cabin',
    templateVersion: 1,
    channel: 'email',
    recipient: 'guest@example.com',
    lifecycleSource: 'automatic',
    status: 'accepted',
    providerName: 'postmark',
    idempotencyKey: 'arrival_instructions_pre_arrival_cabin:abc:2026-07-01:email',
    ...overrides
  };
}

test('MessageDispatch: idempotencyKey is unique', async () => {
  await MessageDispatch.create(dispatch());
  await assertDuplicateKey(() =>
    MessageDispatch.create(dispatch({ providerName: 'meta_whatsapp', channel: 'whatsapp' }))
  );
});

test('MessageDispatch: (providerName, providerMessageId) is unique when providerMessageId is set', async () => {
  await MessageDispatch.create(
    dispatch({ idempotencyKey: 'k1', providerMessageId: 'pmid-1' })
  );
  await assertDuplicateKey(() =>
    MessageDispatch.create(
      dispatch({ idempotencyKey: 'k2', providerMessageId: 'pmid-1' })
    )
  );
});

test('MessageDispatch: multiple rows with providerMessageId=null are allowed', async () => {
  await MessageDispatch.create(dispatch({ idempotencyKey: 'a', providerMessageId: null }));
  await MessageDispatch.create(dispatch({ idempotencyKey: 'b', providerMessageId: null }));
  const count = await MessageDispatch.countDocuments({});
  assert.equal(count, 2);
});

test('MessageDispatch: same providerMessageId allowed under different providerName', async () => {
  await MessageDispatch.create(
    dispatch({ idempotencyKey: 'a', providerName: 'postmark', channel: 'email', providerMessageId: 'shared' })
  );
  await MessageDispatch.create(
    dispatch({ idempotencyKey: 'b', providerName: 'meta_whatsapp', channel: 'whatsapp', providerMessageId: 'shared' })
  );
  const count = await MessageDispatch.countDocuments({});
  assert.equal(count, 2);
});

// ---------------------------------------------------------------------------
// MessageDeliveryEvent
// ---------------------------------------------------------------------------

function deliveryEvent(overrides = {}) {
  return {
    provider: 'meta_whatsapp',
    channel: 'whatsapp',
    eventType: 'delivered',
    isTerminal: true,
    providerEventId: 'evt-1',
    occurredAt: new Date(),
    ...overrides
  };
}

test('MessageDeliveryEvent: (provider, providerEventId) is unique', async () => {
  await MessageDeliveryEvent.create(deliveryEvent());
  await assertDuplicateKey(() => MessageDeliveryEvent.create(deliveryEvent()));
});

test('MessageDeliveryEvent: same providerEventId under different provider is allowed', async () => {
  await MessageDeliveryEvent.create(deliveryEvent({ provider: 'meta_whatsapp', providerEventId: 'evt-shared' }));
  await MessageDeliveryEvent.create(
    deliveryEvent({ provider: 'postmark', channel: 'email', eventType: 'opened', isTerminal: false, providerEventId: 'evt-shared' })
  );
  const count = await MessageDeliveryEvent.countDocuments({});
  assert.equal(count, 2);
});

test('MessageDeliveryEvent: only createdAt is timestamped (no updatedAt)', async () => {
  const ev = await MessageDeliveryEvent.create(deliveryEvent({ providerEventId: 'evt-x' }));
  assert.ok(ev.createdAt instanceof Date);
  assert.equal(ev.updatedAt, undefined);
});

// ---------------------------------------------------------------------------
// GuestContactPreference
// ---------------------------------------------------------------------------

test('GuestContactPreference: (recipientType, recipientValue) is unique', async () => {
  await GuestContactPreference.create({
    recipientType: 'email',
    recipientValue: 'guest@example.com'
  });
  await assertDuplicateKey(() =>
    GuestContactPreference.create({
      recipientType: 'email',
      recipientValue: 'guest@example.com'
    })
  );
});

test('GuestContactPreference: same recipientValue under different recipientType coexists', async () => {
  await GuestContactPreference.create({
    recipientType: 'email',
    recipientValue: 'guest@example.com'
  });
  await GuestContactPreference.create({
    recipientType: 'whatsapp_phone',
    recipientValue: '+359888123456'
  });
  const count = await GuestContactPreference.countDocuments({});
  assert.equal(count, 2);
});

test('GuestContactPreference: recipientValue is lower-cased on save', async () => {
  const pref = await GuestContactPreference.create({
    recipientType: 'email',
    recipientValue: 'Guest@Example.COM'
  });
  assert.equal(pref.recipientValue, 'guest@example.com');
});

test('GuestContactPreference: lower-cased email collides with original casing on unique key', async () => {
  await GuestContactPreference.create({
    recipientType: 'email',
    recipientValue: 'guest@example.com'
  });
  await assertDuplicateKey(() =>
    GuestContactPreference.create({
      recipientType: 'email',
      recipientValue: 'GUEST@EXAMPLE.COM'
    })
  );
});

test('GuestContactPreference: defaults are sane', async () => {
  const pref = await GuestContactPreference.create({
    recipientType: 'whatsapp_phone',
    recipientValue: '+359888000000'
  });
  assert.equal(pref.phoneStatus, 'unknown');
  assert.equal(pref.transactional, 'unknown');
  assert.equal(pref.marketing, 'denied');
  assert.equal(pref.suppressed, false);
});

// ---------------------------------------------------------------------------
// Legacy schema regression check
// ---------------------------------------------------------------------------

test('Legacy EmailEvent and ManualReviewItem schemas are unchanged', () => {
  // Anchored field presence so any accidental schema edit in another batch
  // shows up here.
  const emailPaths = Object.keys(EmailEvent.schema.paths);
  for (const required of [
    'provider',
    'type',
    'messageId',
    'bookingId',
    'templateKey',
    'lifecycleSource',
    'sendStatus',
    'createdAt'
  ]) {
    assert.ok(emailPaths.includes(required), `EmailEvent missing field: ${required}`);
  }

  const reviewPaths = Object.keys(ManualReviewItem.schema.paths);
  for (const required of [
    'category',
    'severity',
    'status',
    'entityType',
    'entityId',
    'title',
    'details',
    'createdAt'
  ]) {
    assert.ok(reviewPaths.includes(required), `ManualReviewItem missing field: ${required}`);
  }
});
