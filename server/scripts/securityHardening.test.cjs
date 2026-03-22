/**
 * Focused checks for audit hardening (run: npm run test:security from server/).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const { requireOpsAdminRole } = require('../middleware/requireOpsAdminRole');
const { escapeRegex } = require('../utils/escapeRegex');
const {
  assertExclusiveCalendarRangeWithinMax,
  MAX_CALENDAR_EXCLUSIVE_DAY_SPAN
} = require('../utils/calendarExclusiveRangeGuard');
const { validateProductionEnv } = require('../config/validateProductionEnv');

describe('requireOpsAdminRole', () => {
  test('allows role admin', () => {
    const req = { user: { role: 'admin' } };
    const res = {
      status(code) {
        assert.fail(`should not set status ${code}`);
      },
      json() {
        assert.fail('should not json');
      }
    };
    let nexted = false;
    requireOpsAdminRole(req, res, () => {
      nexted = true;
    });
    assert.strictEqual(nexted, true);
  });

  test('blocks operator with 403', () => {
    let statusCode;
    const req = { user: { role: 'operator' } };
    const res = {
      status(c) {
        statusCode = c;
        return res;
      },
      json() {}
    };
    requireOpsAdminRole(req, res, () => assert.fail('next should not run'));
    assert.strictEqual(statusCode, 403);
  });
});

describe('escapeRegex', () => {
  test('escapes metacharacters for literal match', () => {
    assert.strictEqual(escapeRegex('a+b'), 'a\\+b');
    assert.strictEqual(escapeRegex('(test)'), '\\(test\\)');
  });
});

describe('calendar range guard', () => {
  test('allows span within max', () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2025-02-01T00:00:00.000Z');
    assertExclusiveCalendarRangeWithinMax(start, end);
  });

  test('rejects span above max', () => {
    const start = new Date('2025-01-01T00:00:00.000Z');
    const end = new Date('2027-06-01T00:00:00.000Z');
    assert.throws(
      () => assertExclusiveCalendarRangeWithinMax(start, end),
      (e) => e.code === 'CALENDAR_RANGE_TOO_LARGE'
    );
  });
});

describe('validateProductionEnv', () => {
  test('skips when not production', () => {
    const r = validateProductionEnv({ NODE_ENV: 'development' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.errors.length, 0);
  });

  test('fails when production mongo missing', () => {
    const r = validateProductionEnv({
      NODE_ENV: 'production',
      ADMIN_USER: 'a',
      ADMIN_PASS: 'b',
      ADMIN_JWT_SECRET: '1234567890123456',
      CORS_ORIGINS: 'https://example.com'
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /MONGODB_URI/i.test(e)));
  });

  test('fails when Stripe secret without webhook secret', () => {
    const r = validateProductionEnv({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
      ADMIN_USER: 'a',
      ADMIN_PASS: 'b',
      ADMIN_JWT_SECRET: '1234567890123456',
      CORS_ORIGINS: 'https://example.com',
      STRIPE_SECRET_KEY: 'sk_test_x'
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((e) => /STRIPE_WEBHOOK_SECRET/i.test(e)));
  });
});
