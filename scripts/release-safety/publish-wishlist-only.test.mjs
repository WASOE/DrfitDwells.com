import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInventory } from './frontend-inventory.mjs';
import {
  inspectWishlistRelease, publishWishlistRelease, rollbackWishlistRelease
} from './publish-wishlist-only.mjs';

const COMMIT = '874ed57e19e78d3d6b4d05c13c7d1805bc1da708';
function write(root, relative, data) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}
async function withSite(t, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wishlist-only-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'release');
  const webroot = path.join(dir, 'live');
  const state = path.join(dir, 'journal');
  fs.mkdirSync(source);
  fs.mkdirSync(webroot);
  write(webroot, 'index.html', '<html>original homepage</html>');
  write(webroot, 'sw.js', '/* existing service worker */');
  write(webroot, '.htaccess',
    'RewriteCond %{REQUEST_FILENAME} !-d\nRewriteCond %{REQUEST_FILENAME} !-f\n');
  write(webroot, 'assets/index-Old123456.js', 'old asset, must not be changed');
  const entry = 'assets/index-New123456.js';
  write(source, entry, 'export default "new";');
  write(source, 'wishlist/index.html',
    '<html><div class="wishlist-hero" data-prerender-route="/wishlist"></div><script src="/' + entry + '"></script></html>');
  write(source, 'bg/wishlist/index.html',
    '<html><div class="wishlist-hero" data-prerender-route="/bg/wishlist"></div><script src="/' + entry + '"></script></html>');
  const inventory = createInventory(source, COMMIT, 'production');
  await fn({ source, webroot, state, inventory, entry });
}
test('plan requires exact pinned production artifact and changes no live files', async t => withSite(t, async env => {
  const plan = inspectWishlistRelease(env);
  assert.deepEqual(plan.pages.map(x => x.relative), ['wishlist/index.html', 'bg/wishlist/index.html']);
  assert.deepEqual(plan.assets.map(x => x.path), [env.entry]);
  assert.equal(fs.existsSync(env.state), false);
  assert.equal(fs.readFileSync(path.join(env.webroot, 'index.html'), 'utf8'), '<html>original homepage</html>');
  assert.throws(() => inspectWishlistRelease({
    ...env, inventory: { ...env.inventory, commit: '0'.repeat(40) }
  }), /pinned production/);
}));
test('publish only two route pages and additive hashed assets, then rollback', async t => withSite(t, async env => {
  write(env.webroot, 'wishlist/index.html', '<html>previous EN</html>');
  const result = await publishWishlistRelease({ ...env, smoke: async () => true });
  assert.equal(result.status, 'active');
  assert.match(fs.readFileSync(path.join(env.webroot, 'wishlist/index.html'), 'utf8'), /wishlist-hero/);
  assert.match(fs.readFileSync(path.join(env.webroot, 'bg/wishlist/index.html'), 'utf8'), /wishlist-hero/);
  assert.equal(fs.readFileSync(path.join(env.webroot, env.entry), 'utf8'), 'export default "new";');
  assert.equal(fs.readFileSync(path.join(env.webroot, 'assets/index-Old123456.js'), 'utf8'), 'old asset, must not be changed');
  assert.equal(fs.readFileSync(path.join(env.webroot, 'index.html'), 'utf8'), '<html>original homepage</html>');
  const rollback = rollbackWishlistRelease(env.state);
  assert.equal(rollback.status, 'rolled-back');
  assert.equal(fs.readFileSync(path.join(env.webroot, 'wishlist/index.html'), 'utf8'), '<html>previous EN</html>');
  assert.equal(fs.existsSync(path.join(env.webroot, 'bg/wishlist/index.html')), false);
  assert.equal(fs.existsSync(path.join(env.webroot, 'bg/wishlist')), false, 'empty route folder removed so SPA fallback works');
  assert.equal(fs.existsSync(path.join(env.webroot, env.entry)), true, 'immutable assets remain to protect old tabs');
}));
test('failed origin smoke automatically restores original route files', async t => withSite(t, async env => {
  write(env.webroot, 'wishlist/index.html', '<html>old EN</html>');
  write(env.webroot, 'bg/wishlist/index.html', '<html>old BG</html>');
  await assert.rejects(publishWishlistRelease({
    ...env, smoke: async () => { throw new Error('origin smoke failed'); }
  }), /Deployment rolled back: origin smoke failed/);
  assert.equal(fs.readFileSync(path.join(env.webroot, 'wishlist/index.html'), 'utf8'), '<html>old EN</html>');
  assert.equal(fs.readFileSync(path.join(env.webroot, 'bg/wishlist/index.html'), 'utf8'), '<html>old BG</html>');
  assert.equal(rollbackWishlistRelease(env.state).alreadyRestored, true);
}));
test('hash collision aborts before any write', async t => withSite(t, async env => {
  write(env.webroot, env.entry, 'different bytes under identical hashed name');
  assert.throws(() => inspectWishlistRelease(env), /Shared asset collisions/);
  await assert.rejects(publishWishlistRelease({ ...env, smoke: async () => true }), /Shared asset collisions/);
  assert.equal(fs.existsSync(env.state), false);
}));
test('symlinked live route parent is rejected before any write', async t => withSite(t, async env => {
  const other = path.join(path.dirname(env.webroot), 'outside');
  fs.mkdirSync(other);
  fs.symlinkSync(other, path.join(env.webroot, 'wishlist'));
  assert.throws(() => inspectWishlistRelease(env), /Unsafe destination ancestor/);
  assert.equal(fs.existsSync(env.state), false);
}));
test('recovery refuses to overwrite files changed by a different publisher', async t => withSite(t, async env => {
  await publishWishlistRelease({ ...env, smoke: async () => true });
  write(env.webroot, 'wishlist/index.html', '<html>unknown external change</html>');
  assert.throws(() => rollbackWishlistRelease(env.state), /Route changed outside/);
  const journal = JSON.parse(fs.readFileSync(path.join(env.state, 'wishlist-publish-journal.json'), 'utf8'));
  assert.equal(journal.status, 'recovery-required');
}));
