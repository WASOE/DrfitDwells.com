import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createInventory } from './frontend-inventory.mjs';
import { prepareRelease } from './atomic-frontend.mjs';
import { deployAtomicProduction } from './atomic-production.mjs';

function thaw(dir) {
  try { fs.chmodSync(dir, 0o755); } catch {}
  try { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) thaw(path.join(dir, entry.name)); } catch {}
}

function artifact(root, commit, label) {
  const dir = path.join(root, label); fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), `<script type="module" src="/assets/${label}.js"></script>`);
  fs.writeFileSync(path.join(dir, 'assets', `${label}.js`), label);
  return { dir, inventory: createInventory(dir, commit, 'production') };
}

test('candidate-only assets are checked at the origin only after the pointer switch', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-atomic-production-'));
  t.after(() => { thaw(root); fs.rmSync(root, { recursive: true, force: true }); });
  const releases = path.join(root, 'releases'); const state = path.join(root, 'state');
  const sharedAssets = path.join(root, 'shared-assets'); const stableTest = path.join(root, 'stable-test');
  for (const dir of [releases, state, sharedAssets, stableTest]) { fs.mkdirSync(dir, { mode: 0o755 }); fs.chmodSync(dir, 0o755); }
  const previousCommit = 'a'.repeat(40); const commit = 'b'.repeat(40); const previousArtifact = artifact(root, previousCommit, 'previous'); const candidateArtifact = artifact(root, commit, 'candidate');
  const previous = prepareRelease({ source: previousArtifact.dir, inventory: previousArtifact.inventory, releases, sharedAssets, stableTest });
  const pointer = path.join(root, 'current'); fs.symlinkSync(previous, pointer);
  const byCommit = new Map([[previousCommit, previousArtifact], [commit, candidateArtifact]]);
  const download = ({ commit: requested, destination }) => {
    const selected = byCommit.get(requested); fs.cpSync(selected.dir, destination, { recursive: true });
    return { ok: true, inventory: selected.inventory };
  };
  let originChecks = 0;
  const result = await deployAtomicProduction({ runId: '2', commit, previousRunId: '1', previousCommit,
    apiCommit: 'c'.repeat(40), releases, state, pointer, sharedAssets, stableTest,
    token: 'token', originIp: '127.0.0.1', key: 'pk_live_mock', download,
    smoke: async () => ({ ok: true }), observeTest: async () => [{ protocol: 'http:' }, { protocol: 'https:' }],
    verifyTest: async () => ({ ok: true }), verifyAssets: async ({ assets }) => {
      originChecks += 1;
      assert.equal(fs.realpathSync(pointer), path.join(fs.realpathSync(releases), commit));
      assert.ok(assets.some(asset => asset.path === 'assets/candidate.js'));
      return { ok: true };
    } });
  assert.equal(result.active, path.join(fs.realpathSync(releases), commit));
  assert.equal(originChecks, 1);
});

