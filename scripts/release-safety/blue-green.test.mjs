import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createInventory } from './frontend-inventory.mjs';
import { activateRelease, recoverInterruptedActivation, stageRelease } from './blue-green.mjs';
import { apacheSharedAssetsDirectives } from './shared-assets.mjs';
import { requestRelease, withApache } from './apache-server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.frontend-blue-green-'));
  t.after(() => {
    function writable(dir) {
      fs.chmodSync(dir, 0o700);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) writable(path.join(dir, entry.name));
      }
    }
    writable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const releases = path.join(root, 'releases');
  const state = path.join(root, 'state');
  const pointer = path.join(root, 'current');
  const sharedAssets = path.join(root, 'shared-assets');
  fs.mkdirSync(releases);
  fs.mkdirSync(state);
  fs.mkdirSync(sharedAssets);
  fs.chmodSync(sharedAssets, 0o755);
  for (const name of ['old', 'new']) {
    const dir = path.join(releases, name);
    fs.mkdirSync(path.join(dir, 'bg', 'wishlist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), name);
    fs.writeFileSync(path.join(dir, 'bg', 'wishlist', 'index.html'), `${name}-nested`);
  }
  const previous = path.join(releases, 'old');
  const candidate = path.join(releases, 'new');
  fs.symlinkSync(previous, pointer);
  return { root, releases, state, pointer, previous, candidate, sharedAssets,
    inventory: createInventory(candidate, 'a'.repeat(40), 'production'),
    previousInventory: createInventory(previous, 'b'.repeat(40), 'production'),
    verifyAssetServing: async () => ({ ok: true }),
    preflight: async () => ({ ok: true }), smoke: async () => ({ ok: true }), rollbackSmoke: async () => ({ ok: true }) };
}

test('switches the complete release and retains the previous release', async t => {
  const f = fixture(t);
  const result = await activateRelease(f);
  assert.equal(result.previous, f.previous);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'bg/wishlist/index.html'), 'utf8'), 'new-nested');
  assert.equal(fs.readFileSync(path.join(f.previous, 'index.html'), 'utf8'), 'old');
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), false);
});

test('stages and verifies a complete release before it becomes available', async t => {
  const f = fixture(t);
  const args = { source: f.candidate, releases: f.releases, state: f.state, inventory: f.inventory,
    verifyProvenance: async () => ({ ok: true }) };
  await assert.rejects(stageRelease({ ...args, verifyProvenance: async () => ({ ok: false }) }), /provenance/);
  const result = await stageRelease(args);
  assert.equal(path.basename(result), 'a'.repeat(40));
  assert.equal(fs.readFileSync(path.join(result, 'bg/wishlist/index.html'), 'utf8'), 'new-nested');
  assert.equal(fs.statSync(path.join(result, 'index.html')).mode & 0o222, 0);
  assert.equal(fs.statSync(result).mode & 0o777, 0o555);
  assert.equal(fs.statSync(path.join(result, 'index.html')).mode & 0o777, 0o444);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  await assert.rejects(stageRelease(args), /already exists/);
});

test('a failed staging copy cannot change the active release', async t => {
  const f = fixture(t);
  await assert.rejects(stageRelease({ source: f.candidate, releases: f.releases, state: f.state,
    inventory: f.inventory, verifyProvenance: async () => {
      fs.writeFileSync(path.join(f.candidate, 'index.html'), 'changed during upload');
      return { ok: true };
    } }), /inventory mismatch/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'bg/wishlist/index.html'), 'utf8'), 'old-nested');
  assert.equal(fs.existsSync(path.join(f.releases, 'a'.repeat(40))), false);
});

test('failed smoke or thrown error restores every file by switching the pointer', async t => {
  const f = fixture(t);
  await assert.rejects(activateRelease({ ...f, smoke: async () => ({ ok: false }) }), /previous release restored/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'bg/wishlist/index.html'), 'utf8'), 'old-nested');
  await assert.rejects(activateRelease({ ...f, smoke: async () => { throw new Error('offline'); } }), /offline/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
});

test('failed rollback smoke retains journal for recovery', async t => {
  const f = fixture(t);
  await assert.rejects(activateRelease({ ...f, smoke: async () => ({ ok: false }),
    rollbackSmoke: async () => ({ ok: false }) }), /rollback smoke failed/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), true);
  await assert.rejects(recoverInterruptedActivation({ ...f, rollbackSmoke: async () => ({ ok: false }) }), /journal retained/);
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), true);
  assert.equal((await recoverInterruptedActivation(f)).active, f.previous);
});

