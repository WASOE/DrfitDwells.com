import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildPassingEvidence } from './report.mjs';
import {
  ARCHIVE, CHECKSUM, INVENTORY, PACKAGE_FILES, createPackage, sha256,
  requireProductionKey, verifyPackage, verifyProductionBuild
} from './production-artifact.mjs';
import {
  REPOSITORY, WORKFLOW, artifactName, assertTrustedRun, selectArtifact,
  assertEvidence, downloadProductionArtifact, unpackDownload, RELEASE_WORKFLOW,
  HISTORICAL_ROLLBACK, HISTORICAL_WORKFLOW_SHA256, rollbackArtifactName, assertHistoricalWorkflow
} from './production-artifact-verify.mjs';

const COMMIT = 'a'.repeat(40);
const KEY = 'pk_live_productionfixture';
const RUN_ID = 123;
const workflow = { id: 45, path: WORKFLOW, state: 'active' };
const trustedRun = () => ({
  id: RUN_ID, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
  head_sha: COMMIT, head_branch: 'master', event: 'workflow_dispatch', status: 'completed',
  conclusion: 'success', path: WORKFLOW, workflow_id: workflow.id, run_attempt: 1
});

function fixture(t, commit = COMMIT) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-production-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'dist');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bg', 'wishlist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<script src="/assets/app.js"></script>');
  fs.writeFileSync(path.join(root, '.htaccess'), 'rules');
  fs.writeFileSync(path.join(root, 'sw.js'), 'service worker');
  fs.writeFileSync(path.join(root, 'bg', 'wishlist', 'index.html'), 'Bulgarian page');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), `
    const stripeKey = "${KEY}";
    const markers = ["guestInfo", "legalAcceptance", "acceptedTermsAndCancellation"];
    function contract(){return {paymentContractVersion:"checkout-payment-v2-finalize-1",
      checkoutSessionV2:true,finalizeIntentPersist:true,finalizeIntentRequiredForPi:true,
      frontendRelease:"${commit}"}}
  `);
  const pkg = path.join(directory, 'package');
  const out = path.join(directory, 'output');
  return { directory, root, pkg, out };
}

function addEvidence(pkg, commit = COMMIT) {
  const common = { sha: commit, workflowRunId: String(RUN_ID) };
  fs.writeFileSync(path.join(pkg, 'apache-evidence.json'), JSON.stringify({
    ...common, search: { ok: true }, checkout: { ok: true },
    faultyRule: { searchRedirectedHome: true, checkoutRedirectedHome: true }
  }));
  fs.writeFileSync(path.join(pkg, 'browser-evidence.json'), JSON.stringify({
    ...common, passed: 6, failed: 0, skipped: 0
  }));
}

function zipPackage(pkg, zip, names = PACKAGE_FILES) {
  execFileSync('python3', ['-c', `
import json, sys, zipfile, pathlib
with zipfile.ZipFile(sys.argv[2], 'w', compression=zipfile.ZIP_DEFLATED) as z:
    for name in json.loads(sys.argv[3]):
        z.write(pathlib.Path(sys.argv[1]) / name, name)
`, pkg, zip, JSON.stringify(names)]);
}

function artifactRecord(zip, headSha = COMMIT, name = artifactName(COMMIT, 1)) {
  return { id: 321, name, expired: false,
    size_in_bytes: fs.statSync(zip).size, digest: `sha256:${sha256(zip)}`,
    workflow_run: { id: RUN_ID, head_sha: headSha, head_branch: 'master' } };
}

