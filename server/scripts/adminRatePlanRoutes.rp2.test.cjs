/**
 * RP2 — Admin RatePlan management API route tests.
 * No production data, network, Stripe, or production env vars.
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const path = require('path');

const { createToken } = require('../middleware/adminAuth');
const {
  createAdminRatePlanRouter,
  buildHttpStatusByManagementCode,
  FORBIDDEN_BODY_KEYS
} = require('../routes/adminRatePlanRoutes');
const mgmt = require('../services/ratePlanManagementService');
const {
  RatePlanManagementError,
  MANAGEMENT_ERROR_CODES,
  createRatePlanDraft,
  activateRatePlan
} = mgmt;

const RatePlan = require('../models/RatePlan');
const Cabin = require('../models/Cabin');
const CabinType = require('../models/CabinType');
const CancellationPolicy = require('../models/CancellationPolicy');

let mongoServer;
let seq = 0;

function tokenFor({ sub = 'rp2-admin', role = 'admin', modules } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const resolvedModules =
    modules ||
    (role === 'admin' ? ['*'] : role === 'cleaner' ? ['cleaning'] : ['calendar', 'reservations', 'dashboard']);
  return createToken(
    {
      sub,
      role,
      modules: resolvedModules,
      src: 'legacy_env',
      tv: String(process.env.ADMIN_TOKEN_VERSION || '1'),
      iat: now,
      exp: now + 3600,
      jti: `rp2-${sub}-${role}-${now}`
    },
    process.env.ADMIN_JWT_SECRET
  );
}

function baseSeasonal(overrides = {}) {
  seq += 1;
  return {
    code: overrides.code || `winter-api-${seq}`,
    internalName: overrides.internalName || `Winter API ${seq}`,
    version: overrides.version != null ? overrides.version : 1,
    type: 'seasonal_stay',
    currency: 'EUR',
    arrivalWindowStart: overrides.arrivalWindowStart || '2026-12-01',
    arrivalWindowEnd: overrides.arrivalWindowEnd || '2026-12-31',
    minNights: overrides.minNights != null ? overrides.minNights : 2,
    inventoryMode: overrides.inventoryMode || 'shared',
    requiresFullPayment: true,
    cancellationPolicyCode: 'normal-stay-standard',
    cancellationPolicyVersion: 1,
    inclusions: overrides.inclusions || ['Firewood'],
    accommodations: overrides.accommodations || [
      {
        accommodationKey: 'lux-cabin',
        entityType: 'cabin',
        pricingMethod: 'nightly_per_unit',
        nightlyPerUnitAmount: 180
      }
    ],
    ...overrides
  };
}

async function seedPolicy() {
  await CancellationPolicy.create({
    code: 'normal-stay-standard',
    internalName: 'Normal stay standard',
    version: 1,
    status: 'active',
    policyType: 'normal_stay',
    correctionWindowHours: 48,
    correctionWindowMinDaysBeforeArrival: 7,
    refundTiers: [{ minDaysBeforeArrival: 0, maxDaysBeforeArrival: null, refundPercent: 0 }],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0
  });
}

async function seedInventory() {
  await Cabin.create({
    name: 'Lux Cabin',
    slug: 'lux-cabin',
    description: 'Lux',
    capacity: 4,
    pricePerNight: 150,
    minNights: 1,
    imageUrl: 'https://example.com/lux.jpg',
    location: 'Bulgaria',
    isActive: true
  });
  await Cabin.create({
    name: 'Stone House',
    slug: 'stone-house',
    description: 'Stone',
    capacity: 6,
    pricePerNight: 200,
    minNights: 1,
    imageUrl: 'https://example.com/stone.jpg',
    location: 'Bulgaria',
    isActive: true
  });
}

function buildStubApp(stubMgmt) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const { adminAuth } = require('../middleware/adminAuth');
  app.use('/api/admin', adminAuth);
  app.use('/api/admin', (req, res, next) => {
    if (req.user?.role === 'cleaner') {
      return res.status(403).json({
        success: false,
        errorType: 'forbidden',
        message: 'Access denied.'
      });
    }
    return next();
  });
  app.use('/api/admin/rate-plans', createAdminRatePlanRouter({ ratePlanManagementService: stubMgmt }));
  return app;
}

function buildFullAdminApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const adminRoutes = require('../routes/adminRoutes');
  app.use('/api/admin', adminRoutes);
  return app;
}

function assertNoLeakage(payload) {
  const text = JSON.stringify(payload);
  assert.equal(/"ownerToken"\s*:/.test(text), false);
  assert.equal(/\b[a-f0-9]{64}\b/.test(text), false);
  assert.equal(/MongoServerError|at Object\.|at async /.test(text), false);
  assert.equal(/ECONNREFUSED|password|ADMIN_JWT_SECRET/.test(text), false);
}

before(async () => {
  process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'rp2-route-test-secret';
  process.env.ADMIN_TOKEN_VERSION = process.env.ADMIN_TOKEN_VERSION || '1';
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri(), { autoIndex: true });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  seq = 0;
  await Promise.all([
    RatePlan.deleteMany({}),
    Cabin.deleteMany({}),
    CabinType.deleteMany({}),
    CancellationPolicy.deleteMany({})
  ]);
  await seedPolicy();
  await seedInventory();
});

describe('RP2 admin RatePlan API', () => {
  it('route registration under /api/admin/rate-plans (full admin router)', async () => {
    const app = buildFullAdminApp();
    const res = await request(app)
      .get('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'reg-admin' })}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.ratePlans));
  });

  it('rejects unauthenticated requests', async () => {
    const app = buildFullAdminApp();
    const res = await request(app).get('/api/admin/rate-plans');
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
  });

  it('rejects cleaner role', async () => {
    const app = buildFullAdminApp();
    const res = await request(app)
      .get('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'cleaner-1', role: 'cleaner', modules: ['cleaning'] })}`);
    assert.equal(res.status, 403);
  });

  it('success: create, list, update, clone, activate, retire', async () => {
    const app = buildFullAdminApp();
    const auth = `Bearer ${tokenFor({ sub: 'ops-actor-1' })}`;

    const created = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'api-lifecycle' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.data.ratePlan.status, 'draft');
    assert.equal(created.body.data.ratePlan.createdBy, 'ops-actor-1');
    assert.equal(created.body.data.ratePlan.updatedBy, 'ops-actor-1');
    assertNoLeakage(created.body);

    const listed = await request(app)
      .get('/api/admin/rate-plans')
      .query({ code: 'api-lifecycle', status: 'draft' })
      .set('Authorization', auth);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.ratePlans.length, 1);

    const updated = await request(app)
      .patch(`/api/admin/rate-plans/${created.body.data.ratePlan.id}`)
      .set('Authorization', auth)
      .send({
        expectedRevision: created.body.data.ratePlan.revision,
        internalName: 'Renamed API Plan',
        minNights: 3
      });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.ratePlan.internalName, 'Renamed API Plan');
    assert.equal(updated.body.data.ratePlan.minNights, 3);
    assert.equal(updated.body.data.ratePlan.updatedBy, 'ops-actor-1');

    const activated = await request(app)
      .post(`/api/admin/rate-plans/${created.body.data.ratePlan.id}/activate`)
      .set('Authorization', auth)
      .send({ expectedRevision: updated.body.data.ratePlan.revision });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.data.activationCommitted, true);
    assert.equal(activated.body.data.ratePlan.status, 'active');
    assert.equal(activated.body.data.ratePlan.activatedBy, 'ops-actor-1');
    assert.equal(typeof activated.body.data.lockReleased, 'boolean');
    assert.ok(Array.isArray(activated.body.data.operationalWarnings));

    const cloned = await request(app)
      .post(`/api/admin/rate-plans/${created.body.data.ratePlan.id}/clone`)
      .set('Authorization', auth)
      .send({});
    assert.equal(cloned.status, 201);
    assert.equal(cloned.body.data.ratePlan.version, 2);
    assert.equal(cloned.body.data.ratePlan.status, 'draft');
    assert.equal(cloned.body.data.ratePlan.createdBy, 'ops-actor-1');

    const retired = await request(app)
      .post(`/api/admin/rate-plans/${created.body.data.ratePlan.id}/retire`)
      .set('Authorization', auth)
      .send({ expectedRevision: activated.body.data.ratePlan.revision });
    assert.equal(retired.status, 200);
    assert.equal(retired.body.data.ratePlan.status, 'retired');
    assert.equal(retired.body.data.ratePlan.retiredBy, 'ops-actor-1');
  });

  it('derives actor from authenticated principal only', async () => {
    let seenOperator = null;
    const stub = {
      ...mgmt,
      createRatePlanDraft: async (input, opts) => {
        seenOperator = opts && opts.operatorId;
        return {
          id: '000000000000000000000001',
          revision: 0,
          status: 'draft',
          createdBy: opts.operatorId,
          updatedBy: opts.operatorId,
          code: input.code,
          version: 1
        };
      }
    };
    const app = buildStubApp(stub);
    const res = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'principal-42' })}`)
      .send(baseSeasonal({ code: 'actor-check' }));
    assert.equal(res.status, 201);
    assert.equal(seenOperator, 'principal-42');
    assert.equal(res.body.data.ratePlan.createdBy, 'principal-42');
  });

  it('rejects actor/lifecycle injection and unknown fields', async () => {
    const app = buildFullAdminApp();
    const auth = `Bearer ${tokenFor({ sub: 'inject-test' })}`;
    const payload = {
      ...baseSeasonal({ code: 'inject-plan' }),
      status: 'active',
      createdBy: 'attacker',
      activatedBy: 'attacker',
      ownerToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    };
    const res = await request(app).post('/api/admin/rate-plans').set('Authorization', auth).send(payload);
    assert.equal(res.status, 400);
    assert.match(res.body.message, /Forbidden fields/);
    assertNoLeakage(res.body);

    const unknown = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send({ ...baseSeasonal({ code: 'unknown-field-plan' }), surprise: true });
    assert.equal(unknown.status, 400);
    assert.match(unknown.body.message, /Unknown fields/);
  });

  it('requires expectedRevision for update, activate, and retire', async () => {
    const app = buildFullAdminApp();
    const auth = `Bearer ${tokenFor({ sub: 'rev-req' })}`;
    const created = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'rev-plan' }));
    const id = created.body.data.ratePlan.id;

    const patch = await request(app)
      .patch(`/api/admin/rate-plans/${id}`)
      .set('Authorization', auth)
      .send({ internalName: 'x' });
    assert.equal(patch.status, 400);
    assert.match(patch.body.message, /expectedRevision/);

    const activate = await request(app)
      .post(`/api/admin/rate-plans/${id}/activate`)
      .set('Authorization', auth)
      .send({});
    assert.equal(activate.status, 400);

    const retire = await request(app)
      .post(`/api/admin/rate-plans/${id}/retire`)
      .set('Authorization', auth)
      .send({});
    assert.equal(retire.status, 400);
  });

  it('maps every MANAGEMENT_ERROR_CODE exhaustively and returns safe payloads', async () => {
    const statusByCode = buildHttpStatusByManagementCode(MANAGEMENT_ERROR_CODES);
    for (const code of Object.values(MANAGEMENT_ERROR_CODES)) {
      assert.ok(statusByCode[code] != null, `missing map for ${code}`);
    }

    const cases = [
      ['VALIDATION_FAILED', 400],
      ['NOT_FOUND', 404],
      ['STALE_REVISION', 409],
      ['DUPLICATE_VERSION', 409],
      ['SEASONAL_OVERLAP', 409],
      ['ACTIVATION_BUSY', 409],
      ['INVALID_STATUS_TRANSITION', 409],
      ['IMMUTABLE_PLAN', 409],
      ['ACTIVATION_LOCK_UNCERTAIN', 503]
    ];

    for (const [code, status] of cases) {
      const stub = {
        ...mgmt,
        RatePlanManagementError,
        MANAGEMENT_ERROR_CODES,
        listRatePlans: async () => {
          throw new RatePlanManagementError(code, `typed-${code}`, {
            lockId: 'seasonal-rateplan-activation',
            ownerToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            stack: 'secret-stack'
          });
        }
      };
      const app = buildStubApp(stub);
      const res = await request(app)
        .get('/api/admin/rate-plans')
        .set('Authorization', `Bearer ${tokenFor({ sub: `map-${code}` })}`);
      assert.equal(res.status, status, code);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, code);
      assertNoLeakage(res.body);
      if (res.body.details) {
        assert.equal(Object.prototype.hasOwnProperty.call(res.body.details, 'ownerToken'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(res.body.details, 'stack'), false);
      }
    }
  });

  it('committed activation with cleanup warning returns 200', async () => {
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      activateRatePlan: async () => ({
        id: '000000000000000000000099',
        revision: 2,
        status: 'active',
        code: 'warn-plan',
        version: 1,
        activatedBy: 'ops',
        activationCommitted: true,
        lockReleased: false,
        operationalWarnings: [{ code: 'ACTIVATION_LOCK_RELEASE_FAILED' }]
      })
    };
    const app = buildStubApp(stub);
    const res = await request(app)
      .post('/api/admin/rate-plans/000000000000000000000099/activate')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'warn-actor' })}`)
      .send({ expectedRevision: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.activationCommitted, true);
    assert.equal(res.body.data.lockReleased, false);
    assert.equal(res.body.data.operationalWarnings[0].code, 'ACTIVATION_LOCK_RELEASE_FAILED');
    assert.equal(res.body.data.ratePlan.status, 'active');
    assertNoLeakage(res.body);
  });

  it('safe 500 redaction for unknown errors', async () => {
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      listRatePlans: async () => {
        const err = new Error('RAW_DB_PASSWORD=supersecret stack at Object.fail');
        err.stack = 'Error: RAW\n    at Object.fail (/secret/path.js:1:1)';
        throw err;
      }
    };
    const app = buildStubApp(stub);
    const res = await request(app)
      .get('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'safe500' })}`);
    assert.equal(res.status, 500);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, 'Internal server error');
    assertNoLeakage(res.body);
    assert.equal(JSON.stringify(res.body).includes('supersecret'), false);
  });

  it('no DELETE route and no direct model writes from API layer', async () => {
    const app = buildFullAdminApp();
    const auth = `Bearer ${tokenFor({ sub: 'nodelete' })}`;
    const created = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'no-delete' }));
    const del = await request(app)
      .delete(`/api/admin/rate-plans/${created.body.data.ratePlan.id}`)
      .set('Authorization', auth);
    assert.equal(del.status, 405);
    assert.equal(del.body.code, 'HARD_DELETE_FORBIDDEN');

    const src = fs.readFileSync(
      path.join(__dirname, '../routes/adminRatePlanRoutes.js'),
      'utf8'
    );
    assert.equal(/RatePlan\.(create|updateOne|findByIdAndUpdate|deleteOne|deleteMany)/.test(src), false);
    assert.equal(/require\(['"]\.\.\/models\/RatePlan['"]\)/.test(src), false);
  });

  it('calls RP1 service exactly once with allowlisted arguments', async () => {
    let calls = 0;
    let seen = null;
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      createRatePlanDraft: async (input, opts) => {
        calls += 1;
        seen = { input, opts };
        return { id: '000000000000000000000010', revision: 0, status: 'draft', ...input, createdBy: opts.operatorId };
      }
    };
    const app = buildStubApp(stub);
    const body = baseSeasonal({ code: 'allow-once' });
    const res = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'once-actor' })}`)
      .send(body);
    assert.equal(res.status, 201);
    assert.equal(calls, 1);
    assert.equal(seen.opts.operatorId, 'once-actor');
    assert.equal(Object.prototype.hasOwnProperty.call(seen.input, 'createdBy'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(seen.input, 'status'), false);
    assert.equal(seen.input.code, 'allow-once');
  });

  it('query filter allowlist and bounded list behavior', async () => {
    const app = buildFullAdminApp();
    const auth = `Bearer ${tokenFor({ sub: 'filters' })}`;
    await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'filter-a' }));
    await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'filter-b' }));

    const bad = await request(app)
      .get('/api/admin/rate-plans')
      .query({ evil: '1' })
      .set('Authorization', auth);
    assert.equal(bad.status, 400);

    const limited = await request(app)
      .get('/api/admin/rate-plans')
      .query({ limit: 1 })
      .set('Authorization', auth);
    assert.equal(limited.status, 200);
    assert.equal(limited.body.data.ratePlans.length, 1);
    assert.equal(limited.body.data.truncated, true);

    const over = await request(app)
      .get('/api/admin/rate-plans')
      .query({ limit: 9999 })
      .set('Authorization', auth);
    assert.equal(over.status, 400);
  });

  it('rejects malformed JSON', async () => {
    const app = buildFullAdminApp();
    const res = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'badjson' })}`)
      .set('Content-Type', 'application/json')
      .send('{"code":');
    assert.ok(res.status === 400 || res.status === 500);
  });

  it('forbidden body key catalog covers lifecycle and lock tokens', () => {
    for (const key of [
      'createdBy',
      'updatedBy',
      'activatedBy',
      'retiredBy',
      'ownerToken',
      'status',
      'activationCommitted'
    ]) {
      assert.ok(FORBIDDEN_BODY_KEYS.includes(key), key);
    }
  });

  it('accepts only native nonnegative safe integer expectedRevision', async () => {
    const {
      parseExpectedRevision: parseRev
    } = require('../routes/adminRatePlanRoutes');

    for (const value of [0, 1, 2, 42, Number.MAX_SAFE_INTEGER]) {
      const parsed = parseRev({ expectedRevision: value }, { required: true });
      assert.equal(parsed.ok, true, String(value));
      assert.equal(parsed.value, value);
    }

    let seen = 0;
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      updateRatePlanDraft: async (_id, _patch, opts) => {
        seen += 1;
        return {
          id: '0000000000000000000000aa',
          revision: opts.expectedRevision + 1,
          status: 'draft',
          code: 'rev-ok'
        };
      }
    };
    const app = buildStubApp(stub);
    const auth = `Bearer ${tokenFor({ sub: 'rev-native' })}`;
    for (const value of [0, 1, 42]) {
      seen = 0;
      const res = await request(app)
        .patch('/api/admin/rate-plans/0000000000000000000000aa')
        .set('Authorization', auth)
        .send({ expectedRevision: value });
      assert.equal(res.status, 200, String(value));
      assert.equal(seen, 1);
      assert.equal(res.body.data.ratePlan.revision, value + 1);
    }
  });

  it('rejects coerced and invalid expectedRevision with zero RP1 calls', async () => {
    const {
      parseExpectedRevision: parseRev
    } = require('../routes/adminRatePlanRoutes');

    // Direct parser probes for values JSON cannot round-trip faithfully.
    for (const value of [-0, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5, -1]) {
      const parsed = parseRev({ expectedRevision: value }, { required: true });
      assert.equal(parsed.ok, false, `direct ${String(value)}`);
    }
    assert.equal(parseRev({}, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: '1' }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: '1e2' }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: '01' }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: true }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: null }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: [] }, { required: true }).ok, false);
    assert.equal(parseRev({ expectedRevision: {} }, { required: true }).ok, false);

    let calls = 0;
    const bump = async () => {
      calls += 1;
      throw new Error('RP1 must not be called');
    };
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      updateRatePlanDraft: bump,
      activateRatePlan: bump,
      retireRatePlan: bump
    };
    const app = buildStubApp(stub);
    const auth = `Bearer ${tokenFor({ sub: 'rev-bad' })}`;
    const id = '0000000000000000000000bb';

    // JSON-representable invalid bodies over HTTP.
    const invalidBodies = [
      { expectedRevision: null },
      { expectedRevision: [] },
      { expectedRevision: {} },
      { expectedRevision: true },
      { expectedRevision: false },
      { expectedRevision: '1' },
      { expectedRevision: '01' },
      { expectedRevision: '1e2' },
      { expectedRevision: 1.5 },
      { expectedRevision: -1 },
      {}
    ];

    for (const body of invalidBodies) {
      calls = 0;
      const res = await request(app)
        .patch(`/api/admin/rate-plans/${id}`)
        .set('Authorization', auth)
        .send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(calls, 0, `calls ${JSON.stringify(body)}`);
    }

    for (const endpoint of ['activate', 'retire']) {
      for (const value of [null, '1', true, 1.5, -1]) {
        calls = 0;
        const res = await request(app)
          .post(`/api/admin/rate-plans/${id}/${endpoint}`)
          .set('Authorization', auth)
          .send({ expectedRevision: value });
        assert.equal(res.status, 400, `${endpoint} ${String(value)}`);
        assert.equal(calls, 0, `${endpoint} calls ${String(value)}`);
      }
    }
  });

  it('strips unknown and secret fields from every success response', async () => {
    const dirtyPlan = {
      id: '0000000000000000000000cc',
      revision: 3,
      code: 'safe-plan',
      internalName: 'Safe',
      version: 1,
      status: 'draft',
      type: 'seasonal_stay',
      currency: 'EUR',
      arrivalWindowStart: '2027-01-01',
      arrivalWindowEnd: '2027-01-10',
      bookingWindowStart: null,
      bookingWindowEnd: null,
      minNights: 2,
      packageArrivalDate: null,
      packageDepartureDate: null,
      inventoryMode: 'shared',
      requiresFullPayment: true,
      cancellationPolicyCode: 'normal-stay-standard',
      cancellationPolicyVersion: 1,
      inclusions: ['Firewood', { evil: true }],
      accommodations: [
        {
          accommodationKey: 'lux-cabin',
          entityType: 'cabin',
          pricingMethod: 'nightly_per_unit',
          nightlyPerUnitAmount: 180,
          ownerToken: 'NESTED_SECRET_TOKEN',
          password: 'nested-pw',
          surprise: true
        }
      ],
      createdBy: 'actor',
      updatedBy: 'actor',
      activatedAt: null,
      activatedBy: null,
      retiredAt: null,
      retiredBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ownerToken: 'ROOT_SECRET_TOKEN_SHOULD_NOT_LEAK',
      password: 'root-pw',
      __v: 99,
      mongodbUri: 'mongodb://user:pass@host/db',
      stack: 'Error: boom'
    };

    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      listRatePlans: async () => [{ ...dirtyPlan, status: 'draft' }, { ...dirtyPlan, id: '0000000000000000000000dd' }],
      createRatePlanDraft: async () => ({ ...dirtyPlan }),
      updateRatePlanDraft: async () => ({ ...dirtyPlan, revision: 4 }),
      cloneRatePlanAsNextDraftVersion: async () => ({ ...dirtyPlan, version: 2 }),
      activateRatePlan: async () => ({
        ...dirtyPlan,
        status: 'active',
        activationCommitted: true,
        lockReleased: false,
        operationalWarnings: [
          {
            code: 'ACTIVATION_LOCK_RELEASE_FAILED',
            message: 'cleanup',
            ownerToken: 'WARN_TOKEN',
            stack: 'warn-stack',
            secret: 'x'
          }
        ],
        ownerToken: 'ACTIVATE_ROOT_TOKEN'
      }),
      retireRatePlan: async () => ({ ...dirtyPlan, status: 'retired' })
    };
    const app = buildStubApp(stub);
    const auth = `Bearer ${tokenFor({ sub: 'strip-actor' })}`;
    const id = dirtyPlan.id;

    function assertStripped(payload) {
      assertNoLeakage(payload);
      const text = JSON.stringify(payload);
      assert.equal(text.includes('ROOT_SECRET'), false);
      assert.equal(text.includes('NESTED_SECRET'), false);
      assert.equal(text.includes('ACTIVATE_ROOT'), false);
      assert.equal(text.includes('WARN_TOKEN'), false);
      assert.equal(text.includes('mongodb://'), false);
      assert.equal(text.includes('root-pw'), false);
      assert.equal(text.includes('"surprise"'), false);
      assert.equal(text.includes('"__v"'), false);
      assert.equal(text.includes('"evil"'), false);
    }

    const listed = await request(app).get('/api/admin/rate-plans').set('Authorization', auth);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.ratePlans.length, 2);
    for (const plan of listed.body.data.ratePlans) {
      assert.equal(Object.prototype.hasOwnProperty.call(plan, 'ownerToken'), false);
      assert.equal(plan.accommodations[0].accommodationKey, 'lux-cabin');
      assert.equal(Object.prototype.hasOwnProperty.call(plan.accommodations[0], 'ownerToken'), false);
      assert.deepEqual(plan.inclusions, ['Firewood']);
    }
    assertStripped(listed.body);

    const created = await request(app)
      .post('/api/admin/rate-plans')
      .set('Authorization', auth)
      .send(baseSeasonal({ code: 'strip-create' }));
    assert.equal(created.status, 201);
    assertStripped(created.body);

    const updated = await request(app)
      .patch(`/api/admin/rate-plans/${id}`)
      .set('Authorization', auth)
      .send({ expectedRevision: 3 });
    assert.equal(updated.status, 200);
    assertStripped(updated.body);

    const cloned = await request(app)
      .post(`/api/admin/rate-plans/${id}/clone`)
      .set('Authorization', auth)
      .send({});
    assert.equal(cloned.status, 201);
    assertStripped(cloned.body);

    const activated = await request(app)
      .post(`/api/admin/rate-plans/${id}/activate`)
      .set('Authorization', auth)
      .send({ expectedRevision: 3 });
    assert.equal(activated.status, 200);
    assert.equal(activated.body.data.activationCommitted, true);
    assert.equal(activated.body.data.lockReleased, false);
    assert.equal(activated.body.data.operationalWarnings.length, 1);
    assert.deepEqual(activated.body.data.operationalWarnings[0], {
      code: 'ACTIVATION_LOCK_RELEASE_FAILED'
    });
    assert.equal(Object.prototype.hasOwnProperty.call(activated.body.data.ratePlan, 'ownerToken'), false);
    assert.equal(JSON.stringify(activated.body).includes('"message"'), false);
    assertStripped(activated.body);

    const retired = await request(app)
      .post(`/api/admin/rate-plans/${id}/retire`)
      .set('Authorization', auth)
      .send({ expectedRevision: 3 });
    assert.equal(retired.status, 200);
    assertStripped(retired.body);
  });

  it('activation committed metadata and safe warning survive sanitization as HTTP 200', async () => {
    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      activateRatePlan: async () => ({
        id: '000000000000000000000099',
        revision: 2,
        status: 'active',
        code: 'warn-plan',
        version: 1,
        type: 'seasonal_stay',
        currency: 'EUR',
        activatedBy: 'ops',
        ownerToken: 'SHOULD_NEVER_APPEAR',
        activationCommitted: true,
        lockReleased: false,
        operationalWarnings: [
          {
            code: 'ACTIVATION_LOCK_RELEASE_FAILED',
            ownerToken: 'x',
            stack: 'y',
            extra: 'z'
          }
        ]
      })
    };
    const app = buildStubApp(stub);
    const res = await request(app)
      .post('/api/admin/rate-plans/000000000000000000000099/activate')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'warn-actor-2' })}`)
      .send({ expectedRevision: 1 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.activationCommitted, true);
    assert.equal(res.body.data.lockReleased, false);
    assert.deepEqual(res.body.data.operationalWarnings, [
      { code: 'ACTIVATION_LOCK_RELEASE_FAILED' }
    ]);
    assert.equal(res.body.data.ratePlan.status, 'active');
    assertNoLeakage(res.body);
    assert.equal(JSON.stringify(res.body).includes('SHOULD_NEVER'), false);
  });

  it('operational warnings are code-only; secret message and unknown codes never reach HTTP', async () => {
    const {
      serializeOperationalWarning,
      serializeActivationResult,
      ALLOWED_OPERATIONAL_WARNING_CODE
    } = require('../routes/adminRatePlanRoutes');

    assert.equal(ALLOWED_OPERATIONAL_WARNING_CODE, 'ACTIVATION_LOCK_RELEASE_FAILED');
    assert.deepEqual(
      serializeOperationalWarning({
        code: 'ACTIVATION_LOCK_RELEASE_FAILED',
        message: 'ownerToken=SECRET mongodb://user:pass@host'
      }),
      { code: 'ACTIVATION_LOCK_RELEASE_FAILED' }
    );
    assert.equal(serializeOperationalWarning({ code: 'OTHER_CODE' }), null);
    assert.equal(serializeOperationalWarning(null), null);
    assert.equal(serializeOperationalWarning('ACTIVATION_LOCK_RELEASE_FAILED'), null);
    assert.equal(serializeOperationalWarning([]), null);
    assert.equal(serializeOperationalWarning({ message: 'only' }), null);

    const stub = {
      ...mgmt,
      RatePlanManagementError,
      MANAGEMENT_ERROR_CODES,
      activateRatePlan: async () => ({
        id: '000000000000000000000098',
        revision: 5,
        status: 'active',
        code: 'c2-warn',
        version: 1,
        type: 'seasonal_stay',
        currency: 'EUR',
        activationCommitted: true,
        lockReleased: false,
        operationalWarnings: [
          {
            code: 'ACTIVATION_LOCK_RELEASE_FAILED',
            message:
              'cleanup failed ownerToken=SECRETTOKEN mongodb://user:pass@host/db stack at Object.fail password=hunter2',
            stack: 'Error: boom\n at secret.js:1',
            ownerToken: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            mongodbUri: 'mongodb://user:pass@host/db',
            password: 'hunter2',
            lockCleanupRequired: true,
            extra: 'drop-me'
          },
          { code: 'UNKNOWN_WARNING', message: 'should-drop' },
          null,
          'ACTIVATION_LOCK_RELEASE_FAILED',
          42,
          { code: 'ACTIVATION_LOCK_RELEASE_FAILED', message: 'second-secret mongodb://x', stack: 's2' },
          { notCode: true }
        ]
      })
    };
    const app = buildStubApp(stub);
    const res = await request(app)
      .post('/api/admin/rate-plans/000000000000000000000098/activate')
      .set('Authorization', `Bearer ${tokenFor({ sub: 'c2-warn-actor' })}`)
      .send({ expectedRevision: 4 });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.activationCommitted, true);
    assert.equal(res.body.data.lockReleased, false);
    assert.equal(typeof res.body.data.activationCommitted, 'boolean');
    assert.equal(typeof res.body.data.lockReleased, 'boolean');
    assert.deepEqual(res.body.data.operationalWarnings, [
      { code: 'ACTIVATION_LOCK_RELEASE_FAILED' },
      { code: 'ACTIVATION_LOCK_RELEASE_FAILED' }
    ]);
    for (const warning of res.body.data.operationalWarnings) {
      assert.deepEqual(Object.keys(warning), ['code']);
      assert.equal(warning.code, 'ACTIVATION_LOCK_RELEASE_FAILED');
    }

    const text = JSON.stringify(res.body);
    assert.equal(text.includes('SECRETTOKEN'), false);
    assert.equal(text.includes('mongodb://'), false);
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes('secret.js'), false);
    assert.equal(text.includes('UNKNOWN_WARNING'), false);
    assert.equal(text.includes('should-drop'), false);
    assert.equal(text.includes('second-secret'), false);
    assert.equal(text.includes('"message"'), false);
    assert.equal(text.includes('"stack"'), false);
    assert.equal(text.includes('"ownerToken"'), false);
    assert.equal(text.includes('"lockCleanupRequired"'), false);
    assert.equal(text.includes('"extra"'), false);
    assertNoLeakage(res.body);

    const direct = serializeActivationResult({
      id: '1',
      status: 'active',
      code: 'x',
      version: 1,
      type: 'seasonal_stay',
      currency: 'EUR',
      activationCommitted: true,
      lockReleased: false,
      operationalWarnings: [
        {
          code: 'ACTIVATION_LOCK_RELEASE_FAILED',
          message: 'leaky'
        }
      ]
    });
    assert.deepEqual(direct.operationalWarnings, [{ code: 'ACTIVATION_LOCK_RELEASE_FAILED' }]);
    assert.equal(JSON.stringify(direct).includes('leaky'), false);
  });
});
