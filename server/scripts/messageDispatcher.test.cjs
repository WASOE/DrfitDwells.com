/**
 * Batch 8 — MessageDispatcher contract tests.
 *
 * Run: npm run test:message-dispatcher (from server/)
 *
 * Covers (per Batch 8 approved decisions):
 *   - Default-off flag: no writes, no transitions.
 *   - Claim-time gates (booking missing / cancelled / status / payment / scope / stale snapshot).
 *   - Approved template required, draft blocks dispatch + opens MRI.
 *   - Variable resolution missing → failed + MRI comms_missing_variables.
 *   - Transactional consent: missing/unknown/granted permissive, denied blocked.
 *   - Suppression → skipped_suppressed.
 *   - Invalid WhatsApp phone → skipped_no_recipient → email fallback succeeds (whatsapp_first_email_fallback).
 *   - Channel strategies: whatsapp_only, email_only, whatsapp_first_email_fallback, both.
 *   - Idempotency: duplicate idempotencyKey re-uses existing accepted row.
 *   - Retryable failure (provider_throw) → job back to scheduled + backoff + lastError.
 *   - maxAttempts reached → terminal failed.
 *   - OPS audience: internal email recipient, no GuestContactPreference reads.
 *   - Job status semantics: 'sent' requires accepted dispatch with details.shadow=true.
 *   - No real provider imports (emailService / Postmark / WhatsApp SDK / axios).
 *   - No MessageDeliveryEvent writes.
 *   - Scheduler worker wiring: claim-only when dispatcher flag off, end-to-end when on.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('node:fs');
const path = require('node:path');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const MessageTemplate = require('../models/MessageTemplate');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const GuestContactPreference = require('../models/GuestContactPreference');
const ManualReviewItem = require('../models/ManualReviewItem');

const dispatcher = require('../services/messaging/messageDispatcher');
const schedulerWorker = require('../services/messaging/schedulerWorker');

const { ENV_FLAG } = dispatcher;

let mongoServer;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function withDispatcherFlag(value, fn) {
  const prev = process.env[ENV_FLAG];
  process.env[ENV_FLAG] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env[ENV_FLAG];
      else process.env[ENV_FLAG] = prev;
    });
}

function futureDate(daysFromNow) {
  return new Date(Date.now() + daysFromNow * 24 * 3600 * 1000);
}

function pastDate(secondsAgo = 1) {
  return new Date(Date.now() - secondsAgo * 1000);
}

async function insertCabin(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  await Cabin.collection.insertOne({
    _id,
    propertyKind: 'cabin',
    name: 'The Cabin',
    meetingPoint: {
      label: 'Bansko parking lot',
      googleMapsUrl: 'https://maps.google.com/?q=42.0,23.0'
    },
    arrivalGuideUrl: '/guides/the-cabin',
    arrivalWindowDefault: '14:00–18:00',
    ...overrides
  });
  return _id;
}

async function insertCabinType(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  await CabinType.collection.insertOne({
    _id,
    propertyKind: 'valley',
    name: 'The Valley',
    meetingPoint: {
      label: 'Pirin gate',
      googleMapsUrl: 'https://maps.google.com/?q=41.7,23.4'
    },
    arrivalGuideUrl: '/guides/the-valley',
    arrivalWindowDefault: '15:00–19:00',
    ...overrides
  });
  return _id;
}

async function insertBooking(overrides = {}) {
  const _id = new mongoose.Types.ObjectId();
  const doc = {
    _id,
    cabinId: null,
    cabinTypeId: null,
    checkIn: futureDate(10),
    checkOut: futureDate(13),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '+359888000000' },
    totalPrice: 500,
    paymentMethod: 'stripe',
    stripePaymentIntentId: 'pi_test_123',
    giftVoucherRedemptionId: null,
    provenance: { source: 'guest_portal' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
  await Booking.collection.insertOne(doc);
  return doc;
}

async function insertGuestCabinRule(overrides = {}) {
  return MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    description: 'test cabin guest rule',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 },
    propertyScope: 'cabin',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin', email: 'arrival_3d_the_cabin' },
    requiresConsent: 'transactional',
    enabled: true,
    mode: 'shadow',
    audience: 'guest',
    requiredBookingStatus: ['confirmed'],
    requirePaidIfStripe: true,
    ...overrides
  });
}

async function insertOpsRule(overrides = {}) {
  return MessageAutomationRule.create({
    ruleKey: 'ops_alert_guest_arriving_in_8_days',
    description: 'test ops alert',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -192, sofiaHour: 9, sofiaMinute: 0 },
    propertyScope: 'any',
    channelStrategy: 'email_only',
    templateKeyByChannel: { email: 'ops_alert_arriving_8d' },
    requiresConsent: 'transactional',
    enabled: true,
    mode: 'shadow',
    audience: 'ops',
    requiredBookingStatus: ['confirmed', 'in_house'],
    requirePaidIfStripe: false,
    ...overrides
  });
}

async function insertApprovedGuestTemplates({ propertyKind = 'cabin' } = {}) {
  const key = propertyKind === 'cabin' ? 'arrival_3d_the_cabin' : 'arrival_3d_the_valley';
  await MessageTemplate.create([
    {
      key,
      version: 1,
      channel: 'whatsapp',
      locale: 'en',
      propertyKind,
      status: 'approved',
      whatsappTemplateName: `${key}_v1`,
      whatsappLocale: 'en',
      emailSubject: null,
      emailBodyMarkup: null
    },
    {
      key,
      version: 1,
      channel: 'email',
      locale: 'en',
      propertyKind,
      status: 'approved',
      emailSubject: 'Your arrival to {{propertyName}} — {{checkInDate}}',
      emailBodyMarkup: '<p>Hi {{guestFirstName}}, arrival window: {{arrivalWindow}}. Maps: {{googleMapsUrl}}</p>'
    }
  ]);
}

async function insertApprovedOpsTemplate() {
  await MessageTemplate.create({
    key: 'ops_alert_arriving_8d',
    version: 1,
    channel: 'email',
    locale: 'en',
    propertyKind: 'any',
    status: 'approved',
    emailSubject: '[OPS] Arriving in 8 days: {{propertyName}}',
    emailBodyMarkup: '<p>{{guestFirstName}} arriving at {{propertyName}} on {{checkInDate}}</p>'
  });
}

async function createClaimedJob({ booking, rule, propertyKind, payloadSnapshotOverrides = {} } = {}) {
  const persistedPk = rule.propertyScope === 'any' ? 'any' : propertyKind;
  const job = await ScheduledMessageJob.create({
    ruleKey: rule.ruleKey,
    ruleVersionAtSchedule: 1,
    bookingId: booking?._id || null,
    audience: rule.audience,
    propertyKind: persistedPk,
    scheduledFor: pastDate(60),
    status: 'claimed',
    claimedBy: 'test-worker',
    claimedAt: new Date(),
    visibilityTimeoutAt: futureDate(0.001),
    payloadSnapshot: {
      bookingStatus: booking?.status || null,
      paymentMethod: booking?.paymentMethod || null,
      checkIn: booking?.checkIn || null,
      checkOut: booking?.checkOut || null,
      propertyKind,
      ...payloadSnapshotOverrides
    },
    attemptCount: 0,
    maxAttempts: 3
  });
  return job;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    ScheduledMessageJob.syncIndexes(),
    MessageDispatch.syncIndexes(),
    MessageDeliveryEvent.syncIndexes(),
    MessageAutomationRule.syncIndexes(),
    MessageTemplate.syncIndexes(),
    GuestContactPreference.syncIndexes(),
    ManualReviewItem.syncIndexes()
  ]);
});

test.after(async () => {
  schedulerWorker.stopSchedulerWorkerForTest();
  schedulerWorker.setAwaitDispatcherForTests(false);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  schedulerWorker.stopSchedulerWorkerForTest();
  schedulerWorker.setAwaitDispatcherForTests(false);
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    MessageAutomationRule.deleteMany({}),
    MessageTemplate.deleteMany({}),
    ScheduledMessageJob.deleteMany({}),
    MessageDispatch.deleteMany({}),
    MessageDeliveryEvent.deleteMany({}),
    GuestContactPreference.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

// ---------------------------------------------------------------------------
// Pure / structural
// ---------------------------------------------------------------------------

test('processClaimedJob: flag OFF → no writes, no transitions', async () => {
  delete process.env[ENV_FLAG];
  const cabinId = await insertCabin();
  const booking = await insertBooking({ cabinId });
  const rule = await insertGuestCabinRule();
  const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

  const res = await dispatcher.processClaimedJob(job._id);
  assert.equal(res.ran, false);
  assert.equal(res.disabled, true);

  const after = await ScheduledMessageJob.findById(job._id).lean();
  assert.equal(after.status, 'claimed', 'job must remain claimed when dispatcher is off');
  assert.equal(await MessageDispatch.countDocuments({}), 0);
  assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
});

test('processClaimedJob: flag values other than "1" do NOT enable the dispatcher', async () => {
  const cabinId = await insertCabin();
  const booking = await insertBooking({ cabinId });
  const rule = await insertGuestCabinRule();
  await insertApprovedGuestTemplates();
  for (const v of ['0', 'true', 'TRUE', 'yes', '', 'on']) {
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await withDispatcherFlag(v, async () => {
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.ran, false, `flag value "${v}" must not enable dispatcher`);
    });
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'claimed');
  }
  assert.equal(await MessageDispatch.countDocuments({}), 0);
});

test('planChannelAttempts: returns expected ordering per strategy', () => {
  const { planChannelAttempts } = dispatcher.__internals;
  assert.deepEqual(planChannelAttempts('whatsapp_only'), [{ channel: 'whatsapp', strategy: 'single' }]);
  assert.deepEqual(planChannelAttempts('email_only'), [{ channel: 'email', strategy: 'single' }]);
  assert.deepEqual(planChannelAttempts('whatsapp_first_email_fallback'), [
    { channel: 'whatsapp', strategy: 'primary' },
    { channel: 'email', strategy: 'fallback' }
  ]);
  assert.deepEqual(planChannelAttempts('both'), [
    { channel: 'whatsapp', strategy: 'parallel' },
    { channel: 'email', strategy: 'parallel' }
  ]);
  assert.deepEqual(planChannelAttempts('unknown'), []);
});

test('buildIdempotencyKey: stable across retries (Batch 9 key shape)', () => {
  const { buildIdempotencyKey } = dispatcher.__internals;
  const jobId = new mongoose.Types.ObjectId();
  const kWa = buildIdempotencyKey({ jobId, channel: 'whatsapp' });
  const kEm = buildIdempotencyKey({ jobId, channel: 'email' });
  assert.equal(kWa, `${String(jobId)}:whatsapp`);
  assert.equal(kEm, `${String(jobId)}:email`);
  assert.notEqual(kWa, kEm);
  // Critical invariant: a retried job has the same jobId, so the key is
  // identical regardless of how many times `scheduledFor` shifts.
  const sameJob = buildIdempotencyKey({ jobId, channel: 'email' });
  assert.equal(sameJob, kEm);
  // Different jobIds (separate occurrences) produce different keys.
  const otherJob = buildIdempotencyKey({ jobId: new mongoose.Types.ObjectId(), channel: 'email' });
  assert.notEqual(otherJob, kEm);
});

test('buildIdempotencyKey: throws on missing jobId or channel', () => {
  const { buildIdempotencyKey } = dispatcher.__internals;
  assert.throws(() => buildIdempotencyKey({ channel: 'email' }), /jobId/);
  assert.throws(() => buildIdempotencyKey({ jobId: new mongoose.Types.ObjectId() }), /channel/);
});

test('reduceChannelOutcomes: any accepted → sent', () => {
  const { reduceChannelOutcomes, CHANNEL_OUTCOME } = dispatcher.__internals;
  const d = reduceChannelOutcomes([
    { outcome: CHANNEL_OUTCOME.SKIPPED_NO_RECIPIENT, retryable: false },
    { outcome: CHANNEL_OUTCOME.ACCEPTED, retryable: false }
  ], 'whatsapp_first_email_fallback');
  assert.equal(d.kind, 'terminal');
  assert.equal(d.jobStatus, 'sent');
});

test('reduceChannelOutcomes: any retryable (no accepted) → retryable', () => {
  const { reduceChannelOutcomes, CHANNEL_OUTCOME } = dispatcher.__internals;
  const d = reduceChannelOutcomes([
    { outcome: CHANNEL_OUTCOME.FAILED_RETRYABLE, retryable: true, errorCode: 'provider_throw' }
  ], 'whatsapp_only');
  assert.equal(d.kind, 'retryable');
  assert.equal(d.errorCode, 'provider_throw');
});

test('reduceChannelOutcomes: all suppressed → suppressed', () => {
  const { reduceChannelOutcomes, CHANNEL_OUTCOME } = dispatcher.__internals;
  const d = reduceChannelOutcomes([
    { outcome: CHANNEL_OUTCOME.SKIPPED_SUPPRESSED, retryable: false },
    { outcome: CHANNEL_OUTCOME.SKIPPED_SUPPRESSED, retryable: false }
  ], 'both');
  assert.equal(d.jobStatus, 'suppressed');
});

test('reduceChannelOutcomes: all no_consent → skipped_no_consent', () => {
  const { reduceChannelOutcomes, CHANNEL_OUTCOME } = dispatcher.__internals;
  const d = reduceChannelOutcomes([
    { outcome: CHANNEL_OUTCOME.SKIPPED_NO_CONSENT, retryable: false }
  ], 'whatsapp_only');
  assert.equal(d.jobStatus, 'skipped_no_consent');
});

test('renderTemplateString: substitutes only declared keys, ignores unknowns', () => {
  const { renderTemplateString } = dispatcher.__internals;
  const out = renderTemplateString('Hi {{guestFirstName}}, see {{guideUrl}}, ignored={{bogus}}', {
    guestFirstName: 'Ada',
    guideUrl: '/g/cabin'
  });
  assert.equal(out, 'Hi Ada, see /g/cabin, ignored=');
});

test('passesPaymentProofGuard: same gates as orchestrator', () => {
  const { passesPaymentProofGuard } = dispatcher.__internals;
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe', stripePaymentIntentId: 'pi_1' }), true);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe_plus_gift_voucher', stripePaymentIntentId: 'pi_2' }), true);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'gift_voucher', giftVoucherRedemptionId: new mongoose.Types.ObjectId() }), true);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe', stripePaymentIntentId: '' }), false);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'gift_voucher', giftVoucherRedemptionId: null }), false);
  assert.equal(passesPaymentProofGuard(null), false);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

test('whatsapp_first_email_fallback: valid phone → whatsapp accepted, no email attempt', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    const res = await dispatcher.processClaimedJob(job._id);
    assert.equal(res.ran, true);
    assert.equal(res.terminal, 'sent');

    const dispatches = await MessageDispatch.find({}).lean();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].channel, 'whatsapp');
    assert.equal(dispatches[0].status, 'accepted');
    assert.equal(dispatches[0].providerName, 'internal');
    assert.equal(dispatches[0].providerMessageId, null);
    assert.equal(dispatches[0].details.shadow, true);

    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
    assert.equal(after.claimedBy, null);
    assert.equal(after.claimedAt, null);
    assert.equal(after.visibilityTimeoutAt, null);
  });
});

test('whatsapp_first_email_fallback: invalid phone → email fallback succeeds', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({
      cabinId,
      guestInfo: { firstName: 'Ada', lastName: 'L', email: 'ada@example.com', phone: 'not-a-phone' }
    });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    const res = await dispatcher.processClaimedJob(job._id);
    assert.equal(res.terminal, 'sent');

    const dispatches = await MessageDispatch.find({}).sort({ createdAt: 1 }).lean();
    assert.equal(dispatches.length, 2);
    assert.equal(dispatches[0].channel, 'whatsapp');
    assert.equal(dispatches[0].status, 'skipped_no_recipient');
    assert.equal(dispatches[1].channel, 'email');
    assert.equal(dispatches[1].status, 'accepted');
    assert.equal(dispatches[1].details.shadow, true);

    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
  });
});

test('whatsapp_only: valid phone → only WA dispatch, no email row', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only', templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin' } });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const dispatches = await MessageDispatch.find({}).lean();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].channel, 'whatsapp');
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
  });
});

test('email_only: only email dispatch, no WA row', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ mode: 'auto', channelStrategy: 'email_only', templateKeyByChannel: { email: 'arrival_3d_the_cabin' } });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const dispatches = await MessageDispatch.find({}).lean();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].channel, 'email');
    assert.equal(dispatches[0].status, 'accepted');
  });
});

test('both: produces two accepted dispatches', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'both' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const dispatches = await MessageDispatch.find({}).lean();
    assert.equal(dispatches.length, 2);
    const channels = dispatches.map((d) => d.channel).sort();
    assert.deepEqual(channels, ['email', 'whatsapp']);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
  });
});

// ---------------------------------------------------------------------------
// Claim-time gates
// ---------------------------------------------------------------------------

test('booking missing → terminal failed + MRI dispatcher_processing_failed', async () => {
  await withDispatcherFlag('1', async () => {
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking: { _id: new mongoose.Types.ObjectId(), status: 'confirmed' }, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    assert.equal(after.lastError, 'booking_missing');
    const mri = await ManualReviewItem.findOne({ category: 'comms_dispatcher_processing_failed' }).lean();
    assert.ok(mri, 'MRI must be opened for booking_missing');
    assert.equal(await MessageDispatch.countDocuments({}), 0);
  });
});

test('booking cancelled → terminal cancelled', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId, status: 'cancelled' });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancelReason, 'booking_cancelled');
    assert.equal(await MessageDispatch.countDocuments({}), 0);
  });
});

test('booking status not in requiredBookingStatus → skipped_status_guard', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId, status: 'pending' });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'skipped_status_guard');
    assert.equal(await MessageDispatch.countDocuments({}), 0);
  });
});

test('payment-proof guard fail → terminal failed', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId, paymentMethod: 'stripe', stripePaymentIntentId: null });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    assert.equal(after.lastError, 'payment_proof_guard_blocked');
    assert.equal(await MessageDispatch.countDocuments({}), 0);
  });
});

test('rule scope mismatch (rule=valley vs booking=cabin) → failed + MRI property_mismatch', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ ruleKey: 'valley_rule', propertyScope: 'valley' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    const mri = await ManualReviewItem.findOne({ category: 'comms_property_mismatch_blocked' }).lean();
    assert.ok(mri);
  });
});

test('stale snapshot (snapshot=cabin, current=valley) → failed + MRI property_mismatch', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinTypeId = await insertCabinType({ propertyKind: 'valley' });
    const booking = await insertBooking({ cabinId: null, cabinTypeId });
    const rule = await insertGuestCabinRule({
      ruleKey: 'arrival_instructions_pre_arrival_valley',
      propertyScope: 'valley',
      templateKeyByChannel: { whatsapp: 'arrival_3d_the_valley', email: 'arrival_3d_the_valley' }
    });
    await insertApprovedGuestTemplates({ propertyKind: 'valley' });
    // Snapshot encodes the WRONG propertyKind from a previous reassignment.
    const job = await createClaimedJob({ booking, rule, propertyKind: 'valley', payloadSnapshotOverrides: { propertyKind: 'cabin' } });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    assert.ok(/stale_snapshot/.test(String(after.lastError)));
    const mri = await ManualReviewItem.findOne({ category: 'comms_property_mismatch_blocked' }).lean();
    assert.ok(mri);
  });
});

test('rule disabled at dispatch time → skipped_status_guard', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ enabled: false });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'skipped_status_guard');
  });
});

test('rule deleted between schedule and dispatch → terminal failed (rule_not_found)', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await MessageAutomationRule.deleteMany({});
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    assert.equal(after.lastError, 'rule_not_found');
  });
});

// ---------------------------------------------------------------------------
// Template / variable failures
// ---------------------------------------------------------------------------

test('no approved template → failed dispatch row + MRI template_not_approved', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only', templateKeyByChannel: { whatsapp: 'arrival_3d_the_cabin' } });
    // Only draft template exists.
    await MessageTemplate.create({
      key: 'arrival_3d_the_cabin', version: 1, channel: 'whatsapp', locale: 'en', propertyKind: 'cabin', status: 'draft',
      whatsappTemplateName: 'arrival_3d_the_cabin_v1', whatsappLocale: 'en'
    });
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    const d = await MessageDispatch.findOne({ channel: 'whatsapp' }).lean();
    assert.ok(d);
    assert.equal(d.status, 'failed');
    assert.equal(d.error?.code, 'template_not_available');
    const mri = await ManualReviewItem.findOne({ category: 'comms_template_not_approved' }).lean();
    assert.ok(mri, 'MRI comms_template_not_approved must be opened');
  });
});

test('missing required variables (no meetingPoint label) → failed + MRI missing_variables', async () => {
  await withDispatcherFlag('1', async () => {
    // Cabin without meetingPoint.label or arrivalGuideUrl.
    const cabinId = await insertCabin({ meetingPoint: {}, arrivalGuideUrl: null });
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'failed');
    const d = await MessageDispatch.findOne({ channel: 'whatsapp' }).lean();
    assert.equal(d.error?.code, 'missing_required_variables');
    const mri = await ManualReviewItem.findOne({ category: 'comms_missing_variables' }).lean();
    assert.ok(mri);
  });
});

// ---------------------------------------------------------------------------
// Consent / suppression
// ---------------------------------------------------------------------------

test('transactional consent: missing pref row → permissive (accepted)', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
  });
});

test('transactional consent: granted → accepted; unknown → accepted; denied → skipped_no_consent', async () => {
  await withDispatcherFlag('1', async () => {
    for (const consent of ['granted', 'unknown']) {
      await GuestContactPreference.deleteMany({});
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
      await MessageTemplate.deleteMany({});
      await insertApprovedGuestTemplates();
      await GuestContactPreference.create({
        recipientType: 'whatsapp_phone',
        recipientValue: '+359888000000',
        phoneStatus: 'valid',
        transactional: consent,
        marketing: 'denied',
        suppressed: false
      });
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, 'sent', `consent=${consent} must be permissive`);
      await ScheduledMessageJob.deleteMany({});
      await MessageDispatch.deleteMany({});
      await Booking.deleteMany({});
      await Cabin.deleteMany({});
      await MessageAutomationRule.deleteMany({});
    }
    // denied case
    await GuestContactPreference.deleteMany({});
    await MessageTemplate.deleteMany({});
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    await GuestContactPreference.create({
      recipientType: 'whatsapp_phone',
      recipientValue: '+359888000000',
      phoneStatus: 'valid',
      transactional: 'denied',
      marketing: 'denied',
      suppressed: false
    });
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    const res = await dispatcher.processClaimedJob(job._id);
    assert.equal(res.terminal, 'skipped_no_consent');
    const d = await MessageDispatch.findOne({ channel: 'whatsapp' }).lean();
    assert.equal(d.status, 'skipped_no_consent');
    assert.equal(d.error?.code, 'no_transactional_consent');
  });
});

test('suppression: contact pref suppressed → skipped_suppressed', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    await GuestContactPreference.create({
      recipientType: 'whatsapp_phone',
      recipientValue: '+359888000000',
      phoneStatus: 'valid',
      transactional: 'granted',
      marketing: 'denied',
      suppressed: true,
      suppressedReason: 'hard_bounce'
    });
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    const res = await dispatcher.processClaimedJob(job._id);
    assert.equal(res.terminal, 'suppressed');
    const d = await MessageDispatch.findOne({}).lean();
    assert.equal(d.status, 'skipped_suppressed');
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('duplicate idempotencyKey: existing accepted row treated as handled (key shape: ${jobId}:${channel})', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    // First run: produces one accepted row.
    await dispatcher.processClaimedJob(job._id);
    assert.equal(await MessageDispatch.countDocuments({}), 1);
    const dispatched = await MessageDispatch.findOne({}).lean();
    assert.equal(dispatched.idempotencyKey, `${String(job._id)}:whatsapp`);

    // Reset the job back to claimed AND move scheduledFor forward to prove
    // the new key is stable across rescheduling (Batch 9 invariant).
    await ScheduledMessageJob.updateOne(
      { _id: job._id },
      { $set: {
          status: 'claimed',
          claimedBy: 't',
          claimedAt: new Date(),
          visibilityTimeoutAt: futureDate(0.001),
          scheduledFor: new Date(Date.now() + 10 * 60_000)
        } }
    );
    const res = await dispatcher.processClaimedJob(job._id);
    assert.equal(res.terminal, 'sent');
    assert.equal(await MessageDispatch.countDocuments({}), 1, 'no duplicate dispatch row created');
  });
});

// ---------------------------------------------------------------------------
// Retry semantics
// ---------------------------------------------------------------------------

test('retryable provider_throw: job goes back to scheduled with attemptCount++', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    // Monkey-patch the WA shadow provider to throw a retryable error.
    const wa = require('../services/messaging/providers/devShadowWhatsAppProvider');
    const original = wa.sendTemplate;
    wa.sendTemplate = async () => {
      throw Object.assign(new Error('upstream went away'), { code: 'provider_unavailable', retryable: true });
    };
    try {
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, null);
      assert.ok(res.retry);
      const after = await ScheduledMessageJob.findById(job._id).lean();
      assert.equal(after.status, 'scheduled');
      assert.equal(after.attemptCount, 1);
      assert.ok(after.scheduledFor.getTime() > Date.now() + 4 * 60_000);
      assert.match(String(after.lastError), /^retryable:/);
      // No failed MessageDispatch row written for retryable errors.
      assert.equal(await MessageDispatch.countDocuments({ status: 'failed' }), 0);
    } finally {
      wa.sendTemplate = original;
    }
  });
});

test('retryable failure with attemptCount at maxAttempts-1 → terminal failed', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await ScheduledMessageJob.updateOne({ _id: job._id }, { $set: { attemptCount: 2, maxAttempts: 3 } });

    const wa = require('../services/messaging/providers/devShadowWhatsAppProvider');
    const original = wa.sendTemplate;
    wa.sendTemplate = async () => { throw Object.assign(new Error('boom'), { code: 'provider_throw', retryable: true }); };
    try {
      await dispatcher.processClaimedJob(job._id);
      const after = await ScheduledMessageJob.findById(job._id).lean();
      assert.equal(after.status, 'failed');
      assert.equal(after.attemptCount, 3);
      assert.match(String(after.lastError), /^retryable_exhausted:/);
    } finally {
      wa.sendTemplate = original;
    }
  });
});

// ---------------------------------------------------------------------------
// OPS audience
// ---------------------------------------------------------------------------

test('ops rule: recipient resolved from EMAIL_TO_INTERNAL, no GuestContactPreference reads', async () => {
  await withDispatcherFlag('1', async () => {
    const prev = process.env.EMAIL_TO_INTERNAL;
    process.env.EMAIL_TO_INTERNAL = 'ops@drift.example';
    try {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertOpsRule();
      await insertApprovedOpsTemplate();
      // Add a denied guest pref to prove OPS path ignores it.
      await GuestContactPreference.create({
        recipientType: 'email',
        recipientValue: 'ada@example.com',
        phoneStatus: 'unknown',
        transactional: 'denied',
        marketing: 'denied',
        suppressed: true
      });
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, 'sent');
      const d = await MessageDispatch.findOne({}).lean();
      assert.equal(d.channel, 'email');
      assert.equal(d.recipient, 'ops@drift.example');
      assert.equal(d.details.shadow, true);
    } finally {
      if (prev === undefined) delete process.env.EMAIL_TO_INTERNAL;
      else process.env.EMAIL_TO_INTERNAL = prev;
    }
  });
});

test('ops rule with EMAIL_TO_INTERNAL unset → skipped_no_recipient → terminal failed', async () => {
  await withDispatcherFlag('1', async () => {
    const prev = process.env.EMAIL_TO_INTERNAL;
    delete process.env.EMAIL_TO_INTERNAL;
    try {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertOpsRule();
      await insertApprovedOpsTemplate();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, 'failed');
      const d = await MessageDispatch.findOne({}).lean();
      assert.equal(d.status, 'skipped_no_recipient');
    } finally {
      if (prev !== undefined) process.env.EMAIL_TO_INTERNAL = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Scheduler integration
// ---------------------------------------------------------------------------

test('schedulerWorker tickOnce: dispatcher OFF → claim-only behaviour preserved', async () => {
  delete process.env.MESSAGE_DISPATCHER_ENABLED;
  const cabinId = await insertCabin();
  const booking = await insertBooking({ cabinId });
  const rule = await insertGuestCabinRule();
  await insertApprovedGuestTemplates();
  const job = await ScheduledMessageJob.create({
    ruleKey: rule.ruleKey,
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor: pastDate(60),
    status: 'scheduled',
    payloadSnapshot: { propertyKind: 'cabin' }
  });
  await schedulerWorker.tickOnce({ now: new Date() });
  const after = await ScheduledMessageJob.findById(job._id).lean();
  assert.equal(after.status, 'claimed', 'dispatcher OFF must leave status=claimed');
  assert.equal(await MessageDispatch.countDocuments({}), 0);
});

test('schedulerWorker tickOnce: dispatcher ON → end-to-end shadow dispatch', async () => {
  await withDispatcherFlag('1', async () => {
    schedulerWorker.setAwaitDispatcherForTests(true);
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule();
    await insertApprovedGuestTemplates();
    const job = await ScheduledMessageJob.create({
      ruleKey: rule.ruleKey,
      ruleVersionAtSchedule: 1,
      bookingId: booking._id,
      audience: 'guest',
      propertyKind: 'cabin',
      scheduledFor: pastDate(60),
      status: 'scheduled',
      payloadSnapshot: { propertyKind: 'cabin' }
    });
    await schedulerWorker.tickOnce({ now: new Date() });
    const after = await ScheduledMessageJob.findById(job._id).lean();
    assert.equal(after.status, 'sent');
    const dispatches = await MessageDispatch.find({}).lean();
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].providerName, 'internal');
    assert.equal(dispatches[0].details.shadow, true);
    assert.equal(dispatches[0].providerMessageId, null);
  });
});

// ---------------------------------------------------------------------------
// Negative invariants — Batch 8 must never produce side effects beyond shadow
// ---------------------------------------------------------------------------

test('invariant: no MessageDeliveryEvent ever written by the dispatcher', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'both' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
  });
});

test('invariant: every accepted dispatch is shadow (providerName=internal, providerMessageId=null, details.shadow=true)', async () => {
  await withDispatcherFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ channelStrategy: 'both' });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });
    await dispatcher.processClaimedJob(job._id);
    const accepted = await MessageDispatch.find({ status: 'accepted' }).lean();
    assert.ok(accepted.length >= 1);
    for (const d of accepted) {
      assert.equal(d.providerName, 'internal');
      assert.equal(d.providerMessageId, null);
      assert.equal(d.details?.shadow, true);
    }
  });
});

test('invariant: dispatcher and shadow providers never import emailService or external SDKs', () => {
  // Strip comments before scanning so prose mentions of `emailService` /
  // `Postmark` don't trigger false positives. The check is about real
  // `require()` / `import` statements only.
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/[^\n]*$/gm, '');
  }
  // Batch 9: `realEmailProvider.js` is the ONE file allowed to require
  // `emailService`. All other dispatcher-side files must stay free of
  // real-send imports.
  const files = [
    'services/messaging/messageDispatcher.js',
    'services/messaging/providers/devShadowWhatsAppProvider.js',
    'services/messaging/providers/devShadowEmailProvider.js',
    'services/messaging/providers/providerRegistry.js',
    'services/messaging/messageTemplateLookupService.js',
    'services/messaging/messageVariableResolver.js',
    'services/messaging/messageDeliveryEventIngest.js'
  ];
  const corpus = files
    .map((rel) => stripComments(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')))
    .join('\n');

  const bannedRequirePatterns = [
    /require\(\s*['"]axios['"]\s*\)/,
    /require\(\s*['"]nodemailer['"]\s*\)/,
    /require\(\s*['"]postmark['"]\s*\)/,
    /require\(\s*['"]twilio['"]\s*\)/,
    /require\(\s*['"][^'"]*emailService['"]\s*\)/,
    /require\(\s*['"][^'"]*bookingLifecycleEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*giftVoucherEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*communicationWriteService['"]\s*\)/,
    /require\(\s*['"][^'"]*creatorPortalEmail['"]\s*\)/,
    /require\(\s*['"][^'"]*EmailEvent['"]\s*\)/,
    /from\s+['"]axios['"]/,
    /from\s+['"]nodemailer['"]/,
    /from\s+['"]postmark['"]/,
    /from\s+['"]twilio['"]/
  ];
  for (const pat of bannedRequirePatterns) {
    assert.equal(pat.test(corpus), false, `Dispatcher/shadow surface must not include ${pat.source}`);
  }
});

test('invariant: dispatcher does NOT write MessageDeliveryEvent (only webhook ingester does)', () => {
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/[^\n]*$/gm, '');
  }
  const dispatcherSrc = stripComments(fs.readFileSync(
    path.join(__dirname, '..', 'services/messaging/messageDispatcher.js'), 'utf8'
  ));
  assert.equal(/MessageDeliveryEvent/.test(dispatcherSrc), false,
    'messageDispatcher.js must not reference MessageDeliveryEvent — that collection is webhook-only');
});

test('invariant: realEmailProvider only requires emailService (no nodemailer/postmark/axios/bookingLifecycleEmailService)', () => {
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/[^\n]*$/gm, '');
  }
  const src = stripComments(fs.readFileSync(
    path.join(__dirname, '..', 'services/messaging/providers/realEmailProvider.js'), 'utf8'
  ));
  // Allowed:
  assert.ok(/require\(\s*['"]\.\.\/\.\.\/emailService['"]\s*\)/.test(src),
    'realEmailProvider must require ../../emailService');
  // Banned (must wrap public method only, no SDKs, no other email modules):
  const banned = [
    /require\(\s*['"]axios['"]\s*\)/,
    /require\(\s*['"]nodemailer['"]\s*\)/,
    /require\(\s*['"]postmark['"]\s*\)/,
    /require\(\s*['"]twilio['"]\s*\)/,
    /require\(\s*['"][^'"]*bookingLifecycleEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*giftVoucherEmailService['"]\s*\)/,
    /require\(\s*['"][^'"]*communicationWriteService['"]\s*\)/,
    /require\(\s*['"][^'"]*creatorPortalEmail['"]\s*\)/,
    /require\(\s*['"][^'"]*EmailEvent['"]\s*\)/,
    /require\(\s*['"][^'"]*MessageDeliveryEvent['"]\s*\)/
  ];
  for (const pat of banned) {
    assert.equal(pat.test(src), false, `realEmailProvider must not include ${pat.source}`);
  }
});

test('invariant: providerRegistry returns shadow email provider when MESSAGE_EMAIL_PROVIDER_ENABLED is unset', () => {
  const prev = process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
  delete process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
  try {
    const registry = require('../services/messaging/providers/providerRegistry');
    const wa = registry.getWhatsAppProvider();
    const em = registry.getEmailProvider();
    assert.equal(wa.PROVIDER_NAME, 'internal');
    assert.equal(em.PROVIDER_NAME, 'internal');
    assert.equal(wa.shadow, true);
    assert.equal(em.shadow, true);
  } finally {
    if (prev === undefined) delete process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
    else process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = prev;
  }
});

test('invariant: providerRegistry ignores WHATSAPP_PROVIDER env (real WhatsApp lands in Batch 11)', () => {
  const prev = process.env.WHATSAPP_PROVIDER;
  process.env.WHATSAPP_PROVIDER = 'meta_whatsapp';
  try {
    const registry = require('../services/messaging/providers/providerRegistry');
    const wa = registry.getWhatsAppProvider();
    assert.equal(wa.PROVIDER_NAME, 'internal');
    assert.equal(wa.shadow, true);
  } finally {
    if (prev === undefined) delete process.env.WHATSAPP_PROVIDER;
    else process.env.WHATSAPP_PROVIDER = prev;
  }
});

// ---------------------------------------------------------------------------
// Batch 9 — Real email provider outbox flow
// ---------------------------------------------------------------------------

function withEmailProviderFlag(value, fn) {
  const prev = process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
  process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
      else process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = prev;
    });
}

function stubEmailServiceSend(fn) {
  const emailService = require('../services/emailService');
  const original = emailService.sendEmail.bind(emailService);
  emailService.sendEmail = fn;
  return () => { emailService.sendEmail = original; };
}

test('real-email outbox: pending row is inserted BEFORE emailService.sendEmail is called', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      // The stub captures the DB state visible at the moment emailService is
      // called. The dispatcher MUST insert the pending row first.
      let observedDispatch = null;
      const restore = stubEmailServiceSend(async (input) => {
        observedDispatch = await MessageDispatch.findOne({ _id: input.postmarkMetadata.dispatchId }).lean();
        return { success: true, method: 'sent', messageId: 'pm_test_001' };
      });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'sent');
      } finally {
        restore();
      }

      assert.ok(observedDispatch, 'pending row must exist at provider-call time');
      assert.equal(observedDispatch.status, 'pending');
      assert.equal(observedDispatch.providerName, 'postmark');
      assert.equal(observedDispatch.details.shadow, false);
      assert.equal(observedDispatch.details.phase, 'provider_call_pending');
      assert.equal(observedDispatch.idempotencyKey, `${String(job._id)}:email`);

      const finalDispatch = await MessageDispatch.findOne({ idempotencyKey: `${String(job._id)}:email` }).lean();
      assert.equal(finalDispatch.status, 'accepted');
      assert.equal(finalDispatch.providerName, 'postmark');
      assert.equal(finalDispatch.providerMessageId, 'pm_test_001');
      assert.equal(finalDispatch.details.shadow, false);
      assert.equal(finalDispatch.details.phase, 'provider_call_accepted');
    });
  });
});

test('real-email outbox: dispatchId is stamped into Postmark tag and metadata', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      let captured = null;
      const restore = stubEmailServiceSend(async (input) => {
        captured = input;
        return { success: true, method: 'sent', messageId: 'pm_test_002' };
      });
      try {
        await dispatcher.processClaimedJob(job._id);
      } finally {
        restore();
      }

      assert.ok(captured);
      assert.equal(captured.skipIdempotencyWindow, true);
      assert.equal(captured.omitBodyFromLogs, true);
      assert.match(String(captured.postmarkTag), /^dispatch:[0-9a-fA-F]{24}$/);
      assert.ok(captured.postmarkMetadata);
      assert.match(String(captured.postmarkMetadata.dispatchId), /^[0-9a-fA-F]{24}$/);
      assert.equal(captured.postmarkMetadata.channel, 'email');
      assert.equal(captured.postmarkMetadata.bookingId, String(booking._id));
      assert.equal(captured.postmarkMetadata.ruleKey, rule.ruleKey);
      // Critical: the tagged id is the same id used in the DB row.
      const stampedId = captured.postmarkMetadata.dispatchId;
      const row = await MessageDispatch.findOne({ idempotencyKey: `${String(job._id)}:email` }).lean();
      assert.equal(String(row._id), stampedId);
    });
  });
});

test('real-email outbox: provider failure → SAME row updated to failed, job terminally failed, no retry', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      const restore = stubEmailServiceSend(async () => ({ success: false, method: 'failed', error: 'simulated SMTP failure' }));
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'failed', 'real email failure is terminal in Batch 9');
        assert.equal(await MessageDispatch.countDocuments({}), 1, 'only ONE dispatch row total');
        const row = await MessageDispatch.findOne({}).lean();
        assert.equal(row.status, 'failed');
        assert.equal(row.providerName, 'postmark');
        assert.equal(row.details.shadow, false);
        assert.equal(row.details.phase, 'provider_call_failed');
        assert.ok(row.error);
      } finally {
        restore();
      }

      // A subsequent dispatcher pass (simulating a worker re-pickup) must not
      // call the provider again.
      let called = false;
      const restore2 = stubEmailServiceSend(async () => { called = true; return { success: true, method: 'sent' }; });
      try {
        await ScheduledMessageJob.updateOne({ _id: job._id }, { $set: { status: 'claimed', claimedBy: 't', claimedAt: new Date(), visibilityTimeoutAt: futureDate(0.001) } });
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(called, false, 'emailService must NOT be called for a failed dispatch');
        assert.equal(res.terminal, 'failed');
        assert.equal(await MessageDispatch.countDocuments({}), 1);
      } finally {
        restore2();
      }
    });
  });
});

test('real-email outbox: existing ACCEPTED row short-circuits without calling provider', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      // First run succeeds.
      let calls = 0;
      const restore = stubEmailServiceSend(async () => { calls += 1; return { success: true, method: 'sent', messageId: 'pm_first' }; });
      try {
        await dispatcher.processClaimedJob(job._id);
      } finally {
        restore();
      }
      assert.equal(calls, 1);

      // Re-claim and re-dispatch. Provider must NOT be called.
      await ScheduledMessageJob.updateOne({ _id: job._id }, { $set: { status: 'claimed', claimedBy: 't', claimedAt: new Date(), visibilityTimeoutAt: futureDate(0.001) } });
      let secondCalls = 0;
      const restore2 = stubEmailServiceSend(async () => { secondCalls += 1; return { success: true, method: 'sent', messageId: 'pm_should_not_happen' }; });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'sent');
      } finally {
        restore2();
      }
      assert.equal(secondCalls, 0, 'real provider must not be called when accepted row exists');
      assert.equal(await MessageDispatch.countDocuments({}), 1);
    });
  });
});

test('real-email outbox: existing PENDING row → no provider call, job failed, MRI opened', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      // Simulate a crash mid-send: a pending row exists for this job/channel.
      await MessageDispatch.create({
        _id: new mongoose.Types.ObjectId(),
        scheduledMessageJobId: job._id,
        bookingId: booking._id,
        ruleKey: rule.ruleKey,
        templateKey: 'arrival_3d_the_cabin',
        templateVersion: 1,
        channel: 'email',
        recipient: 'ada@example.com',
        lifecycleSource: 'automatic',
        status: 'pending',
        providerName: 'postmark',
        providerMessageId: null,
        idempotencyKey: `${String(job._id)}:email`,
        details: { shadow: false, phase: 'provider_call_pending' }
      });

      let called = false;
      const restore = stubEmailServiceSend(async () => { called = true; return { success: true, method: 'sent' }; });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'failed', 'pending row blocks further sends; job is failed');
      } finally {
        restore();
      }
      assert.equal(called, false, 'pending row must short-circuit before the provider');
      assert.equal(await MessageDispatch.countDocuments({}), 1, 'no second row created');
      const mri = await ManualReviewItem.findOne({ category: 'comms_dispatcher_processing_failed' }).lean();
      assert.ok(mri, 'MRI comms_dispatcher_processing_failed must be opened');
    });
  });
});

test('real-email outbox: existing FAILED row → no provider call, job failed', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'auto',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      await MessageDispatch.create({
        _id: new mongoose.Types.ObjectId(),
        scheduledMessageJobId: job._id,
        bookingId: booking._id,
        ruleKey: rule.ruleKey,
        templateKey: 'arrival_3d_the_cabin',
        templateVersion: 1,
        channel: 'email',
        recipient: 'ada@example.com',
        lifecycleSource: 'automatic',
        status: 'failed',
        providerName: 'postmark',
        providerMessageId: null,
        error: { code: 'provider_throw', message: 'previously failed' },
        idempotencyKey: `${String(job._id)}:email`,
        details: { shadow: false, phase: 'provider_call_failed' }
      });

      let called = false;
      const restore = stubEmailServiceSend(async () => { called = true; return { success: true, method: 'sent' }; });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'failed');
      } finally {
        restore();
      }
      assert.equal(called, false);
      assert.equal(await MessageDispatch.countDocuments({}), 1);
    });
  });
});

test('real-email path: MESSAGE_DISPATCHER_ENABLED off → no provider invocation at all', async () => {
  delete process.env[ENV_FLAG];
  await withEmailProviderFlag('1', async () => {
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ mode: 'auto', channelStrategy: 'email_only', templateKeyByChannel: { email: 'arrival_3d_the_cabin' } });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    let called = false;
    const restore = stubEmailServiceSend(async () => { called = true; return { success: true, method: 'sent' }; });
    try {
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.disabled, true);
    } finally {
      restore();
    }
    assert.equal(called, false);
    assert.equal(await MessageDispatch.countDocuments({}), 0);
  });
});

test('real-email path: MESSAGE_EMAIL_PROVIDER_ENABLED off → email channel uses SHADOW provider (no emailService call)', async () => {
  await withDispatcherFlag('1', async () => {
    delete process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
    const cabinId = await insertCabin();
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule({ mode: 'auto', channelStrategy: 'email_only', templateKeyByChannel: { email: 'arrival_3d_the_cabin' } });
    await insertApprovedGuestTemplates();
    const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

    let called = false;
    const restore = stubEmailServiceSend(async () => { called = true; return { success: true, method: 'sent' }; });
    try {
      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, 'sent');
    } finally {
      restore();
    }
    assert.equal(called, false, 'shadow path must not touch emailService');
    const d = await MessageDispatch.findOne({}).lean();
    assert.equal(d.status, 'accepted');
    assert.equal(d.providerName, 'internal');
    assert.equal(d.details.shadow, true);
  });
});

test('real-email path: WhatsApp channel still shadow even when MESSAGE_EMAIL_PROVIDER_ENABLED=1', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({ channelStrategy: 'whatsapp_only' });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      const res = await dispatcher.processClaimedJob(job._id);
      assert.equal(res.terminal, 'sent');
      const d = await MessageDispatch.findOne({}).lean();
      assert.equal(d.channel, 'whatsapp');
      assert.equal(d.providerName, 'internal');
      assert.equal(d.details.shadow, true);
    });
  });
});

test('GMA mode shadow + MESSAGE_EMAIL_PROVIDER_ENABLED=1 still uses shadow email (no emailService)', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'shadow',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      let called = false;
      const restore = stubEmailServiceSend(async () => {
        called = true;
        return { success: true, method: 'sent', messageId: 'pm_shadow_mode' };
      });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'sent');
      } finally {
        restore();
      }
      assert.equal(called, false, 'shadow mode must not call emailService even when MESSAGE_EMAIL_PROVIDER_ENABLED=1');
      const d = await MessageDispatch.findOne({}).lean();
      assert.equal(d.details.shadow, true);
      assert.equal(d.providerName, 'internal');
    });
  });
});

test('GMA mode manual_approve: claimed job fails without MessageDispatch or provider', async () => {
  await withDispatcherFlag('1', async () => {
    await withEmailProviderFlag('1', async () => {
      const cabinId = await insertCabin();
      const booking = await insertBooking({ cabinId });
      const rule = await insertGuestCabinRule({
        mode: 'manual_approve',
        ruleKey: 'manual_approve_dispatcher_smoke',
        channelStrategy: 'email_only',
        templateKeyByChannel: { email: 'arrival_3d_the_cabin' }
      });
      await insertApprovedGuestTemplates();
      const job = await createClaimedJob({ booking, rule, propertyKind: 'cabin' });

      let called = false;
      const restore = stubEmailServiceSend(async () => {
        called = true;
        return { success: true, method: 'sent', messageId: 'x' };
      });
      try {
        const res = await dispatcher.processClaimedJob(job._id);
        assert.equal(res.terminal, 'failed');
        assert.equal(res.reason, 'manual_approve_not_supported_yet');
      } finally {
        restore();
      }
      assert.equal(called, false);
      assert.equal(await MessageDispatch.countDocuments({}), 0);
      const after = await ScheduledMessageJob.findById(job._id).lean();
      assert.equal(after.status, 'failed');
      assert.equal(after.lastError, 'manual_approve_not_supported_yet');
    });
  });
});

test('invariant: providerRegistry email — auto uses env; shadow ignores real env', () => {
  const prev = process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
  try {
    const registry = require('../services/messaging/providers/providerRegistry');
    process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = '1';
    const realAuto = registry.getProviderForChannel('email', { automationMode: 'auto' });
    assert.equal(realAuto.PROVIDER_NAME, 'postmark');
    assert.equal(realAuto.shadow, false);
    const shadowMode = registry.getProviderForChannel('email', { automationMode: 'shadow' });
    assert.equal(shadowMode.PROVIDER_NAME, 'internal');
    assert.equal(shadowMode.shadow, true);
    const manualDefensive = registry.getProviderForChannel('email', { automationMode: 'manual_approve' });
    assert.equal(manualDefensive.shadow, true);
    assert.equal(manualDefensive.PROVIDER_NAME, 'internal');
    const emailLegacy = registry.getEmailProvider();
    assert.equal(emailLegacy.PROVIDER_NAME, 'postmark');
    assert.equal(emailLegacy.shadow, false);
    for (const v of ['0', 'true', 'TRUE', 'yes', 'on', '']) {
      process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = v;
      const em = registry.getProviderForChannel('email', { automationMode: 'auto' });
      assert.equal(em.PROVIDER_NAME, 'internal', `flag="${v}" auto mode must use shadow`);
      assert.equal(em.shadow, true);
      assert.equal(registry.getProviderForChannel('email', { automationMode: 'shadow' }).shadow, true);
    }
  } finally {
    if (prev === undefined) delete process.env.MESSAGE_EMAIL_PROVIDER_ENABLED;
    else process.env.MESSAGE_EMAIL_PROVIDER_ENABLED = prev;
  }
});
