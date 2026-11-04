#!/usr/bin/env node
/**
 * Artifact gate for a compiled client/dist.
 * Exits non-zero unless Apache routing, the faulty-redirect regression,
 * asset references, the payment contract and the service worker all pass.
 * Deployment stays blocked until isolated staging is configured.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { idsThatFailed, runRoutingAgainstHtaccess } from './run-routing.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(repoRoot, 'client/dist');
const htaccessPath = path.join(repoRoot, 'client/public/.htaccess');
const swSourcePath = path.join(repoRoot, 'client/src/sw.js');
const reportPath = process.env.RELEASE_SAFETY_REPORT || path.join(repoRoot, 'release-safety-report.json');

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('[release-safety] BLOCK: client/dist is missing. Build the production artifact first.');
  process.exit(2);
}

const htaccess = fs.readFileSync(htaccessPath, 'utf8');
const htaccessCheck = assessHtaccessMatch(path.join(distDir, '.htaccess'), htaccessPath);
const assets = assessReferencedAssets(distDir);
const payment = assessPaymentRelease(distDir);
const serviceWorker = assessServiceWorkerSource(fs.readFileSync(swSourcePath, 'utf8'));
const builtSw = assessBuiltServiceWorker(fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8'));
if (!builtSw.ok) {
  serviceWorker.ok = false;
  serviceWorker.errors = [...serviceWorker.errors, ...builtSw.errors];
}

const routing = htaccessCheck.ok
  ? await runRoutingAgainstHtaccess(distDir, htaccess)
  : { ok: false, failures: htaccessCheck.errors, results: [] };
const faulty = await runRoutingAgainstHtaccess(distDir, faultyIndexRedirect(htaccess));
const failedIds = idsThatFailed(faulty);
const faultyRedirectDetected = failedIds.includes('search') && failedIds.includes('checkout') && faulty.ok === false;
const staging = assessStagingEnvironment(process.env);
const decision = decideRelease({
  routing,
  faultyRedirectDetected,
  assets,
  payment,
  serviceWorker,
  htaccess: htaccessCheck,
  staging
});

const report = {
  ...decision,
  frontendRelease: process.env.VITE_FRONTEND_RELEASE || null,
  faultyFailedIds: failedIds,
  routingFailures: routing.failures,
  coverage: {
    apache: 'apache-2.4-htaccess',
    browser: process.env.RELEASE_SAFETY_BROWSER_COVERAGE || null,
    staging: staging.ok ? 'isolated-staging-integration' : null
  }
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportPath, ...decision, faultyFailedIds: failedIds }, null, 2));
if (!decision.artifactOk) process.exit(1);
if (process.env.RELEASE_SAFETY_REQUIRE_DEPLOY === '1' && !decision.deployOk) process.exit(2);
