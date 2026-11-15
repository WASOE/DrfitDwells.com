#!/usr/bin/env node
/**
 * Limited Drift & Dwells wishlist release. No Apache, DirectAdmin, PM2, root
 * index, service worker, .htaccess or existing shared assets are modified.
 *
 * Production CLI independently downloads/verifies the exact GitHub artifact.
 * Two HTML pages are replaced with same-directory atomic renames. Each
 * original page is backed up with GNU cp -a; journaled rollback is available.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadProductionArtifact } from './production-artifact-verify.mjs';
import { verifyInventory } from './frontend-inventory.mjs';

const COMMIT = '874ed57e19e78d3d6b4d05c13c7d1805bc1da708';
const RUN_ID = '43695815193';
const API_COMMIT = '01d64f8f4b1f6503c92f3e849a4aa04e99476687';
const PROD_ROOT = '/home/illoc/domains/driftdwells.com/public_html';
const ROUTES = ['wishlist/index.html', 'bg/wishlist/index.html'];
const JOURNAL = 'wishlist-publish-journal.json';
const HASHED_ASSET = /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp|avif|gif|json)$/;

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('Not a regular file: ' + file);
    const buffer = Buffer.alloc(65536);
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function exists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function directory(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Expected a real directory: ' + file);
  return stat;
}
function regularOrAbsent(file) {
  const stat = exists(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) {
    throw new Error('Refusing special, linked or symlink file: ' + file);
  }
  return stat;
}
function validateRelative(relative) {
  if (typeof relative !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(relative) ||
      relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid release file path: ' + relative);
  }
}
function safePath(root, relative) {
  validateRelative(relative);
  directory(root);
  const parts = relative.split('/');
  let current = root;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    const stat = exists(current);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error('Unsafe destination ancestor: ' + current);
    }
  }
  return path.join(root, relative);
}
function syncDir(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function syncFile(file) {
  const fd = fs.openSync(file, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function durableJournal(state, data) {
  const target = path.join(state, JOURNAL);
  const temp = path.join(state, '.journal-' + crypto.randomUUID());
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  syncFile(temp);
  fs.renameSync(temp, target);
  syncDir(state);
}
function cpPreserve(source, destination) {
  const result = spawnSync('/usr/bin/cp', ['-a', '--', source, destination], { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Metadata-preserving backup failed: ' + (result.stderr || result.error));
}
function sameHashOrMissing(file, wanted) {
  const stat = regularOrAbsent(file);
  return stat ? sha256(file) === wanted : false;
}
function makeParents(root, relative) {
  const pieces = relative.split('/').slice(0, -1);
  let current = root;
  for (const part of pieces) {
    current = path.join(current, part);
    if (!exists(current)) {
      fs.mkdirSync(current, { mode: 0o755 });
      syncDir(path.dirname(current));
    }
    directory(current);
  }
}
function atomicRouteCopy(source, dest, owner) {
  const tmp = path.join(path.dirname(dest), '.wishlist-' + crypto.randomUUID() + '.tmp');
  try {
    fs.copyFileSync(source, tmp, fs.constants.COPYFILE_EXCL);
    fs.chownSync(tmp, owner.uid, owner.gid);
    fs.chmodSync(tmp, owner.mode);
    syncFile(tmp);
    fs.renameSync(tmp, dest);
    syncDir(path.dirname(dest));
  } finally { if (exists(tmp)) fs.unlinkSync(tmp); }
}
function immutableCopy(source, dest, sha) {
  const parent = path.dirname(dest);
  const tmp = path.join(parent, '.wishlist-' + crypto.randomUUID() + '.tmp');
  const owner = fs.statSync(parent);
  try {
    fs.copyFileSync(source, tmp, fs.constants.COPYFILE_EXCL);
    fs.chownSync(tmp, owner.uid, owner.gid);
    fs.chmodSync(tmp, 0o644);
    syncFile(tmp);
    if (sha256(tmp) !== sha) throw new Error('Staged immutable asset corrupt: ' + dest);
    fs.linkSync(tmp, dest);
    syncDir(parent);
  } finally { if (exists(tmp)) fs.unlinkSync(tmp); }
}
function assertRoot(webroot) {
  directory(webroot);
  const htaccess = fs.readFileSync(path.join(webroot, '.htaccess'), 'utf8');
  if (!htaccess.includes('RewriteCond %{REQUEST_FILENAME} !-d') ||
      !htaccess.includes('RewriteCond %{REQUEST_FILENAME} !-f')) {
    throw new Error('Current .htaccess must preserve actual route directories and files');
  }
  regularOrAbsent(path.join(webroot, 'index.html'));
  regularOrAbsent(path.join(webroot, 'sw.js'));
}
function expectedRouteHtml(source, relative, inventory) {
  const page = path.join(source, relative);
  const sourceStat = regularOrAbsent(page);
  if (!sourceStat) throw new Error('Missing verified wishlist page: ' + relative);
  const html = fs.readFileSync(page, 'utf8');
  const route = '/' + relative.slice(0, -'/index.html'.length);
  if (!html.includes('wishlist-hero') || !html.includes('data-prerender-route="' + route + '"') ||
      !html.includes('<html')) throw new Error('Wrong localized prerender: ' + relative);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="(\/assets\/[^"]+\.js)"/g)].map(x => x[1].slice(1));
  if (scripts.length !== 1 || !inventory.files.some(x => x.path === scripts[0])) {
    throw new Error('Missing verified wishlist entry script: ' + relative);
  }
  return { relative, sha256: sha256(page), entry: scripts[0] };
}
export function inspectWishlistRelease({ source, inventory, webroot }) {
  if (inventory?.commit !== COMMIT || inventory.configuration !== 'production') {
    throw new Error('Only the pinned production wishlist artifact is allowed');
  }
  verifyInventory(source, inventory);
  assertRoot(webroot);
  const unchanged = Object.fromEntries(['index.html', '.htaccess', 'sw.js'].map(p => {
    const file = path.join(webroot, p);
    return [p, regularOrAbsent(file) ? sha256(file) : null];
  }));
  const assets = [];
  const collisions = [];
  for (const item of inventory.files.filter(x => x.path.startsWith('assets/'))) {
    const target = safePath(webroot, item.path);
    const current = regularOrAbsent(target);
    if (current) {
      if (sha256(target) !== item.sha256) collisions.push(item.path);
    } else if (!HASHED_ASSET.test(item.path)) {
      throw new Error('Refusing to introduce an unversioned shared asset: ' + item.path);
    } else assets.push({ path: item.path, sha256: item.sha256, size: item.size });
  }
  if (collisions.length) throw new Error('Shared asset collisions: ' + collisions.slice(0, 10).join(', '));
  const pages = ROUTES.map(relative => {
    const entry = expectedRouteHtml(source, relative, inventory);
    const target = safePath(webroot, relative);
    const current = regularOrAbsent(target);
    return { ...entry, prior: current ? sha256(target) : null,
      owner: current ? { uid: current.uid, gid: current.gid, mode: current.mode & 0o777 } : null };
  });
  return { commit: COMMIT, runId: RUN_ID, webroot, pages, assets, unchanged };
}
function assertUnchanged(webroot, unchanged) {
  for (const [relative, expected] of Object.entries(unchanged)) {
    const file = path.join(webroot, relative);
    const current = regularOrAbsent(file);
    if ((current ? sha256(file) : null) !== expected) {
      throw new Error('Unrelated live file changed: ' + relative);
    }
  }
}
function recoverFromJournal(state, journal) {
  const webroot = journal.webroot;
  assertRoot(webroot);
  assertUnchanged(webroot, journal.unchanged);
  for (const page of journal.pages.slice().reverse()) {
    const target = safePath(webroot, page.relative);
    const current = regularOrAbsent(target);
    const actual = current ? sha256(target) : null;
    if (actual !== page.sha256 && actual !== page.prior) {
      throw new Error('Route changed outside this publisher: ' + page.relative);
    }
    if (actual === page.prior) continue;
    if (page.prior === null) {
      fs.unlinkSync(target);
      syncDir(path.dirname(target));
    } else {
      const backup = path.join(state, 'backup-' + page.relative.replaceAll('/', '_'));
      if (!regularOrAbsent(backup) || sha256(backup) !== page.prior) throw new Error('Backup invalid: ' + page.relative);
      const temp = path.join(path.dirname(target), '.wishlist-restore-' + crypto.randomUUID());
      try {
        cpPreserve(backup, temp);
        if (sha256(temp) !== page.prior) throw new Error('Backup copy failed integrity verification');
        fs.renameSync(temp, target);
        syncDir(path.dirname(target));
      } finally { if (exists(temp)) fs.unlinkSync(temp); }
    }
  }
  assertUnchanged(webroot, journal.unchanged);
  durableJournal(state, { ...journal, status: 'rolled-back' });
  return { status: 'rolled-back', webroot };
}
export function rollbackWishlistRelease(state) {
  directory(state);
  const journalFile = path.join(state, JOURNAL);
  if (!regularOrAbsent(journalFile)) throw new Error('No release journal; nothing to roll back');
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  if (journal.commit !== COMMIT || journal.runId !== RUN_ID ||
      !Array.isArray(journal.pages) ||
      journal.pages.map(x => x.relative).join('|') !== ROUTES.join('|')) {
    throw new Error('Wrong or incomplete wishlist journal');
  }
  if (journal.status === 'rolled-back') return { status: 'rolled-back', alreadyRestored: true };
  try { return recoverFromJournal(state, journal); }
  catch (error) {
    durableJournal(state, { ...journal, status: 'recovery-required', error: error.message });
    throw error;
  }
}
export async function publishWishlistRelease({ source, inventory, webroot, state, smoke }) {
  const plan = inspectWishlistRelease({ source, inventory, webroot });
  if (exists(state)) throw new Error('State already exists: recover or choose a new state');
  if (state === webroot || state.startsWith(webroot + path.sep)) throw new Error('State must be outside the live document root');
  directory(path.dirname(state));
  fs.mkdirSync(state, { mode: 0o700 });
  directory(state);
  for (const page of plan.pages) {
    if (page.prior !== null) {
      const backup = path.join(state, 'backup-' + page.relative.replaceAll('/', '_'));
      cpPreserve(path.join(webroot, page.relative), backup);
      if (sha256(backup) !== page.prior) throw new Error('Original route backup mismatch: ' + page.relative);
      syncFile(backup);
    }
  }
  const journal = { ...plan, status: 'prepared' };
  durableJournal(state, journal);
  try {
    assertUnchanged(webroot, plan.unchanged);
    for (const asset of plan.assets) {
      const target = safePath(webroot, asset.path);
      makeParents(webroot, asset.path);
      const sourceFile = path.join(source, asset.path);
      if (!exists(target)) immutableCopy(sourceFile, target, asset.sha256);
      if (!sameHashOrMissing(target, asset.sha256)) throw new Error('Published asset hash mismatch: ' + asset.path);
    }
    durableJournal(state, { ...journal, status: 'assets-staged' });
    for (const page of plan.pages) {
      const target = safePath(webroot, page.relative);
      const current = regularOrAbsent(target);
      if ((current ? sha256(target) : null) !== page.prior) throw new Error('Page changed before switch: ' + page.relative);
      makeParents(webroot, page.relative);
      const parent = fs.statSync(path.dirname(target));
      const owner = page.owner || { uid: parent.uid, gid: parent.gid, mode: 0o644 };
      atomicRouteCopy(path.join(source, page.relative), target, owner);
      if (sha256(target) !== page.sha256) throw new Error('Published HTML mismatch: ' + page.relative);
    }
    durableJournal(state, { ...journal, status: 'routes-switched' });
    assertUnchanged(webroot, plan.unchanged);
    if (typeof smoke !== 'function' || (await smoke(plan)) !== true) throw new Error('Origin smoke test did not pass');
    for (const page of plan.pages) {
      if (sha256(path.join(webroot, page.relative)) !== page.sha256) throw new Error('Route changed during smoke');
    }
    assertUnchanged(webroot, plan.unchanged);
    durableJournal(state, { ...journal, status: 'active' });
    return { status: 'active', assetsAdded: plan.assets.length, pages: ROUTES, state };
  } catch (error) {
    try { rollbackWishlistRelease(state); }
    catch (recoveryError) { throw new Error('Deployment failed and recovery is incomplete: ' + recoveryError.message + '; original: ' + error.message); }
    throw new Error('Deployment rolled back: ' + error.message);
  }
}
function originGet(ip, relative) {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: ip, port: 443, servername: 'driftdwells.com',
      path: relative + (relative.includes('?') ? '&' : '?') + 'wishlistcheck=' + crypto.randomBytes(8).toString('hex'),
      headers: { Host: 'driftdwells.com', 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
      timeout: 12000
    }, res => {
      if (res.statusCode !== 200 || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
        res.resume();
        reject(new Error('Origin HTTP ' + res.statusCode + ' for ' + relative));
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', part => {
        size += part.length;
        if (size > 8 * 1024 * 1024) res.destroy(new Error('Origin response exceeded limit'));
        else chunks.push(part);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Origin timeout: ' + relative)));
  });
}
async function liveSmoke(plan) {
  const ip = process.env.DRIFT_ORIGIN_IP;
  if (!net.isIP(ip || '')) throw new Error('DRIFT_ORIGIN_IP is required for origin verification');
  for (const page of plan.pages) {
    const relative = '/' + page.relative.replace(/index\.html$/, '');
    const html = await originGet(ip, relative);
    if (!html.includes('wishlist-hero') || !html.includes('data-prerender-route="/' + page.relative.replace('/index.html', '') + '"') ||
        !html.includes('/' + page.entry)) throw new Error('Origin route validation failed: ' + relative);
    await originGet(ip, '/' + page.entry);
  }
  for (const route of ['/', '/search', '/checkout']) {
    const html = await originGet(ip, route);
    if (!html.includes('<html')) throw new Error('Existing route unhealthy: ' + route);
  }
  const health = JSON.parse(await originGet(ip, '/api/health'));
  if (health.status !== 'OK' || health.database !== 'connected' || health.applicationRelease !== API_COMMIT) {
    throw new Error('API release/health contract changed');
  }
  return true;
}
async function cli() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'rollback') {
    if (args.length !== 1) throw new Error('Usage: rollback <state-dir>');
    return rollbackWishlistRelease(args[0]);
  }
  if (!['plan', 'apply'].includes(action) || args.length !== 1) {
    throw new Error('Usage: plan|apply <new-state-dir> | rollback <existing-state-dir>');
  }
  const state = args[0];
  if (!path.isAbsolute(state) || path.normalize(state) !== state ||
      state.startsWith(PROD_ROOT + path.sep) || state === PROD_ROOT) throw new Error('Unsafe state directory');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-wishlist-verified-'));
  try {
    const source = path.join(tmp, 'artifact');
    const verified = downloadProductionArtifact({
      runId: RUN_ID, commit: COMMIT, destination: source,
      key: process.env.VITE_STRIPE_PUBLISHABLE_KEY
    });
    if (verified?.ok !== true) throw new Error('Independent GitHub verification failed');
    if (action === 'plan') return inspectWishlistRelease({ source, inventory: verified.inventory, webroot: PROD_ROOT });
    if (process.env.WISHLIST_ROUTE_ONLY_AUTHORIZE !== 'YES') {
      throw new Error('Explicit WISHLIST_ROUTE_ONLY_AUTHORIZE=YES is required');
    }
    return await publishWishlistRelease({
      source, inventory: verified.inventory, webroot: PROD_ROOT,
      state, smoke: liveSmoke
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error('[wishlist-route-only] ' + error.message); process.exitCode = 1; });
}
