'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BuildEnquiry = require('../models/BuildEnquiry');
const {
  createBuildEnquiry,
  buildProjectReference
} = require('../services/buildEnquiries/buildEnquiryService');
const {
  attemptInitialBuildEnquiryEmails,
  attemptBuildEnquiryEmailLane,
  claimBuildEnquiryEmailLane,
  buildCustomerEmailContent,
  buildInternalEmailContent,
  __setEmailServiceForTesting
} = require('../services/buildEnquiries/buildEnquiryEmailService');
const publicBuildEnquiryRoutes = require('../routes/publicBuildEnquiryRoutes');

let mongoServer;
let app;
let previousAdminEmail;
let previousBookingNotify;

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validPayload(overrides = {}) {
  return {
    idempotencyKey: uniqueKey('idem'),
    contact: {
      name: 'Ada <script>alert(1)</script>',
      email: 'ada@example.com',
      phone: '+359888000111'
    },
    project: {
      location: 'Near Bansko',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'within_6_months',
      message: 'Hello <b>world</b>'
    },
    config: {
      modelId: 'lux-cabin',
      radio: { cladding: 'cladding-thermal-wood' },
      toggles: ['extra-solar']
    },
    estimate: {
      totalEur: 39200,
      displayLabel: '€39,200',
      hasConsultationItems: false
    },
    configMeta: { currentStep: 4, stepsVisited: [0, 1, 2, 3, 4], isPartial: false },
    website: '',
    ...overrides
  };
}

function mockEmailService(handler) {
  return {
    sendEmail: async (opts) => handler(opts)
  };
}

function buildApp() {
  const instance = express();
  instance.use(express.json());
  instance.use('/api/public/build-enquiries', publicBuildEnquiryRoutes);
  return instance;
}

test.before(async () => {
  previousAdminEmail = process.env.ADMIN_EMAIL;
  previousBookingNotify = process.env.BOOKING_NOTIFICATION_EMAIL;
  process.env.ADMIN_EMAIL = 'ops-build@driftdwells.test';
  delete process.env.BOOKING_NOTIFICATION_EMAIL;

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await BuildEnquiry.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = previousAdminEmail;
  if (previousBookingNotify === undefined) delete process.env.BOOKING_NOTIFICATION_EMAIL;
  else process.env.BOOKING_NOTIFICATION_EMAIL = previousBookingNotify;

  __setEmailServiceForTesting(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await BuildEnquiry.deleteMany({});
  __setEmailServiceForTesting(null);
});

test('project reference uses 12-hex suffix', () => {
  const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  assert.equal(
    buildProjectReference(id, new Date(Date.UTC(2026, 9, 26))),
    'BD-20261026-6CD799439011'
  );
});

test('customer email escapes HTML and avoids binding-quote or saved-project claims', () => {
  const content = buildCustomerEmailContent({
    _id: new mongoose.Types.ObjectId(),
    projectReference: 'BD-20261026-ABCDEF123456',
    contact: { name: 'Ada <script>', email: 'ada@example.com' },
    project: { location: 'X', landStatus: 'owned', budget: 'undecided', timeline: 'exploring' },
    config: { modelId: 'lux-cabin', radio: {}, toggles: [] },
    estimate: { displayLabel: '€32,000', unverified: true },
    configMeta: { isPartial: true }
  });
  assert.ok(!content.html.includes('<script>'));
  assert.ok(content.html.includes('Ada &lt;script&gt;'));
  assert.match(content.html, /indicative only/i);
  assert.ok(!/binding quote/i.test(content.html) || /not a binding quote/i.test(content.html));
  assert.ok(!/saved.?project|view your project|login/i.test(content.html));
  assert.ok(content.text.includes('BD-20261026-ABCDEF123456'));
});

test('both emails succeed and persist succeeded status', async () => {
  const sends = [];
  const emailService = mockEmailService(async (opts) => {
    sends.push(opts);
    if (typeof opts.onProviderAttemptStarted === 'function') {
      await opts.onProviderAttemptStarted();
    }
    return { success: true, method: 'sent', messageId: `mid-${opts.trigger}` };
  });

  const outcome = await createBuildEnquiry(validPayload(), { isTest: true, emailService });
  assert.equal(outcome.kind, 'created');
  assert.equal(outcome.result.success, true);

  const row = await BuildEnquiry.findById(outcome.result.data.enquiryId).lean();
  assert.equal(row.emails.internal.status, 'succeeded');
  assert.equal(row.emails.customer.status, 'succeeded');
  assert.equal(row.emails.internal.attemptCount, 1);
  assert.equal(row.emails.customer.attemptCount, 1);
  assert.equal(row.emails.internal.providerMessageId, 'mid-build_enquiry_internal');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].to, 'ops-build@driftdwells.test');
  assert.equal(sends[1].to, 'ada@example.com');
  assert.ok(sends.every((s) => s.from == null)); // EmailService sets from internally
});

