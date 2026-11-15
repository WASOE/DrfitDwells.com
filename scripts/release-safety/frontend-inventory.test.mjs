import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInventory, verifyInventory } from './frontend-inventory.mjs';

test('inventory verifies complete nested and hidden build output', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'bg', 'wishlist'), { recursive: true });
  fs.writeFileSync(path.join(root, '.htaccess'), 'rules');
  fs.writeFileSync(path.join(root, 'bg', 'wishlist', 'index.html'), 'page');
  const manifest = createInventory(root, 'a'.repeat(40), 'test');
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(verifyInventory(root, manifest), manifest);
  fs.writeFileSync(path.join(root, 'bg', 'wishlist', 'index.html'), 'changed');
  assert.throws(() => verifyInventory(root, manifest), /inventory mismatch/);
  fs.writeFileSync(path.join(root, 'bg', 'wishlist', 'index.html'), 'page');
  fs.writeFileSync(path.join(root, 'extra'), 'unexpected');
  assert.throws(() => verifyInventory(root, manifest), /inventory mismatch/);
  fs.unlinkSync(path.join(root, 'extra'));
  fs.unlinkSync(path.join(root, '.htaccess'));
  assert.throws(() => verifyInventory(root, manifest), /inventory mismatch/);
});

test('inventory rejects symlinks and invalid metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => createInventory(root, 'main', 'production'), /commit SHA/);
  assert.throws(() => createInventory(root, 'a'.repeat(40), 'unknown'), /configuration/);
  fs.symlinkSync('/etc/passwd', path.join(root, 'link'));
  assert.throws(() => createInventory(root, 'a'.repeat(40), 'test'), /Unsupported artifact entry/);
});
