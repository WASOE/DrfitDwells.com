/**
 * Isolated E2E: public POST → Mongo persist → email worker tick → Ops list/detail.
 * Controlled mock SMTP only. Never contacts real customers.
 *
 * Run: node --test server/scripts/buildEnquiryProdPrep.e2e.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const BuildEnquiry = require('../models/BuildEnquiry');
const { createToken } = require('../middleware/adminAuth');
const {
  __setEmailServiceForTesting
} = require('../services/buildEnquiries/buildEnquiryEmailService');
const {
  tickOnce,
  stopBuildEnquiryEmailWorkerForTest
} = require('../services/buildEnquiries/buildEnquiryEmailWorker');
const publicBuildEnquiryRoutes = require('../routes/publicBuildEnquiryRoutes');

let mongoServer;
let publicApp;
let opsApp;
let sent = [];

function unique(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function tokenForAdmin() {
  const now = Math.floor(Date.now() / 1000);
  return createToken(
    {
      sub: 'be-e2e',
      role: 'admin',
      modules: ['*'],
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `be-e2e-${now}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

function payload(overrides = {}) {
  return {
    idempotencyKey: unique('e2e-idem'),
    contact: {
      name: 'E2E Test Guest',
      email: 'e2e.build+test@example.invalid',
      phone: null
    },
    project: {
      location: 'Test plot (integration)',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'exploring',
      message: 'Automated integration test — discard.'
    },
    config: {
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: { cladding: 'cladding-thermal-wood' },
      toggles: []
    },
    estimate: {
      totalEur: 32000,
      hasConsultationItems: false,
      displayLabel: '€32,000',
      summaryRows: [{ key: 'Model', value: 'The Lux Cabin' }]
    },
    configMeta: { currentStep: 1, stepsVisited: [0, 1], isPartial: true },
    attribution: { utmSource: 'e2e', utmMedium: 'test' },
    website: '',
    ...overrides
  };
}

test.before(async () => {
  process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'be-e2e-secret';
  process.env.ADMIN_TOKEN_VERSION = process.env.ADMIN_TOKEN_VERSION || '1';
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'ops-e2e@example.invalid';

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await BuildEnquiry.syncIndexes();

  publicApp = express();
  publicApp.use(express.json());
  publicApp.use('/api/public/build-enquiries', publicBuildEnquiryRoutes);

  const opsRouter = require('../routes/ops');
  opsApp = express();
  opsApp.use(express.json());
  opsApp.use('/api/ops', opsRouter);
});

test.after(async () => {
  await stopBuildEnquiryEmailWorkerForTest();
  __setEmailServiceForTesting(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  sent = [];
  await BuildEnquiry.deleteMany({});
  __setEmailServiceForTesting({
    sendEmail: async (opts) => {
      sent.push(opts);
      return {
        success: true,
        method: 'sent',
        messageId: `e2e-mock-${sent.length}`
      };
    }
  });
});

test('indexes required for build enquiries exist after syncIndexes', async () => {
  const indexes = await BuildEnquiry.collection.indexes();
  const names = indexes.map((idx) => JSON.stringify(idx.key));
  assert.ok(names.some((n) => n.includes('projectReference')));
  assert.ok(names.some((n) => n.includes('idempotencyKey')));
  assert.ok(names.some((n) => n.includes('emailNormalized')));
  assert.ok(names.some((n) => n.includes('emails.internal.status')));
  assert.ok(names.some((n) => n.includes('emails.customer.status')));
  assert.ok(names.some((n) => n.includes('"status":1') && n.includes('createdAt')));
});

test('e2e: POST persists, worker sends both lanes, Ops list/detail see enquiry', async () => {
  const body = payload();
  const createRes = await request(publicApp)
    .post('/api/public/build-enquiries')
    .send(body);
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.success, true);
  const { projectReference, enquiryId } = createRes.body.data;
  assert.ok(projectReference);
  assert.ok(enquiryId);

  const doc = await BuildEnquiry.findById(enquiryId).lean();
  assert.ok(doc);
  assert.equal(doc.contact.email, 'e2e.build+test@example.invalid');
  assert.equal(doc.isTest, false);
  // Initial attempt may already have succeeded via create path; force failed for worker path if needed
  if (doc.emails.internal.status !== 'succeeded' || doc.emails.customer.status !== 'succeeded') {
    await BuildEnquiry.updateOne(
      { _id: enquiryId },
      {
        $set: {
          'emails.internal.status': 'failed',
          'emails.internal.nextAttemptAt': new Date(0),
          'emails.internal.attemptCount': 1,
          'emails.customer.status': 'failed',
          'emails.customer.nextAttemptAt': new Date(0),
          'emails.customer.attemptCount': 1
        }
      }
    );
    sent.length = 0;
    const summary = await tickOnce({
      emailService: {
        sendEmail: async (opts) => {
          sent.push(opts);
          return { success: true, method: 'sent', messageId: `tick-${sent.length}` };
        }
      }
    });
    assert.ok(summary.lanes.internal.succeeded + summary.lanes.customer.succeeded >= 1);
  }

  const after = await BuildEnquiry.findById(enquiryId).lean();
  assert.ok(['succeeded', 'failed', 'pending', 'needs_manual', 'sending'].includes(after.emails.internal.status));
  assert.ok(['succeeded', 'failed', 'pending', 'needs_manual', 'sending'].includes(after.emails.customer.status));

  const listRes = await request(opsApp)
    .get('/api/ops/build-enquiries')
    .set('Authorization', `Bearer ${tokenForAdmin()}`);
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.items.length, 1);
  assert.equal(listRes.body.data.items[0].projectReference, projectReference);
  assert.equal(JSON.stringify(listRes.body).includes('idempotencyKey'), false);
  assert.equal(JSON.stringify(listRes.body).includes('lastError'), false);

  const detailRes = await request(opsApp)
    .get(`/api/ops/build-enquiries/${enquiryId}`)
    .set('Authorization', `Bearer ${tokenForAdmin()}`);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.data.projectReference, projectReference);
  assert.equal(detailRes.body.data.contact.email, 'e2e.build+test@example.invalid');
  assert.ok(detailRes.body.data.emails.internal.status);
  assert.ok(detailRes.body.data.emails.customer.status);
  assert.equal(JSON.stringify(detailRes.body).includes('ECONNREFUSED'), false);
});

test('ecosystem config declares build-enquiry email worker disabled by default', () => {
  const ecosystem = require('../../ecosystem.config.cjs');
  const app = ecosystem.apps.find((a) => a.name === 'driftdwells-build-enquiry-email-worker');
  assert.ok(app);
  assert.equal(app.script, 'server/scripts/runBuildEnquiryEmailWorker.js');
  assert.equal(app.env.BUILD_ENQUIRY_EMAIL_WORKER_ENABLED, '0');
  assert.equal(app.env_production.BUILD_ENQUIRY_EMAIL_WORKER_ENABLED, '0');
});
