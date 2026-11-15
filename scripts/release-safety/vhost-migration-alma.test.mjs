import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSiteSharedAssetsMapping, migrateSiteVhost, recoverSiteVhostMigration } from './vhost-migration.mjs';
import { activateVerifiedProduction, recoverVerifiedProduction, rollbackToObservedProduction } from './activate-production.mjs';
import { createInventory } from './frontend-inventory.mjs';
import { renderAlmaFixture } from './fixtures/directadmin/alma-renderer.mjs';

const enabled = process.env.RUN_ALMA_HTTPD_TEST === '1';
const image = process.env.ALMA_HTTPD_TEST_IMAGE || 'drift-wishlist-httpd-validation:local';
const cliModule = fileURLToPath(new URL('./vhost-migration.mjs', import.meta.url));

function command(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function removeTree(root) {
  if (!fs.existsSync(root)) return;
  function makeWritable(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) makeWritable(target);
      else if (entry.isFile()) fs.chmodSync(target, 0o600);
    }
    fs.chmodSync(dir, 0o700);
  }
  makeWritable(root);
  fs.rmSync(root, { recursive: true, force: true });
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function httpGet(port, route, host = 'www.driftdwells.com') {
  return new Promise((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1', port, path: route,
      headers: {
        Host: host, Connection: 'close', 'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache'
      },
      timeout: 5000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error(`HTTP timeout: ${route}`)));
    request.on('error', reject);
  });
}

const unrelatedQueueEntry = 'action=unrelated&value=preserve';
const reloadQueueEntry = 'action=httpd&value=reload';

function containerRunner(container, regenerate, queuePath) {
  const run = (executable, args) => {
    if (executable === '/usr/bin/cp') return command(executable, args);
    if (executable === '/usr/local/directadmin/directadmin') {
      assert.deepEqual(args, ['taskq', '--run=action=rewrite&value=httpd&user=illoc']);
      regenerate();
      const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
      queue.push(reloadQueueEntry);
      fs.writeFileSync(queuePath, JSON.stringify(queue));
      return { status: 0, stdout: '', stderr: '' };
    }
    if (executable !== '/usr/sbin/httpd') {
      throw new Error(`Unexpected integration command: ${executable}`);
    }
    assert.ok(!args.includes('graceful'), 'rewrite must not implicitly reload Apache');
    return command('docker', ['exec', container, '/usr/sbin/httpd', ...args]);
  };
  return { run };
}

function confirmQuiescedAndPersistent() {
  return {
    confirmWebrootQuiesced: true,
    confirmDirectAdminAccount: true,
    confirmSharedAssetsPolicy: true
  };
}

