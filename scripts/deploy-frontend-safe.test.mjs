import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertNoProtectedPathsDeleted,
  buildRemoteRsyncPhases,
  buildRsyncCommand,
  copyDirAdditive,
  executeLocalPublish,
  isProtectedPath,
  listHashedAssets,
  mergeReleaseManifest,
  validateWebroot
} from './deploy-frontend-safe.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const deployScript = path.join(__dirname, 'deploy-frontend-safe.mjs');

function runCLI(args = [], env = {}) {
  return spawnSync(
    process.execPath,
    [deployScript, ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } }
  );
}

/** Extract the trailing JSON summary block from CLI stdout. */
function parseCLISummary(stdout) {
  // The summary is the last {...} block in stdout (may be multi-line).
  const start = stdout.lastIndexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start === -1 || end === -1) throw new SyntaxError('No JSON block found in CLI stdout');
  return JSON.parse(stdout.slice(start, end + 1));
}

// ---------------------------------------------------------------------------
// Helper: create a minimal dist-like tree in a temp directory
// ---------------------------------------------------------------------------

function makeMockDist(tmpRoot) {
  const dist = path.join(tmpRoot, 'client', 'dist');
  const assets = path.join(dist, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'index-abc123.js'), '// entry');
  fs.writeFileSync(path.join(assets, 'OpsReservationDetail-xyz.js'), '// ops chunk');
  fs.writeFileSync(path.join(assets, 'vendor-lPz.js'), '// vendor');
  fs.writeFileSync(path.join(assets, 'index-CSvj.css'), '/* css */');
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(dist, 'sw.js'), '// service worker');
  fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{}');
  fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *');
  return dist;
}

function makeMockWebroot(tmpRoot) {
  const webroot = path.join(tmpRoot, 'domains', 'driftdwells.com', 'public_html');
  fs.mkdirSync(webroot, { recursive: true });
  // Pre-existing protected files
  fs.mkdirSync(path.join(webroot, 'uploads', 'cabins'), { recursive: true });
  fs.writeFileSync(path.join(webroot, 'uploads', 'cabins', 'photo.jpg'), 'jpg');
  fs.writeFileSync(path.join(webroot, 'index.html.backup-2026-08-30'), 'old-backup');
  fs.writeFileSync(path.join(webroot, '.htaccess.bk-1'), 'old htaccess backup');
  // Pre-existing old hashed assets from a previous release
  fs.mkdirSync(path.join(webroot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webroot, 'assets', 'OpsReservationDetail-OLD.js'), '// old chunk');
  fs.writeFileSync(path.join(webroot, 'assets', 'index-OLD.js'), '// old entry');
  return webroot;
}

// ---------------------------------------------------------------------------
// validateWebroot
// ---------------------------------------------------------------------------

test('validateWebroot rejects empty', () => {
  assert.equal(validateWebroot('').valid, false);
  assert.equal(validateWebroot(null).valid, false);
  assert.equal(validateWebroot(undefined).valid, false);
});

test('validateWebroot rejects root /', () => {
  assert.equal(validateWebroot('/').valid, false);
});

test('validateWebroot rejects repo root', () => {
  assert.equal(validateWebroot('/my/repo', { repoRoot: '/my/repo' }).valid, false);
});

test('validateWebroot rejects client/dist itself', () => {
  assert.equal(validateWebroot('/my/repo/client/dist', { distDir: '/my/repo/client/dist' }).valid, false);
});

test('validateWebroot rejects shallow paths', () => {
  assert.equal(validateWebroot('/home').valid, false);
  assert.equal(validateWebroot('/var').valid, false);
});

test('validateWebroot accepts valid deep paths', () => {
  const result = validateWebroot('/home/illoc/domains/driftdwells.com/public_html');
  assert.equal(result.valid, true);
  assert.equal(result.resolved, '/home/illoc/domains/driftdwells.com/public_html');
});

// ---------------------------------------------------------------------------
// Local WEBROOT publication: assets before shell, no delete
// ---------------------------------------------------------------------------

test('executeLocalPublish writes assets first, shell last, in correct order', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-local-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  const result = executeLocalPublish({ distDir: dist, webroot, dryRun: false });

  // Check phase ordering from log
  const phaseNames = result.log.map((e) => e.phase);
  assert.equal(phaseNames[0], 'assets-additive');
  assert.equal(phaseNames[1], 'static-without-shell');
  assert.equal(phaseNames[2], 'shell-last');

  // Assets were written
  assert.ok(fs.existsSync(path.join(webroot, 'assets', 'index-abc123.js')));
  assert.ok(fs.existsSync(path.join(webroot, 'assets', 'OpsReservationDetail-xyz.js')));
  assert.ok(fs.existsSync(path.join(webroot, 'assets', 'vendor-lPz.js')));

  // Shell was written
  assert.ok(fs.existsSync(path.join(webroot, 'index.html')));
  assert.equal(fs.readFileSync(path.join(webroot, 'index.html'), 'utf8'), '<!doctype html>');
  assert.ok(fs.existsSync(path.join(webroot, 'sw.js')));

  // Static files were written
  assert.ok(fs.existsSync(path.join(webroot, 'manifest.webmanifest')));
  assert.ok(fs.existsSync(path.join(webroot, 'robots.txt')));
});

