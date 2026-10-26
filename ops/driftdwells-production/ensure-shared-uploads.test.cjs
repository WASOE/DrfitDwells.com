'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ensureSharedStore,
  ensureReleaseUploadsLink,
  copyMissingFiles
} = require('./ensure-shared-uploads.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shared-uploads-'));
}

function release(root, name) {
  const dir = path.join(root, 'releases', name);
  fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server', 'server.js'), 'ok');
  return dir;
}

test('fresh release and rollback share one store, and existing bytes survive', () => {
  const root = tempRoot();
  const legacy = path.join(root, 'app', 'uploads');
  const shared = path.join(root, 'shared', 'driftdwells-uploads');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'a.jpg'), 'ORIGINAL-A');
  fs.writeFileSync(path.join(legacy, 'b.jpg'), 'B');

  const current = release(root, 'current');
  fs.mkdirSync(path.join(current, 'uploads'));
  fs.writeFileSync(path.join(current, 'uploads', 'a.jpg'), 'ORIGINAL-A');
  fs.writeFileSync(path.join(current, 'uploads', 'only-current.jpg'), 'ONLY-CURRENT');

  const rollback = release(root, 'rollback');
  const store = ensureSharedStore({ sharedPath: shared, legacyPath: legacy, dryRun: false });
  assert.equal(store.action, 'moved-legacy-to-shared');
  assert.equal(fs.lstatSync(shared).isSymbolicLink(), false);
  assert.equal(fs.lstatSync(legacy).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(shared, 'a.jpg'), 'utf8'), 'ORIGINAL-A');

  const extra = path.join(root, 'public-uploads');
  fs.mkdirSync(extra);
  fs.writeFileSync(path.join(extra, 'a.jpg'), 'DIFFERENT-MUST-NOT-WIN');
  fs.writeFileSync(path.join(extra, 'e.jpg'), 'PUBLIC-ONLY');
  const imported = {
    copied: [], alreadyPresent: 0, skippedSymlinks: [], dryRun: false,
    uid: fs.statSync(shared).uid, gid: fs.statSync(shared).gid
  };
  copyMissingFiles(extra, shared, imported);
  assert.deepEqual(imported.copied, ['e.jpg']);
  assert.equal(fs.readFileSync(path.join(shared, 'a.jpg'), 'utf8'), 'ORIGINAL-A');

  for (const dir of [current, rollback]) {
    const report = ensureReleaseUploadsLink(dir, shared, { dryRun: false });
    assert.notEqual(report.action, 'foreign-symlink');
    assert.equal(fs.realpathSync(path.join(dir, 'uploads')), fs.realpathSync(shared));
  }
  assert.equal(fs.readFileSync(path.join(rollback, 'uploads', 'only-current.jpg'), 'utf8'), 'ONLY-CURRENT');
  const preserved = fs.readdirSync(current).find(name => name.startsWith('uploads.preserved-'));
  assert.ok(preserved);
  assert.equal(fs.readFileSync(path.join(current, preserved, 'a.jpg'), 'utf8'), 'ORIGINAL-A');

  fs.writeFileSync(path.join(current, 'uploads', 'new.jpg'), 'NEW-UPLOAD');
  assert.equal(fs.readFileSync(path.join(shared, 'new.jpg'), 'utf8'), 'NEW-UPLOAD');
  assert.equal(fs.readFileSync(path.join(rollback, 'uploads', 'new.jpg'), 'utf8'), 'NEW-UPLOAD');
});

test('a failed symlink restores the release uploads directory', () => {
  const root = tempRoot();
  const shared = path.join(root, 'shared');
  const current = release(root, 'current');
  fs.mkdirSync(shared);
  fs.mkdirSync(path.join(current, 'uploads'));
  fs.writeFileSync(path.join(shared, 'kept.jpg'), 'kept');
  fs.writeFileSync(path.join(current, 'uploads', 'kept.jpg'), 'kept');
  fs.writeFileSync(path.join(current, 'uploads', 'release-only.jpg'), 'release');
  const original = fs.symlinkSync;
  fs.symlinkSync = () => { throw new Error('symlink failed'); };
  try {
    assert.throws(
      () => ensureReleaseUploadsLink(current, shared, { dryRun: false }),
      /symlink failed/
    );
  } finally {
    fs.symlinkSync = original;
  }
  assert.equal(fs.lstatSync(path.join(current, 'uploads')).isDirectory(), true);
  assert.equal(fs.lstatSync(path.join(current, 'uploads')).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(path.join(current, 'uploads', 'release-only.jpg'), 'utf8'), 'release');
  assert.equal(fs.readFileSync(path.join(shared, 'kept.jpg'), 'utf8'), 'kept');
});

test('a foreign symlink is not retargeted until its target already reaches the store', () => {
  const root = tempRoot();
  const shared = path.join(root, 'shared');
  const target = release(root, 'target');
  const foreign = release(root, 'foreign');
  fs.mkdirSync(shared);
  fs.mkdirSync(path.join(target, 'uploads'));
  fs.writeFileSync(path.join(target, 'uploads', 'd.jpg'), 'CHAIN');
  fs.symlinkSync(path.join(target, 'uploads'), path.join(foreign, 'uploads'));
  const before = ensureReleaseUploadsLink(foreign, shared, { dryRun: false });
  assert.equal(before.action, 'foreign-symlink');
  assert.equal(fs.readlinkSync(path.join(foreign, 'uploads')), path.join(target, 'uploads'));
  ensureReleaseUploadsLink(target, shared, { dryRun: false });
  const after = ensureReleaseUploadsLink(foreign, shared, { dryRun: false });
  assert.equal(after.action, 'already-linked');
  assert.equal(fs.readFileSync(path.join(foreign, 'uploads', 'd.jpg'), 'utf8'), 'CHAIN');
});

test('backup archives follow the uploads symlink and keep file bytes', () => {
  const root = tempRoot();
  const real = path.join(root, 'real-uploads');
  const app = path.join(root, 'app');
  fs.mkdirSync(real);
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(real, 'photo.jpg'), 'PHOTO-BYTES');
  fs.symlinkSync(real, path.join(app, 'uploads'));
  const archive = path.join(root, 'uploads.tgz');
  execFileSync('tar', ['-czf', archive, '-h', '-C', app, 'uploads']);
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.match(listing, /^uploads\/.+/m);
  const bare = path.join(root, 'bare.tgz');
  execFileSync('tar', ['-czf', bare, '-C', app, 'uploads']);
  const bareListing = execFileSync('tar', ['-tzf', bare], { encoding: 'utf8' });
  assert.doesNotMatch(bareListing, /^uploads\/photo\.jpg$/m);
  const extracted = path.join(root, 'extracted');
  fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  assert.equal(fs.readFileSync(path.join(extracted, 'uploads', 'photo.jpg'), 'utf8'), 'PHOTO-BYTES');
});
