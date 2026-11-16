import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasWishlist, observeTestSubdomain, scriptFromRelease, smokeProduction, verifyTestSubdomainBaseline } from './production-smoke.mjs';

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
      '/api/ops/corporate-gift-leads': { success: true, data: { items: [], total: 0 } },
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
  for (const broken of ['/api/bookings/checkout-capabilities', '/bg/wishlist', '/api/ops/corporate-gift-leads']) {
    await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', fetchImpl: fake({ broken }) }), /Smoke failed/);
  }
  await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', fetchImpl: fake({ redirect: true }) }), /Unsafe (authenticated|smoke) redirect/);
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
  assert.equal(hasWishlist(root), false);
  fs.mkdirSync(path.join(root, 'wishlist'));
  fs.writeFileSync(path.join(root, 'wishlist/index.html'), 'en');
  assert.throws(() => hasWishlist(root), /only one/);
  fs.mkdirSync(path.join(root, 'bg/wishlist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bg/wishlist/index.html'), 'bg');
  assert.equal(hasWishlist(root), true);
  fs.appendFileSync(path.join(root, 'index.html'), '<script src="/assets/app-abc.js"></script>');
  assert.throws(() => scriptFromRelease(root), /exactly one/);
});

test('pre-wishlist rollback smoke does not expect wishlist routes', async () => {
  const seen = [];
  const impl = fake();
  await smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js', wishlist: false,
    fetchImpl: async (url, options) => { seen.push(url.pathname); return impl(url, options); } });
  assert.equal(seen.includes('/wishlist'), false);
});

test('rejects an unexpected running API release when requested', async () => {
  await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js',
    expectedApiRelease: 'a'.repeat(40), fetchImpl: fake() }), /api\/health/);
  await assert.rejects(smokeProduction({ token: 'ops-test', releaseAsset: '/assets/app-abc.js',
    expectedApiRelease: 'main', fetchImpl: fake() }), /full lowercase SHA/);
});

test('captures and enforces actual HTTP and HTTPS test-subdomain behavior', async () => {
  const fetchImpl = async url => url.protocol === 'http:'
    ? new Response(null, { status: 301, headers: { location: 'https://test.driftdwells.com/' } })
    : new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } });
  const baseline = await observeTestSubdomain({ fetchImpl });
  assert.deepEqual(baseline.map(item => item.status), [301, 404]);
  assert.equal((await verifyTestSubdomainBaseline(baseline, { fetchImpl })).ok, true);
  await assert.rejects(verifyTestSubdomainBaseline(baseline, { fetchImpl: async url =>
    new Response('changed', { status: url.protocol === 'http:' ? 200 : 404, headers: { 'content-type': 'text/html' } }) }), /behavior changed/);
});

test('test-subdomain probe uses verified origin IP without DNS and retains TLS/HTTP semantics', async () => {
  const calls = [];
  const originRequest = async (protocol, originIp, timeoutMs) => {
    calls.push({ protocol, originIp, timeoutMs });
    return protocol === 'http:'
      ? { status: 301, location: 'https://test.driftdwells.com/', contentType: null }
      : { status: 404, location: null, contentType: 'text/html' };
  };
  const baseline = await observeTestSubdomain({ originIp: '192.0.2.10', originRequest });
  assert.deepEqual(calls.map(call => call.protocol), ['http:', 'https:']);
  assert.ok(calls.every(call => call.originIp === '192.0.2.10'));
  assert.equal((await verifyTestSubdomainBaseline(baseline, { originIp: '192.0.2.10', originRequest })).ok, true);
  await assert.rejects(observeTestSubdomain({ originIp: 'not-an-ip', originRequest }), /valid.*origin IP/);
});

test('records a pre-existing TLS certificate failure without disabling certificate verification', async () => {
  const calls = [];
  const originRequest = async (protocol) => {
    calls.push(protocol);
    if (protocol === 'https:') throw Object.assign(new Error('certificate expired'), { code: 'CERT_HAS_EXPIRED' });
    return { status: 301, location: 'https://test.driftdwells.com/', contentType: null };
  };
  const baseline = await observeTestSubdomain({ originIp: '192.0.2.10', originRequest });
  assert.deepEqual(baseline[1], { protocol: 'https:', status: null, location: null,
    contentType: null, tlsError: 'CERT_HAS_EXPIRED' });
  assert.equal((await verifyTestSubdomainBaseline(baseline, { originIp: '192.0.2.10', originRequest })).ok, true);
  assert.deepEqual(calls, ['http:', 'https:', 'http:', 'https:']);
  await assert.rejects(observeTestSubdomain({ originIp: '192.0.2.10', originRequest: async protocol => {
    if (protocol === 'https:') throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    return { status: 301, location: 'https://test.driftdwells.com/', contentType: null };
  } }), /connection reset/);
});
