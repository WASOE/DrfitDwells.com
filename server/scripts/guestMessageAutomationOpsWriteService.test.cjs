/**
 * Batch 10B1 — OPS cancel scheduled message job (write service + route wiring via service).
 *
 * Run: npm run test:ops-messaging-write (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';

const Cabin = require('../models/Cabin');
const Booking = require('../models/Booking');
const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const AuditEvent = require('../models/AuditEvent');
const { cancelScheduledMessageJobFromOps } = require('../services/ops/domain/guestMessageAutomationOpsWriteService');

let mongoServer;

async function createCabin() {
  return Cabin.create({
    name: 'Write test cabin',
    description: 'd',
    location: 'Test Valley',
    capacity: 2,
    minGuests: 1,
    pricePerNight: 100,
    minNights: 1,
    imageUrl: 'https://example.com/cabin.jpg'
  });
}

async function createFutureBooking(cabinId) {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 30);
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
      email: 'guest-write-test@example.com',
      phone: '+359881234567'
    },
    status: 'confirmed',
    totalPrice: 200,
    subtotalPrice: 200,
    discountAmount: 0,
    totalValueCents: 20000,
    giftVoucherAppliedCents: 0,
    stripePaidAmountCents: 20000,
    stripePaymentIntentId: `pi_${crypto.randomBytes(8).toString('hex')}`
  });
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await ScheduledMessageJob.syncIndexes();
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  // AuditEvent is append-only (no deleteMany). Tests scope audit counts by entityId.
  await Promise.all([ScheduledMessageJob.deleteMany({}), Booking.deleteMany({}), Cabin.deleteMany({})]);
});

test('write service source does not import dispatcher, providers, email, orchestrator, scheduler', () => {
  const p = path.join(__dirname, '../services/ops/domain/guestMessageAutomationOpsWriteService.js');
  const src = fs.readFileSync(p, 'utf8');
  const banned = [
    'messageDispatcher',
    'providerRegistry',
    'realEmailProvider',
    'devShadowEmail',
    'emailService',
    'messageOrchestrator',
    'schedulerWorker',
    'runMessagingWorker'
  ];
  for (const b of banned) {
    assert.equal(src.includes(b), false, `unexpected reference to ${b}`);
  }
});

test('scheduled → cancelled, audit appended once', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 1);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_cancel',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'scheduled'
  });
  const beforeAudit = await AuditEvent.countDocuments({ entityType: 'ScheduledMessageJob', entityId: String(job._id) });

  const result = await cancelScheduledMessageJobFromOps({
    jobId: String(job._id),
    expectedBookingId: String(booking._id),
    reason: 'test_cancel',
    ctx: {
      req: {},
      user: { id: 'admin-test', email: 'ops@test.com', role: 'admin' },
      route: 'POST /api/ops/messaging/jobs/:jobId/actions/cancel'
    }
  });

  assert.equal(result.idempotent, false);
  assert.equal(result.job.status, 'cancelled');
  assert.equal(result.job.cancelReason, 'test_cancel');
  assert.equal(result.job.cancelActor, 'ops@test.com');

  const after = await ScheduledMessageJob.findById(job._id).lean();
  assert.equal(after.status, 'cancelled');
  assert.equal(after.claimedBy, null);

  const afterAudit = await AuditEvent.countDocuments({ entityType: 'ScheduledMessageJob', entityId: String(job._id) });
  assert.equal(afterAudit, beforeAudit + 1);
  const ev = await AuditEvent.findOne({ entityType: 'ScheduledMessageJob', entityId: String(job._id) }).lean();
  assert.equal(ev.action, 'guest_message_job_cancel');
});

test('already cancelled → idempotent, no second audit', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 2);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_idem',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'cancelled',
    cancelReason: 'prior',
    cancelActor: 'system'
  });
  const beforeAudit = await AuditEvent.countDocuments({ entityType: 'ScheduledMessageJob', entityId: String(job._id) });
  const ctx = { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' };

  const result = await cancelScheduledMessageJobFromOps({
    jobId: String(job._id),
    expectedBookingId: String(booking._id),
    reason: 'again',
    ctx
  });

  assert.equal(result.idempotent, true);
  const afterAudit = await AuditEvent.countDocuments({ entityType: 'ScheduledMessageJob', entityId: String(job._id) });
  assert.equal(afterAudit, beforeAudit);
});

test('claimed job → 409', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 3);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_claimed',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'claimed',
    claimedBy: 'worker-1',
    claimedAt: new Date()
  });
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: String(booking._id),
        reason: null,
        ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
      }),
    (e) => e.status === 409
  );
});

test('sent job → 409', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 4);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_sent',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'sent'
  });
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: String(booking._id),
        reason: null,
        ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
      }),
    (e) => e.status === 409
  );
});

test('failed job → 409', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 5);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_failed',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'failed',
    lastError: 'x'
  });
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: String(booking._id),
        reason: null,
        ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
      }),
    (e) => e.status === 409
  );
});

test('wrong bookingId → 403', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 6);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_wrong',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'scheduled'
  });
  const otherId = new mongoose.Types.ObjectId();
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: String(otherId),
        reason: null,
        ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
      }),
    (e) => e.status === 403
  );
});

test('permission denied for unknown role', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 7);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_perm',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'scheduled'
  });
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: String(booking._id),
        reason: null,
        ctx: { req: {}, user: { id: 'x', role: 'guest' }, route: 'test' }
      }),
    (e) => e.code === 'PERMISSION_DENIED'
  );
});

test('booking-scoped job requires bookingId in request', async () => {
  const cabin = await createCabin();
  const booking = await createFutureBooking(cabin._id);
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 8);
  const job = await ScheduledMessageJob.create({
    ruleKey: 'arrival_test_need_bid',
    ruleVersionAtSchedule: 1,
    bookingId: booking._id,
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor,
    status: 'scheduled'
  });
  await assert.rejects(
    () =>
      cancelScheduledMessageJobFromOps({
        jobId: String(job._id),
        expectedBookingId: null,
        reason: null,
        ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
      }),
    (e) => e.status === 400
  );
});

test('no-booking job cancels without bookingId body', async () => {
  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + 9);
  const job = await ScheduledMessageJob.create({
    ruleKey: `ops_global_${crypto.randomBytes(4).toString('hex')}`,
    ruleVersionAtSchedule: 1,
    bookingId: null,
    audience: 'ops',
    propertyKind: 'any',
    scheduledFor,
    status: 'scheduled'
  });
  const result = await cancelScheduledMessageJobFromOps({
    jobId: String(job._id),
    expectedBookingId: null,
    reason: null,
    ctx: { req: {}, user: { id: 'op', role: 'operator' }, route: 'test' }
  });
  assert.equal(result.job.status, 'cancelled');
});
