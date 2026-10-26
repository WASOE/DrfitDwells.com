#!/usr/bin/env node
'use strict';

/**
 * Point a release's uploads path at the shared store.
 *
 * Never deletes files, never overwrites an existing file, and never replaces
 * the shared store. A real uploads directory is renamed aside, then replaced
 * with a symlink. Files that exist only in that directory are copied into the
 * store with COPYFILE_EXCL first.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SHARED = '/home/illoc/shared/driftdwells-uploads';
const DEFAULT_LEGACY = '/home/illoc/apps/driftdwells-booking-portal/uploads';

function fail(message) {
  const error = new Error(message);
  error.code = 'UPLOADS_LINK_REFUSED';
  throw error;
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertRealDirectory(target, label) {
  const st = lstatOrNull(target);
  if (!st || !st.isDirectory() || st.isSymbolicLink()) {
    fail(`${label} must be a real directory: ${target}`);
  }
  return fs.realpathSync(target);
}

function ownerOf(target) {
  const st = fs.statSync(target);
  return { uid: st.uid, gid: st.gid };
}

function copyMissingFiles(fromDir, toDir, report) {
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(fromDir, rel);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) {
      report.skippedSymlinks.push(rel || '.');
      continue;
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs)) stack.push(path.join(rel, name));
      continue;
    }
    if (!st.isFile()) continue;
    const dest = path.join(toDir, rel);
    if (lstatOrNull(dest)) {
      report.alreadyPresent += 1;
      continue;
    }
    if (report.dryRun) {
      report.copied.push(rel);
      continue;
    }
    const parent = path.dirname(dest);
    fs.mkdirSync(parent, { recursive: true });
    let dir = parent;
    const insideStore = candidate => candidate === toDir || candidate.startsWith(`${toDir}${path.sep}`);
    while (insideStore(dir)) {
      const dirStat = fs.statSync(dir);
      if (dirStat.uid === report.uid && dirStat.gid === report.gid) break;
      fs.chownSync(dir, report.uid, report.gid);
      const next = path.dirname(dir);
      if (next === dir) break;
      dir = next;
    }
    fs.copyFileSync(abs, dest, fs.constants.COPYFILE_EXCL);
    fs.chownSync(dest, report.uid, report.gid);
    fs.chmodSync(dest, st.mode & 0o777);
    report.copied.push(rel);
  }
}

/**
 * Make sharedPath a real directory. If the legacy app path is the real
 * directory, rename it into place and leave a symlink behind so existing
 * backup paths and older release links keep resolving.
 */
