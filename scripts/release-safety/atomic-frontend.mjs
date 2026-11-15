import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyInventory } from './frontend-inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXCHANGE = path.join(__dirname, 'rename-exchange.py');
const MIGRATION_JOURNAL = 'document-root-migration.json';
const DEPLOY_JOURNAL = 'activation.json';

function fsyncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  fsyncDir(path.dirname(file));
}

function assertAbsolute(value, label) {
  if (!path.isAbsolute(value) || path.normalize(value) !== value) throw new Error(`${label} must be a normalized absolute path`);
}

function assertRealDirectory(value, label) {
  const stat = fs.lstatSync(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(value) !== value) throw new Error(`${label} must be a real directory`);
}

function within(child, parent) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRelative(relative) {
  return typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) &&
    !relative.split('/').some(part => !part || part === '.' || part === '..');
}

/** Append a real directory tree without ever replacing an existing pathname. */
export function importAppendOnlyTree(source, destination) {
  assertRealDirectory(source, 'Import source');
  assertRealDirectory(destination, 'Import destination');
  const owner = fs.statSync(destination);
  if (owner.mode & 0o022) throw new Error('Import destination permissions are unsafe');
  const imported = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelative(relative) || entry.isSymbolicLink()) throw new Error(`Unsafe legacy entry: ${relative}`);
      const sourcePath = path.join(dir, entry.name); const destinationPath = path.join(destination, relative);
      if (entry.isDirectory()) {
        fs.mkdirSync(destinationPath, { recursive: true, mode: 0o755 });
        const createdOwner = fs.lstatSync(destinationPath);
        if (createdOwner.uid !== owner.uid || createdOwner.gid !== owner.gid) fs.chownSync(destinationPath, owner.uid, owner.gid);
        const directory = fs.lstatSync(destinationPath);
        if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== owner.uid || directory.gid !== owner.gid || (directory.mode & 0o022)) throw new Error(`Unsafe imported directory: ${relative}`);
        walk(sourcePath, relative);
      } else if (entry.isFile()) {
        const expected = { path: relative, size: fs.statSync(sourcePath).size, sha256: sha256(sourcePath) };
        if (fs.existsSync(destinationPath)) {
          const existing = fs.lstatSync(destinationPath);
          if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== owner.uid || existing.gid !== owner.gid || (existing.mode & 0o222) || existing.size !== expected.size || sha256(destinationPath) !== expected.sha256) throw new Error(`Legacy import hash or permission conflict: ${relative}`);
        } else {
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o755 });
          const temporary = `${destinationPath}.${crypto.randomUUID()}.tmp`;
          fs.copyFileSync(sourcePath, temporary, fs.constants.COPYFILE_EXCL); fs.chownSync(temporary, owner.uid, owner.gid); fs.chmodSync(temporary, 0o444);
          try { fs.linkSync(temporary, destinationPath); fsyncDir(path.dirname(destinationPath)); }
          finally { fs.unlinkSync(temporary); }
        }
        imported.push(expected);
      } else throw new Error(`Unsupported legacy entry: ${relative}`);
    }
  }
  walk(source);
  return imported;
}

export function auditLegacyWebroot({ webroot, candidate, inventory }) {
  const candidateFiles = new Set(inventory.files.map(file => file.path));
  const allowedMissing = relative => relative === 'release-manifest.json' ||
    /^index\.html\.backup-/.test(path.posix.basename(relative)) || /^\.htaccess\.bk-/.test(path.posix.basename(relative));
  const preservedRoots = new Set(['assets', 'test', 'uploads']);
  const unexpected = [];
  function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const top = relative.split('/')[0];
      if (entry.isSymbolicLink()) throw new Error(`Legacy webroot contains unsupported symlink: ${relative}`);
      if (entry.isDirectory()) {
        if (!preservedRoots.has(top) && !fs.existsSync(path.join(candidate, relative))) unexpected.push(`${relative}/`);
        walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && !preservedRoots.has(top) && !candidateFiles.has(relative) && !allowedMissing(relative)) unexpected.push(relative);
      else if (!entry.isFile() && !entry.isDirectory()) unexpected.push(relative);
    }
  }
  walk(webroot);
  if (unexpected.length) throw new Error(`Unaccounted legacy document-root paths: ${unexpected.sort().join(', ')}`);
  return { ok: true };
}