function fakeApi(zip, { run = trustedRun(), mutateArtifact = value => value, latest = run,
  releaseFields = {}, mutateStaging = value => value, missingRelease = false, missingStaging = false,
  releaseLatest = null, commit = COMMIT, historical = false, workflowContent = null } = {}) {
  const calls = [];
  const releaseRun = { ...trustedRun(), id: 456, head_sha: commit, path: RELEASE_WORKFLOW, workflow_id: 46, event: 'push', ...releaseFields };
  let releaseArtifacts;
  function prepareReleaseArtifacts() {
    if (releaseArtifacts) return releaseArtifacts;
    const evidence = buildPassingEvidence(commit, releaseRun.id);
    evidence.staging = mutateStaging(evidence.staging);
    const source = path.join(path.dirname(zip), 'release-evidence');
    fs.mkdirSync(source, { recursive: true });
    for (const [name, value] of Object.entries(evidence)) {
      fs.writeFileSync(path.join(source, `${name}-evidence.json`), JSON.stringify(value));
    }
    releaseArtifacts = [
      ['apache-browser-evidence', ['apache-evidence.json', 'browser-evidence.json']],
      ...missingStaging ? [] : [['staging-evidence', ['staging-evidence.json']]]
    ].map(([name, files], i) => {
      const archive = path.join(path.dirname(zip), `${name}.zip`);
      zipPackage(source, archive, files);
      return { ...artifactRecord(archive), id: 600 + i, name, workflow_run: {
        id: releaseRun.id, head_sha: commit, head_branch: 'master'
      }, archive };
    });
    return releaseArtifacts;
  }
  const api = (endpoint, output) => {
    calls.push(endpoint);
    if (endpoint.startsWith(`repos/${REPOSITORY}/contents/${WORKFLOW}?ref=`)) {
      if (workflowContent) return workflowContent;
      const bytes = fs.readFileSync(new URL('../../.github/workflows/production-artifact.yml', import.meta.url));
      return { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length, sha: 'a'.repeat(40) };
    }
    if (endpoint.endsWith('/workflows/release-safety.yml')) return { id: 46, path: RELEASE_WORKFLOW, state: 'active' };
    if (endpoint.includes('/workflows/46/runs?')) return { workflow_runs: missingRelease ? [] : [releaseRun] };
    if (endpoint.endsWith('/runs/456')) {
      return releaseLatest && calls.filter(x => x.endsWith('/runs/456')).length > 1 ? releaseLatest : releaseRun;
    }
    if (endpoint.endsWith('/runs/456/artifacts?per_page=100')) {
      const artifacts = prepareReleaseArtifacts();
      return { total_count: artifacts.length, artifacts };
    }
    const releaseArtifact = releaseArtifacts?.find(item => endpoint.endsWith(`/artifacts/${item.id}/zip`));
    if (releaseArtifact) { fs.copyFileSync(releaseArtifact.archive, output); return; }
    if (endpoint.endsWith('/zip')) { fs.copyFileSync(zip, output); return; }
    if (endpoint.endsWith('/artifacts?per_page=100')) {
      return { total_count: 1, artifacts: [mutateArtifact(artifactRecord(zip, run.head_sha,
        historical ? rollbackArtifactName(run.run_attempt) : artifactName(commit, run.run_attempt)))] };
    }
    if (endpoint.endsWith('/workflows/production-artifact.yml')) return workflow;
    if (endpoint.endsWith(`/runs/${RUN_ID}`)) return calls.filter(x => x.endsWith(`/runs/${RUN_ID}`)).length === 1 ? run : latest;
    throw new Error(`Unexpected API request: ${endpoint}`);
  };
  return { api, calls };
}

test('complete production artifact round-trip preserves nested and hidden files', t => {
  const { root, pkg, out } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  const inventory = verifyPackage(pkg, out, COMMIT, KEY);
  assert.equal(inventory.configuration, 'production');
  assert.equal(inventory.files.length, 5);
  assert.equal(fs.readFileSync(path.join(out, '.htaccess'), 'utf8'), 'rules');
  assert.equal(fs.readFileSync(path.join(out, 'bg/wishlist/index.html'), 'utf8'), 'Bulgarian page');
  assert.throws(() => createPackage(root, pkg, COMMIT, KEY), /EEXIST/);
  assert.throws(() => verifyPackage(pkg, out, COMMIT, KEY), /must not exist/);
});

test('missing, test and malformed public keys are refused', () => {
  for (const key of [undefined, '', 'sk_live_secret', 'pk_test_example', 'pk_live_abc\n', 'pk_live_abc def']) {
    assert.throws(() => requireProductionKey(key), /production Stripe/);
  }
});

for (const [label, change, error] of [
  ['different release', source => source.replace(COMMIT, 'b'.repeat(40)), /frontendRelease/],
  ['disabled real flag', source => source.replace('finalizeIntentPersist:true', 'finalizeIntentPersist:false'), /finalizeIntentPersist/],
  ['test key', source => source.replace(KEY, 'pk_test_fixture'), /publishable|PUBLISHABLE/],
  ['wrong live key', source => source.replace(KEY, 'pk_live_other'), /PUBLISHABLE/],
  ['mixed keys', source => `${source}\nconst stale = "pk_test_stale";`, /only the expected/],
  ['extra live key', source => `${source}\nconst stale = "pk_live_other";`, /only the expected/],
  ['no compiled object', source => source.replace('function contract()', 'const contract = '), /no payment-contract object/]
]) {
  test(`production build rejects ${label}`, t => {
    const { root } = fixture(t);
    const file = path.join(root, 'assets/app.js');
    fs.writeFileSync(file, change(fs.readFileSync(file, 'utf8')));
    assert.throws(() => verifyProductionBuild(root, COMMIT, KEY), error);
  });
}

