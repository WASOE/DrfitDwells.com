import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInventory } from './frontend-inventory.mjs';
import { activateRelease, recoverInterruptedActivation, stageRelease } from './blue-green.mjs';
import { requestRelease, withApache } from './apache-server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-blue-green-'));
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
  fs.mkdirSync(releases);
  fs.mkdirSync(state);
  for (const name of ['old', 'new']) {
    const dir = path.join(releases, name);
    fs.mkdirSync(path.join(dir, 'bg', 'wishlist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), name);
    fs.writeFileSync(path.join(dir, 'bg', 'wishlist', 'index.html'), `${name}-nested`);
  }
  const previous = path.join(releases, 'old');
  const candidate = path.join(releases, 'new');
  fs.symlinkSync(previous, pointer);
  return { root, releases, state, pointer, previous, candidate,
    inventory: createInventory(candidate, 'a'.repeat(40), 'production'),
    previousInventory: createInventory(previous, 'b'.repeat(40), 'production'),
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
  assert.equal(recoverInterruptedActivation(f).active, f.previous);
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

test('requires a verified rollback and retains previously referenced assets', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.previous, 'assets'));
  fs.writeFileSync(path.join(f.previous, 'assets', 'old.js'), 'old asset');
  f.previousInventory = createInventory(f.previous, 'b'.repeat(40), 'production');
  await assert.rejects(activateRelease(f), /Previous asset missing/);
  fs.mkdirSync(path.join(f.candidate, 'assets'));
  fs.writeFileSync(path.join(f.candidate, 'assets', 'old.js'), 'old asset');
  f.inventory = createInventory(f.candidate, 'a'.repeat(40), 'production');
  await activateRelease(f);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'assets', 'old.js'), 'utf8'), 'old asset');
});

test('interruption after switch leaves a journal for explicit complete recovery', t => {
  const f = fixture(t);
  const moduleUrl = new URL('./blue-green.mjs', import.meta.url).href;
  const script = `import {activateRelease} from ${JSON.stringify(moduleUrl)};
    const args = JSON.parse(process.argv[1]);
    await activateRelease({...args, preflight: async () => ({ok:true}), rollbackSmoke: async () => ({ok:true}), smoke: async () => process.exit(23)});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(f)], { encoding: 'utf8' });
  assert.equal(child.status, 23, child.stderr);
  assert.equal(fs.realpathSync(f.pointer), f.candidate);
  assert.equal(fs.existsSync(path.join(f.state, 'pending.json')), true);
  const lock = path.join(f.state, 'activation.lock');
  fs.unlinkSync(path.join(lock, 'owner.json'));
  fs.rmdirSync(lock);
  assert.equal(recoverInterruptedActivation(f).active, f.previous);
  assert.equal(fs.readFileSync(path.join(f.pointer, 'bg/wishlist/index.html'), 'utf8'), 'old-nested');
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
