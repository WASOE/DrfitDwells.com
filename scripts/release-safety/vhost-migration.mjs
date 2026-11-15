import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apacheSharedAssetsDirectives, publishSharedAssets, verifySharedAssets } from './shared-assets.mjs';
import { createInventory } from './frontend-inventory.mjs';

const JOURNAL = 'vhost-migration.json';
const LOCK = 'vhost-migration.lock';
const HASH = /^[a-f0-9]{64}$/;
export const DIRECTADMIN_REGENERATION_VERIFIED = false;

function assertDirectAdminRegenerationAvailable(run, siteConfig) {
  const actualAccount = '/usr/local/directadmin/data/users/illoc/httpd.conf';
  if (!DIRECTADMIN_REGENERATION_VERIFIED &&
      (run === runCommand || siteConfig === actualAccount ||
       (typeof siteConfig === 'string' && fs.existsSync(siteConfig) && fs.realpathSync(siteConfig) === actualAccount))) {
    throw new Error('DirectAdmin apply/recovery is disabled until pre-load validation and effective reload/recovery verification are implemented and verified');
  }
}

function hashFile(file) {
  const digest = crypto.createHash('sha256');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`Not a regular file: ${file}`);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) {
      digest.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return digest.digest('hex');
}

function readRegularFile(file, label) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`${label} must be a regular, unlinked file`);
    return { data: fs.readFileSync(fd), stat };
  } finally {
    fs.closeSync(fd);
  }
}

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function requireCommandOk(run, command, args, label) {
  const result = run(command, args);
  if (!result || result.status !== 0) {
    throw new Error(`${label} failed${result?.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
  return result;
}

function verifyApacheConfig(run, httpd, httpdArgs, apacheConfig, siteConfig, label) {
  requireCommandOk(run, httpd, [...httpdArgs, '-t', '-f', apacheConfig], label);
  const result = requireCommandOk(
    run, httpd, [...httpdArgs, '-t', '-D', 'DUMP_INCLUDES', '-f', apacheConfig],
    `${label} include inventory`
  );
  if (!`${result.stdout || ''}\n${result.stderr || ''}`.includes(siteConfig)) {
    throw new Error(`${label} did not confirm the supplied site config is included by Apache`);
  }
}

function validatePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value ||
      value.includes('\0') || value.split(path.sep).some(part => part === '..')) {
    throw new Error(`${label} must be a normalized absolute path`);
  }
  return value;
}

function validateAssets(assets) {
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error('A non-empty shared-assets manifest is required');
  }
  const seen = new Set();
  for (const asset of assets) {
    if (!asset || typeof asset.path !== 'string' ||
        !/^assets\/[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(asset.path) ||
        asset.path.split('/').some(part => part === '.' || part === '..') ||
        !Number.isSafeInteger(asset.size) || asset.size < 0 || !HASH.test(asset.sha256)) {
      throw new Error('Invalid shared-assets manifest entry');
    }
    if (seen.has(asset.path)) throw new Error(`Duplicate shared asset: ${asset.path}`);
    seen.add(asset.path);
  }
  return assets.map(({ path: assetPath, size, sha256 }) => ({ path: assetPath, size, sha256 }));
}

function validateAssetSource(webrootEntries, assets) {
  const expected = new Map(assets.map(asset => [asset.path, asset]));
  const actual = webrootEntries.filter(entry => entry.type === 'file' && entry.path.startsWith('assets/'));
  if (actual.length !== expected.size) {
    throw new Error('Shared-assets manifest must list every and only asset file in the document root');
  }
  for (const entry of actual) {
    const listed = expected.get(entry.path);
    if (!listed || listed.size !== entry.size || listed.sha256 !== entry.sha256) {
      throw new Error(`Shared-assets manifest does not match document-root asset: ${entry.path}`);
    }
  }
}

function pathExists(value) {
  try { fs.lstatSync(value); return true; }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function disjoint(left, right, message) {
  if (left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`)) {
    throw new Error(message);
  }
}

function requireRealDirectory(dir, label) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir) {
    throw new Error(`${label} must be a real, non-symlink directory: ${dir}`);
  }
}

function requireRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || fs.realpathSync(file) !== file) {
    throw new Error(`${label} must be a real, non-symlink regular file: ${file}`);
  }
}

function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncFile(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function syncTree(root) {
  const entries = pathManifest(root);
  for (const entry of entries.filter(item => item.type === 'file')) syncFile(path.join(root, entry.path));
  for (const entry of entries.filter(item => item.type === 'directory').reverse()) {
    syncDirectory(path.join(root, entry.path));
  }
  syncDirectory(root);
}

function writeDurable(file, data, mode = 0o600) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, file);
  syncDirectory(path.dirname(file));
}

function saveJournal(stateRoot, journal) {
  writeDurable(path.join(stateRoot, JOURNAL), `${JSON.stringify(journal, null, 2)}\n`);
}

function updateJournal(stateRoot, journal, status, detail = null) {
  const next = { ...journal, status, updatedAt: new Date().toISOString() };
  if (detail) next.detail = detail;
  saveJournal(stateRoot, next);
  Object.assign(journal, next);
}

async function confirmReload(verifyReload, context, timeoutMs) {
  if (typeof verifyReload !== 'function') {
    throw new Error('Effective Apache reload and live-site verification are required');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new Error('Reload verification timeout must be between 1 and 300000 milliseconds');
  }
  let timer;
  try {
    const result = await Promise.race([
      verifyReload(context),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Effective Apache reload verification timed out');
          error.code = 'RELOAD_VERIFICATION_TIMEOUT';
          reject(error);
        }, timeoutMs);
      })
    ]);
    if (result?.ok !== true) throw new Error(`Effective Apache ${context.phase} reload and live-site verification are unconfirmed`);
  } finally {
    clearTimeout(timer);
  }
}

function lockState(stateRoot) {
  const lockPath = path.join(stateRoot, LOCK);
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    requireRealDirectory(lockPath, 'Migration lock');
    if (fs.statSync(lockPath).mode & 0o077) throw new Error('Migration lock must remain private');
    let owner;
    try { owner = JSON.parse(readRegularFile(path.join(lockPath, 'owner.json'), 'Migration lock owner').data.toString('utf8')); }
    catch { throw new Error(`Migration lock exists and cannot be verified: ${lockPath}`); }
    if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid < 1) {
      throw new Error(`Migration lock belongs to another or unknown process: ${lockPath}`);
    }
    try {
      process.kill(owner.pid, 0);
      throw new Error(`Migration lock owner is still running (pid ${owner.pid})`);
    } catch (probeError) {
      if (probeError.code !== 'ESRCH') throw probeError;
    }
    fs.unlinkSync(path.join(lockPath, 'owner.json'));
    fs.rmdirSync(lockPath);
    fs.mkdirSync(lockPath, { mode: 0o700 });
  }
  writeDurable(path.join(lockPath, 'owner.json'), JSON.stringify({ host: os.hostname(), pid: process.pid }));
  syncDirectory(stateRoot);
  return () => {
    fs.unlinkSync(path.join(lockPath, 'owner.json'));
    fs.rmdirSync(lockPath);
    syncDirectory(stateRoot);
  };
}

