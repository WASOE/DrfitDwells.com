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
        E2E_BASE_URL: baseURL
      }
    }
  );
  return result.status || 0;
});
process.exit(exitCode);