test('preflight, artifact changes, a directory pointer and concurrent lock fail before switch', async t => {
  const f = fixture(t);
  await assert.rejects(activateRelease({ ...f, preflight: async () => ({ ok: false }) }), /Preflight/);
  await assert.rejects(activateRelease({ ...f, preflight: async () => {
    fs.writeFileSync(path.join(f.candidate, 'index.html'), 'tampered');
    return { ok: true };
  } }), /inventory mismatch/);
  fs.writeFileSync(path.join(f.candidate, 'index.html'), 'new');
  fs.mkdirSync(path.join(f.state, 'activation.lock'));
  await assert.rejects(activateRelease(f), /EEXIST/);
  fs.rmdirSync(path.join(f.state, 'activation.lock'));
  fs.unlinkSync(f.pointer);
  fs.mkdirSync(f.pointer);
  await assert.rejects(activateRelease(f), /symbolic link/);
  assert.equal(fs.readFileSync(path.join(f.previous, 'index.html'), 'utf8'), 'old');
});

test('preserves independent inventories and retains assets across forward and reverse switches', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.previous, 'assets'));
  fs.writeFileSync(path.join(f.previous, 'assets', 'old-abc.js'), 'old asset');
  fs.mkdirSync(path.join(f.candidate, 'assets'));
  fs.writeFileSync(path.join(f.candidate, 'assets', 'new-def.js'), 'new asset');
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  await activateRelease(f);
  assert.equal(fs.existsSync(path.join(f.candidate, 'assets', 'old-abc.js')), false);
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'old-abc.js'), 'utf8'), 'old asset');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'new-def.js'), 'utf8'), 'new asset');
  await activateRelease({ ...f, candidate: f.previous, inventory: f.previousInventory, previousInventory: f.inventory });
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'new-def.js'), 'utf8'), 'new asset');
});

test('activates independently staged immutable artifacts without modifying either inventory', async t => {
  const f = fixture(t);
  for (const [dir, name] of [[f.previous, 'old-abc.js'], [f.candidate, 'new-def.js']]) {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', name), name);
  }
  const previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  const inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  const stage = (source, inv) => stageRelease({ source, releases: f.releases, state: f.state,
    inventory: inv, verifyProvenance: async () => ({ ok: true }) });
  const previous = await stage(f.previous, previousInventory);
  const candidate = await stage(f.candidate, inventory);
  fs.unlinkSync(f.pointer);
  fs.symlinkSync(previous, f.pointer);
  await activateRelease({ ...f, candidate, inventory, previousInventory });
  assert.deepEqual(createInventory(previous, previousInventory.commit, 'production'), previousInventory);
  assert.deepEqual(createInventory(candidate, inventory.commit, 'production'), inventory);
  assert.equal(fs.realpathSync(f.pointer), candidate);
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'old-abc.js'), 'utf8'), 'old-abc.js');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'new-def.js'), 'utf8'), 'new-def.js');
});

test('rejects conflicts, tampering, unsafe paths and missing serving verification before switching', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.previous, 'assets'));
  fs.mkdirSync(path.join(f.candidate, 'assets'));
  fs.writeFileSync(path.join(f.previous, 'assets', 'same.js'), 'old');
  fs.writeFileSync(path.join(f.candidate, 'assets', 'same.js'), 'new');
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  await assert.rejects(activateRelease(f), /hash conflict/);
  fs.writeFileSync(path.join(f.candidate, 'assets', 'same.js'), 'old');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  fs.writeFileSync(path.join(f.sharedAssets, 'same.js'), 'historic asset');
  await assert.rejects(activateRelease(f), /hash conflict/);
  fs.unlinkSync(path.join(f.sharedAssets, 'same.js'));
  fs.symlinkSync(path.join(f.previous, 'assets', 'same.js'), path.join(f.sharedAssets, 'same.js'));
  await assert.rejects(activateRelease(f), /Invalid shared asset/);
  fs.unlinkSync(path.join(f.sharedAssets, 'same.js'));
  await assert.rejects(activateRelease({ ...f, verifyAssetServing: async () => ({ ok: false }) }), /serving verification/);
  fs.chmodSync(path.join(f.sharedAssets, 'same.js'), 0o644);
  await assert.rejects(activateRelease(f), /Shared asset is writable/);
  fs.chmodSync(path.join(f.sharedAssets, 'same.js'), 0o444);
  await assert.rejects(activateRelease({ ...f, verifyAssetServing: async () => {
    fs.chmodSync(path.join(f.sharedAssets, 'same.js'), 0o644);
    fs.writeFileSync(path.join(f.sharedAssets, 'same.js'), 'bad');
    return { ok: true };
  } }), /hash conflict/);
  fs.unlinkSync(path.join(f.sharedAssets, 'same.js'));
  await assert.rejects(activateRelease({ ...f, verifyAssetServing: undefined }), /asset serving verification/);
  fs.writeFileSync(path.join(f.candidate, 'assets', '.hidden'), 'unsafe');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  await assert.rejects(activateRelease(f), /Unsafe asset path/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
});