function pathManifest(root) {
  const entries = [];
  function walk(dir, relative = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Webroot contains a symlink; refusing incomplete snapshot: ${rel}`);
      if (stat.isDirectory()) {
        entries.push({ path: rel, type: 'directory', mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid });
        walk(absolute, rel);
      } else if (stat.isFile()) {
        entries.push({
          path: rel, type: 'file', mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid,
          size: stat.size, sha256: hashFile(absolute)
        });
      } else {
        throw new Error(`Unsupported webroot entry; refusing incomplete snapshot: ${rel}`);
      }
    }
  }
  requireRealDirectory(root, 'Webroot');
  walk(root);
  return entries;
}

function contentManifest(entries) {
  return entries.map(({ path: rel, type, size, sha256 }) => ({ path: rel, type, size, sha256 }));
}

function totalFileBytes(entries) {
  let bytes = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    if (!Number.isSafeInteger(entry.size)) throw new Error(`Webroot file is too large to inventory safely: ${entry.path}`);
    bytes += entry.size;
    if (!Number.isSafeInteger(bytes)) throw new Error('Webroot size exceeds the safe inventory limit');
  }
  return bytes;
}

function assertCopyCapacity(entries, releasesRoot, stateRoot) {
  if (typeof fs.statfsSync !== 'function') throw new Error('Filesystem free-space checks are unavailable in this Node.js runtime');
  const bytes = BigInt(totalFileBytes(entries));
  const margin = 16n * 1024n * 1024n;
  const releaseStat = fs.statSync(releasesRoot, { bigint: true });
  const stateParent = path.dirname(stateRoot);
  const stateStat = fs.statSync(stateParent, { bigint: true });
  const releaseFs = fs.statfsSync(releasesRoot, { bigint: true });
  const stateFs = fs.statfsSync(stateParent, { bigint: true });
  const available = info => info.bavail * info.bsize;
  const inodes = BigInt(entries.length);
  if (releaseStat.dev === stateStat.dev) {
    if (available(releaseFs) < bytes * 2n + margin) {
      throw new Error('Insufficient free space for both complete migration copies and safety margin');
    }
    if (releaseFs.favail < inodes * 2n + 1024n) throw new Error('Insufficient free inodes for both migration copies');
  } else {
    if (available(releaseFs) < bytes + margin / 2n || available(stateFs) < bytes + margin / 2n) {
      throw new Error('Insufficient free space on the release or backup filesystem');
    }
    if (releaseFs.favail < inodes + 512n || stateFs.favail < inodes + 512n) {
      throw new Error('Insufficient free inodes on the release or backup filesystem');
    }
  }
}

function compareManifest(actual, expected, label, checkModes = true) {
  const left = checkModes ? actual : contentManifest(actual);
  const right = checkModes ? expected : contentManifest(expected);
  if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`${label} integrity check failed`);
}

function sealTree(root, entries, rootMode) {
  for (const entry of entries.filter(item => item.type === 'file')) {
    const file = path.join(root, entry.path);
    const mode = entry.mode & ~0o222;
    fs.chmodSync(file, mode);
    if ((fs.statSync(file).mode & 0o7777) !== mode) throw new Error(`Unable to make snapshot read-only: ${entry.path}`);
  }
  for (const entry of entries.filter(item => item.type === 'directory').reverse()) {
    fs.chmodSync(path.join(root, entry.path), entry.mode & ~0o222);
  }
  fs.chmodSync(root, rootMode & ~0o222);
  syncTree(root);
}

function copyArchive(run, command, source, destination) {
  requireCommandOk(run, command, ['-a', '--preserve=all', '--', source, destination], `Metadata-preserving copy of ${source}`);
}

function ensureFreeState(stateRoot) {
  if (path.dirname(stateRoot) === stateRoot) throw new Error('State directory cannot be a filesystem root');
  if (fs.existsSync(stateRoot)) {
    throw new Error(`State directory must be new for a one-time migration: ${stateRoot}`);
  }
  requireRealDirectory(path.dirname(stateRoot), 'State directory parent');
  fs.mkdirSync(stateRoot, { mode: 0o700 });
  syncDirectory(path.dirname(stateRoot));
}

function validateMigrationPaths({
  siteConfig, apacheConfig, documentRoot, sharedAssets, assets, releasesRoot, pointer, stateRoot,
  customConfig, directadminUser
}) {
  for (const [value, label] of [
    [siteConfig, 'Site config'], [apacheConfig, 'Apache config'], [documentRoot, 'Document root'],
    [sharedAssets, 'Shared assets'], [releasesRoot, 'Release root'],
    [pointer, 'Release pointer'], [stateRoot, 'State directory'],
    [customConfig, 'Persistent DirectAdmin custom config']
  ]) validatePath(value, label);
  validateDirectAdminUser(directadminUser);
  validateDirectAdminPaths(siteConfig, customConfig);
  requireRegularFile(siteConfig, 'Site config');
  requireRegularFile(apacheConfig, 'Apache config');
  requireRegularFile(customConfig, 'Persistent DirectAdmin custom config');
  if (new Set([siteConfig, apacheConfig, customConfig]).size !== 3) {
    throw new Error('Apache main, generated site, and persistent DirectAdmin configs must be distinct files');
  }
  if (!path.basename(customConfig).endsWith('.cust_httpd') ||
      path.basename(customConfig).endsWith('.cust_httpd_ssl')) {
    throw new Error('Persistent config must be the per-domain .cust_httpd source used by the effective vhosts');
  }
  for (const [other, otherLabel] of [
    [documentRoot, 'document root'], [sharedAssets, 'shared assets'],
    [releasesRoot, 'release root'], [stateRoot, 'state directory'], [pointer, 'release pointer'],
    [apacheConfig, 'Apache config']
  ]) {
    disjoint(customConfig, other, `Persistent DirectAdmin config must be separate from the ${otherLabel}`);
  }
  requireRealDirectory(documentRoot, 'Document root');
  requireRealDirectory(sharedAssets, 'Shared assets directory');
  const verifiedAssets = validateAssets(assets);
  requireRealDirectory(releasesRoot, 'Release root');
  requireRealDirectory(path.dirname(pointer), 'Release pointer parent');
  if (pathExists(pointer)) {
    throw new Error('Release pointer must be absent and its parent must not be a symlink');
  }
  if (path.dirname(stateRoot) !== stateRoot) requireRealDirectory(path.dirname(stateRoot), 'State directory parent');
  for (const [other, label] of [
    [sharedAssets, 'Shared assets'], [releasesRoot, 'Release root'],
    [pointer, 'Release pointer'], [stateRoot, 'State directory']
  ]) {
    disjoint(documentRoot, other, `${label} must be outside and separate from the existing document root`);
  }
  disjoint(sharedAssets, releasesRoot, 'Shared assets must be separate from the release directory');
  disjoint(sharedAssets, pointer, 'Shared assets must be separate from the release pointer');
  disjoint(sharedAssets, stateRoot, 'Shared assets must be separate from migration state');
  disjoint(releasesRoot, stateRoot, 'Release and state directories must be separate');
  disjoint(releasesRoot, pointer, 'Release pointer must be separate from the release directory');
  disjoint(pointer, stateRoot, 'Release pointer and state directory must be separate');
  for (const config of new Set([siteConfig, apacheConfig])) {
    for (const [other, label] of [
      [documentRoot, 'document root'], [sharedAssets, 'shared assets'],
      [releasesRoot, 'release root'], [stateRoot, 'state directory'], [pointer, 'release pointer']
    ]) disjoint(config, other, `Apache config must be separate from the ${label}`);
  }
  const siteSource = readRegularFile(siteConfig, 'Generated Apache site config').data.toString('utf8');
  assertVhostProtocolCoverage(siteSource);
  assertMainCgiTemplateOutput(siteSource, documentRoot);
  const transformedSiteConfig = prepareSiteVhostConfig(siteSource, {
    originalRoot: documentRoot, releasePointer: pointer, sharedAssets
  });
  const savedCustomConfig = readRegularFile(customConfig, 'Persistent DirectAdmin custom config');
  const customSource = savedCustomConfig.data.toString('utf8');
  const transformedCustomConfig = prepareDirectAdminCustomConfig(customSource, {
    originalRoot: documentRoot, releasePointer: pointer, sharedAssets
  });
  const persistentConfigs = [{
    path: customConfig, protocol: 'cust_httpd', source: customSource,
    transformed: transformedCustomConfig, originalHash: hashText(savedCustomConfig.data),
    migratedHash: hashText(transformedCustomConfig), mode: savedCustomConfig.stat.mode & 0o7777,
    uid: savedCustomConfig.stat.uid, gid: savedCustomConfig.stat.gid
  }];
  const journal = path.join(stateRoot, JOURNAL);
  if (fs.existsSync(journal)) throw new Error('A prior migration journal exists; use recovery or rollback');
  return {
    transformedSiteConfig, persistentConfigs, assets: verifiedAssets,
    originalConfigHash: hashText(siteSource), migratedConfigHash: hashText(transformedSiteConfig)
  };
}

function validateDirectAdminPaths(siteConfig, customConfig) {
  const accountDir = path.dirname(siteConfig);
  if (path.basename(siteConfig) !== 'httpd.conf' ||
      path.basename(accountDir) !== 'illoc' ||
      path.basename(path.dirname(accountDir)) !== 'users' ||
      customConfig !== path.join(accountDir, 'domains', 'driftdwells.com.cust_httpd')) {
    throw new Error('DirectAdmin configuration paths must identify the illoc account and driftdwells.com domain');
  }
}

function validateDirectAdminUser(user) {
  if (user !== 'illoc') {
    throw new Error('This migration permits only the explicitly scoped DirectAdmin account illoc');
  }
  return user;
}

function directAdminTaskArgs(user) {
  return ['taskq', `--run=action=rewrite&value=httpd&user=${validateDirectAdminUser(user)}`];
}

function runDirectAdminRewrite(run, directadmin, user, label) {
  requireCommandOk(run, directadmin, directAdminTaskArgs(user), label);
}

function atomicReplacePersistentConfig(entry, contents, expectedHash, { copyCommand, run }) {
  const current = readRegularFile(entry.path, 'Persistent DirectAdmin custom config');
  const currentHash = hashText(current.data);
  if (current.stat.uid !== entry.uid || current.stat.gid !== entry.gid ||
      (current.stat.mode & 0o7777) !== entry.mode) {
    throw new Error(`Persistent DirectAdmin config metadata changed outside the migration: ${entry.path}`);
  }
  if (currentHash !== entry.originalHash && currentHash !== entry.migratedHash && currentHash !== expectedHash) {
    throw new Error(`Persistent DirectAdmin config changed outside the migration: ${entry.path}`);
  }
  if (currentHash === expectedHash) return;
  const backup = readRegularFile(entry.backupPath, 'Persistent DirectAdmin config backup');
  if (hashText(backup.data) !== entry.originalHash || backup.stat.uid !== entry.uid ||
      backup.stat.gid !== entry.gid || (backup.stat.mode & 0o7777) !== (entry.mode & ~0o222)) {
    throw new Error(`Persistent DirectAdmin config backup metadata or integrity mismatch: ${entry.path}`);
  }
  const temp = entry.tempPath;
  if (pathExists(temp)) throw new Error(`Persistent config transaction path already exists: ${temp}`);
  copyArchive(run, copyCommand, entry.backupPath, temp);
  const copied = readRegularFile(temp, 'Metadata-preserving persistent config temporary');
  if (copied.stat.uid !== entry.uid || copied.stat.gid !== entry.gid ||
      (copied.stat.mode & 0o7777) !== (entry.mode & ~0o222)) {
    throw new Error(`Persistent config metadata was not preserved by cp --preserve=all: ${entry.path}`);
  }
  fs.chmodSync(temp, entry.mode);
  const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const prepared = readRegularFile(temp, 'Prepared persistent DirectAdmin config');
  if (hashText(prepared.data) !== expectedHash || prepared.stat.uid !== entry.uid ||
      prepared.stat.gid !== entry.gid || (prepared.stat.mode & 0o7777) !== entry.mode) {
    throw new Error(`Persistent config content or metadata verification failed before replacement: ${entry.path}`);
  }
  fs.renameSync(temp, entry.path);
  syncDirectory(path.dirname(entry.path));
  const saved = readRegularFile(entry.path, 'Updated DirectAdmin custom config');
  if (hashText(saved.data) !== expectedHash || saved.stat.uid !== entry.uid ||
      saved.stat.gid !== entry.gid || (saved.stat.mode & 0o7777) !== entry.mode) {
    throw new Error(`Persistent DirectAdmin config write verification failed: ${entry.path}`);
  }
}

function restorePersistentConfig(entry, originalBytes, { copyCommand, run }) {
  const current = readRegularFile(entry.path, 'Persistent DirectAdmin custom config');
  const currentHash = hashText(current.data);
  if (currentHash !== entry.originalHash && currentHash !== entry.migratedHash) {
    throw new Error(`Recovery refused: persistent DirectAdmin config differs from both recorded versions: ${entry.path}`);
  }
  atomicReplacePersistentConfig(entry, originalBytes, entry.originalHash, {
    copyCommand, run
  });
  const restored = readRegularFile(entry.path, 'Restored DirectAdmin custom config');
  if (hashText(restored.data) !== entry.originalHash || restored.stat.uid !== entry.uid ||
      restored.stat.gid !== entry.gid || (restored.stat.mode & 0o7777) !== entry.mode) {
    throw new Error(`Persistent DirectAdmin config restoration verification failed: ${entry.path}`);
  }
}

function removeConfigTemps(journal) {
  for (const entry of journal.persistentConfigs) {
    let stat;
    try { stat = fs.lstatSync(entry.tempPath); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        stat.uid !== entry.uid || stat.gid !== entry.gid) {
      throw new Error(`Persistent config transaction file was replaced; refusing cleanup: ${entry.tempPath}`);
    }
    fs.unlinkSync(entry.tempPath);
    syncDirectory(path.dirname(entry.path));
  }
}

function verifyGeneratedConfig(expected, siteConfig, label, metadata = null) {
  const actual = readRegularFile(siteConfig, 'Generated Apache site config');
  if (hashText(actual.data) !== hashText(expected)) {
    throw new Error(`${label}: regenerated effective vhosts or unrelated directives differ from the journaled expectation`);
  }
  if (metadata && (actual.stat.uid !== metadata.uid || actual.stat.gid !== metadata.gid ||
      (actual.stat.mode & 0o7777) !== metadata.mode)) {
    throw new Error(`${label}: regenerated Apache config metadata changed`);
  }
  return hashText(actual.data);
}

function verifyPersistentConfigs(journal, expectedVersion) {
  for (const entry of journal.persistentConfigs) {
    const expectedHash = expectedVersion === 'original' ? entry.originalHash : entry.migratedHash;
    const actual = readRegularFile(entry.path, 'Persistent DirectAdmin custom config');
    if (hashText(actual.data) !== expectedHash || actual.stat.uid !== entry.uid ||
        actual.stat.gid !== entry.gid || (actual.stat.mode & 0o7777) !== entry.mode) {
      throw new Error(`Persistent DirectAdmin config verification failed (${expectedVersion}): ${entry.path}`);
    }
  }
}

function checkPointer(pointer, release) {
  try {
    const stat = fs.lstatSync(pointer);
    if (!stat.isSymbolicLink()) throw new Error('Release pointer was replaced by a non-symlink');
    const resolved = path.resolve(path.dirname(pointer), fs.readlinkSync(pointer));
    if (resolved !== release) throw new Error('Release pointer changed unexpectedly');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function writeProbeMarker(journal, token) {
  const releaseStat = fs.statSync(journal.release);
  if ((releaseStat.mode & 0o7777) !== journal.sealedRootMode) {
    throw new Error('Release root permissions changed before pointer verification');
  }
  if (pathExists(journal.probePath) || pathExists(journal.probeTempPath)) {
    throw new Error('Probe marker path already exists');
  }
  fs.chmodSync(journal.release, journal.sealedRootMode | 0o200);
  try {
    const fd = fs.openSync(journal.probeTempPath, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, token);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(journal.probeTempPath, journal.probePath);
    fs.chmodSync(journal.probePath, 0o444);
    syncDirectory(journal.release);
  } finally {
    fs.chmodSync(journal.release, journal.sealedRootMode);
    syncDirectory(path.dirname(journal.release));
  }
}

function removeProbeMarker(journal) {
  const releaseStat = fs.statSync(journal.release);
  if (!releaseStat.isDirectory() || fs.lstatSync(journal.release).isSymbolicLink()) {
    throw new Error('Release root changed before probe-marker cleanup');
  }
  const originalMode = releaseStat.mode & 0o7777;
  if (originalMode !== journal.sealedRootMode &&
      originalMode !== (journal.sealedRootMode | 0o200)) {
    throw new Error('Release root permissions changed unexpectedly; refusing probe-marker cleanup');
  }
  const ownedPaths = [journal.probePath, journal.probeTempPath];
  for (const file of ownedPaths) {
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        stat.uid !== journal.probeUid || stat.gid !== journal.probeGid) {
      throw new Error('Probe marker was replaced or has unexpected metadata; refusing cleanup');
    }
    if (file === journal.probePath && hashFile(file) !== journal.probeTokenHash) {
      throw new Error('Probe marker integrity check failed; refusing cleanup');
    }
  }
  fs.chmodSync(journal.release, journal.sealedRootMode | 0o200);
  try {
    for (const file of ownedPaths) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    syncDirectory(journal.release);
  } finally {
    fs.chmodSync(journal.release, journal.sealedRootMode);
    syncDirectory(path.dirname(journal.release));
  }
}

function configTextFromBackup(journal) {
  const backup = journal.backupConfig;
  requireRegularFile(backup, 'Config backup');
  const saved = readRegularFile(backup, 'Config backup').data;
  if (hashText(saved) !== journal.originalConfigHash) throw new Error('Original site config backup integrity check failed');
  return saved;
}

function persistentConfigBytes(journal, entry) {
  requireRegularFile(entry.backupPath, 'Persistent config backup');
  const saved = readRegularFile(entry.backupPath, 'Persistent config backup');
  if (hashText(saved.data) !== entry.originalHash || saved.stat.uid !== entry.uid ||
      saved.stat.gid !== entry.gid || (saved.stat.mode & 0o7777) !== (entry.mode & ~0o222)) {
    throw new Error(`Persistent config backup integrity or metadata check failed: ${entry.path}`);
  }
  return saved.data;
}

async function rollbackJournal(stateRoot, journal, run, { explicit = false, verifyReload, reloadTimeoutMs = 30_000 } = {}) {
  const originalConfig = configTextFromBackup(journal);
  removeConfigTemps(journal);
  readRegularFile(journal.siteConfig, 'Generated Apache site config');
  const pointerExists = checkPointer(journal.pointer, journal.release);
  if (['prepared', 'probe-created', 'pointer-created'].includes(journal.status)) {
    verifyPersistentConfigs(journal, 'original');
    verifyGeneratedConfig(originalConfig, journal.siteConfig, 'Unchanged original site config verification failed', {
      uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
    });
    removeProbeMarker(journal);
    updateJournal(stateRoot, journal, explicit ? 'rolled-back' : 'recovered',
      'No persistent configuration change began; release pointer, if present, was retained.');
    return { status: journal.status, documentRoot: journal.documentRoot, config: journal.siteConfig,
      persistentConfigs: journal.persistentConfigs.map(entry => entry.path), directadminUser: journal.directadminUser };
  }
  if (typeof verifyReload !== 'function') {
    throw new Error('Effective Apache rollback reload and live-site verification are required before recovery');
  }
  const restoreEntries = journal.persistentConfigs.map(entry => ({
    entry, bytes: persistentConfigBytes(journal, entry)
  }));
  updateJournal(stateRoot, journal, 'restore-started');
  for (const { entry, bytes } of restoreEntries) restorePersistentConfig(entry, bytes, {
    copyCommand: journal.copyCommand, run
  });
  updateJournal(stateRoot, journal, 'restore-installed');
  runDirectAdminRewrite(run, journal.directadmin, journal.directadminUser,
    'Account-scoped DirectAdmin rewrite after restoring persistent configs');
  verifyPersistentConfigs(journal, 'original');
  verifyApacheConfig(run, journal.httpd, journal.httpdArgs, journal.apacheConfig, journal.siteConfig,
    'Apache syntax test after restoring persistent configs');
  verifyGeneratedConfig(originalConfig, journal.siteConfig, 'Regenerated original site config verification failed', {
    uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
  });
  updateJournal(stateRoot, journal, 'restore-reload-pending');
  await confirmReload(verifyReload, { phase: 'rollback', pointer: journal.pointer, release: journal.release,
    siteConfig: journal.siteConfig }, reloadTimeoutMs);
  verifyPersistentConfigs(journal, 'original');
  verifyGeneratedConfig(originalConfig, journal.siteConfig, 'Original site config changed during reload verification', {
    uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
  });
  removeProbeMarker(journal);
  if (pointerExists && !checkPointer(journal.pointer, journal.release)) {
    throw new Error('Recovery refused: release pointer disappeared during reload verification');
  }
  updateJournal(stateRoot, journal, explicit ? 'rolled-back' : 'recovered',
    'Persistent config restored and effective reload verified; release pointer retained for existing Apache workers and recovery.');
  return { status: journal.status, documentRoot: journal.documentRoot, config: journal.siteConfig,
    persistentConfigs: journal.persistentConfigs.map(entry => entry.path), directadminUser: journal.directadminUser };
}

function validateJournal(stateRoot, journal) {
  if (journal?.version !== 2 || !/^[0-9a-f-]{36}$/.test(journal.migrationId) ||
      !HASH.test(journal.originalConfigHash) || !HASH.test(journal.migratedConfigHash) ||
      !HASH.test(journal.backupManifestHash) || !HASH.test(journal.probeTokenHash) ||
      !['prepared', 'probe-created', 'pointer-created', 'installing-config', 'config-installed', 'syntax-passed',
        'reload-pending', 'active', 'restore-started', 'restore-installed', 'restore-reload-pending',
        'recovery-required', 'rolled-back', 'recovered'].includes(journal.status)) {
    throw new Error('Invalid vhost migration journal');
  }
  for (const [value, label] of [
    [journal.siteConfig, 'Journal site config'], [journal.apacheConfig, 'Journal Apache config'],
    [journal.documentRoot, 'Journal document root'], [journal.release, 'Journal release'],
    [journal.sharedAssets, 'Journal shared assets'], [journal.releasesRoot, 'Journal release root'],
    [journal.pointer, 'Journal pointer'],
    [journal.probePath, 'Journal probe marker'], [journal.probeTempPath, 'Journal probe marker temporary'],
    [journal.backupConfig, 'Journal config backup'], [journal.httpd, 'Journal Apache binary'],
    [journal.directadmin, 'Journal DirectAdmin binary'], [journal.copyCommand, 'Journal copy command']
  ]) validatePath(value, label);
  if (!Array.isArray(journal.httpdArgs) || journal.httpdArgs.some(arg => typeof arg !== 'string') ||
      !Array.isArray(journal.persistentConfigs) || journal.persistentConfigs.length !== 1) {
    throw new Error('Invalid command arguments in migration journal');
  }
  validateDirectAdminUser(journal.directadminUser);
  validateDirectAdminPaths(journal.siteConfig, journal.persistentConfigs[0].path);
  if (!Number.isInteger(journal.sealedRootMode) || journal.sealedRootMode < 0 || journal.sealedRootMode > 0o7777 ||
      !Number.isInteger(journal.probeUid) || !Number.isInteger(journal.probeGid) ||
      !Number.isInteger(journal.siteConfigMode) || !Number.isInteger(journal.siteConfigUid) ||
      !Number.isInteger(journal.siteConfigGid)) {
    throw new Error('Invalid probe marker metadata in migration journal');
  }
  if (journal.release !== path.join(journal.releasesRoot, `vhost-migration-${journal.migrationId}`) ||
      journal.probePath !== path.join(journal.release, `vhost-migration-${journal.migrationId}-probe.txt`) ||
      journal.probeTempPath !== `${journal.probePath}.tmp` ||
      journal.backupConfig !== path.join(stateRoot, 'backup', 'generated-site.conf')) {
    throw new Error('Journal paths escape their recorded migration roots');
  }
  for (const entry of journal.persistentConfigs) {
    validatePath(entry.path, 'Journal persistent config');
    validatePath(entry.backupPath, 'Journal persistent config backup');
    validatePath(entry.tempPath, 'Journal persistent config temporary');
    if (entry.protocol !== 'cust_httpd' ||
        entry.backupPath !== path.join(stateRoot, 'backup', 'persistent-cust_httpd.conf') ||
        entry.tempPath !== `${entry.path}.vhost-migration-${journal.migrationId}.tmp` ||
        !HASH.test(entry.originalHash) || !HASH.test(entry.migratedHash) ||
        !Number.isInteger(entry.uid) || !Number.isInteger(entry.gid) ||
        !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777) {
      throw new Error('Invalid persistent config journal entry');
    }
    disjoint(journal.siteConfig, entry.path, 'Generated and persistent Apache configs must be separate');
    requireRegularFile(entry.path, 'Journal persistent DirectAdmin config');
    const current = readRegularFile(entry.path, 'Journal persistent DirectAdmin config');
    if ((hashText(current.data) !== entry.originalHash && hashText(current.data) !== entry.migratedHash) ||
        current.stat.uid !== entry.uid || current.stat.gid !== entry.gid ||
        (current.stat.mode & 0o7777) !== entry.mode) {
      throw new Error(`Persistent DirectAdmin config changed outside the recorded transaction: ${entry.path}`);
    }
  }
  if (!path.basename(journal.persistentConfigs[0].path).endsWith('.cust_httpd') ||
      path.basename(journal.persistentConfigs[0].path).endsWith('.cust_httpd_ssl')) {
    throw new Error('Journal does not identify the effective per-domain .cust_httpd source');
  }
  disjoint(journal.documentRoot, journal.releasesRoot, 'Journal release root overlaps the original document root');
  disjoint(journal.documentRoot, journal.pointer, 'Journal pointer overlaps the original document root');
  disjoint(journal.documentRoot, journal.sharedAssets, 'Journal shared assets overlap the original document root');
  disjoint(journal.releasesRoot, journal.sharedAssets, 'Journal shared assets overlap the release root');
  disjoint(stateRoot, journal.sharedAssets, 'Journal shared assets overlap migration state');
  disjoint(journal.pointer, journal.sharedAssets, 'Journal shared assets overlap the release pointer');
  disjoint(journal.releasesRoot, journal.pointer, 'Journal pointer overlaps the release root');
  disjoint(stateRoot, journal.releasesRoot, 'Journal state and release roots overlap');
  requireRegularFile(journal.siteConfig, 'Journal site config');
  requireRegularFile(journal.apacheConfig, 'Journal Apache config');
  requireRealDirectory(journal.documentRoot, 'Journal document root');
  requireRealDirectory(journal.sharedAssets, 'Journal shared assets directory');
  requireRealDirectory(journal.releasesRoot, 'Journal release root');
  requireRealDirectory(path.dirname(journal.pointer), 'Journal pointer parent');
  const manifest = path.join(stateRoot, 'backup', 'manifest.json');
  requireRegularFile(manifest, 'Backup manifest');
  if (hashFile(manifest) !== journal.backupManifestHash) throw new Error('Backup manifest integrity check failed');
  const saved = JSON.parse(readRegularFile(manifest, 'Backup manifest').data.toString('utf8'));
  if (saved.version !== 2 || saved.migrationId !== journal.migrationId ||
      saved.documentRoot !== journal.documentRoot || saved.sharedAssets !== journal.sharedAssets ||
      saved.originalConfigHash !== journal.originalConfigHash ||
      JSON.stringify(saved.siteConfig) !== JSON.stringify({
        path: journal.siteConfig, mode: journal.siteConfigMode, uid: journal.siteConfigUid, gid: journal.siteConfigGid
      }) ||
      JSON.stringify(saved.assets) !== JSON.stringify(journal.assets) ||
      JSON.stringify(saved.persistentConfigs) !== JSON.stringify(journal.persistentConfigs.map(({ path: configPath,
        protocol, originalHash, migratedHash, mode, uid, gid }) => ({
        path: configPath, protocol, originalHash, migratedHash, mode, uid, gid
      })))) {
    throw new Error('Backup manifest identity mismatch');
  }
  const journalAssets = validateAssets(journal.assets);
  verifySharedAssets(journal.sharedAssets, journalAssets);
  const backupRoot = path.join(stateRoot, 'backup');
  const backupWebroot = path.join(backupRoot, 'webroot');
  requireRealDirectory(backupRoot, 'Backup directory');
  requireRealDirectory(backupWebroot, 'Backed-up document root');
  const actualBackupTree = pathManifest(backupWebroot);
  compareManifest(contentManifest(actualBackupTree), saved.backupWebroot, 'Backup webroot contents', false);
  const expectedSealedBackup = saved.originalWebroot.map(entry => ({ ...entry, mode: entry.mode & ~0o222 }));
  compareManifest(actualBackupTree, expectedSealedBackup, 'Read-only backup metadata');
  const backupConfig = readRegularFile(journal.backupConfig, 'Config backup').data;
  if (hashText(backupConfig) !== journal.originalConfigHash) throw new Error('Original site config backup integrity check failed');
  const expectedConfig = prepareSiteVhostConfig(backupConfig.toString('utf8'), {
    originalRoot: journal.documentRoot, releasePointer: journal.pointer, sharedAssets: journal.sharedAssets
  });
  if (hashText(expectedConfig) !== journal.migratedConfigHash) {
    throw new Error('Recorded transformed config does not match the immutable backup');
  }
  const generatedBackupStat = readRegularFile(journal.backupConfig, 'Generated config backup').stat;
  if (generatedBackupStat.uid !== journal.siteConfigUid || generatedBackupStat.gid !== journal.siteConfigGid ||
      (generatedBackupStat.mode & 0o7777) !== (journal.siteConfigMode & ~0o222)) {
    throw new Error('Generated Apache config backup metadata differs from its journaled baseline');
  }
  for (const entry of journal.persistentConfigs) {
    const backup = readRegularFile(entry.backupPath, 'Persistent config backup');
    if (hashText(backup.data) !== entry.originalHash || backup.stat.uid !== entry.uid ||
        backup.stat.gid !== entry.gid || (backup.stat.mode & 0o7777) !== (entry.mode & ~0o222)) {
      throw new Error(`Persistent config backup integrity or metadata check failed: ${entry.path}`);
    }
    const expected = prepareDirectAdminCustomConfig(backup.data.toString('utf8'), {
      originalRoot: journal.documentRoot, releasePointer: journal.pointer, sharedAssets: journal.sharedAssets
    });
    if (hashText(expected) !== entry.migratedHash) {
      throw new Error(`Recorded DirectAdmin config transformation does not match its immutable backup: ${entry.path}`);
    }
  }
  if ((fs.statSync(backupRoot).mode & 0o222) ||
      (fs.statSync(backupWebroot).mode & 0o222) ||
      (fs.statSync(manifest).mode & 0o222) ||
      (fs.statSync(journal.backupConfig).mode & 0o222) ||
      journal.persistentConfigs.some(entry => fs.statSync(entry.backupPath).mode & 0o222)) {
    throw new Error('Migration backup is not sealed read-only');
  }
}

/**
 * Generate the expected effective config for strict post-regeneration comparison.
 * The generated DirectAdmin config is never written by this module.
 */
export function prepareSiteVhostConfig(source, { originalRoot, releasePointer, sharedAssets }) {
  for (const value of [originalRoot, releasePointer]) {
    validatePath(value, 'Vhost document path');
    if (value.includes(' ') || value.endsWith('/')) throw new Error('Invalid absolute site path');
  }
  if (originalRoot === releasePointer || releasePointer.startsWith(`${originalRoot}/`)) {
    throw new Error('Release pointer must be separate from the original document root');
  }
  validatePath(sharedAssets, 'Shared assets');
  const sharedAssetDirectives = apacheSharedAssetsDirectives(sharedAssets);
  let matches = 0;
  const updated = source.replace(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g, block => {
    const names = [...block.matchAll(/^\s*ServerName\s+(\S+)\s*$/gm)].map(match => match[1]);
    if (!names.includes('www.driftdwells.com')) return block;
    if (names.length !== 1 || !/^\s*ServerAlias\s+www\.driftdwells\.com\s+driftdwells\.com\s*$/m.test(block)) {
      throw new Error('Unexpected Drift & Dwells virtual host identity');
    }
    const documentRoot = `DocumentRoot "${originalRoot}"`;
    const directoryRoot = `<Directory "${originalRoot}">`;
    const legalDirectory = `<Directory "${originalRoot}/legal">`;
    const legalAlias = `Alias /legal/ ${originalRoot}/legal/`;
    if ([documentRoot, directoryRoot, legalDirectory, legalAlias].some(directive => block.split(directive).length !== 2)) {
      throw new Error('Unexpected site document root directives');
    }
    const scriptAlias = `ScriptAlias /cgi-bin/ "${originalRoot}/cgi-bin/"`;
    const scriptAliases = block.match(/^[ \t]*ScriptAlias\s+\/cgi-bin\/[^\r\n]*$/gm) || [];
    if (scriptAliases.length > 1 || (scriptAliases.length === 1 && scriptAliases[0].trim() !== scriptAlias)) {
      throw new Error('Unexpected main-site CGI ScriptAlias; refusing to assume DirectAdmin DOCROOT token behavior');
    }
    for (const proxy of ['ProxyPass /api ', 'ProxyPass /uploads ']) {
      if (!block.includes(proxy)) throw new Error(`Missing site proxy: ${proxy}`);
    }
    const aliasDirectives = block.match(/^\s*(?:Alias|AliasMatch|ScriptAlias)\s+\/assets(?:\/|\s)[^\r\n]*$/gm) || [];
    const exactMappingCount = block.split(sharedAssetDirectives).length - 1;
    if (aliasDirectives.length > 1 || exactMappingCount > 1) {
      throw new Error('Site vhost has duplicate shared-assets Apache mappings');
    }
    let updatedBlock = block;
    if (aliasDirectives.length === 1 && exactMappingCount !== 1) {
      throw new Error('Site vhost has a conflicting shared-assets Apache mapping');
    }
    if (aliasDirectives.length === 0) {
      if (exactMappingCount !== 0 || block.includes(`<Directory "${sharedAssets}">`) ||
          block.includes(`<LocationMatch "^/assets/`)) {
        throw new Error('Site vhost has an incomplete shared-assets Apache mapping');
      }
      const templateDirective = /^\s*(?:ScriptAlias\s+\/cgi-bin\/|SSLEngine\b|ServerName\b|DocumentRoot\b|ServerAlias\b)/m;
      const insertion = block.search(templateDirective);
      if (insertion < 0) throw new Error('Unable to locate the DirectAdmin custom-config insertion boundary');
      updatedBlock = `${block.slice(0, insertion)}${sharedAssetDirectives}\n${block.slice(insertion)}`;
    }
    matches++;
    const opening = updatedBlock.match(/<VirtualHost\b([^>]*)>/);
    const httpVhost = /:80(?:\s|$)/.test(opening?.[1] ?? '');
    const transformed = updatedBlock.replace(documentRoot, `DocumentRoot "${releasePointer}"`)
      .replace(directoryRoot, `<Directory "${releasePointer}">`)
      .replace(legalDirectory, `<Directory "${releasePointer}/legal">`)
      .replace(legalAlias, `Alias /legal/ ${releasePointer}/legal/`);
    if (!httpVhost) return transformed;
    return scriptAliases.length === 1
      ? transformed.replace(scriptAlias, `ScriptAlias /cgi-bin/ "${releasePointer}/cgi-bin/"`)
      : transformed;
  });
  if (matches !== 2) throw new Error(`Expected exactly two site vhosts, found ${matches}`);
  return updated;
}

