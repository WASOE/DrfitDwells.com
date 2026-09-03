import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('executeLocalPublish dry-run writes no files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-dryrun-'));
  const dist = makeMockDist(tmp);
  const webroot = makeMockWebroot(tmp);

  // Capture state before
  const assetsBefore = fs.readdirSync(path.join(webroot, 'assets')).sort();

  const result = executeLocalPublish({ distDir: dist, webroot, dryRun: true });

  // No new assets written
  const assetsAfter = fs.readdirSync(path.join(webroot, 'assets')).sort();
  assert.deepEqual(assetsBefore, assetsAfter);

  // Shell not overwritten
  assert.ok(!fs.existsSync(path.join(webroot, 'sw.js')));

  // Log still reports phases
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
