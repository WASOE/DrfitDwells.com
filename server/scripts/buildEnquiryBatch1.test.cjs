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
const { validateBuildEnquiryCreateInput } = require('../services/buildEnquiries/buildEnquiryValidation');
const {
  __setEmailServiceForTesting
} = require('../services/buildEnquiries/buildEnquiryEmailService');
const publicBuildEnquiryRoutes = require('../routes/publicBuildEnquiryRoutes');

let mongoServer;
let app;
let previousAdminEmail;

function uniqueKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function validPayload(overrides = {}) {
  return {
    idempotencyKey: uniqueKey('idem'),
    contact: {
      name: 'Ada Lovelace',
      email: 'Ada@Example.COM',
      phone: '+359888000111'
    },
    project: {
      location: 'Near Bansko, Bulgaria',
      landStatus: 'owned',
      budget: '30k_50k',
      timeline: 'within_6_months',
      message: 'Looking for a Lux Cabin on our plot.'
    },
    config: {
      modelId: 'lux-cabin',
      customDimensions: null,
      radio: {
        cladding: 'cladding-thermal-wood',
        roof: 'roof-membrane'
      },
      toggles: ['extra-solar']
    },
    estimate: {
      totalEur: 39200,
      hasConsultationItems: false,
      displayLabel: '€39,200',
      summaryRows: [{ key: 'Model', value: 'The Lux Cabin' }]
    },
    configMeta: {
      currentStep: 2,
      stepsVisited: [0, 1, 2],
      isPartial: true
    },
    attribution: {
      utmSource: 'instagram',
      utmMedium: 'social'
    },
    sessionKey: uniqueKey('session'),
    visitorKey: uniqueKey('visitor'),
    website: '',
    ...overrides
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
  process.env.ADMIN_EMAIL = 'ops-build@driftdwells.test';

  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), {
    serverSelectionTimeoutMS: 10000
  });
  await BuildEnquiry.syncIndexes();
  app = buildApp();
});

