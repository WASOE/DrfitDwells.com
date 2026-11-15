import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function hash(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error(`Not a regular asset: ${file}`);
    return { sha256: crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex'), size: stat.size, mode: stat.mode };
  } finally { fs.closeSync(fd); }
}

function directory(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || fs.realpathSync(dir) !== dir) {
    throw new Error(`Asset directory must be real and have no symlink components: ${dir}`);
  }
  if (stat.mode & 0o022) throw new Error(`Asset directory must not be group- or world-writable: ${dir}`);
}

export function apacheSharedAssetsDirectives(sharedAssets) {
  if (!path.isAbsolute(sharedAssets) || path.normalize(sharedAssets) !== sharedAssets ||
      !/^\/[A-Za-z0-9._/-]+$/.test(sharedAssets) || sharedAssets === '/') {
    throw new Error('Invalid shared assets path for Apache');
  }
  return `Alias /assets/ "${sharedAssets}/"
<Directory "${sharedAssets}">
  Options -Indexes -ExecCGI -FollowSymLinks
  AllowOverride None
  Require all granted
</Directory>
<LocationMatch "^/assets/(?:.*/)?\\\\.">
  Require all denied
</LocationMatch>`;
}

function assetEntries(inventories) {
  const entries = new Map();
  for (const { root, inventory } of inventories) {
    for (const file of inventory.files) {
      if (!file.path.startsWith('assets/')) continue;
      const parts = file.path.split('/');
      if (parts.length < 2 || parts.slice(1).some(part => !/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(part))) {
        throw new Error(`Unsafe asset path: ${file.path}`);
      }
      const prior = entries.get(file.path);
      if (prior && (prior.sha256 !== file.sha256 || prior.size !== file.size)) {
        throw new Error(`Asset hash conflict: ${file.path}`);
      }
      entries.set(file.path, { ...file, source: path.join(root, ...parts) });
    }
  }
  return [...entries.values()];
}

function targetFor(shared, name, create) {
  const parts = name.split('/').slice(1);
  let dir = shared;
  for (const part of parts.slice(0, -1)) {
    dir = path.join(dir, part);
    if (create) {
      try { fs.mkdirSync(dir, { mode: 0o755 }); syncDir(path.dirname(dir)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    directory(dir);
  }
  return path.join(dir, parts.at(-1));
}

function syncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function check(target, file) {
  let actual;
  try { actual = hash(target); }
  catch (error) { throw new Error(`Invalid shared asset ${file.path}: ${error.message}`); }
  if (actual.sha256 !== file.sha256 || actual.size !== file.size) {
    throw new Error(`Asset hash conflict: ${file.path}`);
  }
  if (actual.mode & 0o222) throw new Error(`Shared asset is writable: ${file.path}`);
}

/**
 * Append only: never replace an existing URL, including assets of releases
 * older than the immediate rollback. Deployment must exclusively control the
 * store and all its ancestors; Apache gets read-only access.
 */
export function publishSharedAssets(sharedAssets, inventories) {
  const shared = path.resolve(sharedAssets);
  directory(shared);
  const entries = assetEntries(inventories);
  // Detect existing conflicts before writing any new asset.
  for (const file of entries) {
    const target = targetFor(shared, file.path, true);
    try { fs.lstatSync(target); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    check(target, file);
  }
  for (const file of entries) {
    const target = targetFor(shared, file.path, true);
    const staging = fs.mkdtempSync(path.join(shared, '.publisher-'));
    fs.chmodSync(staging, 0o700);
    const temp = path.join(staging, 'asset');
    try {
      const source = fs.openSync(file.source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        if (!fs.fstatSync(source).isFile()) throw new Error(`Not a regular asset: ${file.path}`);
        const fd = fs.openSync(temp, 'wx', 0o600);
        try {
          fs.writeFileSync(fd, fs.readFileSync(source));
          fs.fchmodSync(fd, 0o444);
          fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
      } finally { fs.closeSync(source); }
      check(temp, file);
      try {
        fs.linkSync(temp, target);
        syncDir(path.dirname(target));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      check(target, file);
    } finally {
      try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fs.rmdirSync(staging);
    }
  }
  return entries.map(({ source, ...file }) => file);
}

export function verifySharedAssets(sharedAssets, entries) {
  const shared = path.resolve(sharedAssets);
  directory(shared);
  for (const file of entries) check(targetFor(shared, file.path, false), file);
}
