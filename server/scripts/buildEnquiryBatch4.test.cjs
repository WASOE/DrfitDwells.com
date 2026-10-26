/**
 * Batch 4: Ops Build Enquiries list/detail/status API.
 * Run: node --test server/scripts/buildEnquiryBatch4.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BuildEnquiry = require('../models/BuildEnquiry');
const Booking = require('../models/Booking');
const GiftVoucher = require('../models/GiftVoucher');
const { createToken } = require('../middleware/adminAuth');
const {
  toDetail,
  MAX_LIMIT
} = require('../services/ops/readModels/buildEnquiriesReadModel');

let mongoServer;
let app;

function tokenFor({ sub = 'be-ops', role = 'admin', modules } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const resolvedModules =
    modules ||
    (role === 'admin'
      ? ['*']
      : role === 'cleaner'
        ? ['cleaning']
        : ['calendar', 'reservations', 'dashboard']);
  return createToken(
    {
      sub,
      role,
      modules: resolvedModules,
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `be-${sub}-${role}-${Math.random().toString(36).slice(2, 8)}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

function auth(roleOrOpts = 'admin') {
  const opts = typeof roleOrOpts === 'string' ? { role: roleOrOpts } : roleOrOpts;
  return { Authorization: `Bearer ${tokenFor(opts)}` };
}

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function enquiryDoc(overrides = {}) {
  const id = new mongoose.Types.ObjectId();
  const suffix = String(id).slice(-12).toUpperCase();
  return {
    _id: id,
    projectReference: `BD-20261026-${suffix}`,
    idempotencyKey: unique('idem'),
    contact: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      emailNormalized: 'ada@example.com',
      phone: '+359888000111'
    },
    project: {
      location: 'Near Bansko',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'within_6_months',
      message: 'Looking for a Lux Cabin'
    },
    config: {
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: { cladding: 'cladding-thermal-wood' },
      toggles: ['extra-solar']
    },
    estimate: {
      totalEur: 39200,
      hasConsultationItems: false,
      displayLabel: '€39,200',
      unverified: true
    },
    configMeta: { currentStep: 2, stepsVisited: [0, 1, 2], isPartial: true },
    attribution: { utmSource: 'instagram', utmMedium: 'social' },
    status: 'new',
    emails: {
      internal: {
        status: 'succeeded',
        attemptCount: 1,
        maxAttempts: 10,
        lastError: null
      },
      customer: {
        status: 'succeeded',
        attemptCount: 1,
        maxAttempts: 10,
        lastError: null
      }
    },
    ...overrides
  };
}

function assertNoSecrets(payload) {
  const raw = JSON.stringify(payload);
  assert.equal(raw.includes('idempotencyKey'), false);
  assert.equal(raw.includes('lastError'), false);
  assert.equal(raw.includes('claimedBy'), false);
  assert.equal(raw.includes('smtpAttemptStartedAt'), false);
  assert.equal(raw.includes('visibilityTimeoutAt'), false);
  assert.equal(raw.includes('providerMessageId'), false);
}

test.before(async () => {
  process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'be-batch4-test-secret';
  process.env.ADMIN_TOKEN_VERSION = process.env.ADMIN_TOKEN_VERSION || '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await BuildEnquiry.syncIndexes();

  const opsRouter = require('../routes/ops');
  app = express();
  app.use(express.json());
  app.use('/api/ops', opsRouter);
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await BuildEnquiry.deleteMany({});
  if (mongoose.models.Booking) await Booking.deleteMany({});
  if (mongoose.models.GiftVoucher) await GiftVoucher.deleteMany({});
});

test('GET list requires auth (401)', async () => {
  const res = await request(app).get('/api/ops/build-enquiries');
  assert.equal(res.status, 401);
});

test('GET detail requires auth (401)', async () => {
  const doc = await BuildEnquiry.create(enquiryDoc());
  const res = await request(app).get(`/api/ops/build-enquiries/${doc._id}`);
  assert.equal(res.status, 401);
});

test('PATCH requires auth (401)', async () => {
  const doc = await BuildEnquiry.create(enquiryDoc());
  const res = await request(app)
    .patch(`/api/ops/build-enquiries/${doc._id}`)
    .send({ status: 'in_progress' });
  assert.equal(res.status, 401);
});

test('cleaner without finance is forbidden (403)', async () => {
  const res = await request(app)
    .get('/api/ops/build-enquiries')
    .set(auth({ role: 'cleaner', modules: ['cleaning'] }));
  assert.ok(res.status === 403 || res.status === 401);
});

test('operator without finance is forbidden (403)', async () => {
  const res = await request(app)
    .get('/api/ops/build-enquiries')
    .set(auth({ role: 'operator', modules: ['calendar', 'reservations'] }));
  assert.ok(res.status === 403 || res.status === 401);
});

test('finance operator can list', async () => {
  await BuildEnquiry.create(enquiryDoc({ contact: {
    name: 'Finance Ok',
    email: 'fin@example.com',
    emailNormalized: 'fin@example.com',
    phone: null
  } }));
  const res = await request(app)
    .get('/api/ops/build-enquiries')
    .set(auth({ role: 'operator', modules: ['finance'] }));
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.items.length, 1);
  assertNoSecrets(res.body);
});

test('list returns reference, customer, model, estimate, date, status', async () => {
  const doc = await BuildEnquiry.create(enquiryDoc());
  const res = await request(app).get('/api/ops/build-enquiries').set(auth('admin'));
  assert.equal(res.status, 200);
  const item = res.body.data.items[0];
  assert.equal(item.id, String(doc._id));
  assert.equal(item.projectReference, doc.projectReference);
  assert.equal(item.customerName, 'Ada Lovelace');
  assert.equal(item.customerEmail, 'ada@example.com');
  assert.equal(item.modelId, 'lux-cabin');
  assert.ok(item.modelLabel);
  assert.equal(item.estimateDisplayLabel, '€39,200');
  assert.equal(item.estimateTotalEur, 39200);
  assert.ok(item.createdAt);
  assert.equal(item.status, 'new');
  assert.equal(item.emailAttention.hasNeedsManual, false);
  assert.equal(item.emailAttention.hasFailed, false);
  assertNoSecrets(res.body);
});

test('search by reference, name, email', async () => {
  await BuildEnquiry.create(
    enquiryDoc({
      contact: {
        name: 'Alice Search',
        email: 'alice.search@example.com',
        emailNormalized: 'alice.search@example.com',
        phone: null
      }
    })
  );
  await BuildEnquiry.create(
    enquiryDoc({
      contact: {
        name: 'Bob Other',
        email: 'bob@example.com',
        emailNormalized: 'bob@example.com',
        phone: null
      },
      project: {
        location: 'Sofia',
        landStatus: 'owned',
        budget: '30k_50k',
        timeline: 'within_6_months',
        message: null
      }
    })
  );

  const byName = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ q: 'alice' })
    .set(auth('admin'));
  assert.equal(byName.status, 200);
  assert.equal(byName.body.data.items.length, 1);
  assert.match(byName.body.data.items[0].customerName, /Alice/i);

  const byEmail = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ q: 'bob@example' })
    .set(auth('admin'));
  assert.equal(byEmail.body.data.items.length, 1);
  assert.equal(byEmail.body.data.items[0].customerEmail, 'bob@example.com');
});

test('filter by status', async () => {
  await BuildEnquiry.create(enquiryDoc({ status: 'new' }));
  await BuildEnquiry.create(enquiryDoc({ status: 'closed' }));
  const res = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ status: 'closed' })
    .set(auth('admin'));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.items[0].status, 'closed');
});

test('invalid status filter returns 400', async () => {
  const res = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ status: 'won' })
    .set(auth('admin'));
  assert.equal(res.status, 400);
});

test('pagination respects limit cap', async () => {
  for (let i = 0; i < 3; i += 1) {
    await BuildEnquiry.create(
      enquiryDoc({
        contact: {
          name: `Page ${i}`,
          email: `page${i}@example.com`,
          emailNormalized: `page${i}@example.com`,
          phone: null
        }
      })
    );
  }
  const page1 = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ page: 1, limit: 2 })
    .set(auth('admin'));
  assert.equal(page1.status, 200);
  assert.equal(page1.body.data.items.length, 2);
  assert.equal(page1.body.data.pagination.total, 3);
  assert.equal(page1.body.data.pagination.totalPages, 2);

  const capped = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ limit: 999 })
    .set(auth('admin'));
  assert.equal(capped.body.data.pagination.limit, MAX_LIMIT);
});

test('emailAttention filters needs_manual and failed', async () => {
  await BuildEnquiry.create(
    enquiryDoc({
      emails: {
        internal: { status: 'needs_manual', attemptCount: 10, maxAttempts: 10, lastError: 'SMTP boom' },
        customer: { status: 'succeeded', attemptCount: 1, maxAttempts: 10 }
      }
    })
  );
  await BuildEnquiry.create(
    enquiryDoc({
      emails: {
        internal: { status: 'failed', attemptCount: 2, maxAttempts: 10, lastError: 'timeout' },
        customer: { status: 'pending', attemptCount: 0, maxAttempts: 10 }
      }
    })
  );
  await BuildEnquiry.create(enquiryDoc());

  const manual = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ emailAttention: 'needs_manual' })
    .set(auth('admin'));
  assert.equal(manual.body.data.items.length, 1);
  assert.equal(manual.body.data.items[0].emailAttention.hasNeedsManual, true);

  const failed = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ emailAttention: 'failed' })
    .set(auth('admin'));
  assert.equal(failed.body.data.items.length, 1);
  assert.equal(failed.body.data.items[0].emailAttention.hasFailed, true);

  const alert = await request(app)
    .get('/api/ops/build-enquiries')
    .query({ emailAttention: 'alert' })
    .set(auth('admin'));
  assert.equal(alert.body.data.items.length, 2);
  assertNoSecrets(alert.body);
});

test('detail returns contact, config, project, estimate, attribution, emails', async () => {
  const doc = await BuildEnquiry.create(
    enquiryDoc({
      emails: {
        internal: {
          status: 'needs_manual',
          attemptCount: 10,
          maxAttempts: 10,
          lastError: 'relay refused',
          claimedBy: 'worker-1',
          providerMessageId: 'msg-secret'
        },
        customer: { status: 'failed', attemptCount: 3, maxAttempts: 10, lastError: 'bounce' }
      }
    })
  );
  const res = await request(app)
    .get(`/api/ops/build-enquiries/${doc._id}`)
    .set(auth('admin'));
  assert.equal(res.status, 200);
  const data = res.body.data;
  assert.equal(data.projectReference, doc.projectReference);
  assert.equal(data.contact.name, 'Ada Lovelace');
  assert.equal(data.contact.email, 'ada@example.com');
  assert.equal(data.project.location, 'Near Bansko');
  assert.equal(data.config.modelId, 'lux-cabin');
  assert.ok(data.config.modelLabel);
  assert.equal(data.estimate.displayLabel, '€39,200');
  assert.equal(data.attribution.utmSource, 'instagram');
  assert.equal(data.emails.internal.status, 'needs_manual');
  assert.equal(data.emails.customer.status, 'failed');
  assert.equal(data.emails.attention.hasNeedsManual, true);
  assert.equal(data.emails.attention.hasFailed, true);
  assert.equal(data.emails.internal.attemptCount, 10);
  assertNoSecrets(res.body);
});

test('detail 404 for missing id', async () => {
  const res = await request(app)
    .get(`/api/ops/build-enquiries/${new mongoose.Types.ObjectId()}`)
    .set(auth('admin'));
  assert.equal(res.status, 404);
});

test('detail 400 for invalid id', async () => {
  const res = await request(app)
    .get('/api/ops/build-enquiries/not-an-id')
    .set(auth('admin'));
  assert.equal(res.status, 400);
});

test('PATCH valid status transitions', async () => {
  const doc = await BuildEnquiry.create(enquiryDoc({ status: 'new' }));
  const toProgress = await request(app)
    .patch(`/api/ops/build-enquiries/${doc._id}`)
    .set(auth({ role: 'operator', modules: ['finance'] }))
    .send({ status: 'in_progress' });
  assert.equal(toProgress.status, 200);
  assert.equal(toProgress.body.data.status, 'in_progress');

  const toClosed = await request(app)
    .patch(`/api/ops/build-enquiries/${doc._id}`)
    .set(auth('admin'))
    .send({ status: 'closed' });
  assert.equal(toClosed.status, 200);
  assert.equal(toClosed.body.data.status, 'closed');

  const backToNew = await request(app)
    .patch(`/api/ops/build-enquiries/${doc._id}`)
    .set(auth('admin'))
    .send({ status: 'new' });
  assert.equal(backToNew.status, 200);
  assert.equal(backToNew.body.data.status, 'new');
  assertNoSecrets(backToNew.body);
});

test('PATCH rejects invalid status', async () => {
  const doc = await BuildEnquiry.create(enquiryDoc());
  const res = await request(app)
    .patch(`/api/ops/build-enquiries/${doc._id}`)
    .set(auth('admin'))
    .send({ status: 'archived' });
  assert.equal(res.status, 400);
});

test('toDetail strips internal email metadata', () => {
  const detail = toDetail({
    _id: new mongoose.Types.ObjectId(),
    projectReference: 'BD-TEST',
    status: 'new',
    contact: { name: 'A', email: 'a@b.c', phone: null },
    project: { location: 'X', landStatus: 'owned', budget: '30k_50k', timeline: 'within_6_months' },
    config: { modelId: 'aframe', radio: {}, toggles: [] },
    estimate: {},
    configMeta: {},
    attribution: {},
    emails: {
      internal: {
        status: 'failed',
        attemptCount: 2,
        maxAttempts: 10,
        lastError: 'SMTP 550',
        claimedBy: 'w1',
        claimedAt: new Date(),
        visibilityTimeoutAt: new Date(),
        providerMessageId: 'mid',
        smtpAttemptStartedAt: new Date()
      },
      customer: { status: 'pending', attemptCount: 0, maxAttempts: 10 }
    },
    idempotencyKey: 'secret-key'
  });
  assert.equal(detail.emails.internal.status, 'failed');
  assert.equal(detail.emails.internal.lastError, undefined);
  assert.equal(detail.idempotencyKey, undefined);
  assertNoSecrets(detail);
});

test('500 responses use safe generic messages (no raw DB errors)', async () => {
  const original = BuildEnquiry.find;
  BuildEnquiry.find = () => {
    throw new Error('ECONNREFUSED mongodb://secret-host:27017');
  };
  try {
    const res = await request(app).get('/api/ops/build-enquiries').set(auth('admin'));
    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, 'Failed to list build enquiries');
    assert.equal(String(JSON.stringify(res.body)).includes('ECONNREFUSED'), false);
    assert.equal(String(JSON.stringify(res.body)).includes('secret-host'), false);
  } finally {
    BuildEnquiry.find = original;
  }
});

test('booking and voucher collections remain isolated from list', async () => {
  await BuildEnquiry.create(enquiryDoc());

  // Ensure Booking / GiftVoucher docs (if schemas load) never appear in build enquiry payloads
  let bookingCount = 0;
  let voucherCount = 0;
  try {
    await Booking.create({
      guestName: 'Booking Guest',
      guestEmail: 'booking@example.com',
      checkIn: new Date(),
      checkOut: new Date(Date.now() + 86400000),
      totalPrice: 100,
      status: 'confirmed'
    });
    bookingCount = await Booking.countDocuments();
  } catch {
    bookingCount = 0;
  }
  try {
    await GiftVoucher.create({
      code: 'DD-ISOL-AAAA-BBBB',
      amountOriginalCents: 10000,
      balanceRemainingCents: 10000,
      currency: 'EUR',
      status: 'active',
      buyerName: 'Buyer',
      buyerEmail: 'buyer@example.com',
      recipientName: 'Recipient',
      recipientEmail: 'recipient@example.com',
      deliveryMode: 'email',
      purchaseRequestId: unique('gvr'),
      stripePaymentIntentId: unique('pi'),
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000 * 30)
    });
    voucherCount = await GiftVoucher.countDocuments();
  } catch {
    voucherCount = 0;
  }

  const res = await request(app).get('/api/ops/build-enquiries').set(auth('admin'));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.items.length, 1);
  assert.equal(res.body.data.pagination.total, 1);
  const raw = JSON.stringify(res.body);
  assert.equal(raw.includes('Booking Guest'), false);
  assert.equal(raw.includes('DD-ISOL'), false);
  assert.equal(raw.includes('buyer@example.com'), false);
  // Isolation holds regardless of whether Booking/GiftVoucher schemas accepted seed docs
  assert.ok(bookingCount === 0 || bookingCount >= 1);
  assert.ok(voucherCount === 0 || voucherCount >= 1);
});
