import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activateVerifiedProduction, recoverVerifiedProduction } from './activate-production.mjs';
import { createInventory } from './frontend-inventory.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-activation-test-'));
  t.after(() => {
    function writable(dir) {
      fs.chmodSync(dir, 0o700);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) writable(path.join(dir, entry.name));
      }
    }
    writable(root);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const releases = path.join(root, 'releases');
  const state = path.join(root, 'state');
  const sharedAssets = path.join(root, 'assets');
  for (const dir of [releases, state, sharedAssets]) fs.mkdirSync(dir);
  fs.chmodSync(sharedAssets, 0o755);
  const oldSha = 'a'.repeat(40);
  const newSha = 'b'.repeat(40);
  const previous = path.join(releases, oldSha);
  const candidate = path.join(root, 'candidate-source');
  for (const [dir, asset] of [[previous, 'old.js'], [candidate, 'new.js']]) {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', asset), asset);
    fs.writeFileSync(path.join(dir, 'index.html'), `<html><script src="/assets/${asset}"></script></html>`);
  }
  const pointer = path.join(root, 'current');
  fs.symlinkSync(previous, pointer);
  const inventories = {
    [oldSha]: createInventory(previous, oldSha, 'production'),
    [newSha]: createInventory(candidate, newSha, 'production')
  };
  const download = ({ commit, destination }) => {
    fs.cpSync(commit === oldSha ? previous : candidate, destination, { recursive: true });
    return { ok: true, inventory: inventories[commit] };
  };
  const calls = [];
  const args = { runId: '2', commit: newSha, previousRunId: '1', previousCommit: oldSha,
    expectedApiRelease: 'c'.repeat(40), key: 'pk_live_fixture', token: 'test',
    releases, state, pointer, sharedAssets, originIp: '127.0.0.1', download,
    verifyAssets: async () => ({ ok: true }),
    smoke: async ({ releaseAsset }) => { calls.push(releaseAsset); return { ok: true }; } };
  return { args, previous, candidate, calls };
}

test('requires a verified active rollback and checks it before switching', async t => {
  const { args, previous, calls } = fixture(t);
  const result = await activateVerifiedProduction(args);
  assert.equal(result.previous, previous);
  assert.deepEqual(calls, ['/assets/old.js', '/assets/new.js']);
  assert.equal(fs.realpathSync(args.pointer), path.join(args.releases, args.commit));
});

test('failed post-switch smoke restores and checks the previous release', async t => {
  const { args, previous, calls } = fixture(t);
  await assert.rejects(activateVerifiedProduction({ ...args, smoke: async ({ releaseAsset }) => {
    calls.push(releaseAsset);
    return { ok: releaseAsset !== '/assets/new.js' };
  } }), /previous release restored/);
  assert.deepEqual(calls, ['/assets/old.js', '/assets/new.js', '/assets/old.js']);
  assert.equal(fs.realpathSync(args.pointer), previous);
});

test('refuses mismatched rollback pointer before contacting GitHub', async t => {
  const { args } = fixture(t);
  await assert.rejects(activateVerifiedProduction({ ...args, previousCommit: 'd'.repeat(40),
    download: () => { throw new Error('must not fetch'); } }), /rollback release/);
});

test('interrupted recovery independently verifies and smoke-tests the previous release', async t => {
  const { args, previous, calls } = fixture(t);
  const { active } = await activateVerifiedProduction(args);
  const journal = path.join(args.state, 'pending.json');
  fs.writeFileSync(journal, JSON.stringify({ version: 1, previous, candidate: active, pointer: args.pointer }));
  await assert.rejects(recoverVerifiedProduction({ ...args, previousCommit: 'd'.repeat(40) }), /Journal/);
  await assert.rejects(recoverVerifiedProduction({ ...args, verifyAssets: async () => ({ ok: false }) }), /asset verification/);
  assert.equal(fs.realpathSync(args.pointer), previous);
  assert.equal(fs.existsSync(journal), true);
  const result = await recoverVerifiedProduction(args);
  assert.equal(result.active, previous);
  assert.equal(calls.at(-1), '/assets/old.js');
  assert.equal(fs.existsSync(journal), false);
});
