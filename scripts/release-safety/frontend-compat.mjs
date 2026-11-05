/**
 * Release compatibility checks that do not contact production.
 */
import fs from 'node:fs';
import path from 'node:path';
import { assessPaymentContractBundle } from '../lib/verifyPaymentContractBundle.mjs';

const PRODUCTION_HOSTS = new Set(['driftdwells.com', 'www.driftdwells.com']);

export function assessReferencedAssets(distDir) {
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return { ok: false, errors: ['index.html is missing from the release artifact.'] };
  }
  const index = fs.readFileSync(indexPath, 'utf8');
  const missing = [];
  for (const match of index.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)) {
    const relative = match[1].replace(/^\//, '');
    if (!fs.existsSync(path.join(distDir, relative))) missing.push(relative);
  }
  const swPath = path.join(distDir, 'sw.js');
  if (!fs.existsSync(swPath)) missing.push('sw.js');
  return {
    ok: missing.length === 0,
    errors: missing.map((file) => `Release references a missing file: ${file}`)
  };
}

export function assessServiceWorkerSource(source) {
  const errors = [];
  const text = String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const calls = [...text.matchAll(/skipWaiting\s*\(/g)];
  const guard = text.indexOf('SKIP_WAITING');
  if (calls.length !== 1 || guard === -1 || calls[0].index < guard) {
    errors.push('Service worker must call skipWaiting() only after an explicit SKIP_WAITING message.');
  }
  if (!text.includes('create-payment-intent') || !text.includes('NetworkOnly')) {
    errors.push('Payment and checkout API routes must stay NetworkOnly.');
  }
  if (!text.includes("cacheName: 'html-navigations-v1'") && !text.includes('html-navigations-v1')) {
    errors.push('Navigation updates must stay network-first so an open checkout is not pinned to a stale shell.');
  }
  return { ok: errors.length === 0, errors };
}

export function assessBuiltServiceWorker(source) {
  const errors = [];
  const text = String(source || '');
  if (!text.includes('SKIP_WAITING')) {
    errors.push('Built service worker lost the SKIP_WAITING opt-in.');
  }
  if (!text.includes('create-payment-intent') || !text.includes('checkout-session') || !text.includes('/api/')) {
    errors.push('Built service worker no longer forces payment and API routes onto the network.');
  }
  if (!text.includes('html-navigations-v1')) {
    errors.push('Built service worker lost network-first navigation handling.');
  }
  return { ok: errors.length === 0, errors };
}

export function assessHtaccessMatch(artifactPath, sourcePath) {
  if (!fs.existsSync(artifactPath) || !fs.existsSync(sourcePath)) {
    return { ok: false, errors: ['Apache .htaccess is missing from the artifact or the source tree.'] };
  }
  const artifact = fs.readFileSync(artifactPath, 'utf8');
  const source = fs.readFileSync(sourcePath, 'utf8');
  if (artifact !== source) {
    return { ok: false, errors: ['Published .htaccess does not match the .htaccess exercised by the Apache gate.'] };
  }
  if (!artifact.includes('%{THE_REQUEST}')) {
    return { ok: false, errors: ['Apache .htaccess is missing the original-request guard for /index.html.'] };
  }
  return { ok: true, errors: [] };
}

export function assessPaymentRelease(distDir) {
  const assessment = assessPaymentContractBundle(distDir);
  return { ok: assessment.ok, errors: assessment.errors, compiled: assessment.compiled };
}

export function assertNotProductionUrl(value, label) {
  if (!value) return { ok: false, errors: [`${label} is not set.`] };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, errors: [`${label} is not a URL.`] };
  }
  if (PRODUCTION_HOSTS.has(url.hostname)) {
    return { ok: false, errors: [`${label} points at production (${url.hostname}).`] };
  }
  return { ok: true, errors: [] };
}

export function assessStagingEnvironment(env = process.env) {
  const base = assertNotProductionUrl(env.RELEASE_STAGING_BASE_URL, 'RELEASE_STAGING_BASE_URL');
  const errors = [...base.errors];
  if (env.RELEASE_STAGING_STRIPE_MODE !== 'test') {
    errors.push('RELEASE_STAGING_STRIPE_MODE must be "test". Live Stripe is refused.');
  }
  if (env.RELEASE_STAGING_ALLOW_PAYMENT_INIT !== '1') {
    errors.push('RELEASE_STAGING_ALLOW_PAYMENT_INIT=1 is required so staging actually initializes a test-mode payment.');
  }
  return {
    ok: errors.length === 0,
    present: errors.length === 0,
    errors,
    blocked: errors.length > 0
  };
}

/**
 * Artifact gate and deployment gate are separate.
 * A correct build can pass the artifact gate while deployment stays blocked
 * until an isolated staging environment exists.
 */
export function decideRelease({
  routing,
  faultyRedirectDetected,
  assets,
  payment,
  serviceWorker,
  htaccess,
  staging
}) {
  const artifactBlockers = [];
  if (!routing?.ok) artifactBlockers.push('apache-routing');
  if (!faultyRedirectDetected) artifactBlockers.push('faulty-index-redirect-not-detected');
  if (!assets?.ok) artifactBlockers.push('missing-frontend-asset');
  if (!payment?.ok) artifactBlockers.push('payment-contract');
  if (!serviceWorker?.ok) artifactBlockers.push('service-worker');
  if (!htaccess?.ok) artifactBlockers.push('apache-config-mismatch');
  const deploymentBlockers = [...artifactBlockers];
  if (!staging?.present) deploymentBlockers.push('missing-staging-environment');
  return {
    artifactOk: artifactBlockers.length === 0,
    deployOk: deploymentBlockers.length === 0,
    artifactBlockers,
    deploymentBlockers
  };
}
