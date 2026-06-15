/**
 * OPS-PUSH-4 — scheduled job orchestration and execution tests.
 * Run: node --test scripts/opsPushScheduledJobs.test.cjs (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Booking = require('../models/Booking');
const Cabin = require('../models/Cabin');
const OpsPushScheduledJob = require('../models/OpsPushScheduledJob');
const { createOpsUser } = require('../services/ops/opsUserService');
const { createManualReservation } = require('../services/ops/domain/reservationWriteService');
const { computeScheduledSofiaInstant } = require('../services/messaging/messageOrchestratorTime');
const {
  scheduleOpsPushForBooking,
  cancelFutureOpsPushJobsForBooking,
  rescheduleOpsPushForBooking,
  notifyOpsPushBookingStatusChange,
  computeArrivalSchedule,
  computeCleaningSchedule,
  isOpsPushScheduledEnabled
} = require('../services/ops/push/opsPushScheduleOrchestrator');
const {
  executeOpsPushScheduledJob,
  __setSendOpsPushSafelyForTesting,
  __resetSendOpsPushSafelyForTesting
} = require('../services/ops/push/opsPushScheduledNotifications');

let mongoServer;
const pushCalls = [];

async function createTestCabin(overrides = {}) {
  return Cabin.create({
    name: 'Hook Test Cabin',
    description: 'Test cabin for OPS push scheduled jobs',
    location: 'Bansko',
    imageUrl: '/uploads/cabins/test.jpg',
    capacity: 4,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    isActive: true,
    propertyKind: 'cabin',
    transportOptions: [],
    ...overrides
  });
}

function capturePushCalls() {
  pushCalls.length = 0;
  __setSendOpsPushSafelyForTesting(async (params) => {
    pushCalls.push(params);
    return { skipped: false, usersTargeted: 1 };
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'ops-push-4-scheduled-test';
  process.env.OPS_PUSH_SCHEDULED_ENABLED = '1';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsPushScheduledJob.syncIndexes();
});

test.after(async () => {
  __resetSendOpsPushSafelyForTesting();
  delete process.env.OPS_PUSH_SCHEDULED_ENABLED;
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  capturePushCalls();
  await Booking.deleteMany({});
  await Cabin.deleteMany({});
  await OpsPushScheduledJob.deleteMany({});
  process.env.OPS_PUSH_SCHEDULED_ENABLED = '1';
});

test('arrival schedule = 09:00 Sofia calendar day before check-in', () => {
  const checkIn = new Date('2026-07-15T12:00:00.000Z');
  const sched = computeArrivalSchedule({ checkIn });
  assert.ok(sched);
  const sofia = moment.tz(sched.scheduledForUtc, 'Europe/Sofia');
  assert.equal(sofia.format('YYYY-MM-DD'), '2026-07-14');
  assert.equal(sofia.hour(), 9);
  assert.equal(sofia.minute(), 0);
});

test('cleaning schedule = 08:00 Sofia on checkout day', () => {
  const checkOut = new Date('2026-07-18T12:00:00.000Z');
  const sched = computeCleaningSchedule({ checkOut });
  assert.ok(sched);
  const sofia = moment.tz(sched.scheduledForUtc, 'Europe/Sofia');
  assert.equal(sofia.format('YYYY-MM-DD'), '2026-07-18');
  assert.equal(sofia.hour(), 8);
  assert.equal(sofia.minute(), 0);
});

test('DST spring-forward: arrival schedule stays on Sofia calendar day', () => {
  const checkIn = new Date('2026-03-30T12:00:00.000Z');
  const naive = moment.utc(checkIn).subtract(24, 'hours');
  const sched = computeScheduledSofiaInstant({
    anchorDate: checkIn,
    offsetHours: -24,
    sofiaHour: 9,
    sofiaMinute: 0
  });
  assert.ok(sched);
  const sofia = moment.tz(sched.scheduledForUtc, 'Europe/Sofia');
  assert.equal(sofia.format('YYYY-MM-DD'), '2026-03-29');
  assert.equal(sofia.hour(), 9);
  assert.notEqual(sched.scheduledForUtc.getTime(), naive.toDate().getTime());
});

test('scheduleOpsPushForBooking creates arrival and cleaning jobs for confirmed booking', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2026-08-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2026-08-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 1,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Sched',
      lastName: 'Guest',
      email: 'sched@test.local',
      phone: '+359881234567'
    },
    totalPrice: 300
  });

  const result = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(result.ok, true);
  assert.equal(result.summary.created, 2);

  const jobs = await OpsPushScheduledJob.find({ bookingId: booking._id }).lean();
  assert.equal(jobs.length, 2);
  const types = jobs.map((j) => j.jobType).sort();
  assert.deepEqual(types, ['arrival_reminder_admin', 'cleaning_checkout_day']);
});

test('pending booking does not schedule jobs', async () => {
  const cabin = await createTestCabin();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: moment.tz('2026-09-01', 'Europe/Sofia').toDate(),
    checkOut: moment.tz('2026-09-04', 'Europe/Sofia').toDate(),
    adults: 2,
    children: 0,
    status: 'pending',
    guestInfo: {
      firstName: 'Pending',
      lastName: 'Guest',
      email: 'pending@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  const result = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'status_not_schedulable');
  assert.equal(await OpsPushScheduledJob.countDocuments({ bookingId: booking._id }), 0);
});

test('past scheduled time is skipped', async () => {
  const cabin = await createTestCabin();
  const booking = new Booking({
    cabinId: cabin._id,
    checkIn: moment.tz('2020-01-05', 'Europe/Sofia').toDate(),
    checkOut: moment.tz('2020-01-08', 'Europe/Sofia').toDate(),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Past',
      lastName: 'Guest',
      email: 'past@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });
  await booking.save({ validateBeforeSave: false });

  const result = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(result.ok, true);
  assert.equal(result.summary.created, 0);
  assert.ok(result.summary.skipped.arrival_past >= 1);
  assert.ok(result.summary.skipped.cleaning_past >= 1);
});

test('duplicate schedule is idempotent', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2026-10-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2026-10-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Dup',
      lastName: 'Guest',
      email: 'dup@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  const first = await scheduleOpsPushForBooking({ bookingId: booking._id });
  const second = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(first.summary.created, 2);
  assert.equal(second.summary.duplicates, 2);
  assert.equal(await OpsPushScheduledJob.countDocuments({ bookingId: booking._id }), 2);
});

test('cancel future jobs on booking cancel', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2026-11-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2026-11-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Cancel',
      lastName: 'Guest',
      email: 'cancel@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  await notifyOpsPushBookingStatusChange({
    bookingId: booking._id,
    previousStatus: 'confirmed',
    nextStatus: 'cancelled'
  });

  const active = await OpsPushScheduledJob.countDocuments({
    bookingId: booking._id,
    status: { $in: ['scheduled', 'claimed'] }
  });
  assert.equal(active, 0);
  const cancelled = await OpsPushScheduledJob.countDocuments({
    bookingId: booking._id,
    status: 'cancelled'
  });
  assert.ok(cancelled >= 1);
});

test('reschedule on date edit cancels old future jobs and creates new ones', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2026-12-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2026-12-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Resched',
      lastName: 'Guest',
      email: 'resched@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const before = await OpsPushScheduledJob.find({ bookingId: booking._id, status: 'scheduled' }).lean();

  booking.checkIn = moment.tz('2026-12-15', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  booking.checkOut = moment.tz('2026-12-18', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  await booking.save();

  await rescheduleOpsPushForBooking({ bookingId: booking._id, reason: 'date_edit_test' });

  const cancelledOld = await OpsPushScheduledJob.countDocuments({
    _id: { $in: before.map((j) => j._id) },
    status: 'cancelled'
  });
  assert.equal(cancelledOld, before.length);

  const active = await OpsPushScheduledJob.find({
    bookingId: booking._id,
    status: 'scheduled'
  }).lean();
  assert.equal(active.length, 2);
  assert.ok(active.every((j) => j.scheduledFor.getTime() > Date.now()));
});

test('cleaning job not scheduled when propertyKind missing on cabin', async () => {
  const cabin = await createTestCabin({ propertyKind: undefined });
  await Cabin.updateOne({ _id: cabin._id }, { $unset: { propertyKind: 1 } });
  const checkIn = moment.tz('2027-01-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-01-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'NoPK',
      lastName: 'Guest',
      email: 'nopk@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  const result = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.skipped.cleaning_no_property_kind, 1);
});

test('execute arrival job sends correct admin payload', async () => {
  const cabin = await createTestCabin({ name: 'The Cabin' });
  const checkIn = moment.tz('2027-02-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-02-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Exec',
      lastName: 'Admin',
      email: 'exec@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'arrival_reminder_admin'
  });
  job.status = 'claimed';
  await job.save();

  await executeOpsPushScheduledJob(job.toObject());
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].role, 'admin');
  assert.equal(pushCalls[0].title, 'Arrival tomorrow');
  assert.match(pushCalls[0].body, /Exec Admin/);
  assert.match(pushCalls[0].body, /The Cabin/);
  assert.equal(pushCalls[0].url, `/ops/reservations/${booking._id}`);
  assert.equal(pushCalls[0].tag, 'arrival-reminder');
  assert.equal(pushCalls[0].source, 'ops_push_arrival_admin');

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'sent');
});

test('execute cleaning job suppressed when no assigned cleaners', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-03-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-03-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'No',
      lastName: 'Cleaner',
      email: 'nocleaner@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'cleaning_checkout_day'
  });
  job.status = 'claimed';
  await job.save();

  await executeOpsPushScheduledJob(job.toObject());
  assert.equal(pushCalls.length, 0);
  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'suppressed');
  assert.equal(updated.lastError, 'no_assigned_cleaners');
});

test('execute cleaning payload never includes guest email or phone', async () => {
  await createOpsUser({
    email: 'cleaner.push@test.local',
    name: 'Cleaner Push',
    password: 'ops-pass-12345',
    role: 'cleaner',
    propertyKinds: ['cabin']
  });

  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-04-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-04-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 1,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Secret',
      lastName: 'Guest',
      email: 'secret.guest@test.local',
      phone: '+359889999999'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'cleaning_checkout_day'
  });
  job.status = 'claimed';
  await job.save();

  await executeOpsPushScheduledJob(job.toObject());
  assert.equal(pushCalls.length, 1);
  assert.equal(pushCalls[0].role, 'cleaner');
  assert.equal(pushCalls[0].title, 'Checkout today');
  assert.match(pushCalls[0].body, /3 guests/);
  assert.doesNotMatch(pushCalls[0].body, /secret\.guest@test\.local/);
  assert.doesNotMatch(pushCalls[0].body, /\+359889999999/);
  assert.doesNotMatch(pushCalls[0].body, /Secret Guest/);
});

test('cancelled booking at execute suppresses job', async () => {
  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-05-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-05-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Late',
      lastName: 'Cancel',
      email: 'late@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'arrival_reminder_admin'
  });
  job.status = 'claimed';
  await job.save();

  await Booking.updateOne({ _id: booking._id }, { $set: { status: 'cancelled' } });
  await executeOpsPushScheduledJob(job.toObject());

  assert.equal(pushCalls.length, 0);
  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'suppressed');
});

test('VAPID unset marks job sent with skipped lastResult', async () => {
  __setSendOpsPushSafelyForTesting(async () => ({
    skipped: true,
    reason: 'vapid_not_configured'
  }));

  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-06-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-06-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Vapid',
      lastName: 'Skip',
      email: 'vapid@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'arrival_reminder_admin'
  });
  job.status = 'claimed';
  await job.save();

  await executeOpsPushScheduledJob(job.toObject());
  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.equal(updated.status, 'sent');
  assert.equal(updated.lastResult.skipped, 'vapid_not_configured');
});

test('sendOpsPushSafely error:true does not mark job sent', async () => {
  __setSendOpsPushSafelyForTesting(async () => ({
    skipped: false,
    error: true,
    message: 'network_timeout'
  }));

  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-06-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-06-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Push',
      lastName: 'Error',
      email: 'push-error@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'arrival_reminder_admin'
  });
  job.status = 'claimed';
  job.attemptCount = 0;
  job.maxAttempts = 3;
  await job.save();

  const execResult = await executeOpsPushScheduledJob(job.toObject());
  assert.equal(execResult.ok, false);
  assert.equal(execResult.error, 'network_timeout');
  assert.equal(execResult.rescheduled, true);
  assert.equal(execResult.terminal, false);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.notEqual(updated.status, 'sent');
  assert.equal(updated.status, 'scheduled');
  assert.equal(updated.attemptCount, 1);
  assert.equal(updated.lastError, 'network_timeout');
  assert.ok(updated.scheduledFor.getTime() > Date.now());
});

test('sendOpsPushSafely error:true enters terminal failed after max attempts', async () => {
  __setSendOpsPushSafelyForTesting(async () => ({
    skipped: false,
    error: true,
    message: 'push_provider_down'
  }));

  const cabin = await createTestCabin();
  const checkIn = moment.tz('2027-07-10', 'Europe/Sofia').startOf('day').add(15, 'hours').toDate();
  const checkOut = moment.tz('2027-07-13', 'Europe/Sofia').startOf('day').add(11, 'hours').toDate();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn,
    checkOut,
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Push',
      lastName: 'Terminal',
      email: 'push-terminal@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });

  await scheduleOpsPushForBooking({ bookingId: booking._id });
  const job = await OpsPushScheduledJob.findOne({
    bookingId: booking._id,
    jobType: 'arrival_reminder_admin'
  });
  job.status = 'claimed';
  job.attemptCount = 2;
  job.maxAttempts = 3;
  await job.save();

  const execResult = await executeOpsPushScheduledJob(job.toObject());
  assert.equal(execResult.ok, false);
  assert.equal(execResult.error, 'push_provider_down');
  assert.equal(execResult.terminal, true);
  assert.equal(execResult.rescheduled, false);

  const updated = await OpsPushScheduledJob.findById(job._id).lean();
  assert.notEqual(updated.status, 'sent');
  assert.equal(updated.status, 'failed');
  assert.equal(updated.attemptCount, 3);
  assert.equal(updated.lastError, 'push_provider_down');
});

test('manual reservation schedules once; idempotent remembered result does not schedule again', async () => {
  const admin = await createOpsUser({
    email: 'ops.scheduled@test.local',
    name: 'Ops Scheduled',
    password: 'ops-pass-12345',
    role: 'admin'
  });
  const cabin = await createTestCabin({ name: 'Manual Schedule Cabin' });
  const ctx = {
    user: { id: String(admin.id), role: 'admin' },
    route: 'POST /api/ops/reservations/manual',
    idempotencyKey: 'manual-sched-idem-1'
  };

  const first = await createManualReservation({
    cabinId: String(cabin._id),
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Manual',
      lastName: 'Sched',
      email: 'manual.sched@test.local',
      phone: '+359881234567'
    },
    initialStatus: 'confirmed',
    ctx
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const afterFirst = await OpsPushScheduledJob.countDocuments({ bookingId: first.reservationId });
  assert.ok(afterFirst >= 1, 'expected scheduled jobs after first manual reservation');

  const beforeSecond = await OpsPushScheduledJob.countDocuments({ bookingId: first.reservationId });
  await createManualReservation({
    cabinId: String(cabin._id),
    checkInDate: '2027-07-10',
    checkOutDate: '2027-07-13',
    adults: 2,
    children: 0,
    guestInfo: {
      firstName: 'Manual',
      lastName: 'Sched',
      email: 'manual.sched@test.local',
      phone: '+359881234567'
    },
    initialStatus: 'confirmed',
    ctx
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const afterSecond = await OpsPushScheduledJob.countDocuments({ bookingId: first.reservationId });
  assert.equal(afterSecond, beforeSecond);
});

test('OPS_PUSH_SCHEDULED_ENABLED off skips scheduling', async () => {
  process.env.OPS_PUSH_SCHEDULED_ENABLED = '0';
  assert.equal(isOpsPushScheduledEnabled(), false);
  const cabin = await createTestCabin();
  const booking = await Booking.create({
    cabinId: cabin._id,
    checkIn: moment.tz('2027-08-10', 'Europe/Sofia').toDate(),
    checkOut: moment.tz('2027-08-13', 'Europe/Sofia').toDate(),
    adults: 2,
    children: 0,
    status: 'confirmed',
    guestInfo: {
      firstName: 'Flag',
      lastName: 'Off',
      email: 'flag@test.local',
      phone: '+359881234567'
    },
    totalPrice: 200
  });
  const result = await scheduleOpsPushForBooking({ bookingId: booking._id });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
});
