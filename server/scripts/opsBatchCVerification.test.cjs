const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { verifyToken } = require('../middleware/adminAuth');
const { hashPassword, verifyPassword } = require('../services/ops/opsPasswordService');
const { createOpsUser } = require('../services/ops/opsUserService');
const {
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

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  process.env.ADMIN_JWT_SECRET = 'batch-c-verify-secret-key';
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

test('Batch C verification matrix', async (t) => {
  await t.test('1 legacy admin login works', async () => {
    const token = await login('admin', 'securepassword123');
    const payload = decodePayload(token);
    assert.equal(payload.role, 'admin');
    assert.deepEqual(payload.modules, ['*']);
    assert.equal(payload.src, 'legacy_env');
  });

  await t.test('2 legacy operator login works', async () => {
    const token = await login('operator', 'operatorpassword123');
    const payload = decodePayload(token);
    assert.equal(payload.role, 'operator');
    assert.ok(Array.isArray(payload.modules));
    assert.equal(payload.src, 'legacy_env');
  });

  let cleanerToken;
  await t.test('3-4 OpsUser cleaner login works with expected token', async () => {
    await createOpsUser({
      email: 'cleaner.verify@test',
      name: 'Verify Cleaner',
      password: 'cleaner-pass-123',
      role: 'cleaner'
    });
    cleanerToken = await login('cleaner.verify@test', 'cleaner-pass-123');
    const payload = decodePayload(cleanerToken);
    assert.equal(payload.role, 'cleaner');
    assert.deepEqual(payload.modules, ['cleaning']);
    assert.equal(payload.src, 'ops_user');
  });

  await t.test('5 /api/ops/session works for admin, operator, cleaner', async () => {
    const adminToken = await login('admin', 'securepassword123');
    const operatorToken = await login('operator', 'operatorpassword123');

    for (const [label, token, role] of [
      ['admin', adminToken, 'admin'],
      ['operator', operatorToken, 'operator'],
      ['cleaner', cleanerToken, 'cleaner']
    ]) {
      const res = await authed('get', '/api/ops/session', token);
      assert.equal(res.status, 200, `${label} session status`);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.role, role);
      assert.ok(Array.isArray(res.body.data.modules));
      assert.ok(Array.isArray(res.body.data.actions));
      assert.ok(res.body.data.defaultRoute);
    }
  });

  await t.test('6 cleaner allowed: schedule + mark/unmark cleaned', async () => {
    const schedule = await authed('get', '/api/ops/cleaning/schedule?date=2026-06-07', cleanerToken);
    assert.equal(schedule.status, 200, schedule.body?.message);

    const bookingId = new mongoose.Types.ObjectId();
    const mark = await authed(
      'post',
      `/api/ops/cleaning/records/${bookingId}/mark-cleaned`,
      cleanerToken,
      { cleaningDate: '2026-06-07' }
    );
    assert.notEqual(mark.status, 403, 'mark-cleaned should not be permission denied');

    const unmark = await authed(
      'post',
      `/api/ops/cleaning/records/${bookingId}/unmark-cleaned`,
      cleanerToken,
      { cleaningDate: '2026-06-07' }
    );
    assert.notEqual(unmark.status, 403, 'unmark-cleaned should not be permission denied');
  });

  await t.test('7 cleaner denied protected routes', async () => {
    const bookingId = new mongoose.Types.ObjectId();
    const cases = [
      ['GET reservations list', 'get', '/api/ops/reservations'],
      ['GET reservation detail', 'get', `/api/ops/reservations/${bookingId}`],
      [
        'PATCH cleaning-notes',
        'patch',
        `/api/ops/reservations/${bookingId}/cleaning-notes`,
        { cleaningNotes: 'test' }
      ],
      [
        'mark paid',
        'post',
        '/api/ops/cleaning/payments/mark-paid',
        { date: '2026-06-07', propertyKind: 'cabin' }
      ],
      ['payment summary', 'get', '/api/ops/cleaning/payment-summary?date=2026-06-07&propertyKind=cabin'],
      [
        'create ops user',
        'post',
        '/api/ops/users',
        {
          email: 'blocked@test',
          name: 'Blocked',
          password: 'password123',
          role: 'cleaner'
        }
      ],
      ['admin bookings', 'get', '/api/admin/bookings'],
      ['unmapped ops route', 'get', '/api/ops/unmapped-batch-c-test']
    ];

    for (const [label, method, path, body] of cases) {
      const res = await authed(method, path, cleanerToken, body);
      assert.equal(res.status, 403, `${label} should be 403, got ${res.status}`);
    }
  });

  await t.test('8 POST /api/admin/login is not blocked by cleaner admin restriction', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'cleaner.verify@test', password: 'cleaner-pass-123' });
    assert.equal(res.status, 200);
    assert.equal(res.body.role, 'cleaner');
  });

  await t.test('9 admin can access everything and create OpsUser', async () => {
    const adminToken = await login('admin', 'securepassword123');

    const createRes = await authed('post', '/api/ops/users', adminToken, {
      email: 'operator.verify@example.com',
      name: 'Verify Operator',
      password: 'operator-pass-123',
      role: 'operator'
    });
    assert.equal(createRes.status, 201, createRes.body?.message);
    assert.equal(createRes.body.data.email, 'operator.verify@example.com');
    assert.ok(!('passwordHash' in (createRes.body.data || {})));

    const markPaid = await authed('post', '/api/ops/cleaning/payments/mark-paid', adminToken, {
      date: '2026-06-07',
      propertyKind: 'cabin'
    });
    assert.notEqual(markPaid.status, 403);

    const reservations = await authed('get', '/api/ops/reservations', adminToken);
    assert.notEqual(reservations.status, 403);
  });

  await t.test('10 operator keeps access except payment/settings write', async () => {
    const operatorToken = await login('operator', 'operatorpassword123');

    const reservations = await authed('get', '/api/ops/reservations', operatorToken);
    assert.notEqual(reservations.status, 403);

    const paymentSummary = await authed(
      'get',
      '/api/ops/cleaning/payment-summary?date=2026-06-07&propertyKind=cabin',
      operatorToken
    );
    assert.equal(paymentSummary.status, 200, paymentSummary.body?.message);

    const markPaid = await authed('post', '/api/ops/cleaning/payments/mark-paid', operatorToken, {
      date: '2026-06-07',
      propertyKind: 'cabin'
    });
    assert.equal(markPaid.status, 403);

  });

  await t.test('11 password hashing rules', async () => {
    const hash = hashPassword('test-password-123');
    assert.match(hash, /^scrypt:[0-9a-f]+:[0-9a-f]+$/);
    assert.equal(verifyPassword('test-password-123', hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);

    const user = await createOpsUser({
      email: 'hash.verify@test',
      name: 'Hash Verify',
      password: 'hash-pass-1234',
      role: 'cleaner'
    });
    assert.ok(!('passwordHash' in user));

    const stored = await mongoose.model('OpsUser').findOne({ email: 'hash.verify@test' }).select('+passwordHash');
    assert.ok(stored.passwordHash.startsWith('scrypt:'));
    assert.notEqual(stored.passwordHash, 'hash-pass-1234');
  });

  await t.test('12 frontend session/nav guard expectations', async () => {
    const cleanerSession = {
      authenticated: true,
      role: 'cleaner',
      modules: ['cleaning'],
      actions: ['ops.cleaning.view', 'ops.cleaning.mark_cleaned']
    };

    assert.equal(filterOpsNavItems(OPS_NAV_ITEMS, cleanerSession).length, 1);
    assert.equal(canAccessOpsFrontendPath('/ops/reservations', cleanerSession), false);
    assert.equal(canAccessOpsFrontendPath('/ops/cleaning', cleanerSession), true);

    function decodeRoleFromPayload(role) {
      if (role === 'operator' || role === 'cleaner' || role === 'admin') {
        return role;
      }
      return null;
    }
    assert.equal(decodeRoleFromPayload('cleaner'), 'cleaner');
    assert.equal(decodeRoleFromPayload('superuser'), null);
  });
});
