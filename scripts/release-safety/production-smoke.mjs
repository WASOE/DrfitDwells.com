import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_HOSTS = new Set(['driftdwells.com', 'www.driftdwells.com']);
const TEST_HOST = 'test.driftdwells.com';

export async function observeTestSubdomain({ fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const observations = [];
  for (const protocol of ['http:', 'https:']) {
    const url = new URL(`${protocol}//${TEST_HOST}/`);
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    const location = response.headers.get('location');
    if (location) {
      const target = new URL(location, url);
      if (!['http:', 'https:'].includes(target.protocol) || target.hostname !== TEST_HOST || target.username || target.password || target.port) throw new Error('Unsafe test-subdomain redirect');
    }
    observations.push({ protocol, status: response.status, location: location || null,
      contentType: response.headers.get('content-type') || null });
    await response.body?.cancel?.();
  }
  return observations;
}

export async function verifyTestSubdomainBaseline(expected, options = {}) {
  if (!Array.isArray(expected) || expected.length !== 2) throw new Error('HTTP and HTTPS test-subdomain baseline is required');
  const actual = await observeTestSubdomain(options);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Test-subdomain HTTP/HTTPS behavior changed: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  return { ok: true, observations: actual };
}

export function scriptFromRelease(dist) {
  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc="(\/assets\/[A-Za-z0-9._-]+\.js)"[^>]*>/g)];
  if (scripts.length !== 1) throw new Error('Release shell must contain exactly one entry script');
  const asset = scripts[0][1];
  if (!fs.statSync(path.join(dist, asset)).isFile()) throw new Error('Release entry script is missing');
  return asset;
}

export function hasWishlist(dist) {
  const en = fs.existsSync(path.join(dist, 'wishlist/index.html'));
  const bg = fs.existsSync(path.join(dist, 'bg/wishlist/index.html'));
  if (en !== bg) throw new Error('Release contains only one localized wishlist page');
  return en;
}

async function get(base, route, { fetchImpl, token, timeoutMs }) {
  let url = new URL(route, base);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || !SITE_HOSTS.has(url.hostname) || url.port || url.username || url.password) {
      throw new Error(`Unsafe smoke redirect for ${route}`);
    }
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(timeoutMs)
    });
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Missing redirect location for ${route}`);
      url = new URL(location, url);
      if (token && url.pathname.replace(/\/$/, '') !== new URL(route, base).pathname.replace(/\/$/, '')) {
        throw new Error(`Unsafe authenticated redirect for ${route}`);
      }
      continue;
    }
    if (!response.ok || url.pathname.replace(/\/$/, '') !== new URL(route, base).pathname.replace(/\/$/, '')) {
      throw new Error(`Smoke failed: ${route} HTTP ${response.status} at ${url.pathname}`);
    }
    return response;
  }
  throw new Error(`Too many redirects for ${route}`);
}

/**
 * Read-only production checks. No bookings, payment intents or lead records
 * are created. A successful response proves capabilities, not a payment.
 */
export async function smokeProduction({ origin = 'https://driftdwells.com', token, releaseAsset, wishlist = true, expectedApiRelease, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || !SITE_HOSTS.has(base.hostname) || base.port || base.username ||
      base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Production smoke origin is not allowed');
  }
  if (typeof token !== 'string' || !token.trim()) throw new Error('An existing authorized Ops token is required');
  if (!/^\/assets\/[A-Za-z0-9._-]+\.js$/.test(releaseAsset || '')) throw new Error('A release-specific script path is required');
  if (expectedApiRelease && !/^[a-f0-9]{40}$/.test(expectedApiRelease)) throw new Error('Expected API release must be a full lowercase SHA');
  const options = { fetchImpl, timeoutMs };
  const routes = ['/', '/search', '/checkout', '/ops'];
  if (wishlist) routes.push('/wishlist', '/bg/wishlist');
  for (const route of routes) {
    const response = await get(base, route, options);
    if (!String(response.headers.get('content-type')).includes('text/html')) throw new Error(`Not HTML: ${route}`);
    const html = await response.text();
    if (!/<html[\s>]/i.test(html)) throw new Error(`Invalid HTML: ${route}`);
    if (route === '/' && !html.includes(`"${releaseAsset}"`)) throw new Error('Homepage does not reference the expected release script');
    if (route.endsWith('/wishlist') && !html.includes('wishlist-hero')) throw new Error(`Wishlist prerender missing: ${route}`);
  }
  const checks = [
    ['/api/health', x => x.status === 'OK' && x.database === 'connected' &&
      (!expectedApiRelease || x.applicationRelease === expectedApiRelease)],
    ['/api/bookings/config', x => x.success === true],
    ['/api/bookings/checkout-capabilities', x => x.success === true && x.contractVersion === 2 &&
      x.paymentContractVersion === 'checkout-payment-v2-finalize-1' && x.checkoutSessionV2 === true &&
      x.finalizeIntentPersist === true && x.finalizeIntentRequiredForPi === true],
    ['/api/ops/session', x => x.success === true && x.data?.authenticated === true],
    ['/api/ops/readiness/summary', x => x.success === true && Boolean(x.data?.readinessByModule)]
  ];
  if (wishlist) checks.push(['/api/ops/corporate-gift-leads', x =>
    x.success === true && Array.isArray(x.data?.items) && Number.isSafeInteger(x.data?.total)]);
  for (const [route, valid] of checks) {
    const response = await get(base, route, { ...options, token: route.startsWith('/api/ops/') ? token : undefined });
    if (!valid(await response.json())) throw new Error(`Smoke response invalid: ${route}`);
  }
  return { ok: true, mode: 'read-only' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: production-smoke.mjs <verified-release-directory>');
    const releaseAsset = scriptFromRelease(process.argv[2]);
    console.log(JSON.stringify(await smokeProduction({ token: process.env.OPS_VERIFY_TOKEN, releaseAsset, wishlist: hasWishlist(process.argv[2]) })));
  } catch (error) {
    console.error(`[production-smoke] ${error.message}`);
    process.exitCode = 1;
  }
}