test('executeLocalPublish does NOT delete old hashed assets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-nodelete-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  executeLocalPublish({ distDir: dist, webroot, dryRun: false });

  // Old assets must still exist (additive — never delete)
  assert.ok(fs.existsSync(path.join(webroot, 'assets', 'OpsReservationDetail-OLD.js')));
  assert.ok(fs.existsSync(path.join(webroot, 'assets', 'index-OLD.js')));
});

test('executeLocalPublish preserves uploads and protected files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-protect-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  executeLocalPublish({ distDir: dist, webroot, dryRun: false });

  // Uploads untouched
  assert.ok(fs.existsSync(path.join(webroot, 'uploads', 'cabins', 'photo.jpg')));
  assert.equal(fs.readFileSync(path.join(webroot, 'uploads', 'cabins', 'photo.jpg'), 'utf8'), 'jpg');

  // Backup files untouched
  assert.ok(fs.existsSync(path.join(webroot, 'index.html.backup-2026-08-30')));
  assert.ok(fs.existsSync(path.join(webroot, '.htaccess.bk-1')));
});

test('executeLocalPublish dry-run writes no files (byte-for-byte unchanged)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-dryrun-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  // Snapshot entire webroot before
  function snapshotDir(dir) {
    const snap = {};
    if (!fs.existsSync(dir)) return snap;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (entry.isFile()) {
        const full = path.join(entry.path || dir, entry.name);
        const rel = path.relative(dir, full);
        snap[rel] = fs.readFileSync(full);
      }
    }
    return snap;
  }

  const before = snapshotDir(webroot);

  const result = executeLocalPublish({ distDir: dist, webroot, dryRun: true });

  const after = snapshotDir(webroot);

  // Same set of keys
  assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort());

  // Same content for every file
  for (const rel of Object.keys(before)) {
    assert.deepEqual(before[rel], after[rel], `file changed: ${rel}`);
  }

  // Log still reports phases with dryRun flag set
  assert.ok(result.log.length >= 3);
  assert.ok(result.log.every((e) => e.dryRun === true));
});

// ---------------------------------------------------------------------------
// Remote rsync phases
// ---------------------------------------------------------------------------

test('buildRemoteRsyncPhases never deletes assets', () => {
  const phases = buildRemoteRsyncPhases({
    distDir: '/tmp/client/dist',
    remoteRoot: 'user@host:/var/www/public_html'
  });

  assert.equal(phases.length, 3);
  assert.equal(phases[0].name, 'assets-additive');
  assert.equal(phases[0].delete, false);
  assert.match(phases[0].destination, /\/assets$/);
  assert.equal(phases[1].delete, false);
  assert.equal(phases[2].name, 'shell-last');
  assert.equal(phases[2].delete, false);
  assert.deepEqual(phases[2].includes, ['index.html', 'sw.js']);
});

test('rsync command never contains --delete', () => {
  const phases = buildRemoteRsyncPhases({
    distDir: '/tmp/client/dist',
    remoteRoot: 'user@host:/var/www/public_html'
  });

  for (const phase of phases) {
    const cmd = buildRsyncCommand(phase, { dryRun: false });
    assert.doesNotMatch(cmd, /--delete/, `phase ${phase.name} must not have --delete`);
  }
});

test('rsync command includes --dry-run when requested', () => {
  const cmd = buildRsyncCommand({
    source: '/tmp/dist/assets',
    destination: 'host:/www/assets',
    delete: false,
    excludes: []
  }, { dryRun: true });

  assert.match(cmd, /--dry-run/);
  assert.doesNotMatch(cmd, /--delete/);
});

test('REMOTE phases do not affect local WEBROOT publication contract', () => {
  // The local executeLocalPublish function does not use rsync at all.
  // This test asserts both modes exist independently.
  const phases = buildRemoteRsyncPhases({
    distDir: '/tmp/dist',
    remoteRoot: 'host:/www'
  });
  assert.ok(phases.length > 0);

  // Local mode uses a completely different code path
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-independent-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);
  const result = executeLocalPublish({ distDir: dist, webroot, dryRun: true });
  assert.ok(result.log.length > 0);
});

// ---------------------------------------------------------------------------
// Protected paths and manifest
// ---------------------------------------------------------------------------

test('isProtectedPath covers uploads, manifest, backups', () => {
  assert.equal(isProtectedPath('uploads/cabins/a.jpg'), true);
  assert.equal(isProtectedPath('release-manifest.json'), true);
  assert.equal(isProtectedPath('index.html.backup-2026-08-31'), true);
  assert.equal(isProtectedPath('.htaccess.bk-1'), true);
  assert.equal(isProtectedPath('assets/index-abc.js'), false);
});

