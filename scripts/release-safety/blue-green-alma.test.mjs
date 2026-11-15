import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInventory } from './frontend-inventory.mjs';
import { activateRelease } from './blue-green.mjs';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';

test('AlmaLinux httpd serves an isolated switch, proxied uploads and independent test vhost', {
  skip: process.env.RUN_ALMA_HTTPD_TEST !== '1' ? 'set RUN_ALMA_HTTPD_TEST=1 with the local test image' : false
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-alma-httpd-'));
  fs.chmodSync(root, 0o755);
  const name = `dd-httpd-${process.pid}-${Date.now()}`;
  let started = false;
  t.after(() => {
    if (started) spawnSync('docker', ['stop', name], { stdio: 'ignore' });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const releases = path.join(root, 'releases');
  const state = path.join(root, 'state');
  const pointer = path.join(root, 'current');
  const sharedAssets = path.join(root, 'assets');
  fs.mkdirSync(releases);
  fs.mkdirSync(state);
  fs.mkdirSync(sharedAssets);
  fs.chmodSync(sharedAssets, 0o755);
  for (const name of ['old', 'new']) {
    const dir = path.join(releases, name);
    fs.mkdirSync(path.join(dir, 'bg', 'wishlist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), name);
    fs.writeFileSync(path.join(dir, 'bg', 'wishlist', 'index.html'), `${name}-nested`);
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', `${name}.js`), `${name}-asset`);
    fs.copyFileSync(new URL('../../client/public/.htaccess', import.meta.url), path.join(dir, '.htaccess'));
  }
  const previous = path.join(releases, 'old');
  const candidate = path.join(releases, 'new');
  fs.symlinkSync('releases/old', pointer);
  fs.mkdirSync(path.join(root, 'original', 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, 'original', 'test', 'index.html'), 'test-site');
  fs.mkdirSync(path.join(root, 'original', 'legal'));
  fs.writeFileSync(path.join(root, 'original', 'legal', 'index.html'), 'legal');
  fs.mkdirSync(path.join(root, 'backend', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'uploads', 'sample.txt'), 'upload');
  fs.writeFileSync(path.join(root, 'httpd.conf'), `
ServerRoot "/etc/httpd"
Include conf.modules.d/*.conf
ServerName localhost
Listen 8080
Listen 8081
PidFile /tmp/drift-httpd.pid
ErrorLog /dev/stderr
User apache
Group apache
TypesConfig /etc/mime.types
DirectoryIndex index.html
<Directory />
  AllowOverride All
  Options All -MultiViews -Indexes +SymLinksIfOwnerMatch +IncludesNoExec +Includes
  Require all granted
</Directory>
<VirtualHost *:8080>
  ServerName driftdwells.com
  ServerAlias www.driftdwells.com
  DocumentRoot "${root}/current"
  Alias /legal/ "${root}/original/legal/"
  ${apacheSharedAssetsDirectives(sharedAssets)}
  ProxyPass /uploads http://127.0.0.1:8081/uploads
  ProxyPassReverse /uploads http://127.0.0.1:8081/uploads
  ProxyPass /api http://127.0.0.1:8081/api
  ProxyPassReverse /api http://127.0.0.1:8081/api
</VirtualHost>
<VirtualHost *:8080>
  ServerName test.driftdwells.com
  DocumentRoot "${root}/original/test"
</VirtualHost>
<VirtualHost *:8081>
  ServerName backend.local
  DocumentRoot "${root}/backend"
</VirtualHost>
`);
  const result = spawnSync('docker', ['run', '-d', '--rm', '--name', name,
    '-p', '127.0.0.1::8080', '-v', `${root}:${root}:ro`,
    'drift-wishlist-httpd-validation:local', '/usr/sbin/httpd', '-f', `${root}/httpd.conf`, '-DFOREGROUND'],
  { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  started = true;
  const portResult = spawnSync('docker', ['port', name, '8080/tcp'], { encoding: 'utf8' });
  assert.equal(portResult.status, 0, portResult.stderr);
  const port = Number(portResult.stdout.trim().split(':').pop());
  const get = (route, host = 'driftdwells.com') => new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: route,
      headers: { Host: host, 'X-Forwarded-Proto': 'https', Connection: 'close' } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
  });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await get('/')).status === 200) { ready = true; break; }
    } catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'AlmaLinux Apache did not become ready');
  assert.equal((await get('/bg/wishlist/')).text, 'old-nested');
  assert.equal((await get('/uploads/sample.txt')).text, 'upload');
  assert.equal((await get('/', 'test.driftdwells.com')).text, 'test-site');
  const args = { releases, pointer, state, candidate, sharedAssets,
    inventory: createInventory(candidate, 'a'.repeat(40), 'production'),
    previousInventory: createInventory(previous, 'b'.repeat(40), 'production'),
    verifyAssetServing: async ({ assets }) => {
      for (const asset of assets) {
        const response = await get(`/${asset.path}`);
        assert.equal(response.status, 200);
        assert.equal(Buffer.byteLength(response.text), asset.size);
        assert.equal(crypto.createHash('sha256').update(response.text).digest('hex'), asset.sha256);
      }
      return { ok: true };
    },
    preflight: async () => ({ ok: true }), rollbackSmoke: async () => ({ ok: true }) };
  await assert.rejects(activateRelease({ ...args, smoke: async () => {
    assert.equal((await get('/bg/wishlist/')).text, 'new-nested');
    assert.equal((await get('/uploads/sample.txt')).text, 'upload');
    assert.equal((await get('/legal/')).text, 'legal');
    assert.equal((await get('/assets/old.js')).text, 'old-asset');
    assert.equal((await get('/assets/new.js')).text, 'new-asset');
    assert.equal((await get('/', 'test.driftdwells.com')).text, 'test-site');
    return { ok: false };
  } }), /previous release restored/);
  assert.equal((await get('/bg/wishlist/')).text, 'old-nested');
  assert.equal((await get('/assets/new.js')).text, 'new-asset');
  assert.equal((await get('/legal/')).text, 'legal');
});
