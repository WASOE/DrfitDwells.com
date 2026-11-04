#!/usr/bin/env node
/**
 * Serves client/dist through Apache and runs the mocked booking browser suite.
 * Refuses a production base URL. Does not send booking or payment requests.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkReleaseDocroot, withApache } from './apache-server.mjs';
import { assessHtaccessMatch } from './frontend-compat.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distDir = path.join(repoRoot, 'client/dist');
const htaccessPath = path.join(repoRoot, 'client/public/.htaccess');
const htaccess = assessHtaccessMatch(path.join(distDir, '.htaccess'), htaccessPath);
if (!htaccess.ok && process.env.RELEASE_SAFETY_ALLOW_HTACCESS_OVERLAY !== '1') {
  console.error('[release-safety] BLOCK browser gate.');
  htaccess.errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}
if (!htaccess.ok) {
  console.error('[release-safety] dist .htaccess does not match source; serving the source file for this local proof only.');
}

const docroot = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-browser-docroot-'));
linkReleaseDocroot(distDir, docroot, fs.readFileSync(htaccessPath, 'utf8'));

const jsonPath = path.join(os.tmpdir(), `dd-browser-${process.pid}.json`);
const exitCode = await withApache(docroot, async ({ httpsPort }) => {
  const baseURL = `https://127.0.0.1:${httpsPort}`;
  const result = spawnSync(
    'npx',
    ['playwright', 'test', 'tests/e2e/release-safety/booking-protection.spec.js', '--project=release-safety', '--project=release-safety-mobile'],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        RELEASE_GATE_BASE_URL: baseURL,
        E2E_BASE_URL: baseURL,
        RELEASE_BROWSER_JSON: jsonPath
      }
    }
  );
  return result.status ?? 1;
});

const evidencePath = process.env.RELEASE_BROWSER_EVIDENCE || path.join(repoRoot, 'browser-evidence.json');
let stats = { expected: 0, unexpected: 1, skipped: 0 };
try {
  stats = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).stats || stats;
} catch (error) {
  console.error(`[release-safety] Browser report could not be read: ${error.message}`);
  process.exit(1);
}
const evidence = {
  sha: process.env.VITE_FRONTEND_RELEASE || process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  passed: stats.expected || 0,
  failed: (stats.unexpected || 0) + (stats.flaky || 0),
  skipped: stats.skipped || 0
};
const passedCompletely = exitCode === 0 && evidence.failed === 0 && evidence.skipped === 0 && evidence.passed >= 6;
if (!passedCompletely) {
  console.error(`[release-safety] BLOCK browser gate: passed=${evidence.passed} failed=${evidence.failed} skipped=${evidence.skipped} exit=${exitCode}`);
  process.exit(exitCode || 1);
}
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
console.log(`[release-safety] browser evidence ${evidencePath} passed=${evidence.passed}`);
process.exit(0);