function assertVhostProtocolCoverage(source) {
  const blocks = [...source.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)].map(match => match[0]);
  const groups = [
    {
      label: 'main',
      matches: block => /^\s*ServerName\s+www\.driftdwells\.com\s*$/m.test(block) &&
        /^\s*ServerAlias\s+www\.driftdwells\.com\s+driftdwells\.com\s*$/m.test(block)
    },
    {
      label: 'test',
      matches: block => /^\s*ServerName\s+test\.driftdwells\.com\s*$/m.test(block) ||
        /^\s*ServerAlias\s+.*(?:^|\s)test\.driftdwells\.com(?:\s|$)/m.test(block)
    }
  ];
  for (const group of groups) {
    const matches = blocks.filter(group.matches);
    if (matches.length !== 2) throw new Error(`Expected exactly two ${group.label} HTTP/HTTPS vhosts, found ${matches.length}`);
    const ports = matches.map(block => {
      const opening = block.match(/<VirtualHost\b([^>]*)>/);
      return [...new Set([...(opening?.[1].matchAll(/:(80|443)(?=\s|$)/g) || [])].map(match => match[1]))];
    });
    if (ports.some(value => value.length !== 1) ||
        new Set(ports.map(value => value[0])).size !== 2 ||
        !ports.flat().includes('80') || !ports.flat().includes('443')) {
      throw new Error(`Expected one HTTP and one HTTPS ${group.label} vhost`);
    }
  }
}

