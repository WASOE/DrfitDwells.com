import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInventory } from './frontend-inventory.mjs';
import {
  activatePreparedRelease, migrateDocumentRoot, prepareRelease,
  recoverActivation, recoverDocumentRootMigration, verifyHostCompatibility,
  verifyPreparedRelease
} from './atomic-frontend.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-atomic-'));
  t.after(() => {
    function thaw(dir) {
      try { fs.chmodSync(dir, 0o755); } catch {}
      try { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) thaw(path.join(dir, entry.name)); } catch {}
    }
    thaw(root); fs.rmSync(root, { recursive: true, force: true });
  });
  const base = path.join(root, 'frontend');
  const releases = path.join(base, 'releases');
  const state = path.join(base, 'state');
  const sharedAssets = path.join(base, 'shared-assets');
  const webroot = path.join(root, 'public_html');
  for (const dir of [base, releases, state, sharedAssets, webroot]) fs.mkdirSync(dir, { mode: 0o755 });
  fs.writeFileSync(path.join(webroot, 'index.html'), 'old');
  const owner = fs.statSync(base);
  return { root, base, releases, state, sharedAssets, webroot, pointer: path.join(base, 'current'), expectedUid: owner.uid, expectedGid: owner.gid, runExchange: simulatedExchange };
}

function simulatedExchange(left, right) {
  const temporary = `${left}.test-exchange`;
  fs.renameSync(left, temporary); fs.renameSync(right, left); fs.renameSync(temporary, right);
}

function artifact(root, sha, label) {
  const dir = path.join(root, `artifact-${label}`);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bg', 'wishlist'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), label);
  fs.writeFileSync(path.join(dir, '.htaccess'), 'RewriteEngine On');
  fs.writeFileSync(path.join(dir, 'bg', 'wishlist', 'index.html'), `${label}-wishlist`);
  fs.writeFileSync(path.join(dir, 'test', 'index.html'), `${label}-test`);
  fs.writeFileSync(path.join(dir, 'assets', `${label}.js`), label);
  return { dir, inventory: createInventory(dir, sha, 'production') };
}

test('host preflight proves same filesystem and kernel directory/symlink exchange', t => {
  const f = fixture(t);
  assert.equal(verifyHostCompatibility(f).ok, true);
  fs.chmodSync(f.base, 0o775);
  assert.throws(() => verifyHostCompatibility(f), /group- or world-writable/);
});

test('stages immutable releases with a shared owner-matched asset link and rejects corruption', t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  const release = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  assert.equal(fs.realpathSync(path.join(release, 'assets')), fs.realpathSync(f.sharedAssets));
  assert.equal(fs.readFileSync(path.join(release, 'assets', 'one.js'), 'utf8'), 'one');
  assert.equal(verifyPreparedRelease({ release, inventory: a.inventory, sharedAssets: f.sharedAssets }).ok, true);
  fs.chmodSync(path.join(f.sharedAssets, 'one.js'), 0o644);
  fs.writeFileSync(path.join(f.sharedAssets, 'one.js'), 'bad');
  assert.throws(() => verifyPreparedRelease({ release, inventory: a.inventory, sharedAssets: f.sharedAssets }), /mismatch/);
});

test('initial nonempty document-root migration is atomic and preserves the original full tree as backup', async t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  const release = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  const result = await migrateDocumentRoot({ ...f, observedRelease: release, smoke: async ({ active }) => ({ ok: fs.readFileSync(path.join(active, 'index.html'), 'utf8') === 'one' }) });
  assert.equal(fs.lstatSync(f.webroot).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(f.webroot), release);
  assert.equal(fs.readFileSync(path.join(result.backup, 'index.html'), 'utf8'), 'old');
  assert.equal(fs.lstatSync(result.backup).isDirectory(), true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.state, 'document-root-migration.json'))).phase, 'complete');
});

test('failed initial smoke atomically restores the original directory', async t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  const release = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  await assert.rejects(migrateDocumentRoot({ ...f, observedRelease: release, smoke: async ({ rollback }) => ({ ok: Boolean(rollback) }) }), /Post-migration/);
  assert.equal(fs.lstatSync(f.webroot).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(f.webroot, 'index.html'), 'utf8'), 'old');
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.state, 'document-root-migration.json'))).phase, 'rolled-back');
});

