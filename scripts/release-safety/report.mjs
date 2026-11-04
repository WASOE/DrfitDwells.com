/**
 * A production publish is allowed only when Apache, browser, and isolated
 * staging evidence for this exact SHA were uploaded by a completed successful
 * GitHub Actions run. Environment variables and a hand-written coverage label
 * are not evidence.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRODUCTION_HOSTS = new Set(['driftdwells.com', 'www.driftdwells.com']);
const STAGING_ORDER = ['quote', 'finalize-intent', 'create-payment-intent'];

export function stagingStepOrder(responses) {
  const order = [];
  for (const row of responses || []) {
    if (row?.step && !order.includes(row.step)) order.push(row.step);
  }
  return order;
}

export function assertApacheEvidence(apache, releaseSha, runId) {
  const errors = [];
  if (!apache) return ['Apache evidence is missing.'];
  if (apache.sha !== releaseSha) errors.push(`Apache evidence SHA ${apache.sha} does not match ${releaseSha}.`);
  if (String(apache.workflowRunId) !== String(runId)) errors.push('Apache evidence is from a different Actions run.');
  if (apache.search?.ok !== true || apache.search?.finalStatus !== 200 || apache.search?.finalPath !== '/search') {
    errors.push('Apache evidence did not serve /search as HTTP 200 on /search.');
  }
  if (apache.checkout?.ok !== true || apache.checkout?.finalStatus !== 200 || apache.checkout?.finalPath !== '/checkout') {
    errors.push('Apache evidence did not serve /checkout as HTTP 200 on /checkout.');
  }
  if (apache.faultyRule?.searchRedirectedHome !== true || apache.faultyRule?.checkoutRedirectedHome !== true) {
    errors.push('Apache evidence did not fail the historical index.html redirect.');
  }
  return errors;
}

export function assertBrowserEvidence(browser, releaseSha, runId) {
  const errors = [];
  if (!browser) return ['Browser evidence is missing.'];
  if (browser.sha !== releaseSha) errors.push(`Browser evidence SHA ${browser.sha} does not match ${releaseSha}.`);
  if (String(browser.workflowRunId) !== String(runId)) errors.push('Browser evidence is from a different Actions run.');
  if (browser.failed !== 0 || browser.skipped !== 0 || !(browser.passed >= 6)) {
    errors.push(`Browser evidence is not a complete pass (${browser.passed} passed, ${browser.failed} failed, ${browser.skipped} skipped).`);
  }
  return errors;
}

export function assertStagingEvidence(staging, releaseSha, runId) {
  const errors = [];
  if (!staging) return ['Staging evidence is missing. Environment variables are not a passing staging job.'];
  if (staging.sha !== releaseSha) errors.push(`Staging evidence SHA ${staging.sha} does not match ${releaseSha}.`);
  if (String(staging.workflowRunId) !== String(runId)) errors.push('Staging evidence is from a different Actions run.');
  if (!staging.originHost || PRODUCTION_HOSTS.has(staging.originHost)) {
    errors.push('Staging evidence origin is missing or is production.');
  }
  if (staging.stripeMode !== 'test') errors.push('Staging evidence did not verify Stripe test mode from the server.');
  const order = stagingStepOrder(staging.responses);
  if (order.join(',') !== STAGING_ORDER.join(',')) {
    errors.push(`Staging call order ${order.join(',') || 'empty'} is not quote,finalize-intent,create-payment-intent.`);
  }
  for (const step of STAGING_ORDER) {
    const row = (staging.responses || []).find((item) => item.step === step);
    if (!row || row.status !== 200 || row.success !== true) {
      errors.push(`Staging ${step} did not return HTTP 200 success.`);
    }
  }
  const finalize = (staging.responses || []).find((item) => item.step === 'finalize-intent');
  const payment = (staging.responses || []).find((item) => item.step === 'create-payment-intent');
  if (!finalize?.finalizeIntentHash) errors.push('Staging finalize-intent response has no finalizeIntentHash.');
  if (typeof payment?.clientSecret !== 'string' || !payment.clientSecret.startsWith('pi_') || !payment.clientSecret.includes('_secret_')) {
    errors.push('Staging create-payment-intent response has no test PaymentIntent client secret.');
  }
  return errors;
}

export function buildPassingEvidence(releaseSha, workflowRunId = '9001') {
  return {
    apache: {
      sha: releaseSha,
      workflowRunId: String(workflowRunId),
      search: { ok: true, finalStatus: 200, finalPath: '/search' },
      checkout: { ok: true, finalStatus: 200, finalPath: '/checkout' },
      faultyRule: { searchRedirectedHome: true, checkoutRedirectedHome: true }
    },
    browser: {
      sha: releaseSha,
      workflowRunId: String(workflowRunId),
      passed: 6,
      failed: 0,
      skipped: 0
    },
    staging: {
      sha: releaseSha,
      workflowRunId: String(workflowRunId),
      originHost: 'staging.example.test',
      stripeMode: 'test',
      responses: [
        { step: 'quote', status: 200, success: true },
        { step: 'finalize-intent', status: 200, success: true, finalizeIntentHash: 'hash_test' },
        { step: 'create-payment-intent', status: 200, success: true, clientSecret: 'pi_test_secret_test' }
      ]
    }
  };
}

export function writeEvidenceFixture(dir, evidence) {
  const apacheDir = path.join(dir, 'apache-browser-evidence');
  const stagingDir = path.join(dir, 'staging-evidence');
  fs.mkdirSync(apacheDir, { recursive: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(path.join(apacheDir, 'apache-evidence.json'), `${JSON.stringify(evidence.apache)}\n`);
  fs.writeFileSync(path.join(apacheDir, 'browser-evidence.json'), `${JSON.stringify(evidence.browser)}\n`);
  fs.writeFileSync(path.join(stagingDir, 'staging-evidence.json'), `${JSON.stringify(evidence.staging)}\n`);
}

function sameEvidence(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} evidence does not match the Actions artifact.`);
  }
}

export function assertCheckedOutSha({ headSha, evidenceSha, lookup }) {
  if (headSha === evidenceSha) return;
  const commit = lookup(evidenceSha);
  const parents = Array.isArray(commit?.parents) ? commit.parents : [];
  if (commit?.sha === evidenceSha && parents.includes(headSha)) return;
  throw new Error(`GitHub Actions run is SHA ${headSha}, not the tested commit ${evidenceSha}.`);
}

export function verifyGitHubEvidence({ runId, sha, report, spawn = spawnSync, tmp = os.tmpdir() }) {
  if (!/^\d+$/.test(String(runId || ''))) {
    throw new Error('Release report has no numeric GitHub Actions run id.');
  }
  const view = spawn('gh', ['run', 'view', String(runId), '--json', 'conclusion,headSha,status,url'], { encoding: 'utf8' });
  if (view.status !== 0) {
    throw new Error(`GitHub Actions run ${runId} could not be verified. Refusing to publish.`);
  }
  const data = JSON.parse(view.stdout);
  if (data.status !== 'completed' || data.conclusion !== 'success') {
    throw new Error(`GitHub Actions run ${runId} concluded ${data.conclusion || data.status}. Refusing to publish.`);
  }
  assertCheckedOutSha({
    headSha: data.headSha,
    evidenceSha: sha,
    lookup: (commitSha) => {
      const commit = spawn('gh', [
        'api',
        `repos/WASOE/DrfitDwells.com/commits/${commitSha}`,
        '--jq',
        '{sha:.sha,parents:[.parents[].sha]}'
      ], { encoding: 'utf8' });
      if (commit.status !== 0) {
        throw new Error(`Tested commit ${commitSha} could not be verified. Refusing to publish.`);
      }
      return JSON.parse(commit.stdout);
    }
  });
  const dir = fs.mkdtempSync(path.join(tmp, 'dd-evidence-'));
  try {
    for (const name of ['apache-browser-evidence', 'staging-evidence']) {
      const dest = path.join(dir, name);
      const downloaded = spawn('gh', ['run', 'download', String(runId), '-n', name, '-D', dest], { encoding: 'utf8' });
      if (downloaded.status !== 0) {
        throw new Error(`Actions run ${runId} is missing the ${name} artifact. Refusing to publish.`);
      }
    }
    sameEvidence(
      JSON.parse(fs.readFileSync(path.join(dir, 'apache-browser-evidence', 'apache-evidence.json'), 'utf8')),
      report.evidence.apache,
      'Apache'
    );
    sameEvidence(
      JSON.parse(fs.readFileSync(path.join(dir, 'apache-browser-evidence', 'browser-evidence.json'), 'utf8')),
      report.evidence.browser,
      'Browser'
    );
    sameEvidence(
      JSON.parse(fs.readFileSync(path.join(dir, 'staging-evidence', 'staging-evidence.json'), 'utf8')),
      report.evidence.staging,
      'Staging'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return data;
}

export function assertReleaseSafetyReport(reportPath, releaseSha, { verifyRun = verifyGitHubEvidence } = {}) {
  if (!reportPath) {
    throw new Error('Set RELEASE_SAFETY_REPORT to a verified release report. Publication without it is refused.');
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (report.frontendRelease !== releaseSha) {
    throw new Error(`Release safety report SHA ${report.frontendRelease} does not match ${releaseSha}.`);
  }
  const runId = report.workflowRunId;
  const evidence = report.evidence;
  if (!evidence || evidence.staging?.present === true && !evidence.staging.responses) {
    throw new Error('Release report has no completed staging responses. Environment presence is not evidence.');
  }
  const errors = [
    ...assertApacheEvidence(evidence?.apache, releaseSha, runId),
    ...assertBrowserEvidence(evidence?.browser, releaseSha, runId),
    ...assertStagingEvidence(evidence?.staging, releaseSha, runId)
  ];
  if (report.coverage?.staging === 'isolated-staging-integration' && !evidence?.staging?.responses) {
    errors.push('A staging coverage label is not a completed staging job.');
  }
  if (errors.length) {
    throw new Error(errors.join(' '));
  }
  verifyRun({ runId, sha: releaseSha, report });
  return report;
}
