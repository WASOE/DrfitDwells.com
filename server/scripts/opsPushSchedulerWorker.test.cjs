/**
 * OPS-PUSH-4 — scheduler worker tests.
 * Run: node --test scripts/opsPushSchedulerWorker.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const OpsPushScheduledJob = require('../models/OpsPushScheduledJob');
const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const {
  tickOnce,
  sweepStaleClaimedOnce,
  startOpsPushSchedulerWorkerIfEnabled,
  stopOpsPushSchedulerWorkerForTest,
  getOpsPushSchedulerWorkerState,
  computeBackoffMs,
  setAwaitExecuteForTests,
  ENV_FLAG,
  ENV_MAX_DELIVERY_AGE_MS,
  OBSOLETE_JOB_REASON,
  DEFAULT_MAX_DELIVERY_AGE_MS
} = require('../services/ops/push/opsPushSchedulerWorker');
const { __setSendOpsPushSafelyForTesting, __resetSendOpsPushSafelyForTesting } = require('../services/ops/push/opsPushScheduledNotifications');

let mongoServer;
let sendCalls = 0;

function pastDate(secondsAgo = 1) {
  return new Date(Date.now() - secondsAgo * 1000);
}

function futureDate(secondsAhead = 3600) {
  return new Date(Date.now() + secondsAhead * 1000);
}

async function createFixtureBooking() {
  const cabin = await Cabin.create({
    name: 'Worker Test Cabin',
    description: 'Worker test',
    location: 'Bansko',
    imageUrl: '/uploads/cabins/test.jpg',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    isActive: true,
    propertyKind: 'cabin',
    transportOptions: []
  });
  return Booking.create({
    cabinId: cabin._id,
    checkIn: futureDate(86400 * 5),
    checkOut: futureDate(86400 * 8),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Worker',
      lastName: 'Test',
      email: 'worker@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.OPS_PUSH_SCHEDULER_WORKER_ENABLED = '1';
  process.env.OPS_PUSH_SCHEDULED_ENABLED = '1';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsPushScheduledJob.syncIndexes();
});

test.after(async () => {
  stopOpsPushSchedulerWorkerForTest();
  __resetSendOpsPushSafelyForTesting();
  delete process.env.OPS_PUSH_SCHEDULER_WORKER_ENABLED;
  delete process.env.OPS_PUSH_SCHEDULED_ENABLED;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  stopOpsPushSchedulerWorkerForTest();
  setAwaitExecuteForTests(true);
  sendCalls = 0;
  __setSendOpsPushSafelyForTesting(async () => {
    sendCalls += 1;
    return {
      skipped: true,
      reason: 'vapid_not_configured'
    };
  });
  delete process.env[ENV_MAX_DELIVERY_AGE_MS];
  await OpsPushScheduledJob.deleteMany({});
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
});

test('tickOnce claims due scheduled job', async () => {
  const booking = await createFixtureBooking();
  const job = await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(5),
    scheduledForSofia: '2027-01-01T09:00:00+02:00',
    status: 'scheduled',
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2027-01-01`
  });

  const result = await tickOnce({ now: new Date() });
  assert.equal(result.claimed, 1);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'sent');
});

test('future scheduled jobs are not claimed', async () => {
  const booking = await createFixtureBooking();
  await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: futureDate(3600),
    scheduledForSofia: '2099-01-01T09:00:00+02:00',
    status: 'scheduled',
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2099-01-01`
  });

  const result = await tickOnce({ now: new Date() });
  assert.equal(result.candidatesCount, 0);
  assert.equal(result.claimed, 0);
});

test('obsolete scheduled jobs are suppressed without sending', async () => {
  const booking = await createFixtureBooking();
  const job = await OpsPushScheduledJob.create({
    jobType: 'cleaning_checkout_day',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(2 * 86400),
    scheduledForSofia: '2026-10-17T08:00:00+03:00',
    status: 'scheduled',
    dedupeKey: `ops_push_cleaning_checkout:${booking._id}:2026-10-17`
  });

  const result = await tickOnce({ now: new Date() });
  assert.equal(result.claimed, 0);
  assert.equal(result.expired, 1);
  assert.equal(sendCalls, 0);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'suppressed');
  assert.equal(updated.lastError, OBSOLETE_JOB_REASON);
  assert.equal(updated.lastResult.reason, OBSOLETE_JOB_REASON);
});

test('restart cannot resend sent jobs or reflush obsolete backlog', async () => {
  const booking = await createFixtureBooking();
  const oldJob = await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(3 * 86400),
    scheduledForSofia: '2026-10-20T09:00:00+03:00',
    status: 'scheduled',
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2026-10-20`
  });
  const freshJob = await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(5),
    scheduledForSofia: '2027-01-01T09:00:00+02:00',
    status: 'scheduled',
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2027-01-01`
  });

  const first = await tickOnce({ now: new Date() });
  assert.equal(first.claimed, 1);
  assert.equal(first.expired, 1);
  assert.equal(sendCalls, 1);

  const second = await tickOnce({ now: new Date() });
  assert.equal(second.claimed, 0);
  assert.equal(second.expired, 0);
  assert.equal(sendCalls, 1);

  stopOpsPushSchedulerWorkerForTest();
  const afterRestart = await tickOnce({ now: new Date() });
  assert.equal(afterRestart.claimed, 0);
  assert.equal(afterRestart.expired, 0);
  assert.equal(sendCalls, 1);

  assert.equal((await OpsPushScheduledJob.findById(freshJob._id).lean()).status, 'sent');
  assert.equal((await OpsPushScheduledJob.findById(oldJob._id).lean()).status, 'suppressed');
});

test('max delivery age is configurable and defaults to six hours', () => {
  process.env[ENV_MAX_DELIVERY_AGE_MS] = '900000';
  const started = startOpsPushSchedulerWorkerIfEnabled();
  assert.equal(started.started, true);
  assert.equal(getOpsPushSchedulerWorkerState().maxDeliveryAgeMs, 900000);
  stopOpsPushSchedulerWorkerForTest();
  delete process.env[ENV_MAX_DELIVERY_AGE_MS];

  process.env[ENV_FLAG] = '1';
  startOpsPushSchedulerWorkerIfEnabled();
  assert.equal(getOpsPushSchedulerWorkerState().maxDeliveryAgeMs, DEFAULT_MAX_DELIVERY_AGE_MS);
  stopOpsPushSchedulerWorkerForTest();
});

test('sweepStaleClaimedOnce reschedules with backoff', async () => {
  const booking = await createFixtureBooking();
  const job = await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(60),
    scheduledForSofia: '2027-02-01T09:00:00+02:00',
    status: 'claimed',
    attemptCount: 0,
    maxAttempts: 3,
    claimedBy: 'test-worker',
    claimedAt: pastDate(120),
    visibilityTimeoutAt: pastDate(1),
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2027-02-01`
  });

  const result = await sweepStaleClaimedOnce({ now: new Date() });
  assert.equal(result.rescheduled, 1);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'scheduled');
  assert.equal(updated.attemptCount, 1);
  assert.ok(updated.scheduledFor.getTime() > Date.now());
});

test('sweepStaleClaimedOnce marks terminal failed after max attempts', async () => {
  const booking = await createFixtureBooking();
  const job = await OpsPushScheduledJob.create({
    jobType: 'arrival_reminder_admin',
    bookingId: booking._id,
    propertyKind: 'cabin',
    scheduledFor: pastDate(60),
    scheduledForSofia: '2027-03-01T09:00:00+02:00',
    status: 'claimed',
    attemptCount: 2,
    maxAttempts: 3,
    claimedBy: 'test-worker',
    claimedAt: pastDate(120),
    visibilityTimeoutAt: pastDate(1),
    dedupeKey: `ops_push_arrival_admin:${booking._id}:2027-03-01`
  });

  const result = await sweepStaleClaimedOnce({ now: new Date() });
  assert.equal(result.failed, 1);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'failed');
  assert.equal(updated.attemptCount, 3);
});

test('computeBackoffMs grows and caps at 30 minutes', () => {
  assert.equal(computeBackoffMs(1), 5 * 60_000);
  assert.equal(computeBackoffMs(2), 10 * 60_000);
  assert.equal(computeBackoffMs(5), 30 * 60_000);
});

test('worker disabled when OPS_PUSH_SCHEDULER_WORKER_ENABLED is not 1', () => {
  delete process.env[ENV_FLAG];
  const result = startOpsPushSchedulerWorkerIfEnabled();
  assert.equal(result.started, false);
  assert.equal(getOpsPushSchedulerWorkerState().running, false);
});

test('start and stop worker clears timers', () => {
  process.env[ENV_FLAG] = '1';
  const started = startOpsPushSchedulerWorkerIfEnabled();
  assert.equal(started.started, true);
  assert.equal(getOpsPushSchedulerWorkerState().running, true);
  stopOpsPushSchedulerWorkerForTest();
  assert.equal(getOpsPushSchedulerWorkerState().running, false);
});
