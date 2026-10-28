'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const verifier = path.join(repoRoot, 'scripts/verifyPaymentContractRuntime.mjs');

function writeManifest(dir, overrides = {}) {
  const manifest = {
    ok: true,
    paymentContractVersion: 'checkout-payment-v2-finalize-1',
    checkoutSessionV2: true,
    finalizeIntentPersist: true,
    finalizeIntentRequiredForPi: true,
    frontendRelease: 'frontend-2026-10-27',
    applicationRelease: 'api-2026-10-27',
    applicationCommit: null,
    enabledCapabilities: {
      checkoutSessionV2: true,
      finalizeIntentPersist: true,
      finalizeIntentRequiredForPi: true,
      stripePublishableKeyPresent: true
    },
    ...overrides
  };
  const manifestPath = path.join(dir, 'release-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function runVerifier(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [verifier, ...args], {
      cwd: repoRoot,
      env: { ...process.env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

const alignedCapabilities = {
  success: true,
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  paymentContractVersion: 'checkout-payment-v2-finalize-1',
  frontendReleaseHint: 'frontend-2026-10-27',
  applicationRelease: 'api-2026-10-27',
  stripeSecret: 'sk_test_should_not_appear'
};

test('aligned manifest and runtime exit zero without echoing secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-contract-'));
  const manifestPath = writeManifest(dir);
  const { server, baseUrl } = await startServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') {
      res.end(
        JSON.stringify({
          status: 'OK',
          applicationRelease: 'api-2026-10-27',
          frontendRelease: 'frontend-2026-10-27',
          paymentContractVersion: 'checkout-payment-v2-finalize-1',
          nestedSecret: 'sk_test_should_not_appear'
        })
      );
      return;
    }
    if (req.url === '/api/bookings/checkout-capabilities') {
      res.end(JSON.stringify(alignedCapabilities));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  try {
    const result = await runVerifier([
      `--base-url=${baseUrl}`,
      `--manifest=${manifestPath}`,
      '--timeout-ms=1000'
    ]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.charged, false);
    assert.equal(report.paymentIntentCreated, false);
    assert.equal(result.stdout.includes('sk_test_should_not_appear'), false);
    assert.equal(result.stderr.includes('sk_test_should_not_appear'), false);
  } finally {
    server.close();
  }
});

test('capability mismatch exits nonzero', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-contract-'));
  const manifestPath = writeManifest(dir);
  const { server, baseUrl } = await startServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') {
      res.end(JSON.stringify({ status: 'OK', applicationRelease: 'api-2026-10-27' }));
      return;
    }
    res.end(
      JSON.stringify({
        ...alignedCapabilities,
        finalizeIntentPersist: false
      })
    );
  });
  try {
    const result = await runVerifier([
      `--base-url=${baseUrl}`,
      `--manifest=${manifestPath}`,
      '--timeout-ms=1000'
    ]);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.mismatches.some((item) => item.field === 'finalizeIntentPersist'));
  } finally {
    server.close();
  }
});

test('hung runtime fails on the timeout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-contract-'));
  const manifestPath = writeManifest(dir);
  const { server, baseUrl } = await startServer(() => {});
  try {
    const result = await runVerifier([
      `--base-url=${baseUrl}`,
      `--manifest=${manifestPath}`,
      '--timeout-ms=200'
    ]);
    assert.notEqual(result.code, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.ok(report.mismatches.some((item) => item.reason === 'timeout'));
  } finally {
    server.close();
  }
});
