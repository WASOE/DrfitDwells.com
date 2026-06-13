const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { verifyToken } = require('../middleware/adminAuth');
const { createOpsUser } = require('../services/ops/opsUserService');
const OpsPushSubscription = require('../models/OpsPushSubscription');
const {
  canAccessNavItem,
  canAccessOpsFrontendPath,
  filterOpsNavItems,
  OPS_NAV_ITEMS
} = require('../../client/src/layouts/ops/opsNavConfig.js');

let mongoServer;
let app;

function decodePayload(token) {
  const secret = process.env.ADMIN_JWT_SECRET || require('../config/defaults').adminJwtSecret;
  return verifyToken(token, secret);
}

async function login(username, password) {
  const res = await request(app).post('/api/admin/login').send({ username, password });
  assert.equal(res.status, 200, `login failed for ${username}: ${res.body?.message}`);
  assert.ok(res.body.token, 'token missing');
  return res.body.token;
}

async function authed(method, path, token, body) {
  const req = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  if (body !== undefined) {
    return req.send(body);
  }
  return req;
}

function assertNoPasswordHash(body) {
  const json = JSON.stringify(body);
  assert.equal(json.includes('passwordHash'), false, 'passwordHash leaked in response');
  assert.equal(json.includes('"password"'), false, 'password field leaked in response');
}

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'batch-d-users-test-secret';
  await mongoose.connect(mongoServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  await OpsPushSubscription.syncIndexes();

  delete require.cache[require.resolve('../routes/adminRoutes')];
  delete require.cache[require.resolve('../routes/ops/index')];
  delete require.cache[require.resolve('../middleware/adminAuth')];

  app = express();
  app.use(express.json());
  app.use('/api/admin', require('../routes/adminRoutes'));
  app.use('/api/ops', require('../routes/ops/index'));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('Batch D OPS users routes', async (t) => {
  let cleanerId;
  let cleanerToken;

  await t.test('admin can list users', async () => {
    await createOpsUser({
      email: 'cleaner.batchd@test.com',
      name: 'Batch D Cleaner',
      password: 'cleaner-pass-123',
      role: 'cleaner'
    });

    const adminToken = await login('admin', 'securepassword123');
    const res = await authed('get', '/api/ops/users', adminToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data.users));
    assert.ok(res.body.data.users.length >= 1);
    assertNoPasswordHash(res.body);
    const cleanerRow = res.body.data.users.find((u) => u.email === 'cleaner.batchd@test.com');
    assert.ok(cleanerRow);
    assert.ok(cleanerRow.pushHealth);
    assert.equal(typeof cleanerRow.pushHealth.activeCount, 'number');
    assert.equal(typeof cleanerRow.pushHealth.invalidatedCount, 'number');
    assert.equal(cleanerRow.pushHealth.lastSuccessAt, null);
    assert.equal(cleanerRow.pushHealth.latestUserAgent, null);
    const usersJson = JSON.stringify(res.body);
    assert.equal(usersJson.includes('endpoint'), false);
    assert.equal(usersJson.includes('p256dh'), false);
    cleanerId = cleanerRow.id;
    assert.ok(cleanerId);
  });

  await t.test('admin users list includes pushHealth aggregates', async () => {
    await createOpsUser({
      email: 'admin.pushhealth@test.com',
      name: 'Admin Push Health',
      password: 'admin-pass-123',
      role: 'admin'
    });

    const adminToken = await login('admin', 'securepassword123');
    const adminUser = (await authed('get', '/api/ops/users', adminToken)).body.data.users.find(
      (u) => u.email === 'admin.pushhealth@test.com'
    );
    assert.ok(adminUser?.id);

    await OpsPushSubscription.create({
      opsUserId: adminUser.id,
      endpoint: 'https://push.batchd.test/active',
      keys: { p256dh: 'k1', auth: 'a1' },
      userAgent: 'BatchD/1.0',
      lastSuccessAt: new Date('2026-06-01T12:00:00.000Z')
    });
    await OpsPushSubscription.create({
      opsUserId: adminUser.id,
      endpoint: 'https://push.batchd.test/expired',
      keys: { p256dh: 'k2', auth: 'a2' },
      invalidatedAt: new Date('2026-05-01T12:00:00.000Z')
    });

    const res = await authed('get', '/api/ops/users', adminToken);
    const row = res.body.data.users.find((u) => u.id === adminUser.id);
    assert.equal(row.pushHealth.activeCount, 1);
    assert.equal(row.pushHealth.invalidatedCount, 1);
    assert.ok(row.pushHealth.lastSuccessAt);
    assert.equal(row.pushHealth.latestUserAgent, 'BatchD/1.0');
  });

  await t.test('admin can create user', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const res = await authed('post', '/api/ops/users', adminToken, {
      email: 'operator.batchd@test.com',
      name: 'Batch D Operator',
      password: 'operator-pass-123',
      role: 'operator'
    });
    assert.equal(res.status, 201, res.body?.message);
    assert.equal(res.body.data.email, 'operator.batchd@test.com');
    assert.equal(res.body.data.role, 'operator');
    assert.equal(res.body.data.isActive, true);
    assertNoPasswordHash(res.body);
  });

  await t.test('admin can update role/modules/isActive', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const res = await authed('patch', `/api/ops/users/${cleanerId}`, adminToken, {
      name: 'Updated Cleaner Name',
      modules: ['cleaning']
    });
    assert.equal(res.status, 200, res.body?.message);
    assert.equal(res.body.data.name, 'Updated Cleaner Name');
    assert.deepEqual(res.body.data.modules, ['cleaning']);
    assertNoPasswordHash(res.body);
  });

  await t.test('admin can reset password and old token is rejected', async () => {
    cleanerToken = await login('cleaner.batchd@test.com', 'cleaner-pass-123');
    const sessionBefore = await authed('get', '/api/ops/session', cleanerToken);
    assert.equal(sessionBefore.status, 200);

    const adminToken = await login('admin', 'securepassword123');
    const reset = await authed('post', `/api/ops/users/${cleanerId}/password`, adminToken, {
      password: 'new-cleaner-pass-99'
    });
    assert.equal(reset.status, 200, reset.body?.message);
    assertNoPasswordHash(reset.body);

    const oldTokenSession = await authed('get', '/api/ops/session', cleanerToken);
    assert.equal(oldTokenSession.status, 401);

    const newToken = await login('cleaner.batchd@test.com', 'new-cleaner-pass-99');
    const sessionAfter = await authed('get', '/api/ops/session', newToken);
    assert.equal(sessionAfter.status, 200);
    cleanerToken = newToken;
  });

  await t.test('deactivate bumps tokenVersion and rejects token', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const deactivate = await authed('patch', `/api/ops/users/${cleanerId}`, adminToken, {
      isActive: false
    });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.isActive, false);

    const session = await authed('get', '/api/ops/session', cleanerToken);
    assert.equal(session.status, 401);

    const loginAttempt = await request(app)
      .post('/api/admin/login')
      .send({ username: 'cleaner.batchd@test.com', password: 'new-cleaner-pass-99' });
    assert.equal(loginAttempt.status, 401);
  });

  await t.test('operator and cleaner get 403 on all users endpoints', async () => {
    const operatorToken = await login('operator', 'operatorpassword123');
    await createOpsUser({
      email: 'cleaner403.batchd@test.com',
      name: 'Cleaner 403',
      password: 'cleaner-pass-123',
      role: 'cleaner'
    });
    const cleaner403Token = await login('cleaner403.batchd@test.com', 'cleaner-pass-123');
    const adminToken = await login('admin', 'securepassword123');
    const list = await authed('get', '/api/ops/users', adminToken);
    const targetId = list.body.data.users[0].id;

    for (const [label, token] of [
      ['operator GET', operatorToken],
      ['cleaner GET', cleaner403Token]
    ]) {
      const res = await authed('get', '/api/ops/users', token);
      assert.equal(res.status, 403, label);
    }

    for (const [label, token] of [
      ['operator POST', operatorToken],
      ['cleaner POST', cleaner403Token]
    ]) {
      const res = await authed('post', '/api/ops/users', token, {
        email: 'blocked.batchd@test.com',
        name: 'Blocked',
        password: 'password1234',
        role: 'cleaner'
      });
      assert.equal(res.status, 403, label);
    }

    for (const [label, token] of [
      ['operator PATCH', operatorToken],
      ['cleaner PATCH', cleaner403Token]
    ]) {
      const res = await authed('patch', `/api/ops/users/${targetId}`, token, { name: 'Nope' });
      assert.equal(res.status, 403, label);
    }

    for (const [label, token] of [
      ['operator password', operatorToken],
      ['cleaner password', cleaner403Token]
    ]) {
      const res = await authed('post', `/api/ops/users/${targetId}/password`, token, {
        password: 'another-pass-99'
      });
      assert.equal(res.status, 403, label);
    }
  });

  await t.test('nav shows Users for admin only and route guard blocks others', async () => {
    const usersNavItem = OPS_NAV_ITEMS.find((item) => item.to === '/ops/users');
    assert.ok(usersNavItem);

    const adminSession = {
      authenticated: true,
      role: 'admin',
      modules: ['*'],
      actions: ['ops.users.manage']
    };
    const operatorSession = {
      authenticated: true,
      role: 'operator',
      modules: ['dashboard', 'calendar', 'reservations', 'finance', 'property', 'guests_comms', 'operations', 'cleaning'],
      actions: []
    };
    const cleanerSession = {
      authenticated: true,
      role: 'cleaner',
      modules: ['cleaning'],
      actions: ['ops.cleaning.view', 'ops.cleaning.mark_cleaned']
    };

    assert.equal(canAccessNavItem(usersNavItem, adminSession), true);
    assert.equal(canAccessNavItem(usersNavItem, operatorSession), false);
    assert.equal(canAccessNavItem(usersNavItem, cleanerSession), false);
    assert.ok(filterOpsNavItems(OPS_NAV_ITEMS, adminSession).some((item) => item.to === '/ops/users'));
    assert.equal(
      filterOpsNavItems(OPS_NAV_ITEMS, operatorSession).some((item) => item.to === '/ops/users'),
      false
    );

    assert.equal(canAccessOpsFrontendPath('/ops/users', adminSession), true);
    assert.equal(canAccessOpsFrontendPath('/ops/users', operatorSession), false);
    assert.equal(canAccessOpsFrontendPath('/ops/users', cleanerSession), false);
  });
});
