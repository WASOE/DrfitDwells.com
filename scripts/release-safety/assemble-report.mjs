#!/usr/bin/env node
/**
 * Build a release report from the artifacts of a completed Actions run.
 * The deploy script downloads those artifacts again and rejects any difference.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertReleaseSafetyReport } from './report.mjs';

const runId = process.argv[2];
const sha = process.argv[3];
if (!/^\d+$/.test(String(runId || '')) || !/^[a-f0-9]{40,64}$/i.test(String(sha || ''))) {
  console.error('Usage: node scripts/release-safety/assemble-report.mjs <run-id> <full-sha>');
  process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-assemble-'));

function download(name) {
  const dest = path.join(dir, name);
  const result = spawnSync('gh', ['run', 'download', runId, '-n', name, '-D', dest], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr || `Could not download ${name} from run ${runId}.`);
    process.exit(result.status || 1);
  }
  return dest;
}

const apacheDir = download('apache-browser-evidence');
const stagingDir = download('staging-evidence');
const report = {
  frontendRelease: sha,
  workflowRunId: String(runId),
  evidence: {
    apache: JSON.parse(fs.readFileSync(path.join(apacheDir, 'apache-evidence.json'), 'utf8')),
    browser: JSON.parse(fs.readFileSync(path.join(apacheDir, 'browser-evidence.json'), 'utf8')),
    staging: JSON.parse(fs.readFileSync(path.join(stagingDir, 'staging-evidence.json'), 'utf8'))
  }
};
const out = process.env.RELEASE_SAFETY_REPORT || path.join(process.cwd(), 'release-safety-report.json');
fs.writeFileSync(out, `${JSON.stringify(report)}\n`);
try {
  assertReleaseSafetyReport(out, sha);
} catch (error) {
  fs.rmSync(out, { force: true });
  console.error(`[release-safety] BLOCK: ${error.message}`);
  process.exit(1);
}
console.log(`[release-safety] wrote verified report ${out}`);