test('real AlmaLinux httpd vhost migration installs first-use assets, serves preserved routes, and recovers/rolls back', {
  skip: !enabled ? 'set RUN_ALMA_HTTPD_TEST=1 to run the isolated AlmaLinux Docker fixture' : false,
  timeout: 120_000
}, async t => {
  const root = path.join(process.cwd(), `.alma-vhost-fixture-${process.pid}-${Date.now()}`);
  fs.mkdirSync(root);
  fs.chmodSync(root, 0o755);
  const container = `dd-vhost-migration-${process.pid}-${Date.now()}`;
  let started = false;
  t.after(() => {
    if (started) command('docker', ['stop', container]);
    removeTree(root);
  });

  const original = path.join(root, 'domains', 'driftdwells.com', 'public_html');
  const releaseRoot = path.join(root, 'releases', 'frontend');
  const sharedAssets = path.join(root, 'shared', 'assets');
  const pointer = path.join(root, 'releases', 'current');
  const stateParent = path.join(root, 'private');
  const state = path.join(stateParent, 'migration-one');
  const recoveryState = path.join(stateParent, 'migration-interrupted');
  const configRoot = path.join(root, 'etc', 'httpd');
  const siteConfig = path.join(configRoot, 'users', 'illoc', 'httpd.conf');
  const customConfig = path.join(configRoot, 'users', 'illoc', 'domains', 'driftdwells.com.cust_httpd');
  const apacheConfig = path.join(configRoot, 'httpd.conf');
  const backend = path.join(root, 'backend');
  const testSite = path.join(root, 'domains', 'test.driftdwells.com', 'public_html');
  const queuePath = path.join(root, 'directadmin-task-queue.json');
  const candidateSiteConfig = path.join(configRoot, 'candidate-site.conf');
  const candidateApacheConfig = path.join(configRoot, 'candidate-httpd.conf');
  const originalOnlyMarker = path.join(original, 'original-only-marker.txt');
  const originalOnlyToken = 'original webroot after migration';

  for (const dir of [original, releaseRoot, sharedAssets, stateParent, path.dirname(pointer),
    path.dirname(customConfig), backend, testSite]) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  fs.writeFileSync(queuePath, JSON.stringify([unrelatedQueueEntry]));
  for (const relative of ['search', 'checkout', 'legal', 'assets']) {
    fs.mkdirSync(path.join(original, relative), { recursive: true });
  }
  fs.mkdirSync(path.join(backend, 'api'), { recursive: true });
  fs.mkdirSync(path.join(backend, 'uploads'), { recursive: true });
  const originalIndex = '<html>original site<script src="/assets/app.js"></script></html>';
  fs.writeFileSync(path.join(original, 'index.html'), originalIndex);
  fs.writeFileSync(path.join(original, 'search', 'index.html'), 'search route');
  fs.writeFileSync(path.join(original, 'checkout', 'index.html'), 'checkout route');
  fs.writeFileSync(path.join(original, 'legal', 'index.html'), 'original legal content');
  fs.writeFileSync(path.join(original, 'assets', 'app.js'), 'first migration asset bytes');
  fs.writeFileSync(path.join(original, '.htaccess'), 'Options -Indexes\n');
  fs.writeFileSync(path.join(original, 'uploads-placeholder.txt'), 'unrelated root file');
  fs.writeFileSync(path.join(backend, 'api', 'health'), 'api proxy response');
  fs.writeFileSync(path.join(backend, 'uploads', 'customer-file.txt'), 'customer upload bytes');
  fs.writeFileSync(path.join(testSite, 'index.html'), 'independent test site');

  const assetBytes = fs.readFileSync(path.join(original, 'assets', 'app.js'));
  const assets = [{ path: 'assets/app.js', size: assetBytes.length, sha256: sha256(assetBytes) }];
  const customSource = fs.readFileSync(new URL('./fixtures/directadmin/cust_httpd.conf', import.meta.url), 'utf8')
    .replaceAll('/home/illoc/domains/driftdwells.com/public_html', original)
    .replaceAll('127.0.0.1:5000', '127.0.0.1:8081');
  fs.writeFileSync(customConfig, customSource);
  const regenerate = () => fs.writeFileSync(siteConfig,
    renderAlmaFixture(fs.readFileSync(customConfig, 'utf8'), { original, testSite, backend }));
  const originalSiteConfig = renderAlmaFixture(customSource, { original, testSite, backend });
  fs.writeFileSync(siteConfig, originalSiteConfig);
  fs.writeFileSync(apacheConfig, `ServerRoot "/etc/httpd"
Include conf.modules.d/*.conf
ServerName localhost
Listen 80
Listen 8081
Listen 443
PidFile "${path.join(root, 'httpd.pid')}"
ErrorLog /dev/stderr
CustomLog /dev/stdout combined
TypesConfig /etc/mime.types
DirectoryIndex index.html
<Directory />
  AllowOverride All
  Options All -MultiViews -Indexes +SymLinksIfOwnerMatch
  Require all granted
</Directory>
Include "${siteConfig}"
`);

  const launched = command('docker', [
    'run', '-d', '--rm', '--name', container, '-p', '127.0.0.1::80',
    '-v', `${root}:${root}`,
    image, '/usr/sbin/httpd', '-f', apacheConfig, '-DFOREGROUND'
  ]);
  assert.equal(launched.status, 0, launched.stderr);
  started = true;
  const osRelease = command('docker', ['exec', container, 'cat', '/etc/os-release']);
  assert.equal(osRelease.status, 0, osRelease.stderr);
  assert.match(osRelease.stdout, /^ID="?almalinux"?$/m, 'integration container must be AlmaLinux');
  const portResult = command('docker', ['port', container, '80/tcp']);
  assert.equal(portResult.status, 0, portResult.stderr);
  const port = Number(portResult.stdout.trim().split(':').pop());
  assert.ok(Number.isInteger(port) && port > 0, `Invalid mapped Apache port: ${portResult.stdout}`);

  const waitFor = async (predicate, label) => {
    let lastError;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        if (await predicate()) return;
      } catch (error) {
        lastError = error;
        if (!['ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error.code)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
  };
  await waitFor(async () => (await httpGet(port, '/')).status === 200, 'Initial Apache');

  const runner = containerRunner(container, regenerate, queuePath);
  const assertQueuePreserved = () => {
    const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    assert.ok(queue.includes(unrelatedQueueEntry), 'unrelated DirectAdmin queue entry must be preserved');
    return queue;
  };
  const validateProposedConfig = async ({ expectedConfig, siteConfig: site, apacheConfig: apache, pointer: proposedPointer, phase }) => {
    assert.equal(phase, 'migration');
    assert.equal(site, siteConfig);
    assert.equal(apache, apacheConfig);
    assert.equal(proposedPointer, pointer);
    assert.equal(fs.readFileSync(customConfig, 'utf8'), customSource, 'validate before persistent mutation');
    assert.equal(fs.readFileSync(siteConfig, 'utf8'), originalSiteConfig, 'validate before generated config mutation');
    // This syntax-checks the proposed output; it does not validate the real DirectAdmin generator.
    fs.writeFileSync(candidateSiteConfig, expectedConfig);
    fs.writeFileSync(candidateApacheConfig,
      fs.readFileSync(apacheConfig, 'utf8').replace(`Include "${siteConfig}"`, `Include "${candidateSiteConfig}"`));
    const result = command('docker', ['exec', container, '/usr/sbin/httpd', '-t', '-f', candidateApacheConfig]);
    assert.equal(result.status, 0, result.stderr);
    return { ok: true };
  };
  let expectMigratedBeforeRollback = true;
  const verifyReload = async ({ phase, pointer: reloadPointer, release, siteConfig: site }) => {
    assert.equal(reloadPointer, pointer);
    assert.equal(site, siteConfig);
    assert.equal(fs.readlinkSync(pointer), release);
    const queue = assertQueuePreserved();
    assert.ok(queue.includes(reloadQueueEntry), 'DirectAdmin rewrite must queue a delayed reload');
    let markerPath;
    let expectedBody;
    if (phase === 'migration') {
      const marker = fs.readdirSync(release).find(name => /^vhost-migration-.*-probe\.txt$/.test(name));
      assert.ok(marker, 'migration must expose a release-only marker');
      markerPath = `/${marker}`;
      expectedBody = fs.readFileSync(path.join(release, marker), 'utf8');
      assert.equal((await httpGet(port, markerPath)).status, 404, 'rewrite alone must not reload Apache');
    } else {
      assert.equal(phase, 'rollback');
      markerPath = '/original-only-marker.txt';
      expectedBody = originalOnlyToken;
      const before = await httpGet(port, markerPath);
      if (expectMigratedBeforeRollback) {
        assert.equal(before.status, 404, 'old migrated vhost remains active before reload');
      } else {
        assert.equal(before.body.toString(), expectedBody, 'interrupted rewrite did not reload Apache');
      }
    }
    const result = command('docker', ['exec', container, '/usr/sbin/httpd', '-k', 'graceful', '-f', apacheConfig]);
    assert.equal(result.status, 0, result.stderr);
    await waitFor(async () => {
      const response = await httpGet(port, markerPath);
      return response.status === 200 && response.body.toString() === expectedBody;
    }, `${phase} effective Apache reload`);
    fs.writeFileSync(queuePath, JSON.stringify(queue.filter(entry => entry !== reloadQueueEntry)));
    assertQueuePreserved();
    for (const route of ['/search/', '/checkout/', '/api/health', '/uploads/customer-file.txt']) {
      assert.equal((await httpGet(port, route)).status, 200, `${phase} route ${route}`);
    }
    assert.equal((await httpGet(port, '/', 'test.driftdwells.com')).body.toString(), 'independent test site');
    return { ok: true };
  };
  const probeRoutes = async ({ verificationPath, verificationToken } = {}) => {
    for (const route of ['/search/', '/checkout/']) {
      const response = await httpGet(port, route);
      if (response.status !== 200) return { ok: false, route, status: response.status };
    }
    if (!verificationPath || !verificationToken) return { ok: true };
    const marker = await httpGet(port, verificationPath);
    return {
      ok: marker.status === 200 && marker.body.toString() === verificationToken,
      pointerVerified: marker.status === 200 && marker.body.toString() === verificationToken
    };
  };
  const verifyAssetServing = async ({ sharedAssets: store, assets: manifest, siteConfig: configPath, siteConfigSha256, mapping }) => {
    assert.equal(store, sharedAssets);
    assert.equal(sha256(fs.readFileSync(configPath)), siteConfigSha256);
    assert.deepEqual(assertSiteSharedAssetsMapping(fs.readFileSync(configPath, 'utf8'), sharedAssets), mapping);
    for (const asset of manifest) {
      const response = await httpGet(port, `/${asset.path}?bypass=${crypto.randomBytes(8).toString('hex')}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.location, undefined, 'asset verification must not follow or accept redirects');
      assert.equal(response.body.length, asset.size);
      assert.equal(sha256(response.body), asset.sha256);
    }
    return { ok: true };
  };
  const args = stateRoot => ({
    siteConfig, customConfig, directadmin: '/usr/local/directadmin/directadmin',
    directadminUser: 'illoc', apacheConfig, documentRoot: original, sharedAssets, assets,
    releasesRoot: releaseRoot, pointer, stateRoot,
    httpd: '/usr/sbin/httpd', copyCommand: '/usr/bin/cp',
    ...confirmQuiescedAndPersistent(),
    preflightProbe: probeRoutes, probe: probeRoutes, verifyAssetServing, validateProposedConfig, verifyReload,
    run: runner.run
  });
  const assertPreservedRoutes = async ({ site = originalIndex, legal = 'original legal content' } = {}) => {
    assert.equal((await httpGet(port, '/')).body.toString(), site);
    assert.equal((await httpGet(port, '/legal/')).body.toString(), legal);
    const api = await httpGet(port, '/api/health');
    assert.equal(api.status, 200);
    assert.equal(api.body.toString(), 'api proxy response');
    const upload = await httpGet(port, '/uploads/customer-file.txt');
    assert.equal(upload.status, 200);
    assert.equal(upload.body.toString(), 'customer upload bytes');
    assert.equal((await httpGet(port, '/', 'test.driftdwells.com')).body.toString(), 'independent test site');
  };
  await assertPreservedRoutes();
  assert.equal(fs.existsSync(path.join(sharedAssets, 'app.js')), false, 'shared asset must not pre-exist');

  const migrated = await migrateSiteVhost({
    ...args(state), preflightProbe: probeRoutes,
    probe: probeRoutes,
    verifyAssetServing
  });
  assert.equal(migrated.status, 'active');
  assert.equal(fs.lstatSync(pointer).uid, fs.statSync(migrated.documentRoot).uid);
  assert.equal(fs.lstatSync(pointer).gid, fs.statSync(migrated.documentRoot).gid);
  assert.equal(fs.existsSync(path.join(sharedAssets, 'app.js')), true, 'first migration must publish the shared asset');
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes');
  assert.equal(fs.statSync(path.join(sharedAssets, 'app.js')).mode & 0o222, 0);
  await waitFor(async () => (await httpGet(port, '/search/')).body.toString() === 'search route', 'Migrated search route');
  await assertPreservedRoutes();
  const staticAsset = await httpGet(port, '/assets/app.js');
  assert.equal(staticAsset.status, 200);
  assert.equal(staticAsset.body.toString(), 'first migration asset bytes');

  const activationState = path.join(root, 'activation-state');
  fs.mkdirSync(activationState);
  const candidateSource = path.join(root, 'candidate-source');
  fs.cpSync(original, candidateSource, { recursive: true });
  const candidateIndex = '<html>candidate site<script src="/assets/new.js"></script></html>';
  fs.writeFileSync(path.join(candidateSource, 'index.html'), candidateIndex);
  fs.writeFileSync(path.join(candidateSource, 'assets', 'new.js'), 'candidate asset');
  const candidateSha = 'a'.repeat(40);
  const candidateInventory = createInventory(candidateSource, candidateSha, 'production');
  const activation = {
    runId: '42', commit: candidateSha, previousCommit: 'observed-production',
    expectedApiRelease: 'b'.repeat(40), key: 'pk_live_fixture', token: 'fixture',
    releases: releaseRoot, state: activationState, pointer, sharedAssets, migrationState: state,
    originIp: '127.0.0.1',
    download: ({ destination, commit }) => {
      assert.equal(commit, candidateSha, 'observed snapshot must not be downloaded or labeled as a commit');
      fs.cpSync(candidateSource, destination, { recursive: true });
      return { ok: true, inventory: candidateInventory };
    },
    verifyAssets: ({ assets: manifest }) => verifyAssetServing({
      sharedAssets, assets: manifest, siteConfig,
      siteConfigSha256: sha256(fs.readFileSync(siteConfig)),
      mapping: assertSiteSharedAssetsMapping(fs.readFileSync(siteConfig, 'utf8'), sharedAssets)
    }),
    smoke: async ({ releaseAsset }) => {
      const expected = releaseAsset === '/assets/new.js' ? candidateIndex : originalIndex;
      const response = await httpGet(port, '/');
      return { ok: response.status === 200 && response.body.toString() === expected };
    }
  };
  const savedIndex = path.join(migrated.documentRoot, 'index.html');
  fs.chmodSync(savedIndex, 0o644);
  fs.writeFileSync(savedIndex, 'tampered snapshot');
  await assert.rejects(activateVerifiedProduction(activation), /Observed migration rollback integrity/);
  fs.writeFileSync(savedIndex, originalIndex);
  fs.chmodSync(savedIndex, 0o444);
  await assert.rejects(activateVerifiedProduction({ ...activation, smoke: async ({ releaseAsset }) =>
    releaseAsset === '/assets/new.js' ? { ok: false } : activation.smoke({ releaseAsset })
  }), /previous release restored/);
  await assertPreservedRoutes();
  await activateVerifiedProduction(activation);
  await assertPreservedRoutes({ site: candidateIndex });
  await rollbackToObservedProduction(activation);
  await assertPreservedRoutes();
  await activateVerifiedProduction(activation);
  await assertPreservedRoutes({ site: candidateIndex });
  fs.writeFileSync(path.join(activationState, 'pending.json'), JSON.stringify({
    version: 1, previous: migrated.documentRoot, candidate: path.join(releaseRoot, candidateSha), pointer
  }));
  await recoverVerifiedProduction(activation);
  await assertPreservedRoutes();

  fs.writeFileSync(originalOnlyMarker, originalOnlyToken);
  assert.equal((await httpGet(port, '/original-only-marker.txt')).status, 404);
  let uncertainReloadCalled = false;
  await assert.rejects(recoverSiteVhostMigration({
    stateRoot: state, run: runner.run, rollback: true,
    verifyReload: async ({ phase, pointer: reloadPointer, release, siteConfig: site }) => {
      uncertainReloadCalled = true;
      assert.equal(phase, 'rollback');
      assert.equal(reloadPointer, pointer);
      assert.equal(site, siteConfig);
      assert.equal(fs.readlinkSync(pointer), release);
      assert.ok(assertQueuePreserved().includes(reloadQueueEntry));
      assert.equal((await httpGet(port, '/original-only-marker.txt')).status, 404,
        'a generated config alone must not count as an effective reload');
      return { ok: false };
    }
  }));
  assert.equal(uncertainReloadCalled, true);
  assert.equal(fs.existsSync(pointer), true, 'uncertain reload must retain the pointer');
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(state, 'vhost-migration.json'), 'utf8')).status,
    'rolled-back', 'unverified rollback must not be reported as completed');
  const rollback = await recoverSiteVhostMigration({ stateRoot: state, run: runner.run, rollback: true, verifyReload });
  assert.equal(rollback.status, 'rolled-back');
  await waitFor(async () => (await httpGet(port, '/')).body.toString() === originalIndex, 'Rolled-back site');
  await assertPreservedRoutes();
  assert.equal(fs.existsSync(pointer), true, 'even a verified rollback retains the pointer');
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes',
    'append-only shared assets remain available after rollback');

  fs.unlinkSync(pointer);
  fs.unlinkSync(originalOnlyMarker);
  const childScript = `
    import { migrateSiteVhost } from ${JSON.stringify(cliModule)};
    import { renderAlmaFixture } from ${JSON.stringify(fileURLToPath(new URL('./fixtures/directadmin/alma-renderer.mjs', import.meta.url)))};
    import fs from 'node:fs';
    import { spawnSync } from 'node:child_process';
    const options = JSON.parse(process.env.VHOST_MIGRATION_OPTIONS);
    let syntaxTests = 0;
    options.run = (executable, args) => {
      if (executable === '/usr/bin/cp') {
        const result = spawnSync(executable, args, { encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
      }
      if (executable === '/usr/local/directadmin/directadmin') {
        if (JSON.stringify(args) !== JSON.stringify(['taskq', '--run=action=rewrite&value=httpd&user=illoc'])) {
          throw new Error('Unexpected regeneration arguments');
        }
        fs.writeFileSync(${JSON.stringify(siteConfig)},
          renderAlmaFixture(fs.readFileSync(${JSON.stringify(customConfig)}, 'utf8'),
            ${JSON.stringify({ original, testSite, backend })}));
        const queue = JSON.parse(fs.readFileSync(${JSON.stringify(queuePath)}, 'utf8'));
        queue.push(${JSON.stringify(reloadQueueEntry)});
        fs.writeFileSync(${JSON.stringify(queuePath)}, JSON.stringify(queue));
        return { status: 0, stdout: '', stderr: '' };
      }
      if (executable !== '/usr/sbin/httpd') throw new Error('Unexpected migration command: ' + executable);
      if (args.includes('-k') && args.includes('graceful')) {
        throw new Error('rewrite must not implicitly reload Apache');
      }
      if (args.includes('-t') && !args.includes('DUMP_INCLUDES') && ++syntaxTests === 2) process.exit(77);
      const result = spawnSync('docker', ['exec', ${JSON.stringify(container)}, executable, ...args], { encoding: 'utf8' });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    };
    options.preflightProbe = async () => ({ ok: true });
    options.probe = async () => ({ ok: true, pointerVerified: true });
    options.verifyAssetServing = async () => ({ ok: true });
    options.validateProposedConfig = async ({ expectedConfig }) => {
      fs.writeFileSync(${JSON.stringify(candidateSiteConfig)}, expectedConfig);
      fs.writeFileSync(${JSON.stringify(candidateApacheConfig)},
        fs.readFileSync(${JSON.stringify(apacheConfig)}, 'utf8').replace(
          ${JSON.stringify(`Include "${siteConfig}"`)}, ${JSON.stringify(`Include "${candidateSiteConfig}"`)}));
      const result = spawnSync('docker', ['exec', ${JSON.stringify(container)}, '/usr/sbin/httpd', '-t',
        '-f', ${JSON.stringify(candidateApacheConfig)}], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
      return { ok: true };
    };
    options.verifyReload = async () => { throw new Error('interruption must precede reload verification'); };
    await migrateSiteVhost(options);
  `;
  const childOptions = args(recoveryState);
  const childEnv = {
    ...process.env,
    VHOST_MIGRATION_OPTIONS: JSON.stringify({
      ...childOptions,
      httpd: '/usr/sbin/httpd',
      copyCommand: '/usr/bin/cp',
      ...confirmQuiescedAndPersistent()
    })
  };
  const interrupted = spawnSync(process.execPath, ['--input-type=module', '-e', childScript], {
    encoding: 'utf8',
    env: childEnv
  });
  assert.equal(interrupted.status, 77, `Expected deliberate interrupted migration: ${interrupted.stderr}`);
  assert.equal(fs.existsSync(path.join(recoveryState, 'vhost-migration.json')), true);
  const interruptedJournal = JSON.parse(fs.readFileSync(path.join(recoveryState, 'vhost-migration.json'), 'utf8'));
  assert.equal(interruptedJournal.status, 'config-installed');
  assert.equal(fs.readFileSync(siteConfig, 'utf8').includes(pointer), true);
  assert.equal(fs.existsSync(pointer), true);

  fs.writeFileSync(originalOnlyMarker, originalOnlyToken);
  expectMigratedBeforeRollback = false;
  const recoveryRunner = containerRunner(container, regenerate, queuePath);
  const recovered = await recoverSiteVhostMigration({ stateRoot: recoveryState, run: recoveryRunner.run, verifyReload });
  assert.equal(recovered.status, 'recovered');
  assert.equal(fs.readFileSync(siteConfig, 'utf8'), originalSiteConfig);
  assert.equal(fs.existsSync(pointer), true, 'interrupted recovery must retain the pointer');
  await waitFor(async () => (await httpGet(port, '/')).body.toString() === originalIndex, 'Interrupted migration recovery');
  await assertPreservedRoutes();
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes');

  fs.unlinkSync(pointer);
  const validationState = path.join(stateParent, 'migration-invalid-proposal');
  const queueBeforeValidation = fs.readFileSync(queuePath, 'utf8');
  let proposalChecked = false;
  await assert.rejects(migrateSiteVhost({
    ...args(validationState),
    validateProposedConfig: async info => {
      proposalChecked = true;
      await validateProposedConfig(info);
      return { ok: false };
    }
  }), /proposed|validation/i);
  assert.equal(proposalChecked, true);
  assert.equal(fs.readFileSync(customConfig, 'utf8'), customSource);
  assert.equal(fs.readFileSync(siteConfig, 'utf8'), originalSiteConfig);
  assert.equal(fs.readFileSync(queuePath, 'utf8'), queueBeforeValidation, 'rejected proposal must not trigger rewrite');
  assert.equal(fs.existsSync(pointer), true, 'pre-mutation recovery retains any published pointer');
  await assertPreservedRoutes();

  fs.unlinkSync(pointer);
  const failedReloadState = path.join(stateParent, 'migration-reload-uncertain');
  const phases = [];
  await assert.rejects(migrateSiteVhost({
    ...args(failedReloadState),
    verifyReload: async ({ phase, pointer: reloadPointer, release, siteConfig: site }) => {
      phases.push(phase);
      assert.equal(reloadPointer, pointer);
      assert.equal(site, siteConfig);
      assert.equal(fs.readlinkSync(pointer), release);
      assert.ok(assertQueuePreserved().includes(reloadQueueEntry));
      return { ok: false };
    }
  }), /recovery|reload/i);
  assert.deepEqual(phases, ['migration', 'rollback']);
  assert.equal(fs.existsSync(pointer), true, 'failed migration and uncertain rollback retain the pointer');
  assert.equal(JSON.parse(fs.readFileSync(path.join(failedReloadState, 'vhost-migration.json'), 'utf8')).status,
    'recovery-required');
  await assertPreservedRoutes();
  const retry = await recoverSiteVhostMigration({ stateRoot: failedReloadState, run: runner.run, verifyReload });
  assert.equal(retry.status, 'recovered');
  assert.equal(fs.existsSync(pointer), true);
  assert.deepEqual(assertQueuePreserved(), [unrelatedQueueEntry]);
  await assertPreservedRoutes();
});
