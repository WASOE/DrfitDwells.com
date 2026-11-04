/**
 * Ephemeral staging for one CI run: loopback Mongo, stripe-mock, the real API,
 * and the compiled frontend behind Apache. Nothing here may reach production.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withApache } from './apache-server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidencePath = path.join(repoRoot, 'staging-evidence.json');
const phasePath = path.join(repoRoot, 'ci-staging-phase.txt');

function phase(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(phasePath, line);
  fs.writeSync(1, `[ci-staging] ${message}\n`);
}
const MONGO_URI = 'mongodb://127.0.0.1:27017/drift-dwells-ci-staging';
const STRIPE_API_BASE = 'http://127.0.0.1:12111';
const STRIPE_SECRET_KEY = 'sk_test_123';

function redact(text) {
  return String(text || '')
    .replace(/sk_(?:test|live)_[A-Za-z0-9_]+/g, 'sk_[redacted]')
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, 'mongodb://[redacted]');
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForHttp(url, label) {
  let last = 'not started';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready (${last}).`);
}

async function stripeMockAnswers() {
  try {
    const response = await fetch(STRIPE_API_BASE, { signal: AbortSignal.timeout(2000) });
    return response.status < 500;
  } catch {
    return false;
  }
}

function startStripeMockBinary() {
  phase('falling back to the stripe-mock binary');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-stripe-mock-'));
  const download = spawnSync('gh', [
    'release', 'download', '--repo', 'stripe/stripe-mock',
    '--pattern', '*linux_amd64.tar.gz', '--dir', dir, '--clobber'
  ], { stdio: 'ignore' });
  if (download.status !== 0) {
    throw new Error(`stripe-mock binary could not be downloaded (gh status ${download.status}).`);
  }
  const archive = fs.readdirSync(dir).find((entry) => entry.endsWith('.tar.gz'));
  spawnSync('tar', ['-xzf', archive], { cwd: dir });
  const binary = path.join(dir, 'stripe-mock');
  const child = spawn(binary, ['-http-port', '12111'], { stdio: 'ignore' });
  child.on('error', (error) => phase(`stripe-mock binary error ${error.code || error.message}`));
  return () => child.kill('SIGTERM');
}

async function startStripeMock() {
  const name = `dd-stripe-mock-${process.pid}`;
  phase('docker run stripe-mock');
  let docker = { status: 1, signal: null };
  try {
    // Ignore stdio. Inheriting it lets docker close this process's stdin on
    // detach, and capturing the pull log overflows spawnSync and aborts it.
    docker = spawnSync('docker', [
      'run', '--rm', '-d', '--name', name,
      '-p', '127.0.0.1:12111:12111',
      'stripe/stripe-mock'
    ], { stdio: 'ignore' });
  } catch (error) {
    phase(`docker spawn failed ${error.code || error.message}`);
  }
  phase(`docker status=${docker.status} signal=${docker.signal || 'none'}`);
  if (docker.status === 0) {
    const inspect = spawnSync('docker', ['inspect', '-f', '{{.State.Status}}', name], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024
    });
    const state = (inspect.stdout || '').trim();
    phase(`stripe-mock state=${state || 'unknown'}`);
    if (state === 'running') {
      const stop = () => spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        if (await stripeMockAnswers()) {
          phase('stripe-mock answered on 127.0.0.1:12111');
          return stop;
        }
        phase(`stripe-mock not answering (${attempt})`);
      }
      phase('docker stripe-mock never answered; removing it');
      stop();
    }
  }
  return startStripeMockBinary();
}

function stagingEnv(apiPort) {
  const sha = process.env.VITE_FRONTEND_RELEASE || process.env.GITHUB_SHA || '';
  const runId = process.env.GITHUB_RUN_ID || 'local';
  return {
    ...process.env,
    RELEASE_CI_STAGING: '1',
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    PORT: String(apiPort),
    MONGODB_URI: MONGO_URI,
    MONGO_URI: MONGO_URI,
    STRIPE_SECRET_KEY,
    STRIPE_API_BASE,
    STRIPE_WEBHOOK_SECRET: '',
    SMTP_HOST: '',
    SMTP_URL: '',
    EMAIL_DELIVERY_REQUIRED: '0',
    OPS_ICAL_SYNC_SCHEDULER_ENABLED: '0',
    BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED: '0',
    MESSAGE_DISPATCHER_ENABLED: '0',
    MESSAGE_ORCHESTRATOR_ENABLED: '0',
    FUNNEL_TRACKING_ENABLED: '0',
    CHECKOUT_SESSION_V2: '1',
    FINALIZE_INTENT_PERSIST: '1',
    FINALIZE_INTENT_REQUIRED_FOR_PI: '1',
    VITE_FRONTEND_RELEASE: sha,
    APP_RELEASE: sha,
    CI_STAGING_RUN_ID: runId,
    CABIN_NIGHT_CLAIM_MODE: ''
  };
}

function runNode(script, env) {
  const result = spawnSync(process.execPath, [script], { cwd: repoRoot, env, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(redact(`${script} failed\n${result.stdout || ''}\n${result.stderr || ''}`));
  }
}

async function run() {
  fs.writeFileSync(phasePath, '');
  phase(`starting node ${process.version}`);
  const dist = path.join(repoRoot, 'client', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html')) || !fs.existsSync(path.join(dist, '.htaccess'))) {
    throw new Error('client/dist is missing. Build the exact release before ci-staging.');
  }
  fs.rmSync(evidencePath, { force: true });
  phase('starting stripe-mock');
  const stopMock = await startStripeMock();
  phase('stripe-mock launched');
  phase('opening a free port');
  let server = null;
  let serverLog = '';
  const apiPort = await freePort();
  phase(`api port ${apiPort}`);
  const env = stagingEnv(apiPort);
  try {
    await waitForHttp(STRIPE_API_BASE, 'stripe-mock');
    phase('stripe-mock ready');
    runNode('server/scripts/ciStagingSeed.cjs', env);
    phase('database seeded');
    server = spawn(process.execPath, ['server/server.js'], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', (chunk) => { serverLog += chunk; });
    server.stderr.on('data', (chunk) => { serverLog += chunk; });
    await waitForHttp(`http://127.0.0.1:${apiPort}/api/health`, 'API');
    phase('api ready');
    const code = await withApache(dist, async ({ httpsPort }) => {
      const result = spawnSync('npx', [
        'playwright', 'test',
        'tests/e2e/release-safety/staging-booking.integration.spec.js',
        '--project=release-safety-staging'
      ], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
          ...env,
          RELEASE_STAGING_BASE_URL: `https://127.0.0.1:${httpsPort}`,
          RELEASE_STAGING_STRIPE_MODE: 'test',
          RELEASE_STAGING_ALLOW_PAYMENT_INIT: '1',
          RELEASE_STAGING_EVIDENCE: evidencePath,
          CI: '1'
        }
      });
      if (result.status !== 0) return result.status || 1;
      return 0;
    }, { apiPort });
    if (code !== 0) throw new Error(`Staging booking tests failed with exit ${code}.`);
    phase(`playwright exited 0; evidence ${evidencePath}`);
    const written = fs.readFileSync(evidencePath, 'utf8');
    if (/_secret_|sk_(?:test|live)_|mongodb(?:\+srv)?:\/\//i.test(written)) {
      fs.rmSync(evidencePath, { force: true });
      throw new Error('Staging evidence contained a secret and was deleted.');
    }
  } catch (error) {
    if (serverLog) console.error(redact(serverLog).slice(-4000));
    throw error;
  } finally {
    if (server && !server.killed) server.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const drop = spawnSync(process.execPath, ['server/scripts/ciStagingSeed.cjs', '--drop'], {
      cwd: repoRoot,
      env,
      encoding: 'utf8'
    });
    if (drop.status !== 0) console.error(redact(`${drop.stdout || ''}\n${drop.stderr || ''}`));
    stopMock();
  }
}

for (const signal of ['SIGHUP', 'SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    try { fs.appendFileSync(phasePath, `${new Date().toISOString()} signal ${signal}\n`); } catch { /* best-effort */ }
    process.exit(1);
  });
}

const stayAlive = setInterval(() => {}, 60_000);
run().then(() => {
  if (!fs.existsSync(evidencePath) || fs.statSync(evidencePath).size < 20) {
    throw new Error('Staging finished without an evidence file.');
  }
}).catch((error) => {
  console.error(redact(error.stack || error.message || error));
  process.exitCode = 1;
}).finally(() => {
  clearInterval(stayAlive);
});