function assertMainCgiTemplateOutput(source, originalRoot) {
  const expected = `ScriptAlias /cgi-bin/ "${originalRoot}/cgi-bin/"`;
  const mainBlocks = [...source.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)]
    .map(match => match[0])
    .filter(block => /^\s*ServerName\s+www\.driftdwells\.com\s*$/m.test(block));
  if (mainBlocks.length !== 2) throw new Error('Expected exactly two main-site vhosts for CGI template verification');
  for (const block of mainBlocks) {
    const opening = block.match(/<VirtualHost\b([^>]*)>/);
    const ports = new Set([...(opening?.[1].matchAll(/:(80|443)(?=\s|$)/g) || [])].map(match => match[1]));
    const aliases = block.match(/^[ \t]*ScriptAlias\s+\/cgi-bin\/[^\r\n]*$/gm) || [];
    if (ports.size !== 1 || aliases.length !== 1 || aliases[0].trim() !== expected) {
      throw new Error('Unexpected main-site CGI ScriptAlias or port; DirectAdmin template output is not verified');
    }
  }
}

export function prepareDirectAdminCustomConfig(source, { originalRoot, releasePointer, sharedAssets: assetsPath }) {
  for (const value of [originalRoot, releasePointer, assetsPath]) {
    validatePath(value, 'DirectAdmin document path');
    if (value.includes(' ') || value.endsWith('/')) throw new Error('Invalid absolute DirectAdmin site path');
  }
  if (originalRoot === releasePointer || releasePointer.startsWith(`${originalRoot}/`)) {
    throw new Error('Release pointer must be separate from the original document root');
  }
  if (typeof source !== 'string' || source.length === 0 || source.includes('\0')) {
    throw new Error('Persistent DirectAdmin custom config is empty or invalid');
  }
  if (/\|\?DOCROOT=/.test(source) ||
      /^\s*(?:Alias|AliasMatch|ScriptAlias)\s+\/assets(?:\/|\s)/m.test(source)) {
    throw new Error('Persistent DirectAdmin config already has migration directives; refusing ambiguous rewrite');
  }
  for (const proxy of ['ProxyPass /api ', 'ProxyPass /uploads ']) {
    if (!source.includes(proxy)) throw new Error(`Missing persistent site proxy: ${proxy}`);
  }

  const lines = source.split(/\r?\n/);
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const legalAliasPattern = /^([ \t]*)(Alias[ \t]+\/legal\/[ \t]+)(["']?)([^"' \t]+)(\3)([ \t]*)$/;
  const aliases = lines.map((line, index) => ({ line, index, match: line.match(legalAliasPattern) }))
    .filter(entry => entry.match);
  if (aliases.length !== 1 || aliases[0].match[4] !== `${originalRoot}/legal/`) {
    throw new Error('Persistent DirectAdmin config must contain exactly the expected /legal/ alias');
  }

  const directoryStarts = [];
  for (let index = 0; index < lines.length; index++) {
    const opening = lines[index].match(/^([ \t]*<Directory[ \t]+)(["']?)([^"']+?)(\2[ \t]*>)[ \t]*$/);
    if (opening && opening[3] === `${originalRoot}/legal`) directoryStarts.push({ index, opening });
  }
  if (directoryStarts.length !== 1) {
    throw new Error('Persistent DirectAdmin config must contain exactly the expected /legal Directory section');
  }
  const directoryStart = directoryStarts[0];
  const directoryEnd = lines.findIndex((line, index) => index > directoryStart.index && /^[ \t]*<\/Directory>[ \t]*$/.test(line));
  if (directoryEnd < 0 || lines.slice(directoryStart.index + 1, directoryEnd).some(line => /^\s*<Directory\b/i.test(line))) {
    throw new Error('Persistent DirectAdmin /legal Directory section is incomplete or nested');
  }

  const alias = aliases[0];
  const quote = alias.match[3];
  const mainAlias = `${alias.match[1]}${alias.match[2]}${quote}${releasePointer}/legal/${quote}${alias.match[6]}`;
  const originalAlias = alias.line;
  const mainDirectory = lines.slice(directoryStart.index, directoryEnd + 1)
    .map(line => line.replace(`${originalRoot}/legal`, `${releasePointer}/legal`));
  const originalDirectory = lines.slice(directoryStart.index, directoryEnd + 1);
  const conditional = (main, original) => [
    '|*if !SUB|', ...main, '|*else|', ...original, '|*endif|'
  ];

  const replacements = [
    {
      start: directoryStart.index, end: directoryEnd + 1,
      lines: conditional(mainDirectory, originalDirectory)
    },
    {
      start: alias.index, end: alias.index + 1,
      lines: conditional([mainAlias], [originalAlias])
    }
  ].sort((a, b) => b.start - a.start);
  for (const replacement of replacements) {
    lines.splice(replacement.start, replacement.end - replacement.start, ...replacement.lines);
  }
  const custom = lines.join(lineEnding);
  const assetDirectives = apacheSharedAssetsDirectives(assetsPath)
    .split('\n').join(lineEnding);
  const prefix = `|*if !SUB|${lineEnding}|?DOCROOT=${releasePointer}|${lineEnding}|*endif|${lineEnding}`;
  const suffix = `${custom.endsWith(lineEnding) || custom.length === 0 ? '' : lineEnding}` +
    `|*if !SUB|${lineEnding}${assetDirectives}${lineEnding}|*endif|`;
  return `${prefix}${custom}${suffix}`;
}

export function assertSiteSharedAssetsMapping(source, sharedAssets) {
  const expected = apacheSharedAssetsDirectives(sharedAssets);
  let matches = 0;
  for (const match of source.matchAll(/<VirtualHost\b[^>]*>[\s\S]*?<\/VirtualHost>/g)) {
    const block = match[0];
    if (!/^\s*ServerName\s+www\.driftdwells\.com\s*$/m.test(block)) continue;
    if (!/^\s*ServerAlias\s+www\.driftdwells\.com\s+driftdwells\.com\s*$/m.test(block) ||
        block.split(expected).length !== 2 ||
        (block.match(/^\s*(?:Alias|AliasMatch|ScriptAlias)\s+\/assets(?:\/|\s)/gm) || []).length !== 1) {
      throw new Error('Production shared-assets vhost mapping is missing or ambiguous');
    }
    matches++;
  }
  if (matches !== 2) throw new Error(`Expected exactly two shared-assets site vhosts, found ${matches}`);
  return { ok: true, vhostsVerified: matches };
}

/**
 * One-time, opt-in migration. It copies and hashes the entire document root,
 * leaves the source in place, stages sealed read-only copies and journals before the
 * first live config change. The caller must pass explicit host commands and a
 * live HTTP probe; no host paths or services are inferred.
 */
export async function migrateSiteVhost({
  siteConfig, apacheConfig, documentRoot, sharedAssets, releasesRoot, pointer, stateRoot,
  customConfig, directadmin, directadminUser,
  httpd, httpdArgs = [], copyCommand,
  confirmWebrootQuiesced, confirmDirectAdminAccount, confirmSharedAssetsPolicy,
  verifyAssetServing, validateProposedConfig, verifyReload, reloadTimeoutMs = 30_000,
  assets, preflightProbe, probe, run = runCommand
}) {
  assertDirectAdminRegenerationAvailable(run, siteConfig);
  if (confirmWebrootQuiesced !== true) {
    throw new Error('Explicit confirmation that document-root writers are quiesced is required');
  }
  if (confirmDirectAdminAccount !== true) {
    throw new Error('Explicit confirmation of the account-scoped DirectAdmin regeneration target is required');
  }
  if (confirmSharedAssetsPolicy !== true) {
    throw new Error('Explicit confirmation of the append-only, exclusively controlled, Apache-read-only shared-assets store is required');
  }
  if (typeof verifyAssetServing !== 'function') {
    throw new Error('A shared-assets HTTP and vhost verification callback is required');
  }
  if (typeof preflightProbe !== 'function' || typeof probe !== 'function') {
    throw new Error('Baseline and post-migration live HTTP probes are required');
  }
  if (typeof validateProposedConfig !== 'function' || typeof verifyReload !== 'function') {
    throw new Error('Pre-load generated-config validation and effective reload verification are required');
  }
  for (const [command, label] of [[httpd, 'Apache binary'], [directadmin, 'DirectAdmin binary'], [copyCommand, 'Copy command']]) {
    if (typeof command !== 'string' || !path.isAbsolute(command)) throw new Error(`${label} must be an explicit absolute executable path`);
  }
  validateDirectAdminUser(directadminUser);
  if (!Array.isArray(httpdArgs) || httpdArgs.some(arg => typeof arg !== 'string')) {
    throw new Error('Apache command arguments must be a list of strings');
  }
  validatePath(stateRoot, 'State directory');
  const preparedPaths = validateMigrationPaths({
    siteConfig, apacheConfig, documentRoot, sharedAssets, assets, releasesRoot, pointer, stateRoot,
    customConfig, directadminUser
  });
  const initialTree = pathManifest(documentRoot);
  if (!initialTree.length) throw new Error('Refusing to migrate an empty document root');
  assertCopyCapacity(initialTree, releasesRoot, stateRoot);
  verifyApacheConfig(run, httpd, httpdArgs, apacheConfig, siteConfig, 'Baseline Apache syntax test');
  if ((await preflightProbe({ documentRoot, pointer: null }))?.ok !== true) {
    throw new Error('Baseline live HTTP probes did not pass');
  }
  ensureFreeState(stateRoot);
  const unlock = lockState(stateRoot);
  let journal;
  try {
    const originalTree = pathManifest(documentRoot);
    if (!originalTree.length) throw new Error('Refusing to migrate an empty document root');
    validateAssetSource(originalTree, preparedPaths.assets);
    compareManifest(originalTree, initialTree, 'Document root stability since preflight');
    const originalRootStat = fs.statSync(documentRoot);
    const migrationId = crypto.randomUUID();
    const release = path.join(releasesRoot, `vhost-migration-${migrationId}`);
    const backupRoot = path.join(stateRoot, 'backup');
    const backupWebroot = path.join(backupRoot, 'webroot');
    const backupConfig = path.join(backupRoot, 'generated-site.conf');
    const stagingPath = `${release}.staging`;
    if (pathExists(release) || pathExists(stagingPath)) throw new Error('A migration release path already exists');
    fs.mkdirSync(backupRoot, { mode: 0o700 });
    copyArchive(run, copyCommand, documentRoot, backupWebroot);
    copyArchive(run, copyCommand, documentRoot, stagingPath);
    copyArchive(run, copyCommand, siteConfig, backupConfig);
    for (const entry of preparedPaths.persistentConfigs) {
      const current = readRegularFile(entry.path, `Persistent ${entry.protocol} DirectAdmin config`);
      if (hashText(current.data) !== entry.originalHash || current.stat.uid !== entry.uid ||
          current.stat.gid !== entry.gid || (current.stat.mode & 0o7777) !== entry.mode) {
        throw new Error(`Persistent DirectAdmin config changed while preparing migration: ${entry.path}`);
      }
      entry.backupPath = path.join(backupRoot, `persistent-${entry.protocol}.conf`);
      entry.tempPath = `${entry.path}.vhost-migration-${migrationId}.tmp`;
      copyArchive(run, copyCommand, entry.path, entry.backupPath);
      const backup = readRegularFile(entry.backupPath, 'Persistent config backup');
      if (hashText(backup.data) !== entry.originalHash || backup.stat.uid !== entry.uid ||
          backup.stat.gid !== entry.gid || (backup.stat.mode & 0o7777) !== entry.mode) {
        throw new Error(`Persistent DirectAdmin config backup verification failed: ${entry.path}`);
      }
      fs.chmodSync(entry.backupPath, entry.mode & ~0o222);
      syncFile(entry.backupPath);
    }
    if (hashFile(backupConfig) !== preparedPaths.originalConfigHash) {
      throw new Error('Generated Apache config backup integrity check failed');
    }
    const sourceAfterCopy = pathManifest(documentRoot);
    compareManifest(sourceAfterCopy, originalTree, 'Source webroot stability');
    const sourceRootAfterCopy = fs.statSync(documentRoot);
    if (sourceRootAfterCopy.mode !== originalRootStat.mode || sourceRootAfterCopy.uid !== originalRootStat.uid ||
        sourceRootAfterCopy.gid !== originalRootStat.gid) {
      throw new Error('Source document root metadata changed while preparing migration');
    }
    const backupTree = pathManifest(backupWebroot);
    const candidateTree = pathManifest(stagingPath);
    compareManifest(backupTree, originalTree, 'Full webroot backup', false);
    compareManifest(candidateTree, originalTree, 'Complete release snapshot', false);
    for (const [dir, label] of [[backupWebroot, 'Backup'], [stagingPath, 'Release']]) {
      const stat = fs.statSync(dir);
      if (stat.mode !== originalRootStat.mode || stat.uid !== originalRootStat.uid || stat.gid !== originalRootStat.gid) {
        throw new Error(`${label} did not preserve document-root ownership and permissions`);
      }
    }
    sealTree(backupWebroot, originalTree, originalRootStat.mode & 0o7777);
    sealTree(stagingPath, originalTree, originalRootStat.mode & 0o7777);
    const sealedBackupTree = pathManifest(backupWebroot);
    const expectedSealedTree = originalTree.map(item => ({ ...item, mode: item.mode & ~0o222 }));
    compareManifest(sealedBackupTree, expectedSealedTree, 'Read-only backup');
    const sealedCandidateTree = pathManifest(stagingPath);
    compareManifest(sealedCandidateTree, expectedSealedTree, 'Sealed release metadata');
    for (const [dir, label] of [[backupWebroot, 'Backup'], [stagingPath, 'Release']]) {
      const stat = fs.statSync(dir);
      if ((stat.mode & 0o7777) !== (originalRootStat.mode & 0o7777 & ~0o222) ||
          stat.uid !== originalRootStat.uid || stat.gid !== originalRootStat.gid) {
        throw new Error(`${label} root permissions or ownership changed unexpectedly`);
      }
    }
    const backupMode = fs.statSync(backupConfig).mode & 0o7777;
    const configSnapshot = readRegularFile(siteConfig, 'Generated Apache site config');
    const configStat = configSnapshot.stat;
    const configBytes = configSnapshot.data;
    if (hashText(configBytes) !== preparedPaths.originalConfigHash) throw new Error('Site config changed while preparing migration');
    fs.chmodSync(backupConfig, backupMode & ~0o222);
    syncFile(backupConfig);
    const backupManifest = {
      version: 2, migrationId, documentRoot, originalConfigHash: preparedPaths.originalConfigHash,
      sharedAssets, assets: preparedPaths.assets,
      originalRoot: { mode: originalRootStat.mode & 0o7777, uid: originalRootStat.uid, gid: originalRootStat.gid },
      siteConfig: { path: siteConfig, mode: configStat.mode & 0o7777, uid: configStat.uid, gid: configStat.gid },
      persistentConfigs: preparedPaths.persistentConfigs.map(({ path: configPath, protocol, originalHash,
        migratedHash, mode, uid, gid }) => ({
        path: configPath, protocol, originalHash, migratedHash, mode, uid, gid
      })),
      originalWebroot: originalTree,
      backupWebroot: contentManifest(backupTree), release: path.basename(release)
    };
    const backupManifestFile = path.join(backupRoot, 'manifest.json');
    writeDurable(backupManifestFile, `${JSON.stringify(backupManifest, null, 2)}\n`, 0o400);
    const backupManifestHash = hashFile(backupManifestFile);
    fs.chmodSync(backupRoot, 0o500);
    syncDirectory(backupRoot);
    fs.renameSync(stagingPath, release);
    syncDirectory(releasesRoot);
    publishSharedAssets(sharedAssets, [{
      root: release,
      inventory: { files: preparedPaths.assets }
    }]);
    verifySharedAssets(sharedAssets, preparedPaths.assets);
    const configContents = readRegularFile(siteConfig, 'Generated Apache site config').data.toString('utf8');
    const transformed = prepareSiteVhostConfig(configContents, {
      originalRoot: documentRoot, releasePointer: pointer, sharedAssets
    });
    if (hashText(transformed) !== preparedPaths.migratedConfigHash) {
      throw new Error('Generated Apache config changed during migration preparation');
    }
    const probeToken = crypto.randomBytes(32).toString('hex');
    const probePath = path.join(release, `vhost-migration-${migrationId}-probe.txt`);
    for (const entry of preparedPaths.persistentConfigs) {
      if (pathExists(entry.tempPath)) throw new Error(`Persistent config transaction path already exists: ${entry.tempPath}`);
    }
    const generatedBackupStat = readRegularFile(backupConfig, 'Generated config backup').stat;
    journal = {
      version: 2, migrationId, status: 'prepared', createdAt: new Date().toISOString(),
      siteConfig, apacheConfig, documentRoot, sharedAssets, releasesRoot, release, pointer,
      assets: preparedPaths.assets,
      siteConfigUid: configStat.uid, siteConfigGid: configStat.gid,
      probePath, probeTempPath: `${probePath}.tmp`, probeTokenHash: hashText(probeToken),
      sealedRootMode: originalRootStat.mode & 0o7777 & ~0o222,
      probeUid: process.getuid?.() ?? originalRootStat.uid, probeGid: process.getgid?.() ?? originalRootStat.gid,
      backupConfig, backupManifestHash, siteConfigMode: configStat.mode & 0o7777,
      directadmin, directadminUser,
      persistentConfigs: preparedPaths.persistentConfigs.map(({ path: configPath, protocol, backupPath, tempPath,
        originalHash, migratedHash, mode, uid, gid }) => ({
        path: configPath, protocol, backupPath, tempPath, originalHash, migratedHash, mode, uid, gid
      })),
      originalConfigHash: preparedPaths.originalConfigHash, migratedConfigHash: preparedPaths.migratedConfigHash,
      httpd, httpdArgs, copyCommand
    };
    saveJournal(stateRoot, journal);
    writeProbeMarker(journal, probeToken);
    updateJournal(stateRoot, journal, 'probe-created');
    compareManifest(pathManifest(documentRoot), originalTree, 'Document root stability before activation');
    fs.symlinkSync(release, pointer);
    fs.lchownSync(pointer, originalRootStat.uid, originalRootStat.gid);
    const pointerStat = fs.lstatSync(pointer);
    if (pointerStat.uid !== originalRootStat.uid || pointerStat.gid !== originalRootStat.gid) {
      throw new Error('Release pointer ownership does not match the release for SymLinksIfOwnerMatch');
    }
    syncDirectory(path.dirname(pointer));
    updateJournal(stateRoot, journal, 'pointer-created');
    if ((await validateProposedConfig({
      phase: 'migration', expectedConfig: transformed, siteConfig, apacheConfig, pointer
    }))?.ok !== true) {
      throw new Error('Proposed generated Apache configuration was not safely validated before loading');
    }
    updateJournal(stateRoot, journal, 'installing-config');
    for (const entry of journal.persistentConfigs) {
      const prepared = preparedPaths.persistentConfigs.find(item => item.path === entry.path);
      if (!prepared) throw new Error(`Missing prepared DirectAdmin config: ${entry.path}`);
      atomicReplacePersistentConfig(entry, prepared.transformed, entry.migratedHash, { copyCommand, run });
    }
    updateJournal(stateRoot, journal, 'config-installed');
    runDirectAdminRewrite(run, directadmin, directadminUser,
      'Account-scoped DirectAdmin HTTP vhost regeneration');
    verifyPersistentConfigs(journal, 'migrated');
    verifyApacheConfig(run, httpd, httpdArgs, apacheConfig, siteConfig, 'Apache syntax test');
    updateJournal(stateRoot, journal, 'syntax-passed');
    verifyApacheConfig(run, httpd, httpdArgs, apacheConfig, siteConfig, 'Post-regeneration Apache verification');
    verifyGeneratedConfig(Buffer.from(transformed), siteConfig,
      'DirectAdmin regenerated config is outside the expected scoped migration', {
        uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
      });
    updateJournal(stateRoot, journal, 'reload-pending');
    await confirmReload(verifyReload, { phase: 'migration', pointer, release, siteConfig }, reloadTimeoutMs);
    if (!checkPointer(pointer, release)) throw new Error('Release pointer disappeared during reload verification');
    verifyPersistentConfigs(journal, 'migrated');
    verifyGeneratedConfig(Buffer.from(transformed), siteConfig,
      'Generated Apache config changed during reload verification', {
        uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
      });
    const mapping = assertSiteSharedAssetsMapping(
      readRegularFile(siteConfig, 'Regenerated Apache site config').data.toString('utf8'), sharedAssets
    );
    const verificationPath = `/${path.basename(probePath)}`;
    const probeResult = await probe({ documentRoot: release, pointer, verificationPath, verificationToken: probeToken });
    if (probeResult?.ok !== true || probeResult.pointerVerified !== true) {
      throw new Error('Live HTTP probe did not verify both site routes and the new document root');
    }
    const assetResult = await verifyAssetServing({
      sharedAssets, assets: preparedPaths.assets, siteConfig,
      siteConfigSha256: journal.migratedConfigHash, mapping
    });
    if (assetResult?.ok !== true) throw new Error('Shared-assets vhost and HTTP verification did not pass');
    verifyGeneratedConfig(Buffer.from(transformed), siteConfig,
      'Generated Apache config changed during shared-assets verification', {
        uid: journal.siteConfigUid, gid: journal.siteConfigGid, mode: journal.siteConfigMode
      });
    verifySharedAssets(sharedAssets, preparedPaths.assets);
    verifyPersistentConfigs(journal, 'migrated');
    removeProbeMarker(journal);
    compareManifest(pathManifest(release), expectedSealedTree, 'Published release after probe-marker cleanup');
    if ((fs.statSync(release).mode & 0o7777) !== journal.sealedRootMode) {
      throw new Error('Published release permissions changed after probe-marker cleanup');
    }
    updateJournal(stateRoot, journal, 'active');
    return {
      status: 'active', documentRoot: release, originalDocumentRoot: documentRoot,
      sharedAssetsVerified: preparedPaths.assets.length, stateRoot
    };
  } catch (error) {
    if (journal) {
      try {
        await rollbackJournal(stateRoot, journal, run, { verifyReload, reloadTimeoutMs });
        if (error.code === 'RELOAD_VERIFICATION_TIMEOUT') {
          updateJournal(stateRoot, journal, 'recovery-required',
            'Migration reload verification timed out; restored configuration requires independent recovery confirmation.');
        }
      } catch (recoveryError) {
        let journalError = '';
        try {
          updateJournal(stateRoot, journal, 'recovery-required', recoveryError.message);
        } catch (writeError) {
          journalError = `; recording recovery-required status also failed: ${writeError.message}`;
        }
        throw new Error(`Migration failed and automatic recovery is incomplete: ${recoveryError.message}${journalError}; original error: ${error.message}`, { cause: error });
      }
    }
    throw error;
  } finally {
    unlock();
  }
}

/**
 * Restore the original vhost config after a failed or successful migration.
 * The full original document root is retained, never renamed or removed.
 */
export async function recoverSiteVhostMigration({
  stateRoot, run = runCommand, rollback = false, verifyReload, reloadTimeoutMs = 30_000
}) {
  assertDirectAdminRegenerationAvailable(run);
  validatePath(stateRoot, 'State directory');
  if (path.dirname(stateRoot) === stateRoot) throw new Error('State directory cannot be a filesystem root');
  requireRealDirectory(stateRoot, 'State directory');
  if (fs.statSync(stateRoot).mode & 0o077) throw new Error('Migration state directory must remain private');
  const unlock = lockState(stateRoot);
  try {
    const file = path.join(stateRoot, JOURNAL);
    requireRegularFile(file, 'Migration journal');
    const journal = JSON.parse(readRegularFile(file, 'Migration journal').data.toString('utf8'));
    assertDirectAdminRegenerationAvailable(run, journal.siteConfig);
    validateJournal(stateRoot, journal);
    if (journal.status === 'rolled-back' || journal.status === 'recovered') {
      throw new Error(`Migration is already ${journal.status}`);
    }
    if (journal.status === 'active' && !rollback) {
      throw new Error('An active migration requires the explicit rollback operation');
    }
    try {
      return await rollbackJournal(stateRoot, journal, run, { explicit: rollback, verifyReload, reloadTimeoutMs });
    } catch (error) {
      try {
        updateJournal(stateRoot, journal, 'recovery-required', error.message);
      } catch (writeError) {
        throw new Error(`Recovery failed: ${error.message}; recording recovery-required status also failed: ${writeError.message}`, { cause: error });
      }
      throw error;
    }
  } finally {
    unlock();
  }
}

// This is an observed snapshot, not an artifact built from a Git commit.
export function verifyObservedMigrationRollback({ stateRoot, releases, pointer, previous, requireActivePointer = false }) {
  validatePath(stateRoot, 'State directory');
  requireRealDirectory(stateRoot, 'State directory');
  if (fs.statSync(stateRoot).mode & 0o077) throw new Error('Migration state directory must remain private');
  const unlock = lockState(stateRoot);
  try {
    const journal = JSON.parse(readRegularFile(path.join(stateRoot, JOURNAL), 'Migration journal').data.toString('utf8'));
    validateJournal(stateRoot, journal);
    if (journal.status !== 'active' || journal.releasesRoot !== fs.realpathSync(releases) ||
        journal.pointer !== path.resolve(pointer) || journal.release !== previous ||
        hashFile(journal.siteConfig) !== journal.migratedConfigHash ||
        journal.persistentConfigs.some(entry => hashFile(entry.path) !== entry.migratedHash)) {
      throw new Error('Observed rollback does not match the active migration');
    }
    if (requireActivePointer && (!fs.lstatSync(pointer).isSymbolicLink() || fs.realpathSync(pointer) !== previous)) {
      throw new Error('Migration snapshot is not the active pointer');
    }
    const saved = JSON.parse(readRegularFile(path.join(stateRoot, 'backup', 'manifest.json'), 'Backup manifest').data.toString('utf8'));
    const expected = saved.originalWebroot.map(entry => ({ ...entry, mode: entry.mode & ~0o222 }));
    compareManifest(pathManifest(previous), expected, 'Observed migration rollback');
    return { ok: true, provenance: 'observed-production', release: previous,
      inventory: createInventory(previous, 'observed-production', 'observed-production') };
  } finally { unlock(); }
}

export function planSiteVhostMigration(options) {
  const prepared = validateMigrationPaths(options);
  const files = pathManifest(options.documentRoot);
  validateAssetSource(files, prepared.assets);
  const bytes = totalFileBytes(files);
  const recommendedFreeBytes = bytes * 2 + 16 * 1024 * 1024;
  if (!Number.isSafeInteger(recommendedFreeBytes)) throw new Error('Recommended free-space estimate exceeds safe number range');
  return {
    status: 'plan-only',
    siteConfig: options.siteConfig,
    customConfig: options.customConfig,
    directadminUser: options.directadminUser,
    persistentConfigs: prepared.persistentConfigs.map(({ path: configPath, protocol, originalHash, migratedHash }) => ({
      path: configPath, protocol, originalSha256: originalHash, migratedSha256: migratedHash
    })),
    documentRoot: options.documentRoot,
    sharedAssets: options.sharedAssets,
    sharedAssetsVerified: prepared.assets.length,
    releasePointer: options.pointer,
    files: files.filter(entry => entry.type === 'file').length,
    directories: files.filter(entry => entry.type === 'directory').length,
    bytes,
    recommendedFreeBytes,
    originalConfigSha256: prepared.originalConfigHash,
    migratedConfigSha256: prepared.migratedConfigHash,
    changes: [
      'Back up the effective per-domain cust_httpd source and generated Apache config separately',
      'Write only conditional per-domain cust_httpd customizations',
      'Regenerate only the selected DirectAdmin account using taskq action=rewrite&value=httpd',
      'Verify the regenerated main/test vhosts and every unrelated generated directive',
      'Main HTTP ScriptAlias /cgi-bin/ follows DOCROOT to the release root; main HTTPS keeps its template-fixed original-root CGI alias',
      'Copy the complete document root to a sealed release and backup',
      'Create the explicit release pointer'
    ]
  };
}
