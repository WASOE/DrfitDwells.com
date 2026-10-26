'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BuildEnquiry = require('../models/BuildEnquiry');
const { createBuildEnquiry } = require('../services/buildEnquiries/buildEnquiryService');
const {
  claimBuildEnquiryEmailLane,
  markBuildEnquiryEmailNeedsManual
} = require('../services/buildEnquiries/buildEnquiryEmailService');
const {
  tickOnce,
  runTickSafe,
  startBuildEnquiryEmailWorker,
  stopBuildEnquiryEmailWorkerForTest,
  getBuildEnquiryEmailWorkerStateForTest
} = require('../services/buildEnquiries/buildEnquiryEmailWorker');

let mongoServer;
let previousAdminEmail;

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validPayload(overrides = {}) {
  return {
    idempotencyKey: uniqueKey('idem'),
    contact: { name: 'Ada', email: 'ada@example.com', phone: null },
    project: {
      location: 'Bansko',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'within_6_months',
      message: null
    },
    config: { modelId: 'lux-cabin', radio: {}, toggles: [] },
    estimate: { totalEur: 32000, displayLabel: '€32,000' },
    configMeta: { isPartial: true },
    website: '',
    ...overrides
  };
}

function mockEmailService(handler) {
  return { sendEmail: async (opts) => handler(opts) };
}

test.before(async () => {
  previousAdminEmail = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'ops-build@driftdwells.test';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await BuildEnquiry.syncIndexes();
});

test.after(async () => {
  await stopBuildEnquiryEmailWorkerForTest();
  if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = previousAdminEmail;
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await stopBuildEnquiryEmailWorkerForTest();
  await BuildEnquiry.deleteMany({});
});

test('successful retry sends failed lane and marks succeeded', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'failed',
        'emails.customer.attemptCount': 1,
        'emails.customer.maxAttempts': 10,
        'emails.customer.nextAttemptAt': new Date(Date.now() - 1000),
        'emails.customer.lastError': 'smtp_timeout',
        'emails.internal.status': 'succeeded',
        'emails.internal.attemptCount': 1,
        'emails.internal.nextAttemptAt': null
      }
    }
  );

  let sends = 0;
  const emailService = mockEmailService(async () => {
    sends += 1;
    return { success: true, method: 'sent', messageId: 'retry-ok' };
  });

  const summary = await tickOnce({ emailService });
  assert.equal(summary.lanes.customer.succeeded, 1);
  assert.equal(sends, 1);

  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.customer.status, 'succeeded');
  assert.equal(row.emails.internal.status, 'succeeded');
});

test('SMTP failure applies backoff via nextAttemptAt', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'failed',
        'emails.internal.attemptCount': 1,
        'emails.internal.maxAttempts': 10,
        'emails.internal.nextAttemptAt': new Date(Date.now() - 500),
        'emails.customer.status': 'succeeded',
        'emails.customer.attemptCount': 1,
        'emails.customer.nextAttemptAt': null
      }
    }
  );

  const emailService = mockEmailService(async () => ({
    success: false,
    method: 'failed',
    error: 'smtp_down'
  }));

  const before = Date.now();
  await tickOnce({ emailService });
  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.internal.status, 'failed');
  assert.equal(row.emails.internal.attemptCount, 2);
  assert.equal(row.emails.internal.lastError, 'smtp_down');
  assert.ok(row.emails.internal.nextAttemptAt instanceof Date);
  assert.ok(row.emails.internal.nextAttemptAt.getTime() > before);
});