test('internal succeeds while customer fails; create still succeeds', async () => {
  const emailService = mockEmailService(async (opts) => {
    if (opts.trigger === 'build_enquiry_customer') {
      return { success: false, method: 'failed', error: 'mailbox_full' };
    }
    return { success: true, method: 'sent', messageId: 'ok-internal' };
  });

  const outcome = await createBuildEnquiry(validPayload(), { isTest: true, emailService });
  assert.equal(outcome.kind, 'created');
  assert.equal(outcome.result.success, true);

  const row = await BuildEnquiry.findById(outcome.result.data.enquiryId).lean();
  assert.equal(row.emails.internal.status, 'succeeded');
  assert.equal(row.emails.customer.status, 'failed');
  assert.equal(row.emails.customer.lastError, 'mailbox_full');
  assert.ok(row.emails.customer.nextAttemptAt instanceof Date);
});

test('SMTP unavailable (logged fallback) marks lanes failed with retry', async () => {
  const emailService = mockEmailService(async () => ({
    success: true,
    method: 'logged'
  }));

  const outcome = await createBuildEnquiry(validPayload(), { isTest: true, emailService });
  assert.equal(outcome.kind, 'created');

  const row = await BuildEnquiry.findById(outcome.result.data.enquiryId).lean();
  assert.equal(row.emails.internal.status, 'failed');
  assert.equal(row.emails.customer.status, 'failed');
  assert.ok(row.emails.internal.nextAttemptAt);
  assert.ok(row.emails.customer.nextAttemptAt);
});

test('duplicate idempotent replay does not send additional emails', async () => {
  let sendCount = 0;
  const emailService = mockEmailService(async () => {
    sendCount += 1;
    return { success: true, method: 'sent', messageId: `m-${sendCount}` };
  });

  const payload = validPayload();
  const first = await createBuildEnquiry(payload, { isTest: true, emailService });
  assert.equal(first.kind, 'created');
  assert.equal(sendCount, 2);

  const second = await createBuildEnquiry(payload, { isTest: true, emailService });
  assert.equal(second.kind, 'replay');
  assert.equal(second.result.data.duplicate, true);
  assert.equal(sendCount, 2);
});

test('email status persistence failure does not fail create response', async () => {
  const emailService = mockEmailService(async () => ({
    success: true,
    method: 'sent',
    messageId: 'persist-fail-test'
  }));

  const created = await createBuildEnquiry(validPayload(), {
    isTest: true,
    skipEmail: true
  });
  assert.equal(created.kind, 'created');

  const original = BuildEnquiry.findOneAndUpdate.bind(BuildEnquiry);
  let updateCalls = 0;
  BuildEnquiry.findOneAndUpdate = async function patched(...args) {
    updateCalls += 1;
    if (updateCalls === 1) {
      return original(...args); // claim
    }
    throw new Error('simulated status persist failure');
  };

  try {
    const laneResult = await attemptBuildEnquiryEmailLane(created.doc._id, 'internal', {
      emailService,
      workerId: 'test'
    });
    assert.equal(laneResult.status, 'persistence_failed');
    assert.match(laneResult.persistenceError, /simulated status persist failure/);
  } finally {
    BuildEnquiry.findOneAndUpdate = original;
  }

  // Public create path still returns success when email layer throws after persist
  let blows = 0;
  const exploding = mockEmailService(async () => {
    blows += 1;
    throw new Error('smtp boom');
  });
  // After throw in sendEmail, markFailed should run — still created ok
  const again = await createBuildEnquiry(validPayload(), { isTest: true, emailService: exploding });
  assert.equal(again.kind, 'created');
  assert.equal(again.result.success, true);
  assert.ok(blows >= 1);
});