test.after(async () => {
  if (previousAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = previousAdminEmail;
  __setEmailServiceForTesting(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test.beforeEach(async () => {
  await BuildEnquiry.deleteMany({});
  __setEmailServiceForTesting({
    sendEmail: async () => ({ success: true, method: 'sent', messageId: 'batch1-mock' })
  });
});

test('buildProjectReference uses preallocated ObjectId 12-hex suffix', () => {
  const id = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const ref = buildProjectReference(id, new Date(Date.UTC(2026, 9, 26)));
  assert.equal(ref, 'BD-20261026-6CD799439011');
});

test('validation accepts incomplete config (empty radio/toggles)', () => {
  const result = validateBuildEnquiryCreateInput(
    validPayload({
      config: { modelId: 'aframe' },
      estimate: {},
      configMeta: { isPartial: true }
    })
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.config.modelId, 'aframe');
  assert.deepEqual(result.value.config.radio, {});
  assert.deepEqual(result.value.config.toggles, []);
  assert.equal(result.value.estimate.unverified, true);
});

test('validation rejects unknown option ids', () => {
  const result = validateBuildEnquiryCreateInput(
    validPayload({
      config: {
        modelId: 'lux-cabin',
        radio: { cladding: 'cladding-not-real' },
        toggles: []
      }
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unknown option/.test(e)));
});

test('validation rejects unknown toggle option', () => {
  const result = validateBuildEnquiryCreateInput(
    validPayload({
      config: {
        modelId: 'lux-cabin',
        radio: {},
        toggles: ['not-a-real-toggle']
      }
    })
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /Unknown toggle/.test(e)));
});

test('create persists enquiry with normalized email and unverified estimate', async () => {
  const payload = validPayload();
  const outcome = await createBuildEnquiry(payload, { isTest: true, skipEmail: true });
  assert.equal(outcome.kind, 'created');
  assert.match(outcome.result.data.projectReference, /^BD-\d{8}-[0-9A-F]{12}$/);
  assert.equal(outcome.result.data.duplicate, false);

  const row = await BuildEnquiry.findById(outcome.result.data.enquiryId).lean();
  assert.ok(row);
  assert.equal(row.contact.emailNormalized, 'ada@example.com');
  assert.equal(row.contact.email, 'ada@example.com');
  assert.equal(row.estimate.unverified, true);
  assert.equal(row.estimate.totalEur, 39200);
  assert.equal(row.project.landStatus, 'owned');
  assert.equal(row.config.modelId, 'lux-cabin');
  assert.equal(row.emails.internal.status, 'pending');
  assert.equal(row.emails.customer.status, 'pending');
  assert.equal(String(row._id).slice(-12).toUpperCase(), row.projectReference.slice(-12));
});

test('idempotent replay returns same project reference without second row', async () => {
  const key = uniqueKey('replay');
  const payload = validPayload({ idempotencyKey: key });

  const first = await createBuildEnquiry(payload, { isTest: true, skipEmail: true });
  const second = await createBuildEnquiry(payload, { isTest: true, skipEmail: true });

  assert.equal(first.kind, 'created');
  assert.equal(second.kind, 'replay');
  assert.equal(second.result.data.duplicate, true);
  assert.equal(first.result.data.projectReference, second.result.data.projectReference);
  assert.equal(first.result.data.enquiryId, second.result.data.enquiryId);

  const count = await BuildEnquiry.countDocuments({ idempotencyKey: key });
  assert.equal(count, 1);
});

test('concurrent identical idempotencyKey creates exactly one document', async () => {
  const key = uniqueKey('race');
  const payload = validPayload({ idempotencyKey: key });

  const results = await Promise.all([
    createBuildEnquiry(payload, { isTest: true, skipEmail: true }),
    createBuildEnquiry(payload, { isTest: true, skipEmail: true }),
    createBuildEnquiry(payload, { isTest: true, skipEmail: true })
  ]);

  const refs = new Set(results.map((r) => r.result.data.projectReference));
  assert.equal(refs.size, 1);
  assert.ok(results.every((r) => r.kind === 'created' || r.kind === 'replay'));
  assert.equal(await BuildEnquiry.countDocuments({ idempotencyKey: key }), 1);
});

test('database failure surfaces as thrown error from service', async () => {
  const payload = validPayload();
  const original = BuildEnquiry.create;
  BuildEnquiry.create = async () => {
    throw new Error('simulated write failure');
  };
  try {
    await assert.rejects(
      () => createBuildEnquiry(payload, { isTest: true, skipEmail: true }),
      /simulated write failure/
    );
  } finally {
    BuildEnquiry.create = original;
  }
  assert.equal(await BuildEnquiry.countDocuments({}), 0);
});

test('POST creates enquiry (201) and replays (200)', async () => {
  const key = uniqueKey('http');
  const payload = validPayload({ idempotencyKey: key });

  const first = await request(app).post('/api/public/build-enquiries').send(payload);
  assert.equal(first.status, 201);
  assert.equal(first.body.success, true);
  assert.equal(first.body.data.duplicate, false);

  const second = await request(app).post('/api/public/build-enquiries').send(payload);
  assert.equal(second.status, 200);
  assert.equal(second.body.data.duplicate, true);
  assert.equal(second.body.data.projectReference, first.body.data.projectReference);
});

test('POST rejects invalid payload with 400', async () => {
  const response = await request(app)
    .post('/api/public/build-enquiries')
    .send(validPayload({ contact: { name: '', email: 'bad' } }));
  assert.equal(response.status, 400);
  assert.equal(response.body.success, false);
  assert.ok(Array.isArray(response.body.errors));
});

test('POST honeypot returns 204 and does not persist', async () => {
  const response = await request(app)
    .post('/api/public/build-enquiries')
    .send(validPayload({ website: 'http://spam.example' }));
  assert.equal(response.status, 204);
  assert.equal(await BuildEnquiry.countDocuments({}), 0);
});

test('POST returns 503 when persistence fails', async () => {
  const original = BuildEnquiry.create;
  BuildEnquiry.create = async () => {
    throw new Error('db down');
  };
  try {
    const response = await request(app)
      .post('/api/public/build-enquiries')
      .send(validPayload());
    assert.equal(response.status, 503);
    assert.equal(response.body.success, false);
  } finally {
    BuildEnquiry.create = original;
  }
});
