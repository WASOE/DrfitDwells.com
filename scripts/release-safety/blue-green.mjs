import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyInventory } from './frontend-inventory.mjs';
import { publishSharedAssets, verifySharedAssets } from './shared-assets.mjs';

function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function durableJson(file, value) {
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  syncDirectory(path.dirname(file));
}

function requireRelease(releases, release) {
  const root = fs.realpathSync(releases);
  const resolved = fs.realpathSync(release);
  if (path.dirname(resolved) !== root || !fs.lstatSync(release).isDirectory()) {
    throw new Error('Release must be a real direct child of the release directory');
  }
  return resolved;
}

function readPointer(pointer, releases) {
  if (!fs.lstatSync(pointer).isSymbolicLink()) throw new Error('Active pointer must be a symbolic link');
  return requireRelease(releases, path.resolve(path.dirname(pointer), fs.readlinkSync(pointer)));
}

function switchPointer(pointer, target) {
  const tmp = `${pointer}.${crypto.randomUUID()}.tmp`;
  fs.symlinkSync(target, tmp);
  try {
    fs.renameSync(tmp, pointer);
    syncDirectory(path.dirname(pointer));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function lock(state) {
  const dir = path.join(state, 'activation.lock');
  fs.mkdirSync(dir);
  durableJson(path.join(dir, 'owner.json'), { host: os.hostname(), pid: process.pid });
  return () => {
    fs.unlinkSync(path.join(dir, 'owner.json'));
    fs.rmdirSync(dir);
    syncDirectory(state);
  };
}

function journalPath(state) { return path.join(state, 'pending.json'); }

function removeJournal(state) {
  fs.unlinkSync(journalPath(state));
  syncDirectory(state);
}

/**
 * Copy to an unpublished directory first. The caller must validate artifact
 * provenance independently; an inventory alone is not an authenticity proof.
 */
export async function stageRelease({ source, releases, state, inventory, verifyProvenance }) {
  if (typeof verifyProvenance !== 'function') throw new Error('Artifact provenance verification is required');
  if (inventory?.configuration !== 'production') throw new Error('A production artifact is required');
  const unlock = lock(state);
  try {
    if (fs.existsSync(journalPath(state))) throw new Error('Pending activation requires recovery');
    verifyInventory(source, inventory);
    if ((await verifyProvenance({ source, inventory }))?.ok !== true) throw new Error('Artifact provenance did not pass');
    const root = fs.realpathSync(releases);
    const destination = path.join(root, inventory.commit);
    const staging = path.join(root, `.staging-${crypto.randomUUID()}`);
    if (fs.existsSync(destination)) throw new Error('Release already exists');
    fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
    verifyInventory(staging, inventory);
    function seal(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) seal(file);
        else {
          const fd = fs.openSync(file, 'r');
          try {
            fs.fchmodSync(fd, 0o444);
            fs.fsyncSync(fd);
          } finally { fs.closeSync(fd); }
        }
      }
      fs.chmodSync(dir, 0o555);
      syncDirectory(dir);
    }
    seal(staging);
    if (fs.existsSync(destination)) throw new Error('Release appeared during staging');
    fs.renameSync(staging, destination);
    syncDirectory(root);
    return destination;
  } finally {
    unlock();
  }
}

/**
 * The caller must supply deployment-specific, independently verified preflight
 * and live smoke checks. Apache must map /assets/ to a dedicated, append-only
 * sharedAssets directory (see apacheSharedAssetsDirectives). Before changing
 * the pointer, verifyAssetServing must fetch EVERY supplied asset through the
 * real site, check status, size and SHA-256 without redirects or caches, and
 * independently verify the actual vhost mapping even when bytes happen to
 * match the current release. Return {ok:true} only if all checks pass. The
 * store and its ancestors
 * must be protected from all writers except this locked publisher; no asset
 * deletion/GC is allowed while any browser may still reference it.
 * This module does not install or validate the deployment's Apache config.
 */