test('refuses symlinked asset directories and a conflict with an older retained release', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.candidate, 'assets', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(f.candidate, 'assets', 'nested', 'bundle-abc.js'), 'candidate');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  fs.symlinkSync(f.previous, path.join(f.sharedAssets, 'nested'));
  await assert.rejects(activateRelease(f), /directory must be real/);
  fs.unlinkSync(path.join(f.sharedAssets, 'nested'));
  fs.mkdirSync(path.join(f.sharedAssets, 'nested'), { mode: 0o755 });
  fs.writeFileSync(path.join(f.sharedAssets, 'nested', 'bundle-abc.js'), 'older-release');
  fs.chmodSync(path.join(f.sharedAssets, 'nested', 'bundle-abc.js'), 0o444);
  await assert.rejects(activateRelease(f), /hash conflict/);
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'nested', 'bundle-abc.js'), 'utf8'), 'older-release');
  assert.equal(fs.realpathSync(f.pointer), f.previous);
});

test('rejects shared asset root and nested directories writable by group or others', async t => {
  const f = fixture(t);
  for (const dir of [f.previous, f.candidate]) {
    fs.mkdirSync(path.join(dir, 'assets', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'nested', 'bundle.js'), 'same');
  }
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  fs.chmodSync(f.sharedAssets, 0o777);
  await assert.rejects(activateRelease(f), /group- or world-writable/);
  fs.chmodSync(f.sharedAssets, 0o755);
  fs.mkdirSync(path.join(f.sharedAssets, 'nested'), { mode: 0o755 });
  fs.chmodSync(path.join(f.sharedAssets, 'nested'), 0o775);
  await assert.rejects(activateRelease(f), /group- or world-writable/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
});

test('interruption after switch leaves a journal for explicit complete recovery', async t => {
  const f = fixture(t);
  for (const [dir, name] of [[f.previous, 'old.js'], [f.candidate, 'new.js']]) {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'assets', name), name);
  }
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  const moduleUrl = new URL('./blue-green.mjs', import.meta.url).href;
  const script = `import {activateRelease} from ${JSON.stringify(moduleUrl)};
    const args = JSON.parse(process.argv[1]);
    await activateRelease({...args, preflight: async () => ({ok:true}), verifyAssetServing: async () => ({ok:true}), rollbackSmoke: async () => ({ok:true}), smoke: async () => process.exit(23)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(f)], { encoding: 'utf8' });
  assert.equal(child.status, 23, child.stderr);
  assert.equal(fs.realpathSync(f.pointer), f.candidate);
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), true);
  const lock = path.join(f.state, 'activation.lock');
  fs.unlinkSync(path.join(lock, 'owner.json'));
  fs.rmdirSync(lock);
  assert.equal((await recoverInterruptedActivation(f)).active, f.previous);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'bg/wishlist/index.html'), 'utf8'), 'old-nested');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'old.js'), 'utf8'), 'old.js');
  assert.equal(fs.readFileSync(path.join(f.sharedAssets, 'new.js'), 'utf8'), 'new.js');
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), false);
});

test('isolated Apache sees complete release switching and rollback', async t => {
  const f = fixture(t);
  fs.chmodSync(f.root, 0o755);
  const htaccess = fs.readFileSync(new URL('../../client/public/.htaccess', import.meta.url));
  for (const dir of [f.previous, f.candidate]) fs.writeFileSync(path.join(dir, '.htaccess'), htaccess);
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  await withApache(f.pointer, async ({ httpPort, httpsPort }) => {
    const get = requestPath => requestRelease({ httpPort, httpsPort, scheme: 'https', requestPath });
    assert.equal(get('/bg/wishlist/').body, 'old-nested');
    await assert.rejects(activateRelease({
      ...f,
      smoke: async () => {
        assert.equal(get('/bg/wishlist/').body, 'new-nested');
        assert.equal(get('/checkout').finalStatus, 200);
        return { ok: false };
      }
    }), /previous release restored/);
    assert.equal(get('/bg/wishlist/').body, 'old-nested');
  });
});

test('Apache alias serves both independently built asset sets before, during and after rollback', async t => {
  let runningConf;
  t.after(() => {
    if (runningConf) spawnSync('apache2', ['-f', runningConf, '-k', 'stop'], { stdio: 'ignore' });
  });
  const f = fixture(t);
  fs.chmodSync(f.root, 0o755);
  for (const [dir, name, body] of [[f.previous, 'old-abc.js', 'old bundle'], [f.candidate, 'new-def.js', 'new bundle']]) {
    fs.mkdirSync(path.join(dir, 'assets', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', 'nested', name), body);
    fs.copyFileSync(new URL('../../client/public/.htaccess', import.meta.url), path.join(dir, '.htaccess'));
  }
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const unconfiguredPort = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  assert.notEqual(port, unconfiguredPort);
  const conf = path.join(f.root, 'httpd.conf');
  fs.writeFileSync(conf, `ServerRoot /etc/apache2
ServerName localhost
PidFile ${f.root}/apache.pid
ErrorLog ${f.root}/error.log
Mutex file:${f.root}
Listen 127.0.0.1:${port}
Listen 127.0.0.1:${unconfiguredPort}
LoadModule mpm_event_module /usr/lib/apache2/modules/mod_mpm_event.so
LoadModule authn_core_module /usr/lib/apache2/modules/mod_authn_core.so
LoadModule authz_core_module /usr/lib/apache2/modules/mod_authz_core.so
LoadModule dir_module /usr/lib/apache2/modules/mod_dir.so
LoadModule mime_module /usr/lib/apache2/modules/mod_mime.so
LoadModule rewrite_module /usr/lib/apache2/modules/mod_rewrite.so
LoadModule alias_module /usr/lib/apache2/modules/mod_alias.so
LoadModule headers_module /usr/lib/apache2/modules/mod_headers.so
TypesConfig /etc/mime.types
<VirtualHost 127.0.0.1:${port}>
DocumentRoot "${f.pointer}"
<Directory "${f.pointer}">
  Options FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>
${apacheSharedAssetsDirectives(f.sharedAssets)}
</VirtualHost>
<VirtualHost 127.0.0.1:${unconfiguredPort}>
DocumentRoot "${f.pointer}"
<Directory "${f.pointer}">
  Options FollowSymLinks
  AllowOverride All
  Require all granted
</Directory>
</VirtualHost>
`);
  const start = spawnSync('apache2', ['-f', conf, '-k', 'start'], { encoding: 'utf8' });
  assert.equal(start.status, 0, start.stderr);
  runningConf = conf;
  const get = (route, targetPort = port) => {
    const response = spawnSync('curl', ['--noproxy', '*', '-sS', '--max-time', '3', '-H', 'Host: driftdwells.com',
      '-H', 'X-Forwarded-Proto: https', '-w', '\\n%{http_code}', `http://127.0.0.1:${targetPort}${route}`], { encoding: 'utf8' });
    assert.equal(response.status, 0, response.stderr);
    const split = response.stdout.lastIndexOf('\n');
    return { body: response.stdout.slice(0, split), status: Number(response.stdout.slice(split + 1)) };
  };
  const old = '/assets/nested/old-abc.js';
  const next = '/assets/nested/new-def.js';
  const verifyAssetServing = async ({ assets }) => {
    return { ok: assets.every(asset => {
      const response = get(`/${asset.path}`);
      return response.status === 200 && Buffer.byteLength(response.body) === asset.size &&
        crypto.createHash('sha256').update(response.body).digest('hex') === asset.sha256;
    }) };
  };
  assert.equal(get(old).status, 404);
  await assert.rejects(activateRelease({ ...f, verifyAssetServing: async () => ({
    ok: get(next, unconfiguredPort).status === 200
  }) }), /serving verification/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  await assert.rejects(activateRelease({ ...f, verifyAssetServing, smoke: async () => {
    assert.equal(fs.realpathSync(f.pointer), f.candidate);
    assert.equal(get(old).body, 'old bundle');
    assert.equal(get(next).body, 'new bundle');
    return { ok: false };
  }, rollbackSmoke: async () => {
    assert.equal(get(old).body, 'old bundle');
    assert.equal(get(next).body, 'new bundle');
    return { ok: true };
  } }), /previous release restored/);
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(get(old).body, 'old bundle');
  assert.equal(get(next).body, 'new bundle');
  assert.equal(get('/assets/nested/missing.js').status, 404);
  fs.mkdirSync(path.join(f.sharedAssets, '.private'), { mode: 0o755 });
  fs.writeFileSync(path.join(f.sharedAssets, '.private', 'file.js'), 'private');
  assert.equal(get('/assets/.private/file.js').status, 403);
  await activateRelease({ ...f, verifyAssetServing });
  assert.equal(fs.realpathSync(f.pointer), f.candidate);
  assert.equal(get(old).body, 'old bundle');
  assert.equal(get(next).body, 'new bundle');
  await activateRelease({ ...f, candidate: f.previous, inventory: f.previousInventory,
    previousInventory: f.inventory, verifyAssetServing });
  assert.equal(fs.realpathSync(f.pointer), f.previous);
  assert.equal(get(old).body, 'old bundle');
  assert.equal(get(next).body, 'new bundle');
});
