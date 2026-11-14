#!/usr/bin/env node
/**
 * Read-only GitHub provenance verification; no blue-green activation.
 * node scripts/release-safety/production-artifact-verify.mjs <run-id> <full-sha> <new-output-directory>
 * Requires gh authentication with Actions read access, Python 3, and the expected
 * VITE_STRIPE_PUBLISHABLE_KEY. Trust is pinned below, never supplied by an artifact.
 * Only dispatches on master at the requested SHA are accepted. Dispatching an
 * older SHA from a newer master run is deliberately unsupported.
 * Also requires the latest release-safety.yml master push run for that SHA
 * to pass, including downloaded isolated staging responses and payment proof.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertApacheEvidence, assertBrowserEvidence, assertStagingEvidence } from './report.mjs';
import {
  ARCHIVE, MAX_BYTES, PACKAGE_FILES, requireCommit, requireProductionKey, sha256, verifyPackage
} from './production-artifact.mjs';

export const REPOSITORY = 'WASOE/DrfitDwells.com';
export const WORKFLOW = '.github/workflows/production-artifact.yml';
export const RELEASE_WORKFLOW = '.github/workflows/release-safety.yml';
export const artifactName = (commit, attempt) => `production-frontend-${commit}-${attempt}`;

function assertWorkflowRun(run, workflow, runId, commit, expectedPath, event) {
  requireCommit(commit);
  if (!/^[1-9]\d*$/.test(String(runId))) throw new Error('Invalid workflow run ID');
  if (String(run.id) !== String(runId) || run.repository?.full_name !== REPOSITORY ||
      run.head_repository?.full_name !== REPOSITORY || run.head_sha !== commit ||
      run.head_branch !== 'master' || run.event !== event ||
      run.status !== 'completed' || run.conclusion !== 'success' ||
      run.path !== expectedPath || workflow.path !== expectedPath || workflow.state !== 'active' ||
      run.workflow_id !== workflow.id || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Untrusted workflow run, unsuccessful run, or exact commit mismatch');
  }
}

export function assertTrustedRun(run, workflow, runId, commit) {
  assertWorkflowRun(run, workflow, runId, commit, WORKFLOW, 'workflow_dispatch');
}

export function selectArtifact(response, run, commit, name = artifactName(commit, run.run_attempt)) {
  const matches = response.artifacts?.filter(item => item.name === name) || [];
  if (response.total_count !== response.artifacts?.length || matches.length !== 1) {
    throw new Error('Missing, duplicate, or incomplete production artifact listing');
  }
  const artifact = matches[0];
  if (!Number.isSafeInteger(artifact.id) || artifact.id < 1 || artifact.expired !== false ||
      !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0 ||
      artifact.size_in_bytes > MAX_BYTES || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || '') ||
      artifact.workflow_run?.id !== run.id || artifact.workflow_run?.head_sha !== commit ||
      artifact.workflow_run?.head_branch !== 'master') {
    throw new Error('Invalid, expired, oversized, or mismatched production artifact');
  }
  return artifact;
}

export function assertEvidence(directory, commit, runId) {
  const apache = JSON.parse(fs.readFileSync(path.join(directory, 'apache-evidence.json'), 'utf8'));
  const browser = JSON.parse(fs.readFileSync(path.join(directory, 'browser-evidence.json'), 'utf8'));
  for (const evidence of [apache, browser]) {
    if (evidence.sha !== commit || String(evidence.workflowRunId) !== String(runId)) throw new Error('Release evidence provenance mismatch');
  }
  if (apache.search?.ok !== true || apache.checkout?.ok !== true ||
      apache.faultyRule?.searchRedirectedHome !== true || apache.faultyRule?.checkoutRedirectedHome !== true ||
      !Number.isSafeInteger(browser.passed) || browser.passed < 6 || browser.failed !== 0 || browser.skipped !== 0) {
    throw new Error('Required Apache/browser artifact checks did not pass');
  }
}

function gh(endpoint, output) {
  const fd = output ? fs.openSync(output, 'wx', 0o600) : null;
  try {
    const result = spawnSync('gh', ['api', '--hostname', 'github.com', endpoint], {
      encoding: 'utf8', stdio: ['ignore', fd ?? 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GH_HOST: 'github.com', GH_PAGER: 'cat' }
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`GitHub API request failed: ${result.stderr}`);
    return output ? null : JSON.parse(result.stdout);
  } finally { if (fd !== null) fs.closeSync(fd); }
}

const EXTRACT_ZIP = `
import json, os, shutil, sys, zipfile
archive, destination, expected, limit = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), int(sys.argv[4])
with zipfile.ZipFile(archive) as z:
    entries = z.infolist()
    if sorted(i.filename for i in entries) != sorted(expected): raise ValueError('Unexpected ZIP entries')
    if sum(i.file_size for i in entries) > limit: raise ValueError('ZIP size limit exceeded')
    for item in entries:
        if item.is_dir() or item.flag_bits & 1: raise ValueError('Invalid ZIP entry')
        with z.open(item) as source, open(os.path.join(destination, item.filename), 'xb') as output:
            shutil.copyfileobj(source, output)
`;

export function unpackDownload(archive, destination, files = PACKAGE_FILES) {
  execFileSync('python3', ['-c', EXTRACT_ZIP, archive, destination, JSON.stringify(files), String(MAX_BYTES)], { stdio: 'pipe' });
}

export function assertReleaseRun(run, workflow, runId, commit) {
  assertWorkflowRun(run, workflow, runId, commit, RELEASE_WORKFLOW, 'push');
}

export function verifyRequiredReleaseChecks({ commit, api, directory }) {
  const base = `repos/${REPOSITORY}/actions`;
  const workflow = api(`${base}/workflows/release-safety.yml`);
  const listing = api(`${base}/workflows/${workflow.id}/runs?branch=master&event=push&head_sha=${commit}&per_page=1`);
  const selected = listing.workflow_runs?.[0];
  if (!selected || !Number.isSafeInteger(selected.id) || selected.id < 1) {
    throw new Error('Required Release safety run is missing for the exact master commit');
  }
  const run = api(`${base}/runs/${selected.id}`);
  assertReleaseRun(run, workflow, selected.id, commit);
  const artifacts = api(`${base}/runs/${run.id}/artifacts?per_page=100`);
  const evidence = {};
  const digests = {};
  for (const [name, files] of [
    ['apache-browser-evidence', ['apache-evidence.json', 'browser-evidence.json']],
    ['staging-evidence', ['staging-evidence.json']]
  ]) {
    const artifact = selectArtifact(artifacts, run, commit, name);
    const archive = path.join(directory, `${name}.zip`);
    api(`${base}/artifacts/${artifact.id}/zip`, archive);
    if (fs.statSync(archive).size > MAX_BYTES || `sha256:${sha256(archive)}` !== artifact.digest) {
      throw new Error(`Release safety ${name} ZIP SHA256 mismatch`);
    }
    const extracted = path.join(directory, name);
    fs.mkdirSync(extracted, { mode: 0o700 });
    unpackDownload(archive, extracted, files);
    for (const file of files) {
      evidence[file.replace('-evidence.json', '')] = JSON.parse(fs.readFileSync(path.join(extracted, file), 'utf8'));
    }
    digests[name] = { artifactId: artifact.id, digest: artifact.digest };
  }
  const errors = [
    ...assertApacheEvidence(evidence.apache, commit, run.id),
    ...assertBrowserEvidence(evidence.browser, commit, run.id),
    ...assertStagingEvidence(evidence.staging, commit, run.id)
  ];
  if (errors.length) throw new Error(`Required Release safety evidence rejected: ${errors.join(' ')}`);
  const recheck = () => {
    const latest = api(`${base}/runs/${run.id}`);
    assertReleaseRun(latest, workflow, run.id, commit);
    if (latest.run_attempt !== run.run_attempt) throw new Error('Release safety run attempt changed during download');
  };
  recheck();
  return { runId: String(run.id), runAttempt: run.run_attempt, artifacts: digests, recheck };
}

export function downloadProductionArtifact({ runId, commit, destination, key, api = gh }) {
  requireCommit(commit);
  requireProductionKey(key);
  if (!/^[1-9]\d*$/.test(String(runId))) throw new Error('Invalid workflow run ID');
  if (fs.existsSync(destination)) throw new Error('Output directory must not exist');
  const base = `repos/${REPOSITORY}/actions`;
  const run = api(`${base}/runs/${runId}`);
  const workflow = api(`${base}/workflows/production-artifact.yml`);
  assertTrustedRun(run, workflow, runId, commit);
  const artifact = selectArtifact(api(`${base}/runs/${runId}/artifacts?per_page=100`), run, commit);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-production-artifact-'));
  let createdOutput = false;
  try {
    const releaseChecks = verifyRequiredReleaseChecks({ commit, api, directory: temporary });
    const archive = path.join(temporary, 'download.zip');
    // Never use an artifact-provided URL, repository, archive name or shell command.
    api(`${base}/artifacts/${artifact.id}/zip`, archive);
    if (fs.statSync(archive).size > MAX_BYTES || `sha256:${sha256(archive)}` !== artifact.digest) {
      throw new Error('GitHub artifact ZIP SHA256 mismatch');
    }
    unpackDownload(archive, temporary);
    assertEvidence(temporary, commit, runId);
    const inventory = verifyPackage(temporary, destination, commit, key);
    createdOutput = true;
    // Success is returned only after a final check for concurrent reruns/deletion.
    const latest = api(`${base}/runs/${runId}`);
    assertTrustedRun(latest, workflow, runId, commit);
    if (latest.run_attempt !== run.run_attempt) throw new Error('Workflow run attempt changed during download');
    releaseChecks.recheck();
    return { ok: true, repository: REPOSITORY, workflow: WORKFLOW, commit,
      releaseChecks: { workflow: RELEASE_WORKFLOW, workflowRunId: releaseChecks.runId,
        runAttempt: releaseChecks.runAttempt, artifacts: releaseChecks.artifacts },
      workflowRunId: String(runId), runAttempt: run.run_attempt,
      artifactId: artifact.id, artifactDigest: artifact.digest, archiveSha256: sha256(path.join(temporary, ARCHIVE)),
      files: inventory.files.length, inventory };
  } catch (error) {
    if (createdOutput) fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runId, commit, destination, ...extra] = process.argv.slice(2);
  try {
    if (!destination || extra.length) throw new Error('Usage: production-artifact-verify.mjs <run-id> <full-sha> <new-output-directory>');
    console.log(JSON.stringify(downloadProductionArtifact({
      runId, commit, destination, key: process.env.VITE_STRIPE_PUBLISHABLE_KEY
    }), null, 2));
  } catch (error) {
    console.error(`[production-artifact] ${error.message}`);
    process.exitCode = 1;
  }
}