test('build refuses missing mandatory files, unreachable JS and filesystem links', t => {
  const { root } = fixture(t);
  fs.unlinkSync(path.join(root, 'sw.js'));
  assert.throws(() => verifyProductionBuild(root, COMMIT, KEY), /sw.js missing/);
  fs.writeFileSync(path.join(root, 'sw.js'), 'worker');
  fs.symlinkSync('index.html', path.join(root, 'link'));
  assert.throws(() => verifyProductionBuild(root, COMMIT, KEY), /Unsupported artifact entry/);
  fs.unlinkSync(path.join(root, 'link'));
  fs.writeFileSync(path.join(root, 'index.html'), 'no script');
  assert.throws(() => verifyProductionBuild(root, COMMIT, KEY), /does not reach/);
});

test('tampering with archive, inventory commit, configuration, file list or hash is refused', t => {
  const { root, pkg, out } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  const archive = path.join(pkg, ARCHIVE);
  const original = fs.readFileSync(archive);
  fs.appendFileSync(archive, 'tamper');
  assert.throws(() => verifyPackage(pkg, out, COMMIT, KEY), /SHA256 mismatch/);
  fs.writeFileSync(archive, original);
  const manifest = path.join(pkg, INVENTORY);
  const inventory = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const change of [
    value => { value.commit = 'b'.repeat(40); },
    value => { value.configuration = 'test'; },
    value => { value.files.pop(); },
    value => { value.files[0].sha256 = 'f'.repeat(64); },
    value => { value.files.push({ path: 'unexpected', size: 0, sha256: 'a'.repeat(64) }); }
  ]) {
    const modified = structuredClone(inventory);
    change(modified);
    fs.writeFileSync(manifest, JSON.stringify(modified));
    assert.throws(() => verifyPackage(pkg, out, COMMIT, KEY), /mismatch/);
    assert.equal(fs.existsSync(out), false);
  }
});

test('a rehashed inventory cannot relabel a compiled build as another release', t => {
  const { root, pkg, out } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  const manifest = path.join(pkg, INVENTORY);
  const inventory = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  inventory.commit = 'b'.repeat(40);
  fs.writeFileSync(manifest, JSON.stringify(inventory));
  assert.throws(() => verifyPackage(pkg, out, inventory.commit, KEY), /frontendRelease/);
  assert.equal(fs.existsSync(out), false);
});

for (const type of ['traversal', 'absolute', 'symlink', 'hardlink', 'fifo', 'duplicate']) {
  test(`safe extraction refuses ${type} before writing files`, t => {
    const { root, pkg, out, directory } = fixture(t);
    createPackage(root, pkg, COMMIT, KEY);
    execFileSync('python3', ['-c', `
import io, sys, tarfile
with tarfile.open(sys.argv[1], 'w') as tar:
    kind = sys.argv[2]
    item = tarfile.TarInfo('../escaped' if kind == 'traversal' else '/escaped' if kind == 'absolute' else 'entry')
    if kind == 'symlink': item.type = tarfile.SYMTYPE; item.linkname = '../escaped'
    if kind == 'hardlink': item.type = tarfile.LNKTYPE; item.linkname = '../escaped'
    if kind == 'fifo': item.type = tarfile.FIFOTYPE
    tar.addfile(item, io.BytesIO(b''))
    if kind == 'duplicate': tar.addfile(item, io.BytesIO(b''))
`, path.join(pkg, ARCHIVE), type]);
    fs.writeFileSync(path.join(pkg, CHECKSUM), `${sha256(path.join(pkg, ARCHIVE))}  ${ARCHIVE}\n`);
    assert.throws(() => verifyPackage(pkg, out, COMMIT, KEY), /Command failed/);
    assert.equal(fs.existsSync(out), false);
    assert.equal(fs.existsSync(path.join(directory, 'escaped')), false);
  });
}

