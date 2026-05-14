/**
 * Batch 6 — Scheduler worker claim-only contract tests.
 *
 * Run: npm run test:scheduler-worker (from server/)
 *
 * Mandated test list (per ChatGPT review correction):
 *   - single tick claims due job → status claimed (NOT sent)
 *   - no MessageDispatch rows created
 *   - claimed job remains claimed until sweeper
 *   - sweeper returns stale claimed job to scheduled with attemptCount++
 *   - terminal path marks failed after maxAttempts
 *   - concurrent ticks only one claim wins
 *   - terminal statuses are never claimed
 *   - future scheduled jobs are not claimed
 *   - disabled-by-default works
 *   - stop clears timers
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const ScheduledMessageJob = require('../models/ScheduledMessageJob');
const MessageDispatch = require('../models/MessageDispatch');

const {
  tickOnce,
  sweepStaleClaimedOnce,
  startSchedulerWorkerIfEnabled,
  stopSchedulerWorkerForTest,
  getSchedulerWorkerState,
  computeBackoffMs,
  ENV_FLAG
} = require('../services/messaging/schedulerWorker');

let mongoServer;

const ALL_TERMINAL_STATUSES = [
  'sent',
  'failed',
  'cancelled',
  'suppressed',
  'skipped_status_guard',
  'skipped_no_consent'
];

function pastDate(secondsAgo = 1) {
  return new Date(Date.now() - secondsAgo * 1000);
}
function futureDate(secondsAhead = 3600) {
  return new Date(Date.now() + secondsAhead * 1000);
}

function bookingJob(overrides = {}) {
  return {
    ruleKey: 'arrival_instructions_pre_arrival_cabin',
    ruleVersionAtSchedule: 1,
    bookingId: new mongoose.Types.ObjectId(),
    audience: 'guest',
    propertyKind: 'cabin',
    scheduledFor: pastDate(1),
    ...overrides
  };
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await Promise.all([ScheduledMessageJob.syncIndexes(), MessageDispatch.syncIndexes()]);
});

test.after(async () => {
  stopSchedulerWorkerForTest();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  // Batch 8 wiring: the scheduler worker invokes the dispatcher when
  // MESSAGE_DISPATCHER_ENABLED='1'. The Batch 6 claim-only contract must
  // remain testable in isolation; explicitly unset the flag so a leaked
  // env var (from a previous test run or shell) cannot turn a Batch 6
  // claim-only test into an end-to-end dispatch test.
  delete process.env.MESSAGE_DISPATCHER_ENABLED;
  stopSchedulerWorkerForTest();
  await Promise.all([ScheduledMessageJob.deleteMany({}), MessageDispatch.deleteMany({})]);
});

// ---------------------------------------------------------------------------
// computeBackoffMs (pure)
// ---------------------------------------------------------------------------

test('computeBackoffMs: 5min, 10min, 20min, capped at 30min', () => {
  assert.equal(computeBackoffMs(1), 5 * 60_000);
  assert.equal(computeBackoffMs(2), 10 * 60_000);
  assert.equal(computeBackoffMs(3), 20 * 60_000);
  assert.equal(computeBackoffMs(4), 30 * 60_000); // 40min would exceed cap
  assert.equal(computeBackoffMs(10), 30 * 60_000); // still capped
});

// ---------------------------------------------------------------------------
// Claim mechanic
// ---------------------------------------------------------------------------

test('single tick claims a due job → status="claimed" (not sent)', async () => {
  const created = await ScheduledMessageJob.create(bookingJob());
  const before = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(before.status, 'scheduled');

  const res = await tickOnce();
  assert.equal(res.candidatesCount, 1);
  assert.equal(res.claimed, 1);
  assert.equal(res.lost, 0);
  assert.equal(res.errors, 0);

  const after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'claimed', 'job must be claimed, not sent');
  assert.ok(after.claimedAt instanceof Date);
  assert.ok(typeof after.claimedBy === 'string' && after.claimedBy.length > 0);
  assert.ok(after.visibilityTimeoutAt instanceof Date);
  assert.ok(after.visibilityTimeoutAt.getTime() > Date.now());
  // attemptCount must NOT advance at claim time.
  assert.equal(after.attemptCount, 0);
});

test('tick writes ZERO MessageDispatch rows in Batch 6', async () => {
  await ScheduledMessageJob.create(bookingJob());
  await ScheduledMessageJob.create(bookingJob({ bookingId: new mongoose.Types.ObjectId() }));
  await tickOnce();
  const dispatches = await MessageDispatch.countDocuments({});
  assert.equal(dispatches, 0);
});

test('claimed job remains "claimed" across additional ticks until sweeper', async () => {
  const created = await ScheduledMessageJob.create(bookingJob());

  // First tick claims.
  await tickOnce();
  let after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'claimed');

  // Subsequent ticks do not change it (precondition status:'scheduled' fails).
  await tickOnce();
  await tickOnce();
  after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'claimed', 'must stay claimed across subsequent ticks');
  // Still no MessageDispatch.
  assert.equal(await MessageDispatch.countDocuments({}), 0);
});

// ---------------------------------------------------------------------------
// Sweeper / reclaim mechanic
// ---------------------------------------------------------------------------

test('sweeper returns stale claimed job to "scheduled" with attemptCount++ + backoff', async () => {
  const created = await ScheduledMessageJob.create({
    ...bookingJob(),
    status: 'claimed',
    claimedBy: 'someone-else#1',
    claimedAt: pastDate(60),
    visibilityTimeoutAt: pastDate(10), // expired
    attemptCount: 0,
    maxAttempts: 3
  });

  const now = new Date();
  const res = await sweepStaleClaimedOnce({ now });
  assert.equal(res.staleCount, 1);
  assert.equal(res.rescheduled, 1);
  assert.equal(res.failed, 0);
  assert.equal(res.lost, 0);

  const after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'scheduled');
  assert.equal(after.attemptCount, 1);
  assert.equal(after.claimedBy, null);
  assert.equal(after.claimedAt, null);
  assert.equal(after.visibilityTimeoutAt, null);
  assert.equal(after.lastError, 'visibility_timeout_reclaim');
  // scheduledFor pushed by 5min (first reclaim) ±1s tolerance.
  const diffMs = after.scheduledFor.getTime() - now.getTime();
  assert.ok(diffMs >= 5 * 60_000 - 1000 && diffMs <= 5 * 60_000 + 1000,
    `expected ~5min backoff, got ${diffMs}ms`);
});

test('sweeper marks job FAILED (terminal) when nextAttempt >= maxAttempts', async () => {
  const created = await ScheduledMessageJob.create({
    ...bookingJob(),
    status: 'claimed',
    claimedBy: 'someone-else#2',
    claimedAt: pastDate(60),
    visibilityTimeoutAt: pastDate(10),
    attemptCount: 2,
    maxAttempts: 3
  });

  const res = await sweepStaleClaimedOnce({ now: new Date() });
  assert.equal(res.staleCount, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.rescheduled, 0);

  const after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'failed');
  assert.equal(after.attemptCount, 3);
  assert.equal(after.lastError, 'visibility_timeout_terminal');
  assert.equal(after.claimedBy, null);
  assert.equal(after.claimedAt, null);
  assert.equal(after.visibilityTimeoutAt, null);
});

test('sweeper does not touch claimed jobs whose visibility has not expired', async () => {
  const created = await ScheduledMessageJob.create({
    ...bookingJob(),
    status: 'claimed',
    claimedBy: 'me#1',
    claimedAt: new Date(),
    visibilityTimeoutAt: futureDate(60),
    attemptCount: 0,
    maxAttempts: 3
  });
  const res = await sweepStaleClaimedOnce({ now: new Date() });
  assert.equal(res.staleCount, 0);
  const after = await ScheduledMessageJob.findById(created._id).lean();
  assert.equal(after.status, 'claimed');
  assert.equal(after.attemptCount, 0);
});

// ---------------------------------------------------------------------------
// Concurrency / atomicity
// ---------------------------------------------------------------------------

test('concurrent ticks: only one claim wins per job', async () => {
  const job = await ScheduledMessageJob.create(bookingJob());

  const [a, b] = await Promise.all([tickOnce(), tickOnce()]);
  const totalClaimed = a.claimed + b.claimed;
  const totalLost = a.lost + b.lost;
  assert.equal(totalClaimed, 1, 'exactly one tick must win the claim');
  // The losing tick may or may not see the candidate depending on the
  // timing of the two parallel find() calls. If both saw it, lost === 1.
  // If only one saw it, lost === 0. Either is correct atomicity behaviour.
  assert.ok(totalLost <= 1);

  const final = await ScheduledMessageJob.findById(job._id).lean();
  assert.equal(final.status, 'claimed');
  assert.equal(await MessageDispatch.countDocuments({}), 0);
});

test('atomic claim: parallel findOneAndUpdate on same _id yields exactly one winner', async () => {
  const job = await ScheduledMessageJob.create(bookingJob());
  const now = new Date();
  const visibility = new Date(now.getTime() + 5 * 60_000);

  const [r1, r2] = await Promise.all([
    ScheduledMessageJob.findOneAndUpdate(
      { _id: job._id, status: 'scheduled' },
      { $set: { status: 'claimed', claimedBy: 'A', claimedAt: now, visibilityTimeoutAt: visibility } },
      { new: true }
    ),
    ScheduledMessageJob.findOneAndUpdate(
      { _id: job._id, status: 'scheduled' },
      { $set: { status: 'claimed', claimedBy: 'B', claimedAt: now, visibilityTimeoutAt: visibility } },
      { new: true }
    )
  ]);
  const winners = [r1, r2].filter(Boolean);
  assert.equal(winners.length, 1);
  const losers = [r1, r2].filter((r) => r == null);
  assert.equal(losers.length, 1);
});

// ---------------------------------------------------------------------------
// Status-filter contract
// ---------------------------------------------------------------------------

test('terminal statuses are never claimed even if scheduledFor is past', async () => {
  const ids = {};
  for (const status of ALL_TERMINAL_STATUSES) {
    const j = await ScheduledMessageJob.create({ ...bookingJob(), status });
    ids[status] = j._id;
  }
  // Also include an already-claimed job — must not be re-claimed.
  const alreadyClaimed = await ScheduledMessageJob.create({
    ...bookingJob(),
    status: 'claimed',
    claimedBy: 'someone-else',
    claimedAt: pastDate(10),
    visibilityTimeoutAt: futureDate(60) // not stale yet
  });
  ids['claimed'] = alreadyClaimed._id;

  const res = await tickOnce();
  assert.equal(res.claimed, 0);
  assert.equal(res.candidatesCount, 0);

  for (const status of [...ALL_TERMINAL_STATUSES, 'claimed']) {
    const after = await ScheduledMessageJob.findById(ids[status]).lean();
    assert.equal(after.status, status, `status ${status} must not be mutated`);
  }
});

test('future scheduledFor is not claimed', async () => {
  const job = await ScheduledMessageJob.create({
    ...bookingJob(),
    scheduledFor: futureDate(3600)
  });
  const res = await tickOnce({ now: new Date() });
  assert.equal(res.candidatesCount, 0);
  const after = await ScheduledMessageJob.findById(job._id).lean();
  assert.equal(after.status, 'scheduled');
});

// ---------------------------------------------------------------------------
// Feature-flag / lifecycle
// ---------------------------------------------------------------------------

test('disabled by default: startSchedulerWorkerIfEnabled returns started:false', () => {
  const prev = process.env[ENV_FLAG];
  delete process.env[ENV_FLAG];
  try {
    const r = startSchedulerWorkerIfEnabled();
    assert.equal(r.started, false);
    const s = getSchedulerWorkerState();
    assert.equal(s.enabled, false);
    assert.equal(s.running, false);
  } finally {
    if (prev !== undefined) process.env[ENV_FLAG] = prev;
    stopSchedulerWorkerForTest();
  }
});

test('flag != "1" (e.g. "true", "0", "TRUE") does not start the worker', () => {
  const prev = process.env[ENV_FLAG];
  for (const value of ['true', '0', 'TRUE', 'yes', '']) {
    process.env[ENV_FLAG] = value;
    const r = startSchedulerWorkerIfEnabled();
    assert.equal(r.started, false, `value "${value}" must NOT start the worker`);
    stopSchedulerWorkerForTest();
  }
  if (prev !== undefined) process.env[ENV_FLAG] = prev;
  else delete process.env[ENV_FLAG];
});

test('start when enabled, then stop, clears both timers', () => {
  const prev = {
    flag: process.env[ENV_FLAG],
    tick: process.env.MESSAGE_SCHEDULER_WORKER_TICK_MS,
    sweep: process.env.MESSAGE_SCHEDULER_WORKER_SWEEPER_TICK_MS
  };
  process.env[ENV_FLAG] = '1';
  // Huge intervals so no real tick fires during the test.
  process.env.MESSAGE_SCHEDULER_WORKER_TICK_MS = '600000';
  process.env.MESSAGE_SCHEDULER_WORKER_SWEEPER_TICK_MS = '600000';

  try {
    const r1 = startSchedulerWorkerIfEnabled();
    assert.equal(r1.started, true);
    assert.equal(r1.alreadyStarted, undefined);
    assert.equal(getSchedulerWorkerState().running, true);

    // Idempotent restart while running.
    const r2 = startSchedulerWorkerIfEnabled();
    assert.equal(r2.started, true);
    assert.equal(r2.alreadyStarted, true);

    stopSchedulerWorkerForTest();
    assert.equal(getSchedulerWorkerState().running, false);

    // After stop, a fresh start should not be alreadyStarted.
    const r3 = startSchedulerWorkerIfEnabled();
    assert.equal(r3.started, true);
    assert.equal(r3.alreadyStarted, undefined);
    stopSchedulerWorkerForTest();
  } finally {
    if (prev.flag !== undefined) process.env[ENV_FLAG] = prev.flag;
    else delete process.env[ENV_FLAG];
    if (prev.tick !== undefined) process.env.MESSAGE_SCHEDULER_WORKER_TICK_MS = prev.tick;
    else delete process.env.MESSAGE_SCHEDULER_WORKER_TICK_MS;
    if (prev.sweep !== undefined) process.env.MESSAGE_SCHEDULER_WORKER_SWEEPER_TICK_MS = prev.sweep;
    else delete process.env.MESSAGE_SCHEDULER_WORKER_SWEEPER_TICK_MS;
  }
});

// ---------------------------------------------------------------------------
// Final guard: Batch 6 NEVER produces a 'sent' status
// ---------------------------------------------------------------------------

test('end-to-end: tick + sweep across many jobs never produces status="sent"', async () => {
  // 3 due, 2 future, 1 already-claimed (not yet stale), 1 already-failed.
  await ScheduledMessageJob.create(bookingJob());
  await ScheduledMessageJob.create(bookingJob({ bookingId: new mongoose.Types.ObjectId() }));
  await ScheduledMessageJob.create(bookingJob({ bookingId: new mongoose.Types.ObjectId() }));
  await ScheduledMessageJob.create({ ...bookingJob(), scheduledFor: futureDate(3600) });
  await ScheduledMessageJob.create({ ...bookingJob(), scheduledFor: futureDate(7200) });
  await ScheduledMessageJob.create({
    ...bookingJob(),
    status: 'claimed',
    claimedBy: 'pre',
    claimedAt: pastDate(30),
    visibilityTimeoutAt: futureDate(120)
  });
  await ScheduledMessageJob.create({ ...bookingJob(), status: 'failed' });

  await tickOnce();
  await sweepStaleClaimedOnce();
  await tickOnce();
  await sweepStaleClaimedOnce();

  const sentCount = await ScheduledMessageJob.countDocuments({ status: 'sent' });
  assert.equal(sentCount, 0, 'Batch 6 must never produce a "sent" status');

  const dispatches = await MessageDispatch.countDocuments({});
  assert.equal(dispatches, 0, 'Batch 6 must never write MessageDispatch rows');
});
