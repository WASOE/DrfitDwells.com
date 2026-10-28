#!/usr/bin/env node
/**
 * Post-start payment-contract verification.
 *
 * Reads the production build manifest and compares it with live
 * GET /api/health and GET /api/bookings/checkout-capabilities.
 * Does not create a PaymentIntent and does not charge.
 *
 *   node scripts/verifyPaymentContractRuntime.mjs \
 *     --base-url http://127.0.0.1:5000 \
 *     --manifest client/dist/release-manifest.json \
 *     --timeout-ms 5000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareManifestToRuntime } from '../shared/payments/productionPaymentContract.js';
import { resolveTimeoutMs, strictJsonGet } from './lib/strictJsonGet.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    baseUrl: '',
    manifest: path.join(repoRoot, 'client/dist/release-manifest.json'),
    timeoutMs: 5000
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--base-url=')) out.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--manifest=')) out.manifest = arg.slice('--manifest='.length);
    else if (arg.startsWith('--timeout-ms=')) out.timeoutMs = arg.slice('--timeout-ms='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/verifyPaymentContractRuntime.mjs --base-url=<url> [--manifest=<path>] [--timeout-ms=5000]

Compares the release manifest with GET /api/health and GET /api/bookings/checkout-capabilities.
Read-only. No PaymentIntent is created. Exits 0 on match and 1 on any mismatch.
`);
}

function allowlistedHealth(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    status: body.status ?? null,
    applicationRelease: body.applicationRelease ?? null,
    frontendRelease: body.frontendRelease ?? null,
    applicationCommit: body.applicationCommit ?? null,
    paymentContractVersion: body.paymentContractVersion ?? null
  };
}

function allowlistedCapabilities(body) {
  if (!body || typeof body !== 'object') return null;
  return {
    success: body.success === true,
    checkoutSessionV2: body.checkoutSessionV2 === true,
    finalizeIntentPersist: body.finalizeIntentPersist === true,
    finalizeIntentRequiredForPi: body.finalizeIntentRequiredForPi === true,
    paymentContractVersion: body.paymentContractVersion ?? null,
    frontendReleaseHint: body.frontendReleaseHint ?? null,
    applicationRelease: body.applicationRelease ?? null
  };
}

export async function verifyPaymentContractRuntime({
  baseUrl,
  manifestPath,
  timeoutMs = 5000,
  fetchImpl
} = {}) {
  const timeout = resolveTimeoutMs(timeoutMs);
  const report = {
    ok: false,
    mode: 'read_only',
    charged: false,
    paymentIntentCreated: false,
    timeoutMs: timeout,
    mismatches: []
  };

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    report.mismatches.push({
      field: 'manifest',
      expected: 'readable_json',
      actual: null,
      reason: 'unreadable'
    });
    return report;
  }

  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(root)) {
    report.mismatches.push({
      field: 'baseUrl',
      expected: 'http(s) url',
      actual: null,
      reason: 'invalid'
    });
    return report;
  }

  let healthRes;
  let capsRes;
  try {
    healthRes = await strictJsonGet(`${root}/api/health`, { timeoutMs: timeout, fetchImpl });
    capsRes = await strictJsonGet(`${root}/api/bookings/checkout-capabilities`, {
      timeoutMs: timeout,
      fetchImpl
    });
  } catch (err) {
    report.mismatches.push({
      field: 'runtime',
      expected: 'json',
      actual: null,
      reason: err?.code === 'TIMEOUT' ? 'timeout' : 'request_failed'
    });
    return report;
  }

  const health = allowlistedHealth(healthRes.body);
  const capabilities = allowlistedCapabilities(capsRes.body);
  if (!healthRes.ok || health?.status !== 'OK') {
    report.mismatches.push({
      field: 'health',
      expected: 'OK',
      actual: health?.status ?? healthRes.status,
      reason: 'unhealthy'
    });
  }
  if (!capsRes.ok || !capabilities) {
    report.mismatches.push({
      field: 'capabilities',
      expected: 'json',
      actual: capsRes.status,
      reason: 'http_error'
    });
  }

  const compared = compareManifestToRuntime({ manifest, health, capabilities });
  report.mismatches.push(...compared.mismatches);
  report.compared = {
    paymentContractVersion: capabilities?.paymentContractVersion ?? null,
    checkoutSessionV2: capabilities?.checkoutSessionV2 ?? null,
    finalizeIntentPersist: capabilities?.finalizeIntentPersist ?? null,
    finalizeIntentRequiredForPi: capabilities?.finalizeIntentRequiredForPi ?? null,
    frontendRelease: capabilities?.frontendReleaseHint || health?.frontendRelease || null,
    applicationRelease: health?.applicationRelease || capabilities?.applicationRelease || null
  };
  report.ok = report.mismatches.length === 0;
  return report;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.baseUrl) {
    console.error(JSON.stringify({ ok: false, error: '--base-url is required' }));
    process.exit(1);
  }
  const report = await verifyPaymentContractRuntime({
    baseUrl: args.baseUrl,
    manifestPath: path.resolve(args.manifest),
    timeoutMs: args.timeoutMs
  });
  console.log(JSON.stringify(report));
  if (!report.ok) process.exit(1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: 'verifier_failed' }));
    process.exit(1);
  });
}
