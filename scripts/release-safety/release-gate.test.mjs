import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateBaseLodgingPrice } from '../../client/src/utils/lodgingPrice.js';
import { executeLocalPublish } from '../deploy-frontend-safe.lib.mjs';
import { activateTestedRelease } from './activate-release.mjs';
import {
  assessHtaccessMatch,
  assessPaymentRelease,
  assessReferencedAssets,
  assessBuiltServiceWorker,
  assessServiceWorkerSource,
  assessStagingEnvironment,
  decideRelease
} from './frontend-compat.mjs';
import { faultyIndexRedirect } from './routing-contract.mjs';
import { assertReleaseSafetyReport, assertStagingEvidence, buildPassingEvidence } from './report.mjs';
import { resolveSnapshotDir, restoreFrontendShell, snapshotFrontendShell } from './rollback.mjs';
import { idsThatFailed, runRoutingAgainstHtaccess } from './run-routing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(repoRoot, 'client/dist');
const htaccessPath = path.join(repoRoot, 'client/public/.htaccess');

test('quoted lodging totals use the nightly rate, not a stale marketing price', () => {
  assert.equal(calculateBaseLodgingPrice({ pricePerNight: 100 }, 2, 2, 0), 200);
  assert.equal(calculateBaseLodgingPrice({ pricePerNight: 110 }, 2, 2, 0), 220);
  assert.equal(calculateBaseLodgingPrice({ pricePerNight: 60 }, 2, 2, 0), 120);
  assert.equal(calculateBaseLodgingPrice({ pricePerNight: 75 }, 2, 2, 0), 150);
  assert.notEqual(calculateBaseLodgingPrice({ pricePerNight: 100 }, 1, 2, 0), 55);
  assert.notEqual(calculateBaseLodgingPrice({ pricePerNight: 110 }, 1, 2, 0), 85);
});

test('faulty index.html redirect is rejected and the guarded rule is accepted', async () => {
  assert.equal(fs.existsSync(path.join(distDir, 'index.html')), true, 'client/dist must exist for the Apache artifact test');
  const htaccess = fs.readFileSync(htaccessPath, 'utf8');
  const faulty = faultyIndexRedirect(htaccess);
  assert.equal(faulty.includes('%{THE_REQUEST}'), false);
  assert.match(htaccess, /%\{THE_REQUEST\}/);

  const broken = await runRoutingAgainstHtaccess(distDir, faulty);
  const brokenIds = idsThatFailed(broken);
  assert.equal(broken.ok, false);
  assert.ok(brokenIds.includes('search'), `search was not failed by the faulty rule: ${brokenIds.join(',')}`);
  assert.ok(brokenIds.includes('checkout'), `checkout was not failed by the faulty rule: ${brokenIds.join(',')}`);

  const passed = await runRoutingAgainstHtaccess(distDir, htaccess);
  assert.equal(passed.ok, true, passed.failures?.join('\n'));
  assert.deepEqual(idsThatFailed(passed), []);
});

test('missing asset, bad payment contract, and unsafe service worker fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-bad-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/assets/missing.js"></script><script src="/assets/app.js"></script>');
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'console.log("no payment contract")');
  const assets = assessReferencedAssets(dir);
  assert.equal(assets.ok, false);
  assert.match(assets.errors.join('\n'), /missing\.js/);

  const payment = assessPaymentRelease(dir);
  assert.equal(payment.ok, false);
  assert.match(payment.errors.join('\n'), /payment-contract|missing asset|frontend release/i);

  const sw = assessServiceWorkerSource('self.addEventListener("install", () => { self.skipWaiting(); });');
  assert.equal(sw.ok, false);
  const realSw = assessServiceWorkerSource(fs.readFileSync(path.join(repoRoot, 'client/src/sw.js'), 'utf8'));
  assert.equal(realSw.ok, true, realSw.errors.join('\n'));
  const builtSw = assessBuiltServiceWorker(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8'));
  assert.equal(builtSw.ok, true, builtSw.errors.join('\n'));
});