test('assertNoProtectedPathsDeleted blocks unsafe deletes', () => {
  assert.throws(
    () => assertNoProtectedPathsDeleted(['uploads/foo.jpg', 'assets/dead.js']),
    /uploads/
  );
  assert.doesNotThrow(() => assertNoProtectedPathsDeleted(['assets/dead.js']));
});

test('mergeReleaseManifest retains previous hashed assets', () => {
  const merged = mergeReleaseManifest(
    {
      frontendRelease: 'release-a',
      assetFiles: ['index-old.js', 'OpsReservationDetail-old.js']
    },
    { frontendRelease: 'release-b', ok: true },
    ['index-new.js', 'OpsReservationDetail-new.js']
  );

  assert.deepEqual(merged.assetFiles, ['index-new.js', 'OpsReservationDetail-new.js']);
  assert.ok(merged.retainedAssetFiles.includes('OpsReservationDetail-old.js'));
  assert.ok(merged.retainedAssetFiles.includes('OpsReservationDetail-new.js'));
  assert.equal(merged.deployStrategy, 'additive-no-delete');
});

test('listHashedAssets reads dist/assets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-list-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir);
  fs.writeFileSync(path.join(assetsDir, 'index-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(assetsDir, 'readme.txt'), 'nope');

  assert.deepEqual(listHashedAssets(assetsDir), ['index-abc.js']);
});

// ---------------------------------------------------------------------------
// CLI argument handling
// ---------------------------------------------------------------------------

test('--help exits 0 without WEBROOT/REMOTE and prints usage', () => {
  const result = runCLI(['--help'], { WEBROOT: '', REMOTE: '' });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /WEBROOT=/);
  assert.match(result.stdout, /--dry-run/);
  assert.match(result.stdout, /--help/);
});

test('unknown flag fails closed with exit 1', () => {
  const result = runCLI(['--foo'], { WEBROOT: '/some/valid/deep/path', REMOTE: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown flag/);
});

test('no WEBROOT and no REMOTE fails closed with exit 1', () => {
  const result = runCLI([], { WEBROOT: '', REMOTE: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL/);
});

test('--dry-run from argv is honoured: no files written, output reports dryRun true', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cli-dryrun-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  // Snapshot webroot before CLI run
  const assetsBefore = fs.readdirSync(path.join(webroot, 'assets')).sort();
  const webrootFilesBefore = fs.readdirSync(webroot).sort();

  const result = runCLI(['--dry-run'], {
    WEBROOT: webroot,
    REMOTE: '',
    // Deliberately do NOT set DRY_RUN env var — flag must be sufficient
    DRY_RUN: '',
    // Point PREVIOUS_MANIFEST somewhere that does not exist so manifest read is a no-op
    PREVIOUS_MANIFEST: path.join(tmp, 'no-such-manifest.json')
  });

  // CLI must succeed
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);

  // Output must report dryRun: true
  const summary = parseCLISummary(result.stdout);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.mode, 'local');

  // Assets on disk must be unchanged
  const assetsAfter = fs.readdirSync(path.join(webroot, 'assets')).sort();
  assert.deepEqual(assetsBefore, assetsAfter);

  // No new top-level files created in webroot
  const webrootFilesAfter = fs.readdirSync(webroot).sort();
  assert.deepEqual(webrootFilesBefore, webrootFilesAfter);

  // Manifest must not have been written into dist
  // (we passed a nonexistent PREVIOUS_MANIFEST; dist manifest may already exist
  // from a previous build but must not have been overwritten by this CLI invocation)
  // The safest assertion: sw.js must not have appeared in webroot (it isn't there initially)
  assert.ok(!fs.existsSync(path.join(webroot, 'sw.js')));
});

test('DRY_RUN=1 env var is also honoured when no --dry-run flag', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cli-dryrun-env-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  const result = runCLI([], {
    WEBROOT: webroot,
    REMOTE: '',
    DRY_RUN: '1',
    PREVIOUS_MANIFEST: path.join(tmp, 'no-such-manifest.json')
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const summary = parseCLISummary(result.stdout);
  assert.equal(summary.dryRun, true);
  assert.ok(!fs.existsSync(path.join(webroot, 'sw.js')));
});

test('without --dry-run flag an actual local publish writes files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cli-real-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  const result = runCLI([], {
    WEBROOT: webroot,
    REMOTE: '',
    DRY_RUN: '',
    PREVIOUS_MANIFEST: path.join(tmp, 'no-such-manifest.json')
  });

  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const summary = parseCLISummary(result.stdout);
  assert.equal(summary.dryRun, false);

  // Files should now exist in webroot (CLI publishes from real client/dist)
  assert.ok(fs.existsSync(path.join(webroot, 'index.html')));
  assert.ok(fs.existsSync(path.join(webroot, 'sw.js')));
  // At least some JS assets were published
  const publishedAssets = fs.existsSync(path.join(webroot, 'assets'))
    ? fs.readdirSync(path.join(webroot, 'assets')).filter((f) => f.endsWith('.js'))
    : [];
  assert.ok(publishedAssets.length > 0, 'expected at least one JS asset in webroot/assets');
});