function acquireLock(state) {
  const lock = path.join(state, 'frontend-deploy.lock');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another frontend deployment or recovery is in progress'); throw error; }
  writeJson(path.join(lock, 'owner.json'), { host: os.hostname(), pid: process.pid, startedAt: new Date().toISOString() });
  return () => { fs.unlinkSync(path.join(lock, 'owner.json')); fs.rmdirSync(lock); fsyncDir(state); };
}

function atomicSymlink(pointer, target, expectedOwner = null) {
  const temporary = `${pointer}.${crypto.randomUUID()}.tmp`;
  fs.symlinkSync(target, temporary);
  try {
    if (expectedOwner) fs.lchownSync(temporary, expectedOwner.uid, expectedOwner.gid);
    fs.renameSync(temporary, pointer);
    fsyncDir(path.dirname(pointer));
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}

function readPointer(pointer, releases) {
  if (!fs.lstatSync(pointer).isSymbolicLink()) throw new Error('Active pointer must be a symbolic link');
  const resolved = fs.realpathSync(pointer);
  if (path.dirname(resolved) !== fs.realpathSync(releases) || !fs.lstatSync(resolved).isDirectory()) {
    throw new Error('Active pointer target must be a release directory');
  }
  return resolved;
}

function exchange(left, right, run = spawnSync) {
  const result = run('python3', [EXCHANGE, left, right], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Atomic rename exchange failed: ${(result.stderr || '').trim()}`);
  fsyncDir(path.dirname(left));
}

export function verifyHostCompatibility({ webroot, base, expectedUid, expectedGid, runExchange }) {
  for (const [value, label] of [[webroot, 'webroot'], [base, 'base']]) assertAbsolute(value, label);
  assertRealDirectory(webroot, 'Existing document root');
  assertRealDirectory(base, 'Frontend base');
  const rootStat = fs.lstatSync(webroot);
  const baseStat = fs.lstatSync(base);
  if (rootStat.dev !== baseStat.dev) throw new Error('Document root and release base must use the same filesystem');
  if (rootStat.uid !== expectedUid || rootStat.gid !== expectedGid || baseStat.uid !== expectedUid || baseStat.gid !== expectedGid) {
    throw new Error('Document root and release base ownership must match the deploy account');
  }
  if ((rootStat.mode & 0o022) || (baseStat.mode & 0o022)) throw new Error('Document root and release base must not be group- or world-writable');
  const probeDir = fs.mkdtempSync(path.join(base, '.rename-exchange-probe-'));
  try {
    const left = path.join(probeDir, 'directory');
    const right = path.join(probeDir, 'link');
    fs.mkdirSync(left); fs.writeFileSync(path.join(left, 'sentinel'), 'ok'); fs.symlinkSync(left, right);
    (runExchange || exchange)(left, right);
    if (!fs.lstatSync(left).isSymbolicLink() || !fs.lstatSync(right).isDirectory()) throw new Error('RENAME_EXCHANGE probe produced unexpected types');
  } finally { fs.rmSync(probeDir, { recursive: true, force: true }); }
  return { ok: true, filesystemDevice: rootStat.dev };
}

export function prepareRelease({ source, inventory, releases, sharedAssets, stableTest }) {
  verifyInventory(source, inventory);
  if (inventory.configuration !== 'production') throw new Error('Only a verified production artifact may be staged');
  assertRealDirectory(releases, 'Release root');
  assertRealDirectory(sharedAssets, 'Shared asset root');
  assertAbsolute(stableTest, 'Stable test-subdomain root');
  assertRealDirectory(path.dirname(stableTest), 'Stable test-subdomain parent');
  const releaseRoot = fs.realpathSync(releases);
  const sharedRoot = fs.realpathSync(sharedAssets);
  const testRoot = path.resolve(stableTest);
  if (within(sharedRoot, releaseRoot) || within(releaseRoot, sharedRoot) || within(testRoot, releaseRoot) || within(releaseRoot, testRoot) || within(testRoot, sharedRoot) || within(sharedRoot, testRoot)) throw new Error('Release, asset and test roots must be separate');
  const releaseOwner = fs.statSync(releaseRoot); const sharedOwner = fs.statSync(sharedRoot);
  const testOwner = fs.statSync(fs.existsSync(testRoot) ? testRoot : path.dirname(testRoot));
  if (releaseOwner.uid !== sharedOwner.uid || releaseOwner.gid !== sharedOwner.gid || releaseOwner.uid !== testOwner.uid || releaseOwner.gid !== testOwner.gid || (sharedOwner.mode & 0o022) || (testOwner.mode & 0o022)) {
    throw new Error('Shared asset root ownership or permissions are unsafe');
  }
  const destination = path.join(releaseRoot, inventory.commit);
  if (fs.existsSync(destination)) throw new Error('Release already exists');
  if (!fs.lstatSync(path.join(source, 'assets')).isDirectory() || fs.existsSync(path.join(source, '.frontend-inventory.json')) || fs.existsSync(path.join(source, 'test'))) {
    throw new Error('Artifact assets are missing or use a reserved deployment path');
  }
  const staging = path.join(releaseRoot, `.staging-${crypto.randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o755 });
  try {
    for (const entry of fs.readdirSync(source)) {
      if (entry === 'assets') continue;
      fs.cpSync(path.join(source, entry), path.join(staging, entry), { recursive: true, errorOnExist: true, force: false });
    }
    for (const asset of inventory.files.filter(file => file.path.startsWith('assets/'))) {
      const relative = asset.path.slice('assets/'.length);
      const sourceFile = path.join(source, asset.path);
      const sharedFile = path.join(sharedRoot, relative);
      if (!within(path.resolve(sharedFile), sharedRoot)) throw new Error(`Unsafe asset path: ${asset.path}`);
      fs.mkdirSync(path.dirname(sharedFile), { recursive: true, mode: 0o755 });
      if (fs.existsSync(sharedFile)) {
        const existing = fs.lstatSync(sharedFile);
        if (!existing.isFile() || existing.isSymbolicLink() || existing.uid !== sharedOwner.uid || existing.gid !== sharedOwner.gid || (existing.mode & 0o222)) {
          throw new Error(`Historic asset permissions are unsafe: ${asset.path}`);
        }
        const bytes = fs.readFileSync(sharedFile);
        if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Historic asset hash conflict: ${asset.path}`);
      } else {
        const temporary = `${sharedFile}.${crypto.randomUUID()}.tmp`;
        fs.copyFileSync(sourceFile, temporary, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(temporary, 0o444);
        try {
          fs.linkSync(temporary, sharedFile);
          fsyncDir(path.dirname(sharedFile));
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          const bytes = fs.readFileSync(sharedFile);
          if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error(`Historic asset hash conflict: ${asset.path}`);
        } finally { fs.unlinkSync(temporary); }
      }
    }
    fs.symlinkSync(sharedRoot, path.join(staging, 'assets'));
    fs.symlinkSync(testRoot, path.join(staging, 'test'));
    writeJson(path.join(staging, '.frontend-inventory.json'), inventory);
    const owner = fs.statSync(staging);
    fs.lchownSync(path.join(staging, 'assets'), owner.uid, owner.gid);
    fs.lchownSync(path.join(staging, 'test'), owner.uid, owner.gid);
    function seal(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const item = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) seal(item); else fs.chmodSync(item, 0o444);
      }
      fs.chmodSync(dir, 0o555);
    }
    seal(staging);
    verifyPreparedRelease({ release: staging, inventory, sharedAssets: sharedRoot, stableTest: testRoot });
    fs.renameSync(staging, destination); fsyncDir(releaseRoot);
    verifyPreparedRelease({ release: destination, inventory, sharedAssets: sharedRoot, stableTest: testRoot });
    return destination;
  } catch (error) {
    function thaw(dir) {
      try { fs.chmodSync(dir, 0o755); } catch {}
      try { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) thaw(path.join(dir, entry.name)); } catch {}
    }
    thaw(staging); fs.rmSync(staging, { recursive: true, force: true }); throw error;
  }
}

export function verifyPreparedRelease({ release, inventory, sharedAssets, stableTest }) {
  const root = fs.realpathSync(release);
  const assetsLink = path.join(root, 'assets');
  if (!fs.lstatSync(assetsLink).isSymbolicLink() || fs.realpathSync(assetsLink) !== fs.realpathSync(sharedAssets)) throw new Error('Release assets must point to the shared immutable asset store');
  const testLink = path.join(root, 'test');
  if (!fs.lstatSync(testLink).isSymbolicLink() || path.resolve(path.dirname(testLink), fs.readlinkSync(testLink)) !== path.resolve(stableTest)) throw new Error('Release test path must point to the stable test-subdomain store');
  const owner = fs.statSync(root); const linkOwner = fs.lstatSync(assetsLink); const targetOwner = fs.statSync(sharedAssets);
  const testLinkOwner = fs.lstatSync(testLink); const testTargetOwner = fs.statSync(fs.existsSync(stableTest) ? stableTest : path.dirname(stableTest));
  if (linkOwner.uid !== owner.uid || linkOwner.gid !== owner.gid || targetOwner.uid !== owner.uid || targetOwner.gid !== owner.gid || testLinkOwner.uid !== owner.uid || testLinkOwner.gid !== owner.gid || testTargetOwner.uid !== owner.uid || testTargetOwner.gid !== owner.gid) throw new Error('SymLinksIfOwnerMatch ownership check failed');
  const recorded = JSON.parse(fs.readFileSync(path.join(root, '.frontend-inventory.json'), 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(inventory)) throw new Error('Release inventory record mismatch');
  for (const file of inventory.files) {
    const actual = file.path.startsWith('assets/') ? path.join(sharedAssets, file.path.slice(7)) : path.join(root, file.path);
    const stat = fs.lstatSync(actual);
    if (!stat.isFile() || stat.isSymbolicLink() || (file.path.startsWith('assets/') && (stat.mode & 0o222)) || stat.size !== file.size || crypto.createHash('sha256').update(fs.readFileSync(actual)).digest('hex') !== file.sha256) throw new Error(`Prepared release mismatch: ${file.path}`);
  }
  return { ok: true, release: root };
}

export async function migrateDocumentRoot({ webroot, base, releases, state, pointer, observedRelease, inventory, sharedAssets, stableTest, expectedUid, expectedGid, backupName = 'pre-atomic-public_html', smoke, runExchange, beforeExchange, afterBackupRename }) {
  if (typeof smoke !== 'function') throw new Error('Live smoke verification is required');
  verifyHostCompatibility({ webroot, base, expectedUid, expectedGid, runExchange });
  const candidate = fs.realpathSync(observedRelease);
  if (path.dirname(candidate) !== fs.realpathSync(releases)) throw new Error('Observed release must be a direct release child');
  const unlock = acquireLock(state);
  const journalFile = path.join(state, MIGRATION_JOURNAL);
  const exchangePath = `${webroot}.atomic-exchange`;
  const backupPath = path.join(base, 'backups', backupName);
  let didExchange = false;
  try {
    if (fs.existsSync(journalFile) || fs.existsSync(exchangePath) || fs.existsSync(backupPath)) throw new Error('Migration state already exists; recover or investigate first');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true, mode: 0o700 });
    verifyPreparedRelease({ release: candidate, inventory, sharedAssets, stableTest });
    auditLegacyWebroot({ webroot, candidate, inventory });
    const legacyAssets = importAppendOnlyTree(path.join(webroot, 'assets'), sharedAssets);
    if (fs.existsSync(path.join(webroot, 'test')) && !fs.existsSync(stableTest)) {
      fs.mkdirSync(stableTest, { mode: 0o755 }); fs.chownSync(stableTest, expectedUid, expectedGid);
    }
    const legacyTest = fs.existsSync(path.join(webroot, 'test')) ? importAppendOnlyTree(path.join(webroot, 'test'), stableTest) : [];
    atomicSymlink(pointer, candidate, { uid: expectedUid, gid: expectedGid });
    fs.symlinkSync(pointer, exchangePath); fs.lchownSync(exchangePath, expectedUid, expectedGid); fsyncDir(path.dirname(webroot));
    writeJson(journalFile, { version: 1, phase: 'prepared', webroot, exchangePath, backupPath, pointer, candidate, legacyAssets, legacyTest });
    if (beforeExchange) await beforeExchange();
    (runExchange || exchange)(webroot, exchangePath);
    didExchange = true;
    writeJson(journalFile, { version: 1, phase: 'exchanged', webroot, exchangePath, backupPath, pointer, candidate, legacyAssets, legacyTest });
    if (!fs.lstatSync(webroot).isSymbolicLink() || fs.realpathSync(webroot) !== candidate) throw new Error('Document root exchange verification failed');
    if ((await smoke({ active: candidate }))?.ok !== true) throw new Error('Post-migration smoke verification failed; original directory remains at exchange path');
    fs.renameSync(exchangePath, backupPath); fsyncDir(path.dirname(backupPath)); fsyncDir(path.dirname(webroot));
    if (afterBackupRename) await afterBackupRename();
    writeJson(journalFile, { version: 1, phase: 'complete', webroot, backupPath, pointer, candidate, legacyAssets, legacyTest });
    return { active: candidate, backup: backupPath };
  } catch (error) {
    if (didExchange && fs.lstatSync(webroot).isSymbolicLink() && fs.existsSync(exchangePath) && fs.lstatSync(exchangePath).isDirectory()) {
      (runExchange || exchange)(webroot, exchangePath);
      didExchange = false;
      if (fs.lstatSync(webroot).isDirectory() && fs.lstatSync(exchangePath).isSymbolicLink()) {
        fs.unlinkSync(exchangePath); fsyncDir(path.dirname(webroot));
        writeJson(journalFile, { version: 1, phase: 'rolled-back', webroot, pointer, candidate, error: error.message });
        if ((await smoke({ active: webroot, rollback: true }))?.ok !== true) throw new Error(`Migration rolled back but rollback smoke failed: ${error.message}`);
      }
    }
    throw error;
  } finally { unlock(); }
}

export async function recoverDocumentRootMigration({ state, smoke, runExchange }) {
  if (typeof smoke !== 'function') throw new Error('Recovery smoke verification is required');
  const unlock = acquireLock(state); const journalFile = path.join(state, MIGRATION_JOURNAL);
  try {
    const pending = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
    if (pending.version !== 1 || !['prepared', 'exchanged'].includes(pending.phase)) throw new Error('Migration journal is not recoverable');
    const { webroot, exchangePath, backupPath } = pending;
    if (fs.lstatSync(webroot).isSymbolicLink() && fs.existsSync(exchangePath) && fs.lstatSync(exchangePath).isDirectory()) {
      (runExchange || exchange)(webroot, exchangePath);
    }
    if (fs.lstatSync(webroot).isSymbolicLink() && !fs.existsSync(exchangePath) && backupPath && fs.lstatSync(backupPath).isDirectory()) {
      (runExchange || exchange)(webroot, backupPath);
      if (!fs.lstatSync(backupPath).isSymbolicLink()) throw new Error('Backup exchange did not produce the expected rollback pointer');
      fs.unlinkSync(backupPath); fsyncDir(path.dirname(backupPath));
    } else {
      if (!fs.lstatSync(webroot).isDirectory() || !fs.lstatSync(exchangePath).isSymbolicLink()) throw new Error('Migration paths do not match a safe rollback state');
      fs.unlinkSync(exchangePath); fsyncDir(path.dirname(webroot));
    }
    if ((await smoke({ active: webroot, rollback: true }))?.ok !== true) throw new Error('Recovered document root failed smoke verification');
    writeJson(journalFile, { ...pending, phase: 'rolled-back', recoveredAt: new Date().toISOString() });
    return { active: webroot };
  } finally { unlock(); }
}

export async function activatePreparedRelease({ releases, state, pointer, candidate, inventory, sharedAssets, stableTest, preflight, smoke, rollbackSmoke }) {
  if (![preflight, smoke, rollbackSmoke].every(fn => typeof fn === 'function')) throw new Error('Preflight, smoke and rollback smoke checks are required');
  const target = fs.realpathSync(candidate);
  if (path.dirname(target) !== fs.realpathSync(releases)) throw new Error('Candidate must be a direct release child');
  verifyPreparedRelease({ release: target, inventory, sharedAssets, stableTest });
  const unlock = acquireLock(state); const journal = path.join(state, DEPLOY_JOURNAL);
  try {
    if (fs.existsSync(journal)) throw new Error('Interrupted activation requires recovery');
    const previous = readPointer(pointer, releases);
    if ((await preflight({ previous, candidate: target }))?.ok !== true) throw new Error('Preflight failed');
    writeJson(journal, { version: 1, previous, candidate: target, pointer, phase: 'prepared' });
    atomicSymlink(pointer, target, fs.statSync(target));
    writeJson(journal, { version: 1, previous, candidate: target, pointer, phase: 'switched' });
    if ((await smoke({ previous, candidate: target }))?.ok !== true) throw new Error('Smoke failed');
    fs.unlinkSync(journal); fsyncDir(state);
    return { active: target, previous };
  } catch (error) {
    if (fs.existsSync(journal)) {
      const pending = JSON.parse(fs.readFileSync(journal, 'utf8'));
      const current = readPointer(pointer, releases);
      if (![pending.previous, pending.candidate].includes(current)) throw new Error(`Pointer changed unexpectedly; journal retained: ${error.message}`);
      if (current !== pending.previous) atomicSymlink(pointer, pending.previous, fs.statSync(pending.previous));
      if ((await rollbackSmoke({ previous: pending.previous, candidate: pending.candidate }))?.ok !== true) throw new Error(`Rollback smoke failed; journal retained: ${error.message}`);
      fs.unlinkSync(journal); fsyncDir(state);
    }
    throw error;
  } finally { unlock(); }
}

export async function recoverActivation({ releases, state, pointer, rollbackSmoke }) {
  const unlock = acquireLock(state); const journal = path.join(state, DEPLOY_JOURNAL);
  try {
    const pending = JSON.parse(fs.readFileSync(journal, 'utf8'));
    const previous = path.resolve(pending.previous); const candidate = path.resolve(pending.candidate);
    if (path.dirname(previous) !== fs.realpathSync(releases) || path.dirname(candidate) !== fs.realpathSync(releases)) throw new Error('Invalid recovery journal');
    const current = readPointer(pointer, releases);
    if (![previous, candidate].includes(current)) throw new Error('Recovery refused because the pointer has changed');
    if (current !== previous) atomicSymlink(pointer, previous, fs.statSync(previous));
    if ((await rollbackSmoke({ previous, candidate }))?.ok !== true) throw new Error('Recovery smoke failed; journal retained');
    fs.unlinkSync(journal); fsyncDir(state); return { active: previous };
  } finally { unlock(); }
}