export async function activateRelease({ releases, pointer, state, candidate, inventory, previousInventory, sharedAssets, verifyAssetServing, preflight, smoke, rollbackSmoke }) {
  if (typeof preflight !== 'function' || typeof smoke !== 'function' || typeof rollbackSmoke !== 'function' ||
      typeof verifyAssetServing !== 'function' || typeof sharedAssets !== 'string') {
    throw new Error('Shared assets, asset serving verification, preflight, smoke and rollback smoke checks are required');
  }
  const release = requireRelease(releases, candidate);
  verifyInventory(release, inventory);
  if (inventory.configuration !== 'production') throw new Error('A production artifact is required');
  const unlock = lock(state);
  try {
    if (fs.existsSync(journalPath(state))) throw new Error('Pending activation requires recovery');
    const previous = readPointer(pointer, releases);
    if (previous === release) throw new Error('Release is already active');
    verifyInventory(previous, previousInventory);
    if (previousInventory.configuration !== 'production') throw new Error('A production rollback artifact is required');
    const shared = fs.realpathSync(sharedAssets);
    const overlaps = other => shared === other || shared.startsWith(`${other}${path.sep}`) ||
      other.startsWith(`${shared}${path.sep}`);
    if (shared !== path.resolve(sharedAssets) || overlaps(fs.realpathSync(releases)) ||
        overlaps(fs.realpathSync(state)) || overlaps(path.resolve(pointer))) {
      throw new Error('Shared assets must be a real, separate directory');
    }
    const assets = publishSharedAssets(shared, [
      { root: previous, inventory: previousInventory },
      { root: release, inventory }
    ]);
    const ready = await preflight({ candidate: release, previous });
    if (ready?.ok !== true) throw new Error('Preflight did not pass');
    if ((await verifyAssetServing({ sharedAssets: shared, assets }))?.ok !== true) {
      throw new Error('Shared asset serving verification did not pass');
    }
    verifySharedAssets(shared, assets);
    verifyInventory(release, inventory);
    verifyInventory(previous, previousInventory);
    if (readPointer(pointer, releases) !== previous) throw new Error('Active pointer changed during preflight');
    durableJson(journalPath(state), { version: 1, previous, candidate: release, pointer: path.resolve(pointer) });
    try {
      switchPointer(pointer, release);
      const result = await smoke({ candidate: release, previous });
      if (result?.ok !== true) throw new Error('Smoke checks did not pass');
      if (readPointer(pointer, releases) !== release) throw new Error('Active pointer changed during smoke checks');
      removeJournal(state);
      return { active: release, previous };
    } catch (error) {
      const current = readPointer(pointer, releases);
      if (current !== release && current !== previous) throw new Error(`Rollback refused: pointer changed unexpectedly; original error: ${error.message}`);
      if (current !== previous) switchPointer(pointer, previous);
      const restored = await rollbackSmoke({ candidate: release, previous });
      if (restored?.ok !== true) throw new Error(`Previous pointer restored but rollback smoke failed; journal retained. Original error: ${error.message}`);
      if (readPointer(pointer, releases) !== previous) throw new Error('Rollback pointer changed during smoke checks; journal retained');
      removeJournal(state);
      throw new Error(`Activation failed and previous release restored: ${error.message}`, { cause: error });
    }
  } finally { unlock(); }
}

/**
 * After an interrupted activation, acquire the same lock only after an operator
 * establishes that no publisher is running and removes a stale lock.
 */
export async function recoverInterruptedActivation({ releases, pointer, state, previousInventory, rollbackSmoke }) {
  if (typeof rollbackSmoke !== 'function' || previousInventory?.configuration !== 'production') {
    throw new Error('Verified rollback inventory and smoke check are required');
  }
  const unlock = lock(state);
  try {
    const journal = JSON.parse(fs.readFileSync(journalPath(state), 'utf8'));
    if (journal.version !== 1 || journal.pointer !== path.resolve(pointer)) throw new Error('Invalid activation journal');
    const previous = requireRelease(releases, journal.previous);
    const candidate = requireRelease(releases, journal.candidate);
    verifyInventory(previous, previousInventory);
    const current = readPointer(pointer, releases);
    if (current !== previous && current !== candidate) throw new Error('Recovery refused: pointer changed unexpectedly');
    if (current !== previous) switchPointer(pointer, previous);
    if ((await rollbackSmoke({ previous, candidate }))?.ok !== true || readPointer(pointer, releases) !== previous) {
      throw new Error('Recovery smoke failed; journal retained');
    }
    removeJournal(state);
    return { active: previous };
  } finally { unlock(); }
}
