'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveUploadsDir } = require('./resolveUploadsDir');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-resolve-'));
}

test('development keeps a private uploads directory when no shared store exists', () => {
  const root = tempRoot();
  const localDir = path.join(root, 'uploads');
  const resolved = resolveUploadsDir({
    localDir,
    envDir: '',
    sharedDir: path.join(root, 'missing-shared')
  });
  assert.equal(resolved, localDir);
  assert.equal(fs.lstatSync(localDir).isSymbolicLink(), false);
  assert.equal(fs.statSync(localDir).isDirectory(), true);
});

test('a missing production release uploads path links to the shared store', () => {
  const root = tempRoot();
  const localDir = path.join(root, 'release', 'uploads');
  const sharedDir = path.join(root, 'shared');
  fs.mkdirSync(path.dirname(localDir));
  fs.mkdirSync(sharedDir);
  fs.writeFileSync(path.join(sharedDir, 'keep.jpg'), 'original');
  const resolved = resolveUploadsDir({ localDir, envDir: undefined, sharedDir });
  assert.equal(fs.realpathSync(resolved), fs.realpathSync(sharedDir));
  assert.equal(fs.readFileSync(path.join(resolved, 'keep.jpg'), 'utf8'), 'original');
});

test('an existing local uploads directory is not replaced', () => {
  const root = tempRoot();
  const localDir = path.join(root, 'uploads');
  const sharedDir = path.join(root, 'shared');
  fs.mkdirSync(localDir);
  fs.mkdirSync(sharedDir);
  fs.writeFileSync(path.join(localDir, 'local.jpg'), 'dev');
  fs.writeFileSync(path.join(sharedDir, 'prod.jpg'), 'prod');
  const resolved = resolveUploadsDir({ localDir, envDir: '', sharedDir });
  assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(resolved, 'local.jpg'), 'utf8'), 'dev');
  assert.equal(fs.existsSync(path.join(resolved, 'prod.jpg')), false);
});

test('UPLOADS_DIR stays separate from the production store', () => {
  const root = tempRoot();
  const localDir = path.join(root, 'release', 'uploads');
  const sharedDir = path.join(root, 'shared');
  const envDir = path.join(root, 'dev-uploads');
  fs.mkdirSync(sharedDir);
  fs.writeFileSync(path.join(sharedDir, 'prod.jpg'), 'prod');
  const resolved = resolveUploadsDir({ localDir, envDir, sharedDir });
  assert.equal(path.resolve(resolved), path.resolve(envDir));
  assert.equal(fs.existsSync(localDir), false);
  assert.equal(fs.existsSync(path.join(sharedDir, 'prod.jpg')), true);
});

test('server.js serves the resolved uploads directory', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /resolveUploadsDir\(\{\s*localDir: path\.join\(__dirname, '\.\.', 'uploads'\)\s*\}\)/);
});
