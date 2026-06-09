/**
 * Batch C2 — OPS admin write path for cleaner contact + propertyKind assignment.
 * Run: npm run test:ops-user-cleaner-contact-write (from server/)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const OpsUser = require('../models/OpsUser');
const { createOpsUser, updateOpsUser } = require('../services/ops/opsUserService');

let mongoServer;
let app;

async function login(username, password) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  assert.equal(res.status, 200, `login failed for ${username}: ${res.body?.message}`);
  return res.body.token;
}

async function authed(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) {
    return req.send(body);
  }
  return req;
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'batch-c2-cleaner-contact-write';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('C2 cleaner contact write path', async (t) => {
  await OpsUser.deleteMany({});
  let cleanerId;

  await t.test('admin creates cleaner with phone, locale, propertyKinds — persisted normalized', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const res = await authed('post', '/api/ops/users', adminToken, {
      email: 'c2.cleaner@test.com',
      name: 'C2 Cleaner',
      password: 'cleaner-pass-123',
      role: 'cleaner',
      phone: '088 123 4567',
      locale: 'en',
      propertyKinds: ['cabin', 'valley', 'cabin']
    });
    assert.equal(res.status, 201, res.body?.message);
    assert.match(res.body.data.phone, /^\+359/);
    assert.equal(res.body.data.locale, 'en');
    assert.deepEqual(res.body.data.propertyKinds, ['cabin', 'valley']);
    cleanerId = res.body.data.id;

    const stored = await OpsUser.findById(cleanerId).lean();
    assert.match(stored.phone, /^\+359/);
    assert.equal(stored.locale, 'en');
    assert.deepEqual(stored.propertyKinds, ['cabin', 'valley']);
  });

  await t.test('service updateOpsUser normalizes phone before save (write-path guard)', async () => {
    const updated = await updateOpsUser(cleanerId, { phone: '088 765 4321' });
    assert.match(updated.phone, /^\+359/);

    const stored = await OpsUser.findById(cleanerId).lean();
    assert.match(stored.phone, /^\+359/);
    assert.notEqual(stored.phone, '088 765 4321');
  });

  await t.test('role change away from cleaner clears propertyKinds on save', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const res = await authed('patch', `/api/ops/users/${cleanerId}`, adminToken, {
      role: 'operator',
      modules: ['cleaning']
    });
    assert.equal(res.status, 200, res.body?.message);
    assert.deepEqual(res.body.data.propertyKinds, []);

    const stored = await OpsUser.findById(cleanerId).lean();
    assert.equal(stored.role, 'operator');
    assert.deepEqual(stored.propertyKinds, []);
  });

  await t.test('non-cleaner cannot set propertyKinds via route', async () => {
    await OpsUser.deleteMany({});
    const adminToken = await login('admin', 'securepassword123');
    const created = await authed('post', '/api/ops/users', adminToken, {
      email: 'c2.operator@test.com',
      name: 'C2 Operator',
      password: 'operator-pass-123',
      role: 'operator'
    });
    assert.equal(created.status, 201);
    const operatorId = created.body.data.id;

    const rejectCreate = await authed('post', '/api/ops/users', adminToken, {
      email: 'c2.admin-kinds@test.com',
      name: 'C2 Admin Kinds',
      password: 'admin-pass-1234',
      role: 'admin',
      propertyKinds: ['cabin']
    });
    assert.equal(rejectCreate.status, 400);
    assert.match(rejectCreate.body.message, /only configurable for cleaner/i);

    const rejectPatch = await authed('patch', `/api/ops/users/${operatorId}`, adminToken, {
      propertyKinds: ['valley']
    });
    assert.equal(rejectPatch.status, 400);
    assert.match(rejectPatch.body.message, /only configurable for cleaner/i);

    const stored = await OpsUser.findById(operatorId).lean();
    assert.deepEqual(stored.propertyKinds, []);
  });

  await t.test('non-admin rejected on cleaner contact update', async () => {
    await OpsUser.deleteMany({});
    const cleaner = await createOpsUser({
      email: 'c2.perm@test.com',
      name: 'Perm Cleaner',
      password: 'cleaner-pass-123',
      role: 'cleaner'
    });
    const operatorToken = await login('operator', 'operatorpassword123');
    const res = await authed('patch', `/api/ops/users/${cleaner.id}`, operatorToken, {
      phone: '+359881111111'
    });
    assert.equal(res.status, 403);
  });

  await t.test('invalid phone rejected with clear error', async () => {
    await OpsUser.deleteMany({});
    const adminToken = await login('admin', 'securepassword123');
    const cleaner = await createOpsUser({
      email: 'c2.invalid@test.com',
      name: 'Invalid Phone',
      password: 'cleaner-pass-123',
      role: 'cleaner'
    });
    const res = await authed('patch', `/api/ops/users/${cleaner.id}`, adminToken, {
      phone: 'not-a-phone'
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /E\.164/i);
  });
});
