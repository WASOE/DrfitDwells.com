#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadProductionArtifact } from './production-artifact-verify.mjs';
import { activateRelease, recoverInterruptedActivation, stageRelease } from './blue-green.mjs';
import { verifyInventory } from './frontend-inventory.mjs';
import { hasWishlist, scriptFromRelease, smokeProduction } from './production-smoke.mjs';
import { verifyProductionAssets } from './production-assets.mjs';
import { verifyObservedMigrationRollback } from './vhost-migration.mjs';

/**
 * Both the active and candidate trees must match independently downloaded,
 * GitHub-verified production artifacts. The caller must complete the site
 * migration before invoking this operation.
 */
export async function activateVerifiedProduction({
  runId, commit, previousRunId, previousCommit, expectedApiRelease, key, token,
  releases, state, pointer, sharedAssets, originIp, migrationState,
  download = downloadProductionArtifact, smoke = smokeProduction, verifyAssets = verifyProductionAssets
}) {
  const observed = previousCommit === 'observed-production';
  for (const sha of [commit, expectedApiRelease, ...observed ? [] : [previousCommit]]) {
    if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Full lowercase frontend and API SHAs are required');
  }
  if (commit === previousCommit) throw new Error('Candidate and previous release must differ');
  if (!token?.trim()) throw new Error('An existing authorized Ops token is required');
  if (!net.isIP(originIp || '')) throw new Error('An explicit production origin IP is required');
  const root = fs.realpathSync(releases);
  if (observed && !migrationState) throw new Error('Migration state is required for observed rollback');
  const previous = observed ? fs.realpathSync(pointer) : path.join(root, previousCommit);
  const checkObserved = ({ previous: release, requireActivePointer = false }) => verifyObservedMigrationRollback({
    stateRoot: migrationState, releases, pointer, previous: release, requireActivePointer
  });
  if (!fs.lstatSync(pointer).isSymbolicLink() || fs.realpathSync(pointer) !== previous) {
    throw new Error('Active pointer does not match the independently verified rollback release');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-activation-'));
  try {
    const previousArtifact = observed ? checkObserved({ previous, requireActivePointer: true }) :
      download({ runId: previousRunId, commit: previousCommit, destination: path.join(tmp, 'previous'), key });
    const nextArtifact = download({ runId, commit, destination: path.join(tmp, 'candidate'), key });
    if (previousArtifact?.ok !== true || nextArtifact?.ok !== true) throw new Error('Production artifact verification failed');
    const staged = path.join(root, commit);
    let candidate;
    if (fs.existsSync(staged)) {
      if (!fs.lstatSync(staged).isDirectory()) throw new Error('Staged release is not a real directory');
      verifyInventory(staged, nextArtifact.inventory);
      candidate = staged;
    } else {
      candidate = await stageRelease({
        source: path.join(tmp, 'candidate'), releases, state, inventory: nextArtifact.inventory,
        verifyProvenance: async () => ({ ok: nextArtifact.ok })
      });
    }
    const check = release => smoke({ token, releaseAsset: scriptFromRelease(release),
      wishlist: hasWishlist(release), expectedApiRelease });
    return await activateRelease({
      releases, pointer, state, candidate, sharedAssets,
      inventory: nextArtifact.inventory, previousInventory: previousArtifact.inventory,
      verifyObservedRollback: observed ? checkObserved : undefined,
      verifyAssetServing: args => verifyAssets({ ...args, originIp }),
      preflight: async () => check(previous), smoke: async () => check(candidate),
      rollbackSmoke: async () => {
        if (observed) checkObserved({ previous, requireActivePointer: true });
        return check(previous);
      }
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function recoverVerifiedProduction({
  previousRunId, previousCommit, expectedApiRelease, key, token, releases, state,
  pointer, sharedAssets, originIp, migrationState, download = downloadProductionArtifact,
  smoke = smokeProduction, verifyAssets = verifyProductionAssets
}) {
  const observed = previousCommit === 'observed-production';
  for (const sha of [expectedApiRelease, ...observed ? [] : [previousCommit]]) {
    if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Full lowercase frontend and API SHAs are required');
  }
  if (!token?.trim() || !net.isIP(originIp || '')) throw new Error('Ops token and production origin IP are required');
  const pending = JSON.parse(fs.readFileSync(path.join(state, 'pending.json'), 'utf8'));
  if (!observed && pending.previous !== path.join(fs.realpathSync(releases), previousCommit)) {
    throw new Error('Journal does not identify the independently verified rollback release');
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-recovery-'));
  try {
    const checkObserved = ({ previous }) => verifyObservedMigrationRollback({
      stateRoot: migrationState, releases, pointer, previous
    });
    if (observed && !migrationState) throw new Error('Migration state is required for observed rollback');
    const artifact = observed ? checkObserved({ previous: pending.previous }) :
      download({ runId: previousRunId, commit: previousCommit, destination: path.join(temporary, 'previous'), key });
    if (artifact?.ok !== true || artifact.inventory?.commit !== previousCommit) {
      throw new Error('Independently verified rollback artifact is required');
    }
    return await recoverInterruptedActivation({
      releases, pointer, state, previousInventory: artifact.inventory,
      verifyObservedRollback: observed ? checkObserved : undefined,
      rollbackSmoke: async ({ previous }) => {
        const verified = await verifyAssets({ sharedAssets, originIp,
          assets: artifact.inventory.files.filter(file => file.path.startsWith('assets/')) });
        if (verified?.ok !== true) throw new Error('Rollback asset verification failed');
        if (observed) checkObserved({ previous });
        return smoke({ token, releaseAsset: scriptFromRelease(previous), wishlist: hasWishlist(previous), expectedApiRelease });
      }
    });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export async function rollbackToObservedProduction({
  runId, commit, expectedApiRelease, key, token, releases, state, pointer, sharedAssets,
  originIp, migrationState, download = downloadProductionArtifact,
  smoke = smokeProduction, verifyAssets = verifyProductionAssets
}) {
  for (const sha of [commit, expectedApiRelease]) {
    if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Full lowercase frontend and API SHAs are required');
  }
  if (!token?.trim() || !net.isIP(originIp || '') || !migrationState) {
    throw new Error('Ops token, production origin IP and migration state are required');
  }
  const previous = path.join(fs.realpathSync(releases), commit);
  if (!fs.lstatSync(pointer).isSymbolicLink() || fs.realpathSync(pointer) !== previous) {
    throw new Error('Active pointer does not match the independently verified current release');
  }
  const journal = JSON.parse(fs.readFileSync(path.join(migrationState, 'vhost-migration.json'), 'utf8'));
  const candidate = journal.release;
  const checkObserved = ({ candidate: release }) => verifyObservedMigrationRollback({
    stateRoot: migrationState, releases, pointer, previous: release
  });
  const observed = checkObserved({ candidate });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-observed-rollback-'));
  try {
    const artifact = download({ runId, commit, destination: path.join(tmp, 'current'), key });
    if (artifact?.ok !== true || artifact.inventory?.commit !== commit) throw new Error('Current artifact verification failed');
    const check = release => smoke({ token, releaseAsset: scriptFromRelease(release),
      wishlist: hasWishlist(release), expectedApiRelease });
    return await activateRelease({
      releases, pointer, state, candidate, sharedAssets,
      inventory: observed.inventory, previousInventory: artifact.inventory,
      verifyObservedCandidate: checkObserved,
      verifyAssetServing: args => verifyAssets({ ...args, originIp }),
      preflight: async () => check(previous), smoke: async () => check(candidate),
      rollbackSmoke: async () => check(previous)
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const recovery = process.argv[2] === 'recover';
    const rollback = process.argv[2] === 'rollback-observed';
    const values = process.argv.slice(recovery || rollback ? 3 : 2);
    if (values.length !== (recovery || rollback ? 3 : 5)) {
      throw new Error('Usage: activate-production.mjs <run-id> <commit> <previous-run-id> <previous-commit|observed-production> <api-commit> OR activate-production.mjs recover <previous-run-id> <previous-commit|observed-production> <api-commit> OR activate-production.mjs rollback-observed <current-run-id> <current-commit> <api-commit>');
    }
    const [runId, commit, previousRunId, previousCommit, expectedApiRelease] = recovery
      ? [undefined, undefined, ...values] : rollback
        ? [values[0], values[1], undefined, undefined, values[2]] : values;
    const base = '/home/illoc/releases/frontend';
    const common = {
      previousRunId, previousCommit, expectedApiRelease,
      key: process.env.VITE_STRIPE_PUBLISHABLE_KEY, token: process.env.OPS_VERIFY_TOKEN, originIp: process.env.DRIFT_ORIGIN_IP,
      releases: `${base}/releases`, state: `${base}/state`, pointer: `${base}/current`, sharedAssets: `${base}/assets`,
      migrationState: `${base}/migration-state`
    };
    const result = recovery ? await recoverVerifiedProduction(common) :
      rollback ? await rollbackToObservedProduction({ ...common, runId, commit }) :
        await activateVerifiedProduction({ ...common, runId, commit });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[activate-production] ${error.message}`);
    process.exitCode = 1;
  }
}
