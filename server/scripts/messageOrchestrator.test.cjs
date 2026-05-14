/**
 * Batch 7 — MessageOrchestrator contract tests.
 *
 * Run: npm run test:message-orchestrator (from server/)
 *
 * Covers:
 *   - Default-off flag: no writes.
 *   - Strict payment-proof guard (D-12) for every paymentMethod combo.
 *   - PropertyKind resolution via propertyKindResolver only.
 *   - Idempotent scheduling (unique key).
 *   - Cancellation cascades only `scheduled`/`claimed`, never terminals.
 *   - Date-edit reschedule + dates-unchanged no-op.
 *   - Reassignment (cancel + rerun) + missing propertyKind path.
 *   - OPS rules seed-disabled => no jobs; enabled-in-test => one job.
 *   - Sofia DST math (spring-forward + fall-back).
 *   - Orchestrator failure isolation (top-level catch + ManualReviewItem).
 *   - No MessageDispatch / MessageDeliveryEvent rows ever written.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const MessageAutomationRule = require('../models/MessageAutomationRule');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');
const MessageDeliveryEvent = require('../models/MessageDeliveryEvent');
const ManualReviewItem = require('../models/ManualReviewItem');

const orchestrator = require('../services/messaging/messageOrchestrator');
const { computeScheduledSofiaInstant } = require('../services/messaging/messageOrchestratorTime');

const { ENV_FLAG } = orchestrator;

let mongoServer;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function withFlag(value, fn) {
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

async function insertCabin({ propertyKind = 'cabin' } = {}) {
  const _id = new mongoose.Types.ObjectId();
  // Bypass full Cabin validators (image url, capacity, etc.) — the orchestrator
  // only reads `propertyKind`.
  await Cabin.collection.insertOne({ _id, propertyKind, name: 'Test Cabin' });
  return _id;
}

async function insertCabinType({ propertyKind = 'valley' } = {}) {
  const _id = new mongoose.Types.ObjectId();
  await CabinType.collection.insertOne({ _id, propertyKind, name: 'Test CabinType' });
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

async function insertGuestValleyRule(overrides = {}) {
  return MessageAutomationRule.create({
    ruleKey: 'arrival_instructions_pre_arrival_valley',
    description: 'test valley guest rule',
    triggerType: 'time_relative_to_check_in',
    triggerConfig: { offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 },
    propertyScope: 'valley',
    channelStrategy: 'whatsapp_first_email_fallback',
    templateKeyByChannel: { whatsapp: 'arrival_3d_the_valley', email: 'arrival_3d_the_valley' },
    requiresConsent: 'transactional',
    enabled: true,
    mode: 'shadow',
    audience: 'guest',
    requiredBookingStatus: ['confirmed'],
    requirePaidIfStripe: true,
    ...overrides
  });
}

async function insertOpsAlertRule(overrides = {}) {
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

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([
    ScheduledMessageJob.syncIndexes(),
    MessageAutomationRule.syncIndexes(),
    MessageDispatch.syncIndexes(),
    MessageDeliveryEvent.syncIndexes(),
    ManualReviewItem.syncIndexes()
  ]);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await Promise.all([
    Booking.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    MessageAutomationRule.deleteMany({}),
    ScheduledMessageJob.deleteMany({}),
    MessageDispatch.deleteMany({}),
    MessageDeliveryEvent.deleteMany({}),
    ManualReviewItem.deleteMany({})
  ]);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('passesPaymentProofGuard: allowed combinations', () => {
  const { passesPaymentProofGuard } = orchestrator.__internals;
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe', stripePaymentIntentId: 'pi_1' }), true);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe_plus_gift_voucher', stripePaymentIntentId: 'pi_2' }), true);
  assert.equal(passesPaymentProofGuard({
    paymentMethod: 'gift_voucher',
    giftVoucherRedemptionId: new mongoose.Types.ObjectId()
  }), true);
});

test('passesPaymentProofGuard: blocked combinations (D-12)', () => {
  const { passesPaymentProofGuard } = orchestrator.__internals;
  // Stripe confirmed but no PI (e.g. BOOKING_CONFIRM_WITHOUT_STRIPE).
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe', stripePaymentIntentId: null }), false);
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'stripe', stripePaymentIntentId: '' }), false);
  // stripe_plus_gift_voucher must have PI even though voucher exists.
  assert.equal(passesPaymentProofGuard({
    paymentMethod: 'stripe_plus_gift_voucher',
    stripePaymentIntentId: null,
    giftVoucherRedemptionId: new mongoose.Types.ObjectId()
  }), false);
  // Full gift_voucher must have redemption id.
  assert.equal(passesPaymentProofGuard({ paymentMethod: 'gift_voucher', giftVoucherRedemptionId: null }), false);
  // Unknown/missing paymentMethod.
  assert.equal(passesPaymentProofGuard({ paymentMethod: null, stripePaymentIntentId: 'pi_x' }), false);
  assert.equal(passesPaymentProofGuard(null), false);
});

// ---------------------------------------------------------------------------
// Sofia timing / DST
// ---------------------------------------------------------------------------

test('computeScheduledSofiaInstant: T-72h is calendar-based, snaps to 17:00 Sofia', () => {
  // Check-in calendar date 2026-08-10 in Sofia. T-72h => 2026-08-07 17:00 Sofia.
  const anchor = moment.tz('2026-08-10', 'Europe/Sofia').toDate();
  const out = computeScheduledSofiaInstant({ anchorDate: anchor, offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 });
  const got = moment.tz(out.scheduledForUtc, 'Europe/Sofia');
  assert.equal(got.format('YYYY-MM-DD HH:mm'), '2026-08-07 17:00');
});

test('computeScheduledSofiaInstant: T-72h across spring-forward (Mar) yields 17:00 Sofia, not 18:00', () => {
  // Sofia spring-forward 2027: last Sunday of March (2027-03-28). Pick checkIn
  // 2027-03-30 (Tue). T-72h => 2027-03-27 17:00 Sofia (Sat, before the DST jump).
  const anchor = moment.tz('2027-03-30', 'Europe/Sofia').toDate();
  const out = computeScheduledSofiaInstant({ anchorDate: anchor, offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 });
  const got = moment.tz(out.scheduledForUtc, 'Europe/Sofia');
  assert.equal(got.format('YYYY-MM-DD HH:mm'), '2027-03-27 17:00');
  // Also verify a UTC arithmetic approach would be wrong (it'd be 16:00 Sofia
  // for an anchor that already crossed DST). We compare against the calendar
  // result to lock the spec intent.
});

test('computeScheduledSofiaInstant: T-72h across fall-back (Oct) yields 17:00 Sofia', () => {
  // Sofia fall-back 2026: last Sunday of October (2026-10-25). Pick checkIn
  // 2026-10-27 (Tue). T-72h => 2026-10-24 17:00 Sofia (Sat, before DST end).
  const anchor = moment.tz('2026-10-27', 'Europe/Sofia').toDate();
  const out = computeScheduledSofiaInstant({ anchorDate: anchor, offsetHours: -72, sofiaHour: 17, sofiaMinute: 0 });
  const got = moment.tz(out.scheduledForUtc, 'Europe/Sofia');
  assert.equal(got.format('YYYY-MM-DD HH:mm'), '2026-10-24 17:00');
});

test('computeScheduledSofiaInstant: non-multiple-of-24 hours still snaps to configured hour:minute', () => {
  const anchor = moment.tz('2026-08-10', 'Europe/Sofia').toDate();
  const out = computeScheduledSofiaInstant({ anchorDate: anchor, offsetHours: -36, sofiaHour: 9, sofiaMinute: 30 });
  const got = moment.tz(out.scheduledForUtc, 'Europe/Sofia');
  // -36h from 2026-08-10 00:00 Sofia lands on 2026-08-08 12:00 Sofia; we then
  // start-of-day + snap to 09:30 -> 2026-08-08 09:30 Sofia.
  assert.equal(got.format('YYYY-MM-DD HH:mm'), '2026-08-08 09:30');
});

test('computeScheduledSofiaInstant: returns null for invalid anchor', () => {
  assert.equal(computeScheduledSofiaInstant({ anchorDate: null, offsetHours: -72 }), null);
  assert.equal(computeScheduledSofiaInstant({ anchorDate: 'garbage', offsetHours: -72 }), null);
});

// ---------------------------------------------------------------------------
// Flag-off contract
// ---------------------------------------------------------------------------

test('flag OFF (default): notifyBookingCreated creates no jobs', async () => {
  delete process.env[ENV_FLAG];
  const cabinId = await insertCabin({ propertyKind: 'cabin' });
  const booking = await insertBooking({ cabinId });
  await insertGuestCabinRule();
  const r = await orchestrator.notifyBookingCreated({ bookingId: booking._id });
  assert.equal(r.ran, false);
  assert.equal(r.disabled, true);
  assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
});

test('flag set to non-"1" values does not enable the orchestrator', async () => {
  const cabinId = await insertCabin({ propertyKind: 'cabin' });
  const booking = await insertBooking({ cabinId });
  await insertGuestCabinRule();

  for (const v of ['0', 'true', 'TRUE', 'yes', '', 'on']) {
    await withFlag(v, async () => {
      const r = await orchestrator.notifyBookingCreated({ bookingId: booking._id });
      assert.equal(r.ran, false, `flag value "${v}" must not enable orchestrator`);
    });
  }
  assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
});

// ---------------------------------------------------------------------------
// Schedule pass — base happy paths
// ---------------------------------------------------------------------------

test('flag ON, guest rule enabled, paid Stripe confirmed booking schedules one job', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId, checkIn: futureDate(10), checkOut: futureDate(13) });
    const rule = await insertGuestCabinRule();
    await insertGuestValleyRule(); // not applicable (scope mismatch)

    await orchestrator.notifyBookingCreated({ bookingId: booking._id });

    const jobs = await ScheduledMessageJob.find({}).lean();
    assert.equal(jobs.length, 1, 'exactly one job for the matching cabin rule');
    const job = jobs[0];
    assert.equal(job.ruleKey, rule.ruleKey);
    assert.equal(job.status, 'scheduled');
    assert.equal(job.audience, 'guest');
    assert.equal(job.propertyKind, 'cabin');
    assert.equal(String(job.bookingId), String(booking._id));
    // Sofia send time = checkIn calendar day minus 3 days, 17:00 Sofia.
    const expectSofia = moment.tz(booking.checkIn, 'Europe/Sofia').startOf('day').subtract(3, 'days').hour(17);
    const gotSofia = moment.tz(job.scheduledFor, 'Europe/Sofia');
    assert.equal(gotSofia.format('YYYY-MM-DD HH:mm'), expectSofia.format('YYYY-MM-DD HH:mm'));
  });
});

test('flag ON, rule DISABLED -> no job', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule({ enabled: false });
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
  });
});

// ---------------------------------------------------------------------------
// Strict payment-proof guard (D-12)
// ---------------------------------------------------------------------------

test('paid: stripe_plus_gift_voucher WITH stripePaymentIntentId schedules', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'stripe_plus_gift_voucher',
      stripePaymentIntentId: 'pi_combo_1',
      giftVoucherRedemptionId: new mongoose.Types.ObjectId()
    });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 1);
  });
});

test('blocked: stripe_plus_gift_voucher WITHOUT stripePaymentIntentId does NOT schedule', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'stripe_plus_gift_voucher',
      stripePaymentIntentId: null,
      giftVoucherRedemptionId: new mongoose.Types.ObjectId()
    });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
  });
});

test('paid: full gift_voucher WITH giftVoucherRedemptionId schedules', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'gift_voucher',
      stripePaymentIntentId: null,
      giftVoucherRedemptionId: new mongoose.Types.ObjectId()
    });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 1);
  });
});

test('blocked: full gift_voucher WITHOUT redemption id does NOT schedule', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'gift_voucher',
      stripePaymentIntentId: null,
      giftVoucherRedemptionId: null
    });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
  });
});

test('blocked: confirmed booking with paymentMethod=stripe but no PI (D-12 / BOOKING_CONFIRM_WITHOUT_STRIPE shape)', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'stripe',
      stripePaymentIntentId: null,
      giftVoucherRedemptionId: null,
      provenance: { source: 'guest_portal' }
    });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
    // And no ManualReviewItem for a normal D-12 block.
    assert.equal(await ManualReviewItem.countDocuments({}), 0);
  });
});

// ---------------------------------------------------------------------------
// PropertyKind handling
// ---------------------------------------------------------------------------

test('cabinTypeId path resolves propertyKind via CabinType resolver', async () => {
  await withFlag('1', async () => {
    const cabinTypeId = await insertCabinType({ propertyKind: 'valley' });
    const booking = await insertBooking({ cabinId: null, cabinTypeId });
    await insertGuestCabinRule(); // scope cabin, won't match
    await insertGuestValleyRule(); // scope valley, will match
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    const jobs = await ScheduledMessageJob.find({}).lean();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].ruleKey, 'arrival_instructions_pre_arrival_valley');
    assert.equal(jobs[0].propertyKind, 'valley');
  });
});

test('missing propertyKind opens ManualReviewItem and creates no guest jobs', async () => {
  await withFlag('1', async () => {
    // Insert cabin with NO propertyKind, so resolver throws.
    const cabinId = new mongoose.Types.ObjectId();
    await Cabin.collection.insertOne({ _id: cabinId, name: 'broken' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });

    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
    const items = await ManualReviewItem.find({ category: 'comms_property_kind_missing' }).lean();
    assert.equal(items.length, 1);
    assert.equal(items[0].entityId, String(booking._id));
    assert.equal(items[0].severity, 'high');

    // Re-running is idempotent: same single review item.
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ManualReviewItem.countDocuments({ category: 'comms_property_kind_missing' }), 1);
  });
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('idempotency: two notifyBookingCreated calls produce exactly one job', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 1);
  });
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test('cancel: notifyBookingStatusChange -> cancelled cancels scheduled + claimed, leaves terminals alone', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    const rule = await insertGuestCabinRule();

    // Pre-create a mix of statuses for the same booking.
    const baseScheduledFor = futureDate(5);
    const ids = {};
    for (const status of ['scheduled', 'claimed', 'sent', 'failed', 'cancelled', 'suppressed', 'skipped_status_guard', 'skipped_no_consent']) {
      const j = await ScheduledMessageJob.create({
        ruleKey: `${rule.ruleKey}__${status}`,
        ruleVersionAtSchedule: 1,
        bookingId: booking._id,
        audience: 'guest',
        propertyKind: 'cabin',
        scheduledFor: new Date(baseScheduledFor.getTime() + Math.random() * 1000),
        status
      });
      ids[status] = j._id;
    }

    await orchestrator.notifyBookingStatusChange({
      bookingId: booking._id,
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      transitionKind: 'cancel'
    });

    const finals = {};
    for (const [status, id] of Object.entries(ids)) {
      const row = await ScheduledMessageJob.findById(id).lean();
      finals[status] = row.status;
    }
    assert.equal(finals.scheduled, 'cancelled');
    assert.equal(finals.claimed, 'cancelled');
    // Terminals stay untouched.
    assert.equal(finals.sent, 'sent');
    assert.equal(finals.failed, 'failed');
    assert.equal(finals.cancelled, 'cancelled');
    assert.equal(finals.suppressed, 'suppressed');
    assert.equal(finals.skipped_status_guard, 'skipped_status_guard');
    assert.equal(finals.skipped_no_consent, 'skipped_no_consent');

    // cancelReason + cancelActor set on cancelled-by-orchestrator rows.
    const cancelledScheduled = await ScheduledMessageJob.findById(ids.scheduled).lean();
    assert.equal(cancelledScheduled.cancelReason, 'booking_cancelled');
    assert.equal(cancelledScheduled.cancelActor, 'orchestrator');

    // No MessageDispatch / MessageDeliveryEvent writes anywhere.
    assert.equal(await MessageDispatch.countDocuments({}), 0);
    assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
  });
});

test('cancel: idempotent (second cancel is a no-op)', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 1);

    await orchestrator.notifyBookingStatusChange({
      bookingId: booking._id,
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      transitionKind: 'cancel'
    });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 0);
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'cancelled' }), 1);

    // Second pass: still 0 scheduled, 1 cancelled.
    await orchestrator.notifyBookingStatusChange({
      bookingId: booking._id,
      previousStatus: 'cancelled',
      nextStatus: 'cancelled',
      transitionKind: 'cancel'
    });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'cancelled' }), 1);
  });
});

// ---------------------------------------------------------------------------
// Date edits
// ---------------------------------------------------------------------------

test('date edit (changed dates): cancels old future jobs and schedules new ones', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId, checkIn: futureDate(10), checkOut: futureDate(13) });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    const initial = await ScheduledMessageJob.find({}).lean();
    assert.equal(initial.length, 1);
    const initialScheduledFor = initial[0].scheduledFor.getTime();

    // Change dates: push out by 7 days.
    const previousCheckIn = booking.checkIn;
    const previousCheckOut = booking.checkOut;
    const newCheckIn = futureDate(17);
    const newCheckOut = futureDate(20);
    await Booking.collection.updateOne({ _id: booking._id }, { $set: { checkIn: newCheckIn, checkOut: newCheckOut } });

    await orchestrator.notifyReservationDatesChanged({
      bookingId: booking._id,
      previousCheckIn,
      previousCheckOut
    });

    const allJobs = await ScheduledMessageJob.find({}).lean();
    assert.equal(allJobs.length, 2, 'old cancelled + new scheduled');
    const cancelled = allJobs.find((j) => j.status === 'cancelled');
    const scheduled = allJobs.find((j) => j.status === 'scheduled');
    assert.ok(cancelled);
    assert.ok(scheduled);
    assert.equal(cancelled.cancelReason, 'rescheduled_due_to_date_edit');
    assert.notEqual(scheduled.scheduledFor.getTime(), initialScheduledFor);
  });
});

test('date edit (unchanged dates): no-op', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    const initialCount = await ScheduledMessageJob.countDocuments({});
    assert.equal(initialCount, 1);

    await orchestrator.notifyReservationDatesChanged({
      bookingId: booking._id,
      previousCheckIn: booking.checkIn,
      previousCheckOut: booking.checkOut
    });
    const after = await ScheduledMessageJob.find({}).lean();
    assert.equal(after.length, 1);
    assert.equal(after[0].status, 'scheduled', 'untouched');
  });
});

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

test('reassignment (resolvable new propertyKind): cancels + reruns schedule pass', async () => {
  await withFlag('1', async () => {
    const oldCabinId = await insertCabin({ propertyKind: 'cabin' });
    const newCabinId = await insertCabin({ propertyKind: 'valley' });
    const booking = await insertBooking({ cabinId: oldCabinId });
    await insertGuestCabinRule();
    await insertGuestValleyRule();

    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 1);

    // Reassign to valley cabin.
    await Booking.collection.updateOne({ _id: booking._id }, { $set: { cabinId: newCabinId } });
    await orchestrator.notifyReservationReassigned({ bookingId: booking._id, previousCabinId: oldCabinId });

    const jobs = await ScheduledMessageJob.find({}).lean();
    const cancelled = jobs.filter((j) => j.status === 'cancelled');
    const scheduled = jobs.filter((j) => j.status === 'scheduled');
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].cancelReason, 'rescheduled_due_to_reassignment');
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].propertyKind, 'valley');
    assert.equal(scheduled[0].ruleKey, 'arrival_instructions_pre_arrival_valley');
  });
});

test('reassignment (missing propertyKind on new cabin): cancels + opens ManualReviewItem + no new jobs', async () => {
  await withFlag('1', async () => {
    const oldCabinId = await insertCabin({ propertyKind: 'cabin' });
    const brokenCabinId = new mongoose.Types.ObjectId();
    await Cabin.collection.insertOne({ _id: brokenCabinId, name: 'no_kind' });
    const booking = await insertBooking({ cabinId: oldCabinId });
    await insertGuestCabinRule();

    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 1);

    await Booking.collection.updateOne({ _id: booking._id }, { $set: { cabinId: brokenCabinId } });
    await orchestrator.notifyReservationReassigned({ bookingId: booking._id, previousCabinId: oldCabinId });

    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 0);
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'cancelled' }), 1);
    assert.equal(await ManualReviewItem.countDocuments({ category: 'comms_property_kind_missing' }), 1);
  });
});

// ---------------------------------------------------------------------------
// Failure isolation
// ---------------------------------------------------------------------------

test('orchestrator failure: rule load throws -> ManualReviewItem + no crash', async (t) => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });

    const origFind = MessageAutomationRule.find;
    MessageAutomationRule.find = () => {
      const q = { lean: () => Promise.reject(new Error('boom-rules')) };
      return q;
    };
    t.after(() => { MessageAutomationRule.find = origFind; });

    const r = await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(r.ran, true);
    assert.equal(r.error, true);
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
    const items = await ManualReviewItem.find({ category: 'comms_orchestrator_hook_failed' }).lean();
    assert.equal(items.length, 1);
    assert.equal(items[0].entityId, String(booking._id));
  });
});

// ---------------------------------------------------------------------------
// OPS rules
// ---------------------------------------------------------------------------

test('OPS rule seed-disabled (enabled=false) produces no job alongside enabled guest rule', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await insertOpsAlertRule({ enabled: false });

    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    const jobs = await ScheduledMessageJob.find({}).lean();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].audience, 'guest');
  });
});

test('OPS rule manually enabled in test schedules one OPS job (engine generality)', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertOpsAlertRule({ enabled: true });

    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    const jobs = await ScheduledMessageJob.find({}).lean();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].audience, 'ops');
    assert.equal(jobs[0].propertyKind, 'any');
  });
});

// ---------------------------------------------------------------------------
// Past targets
// ---------------------------------------------------------------------------

test('past scheduledFor (very-soon check-in) is skipped, no job, no review item', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    // Check-in tomorrow -> T-72h is in the past.
    const booking = await insertBooking({ cabinId, checkIn: futureDate(1), checkOut: futureDate(3) });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
    assert.equal(await ManualReviewItem.countDocuments({}), 0);
  });
});

// ---------------------------------------------------------------------------
// Status transitions other than cancel
// ---------------------------------------------------------------------------

test('pending -> confirmed status transition runs schedule pass', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    // Insert as pending: orchestrator's status guard blocks while pending.
    const booking = await insertBooking({ cabinId, status: 'pending' });
    await insertGuestCabinRule();

    // Pending -> no job (status_mismatch).
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);

    // Now flip status to confirmed and notify.
    await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: 'confirmed' } });
    await orchestrator.notifyBookingStatusChange({
      bookingId: booking._id,
      previousStatus: 'pending',
      nextStatus: 'confirmed',
      transitionKind: 'confirm'
    });
    assert.equal(await ScheduledMessageJob.countDocuments({ status: 'scheduled' }), 1);
  });
});

// ---------------------------------------------------------------------------
// Manual reservation entrypoint
// ---------------------------------------------------------------------------

test('manual reservation that lacks PI/voucher proof is blocked by strict guard', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({
      cabinId,
      paymentMethod: 'stripe', // default; manual booking has no PI
      stripePaymentIntentId: null,
      giftVoucherRedemptionId: null,
      provenance: { source: 'admin_manual' }
    });
    await insertGuestCabinRule();
    await orchestrator.notifyManualReservationCreated({ bookingId: booking._id });
    assert.equal(await ScheduledMessageJob.countDocuments({}), 0);
  });
});

// ---------------------------------------------------------------------------
// Global invariants
// ---------------------------------------------------------------------------

test('global: no MessageDispatch or MessageDeliveryEvent rows are written by any orchestrator path', async () => {
  await withFlag('1', async () => {
    const cabinId = await insertCabin({ propertyKind: 'cabin' });
    const booking = await insertBooking({ cabinId });
    await insertGuestCabinRule();
    await orchestrator.notifyBookingCreated({ bookingId: booking._id });
    await orchestrator.notifyBookingStatusChange({
      bookingId: booking._id,
      previousStatus: 'confirmed',
      nextStatus: 'cancelled',
      transitionKind: 'cancel'
    });
    await orchestrator.notifyReservationDatesChanged({ bookingId: booking._id, previousCheckIn: booking.checkIn, previousCheckOut: booking.checkOut });
    await orchestrator.notifyReservationReassigned({ bookingId: booking._id, previousCabinId: cabinId });
    assert.equal(await MessageDispatch.countDocuments({}), 0);
    assert.equal(await MessageDeliveryEvent.countDocuments({}), 0);
  });
});
