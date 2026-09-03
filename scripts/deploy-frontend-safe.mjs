#!/usr/bin/env node
/**
 * Safe production frontend publication.
 *
 * CANONICAL PRODUCTION MODE (server-local):
 *   WEBROOT=/home/illoc/domains/driftdwells.com/public_html \
 *   node scripts/deploy-frontend-safe.mjs
 *
 *   DRY_RUN=1 WEBROOT=/home/illoc/domains/driftdwells.com/public_html \
 *   node scripts/deploy-frontend-safe.mjs
 *
 * OPTIONAL REMOTE MODE (staging/CI):
 *   REMOTE=user@host:/path/to/public_html node scripts/deploy-frontend-safe.mjs
 *   DRY_RUN=1 REMOTE=user@host:/path node scripts/deploy-frontend-safe.mjs
 *
 * Contract:
 * 1. Assets published first, additively — NEVER --delete on assets.
 * 2. Other static files second (excludes assets, shell, uploads).
 * 3. index.html + sw.js published LAST (switches the live shell).
 * 4. Preserved: uploads/, release-manifest.json, index.html.backup-*, .htaccess.bk-*.
 * 5. Old hashed assets accumulate. Pruning is NOT implemented in this release.
 *
 * This script does not contain secrets. SSH credentials (REMOTE mode) are
 * handled by the caller's environment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildRemoteRsyncPhases,
  buildRsyncCommand,
  executeLocalPublish,
  listHashedAssets,
  mergeReleaseManifest,
  readReleaseManifest,
  validateWebroot
} from './deploy-frontend-safe.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'client/dist');
const assetsDir = path.join(distDir, 'assets');
const manifestPath = path.join(distDir, 'release-manifest.json');

function fail(message) {
  console.error(`[deploy-frontend-safe] FAIL: ${message}`);
  process.exit(1);
}

function run(command) {
  console.log(`[deploy-frontend-safe] $ ${command}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    fail(`command failed (${result.status}): ${command}`);
  }
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

const webrootEnv = String(process.env.WEBROOT || '').trim();
const remoteEnv = String(process.env.REMOTE || '').trim();
const dryRun = process.env.DRY_RUN === '1';

if (!webrootEnv && !remoteEnv) {
  fail(
    'Set WEBROOT=/absolute/path/to/public_html (canonical production mode)\n' +
    'or REMOTE=user@host:/path (optional remote mode).'
  );
}

// ---------------------------------------------------------------------------
// Validate dist
// ---------------------------------------------------------------------------

if (!fs.existsSync(distDir)) {
  fail('client/dist missing. Run `npm run build` in client/ first.');
}
if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  fail('client/dist/index.html missing.');
}
if (!fs.existsSync(assetsDir)) {
  fail('client/dist/assets missing.');
}

// ---------------------------------------------------------------------------
// Release manifest merge
// ---------------------------------------------------------------------------

const assetFiles = listHashedAssets(assetsDir);

// Read existing manifest from webroot (preferred) or dist
const previousManifestCandidates = [
  process.env.PREVIOUS_MANIFEST,
  webrootEnv ? path.join(webrootEnv, 'release-manifest.json') : null,
  path.join(distDir, 'release-manifest.previous.json'),
  manifestPath
]
  .filter(Boolean)
  .map((p) => path.resolve(String(p)));

let previousManifest = null;
for (const candidate of previousManifestCandidates) {
  previousManifest = readReleaseManifest(candidate);
  if (previousManifest) break;
}

if (fs.existsSync(manifestPath)) {
  fs.copyFileSync(manifestPath, path.join(distDir, 'release-manifest.previous.json'));
}

const nextManifest = mergeReleaseManifest(
  previousManifest,
  previousManifest || {
    ok: true,
    frontendRelease: process.env.VITE_FRONTEND_RELEASE || null,
    buildTimestamp: new Date().toISOString()
  },
  assetFiles
);

fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

if (webrootEnv) {
  // Canonical: server-local publication
  const validation = validateWebroot(webrootEnv, { repoRoot, distDir });
  if (!validation.valid) {
    fail(validation.reason);
  }

  console.log(`[deploy-frontend-safe] LOCAL mode → ${validation.resolved}`);
  if (dryRun) {
    console.log('[deploy-frontend-safe] DRY RUN — no files will be written.');
  }

  const result = executeLocalPublish({
    distDir,
    webroot: validation.resolved,
    dryRun
  });

  for (const entry of result.log) {
    console.log(`[deploy-frontend-safe] ${entry.phase}: ${entry.files} files${entry.dryRun ? ' (dry-run)' : ''}`);
  }

} else {
  // Optional: remote rsync
  console.log(`[deploy-frontend-safe] REMOTE mode → ${remoteEnv}`);
  if (dryRun) {
    console.log('[deploy-frontend-safe] DRY RUN — rsync --dry-run will be used.');
  }

  const phases = buildRemoteRsyncPhases({ distDir, remoteRoot: remoteEnv });
  for (const phase of phases) {
    run(buildRsyncCommand(phase, { dryRun }));
  }

  // Manifest
  run(buildRsyncCommand({
    name: 'release-manifest',
    source: distDir,
    destination: remoteEnv.replace(/\/$/, ''),
    delete: false,
    includes: ['release-manifest.json']
  }, { dryRun }));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('[deploy-frontend-safe] OK');
console.log(JSON.stringify({
  mode: webrootEnv ? 'local' : 'remote',
  dryRun,
  assetFiles: assetFiles.length,
  retainedAssetFiles: nextManifest.retainedAssetFiles.length,
  deployStrategy: nextManifest.deployStrategy
}, null, 2));
