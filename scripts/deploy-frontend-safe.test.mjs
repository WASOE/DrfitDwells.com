import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import prerenderContract from '../client/scripts/prerender-contract.cjs';
import {
  assertNoProtectedPathsDeleted,
  buildRemoteRsyncPhases,
  buildRsyncCommand,
  copyDirAdditive,
  executeLocalPublish,
  ensureAvifMimeType,
  isProtectedPath,
  listHashedAssets,
  mergeReleaseManifest,
  validateWebroot
} from './deploy-frontend-safe.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_RELEASE_SHA = 'a'.repeat(40);
const NEXT_RELEASE_SHA = 'b'.repeat(40);
const routeRegistry = fs.readFileSync(path.join(__dirname, '../client/src/data/publicSeoRoutes.json'), 'utf8');
const publicRoutes = JSON.parse(routeRegistry);

function createValidRouteHtml(route) {
  const context = prerenderContract.getSeoValidationContext(route);
  const entry = publicRoutes.find((item) => item.path === context.entry.path);
  const title = `Public ${route} | Drift & Dwells`;
  const description = 'Useful public information for this mountain retreat and its accommodation.';
  const image = `https://driftdwells.com${entry.ogImage}`;
  const alternates = context.alternatePaths
    .map(({ hreflang, path: alternatePath }) => `<link rel="alternate" hreflang="${hreflang}" href="https://driftdwells.com${alternatePath}">`)
    .join('');
  const schema = context.requiredSchemaTypes.map((type) => {
    if (type === 'FAQPage') {
      return {
        '@context': 'https://schema.org',
        '@type': type,
        mainEntity: [{
          '@type': 'Question',
          name: 'What is included in a stay?',
          acceptedAnswer: { '@type': 'Answer', text: 'A comfortable place to stay in the mountains.' }
        }]
      };
    }
    return { '@context': 'https://schema.org', '@type': type };
  });
  const schemas = schema.map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`).join('');
  const faqCopy = context.requiredSchemaTypes.includes('FAQPage')
    ? '<h2>What is included in a stay?</h2><p>A comfortable place to stay in the mountains.</p>'
    : '';
  return `<!doctype html><html lang="${context.locale}"><head>
    <title>${title}</title><meta name="description" content="${description}">
    <link rel="canonical" href="https://driftdwells.com${context.canonicalPath}">${alternates}
    <meta property="og:title" content="${title}"><meta property="og:description" content="${description}">
    <meta property="og:type" content="website"><meta property="og:url" content="https://driftdwells.com${context.canonicalPath}">
    <meta property="og:image" content="${image}"><meta property="og:image:alt" content="${title}">
    <meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}">
    <meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${image}">
    ${schemas}</head><body><div id="root" data-prerender-route="${route}"><main><h1>${prerenderContract.getExpectedHeading(route)}</h1>
    ${faqCopy}<p>${'Public accommodation information. '.repeat(10)}</p></main></div></body></html>`;
}

function runCLI(args = [], env = {}, { invalidRoute, missingRoute, verificationOnly = false, verificationRoute } = {}) {
  const sandbox = fs.mkdtempSync(path.join(__dirname, '.deploy-cli-test-'));
  try {
    for (const relative of [
      'scripts/deploy-frontend-safe.mjs', 'scripts/deploy-frontend-safe.lib.mjs',
      'client/scripts/prerender-contract.cjs', 'client/src/data/publicSeoRoutes.json'
    ]) {
      const target = path.join(sandbox, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', relative), target);
    }
    fs.symlinkSync(path.join(__dirname, '../client/node_modules'), path.join(sandbox, 'client/node_modules'), 'dir');
    const dist = makeMockDist(sandbox);
    for (const route of prerenderContract.ROUTES) {
      const output = prerenderContract.artifactPath(dist, route);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, createValidRouteHtml(route));
    }
    if (invalidRoute) fs.writeFileSync(prerenderContract.artifactPath(dist, invalidRoute), '<div id="root"></div>');
    if (missingRoute) fs.unlinkSync(prerenderContract.artifactPath(dist, missingRoute));
    if (verificationOnly) fs.writeFileSync(path.join(dist, `${prerenderContract.VERIFICATION_MARKER}.json`), '{}');
    if (verificationRoute) {
      const file = prerenderContract.artifactPath(dist, verificationRoute);
      const html = fs.readFileSync(file, 'utf8').replace('</head>', `<meta name="${prerenderContract.VERIFICATION_MARKER}" content="not-for-publication"></head>`);
      fs.writeFileSync(file, html);
    }
    return spawnSync(
      process.execPath,
      [path.join(sandbox, 'scripts/deploy-frontend-safe.mjs'), ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_FRONTEND_RELEASE: TEST_RELEASE_SHA,
          ...env
        }
      }
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true });
  }
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
  assert.equal(phaseNames[2], 'uploads-additive');
  assert.equal(phaseNames[3], 'shell-last');

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

test('executeLocalPublish additively publishes application uploads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-uploads-'));
  const dist = path.join(root, 'dist');
  const webroot = path.join(root, 'webroot');
  const uploads = path.join(root, 'uploads');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(uploads, 'Content website'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'assets', 'app.js'), 'new');
  fs.writeFileSync(path.join(dist, 'index.html'), 'shell');
  fs.writeFileSync(path.join(uploads, 'Content website', 'photo.avif'), 'photo');

  const result = executeLocalPublish({ distDir: dist, webroot, uploadsDir: uploads });

  assert.equal(result.log.find((entry) => entry.phase === 'uploads-additive').files, 1);
  assert.equal(
    fs.readFileSync(path.join(webroot, 'uploads', 'Content website', 'photo.avif'), 'utf8'),
    'photo'
  );
});

test('ensureAvifMimeType preserves existing htaccess rules and is idempotent', () => {
  const webroot = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-mime-'));
  const htaccess = path.join(webroot, '.htaccess');
  fs.writeFileSync(htaccess, 'RewriteEngine On\n');

  assert.equal(ensureAvifMimeType(webroot), true);
  assert.match(fs.readFileSync(htaccess, 'utf8'), /RewriteEngine On/);
  assert.match(fs.readFileSync(htaccess, 'utf8'), /AddType image\/avif \.avif/);
  assert.equal(ensureAvifMimeType(webroot), false);
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
      assetFiles: ['index-current.js'],
      retainedAssetFiles: ['index-old.js', 'index-current.js']
    },
    { frontendRelease: 'release-b', ok: true },
    ['index-new.js', 'OpsReservationDetail-new.js']
  );

  assert.deepEqual(merged.assetFiles, ['index-new.js', 'OpsReservationDetail-new.js']);
  assert.ok(merged.retainedAssetFiles.includes('index-old.js'));
  assert.ok(merged.retainedAssetFiles.includes('index-current.js'));
  assert.ok(merged.retainedAssetFiles.includes('OpsReservationDetail-new.js'));
  assert.equal(merged.deployStrategy, 'additive-no-delete');
});

test('publisher CLI refreshes the release id while retaining prior assets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cli-release-id-'));
  try {
    const dist = makeMockDist(tmp);
    const webroot = makeMockWebroot(tmp);
    fs.writeFileSync(path.join(webroot, 'release-manifest.json'), JSON.stringify({
      ok: true,
      frontendRelease: 'old-release',
      applicationCommit: 'old-release',
      assetFiles: ['assets/old.js'],
      retainedAssetFiles: ['assets/old.js']
    }));
    const result = runCLI([], {
      WEBROOT: webroot,
      REMOTE: '',
      DRY_RUN: '',
      VITE_FRONTEND_RELEASE: NEXT_RELEASE_SHA
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(webroot, 'release-manifest.json'), 'utf8'));
    assert.equal(manifest.frontendRelease, NEXT_RELEASE_SHA);
    assert.equal(manifest.applicationCommit, NEXT_RELEASE_SHA);
    assert.ok(manifest.retainedAssetFiles.includes('assets/old.js'));
    assert.ok(manifest.retainedAssetFiles.includes('index-abc123.js'));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('publisher refuses to reuse a stale manifest release id when the new SHA is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cli-missing-release-id-'));
  try {
    const dist = makeMockDist(tmp);
    const webroot = makeMockWebroot(tmp);
    fs.writeFileSync(path.join(webroot, 'release-manifest.json'), JSON.stringify({
      frontendRelease: 'old-release',
      assetFiles: ['assets/old.js']
    }));
    const result = runCLI([], {
      WEBROOT: webroot,
      REMOTE: '',
      DRY_RUN: '',
      VITE_FRONTEND_RELEASE: '',
      GIT_COMMIT: ''
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /full release commit SHA before publication/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(webroot, 'release-manifest.json'), 'utf8')).frontendRelease, 'old-release');
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('listHashedAssets reads dist/assets', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-deploy-list-'));
  const assetsDir = path.join(tmp, 'assets');
  fs.mkdirSync(assetsDir);
  fs.writeFileSync(path.join(assetsDir, 'index-abc.js'), 'console.log(1)');
  fs.writeFileSync(path.join(assetsDir, 'readme.txt'), 'nope');

  assert.deepEqual(listHashedAssets(assetsDir), ['index-abc.js']);
});

test('nested prerender HTML survives local and remote static publication while root HTML is last', () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.prerender-publish-test-'));
  try {
    const dist = makeMockDist(tmp);
    const relative = path.join('bg', 'stays', 'the-cabin', 'index.html');
    fs.mkdirSync(path.dirname(path.join(dist, relative)), { recursive: true });
    fs.writeFileSync(path.join(dist, relative), '<h1>Public stay</h1>');
    const localRoot = path.join(tmp, 'local-public-html');
    const local = executeLocalPublish({ distDir: dist, webroot: localRoot });
    assert.ok(local.staticWritten.includes(relative));
    assert.ok(local.shellWritten.includes('index.html'));

    const remoteRoot = path.join(tmp, 'remote-public-html');
    fs.mkdirSync(remoteRoot);
    // Reproduce the old unanchored rsync exclusion, which matches every basename.
    const old = spawnSync('rsync', ['-a', '--exclude=index.html', `${dist}/`, `${remoteRoot}/`], { encoding: 'utf8' });
    assert.equal(old.status, 0, old.stderr);
    assert.ok(!fs.existsSync(path.join(remoteRoot, relative)));

    const phase = buildRemoteRsyncPhases({ distDir: dist, remoteRoot })[1];
    const result = spawnSync('rsync', [
      '-a', ...phase.excludes.map((exclude) => `--exclude=${exclude}`),
      phase.source, phase.destination
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(remoteRoot, relative), 'utf8'), '<h1>Public stay</h1>');
    assert.ok(!fs.existsSync(path.join(remoteRoot, 'index.html')));
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
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

test('CLI refuses a generic home artifact before any publication', () => {
  const tmp = fs.mkdtempSync(path.join(__dirname, '.invalid-prerender-test-'));
  try {
    const webroot = makeMockWebroot(tmp);
    const before = fs.readdirSync(webroot).sort();
    const result = runCLI([], { WEBROOT: webroot, REMOTE: '', DRY_RUN: '' }, { invalidRoute: '/' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Required prerender output is invalid/);
    assert.deepEqual(fs.readdirSync(webroot).sort(), before);
  } finally {
    fs.rmSync(tmp, { recursive: true });
  }
});

test('CLI refuses verification-only artifacts before publication even in dry-run mode', () => {
  const result = runCLI(['--dry-run'], { WEBROOT: '/tmp/seo-verification/not-published', REMOTE: '' }, { verificationOnly: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must never be published/);
  assert.doesNotMatch(result.stdout, /LOCAL mode|REMOTE mode/);
});

test('CLI rejects a missing required nested artifact before any publication', () => {
  const result = runCLI(['--dry-run'], { WEBROOT: '/tmp/seo-verification/not-published', REMOTE: '' }, { missingRoute: '/bg/stays/stone-house' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Required prerender output is invalid:.*ENOENT/);
  assert.doesNotMatch(result.stdout, /LOCAL mode|REMOTE mode/);
});

test('CLI rejects mixed output with only a nested verification page and no marker JSON', () => {
  const result = runCLI(['--dry-run'], { WEBROOT: '/tmp/seo-verification/not-published', REMOTE: '' }, { verificationRoute: '/bg/stays/stone-house' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must never be published/);
  assert.doesNotMatch(result.stdout, /LOCAL mode|REMOTE mode/);
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

  // Files should now exist in the fixture webroot.
  assert.ok(fs.existsSync(path.join(webroot, 'index.html')));
  assert.ok(fs.existsSync(path.join(webroot, 'sw.js')));
  // At least some JS assets were published
  const publishedAssets = fs.existsSync(path.join(webroot, 'assets'))
    ? fs.readdirSync(path.join(webroot, 'assets')).filter((f) => f.endsWith('.js'))
    : [];
  assert.ok(publishedAssets.length > 0, 'expected at least one JS asset in webroot/assets');
});
