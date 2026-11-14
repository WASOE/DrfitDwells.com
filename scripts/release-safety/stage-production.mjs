#!/usr/bin/env node
/**
 * Download a verified GitHub production artifact and stage it without
 * changing Apache or an active pointer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stageRelease } from './blue-green.mjs';
import { downloadProductionArtifact } from './production-artifact-verify.mjs';

export async function stageVerifiedProduction({ runId, commit, releases, state, key }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-verified-stage-'));
  try {
    const source = path.join(tmp, 'artifact');
    const verified = downloadProductionArtifact({ runId, commit, destination: source, key });
    const release = await stageRelease({
      source, releases, state, inventory: verified.inventory,
      verifyProvenance: async () => ({ ok: verified.ok })
    });
    return { release, commit, workflowRunId: verified.workflowRunId, artifactDigest: verified.artifactDigest };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [runId, commit, releases, state, ...extra] = process.argv.slice(2);
    if (!runId || !commit || !releases || !state || extra.length) {
      throw new Error('Usage: stage-production.mjs <run-id> <commit> <releases-dir> <state-dir>');
    }
    console.log(JSON.stringify(await stageVerifiedProduction({
      runId, commit, releases, state, key: process.env.VITE_STRIPE_PUBLISHABLE_KEY
    })));
  } catch (error) {
    console.error(`[stage-production] ${error.message}`);
    process.exitCode = 1;
  }
}