test('recovery after interruption immediately following exchange restores the original directory', async t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  const release = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  let calls = 0;
  await assert.rejects(migrateDocumentRoot({ ...f, observedRelease: release, smoke: async ({ rollback }) => ({ ok: Boolean(rollback) }), runExchange(left, right) {
    simulatedExchange(left, right); calls += 1;
    if (calls === 2) throw new Error('simulated process interruption');
  } }), /simulated/);
  // The simulated throw happened after the syscall and before the caller knew it succeeded.
  assert.equal(fs.lstatSync(f.webroot).isSymbolicLink(), true);
  await recoverDocumentRootMigration({ state: f.state, smoke: async () => ({ ok: true }), runExchange: simulatedExchange });
  assert.equal(fs.lstatSync(f.webroot).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(f.webroot, 'index.html'), 'utf8'), 'old');
});

test('deployment switches once, keeps old assets, and rolls back a failed smoke', async t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one'); const b = artifact(f.root, 'b'.repeat(40), 'two');
  const one = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  const two = prepareRelease({ source: b.dir, inventory: b.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  fs.symlinkSync(one, f.pointer);
  await assert.rejects(activatePreparedRelease({ ...f, candidate: two, inventory: b.inventory,
    preflight: async () => ({ ok: true }), smoke: async () => ({ ok: false }), rollbackSmoke: async () => ({ ok: true }) }), /Smoke failed/);
  assert.equal(fs.realpathSync(f.pointer), one);
  assert.equal(fs.readFileSync(path.join(one, 'assets', 'two.js'), 'utf8'), 'two');
  const result = await activatePreparedRelease({ ...f, candidate: two, inventory: b.inventory,
    preflight: async () => ({ ok: true }), smoke: async () => ({ ok: true }), rollbackSmoke: async () => ({ ok: true }) });
  assert.equal(result.active, two); assert.equal(fs.realpathSync(f.pointer), two);
});

test('concurrent deployment is refused and interrupted activation recovers after reboot', async t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one'); const b = artifact(f.root, 'b'.repeat(40), 'two');
  const one = prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  const two = prepareRelease({ source: b.dir, inventory: b.inventory, releases: f.releases, sharedAssets: f.sharedAssets });
  fs.symlinkSync(two, f.pointer);
  fs.writeFileSync(path.join(f.state, 'activation.json'), JSON.stringify({ version: 1, previous: one, candidate: two, pointer: f.pointer, phase: 'switched' }));
  const recovered = await recoverActivation({ ...f, rollbackSmoke: async () => ({ ok: true }) });
  assert.equal(recovered.active, one); assert.equal(fs.realpathSync(f.pointer), one);
  fs.mkdirSync(path.join(f.state, 'frontend-deploy.lock'));
  await assert.rejects(activatePreparedRelease({ ...f, candidate: two, inventory: b.inventory,
    preflight: async () => ({ ok: true }), smoke: async () => ({ ok: true }), rollbackSmoke: async () => ({ ok: true }) }), /Another frontend/);
});

test('missing artifact files and historic asset hash collisions fail closed', t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  fs.unlinkSync(path.join(a.dir, 'index.html'));
  assert.throws(() => prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets }), /inventory mismatch/);
  const b = artifact(f.root, 'b'.repeat(40), 'two');
  fs.writeFileSync(path.join(f.sharedAssets, 'two.js'), 'collision');
  fs.chmodSync(path.join(f.sharedAssets, 'two.js'), 0o444);
  assert.throws(() => prepareRelease({ source: b.dir, inventory: b.inventory, releases: f.releases, sharedAssets: f.sharedAssets }), /hash conflict/);
});

test('unsafe shared-store permissions fail before release publication', t => {
  const f = fixture(t); const a = artifact(f.root, 'a'.repeat(40), 'one');
  fs.chmodSync(f.sharedAssets, 0o775);
  assert.throws(() => prepareRelease({ source: a.dir, inventory: a.inventory, releases: f.releases, sharedAssets: f.sharedAssets }), /permissions are unsafe/);
  assert.equal(fs.existsSync(path.join(f.releases, 'a'.repeat(40))), false);
});