test('run provenance requires successful manual master run in pinned repository/workflow at exact SHA', () => {
  assert.doesNotThrow(() => assertTrustedRun(trustedRun(), workflow, RUN_ID, COMMIT));
  for (const fields of [
    { id: 999 }, { head_sha: 'b'.repeat(40) }, { repository: { full_name: 'evil/fork' } },
    { head_repository: { full_name: 'evil/fork' } }, { head_branch: 'feature' },
    { event: 'pull_request' }, { event: 'push' }, { status: 'in_progress' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { path: '.github/workflows/release-safety.yml' },
    { workflow_id: 999 }, { run_attempt: 0 }
  ]) {
    assert.throws(() => assertTrustedRun({ ...trustedRun(), ...fields }, workflow, RUN_ID, COMMIT), /Untrusted/);
  }
  assert.throws(() => assertTrustedRun(trustedRun(), { ...workflow, state: 'disabled_manually' }, RUN_ID, COMMIT), /Untrusted/);
  assert.throws(() => assertTrustedRun(trustedRun(), workflow, '123/evil', COMMIT), /Invalid workflow/);
});

test('download verifies GitHub digest, complete inventory, exact contract and evidence end to end', t => {
  const { root, pkg, out, directory } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  addEvidence(pkg);
  const zip = path.join(directory, 'package.zip');
  zipPackage(pkg, zip);
  const { api, calls } = fakeApi(zip);
  const result = downloadProductionArtifact({ runId: RUN_ID, commit: COMMIT, key: KEY, destination: out, api });
  assert.equal(result.ok, true);
  assert.equal(result.files, 5);
  assert.equal(result.artifactId, 321);
  assert.equal(result.archiveSha256, sha256(path.join(pkg, ARCHIVE)));
  assert.equal(result.inventory.commit, COMMIT);
  assert.equal(calls.filter(x => x.endsWith('/zip')).length, 3);
  assert.equal(result.releaseChecks.workflowRunId, '456');
  assert.ok(calls.every(x => x.startsWith(`repos/${REPOSITORY}/actions/`)));
});

test('pinned historical rollback verifies trusted workflow, independent release checks and package', t => {
  const { root, pkg, out, directory } = fixture(t, HISTORICAL_ROLLBACK);
  createPackage(root, pkg, HISTORICAL_ROLLBACK, KEY);
  addEvidence(pkg, HISTORICAL_ROLLBACK);
  const zip = path.join(directory, 'package.zip');
  zipPackage(pkg, zip);
  const { api, calls } = fakeApi(zip, { commit: HISTORICAL_ROLLBACK, historical: true });
  const result = downloadProductionArtifact({ runId: RUN_ID, commit: HISTORICAL_ROLLBACK, key: KEY, destination: out, api });
  assert.equal(result.provenanceMode, 'pinned-historical-rollback');
  assert.equal(result.commit, HISTORICAL_ROLLBACK);
  assert.equal(result.workflowCommit, COMMIT);
  assert.equal(result.inventory.commit, HISTORICAL_ROLLBACK);
  assert.equal(result.releaseChecks.workflowRunId, '456');
  assert.equal(calls.filter(x => x.includes(`/contents/${WORKFLOW}?ref=${COMMIT}`)).length, 2);
});

for (const [label, options] of [
  ['modified workflow', { workflowContent: { encoding: 'base64', content: Buffer.from('fake').toString('base64'), size: 4, sha: 'a'.repeat(40) } }],
  ['malformed workflow response', { workflowContent: { encoding: 'none', content: '', size: 0 } }],
  ['branch dispatch', { run: { ...trustedRun(), head_branch: 'feature' } }],
  ['fork dispatch', { run: { ...trustedRun(), head_repository: { full_name: 'evil/fork' } } }],
  ['wrong workflow', { run: { ...trustedRun(), path: RELEASE_WORKFLOW } }],
  ['missing historical release evidence', { missingRelease: true }],
  ['historical staging mismatch', { mutateStaging: value => ({ ...value, sha: COMMIT }) }],
  ['wrong artifact run SHA', { mutateArtifact: value => ({ ...value, workflow_run: { id: RUN_ID, head_sha: HISTORICAL_ROLLBACK, head_branch: 'master' } }) }],
  ['wrong artifact name', { mutateArtifact: value => ({ ...value, name: artifactName(HISTORICAL_ROLLBACK, 1) }) }],
  ['changed attempt', { latest: { ...trustedRun(), run_attempt: 2 } }]
]) {
  test(`historical rollback rejects ${label}`, t => {
    const { root, pkg, out, directory } = fixture(t, HISTORICAL_ROLLBACK);
    createPackage(root, pkg, HISTORICAL_ROLLBACK, KEY);
    addEvidence(pkg, HISTORICAL_ROLLBACK);
    const zip = path.join(directory, 'package.zip');
    zipPackage(pkg, zip);
    const { api } = fakeApi(zip, { commit: HISTORICAL_ROLLBACK, historical: true, ...options });
    assert.throws(() => downloadProductionArtifact({ runId: RUN_ID, commit: HISTORICAL_ROLLBACK, key: KEY, destination: out, api }));
    assert.equal(fs.existsSync(out), false);
  });
}

test('historical exception cannot authorize a different requested source', () => {
  const bytes = fs.readFileSync(new URL('../../.github/workflows/production-artifact.yml', import.meta.url));
  const content = { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length, sha: 'a'.repeat(40) };
  assert.throws(() => assertHistoricalWorkflow(trustedRun(), workflow, RUN_ID, 'c'.repeat(40), content), /not allowed/);
  assert.throws(() => assertTrustedRun(trustedRun(), workflow, RUN_ID, 'c'.repeat(40)), /Untrusted/);
  assert.equal(sha256(new URL('../../.github/workflows/production-artifact.yml', import.meta.url)), HISTORICAL_WORKFLOW_SHA256);
});

for (const [label, options] of [
  ['missing run', { missingRelease: true }],
  ['failed run', { releaseFields: { conclusion: 'failure' } }],
  ['wrong commit', { releaseFields: { head_sha: 'b'.repeat(40) } }],
  ['non-master run', { releaseFields: { head_branch: 'feature' } }],
  ['wrong workflow', { releaseFields: { path: WORKFLOW } }],
  ['PR run', { releaseFields: { event: 'pull_request' } }],
  ['missing staging artifact', { missingStaging: true }],
  ['label-only staging', { mutateStaging: () => ({ present: true, coverage: 'isolated-staging-integration' }) }],
  ['mismatched staging SHA', { mutateStaging: value => ({ ...value, sha: 'b'.repeat(40) }) }],
  ['mismatched staging run', { mutateStaging: value => ({ ...value, workflowRunId: '999' }) }],
  ['failed staging response', { mutateStaging: value => ({ ...value, responses: value.responses.map(row => ({ ...row, success: false })) }) }],
  ['missing staging payment proof', { mutateStaging: value => ({ ...value, responses: value.responses.slice(0, 2) }) }],
  ['live Stripe staging', { mutateStaging: value => ({ ...value, stripeMode: 'live' }) }],
  ['concurrent release rerun', { releaseLatest: { ...trustedRun(), id: 456, path: RELEASE_WORKFLOW,
    workflow_id: 46, event: 'push', run_attempt: 2 } }]
]) {
  test(`required Release safety rejects ${label} without usable output`, t => {
    const { root, pkg, out, directory } = fixture(t);
    createPackage(root, pkg, COMMIT, KEY);
    addEvidence(pkg);
    const zip = path.join(directory, 'package.zip');
    zipPackage(pkg, zip);
    const { api } = fakeApi(zip, options);
    assert.throws(() => downloadProductionArtifact({
      runId: RUN_ID, commit: COMMIT, key: KEY, destination: out, api
    }), /Release safety|Untrusted|artifact/);
    assert.equal(fs.existsSync(out), false);
  });
}

test('untrusted runs never trigger an artifact download', t => {
  const { out } = fixture(t);
  const { api, calls } = fakeApi('unused', { run: { ...trustedRun(), event: 'pull_request' } });
  assert.throws(() => downloadProductionArtifact({ runId: RUN_ID, commit: COMMIT, key: KEY, destination: out, api }), /Untrusted/);
  assert.equal(calls.some(x => x.endsWith('/zip')), false);
  assert.equal(fs.existsSync(out), false);
});

test('artifact selection rejects expiration, wrong attempts, foreign commits and missing digest', t => {
  const { root, pkg, directory } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  addEvidence(pkg);
  const zip = path.join(directory, 'package.zip');
  zipPackage(pkg, zip);
  const good = artifactRecord(zip);
  for (const fields of [
    { expired: true }, { name: artifactName(COMMIT, 2) }, { digest: undefined },
    { size_in_bytes: 2 ** 40 }, { workflow_run: { id: 456, head_sha: COMMIT, head_branch: 'master' } },
    { workflow_run: { id: RUN_ID, head_sha: 'b'.repeat(40), head_branch: 'master' } }
  ]) {
    assert.throws(() => selectArtifact({ total_count: 1, artifacts: [{ ...good, ...fields }] }, trustedRun(), COMMIT), /artifact/);
  }
  assert.throws(() => selectArtifact({ total_count: 101, artifacts: [good] }, trustedRun(), COMMIT), /incomplete/);
  assert.throws(() => selectArtifact({ total_count: 2, artifacts: [good, good] }, trustedRun(), COMMIT), /duplicate/);
});

test('GitHub ZIP digest mismatch and concurrent rerun leave no usable output', t => {
  const { root, pkg, directory } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  addEvidence(pkg);
  const zip = path.join(directory, 'package.zip');
  zipPackage(pkg, zip);
  for (const options of [
    { mutateArtifact: value => ({ ...value, digest: `sha256:${'0'.repeat(64)}` }) },
    { latest: { ...trustedRun(), run_attempt: 2 } }
  ]) {
    const out = path.join(directory, 'output');
    const { api } = fakeApi(zip, options);
    assert.throws(() => downloadProductionArtifact({ runId: RUN_ID, commit: COMMIT, key: KEY, destination: out, api }), /SHA256 mismatch|attempt changed/);
    assert.equal(fs.existsSync(out), false);
  }
});

test('evidence rejects mismatched release/run, skipped or failed tests and missing redirect regression', t => {
  const { root, pkg } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  for (const [file, change] of [
    ['apache-evidence.json', value => { value.sha = 'b'.repeat(40); }],
    ['browser-evidence.json', value => { value.workflowRunId = '456'; }],
    ['browser-evidence.json', value => { value.skipped = 1; }],
    ['browser-evidence.json', value => { value.failed = 1; }],
    ['browser-evidence.json', value => { value.passed = 5; }],
    ['apache-evidence.json', value => { value.faultyRule.checkoutRedirectedHome = false; }]
  ]) {
    addEvidence(pkg);
    const value = JSON.parse(fs.readFileSync(path.join(pkg, file)));
    change(value);
    fs.writeFileSync(path.join(pkg, file), JSON.stringify(value));
    assert.throws(() => assertEvidence(pkg, COMMIT, RUN_ID), /mismatch|did not pass/);
  }
});

test('outer ZIP rejects extra, missing and duplicate entries without extracting', t => {
  const { root, pkg, directory } = fixture(t);
  createPackage(root, pkg, COMMIT, KEY);
  addEvidence(pkg);
  for (const [i, names] of [
    [...PACKAGE_FILES, INVENTORY], PACKAGE_FILES.slice(1), [...PACKAGE_FILES, '../dist/index.html']
  ].entries()) {
    const zip = path.join(directory, `bad-${i}.zip`);
    zipPackage(pkg, zip, names);
    const destination = path.join(directory, `unzip-${i}`);
    fs.mkdirSync(destination);
    assert.throws(() => unpackDownload(zip, destination), /Command failed/);
    assert.deepEqual(fs.readdirSync(destination), []);
  }
});

test('workflow keeps production artifact separate, exact-SHA bound and tests unpacked bytes', () => {
  const workflowSource = fs.readFileSync(new URL('../../.github/workflows/production-artifact.yml', import.meta.url), 'utf8');
  assert.match(workflowSource, /workflow_dispatch:/);
  assert.match(workflowSource, /vars\.VITE_STRIPE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(workflowSource, /secrets\.|pk_test_|pull_request:|push:|blue-green\.mjs/);
  assert.match(workflowSource, /"\$REQUESTED_COMMIT" == "\$GITHUB_SHA"/);
  assert.match(workflowSource, /persist-credentials: false/);
  assert.match(workflowSource, /overwrite: false/);
  assert.ok(workflowSource.indexOf('verify production-package client/dist') < workflowSource.indexOf('run-gate.mjs'));
  assert.ok(workflowSource.indexOf('run-browser-gate.mjs') < workflowSource.indexOf('frontend-inventory.mjs verify'));
  assert.match(workflowSource, /VITE_FINALIZE_INTENT_REQUIRED_FOR_PI: '1'/);
  assert.match(workflowSource, /inputs\.commit == github\.sha/);
  assert.match(workflowSource, /ref: 9baa749f76afd88f1fe3122414ce9c8ef8217f45/);
  assert.match(workflowSource, /ref: 12f98be265630bb902221d44dec4ced93fec93aa/);
  assert.match(workflowSource, /git -C source rev-parse HEAD/);
  assert.match(workflowSource, /git -C trusted rev-parse HEAD/);
  assert.match(workflowSource, /production-rollback-9baa749f76afd88f1fe3122414ce9c8ef8217f45-/);
});
