import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scriptFromRelease, smokeProduction } from './production-smoke.mjs';

function fake({ broken, redirect } = {}) {
  return async (url, options) => {
    const route = url.pathname;
    if (redirect && route === '/api/ops/session') {
      return new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/steal' } });
    }
    const data = {
      '/api/health': { status: 'OK', database: 'connected' },
      '/api/bookings/config': { success: true },
      '/api/bookings/checkout-capabilities': { success: true, contractVersion: 2,
        paymentContractVersion: 'checkout-payment-v2-finalize-1', checkoutSessionV2: true,
        finalizeIntentPersist: true, finalizeIntentRequiredForPi: true },
      '/api/ops/session': { success: true, data: { authenticated: true } },
      '/api/ops/readiness/summary': { success: true, data: { readinessByModule: {} } }
    };
    if (route.startsWith('/api/ops/')) assert.equal(options.headers.authorization, 'Bearer ops-test');
    else assert.equal(options.headers.authorization, undefined);
    if (broken === route) return new Response('broken', { status: 500 });
    if (data[route]) return Response.json(data[route]);
    return new Response(`<html><script src="/assets/app-abc.js"></script><div class="wishlist-hero"></div></html>`, { headers: { 'content-type': 'text/html' } });
  };
}

test('checks production pages, payment capabilities and authenticated Ops without writes', async () => {
  assert.deepEqual(await smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', fetchImpl: fake() }), { ok: true, mode: 'read-only' });
});

test('fails closed on broken payment or wishlist and unsafe redirects', async () => {
  for (const broken of ['/api/bookings/checkout-capabilities', '/bg/wishlist']) {
    await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', fetchImpl: fake({ broken }) }), /Smoke failed/);
  }
  await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', fetchImpl: fake({ redirect: true }) }), /Unsafe smoke redirect/);
  await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/other.js', fetchImpl: fake() }), /expected release script/);
  await assert.rejects(smokeProduction({ token: '', fetchImpl: fake() }), /Ops token/);
  await assert.rejects(smokeProduction({ origin: 'https://example.com', token: 'ops-test', fetchImpl: fake() }), /not allowed/);
});

test('requires a single actual entry script from the release', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-smoke-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/assets/app-abc.js"></script>');
  assert.throws(() => scriptFromRelease(root), /ENOENT/);
  fs.writeFileSync(path.join(root, 'assets/app-abc.js'), 'script');
  assert.equal(scriptFromRelease(root), '/assets/app-abc.js');
  fs.appendFileSync(path.join(root, 'index.html'), '<script src="/assets/app-abc.js"></script>');
  assert.throws(() => scriptFromRelease(root), /exactly one/);
});