test('expired sending claim can be reclaimed when under maxAttempts', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const past = new Date(Date.now() - 60_000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'sending',
        'emails.internal.claimedBy': 'stale-worker',
        'emails.internal.claimedAt': past,
        'emails.internal.visibilityTimeoutAt': past,
        'emails.internal.attemptCount': 1,
        'emails.internal.maxAttempts': 10
      }
    }
  );

  const claimed = await claimBuildEnquiryEmailLane({
    enquiryId: created.doc._id,
    lane: 'internal',
    workerId: 'recovery-worker',
    now: new Date()
  });
  assert.ok(claimed);
  assert.equal(claimed.emails.internal.status, 'sending');
  assert.equal(claimed.emails.internal.claimedBy, 'recovery-worker');
  assert.equal(claimed.emails.internal.attemptCount, 2);
});

test('exhausted failed lane is not claimable even when nextAttemptAt is null', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.customer.status': 'failed',
        'emails.customer.attemptCount': 10,
        'emails.customer.maxAttempts': 10,
        'emails.customer.nextAttemptAt': null,
        'emails.customer.lastError': 'exhausted'
      }
    }
  );

  const claimed = await claimBuildEnquiryEmailLane({
    enquiryId: created.doc._id,
    lane: 'customer',
    workerId: 'worker',
    now: new Date()
  });
  assert.equal(claimed, null);

  const row = await BuildEnquiry.findById(created.doc._id).lean();
  assert.equal(row.emails.customer.status, 'failed');
  assert.equal(row.emails.customer.attemptCount, 10);
});

test('eligible failed lane with due nextAttemptAt remains claimable under maxAttempts', async () => {
  const created = await createBuildEnquiry(validPayload(), { isTest: true, skipEmail: true });
  const due = new Date(Date.now() - 1000);
  await BuildEnquiry.updateOne(
    { _id: created.doc._id },
    {
      $set: {
        'emails.internal.status': 'failed',
        'emails.internal.attemptCount': 2,
        'emails.internal.maxAttempts': 10,
        'emails.internal.nextAttemptAt': due,
        'emails.internal.lastError': 'smtp_timeout'
      }
    }
  );

  const claimed = await claimBuildEnquiryEmailLane({
    enquiryId: created.doc._id,
    lane: 'internal',
    workerId: 'retry-worker',
    now: new Date()
  });
  assert.ok(claimed);
  assert.equal(claimed.emails.internal.status, 'sending');
  assert.equal(claimed.emails.internal.attemptCount, 3);
  assert.equal(claimed.emails.internal.claimedBy, 'retry-worker');
});

test('exhausted expired sending lease is not reclaimable', async () => {
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
        'emails.internal.claimedBy': 'stale'
      }
    }
  );

  const claimed = await claimBuildEnquiryEmailLane({
    enquiryId: created.doc._id,
    lane: 'internal',
    workerId: 'recovery-worker',
    now: new Date()
  });
  assert.equal(claimed, null);
});

test('HTTP create returns 201 even when emails fail; replay is 200 without extra sends', async () => {
  let sendCount = 0;
  __setEmailServiceForTesting(
    mockEmailService(async () => {
      sendCount += 1;
      return { success: false, method: 'unavailable', error: 'SMTP transport unavailable' };
    })
  );

  // Route uses createBuildEnquiry without injected service — set module seam
  const payload = validPayload();
  const first = await request(app).post('/api/public/build-enquiries').send(payload);
  assert.equal(first.status, 201);
  assert.equal(first.body.success, true);

  const row = await BuildEnquiry.findById(first.body.data.enquiryId).lean();
  assert.equal(row.emails.internal.status, 'failed');
  assert.equal(row.emails.customer.status, 'failed');
  const sendsAfterCreate = sendCount;

  const second = await request(app).post('/api/public/build-enquiries').send(payload);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(sendCount, sendsAfterCreate);
});

test('internal content includes escaped guest message', () => {
  const content = buildInternalEmailContent({
    _id: new mongoose.Types.ObjectId(),
    projectReference: 'BD-20261026-ABCDEF123456',
    contact: { name: 'Ada', email: 'ada@example.com', phone: null },
    project: {
      location: 'Plot A',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'asap',
      message: '<img src=x onerror=alert(1)>'
    },
    config: { modelId: 'aframe', radio: {}, toggles: [] },
    estimate: { displayLabel: 'From €20,000', unverified: true },
    configMeta: { isPartial: true }
  });
  assert.ok(!content.html.includes('<img src=x'));
  assert.ok(content.html.includes('&lt;img'));
});