test('apache config mismatch and missing staging block the corresponding gates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-htaccess-'));
  fs.writeFileSync(path.join(dir, 'bad.htaccess'), 'RewriteRule ^index\\.html$ / [R=301,L]\n');
  fs.copyFileSync(htaccessPath, path.join(dir, 'good.htaccess'));
  assert.equal(assessHtaccessMatch(path.join(dir, 'bad.htaccess'), htaccessPath).ok, false);
  assert.equal(assessHtaccessMatch(path.join(dir, 'good.htaccess'), htaccessPath).ok, true);

  const staging = assessStagingEnvironment({});
  assert.equal(staging.present, false);
  const production = assessStagingEnvironment({
    RELEASE_STAGING_BASE_URL: 'https://driftdwells.com',
    RELEASE_STAGING_STRIPE_MODE: 'test'
  });
  assert.equal(production.ok, false);
  const liveStripe = assessStagingEnvironment({
    RELEASE_STAGING_BASE_URL: 'https://staging.example.test',
    RELEASE_STAGING_STRIPE_MODE: 'live',
    RELEASE_STAGING_ALLOW_PAYMENT_INIT: '1'
  });
  assert.equal(liveStripe.ok, false);
  const ready = assessStagingEnvironment({
    RELEASE_STAGING_BASE_URL: 'https://staging.example.test',
    RELEASE_STAGING_STRIPE_MODE: 'test',
    RELEASE_STAGING_ALLOW_PAYMENT_INIT: '1'
  });
  assert.equal(ready.ok, true);
  const envOnly = path.join(dir, 'env-only.json');
  fs.writeFileSync(envOnly, JSON.stringify({
    frontendRelease: 'e'.repeat(40),
    coverage: { staging: 'isolated-staging-integration' }
  }));
  assert.throws(
    () => assertReleaseSafetyReport(envOnly, 'e'.repeat(40), { verifyRun: () => {} }),
    /staging/i
  );

  const decision = decideRelease({
    routing: { ok: true },
    faultyRedirectDetected: true,
    assets: { ok: true },
    payment: { ok: true },
    serviceWorker: { ok: true },
    htaccess: { ok: true },
    staging
  });
  assert.equal(decision.artifactOk, true);
  assert.equal(decision.deployOk, false);
  assert.ok(decision.deploymentBlockers.includes('missing-staging-environment'));

  const brokenRoute = decideRelease({
    routing: { ok: false },
    faultyRedirectDetected: true,
    assets: { ok: true },
    payment: { ok: true },
    serviceWorker: { ok: true },
    htaccess: { ok: true },
    staging: { present: true }
  });
  assert.equal(brokenRoute.artifactOk, false);
  assert.ok(brokenRoute.artifactBlockers.includes('apache-routing'));
});

test('rollback restores the shell and keeps the previous hashed asset', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-webroot-'));
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-dist-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(root, 'index.html'), 'old-shell');
  fs.writeFileSync(path.join(root, 'sw.js'), 'old-sw');
  fs.writeFileSync(path.join(root, '.htaccess'), 'old-htaccess');
  fs.writeFileSync(path.join(root, 'assets/old-app.js'), 'old-js');
  fs.writeFileSync(path.join(dist, 'index.html'), 'new-shell');
  fs.writeFileSync(path.join(dist, 'sw.js'), 'new-sw');
  fs.writeFileSync(path.join(dist, '.htaccess'), 'new-htaccess');
  fs.writeFileSync(path.join(dist, 'assets/new-app.js'), 'new-js');

  const reportPath = path.join(root, 'report.json');
  const releaseSha = 'c'.repeat(40);
  const evidence = buildPassingEvidence(releaseSha, '9001');
  fs.writeFileSync(reportPath, JSON.stringify({
    frontendRelease: releaseSha,
    workflowRunId: '9001',
    evidence
  }));

  const activated = await activateTestedRelease({
    distDir: dist,
    webroot: root,
    reportPath,
    releaseSha,
    requirePaymentContract: false,
    verifyRun: () => {},
    probe: async () => ({ ok: false, errors: ['/checkout redirected to the homepage'] })
  });
  assert.equal(activated.rolledBack, true);
  assert.equal(activated.snapshot.snapshotDir.startsWith(`${root}${path.sep}`), false);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'old-shell');
  assert.equal(fs.readFileSync(path.join(root, '.htaccess'), 'utf8'), 'old-htaccess');
  assert.equal(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), 'old-sw');
  assert.equal(fs.existsSync(path.join(root, 'assets/old-app.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'assets/new-app.js')), true);

  const kept = executeLocalPublish({ distDir: dist, webroot: root, requirePaymentContract: false });
  assert.ok(kept.assetsWritten.includes('new-app.js'));
  assert.throws(
    () => snapshotFrontendShell(root, path.join(root, '.release-snapshots', 'manual')),
    /document root/
  );
  const snap = snapshotFrontendShell(root, resolveSnapshotDir(root, 'd'.repeat(40)));
  fs.writeFileSync(path.join(root, 'index.html'), 'broken-shell');
  restoreFrontendShell(root, snap.snapshotDir);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), 'new-shell');
});

test('publication refuses a report that did not pass staging coverage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-report-'));
  const reportPath = path.join(dir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    artifactOk: true,
    deployOk: false,
    deploymentBlockers: ['missing-staging-environment'],
    frontendRelease: 'd'.repeat(40),
    coverage: { browser: 'mocked-apache-artifact', staging: null }
  }));
  assert.throws(
    () => assertReleaseSafetyReport(reportPath, 'd'.repeat(40)),
    /staging/i
  );
  const attempted = buildPassingEvidence('d'.repeat(40), '9001');
  attempted.staging.responses[1].status = 500;
  attempted.staging.responses[1].success = false;
  assert.ok(assertStagingEvidence(attempted.staging, 'd'.repeat(40), '9001').some((error) => /finalize-intent/.test(error)));
});