test('exhausted attempts after send are not retried on next tick', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'failed',
        'emails.customer.attemptCount': 9,
        'emails.customer.maxAttempts': 10,
        'emails.customer.nextAttemptAt': new Date(Date.now() - 1000),
        'emails.internal.status': 'succeeded',
        'emails.internal.attemptCount': 1,
        'emails.internal.nextAttemptAt': null
      }
    }
  );

  let sends = 0;
  const emailService = mockEmailService(async () => {
    sends += 1;
    return { success: false, method: 'failed', error: 'still_down' };
  });

  await tickOnce({ emailService });
  assert.equal(sends, 1);
  let row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.customer.attemptCount, 10);
  assert.equal(row.emails.customer.status, 'failed');
  assert.equal(row.emails.customer.nextAttemptAt, null);

  await tickOnce({ emailService });
  assert.equal(sends, 1);
  row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.customer.attemptCount, 10);
});

test('expired sending lease under maxAttempts is reclaimed and sent', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const past = new Date(Date.now() - 60_000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'sending',
        'emails.internal.attemptCount': 1,
        'emails.internal.maxAttempts': 10,
        'emails.internal.visibilityTimeoutAt': past,
        'emails.internal.claimedBy': 'crashed-worker',
        'emails.customer.status': 'succeeded',
        'emails.customer.attemptCount': 1,
        'emails.customer.nextAttemptAt': null
      }
    }
  );

  const emailService = mockEmailService(async () => ({
    success: true,
    method: 'sent',
    messageId: 'lease-recovery'
  }));

  await tickOnce({ emailService });
  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.internal.status, 'succeeded');
  assert.equal(row.emails.internal.attemptCount, 2);
});

test('expired exhausted sending lease marked needs_manual without resend', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const past = new Date(Date.now() - 60_000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'sending',
        'emails.internal.attemptCount': 10,
        'emails.internal.maxAttempts': 10,
        'emails.internal.visibilityTimeoutAt': past,
        'emails.internal.claimedBy': 'stale',
        'emails.customer.status': 'succeeded',
        'emails.customer.attemptCount': 1,
        'emails.customer.nextAttemptAt': null
      }
    }
  );

  let sends = 0;
  const emailService = mockEmailService(async () => {
    sends += 1;
    return { success: true, method: 'sent', messageId: 'should-not-send' };
  });

  const summary = await tickOnce({ emailService });
  assert.equal(summary.lanes.internal.exhaustedMarked, 1);
  assert.equal(sends, 0);

  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.internal.status, 'needs_manual');
  assert.match(row.emails.internal.lastError, /expired_lease_exhausted/);
});

test('concurrent workers cannot both claim the same lane', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'pending',
        'emails.customer.attemptCount': 0,
        'emails.customer.maxAttempts': 10,
        'emails.customer.nextAttemptAt': new Date(Date.now() - 1000)
      }
    }
  );

  const [a, b] = await Promise.all([
    claimBuildEnquiryEmailLane({
      enquiryId: created.doc._id,
      lane: 'customer',
      workerId: 'w-a'
    }),
    claimBuildEnquiryEmailLane({
      enquiryId: created.doc._id,
      lane: 'customer',
      workerId: 'w-b'
    })
  ]);

  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1);
  assert.ok(['w-a', 'w-b'].includes(winners[0].emails.customer.claimedBy));
});

test('worker restart recovers expired lease (crash recovery)', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const past = new Date(Date.now() - 120_000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'sending',
        'emails.customer.attemptCount': 2,
        'emails.customer.maxAttempts': 10,
        'emails.customer.visibilityTimeoutAt': past,
        'emails.customer.claimedBy': 'dead-worker',
        'emails.internal.status': 'succeeded',
        'emails.internal.attemptCount': 1,
        'emails.internal.nextAttemptAt': null
      }
    }
  );

  const emailService = mockEmailService(async () => ({
    success: true,
    method: 'sent',
    messageId: 'after-restart'
  }));

  // Simulate stop then new tick (restart)
  await stopBuildEnquiryEmailWorkerForTest();
  await tickOnce({ emailService, now: new Date() });

  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.customer.status, 'succeeded');
});

