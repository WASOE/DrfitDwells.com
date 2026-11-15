import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageVerifiedProduction } from './stage-production.mjs';

test('rejects invalid provenance without staging a release', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-stage-production-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releases = path.join(root, 'releases');
  const state = path.join(root, 'state');
  fs.mkdirSync(releases);
  fs.mkdirSync(state);
  await assert.rejects(stageVerifiedProduction({ runId: 'invalid', commit: 'a'.repeat(40),
    releases, state, key: 'pk_live_fixture' }), /workflow run ID/);
  assert.deepEqual(fs.readdirSync(releases), []);
  assert.deepEqual(fs.readdirSync(state), []);
});
