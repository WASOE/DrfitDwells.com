/**
 * Batch 10A — OPS guest message automation read models (read-only DTOs).
 *
 * Run: npm run test:ops-messaging-read-model (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const MessageTemplate = require('../models/MessageTemplate');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

const {
  getMessagingSystemStateReadModel,
  getMessagingRulesWithTemplateReadiness,
  getReservationMessagingSummary,
  getDeliveryEventsForDispatch,
  maskRecipient
} = require('../services/ops/readModels/guestMessageAutomationOpsReadModel');

let mongoServer;

async function createCabin() {
  return Cabin.create({
    name: 'Ops read cabin',
    description: 'd',
    location: 'Test Valley',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg'
  });
}

async function createFutureBooking(cabinId, overrides = {}) {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 25);
  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 2);
  return Booking.create({
    cabinId,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'T',
      lastName: 'Guest',
      email: 'guest@test.example.com',
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`,
    ...overrides
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    MessageTemplate.syncIndexes(),
    MessageAutomationRule.syncIndexes(),
    ScheduledMessageJob.syncIndexes(),
    MessageDispatch.syncIndexes(),
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
    ManualReviewItem.deleteMany({}),
    MessageDeliveryEvent.deleteMany({}),
    MessageDispatch.deleteMany({}),
    ScheduledMessageJob.deleteMany({}),
    MessageAutomationRule.deleteMany({}),
    MessageTemplate.deleteMany({}),
    Booking.deleteMany({}),
    Cabin.deleteMany({})
  ]);
});

test('maskRecipient masks email and phone', () => {
  assert.equal(maskRecipient('alice@example.com'), 'a***@example.com');
  assert.equal(maskRecipient('+359881234567'), '***4567');
  assert.equal(maskRecipient(''), null);
  assert.equal(maskRecipient(null), null);
});

test('getMessagingSystemStateReadModel exposes booleans and static explanations only', () => {
  const keys = ['MESSAGE_DISPATCHER_ENABLED', 'MESSAGE_SCHEDULER_WORKER_ENABLED', 'MESSAGE_EMAIL_PROVIDER_ENABLED'];
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    const off = getMessagingSystemStateReadModel();
    assert.equal(off.dispatcherEnabled, false);
    assert.equal(off.schedulerWorkerEnabled, false);
    assert.equal(off.emailProviderEnabled, false);
    process.env.MESSAGE_DISPATCHER_ENABLED = '1';
    process.env.MESSAGE_SCHEDULER_WORKER_ENABLED = '1';
    process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = '1';
    const on = getMessagingSystemStateReadModel();
    assert.equal(on.dispatcherEnabled, true);
    assert.equal(on.schedulerWorkerEnabled, true);
    assert.equal(on.emailProviderEnabled, true);
    assert.match(String(on.explanations.schedulerVsDirectDispatcher), /scheduler worker/i);
    assert.match(String(on.explanations.emailProvider), /shadow/i);
    const json = JSON.stringify(on);
    assert.equal(json.includes('MESSAGE_'), false);
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
});

test('getMessagingRulesWithTemplateReadiness returns empty rules list', async () => {
  const data = await getMessagingRulesWithTemplateReadiness();
  assert.deepEqual(data, { rules: [] });
});

test('getMessagingRulesWithTemplateReadiness maps approved / draft / missing per channel', async () => {
  const suffix = crypto.randomBytes(4).toString('hex');
  const waKey = `ops_read_wa_${suffix}`;
  const emKey = `ops_read_em_${suffix}`;
  const missKey = `ops_read_miss_${suffix}`;
  await MessageTemplate.create({
    key: waKey,
    version: 1,
    channel: 'whatsapp',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'approved',
    whatsappTemplateName: 't',
    whatsappLocale: 'en'
  });
  await MessageTemplate.create({
    key: emKey,
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'cabin',
    status: 'draft',
    emailSubject: 'S',
    emailBodyMarkup: '<p>x</p>'
  });
  await MessageAutomationRule.create({
    ruleKey: `ops_read_rule_${suffix}`,
    triggerType: 'manual',
    triggerConfig: { offsetDays: -3 },
    propertyScope: 'cabin',
    channelStrategy: 'both',
    templateKeyByChannel: { whatsapp: waKey, email: emKey },
    requiresConsent: 'transactional',
    enabled: true,
    mode: 'shadow',
    audience: 'guest',
    requiredBookingStatus: [],
    requirePaidIfStripe: false
  });
  await MessageAutomationRule.create({
    ruleKey: `ops_read_rule_missing_${suffix}`,
    triggerType: 'manual',
    triggerConfig: {},
    propertyScope: 'cabin',
    channelStrategy: 'email_only',
    templateKeyByChannel: { email: missKey },
    requiresConsent: 'transactional',
    enabled: false,
    mode: 'shadow',
    audience: 'ops',
    requiredBookingStatus: [],
    requirePaidIfStripe: false
  });

  const { rules } = await getMessagingRulesWithTemplateReadiness();
  const main = rules.find((r) => r.ruleKey === `ops_read_rule_${suffix}`);
  assert.ok(main);
  assert.equal(main.templateReadinessByChannel.whatsapp, 'approved');
  assert.equal(main.templateReadinessByChannel.email, 'draft');
  assert.equal(main.audience, 'guest');
  assert.deepEqual(main.triggerConfig, { offsetDays: -3 });

  const missingRule = rules.find((r) => r.ruleKey === `ops_read_rule_missing_${suffix}`);
  assert.ok(missingRule);
  assert.equal(missingRule.templateReadinessByChannel.email, 'missing');
});

test('getReservationMessagingSummary aggregates jobs, dispatches, delivery, MRI (masked recipient)', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const bookingIdStr = String(booking._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 1);

  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'scheduled'
  });

  const dispatch = await MessageDispatch.create({
    scheduledMessageJobId: job._id,
    bookingId: booking._id,
    ruleKey: 'arrival_test',
    templateKey: 'arrival_3d_the_cabin',
    templateVersion: 1,
    channel: 'email',
    recipient: 'supersecret@example.com',
    lifecycleSource: 'automatic',
    status: 'accepted',
    providerName: 'internal',
    idempotencyKey: `idem_${crypto.randomBytes(8).toString('hex')}`
  });

  await MessageDeliveryEvent.create({
    dispatchId: dispatch._id,
    bookingId: booking._id,
    provider: 'internal',
    channel: 'email',
    eventType: 'accepted',
    isTerminal: false,
    providerEventId: `pev_${crypto.randomBytes(8).toString('hex')}`,
    occurredAt: new Date()
  });

  await ManualReviewItem.create({
    category: 'comms_dispatch_failed',
    severity: 'high',
    status: 'open',
    title: 'Dispatch failed',
    details: 'needs eyes',
    evidence: { bookingId: bookingIdStr }
  });

  const summary = await getReservationMessagingSummary(bookingIdStr);
  assert.ok(summary);
  assert.equal(summary.bookingId, bookingIdStr);
  assert.equal(summary.jobs.length, 1);
  assert.equal(summary.jobs[0].ruleKey, 'arrival_test');

  assert.equal(summary.dispatches.length, 1);
  assert.equal(summary.dispatches[0].recipientMasked, 's***@example.com');
  assert.notEqual(summary.dispatches[0].recipientMasked, 'supersecret@example.com');
  assert.equal(summary.dispatches[0].deliveryEventCount, 1);
  assert.equal(summary.dispatches[0].latestDeliveryEvent.eventType, 'accepted');

  assert.equal(summary.manualReviewItems.length, 1);
  assert.equal(summary.manualReviewItems[0].category, 'comms_dispatch_failed');
});

test('getReservationMessagingSummary returns null for invalid id, test booking, archived', async () => {
  assert.equal(await getReservationMessagingSummary('not-an-id'), null);
  const cabin = await createCabin();
  const testBooking = await createFutureBooking(cabin._id, { isTest: true });
  assert.equal(await getReservationMessagingSummary(String(testBooking._id)), null);

  const archived = await createFutureBooking(cabin._id);
  await Booking.updateOne({ _id: archived._id }, { $set: { archivedAt: new Date() } });
  assert.equal(await getReservationMessagingSummary(String(archived._id)), null);
});

test('getDeliveryEventsForDispatch lists events for dispatch', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const dispatch = await MessageDispatch.create({
    bookingId: booking._id,
    ruleKey: 'x',
    templateKey: 'arrival_3d_the_cabin',
    templateVersion: 1,
    channel: 'email',
    recipient: 'x@y.com',
    lifecycleSource: 'automatic',
    status: 'accepted',
    providerName: 'internal',
    idempotencyKey: `idem_${crypto.randomBytes(8).toString('hex')}`
  });
  await MessageDeliveryEvent.create({
    dispatchId: dispatch._id,
    bookingId: booking._id,
    provider: 'internal',
    channel: 'email',
    eventType: 'delivered',
    isTerminal: true,
    providerEventId: `pev_${crypto.randomBytes(8).toString('hex')}`,
    occurredAt: new Date()
  });
  const data = await getDeliveryEventsForDispatch(String(dispatch._id));
  assert.ok(data);
  assert.equal(data.dispatchId, String(dispatch._id));
  assert.equal(data.events.length, 1);
  assert.equal(data.events[0].eventType, 'delivered');
});

test('getDeliveryEventsForDispatch returns null for invalid id', async () => {
  assert.equal(await getDeliveryEventsForDispatch('bad'), null);
});