test('internal and customer lanes are processed independently', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'failed',
        'emails.internal.attemptCount': 1,
        'emails.internal.maxAttempts': 10,
        'emails.internal.nextAttemptAt': new Date(Date.now() - 1000),
        'emails.customer.status': 'failed',
        'emails.customer.attemptCount': 1,
        'emails.customer.maxAttempts': 10,
        'emails.customer.nextAttemptAt': new Date(Date.now() - 1000)
      }
    }
  );

  const emailService = mockEmailService(async (opts) => {
    if (opts.trigger === 'build_enquiry_internal') {
      return { success: true, method: 'sent', messageId: 'int-ok' };
    }
    return { success: false, method: 'failed', error: 'customer_bounce' };
  });

  await tickOnce({ emailService });
  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.internal.status, 'succeeded');
  assert.equal(row.emails.customer.status, 'failed');
  assert.equal(row.emails.customer.lastError, 'customer_bounce');
});

test('database scan errors are logged and do not throw from tickOnce', async () => {
  const original = BuildEnquiry.find;
  BuildEnquiry.find = () => {
    throw new Error('simulated db scan failure');
  };
  try {
    const summary = await tickOnce({
      emailService: mockEmailService(async () => ({ success: true, method: 'sent' }))
    });
    assert.ok(summary.errors >= 1);
  } finally {
    BuildEnquiry.find = original;
  }
});

test('graceful shutdown stops further ticks and awaits in-flight work', async () => {
  let resolveSend;
  const sendGate = new Promise((resolve) => {
    resolveSend = resolve;
  });
  let started = 0;

  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'failed',
        'emails.internal.attemptCount': 0,
        'emails.internal.maxAttempts': 10,
        'emails.internal.nextAttemptAt': new Date(Date.now() - 1000),
        'emails.customer.status': 'succeeded',
        'emails.customer.attemptCount': 1,
        'emails.customer.nextAttemptAt': null
      }
    }
  );

  const emailService = mockEmailService(async () => {
    started += 1;
    await sendGate;
    return { success: true, method: 'sent', messageId: 'slow' };
  });

  const tickPromise = runTickSafe({ emailService });
  // Allow claim/send to start
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(started, 1);

  const stopPromise = stopBuildEnquiryEmailWorkerForTest();
  resolveSend();
  await tickPromise;
  await stopPromise;

  const st = getBuildEnquiryEmailWorkerStateForTest();
  assert.equal(st.enabled, false);
  assert.equal(st.tickInFlight, false);
});

test('markBuildEnquiryEmailNeedsManual is concurrent-safe (only one wins)', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const past = new Date(Date.now() - 60_000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'sending',
        'emails.customer.attemptCount': 10,
        'emails.customer.maxAttempts': 10,
        'emails.customer.visibilityTimeoutAt': past
      }
    }
  );

  const [a, b] = await Promise.all([
    markBuildEnquiryEmailNeedsManual({ enquiryId: created.doc._id, lane: 'customer' }),
    markBuildEnquiryEmailNeedsManual({ enquiryId: created.doc._id, lane: 'customer' })
  ]);
  const wins = [a, b].filter(Boolean);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].emails.customer.status, 'needs_manual');
});

test('startBuildEnquiryEmailWorker respects enabled override and stop', async () => {
  const emailService = mockEmailService(async () => ({
    success: true,
    method: 'sent',
    messageId: 'boot'
  }));
  const res = await startBuildEnquiryEmailWorker({
    enabled: true,
    tickMs: 60_000,
    batchSize: 5,
    visibilityTimeoutMs: 123456,
    emailService
  });
  assert.equal(res.started, true);
  const running = getBuildEnquiryEmailWorkerStateForTest();
  assert.equal(running.visibilityTimeoutMs, 123456);
  await new Promise((r) => setTimeout(r, 30));
  await stopBuildEnquiryEmailWorkerForTest();
  const st = getBuildEnquiryEmailWorkerStateForTest();
  assert.equal(st.enabled, false);
});
