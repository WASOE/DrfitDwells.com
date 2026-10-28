'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const monitorCli = path.join(repoRoot, 'ops/driftdwells-production/payment-contract-monitor.mjs');

function startServer(capabilities) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') {
      res.end(JSON.stringify({ status: 'OK' }));
      return;
    }
    if (req.url === '/api/bookings/checkout-capabilities') {
      res.end(JSON.stringify(capabilities));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const alignedCaps = {
  success: true,
  checkoutSessionV2: true,
  finalizeIntentPersist: true,
  finalizeIntentRequiredForPi: true,
  paymentContractVersion: 'checkout-payment-v2-finalize-1'
};

test('monitor accepts additional unrelated workers and ignores PM2 secrets', async () => {
  const lib = await import(pathToFileURL(path.join(repoRoot, 'ops/driftdwells-production/paymentContractMonitorLib.mjs')).href);
  const processes = [
    {
      name: 'driftdwells',
      pm2_env: { status: 'online', STRIPE_SECRET_KEY: 'sk_test_should_not_leak' }
    },
    { name: 'driftdwells-confirmation-worker', status: 'online' },
    { name: 'unrelated-worker', pm2_env: { status: 'online', env: { STRIPE_SECRET_KEY: 'sk_test_should_not_leak' } } }
  ];
  const summarized = lib.summarizeProcesses(processes);
  assert.equal(JSON.stringify(summarized).includes('sk_test'), false);
  const { server, baseUrl } = await startServer(alignedCaps);
  try {
    const report = await lib.runPaymentContractMonitor({
      baseUrl,
      processes,
      timeoutMs: 1000
    });
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.ok(report.observedRoles.includes('unrelated-worker'));
    assert.equal(JSON.stringify(report).includes('sk_test'), false);
  } finally {
    server.close();
  }
});

test('missing required named process fails with PROCESS_ROLE_MISSING', async () => {
  const lib = await import(pathToFileURL(path.join(repoRoot, 'ops/driftdwells-production/paymentContractMonitorLib.mjs')).href);
  const { server, baseUrl } = await startServer(alignedCaps);
  try {
    const report = await lib.runPaymentContractMonitor({
      baseUrl,
      processes: [
        { name: 'driftdwells', status: 'online' },
        { name: 'some-other-worker', status: 'online' }
      ],
      timeoutMs: 1000
    });
    assert.equal(report.ok, false);
    assert.ok(report.alerts.some((alert) => alert.code === 'PROCESS_ROLE_MISSING' && alert.role === 'driftdwells-confirmation-worker'));
    assert.equal(report.alerts.some((alert) => alert.code === 'API_HEALTH_FAILED'), false);
  } finally {
    server.close();
  }
});

test('health and payment-contract failures use separate alert codes', async () => {
  const lib = await import(pathToFileURL(path.join(repoRoot, 'ops/driftdwells-production/paymentContractMonitorLib.mjs')).href);
  const processes = [
    { name: 'driftdwells', status: 'online' },
    { name: 'driftdwells-confirmation-worker', status: 'online' }
  ];
  const unhealthy = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.statusCode = 503;
      res.end(JSON.stringify({ status: 'DOWN' }));
      return;
    }
    res.end(JSON.stringify({ ...alignedCaps, finalizeIntentPersist: false }));
  });
  await new Promise((resolve) => unhealthy.listen(0, '127.0.0.1', resolve));
  try {
    const report = await lib.runPaymentContractMonitor({
      baseUrl: `http://127.0.0.1:${unhealthy.address().port}`,
      processes,
      timeoutMs: 1000
    });
    assert.ok(report.alertCodes.includes('API_HEALTH_FAILED'));
    assert.ok(report.alertCodes.includes('PAYMENT_CONTRACT_MISMATCH'));
    assert.equal(report.alertCodes.includes('PROCESS_ROLE_MISSING'), false);
  } finally {
    unhealthy.close();
  }
});

test('CLI snapshot mode does not print embedded secrets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2-snapshot-'));
  const snapshot = path.join(dir, 'processes.json');
  fs.writeFileSync(
    snapshot,
    JSON.stringify([
      {
        name: 'driftdwells',
        pm2_env: { status: 'online', env: { STRIPE_SECRET_KEY: 'sk_test_should_not_leak' } }
      },
      { name: 'driftdwells-confirmation-worker', status: 'stopped' }
    ])
  );
  const { server, baseUrl } = await startServer(alignedCaps);
  try {
    const child = spawn(
      process.execPath,
      [
        monitorCli,
        `--base-url=${baseUrl}`,
        `--process-snapshot=${snapshot}`,
        '--timeout-ms=1000'
      ],
      { cwd: repoRoot }
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.notEqual(code, 0);
    assert.equal(stdout.includes('sk_test_should_not_leak'), false);
    const report = JSON.parse(stdout);
    assert.ok(report.alerts.some((alert) => alert.code === 'PROCESS_ROLE_NOT_ONLINE'));
  } finally {
    server.close();
  }
});
