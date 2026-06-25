'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  parseLegacyCabinDetailPath,
  buildLegacyCabinRedirectLocation,
  legacyCabinDetailRedirectMiddleware
} = require('../middleware/legacyCabinDetailRedirects');

const THE_CABIN_ID = '69b2ff933a7fff6621e785cc';
const LUX_CABIN_ID = '69b2ff947f141a71ffa7c492';
const UNKNOWN_ID = '507f1f77bcf86cd799439011';

function buildApp() {
  const app = express();
  app.use(legacyCabinDetailRedirectMiddleware);
  app.get('*', (req, res) => {
    res.status(200).json({ ok: true, path: req.path });
  });
  return app;
}

test('parseLegacyCabinDetailPath matches detail URLs only', () => {
  assert.deepEqual(parseLegacyCabinDetailPath(`/cabin/${THE_CABIN_ID}`), {
    cabinId: THE_CABIN_ID,
    localePrefix: ''
  });
  assert.deepEqual(parseLegacyCabinDetailPath(`/bg/cabin/${LUX_CABIN_ID}/`), {
    cabinId: LUX_CABIN_ID,
    localePrefix: '/bg'
  });
  assert.equal(parseLegacyCabinDetailPath('/cabin'), null);
  assert.equal(parseLegacyCabinDetailPath('/cabin/faq'), null);
  assert.equal(parseLegacyCabinDetailPath(`/cabin/${THE_CABIN_ID}/confirm`), null);
  assert.equal(parseLegacyCabinDetailPath(`/bg/cabin/${THE_CABIN_ID}/confirm`), null);
});

test('buildLegacyCabinRedirectLocation maps known IDs to stay slugs', () => {
  assert.equal(
    buildLegacyCabinRedirectLocation(`/cabin/${THE_CABIN_ID}`),
    '/stays/the-cabin'
  );
  assert.equal(
    buildLegacyCabinRedirectLocation(`/bg/cabin/${LUX_CABIN_ID}`),
    '/bg/stays/lux-cabin'
  );
});

test('buildLegacyCabinRedirectLocation preserves non-empty query strings', () => {
  assert.equal(
    buildLegacyCabinRedirectLocation(`/cabin/${THE_CABIN_ID}`, {
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: '2'
    }),
    '/stays/the-cabin?checkIn=2026-07-01&checkOut=2026-07-03&adults=2'
  );
});

test('buildLegacyCabinRedirectLocation never emits a bare ?', () => {
  assert.equal(buildLegacyCabinRedirectLocation(`/cabin/${THE_CABIN_ID}`, {}), '/stays/the-cabin');
  assert.equal(
    buildLegacyCabinRedirectLocation(`/cabin/${THE_CABIN_ID}`, { checkIn: '' }),
    '/stays/the-cabin'
  );
});

test('buildLegacyCabinRedirectLocation returns null for unknown cabin IDs', () => {
  assert.equal(buildLegacyCabinRedirectLocation(`/cabin/${UNKNOWN_ID}`), null);
});

test('middleware 301 redirects known legacy cabin detail URLs', async () => {
  const app = buildApp();

  const theCabin = await request(app).get(`/cabin/${THE_CABIN_ID}`);
  assert.equal(theCabin.status, 301);
  assert.equal(theCabin.headers.location, '/stays/the-cabin');

  const luxBg = await request(app)
    .get(`/bg/cabin/${LUX_CABIN_ID}`)
    .query({ checkIn: '2026-08-01', checkOut: '2026-08-04' });
  assert.equal(luxBg.status, 301);
  assert.equal(
    luxBg.headers.location,
    '/bg/stays/lux-cabin?checkIn=2026-08-01&checkOut=2026-08-04'
  );
});

test('middleware does not redirect checkout confirm URLs', async () => {
  const app = buildApp();

  const confirm = await request(app).get(`/cabin/${THE_CABIN_ID}/confirm`);
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.path, `/cabin/${THE_CABIN_ID}/confirm`);

  const confirmBg = await request(app).get(`/bg/cabin/${LUX_CABIN_ID}/confirm`);
  assert.equal(confirmBg.status, 200);
});

test('middleware passes unknown cabin detail URLs through', async () => {
  const app = buildApp();
  const res = await request(app).get(`/cabin/${UNKNOWN_ID}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.path, `/cabin/${UNKNOWN_ID}`);
});

test('middleware passes through stays confirm URLs', async () => {
  const app = buildApp();
  const res = await request(app).get('/stays/a-frame/confirm');
  assert.equal(res.status, 200);
  assert.equal(res.body.path, '/stays/a-frame/confirm');
});
