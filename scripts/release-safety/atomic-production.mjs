#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { activatePreparedRelease, prepareRelease, recoverActivation } from './atomic-frontend.mjs';
import { downloadProductionArtifact } from './production-artifact-verify.mjs';
import { verifySymlinkProductionAssets } from './production-assets.mjs';
import { hasWishlist, observeTestSubdomain, scriptFromRelease, smokeProduction, verifyTestSubdomainBaseline } from './production-smoke.mjs';

const BASE = '/home/illoc/releases/frontend';

function requireInputs({ commit, previousCommit, apiCommit, token, originIp, key }) {
  for (const value of [commit, previousCommit, apiCommit]) if (!/^[a-f0-9]{40}$/.test(value || '')) throw new Error('Full lowercase candidate, previous and API commit SHAs are required');
  if (commit === previousCommit) throw new Error('Candidate and previous commits must differ');
  if (!token?.trim() || !key?.trim() || !net.isIP(originIp || '')) throw new Error('OPS_VERIFY_TOKEN, VITE_STRIPE_PUBLISHABLE_KEY and DRIFT_ORIGIN_IP are required');
}

export function stageAtomicProduction({ runId, commit, releases = `${BASE}/releases`, state = `${BASE}/state`, sharedAssets = `${BASE}/shared-assets`, stableTest = `${BASE}/stable-test/root`, key, download = downloadProductionArtifact }) {
  if (!/^[a-f0-9]{40}$/.test(commit || '') || !key?.trim()) throw new Error('A full commit SHA and VITE_STRIPE_PUBLISHABLE_KEY are required');
  if (fs.existsSync(path.join(state, 'activation.json'))) throw new Error('Interrupted activation requires recovery before staging');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-atomic-stage-'));
  try {
    const verified = download({ runId, commit, destination: path.join(temporary, 'candidate'), key });
    if (verified?.ok !== true || verified.inventory?.commit !== commit) throw new Error('Artifact provenance verification failed');
    const release = prepareRelease({ source: path.join(temporary, 'candidate'), inventory: verified.inventory, releases, sharedAssets, stableTest });
    return { release, commit, workflowRunId: verified.workflowRunId, artifactDigest: verified.artifactDigest };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export async function deployAtomicProduction({ runId, commit, previousRunId, previousCommit, apiCommit,
  releases = `${BASE}/releases`, state = `${BASE}/state`, pointer = `${BASE}/current`, sharedAssets = `${BASE}/shared-assets`, stableTest = `${BASE}/stable-test/root`,
  token, originIp, key, download = downloadProductionArtifact, smoke = smokeProduction, verifyAssets = verifySymlinkProductionAssets,
  observeTest = observeTestSubdomain, verifyTest = verifyTestSubdomainBaseline }) {
  requireInputs({ commit, previousCommit, apiCommit, token, originIp, key });
  const current = fs.realpathSync(pointer);
  if (current !== path.join(fs.realpathSync(releases), previousCommit)) throw new Error('Active release does not match the independently specified rollback commit');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-atomic-production-'));
  try {
    const previous = download({ runId: previousRunId, commit: previousCommit, destination: path.join(temporary, 'previous'), key });
    const candidate = download({ runId, commit, destination: path.join(temporary, 'candidate'), key });
    if (previous?.ok !== true || candidate?.ok !== true) throw new Error('Artifact provenance verification failed');
    const target = fs.existsSync(path.join(releases, commit)) ? path.join(releases, commit) : prepareRelease({
      source: path.join(temporary, 'candidate'), inventory: candidate.inventory, releases, sharedAssets, stableTest
    });
    const check = release => smoke({ token, releaseAsset: scriptFromRelease(release), wishlist: hasWishlist(release), expectedApiRelease: apiCommit });
    const assets = candidate.inventory.files.filter(file => file.path.startsWith('assets/'));
    let testBaseline;
    return activatePreparedRelease({ releases, state, pointer, candidate: target, inventory: candidate.inventory, sharedAssets, stableTest,
      preflight: async ({ previous: active }) => {
        if (active !== current || (await check(active))?.ok !== true) return { ok: false };
        testBaseline = await observeTest({ originIp });
        return { ok: true };
      }, smoke: async () => {
        if ((await verifyAssets({ sharedAssets, assets, originIp }))?.ok !== true || (await check(target))?.ok !== true) return { ok: false };
        return verifyTest(testBaseline, { originIp });
      }, rollbackSmoke: async () => {
        if ((await check(current))?.ok !== true) return { ok: false };
        return verifyTest(testBaseline, { originIp });
      } });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

export async function recoverAtomicProduction({ previousCommit, apiCommit, releases = `${BASE}/releases`, state = `${BASE}/state`, pointer = `${BASE}/current`, token, smoke = smokeProduction }) {
  for (const value of [previousCommit, apiCommit]) if (!/^[a-f0-9]{40}$/.test(value || '')) throw new Error('Full lowercase previous and API commit SHAs are required');
  const expected = path.join(fs.realpathSync(releases), previousCommit);
  return recoverActivation({ releases, state, pointer, rollbackSmoke: async ({ previous }) => {
    if (previous !== expected) return { ok: false };
    return smoke({ token, releaseAsset: scriptFromRelease(previous), wishlist: hasWishlist(previous), expectedApiRelease: apiCommit });
  } });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...values] = process.argv.slice(2);
    const common = { token: process.env.OPS_VERIFY_TOKEN, originIp: process.env.DRIFT_ORIGIN_IP, key: process.env.VITE_STRIPE_PUBLISHABLE_KEY };
    let result;
    if (operation === 'stage' && values.length === 2) result = stageAtomicProduction({ ...common, runId: values[0], commit: values[1] });
    else if (operation === 'deploy' && values.length === 5) result = await deployAtomicProduction({ ...common, runId: values[0], commit: values[1], previousRunId: values[2], previousCommit: values[3], apiCommit: values[4] });
    else if (operation === 'rollback' && values.length === 5) result = await deployAtomicProduction({ ...common, runId: values[0], commit: values[1], previousRunId: values[2], previousCommit: values[3], apiCommit: values[4] });
    else if (operation === 'recover' && values.length === 2) result = await recoverAtomicProduction({ ...common, previousCommit: values[0], apiCommit: values[1] });
    else throw new Error('Usage: atomic-production.mjs stage <run> <sha> | deploy|rollback <candidate-run> <candidate-sha> <current-run> <current-sha> <api-sha> | recover <previous-sha> <api-sha>');
    console.log(JSON.stringify(result));
  } catch (error) { console.error(`[atomic-production] ${error.message}`); process.exitCode = 1; }
}