function ensureSharedStore({ sharedPath, legacyPath, dryRun = false }) {
  const sharedStat = lstatOrNull(sharedPath);
  const legacyStat = lstatOrNull(legacyPath);
  if (sharedStat && !sharedStat.isSymbolicLink() && sharedStat.isDirectory()) {
    if (legacyStat && legacyStat.isSymbolicLink() && fs.realpathSync(legacyPath) === fs.realpathSync(sharedPath)) {
      return { action: 'shared-ready', sharedPath: fs.realpathSync(sharedPath) };
    }
    if (!legacyStat) {
      if (!dryRun) fs.symlinkSync(sharedPath, legacyPath);
      return { action: dryRun ? 'would-link-legacy' : 'linked-legacy', sharedPath: fs.realpathSync(sharedPath) };
    }
    if (legacyStat.isSymbolicLink()) {
      fail(`Legacy uploads symlink does not point at the shared store: ${legacyPath}`);
    }
    fail(`Both ${sharedPath} and ${legacyPath} are real directories; refusing to merge them`);
  }
  if (sharedStat && sharedStat.isSymbolicLink()) {
    fail(`Shared uploads path must not itself be a symlink: ${sharedPath}`);
  }
  if (!legacyStat || !legacyStat.isDirectory() || legacyStat.isSymbolicLink()) {
    fail(`Cannot create shared store; legacy uploads directory is missing: ${legacyPath}`);
  }
  if (dryRun) {
    return { action: 'would-move-legacy-to-shared', sharedPath, legacyPath };
  }
  fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
  const parent = fs.statSync(path.dirname(sharedPath));
  fs.chownSync(path.dirname(sharedPath), legacyStat.uid, legacyStat.gid);
  fs.chmodSync(path.dirname(sharedPath), parent.mode & 0o777 || 0o755);
  fs.renameSync(legacyPath, sharedPath);
  try {
    fs.symlinkSync(sharedPath, legacyPath);
  } catch (error) {
    fs.renameSync(sharedPath, legacyPath);
    throw error;
  }
  return { action: 'moved-legacy-to-shared', sharedPath: fs.realpathSync(sharedPath) };
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Ensure releaseRoot/uploads is a symlink to the shared store.
 * Returns a report. Throws instead of deleting or overwriting.
 */
function ensureReleaseUploadsLink(releaseRoot, sharedPath, { dryRun = false } = {}) {
  const sharedReal = assertRealDirectory(sharedPath, 'Shared uploads');
  const linkPath = path.join(releaseRoot, 'uploads');
  const st = lstatOrNull(linkPath);
  const report = {
    releaseRoot,
    action: 'unchanged',
    copied: [],
    alreadyPresent: 0,
    skippedSymlinks: [],
    preservedAs: null,
    dryRun,
    uid: ownerOf(sharedReal).uid,
    gid: ownerOf(sharedReal).gid
  };

  if (!st) {
    report.action = dryRun ? 'would-create-symlink' : 'created-symlink';
    if (!dryRun) fs.symlinkSync(sharedPath, linkPath);
    return report;
  }

  if (st.isSymbolicLink()) {
    let current;
    try {
      current = fs.realpathSync(linkPath);
    } catch (error) {
      fail(`Release uploads symlink is broken (${linkPath}): ${error.message}`);
    }
    if (current !== sharedReal) {
      report.action = 'foreign-symlink';
      report.foreignTarget = current;
      return report;
    }
    report.action = 'already-linked';
    return report;
  }

  if (!st.isDirectory()) fail(`Release uploads path is not a directory or symlink: ${linkPath}`);

  copyMissingFiles(linkPath, sharedReal, report);
  const preserved = path.join(releaseRoot, `uploads.preserved-${stamp()}`);
  if (lstatOrNull(preserved)) fail(`Refusing to rename; ${preserved} already exists`);
  report.preservedAs = preserved;
  report.action = dryRun ? 'would-preserve-and-link' : 'preserved-and-linked';
  if (!dryRun) {
    fs.renameSync(linkPath, preserved);
    try {
      fs.symlinkSync(sharedPath, linkPath);
    } catch (error) {
      fs.renameSync(preserved, linkPath);
      throw error;
    }
  }
  return report;
}

function releasesWithServer(releasesDir) {
  return fs.readdirSync(releasesDir)
    .map(name => path.join(releasesDir, name))
    .filter(root => fs.existsSync(path.join(root, 'server', 'server.js')))
    .sort();
}

function parseArgs(argv) {
  const args = { dryRun: true, sharedPath: DEFAULT_SHARED, legacyPath: DEFAULT_LEGACY, releasesDir: '/home/illoc/releases', importFrom: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.dryRun = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--shared') args.sharedPath = argv[++i];
    else if (arg === '--legacy') args.legacyPath = argv[++i];
    else if (arg === '--releases') args.releasesDir = argv[++i];
    else if (arg === '--import-missing') args.importFrom.push(argv[++i]);
    else if (arg === '--root') args.onlyRoot = argv[++i];
    else fail(`Unknown argument: ${arg}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = ensureSharedStore({
    sharedPath: args.sharedPath,
    legacyPath: args.legacyPath,
    dryRun: args.dryRun
  });
  const reports = [store];
  const effectiveShared = store.action === 'would-move-legacy-to-shared'
    ? args.legacyPath
    : (store.sharedPath || args.sharedPath);
  if (fs.existsSync(effectiveShared)) {
    const { uid, gid } = ownerOf(effectiveShared);
    for (const extra of args.importFrom) {
      const report = { copied: [], alreadyPresent: 0, skippedSymlinks: [], dryRun: args.dryRun, uid, gid };
      copyMissingFiles(extra, effectiveShared, report);
      reports.push({
        action: args.dryRun ? 'would-import-missing' : 'imported-missing',
        from: extra,
        copied: report.copied,
        alreadyPresent: report.alreadyPresent
      });
    }
  }
  const roots = args.onlyRoot ? [args.onlyRoot] : (args.releasesDir && fs.existsSync(args.releasesDir) ? releasesWithServer(args.releasesDir) : []);
  const ranked = roots
    .map(root => ({ root, link: lstatOrNull(path.join(root, 'uploads')) }))
    .sort((a, b) => Number(Boolean(a.link && a.link.isSymbolicLink())) - Number(Boolean(b.link && b.link.isSymbolicLink())));
  for (const item of ranked) {
    let report = ensureReleaseUploadsLink(item.root, effectiveShared, { dryRun: args.dryRun });
    if (report.action === 'foreign-symlink' && !args.dryRun) {
      report = ensureReleaseUploadsLink(item.root, effectiveShared, { dryRun: false });
      if (report.action === 'foreign-symlink') {
        fail(`Release uploads symlink points at ${report.foreignTarget}, not the shared store: ${item.root}`);
      }
    }
    reports.push(report);
  }
  const summary = {
    dryRun: args.dryRun,
    shared: store,
    releases: reports.filter(item => item.releaseRoot).map(item => ({
      release: path.basename(item.releaseRoot),
      action: item.action,
      copied: item.copied ? item.copied.length : 0,
      preservedAs: item.preservedAs ? path.basename(item.preservedAs) : null,
      foreignTarget: item.foreignTarget || null
    })),
    imported: reports.filter(item => String(item.action).includes('import'))
  };
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = {
  ensureSharedStore,
  ensureReleaseUploadsLink,
  copyMissingFiles,
  DEFAULT_SHARED
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ status: 'blocked', reason: error.message }));
    process.exitCode = 1;
  }
}
