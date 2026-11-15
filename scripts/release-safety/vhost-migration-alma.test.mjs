import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSiteSharedAssetsMapping, migrateSiteVhost, recoverSiteVhostMigration } from './vhost-migration.mjs';

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

function containerRunner(container) {
  const run = (executable, args) => {
    if (executable === '/usr/bin/cp') return command(executable, args);
    if (executable !== '/usr/sbin/httpd') {
      throw new Error(`Unexpected integration command: ${executable}`);
    }
    if (args.includes('-k') && args.includes('graceful')) {
      return command('docker', ['exec', container, '/usr/sbin/httpd', ...args]);
    }
    return command('docker', ['exec', container, '/usr/sbin/httpd', ...args]);
  };
  return { run, syntaxTests: () => syntaxTests };
}

function confirmQuiescedAndPersistent() {
  return {
    confirmWebrootQuiesced: true,
    confirmConfigPersistence: true,
    confirmSharedAssetsPolicy: true
  };
}

test('real AlmaLinux httpd vhost migration installs first-use assets, serves preserved routes, and recovers/rolls back', {
  skip: !enabled ? 'set RUN_ALMA_HTTPD_TEST=1 to run the isolated AlmaLinux Docker fixture' : false,
  timeout: 120_000
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-vhost-alma-'));
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
  const siteConfig = path.join(configRoot, 'users', 'illoc.conf');
  const apacheConfig = path.join(configRoot, 'httpd.conf');
  const backend = path.join(root, 'backend');
  const testSite = path.join(root, 'domains', 'test.driftdwells.com', 'public_html');

  for (const dir of [original, releaseRoot, sharedAssets, stateParent, path.dirname(pointer),
    path.dirname(siteConfig), backend, testSite]) fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const relative of ['search', 'checkout', 'legal', 'assets']) {
    fs.mkdirSync(path.join(original, relative), { recursive: true });
  }
  fs.mkdirSync(path.join(backend, 'api'), { recursive: true });
  fs.mkdirSync(path.join(backend, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(original, 'index.html'), 'original site');
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
  const siteBlock = port => `<VirtualHost *:${port}>
  ServerName www.driftdwells.com
  ServerAlias www.driftdwells.com driftdwells.com
  DocumentRoot "${original}"
  <Directory "${original}">
    Options -Indexes
    AllowOverride All
    Require all granted
  </Directory>
  Alias /legal/ ${original}/legal/
  <Directory "${original}/legal">
    Options -Indexes
    Require all granted
  </Directory>
  ProxyPass /api http://127.0.0.1:8081/api
  ProxyPassReverse /api http://127.0.0.1:8081/api
  ProxyPass /uploads http://127.0.0.1:8081/uploads
  ProxyPassReverse /uploads http://127.0.0.1:8081/uploads
</VirtualHost>`;
  const originalSiteConfig = `${siteBlock(8080)}
${siteBlock(8082).replaceAll(':8080>', ':8082>')}
<VirtualHost *:8080>
  ServerName test.driftdwells.com
  ServerAlias test.driftdwells.com staging.driftdwells.com
  DocumentRoot "${testSite}"
  <Directory "${testSite}">
    Require all granted
  </Directory>
</VirtualHost>
<VirtualHost *:8081>
  ServerName backend.local
  DocumentRoot "${backend}"
  <Directory "${backend}">
    Require all granted
  </Directory>
</VirtualHost>`;
  fs.writeFileSync(siteConfig, originalSiteConfig);
  fs.writeFileSync(apacheConfig, `ServerRoot "/etc/httpd"
Include conf.modules.d/*.conf
ServerName localhost
Listen 8080
Listen 8081
Listen 8082
PidFile /tmp/dd-vhost-migration.pid
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
    'run', '-d', '--rm', '--name', container, '-p', '127.0.0.1::8080',
    '-v', `${root}:${root}`,
    image, '/usr/sbin/httpd', '-f', apacheConfig, '-DFOREGROUND'
  ]);
  assert.equal(launched.status, 0, launched.stderr);
  started = true;
  const osRelease = command('docker', ['exec', container, 'cat', '/etc/os-release']);
  assert.equal(osRelease.status, 0, osRelease.stderr);
  assert.match(osRelease.stdout, /^ID="?almalinux"?$/m, 'integration container must be AlmaLinux');
  const portResult = command('docker', ['port', container, '8080/tcp']);
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

  const runner = containerRunner(container);
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
    siteConfig, apacheConfig, documentRoot: original, sharedAssets, assets,
    releasesRoot: releaseRoot, pointer, stateRoot,
    httpd: '/usr/sbin/httpd', copyCommand: '/usr/bin/cp',
    reloadCommand: '/usr/sbin/httpd', reloadArgs: ['-k', 'graceful', '-f', apacheConfig],
    ...confirmQuiescedAndPersistent(),
    preflightProbe: probeRoutes, probe: probeRoutes, verifyAssetServing,
    run: runner.run
  });
  const assertPreservedRoutes = async ({ site = 'original site', legal = 'original legal content' } = {}) => {
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
  assert.equal(fs.existsSync(path.join(sharedAssets, 'app.js')), true, 'first migration must publish the shared asset');
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes');
  assert.equal(fs.statSync(path.join(sharedAssets, 'app.js')).mode & 0o222, 0);
  await waitFor(async () => (await httpGet(port, '/search/')).body.toString() === 'search route', 'Migrated search route');
  await assertPreservedRoutes({ site: 'original site' });
  const staticAsset = await httpGet(port, '/assets/app.js');
  assert.equal(staticAsset.status, 200);
  assert.equal(staticAsset.body.toString(), 'first migration asset bytes');

  const rollback = recoverSiteVhostMigration({ stateRoot: state, run: runner.run, rollback: true });
  assert.equal(rollback.status, 'rolled-back');
  await waitFor(async () => (await httpGet(port, '/')).body.toString() === 'original site', 'Rolled-back site');
  await assertPreservedRoutes();
  assert.equal(fs.existsSync(path.join(pointer)), false);
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes',
    'append-only shared assets remain available after rollback');

  const childScript = `
    import { migrateSiteVhost } from ${JSON.stringify(cliModule)};
    import { spawnSync } from 'node:child_process';
    const options = JSON.parse(process.env.VHOST_MIGRATION_OPTIONS);
    let syntaxTests = 0;
    options.run = (executable, args) => {
      if (executable === '/usr/bin/cp') {
        const result = spawnSync(executable, args, { encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
      }
      if (executable !== '/usr/sbin/httpd') throw new Error('Unexpected migration command: ' + executable);
      if (args.includes('-k') && args.includes('graceful')) {
        const result = spawnSync('docker', ['exec', ${JSON.stringify(container)}, executable, ...args], { encoding: 'utf8' });
        return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
      }
      if (args.includes('-t') && !args.includes('DUMP_INCLUDES') && ++syntaxTests === 2) process.exit(77);
      const result = spawnSync('docker', ['exec', ${JSON.stringify(container)}, executable, ...args], { encoding: 'utf8' });
      return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
    };
    options.preflightProbe = async () => ({ ok: true });
    options.probe = async () => ({ ok: true, pointerVerified: true });
    options.verifyAssetServing = async () => ({ ok: true });
    await migrateSiteVhost(options);
  `;
  const childOptions = args(recoveryState);
  const childEnv = {
    ...process.env,
    VHOST_MIGRATION_OPTIONS: JSON.stringify({
      ...childOptions,
      httpd: '/usr/sbin/httpd',
      copyCommand: '/usr/bin/cp',
      reloadCommand: '/usr/sbin/httpd',
      reloadArgs: ['-k', 'graceful', '-f', apacheConfig],
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

  const recoveryRunner = containerRunner(container);
  const recovered = recoverSiteVhostMigration({ stateRoot: recoveryState, run: recoveryRunner.run });
  assert.equal(recovered.status, 'recovered');
  assert.equal(fs.readFileSync(siteConfig, 'utf8'), originalSiteConfig);
  assert.equal(fs.existsSync(pointer), false);
  await waitFor(async () => (await httpGet(port, '/')).body.toString() === 'original site', 'Interrupted migration recovery');
  await assertPreservedRoutes();
  assert.equal(fs.readFileSync(path.join(sharedAssets, 'app.js'), 'utf8'), 'first migration asset bytes');
});
