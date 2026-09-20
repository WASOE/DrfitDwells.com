/**
 * P0B — additive session.locale on Ops session payload.
 * Run from server/: node --test scripts/opsSessionLocale.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSessionData,
  buildSessionDataForRequest,
  normalizeSessionLocale
} = require('../services/ops/opsAuthService');

function coreSessionFields(data) {
  return {
    authenticated: data.authenticated,
    actorId: data.actorId,
    role: data.role,
    modules: data.modules,
    actions: data.actions,
    defaultRoute: data.defaultRoute
  };
}

test('normalizeSessionLocale accepts only en|bg', () => {
  assert.equal(normalizeSessionLocale('en'), 'en');
  assert.equal(normalizeSessionLocale('bg'), 'bg');
  assert.equal(normalizeSessionLocale(null), null);
  assert.equal(normalizeSessionLocale('de'), null);
  assert.equal(normalizeSessionLocale('BG'), null);
});

test('buildSessionData adds locale without changing role/modules/actions/defaultRoute', () => {
  const withoutLocale = buildSessionData({
    id: 'actor-admin',
    role: 'admin',
    modules: ['*']
  });
  const withLocale = buildSessionData({
    id: 'actor-admin',
    role: 'admin',
    modules: ['*'],
    locale: 'bg'
  });

  assert.deepEqual(coreSessionFields(withoutLocale), coreSessionFields(withLocale));
  assert.equal(withoutLocale.locale, null);
  assert.equal(withLocale.locale, 'bg');
  assert.equal(withoutLocale.role, 'admin');
  assert.ok(Array.isArray(withoutLocale.modules));
  assert.ok(Array.isArray(withoutLocale.actions));
  assert.equal(withoutLocale.defaultRoute, '/ops/reservations');
});

test('buildSessionData returns cleaner locale when present', () => {
  const data = buildSessionData({
    id: 'actor-cleaner',
    role: 'cleaner',
    modules: ['cleaning'],
    locale: 'bg'
  });
  assert.equal(data.role, 'cleaner');
  assert.deepEqual(data.modules, ['cleaning']);
  assert.equal(data.defaultRoute, '/ops/cleaning');
  assert.equal(data.locale, 'bg');
});

test('buildSessionDataForRequest loads locale for ops_user via loader', async () => {
  const data = await buildSessionDataForRequest(
    {
      id: '507f1f77bcf86cd799439011',
      role: 'cleaner',
      modules: ['cleaning'],
      src: 'ops_user'
    },
    { loadLocale: async () => 'bg' }
  );
  assert.equal(data.locale, 'bg');
  assert.equal(data.role, 'cleaner');
  assert.deepEqual(data.modules, ['cleaning']);
});

test('buildSessionDataForRequest does not use loader for legacy_env', async () => {
  let called = false;
  const data = await buildSessionDataForRequest(
    {
      id: 'admin',
      role: 'admin',
      modules: ['*'],
      src: 'legacy_env',
      locale: 'bg'
    },
    {
      loadLocale: async () => {
        called = true;
        return 'en';
      }
    }
  );
  assert.equal(called, false);
  assert.equal(data.locale, 'bg');
  assert.equal(data.role, 'admin');
});
