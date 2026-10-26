'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  API_RUNTIME_FLAGS,
  DEDICATED_WORKER_FLAGS,
  DISABLED_API_FLAGS,
  validateTopology,
  verifyFiles,
  verifyOwnershipRelease,
  effectiveMongoUri,
  assertRebookEnablementReady,
  rebookGateForStart,
  readRebookOwnershipCounts,
  cutover,
  checkHttp,
  linkSharedUploads
} = require('./deploy-api-guarded.cjs');

function fixture() {
  const apps = [31, 40, 41].map((id, index) => ({
    name: `driftdwells-${index ? 'probe' : 'production'}-abcdef`,
    pid: id + 1000,
    pm2_env: { pm_id: id, pm_exec_path: '/release/server/server.js', status: 'online' }
  }));
  for (let id = 1; id <= 5; id++) apps.push({
    name: `driftdwells-worker-${id}`, pid: id + 100,
    pm2_env: { pm_id: id, pm_exec_path: `/release/server/worker${id}.js`, status: 'online', restart_time: 0 }
  });
  return {
    apps, currentId: 31, candidateId: 40, rollbackId: 41,
    listeners: Object.fromEntries([5000, 5001, 5002].map((port, i) =>
      [port, [{ pid: apps[i].pid, host: i ? '127.0.0.1' : '0.0.0.0' }]])),
    environments: Object.fromEntries([31, 40, 41].map((id, i) =>
      [id, { PORT: String(5000 + i), NODE_ENV: 'production', API_HOST: i ? '127.0.0.1' : '0.0.0.0' }]))
  };
}
test('valid isolated probes preserve the five dedicated workers', () => {
  assert.equal(validateTopology(fixture()).length, 5);
});

test('REBOOK enablement is explicit and only applies to the verified candidate start', () => {
  assert.equal(rebookGateForStart('candidate', {}), 'false');
  assert.equal(rebookGateForStart('rollback', { enableRebookOnCutover: true }), 'false');
  assert.equal(rebookGateForStart('candidate', { enableRebookOnCutover: true }), 'true');
});

test('REBOOK enablement requires the exact same ownership release and a closed rollback', () => {
  const root = path.resolve(__dirname, '../..');
  verifyOwnershipRelease(root);
  const app = { pm2_env: { REBOOK_ENABLED: 'false' } };
  const prepared = {
    current: { sha: 'a'.repeat(40), root, app },
    candidate: { sha: 'a'.repeat(40), root, env: { REBOOK_ENABLED: 'false' } },
    rollback: { sha: 'b'.repeat(40), root: `${root}-rollback`, env: { REBOOK_ENABLED: 'false' } }
  };
  const plan = { enableRebookOnCutover: true };
  assert.doesNotThrow(() => assertRebookEnablementReady(plan, prepared, {
    rebookChanges: 0, sourceOwners: 0
  }));
  for (const counts of [
    { rebookChanges: 1, sourceOwners: 0 },
    { rebookChanges: 0, sourceOwners: 1 }
  ]) {
    assert.throws(() => assertRebookEnablementReady(plan, prepared, counts), /manual reconciliation/);
  }
  assert.throws(() => assertRebookEnablementReady(plan, {
    ...prepared, candidate: { ...prepared.candidate, sha: 'c'.repeat(40) }
  }, { rebookChanges: 0, sourceOwners: 0 }), /same ownership release/);
  assert.throws(() => assertRebookEnablementReady(plan, {
    ...prepared, current: { ...prepared.current, app: { pm2_env: { REBOOK_ENABLED: 'true' } } }
  }, { rebookChanges: 0, sourceOwners: 0 }), /explicitly gate-disabled/);
  assert.throws(() => assertRebookEnablementReady(plan, {
    ...prepared, rollback: { ...prepared.rollback, env: { REBOOK_ENABLED: 'true' } }
  }, { rebookChanges: 0, sourceOwners: 0 }), /explicitly gate-disabled/);
});

test('REBOOK history verification uses the effective API Mongo configuration', () => {
  const root = path.resolve(__dirname, '../..');
  assert.equal(effectiveMongoUri(root, {
    MONGODB_URI: 'mongodb://effective-host/production'
  }), 'mongodb://effective-host/production');
  assert.equal(effectiveMongoUri(root, {
    MONGO_URI: 'mongodb://alias-host/production'
  }), 'mongodb://alias-host/production');
  assert.equal(effectiveMongoUri(root, {}), 'mongodb://127.0.0.1:27017/drift-dwells-booking');
});

test('REBOOK enablement history check is read-only and counts legacy operations and source fences', async () => {
  const calls = [];
  const connection = {
    collection(name) {
      return {
        countDocuments: async filter => {
          calls.push([name, filter]);
          return name === 'staychanges' ? 0 : 0;
        }
      };
    }
  };
  assert.deepEqual(await readRebookOwnershipCounts(connection), { rebookChanges: 0, sourceOwners: 0 });
  assert.deepEqual(calls, [
    ['staychanges', { kind: 'rebook' }],
    ['bookings', { rebookSourceOwnerId: { $exists: true, $ne: null } }]
  ]);
});
const unsafe = {
  duplicateAPI: f => f.apps.push({ ...f.apps[0], name: 'driftdwells-extra' }),
  duplicateListener: f => f.listeners[5000].push({ pid: 9000, host: '0.0.0.0' }),
  wrongListener: f => { f.listeners[5001][0].pid = 9999; },
  publicCandidate: f => { f.listeners[5001][0].host = '0.0.0.0'; },
  sharedName: f => { f.apps[0].name = 'driftdwells'; },
  stoppedWorker: f => { f.apps[3].pm2_env.status = 'stopped'; },
  duplicateWorker: f => { f.apps[3].pm2_env.pm_exec_path = f.apps[4].pm2_env.pm_exec_path; },
  duplicateIDs: f => { f.rollbackId = f.candidateId; },
  wrongPort: f => { f.environments[40].PORT = '5000'; }
};
for (const [name, corrupt] of Object.entries(unsafe)) {
  test(`deployment refuses ${name}`, () => {
    const f = fixture();
    corrupt(f);
    assert.throws(() => validateTopology(f));
  });
}
for (const flag of DISABLED_API_FLAGS) {
  test(`deployment refuses API runtime ${flag}`, () => {
    const f = fixture();
    f.environments[40][flag] = '1';
    assert.throws(() => validateTopology(f), /API worker enabled/);
  });
}
for (const flag of API_RUNTIME_FLAGS) {
  test(`deployment refuses live API runtime ${flag}`, () => {
    const f = fixture();
    f.environments[31][flag] = 'true';
    assert.throws(() => validateTopology(f), /API worker enabled/);
  });
}
test('live API may inherit dedicated-worker flags from the shared .env; probes may not', () => {
  for (const flag of DEDICATED_WORKER_FLAGS) {
    const live = fixture();
    live.environments[31][flag] = 'true';
    assert.equal(validateTopology(live).length, 5);
    for (const probeId of [40, 41]) {
      const probe = fixture();
      probe.environments[probeId][flag] = 'true';
      assert.throws(() => validateTopology(probe), /API worker enabled/);
    }
  }
});

function fakeIO(failure = null) {
  const calls = [];
  let serial = 50;
  const op = name => async (...args) => {
    calls.push([name, ...args]);
    if (name === failure) {
      failure = null;
      throw Error(`failed:${name}`);
    }
    if (name === 'start') return serial++;
    if (name === 'currentHealthy') return false;
  };
  const io = Object.fromEntries(
    ['preflight', 'checkpoint', 'stop', 'start', 'verify', 'monitor', 'checkWorkers', 'remove', 'save', 'currentHealthy']
      .map(name => [name, op(name)]));
  return { io, calls };
}
const context = { currentId: 31, candidateId: 40, rollbackId: 41 };
test('successful cutover saves only after endpoint, stability and worker gates', async () => {
  const { io, calls } = fakeIO();
  const outcome = await cutover(io, context);
  assert.equal(outcome.productionId, 50);
  assert.deepEqual(calls.map(call => call[0]), [
    'preflight', 'checkpoint', 'stop', 'stop', 'stop', 'start', 'verify',
    'monitor', 'checkWorkers', 'remove', 'remove', 'remove', 'save'
  ]);
  assert.deepEqual(calls.filter(call => call[0] === 'stop').map(call => call[1]), [40, 41, 31]);
});
for (const failure of ['preflight', 'checkpoint']) {
  test(`${failure} failure cannot stop production or save`, async () => {
    const { io, calls } = fakeIO(failure);
    await assert.rejects(cutover(io, context));
    assert.ok(!calls.some(call => ['stop', 'start', 'save'].includes(call[0])));
  });
}
for (const failure of ['start', 'verify', 'monitor', 'checkWorkers']) {
  test(`${failure} failure restores verified independent rollback before saving`, async () => {
    const { io, calls } = fakeIO(failure);
    await assert.rejects(cutover(io, context), /verified rollback restored/);
    const restore = calls.findIndex(call => call[0] === 'start' && call[1] === 'rollback');
    assert.ok(restore >= 0);
    const completed = calls.slice(restore).map(call => call[0]);
    assert.deepEqual(completed.slice(0, 3), ['start', 'verify', 'checkWorkers']);
    assert.equal(completed.at(-1), 'save');
    assert.ok(completed.slice(3, -1).every(name => name === 'remove'));
  });
}
for (const failure of ['remove', 'save']) {
  test(`${failure} error after successful verification leaves healthy new production running`, async () => {
    const { io, calls } = fakeIO(failure);
    await assert.rejects(cutover(io, context), /live API left running/);
    assert.ok(!calls.some(call => call[0] === 'start' && call[1] === 'rollback'));
    assert.ok(!calls.some(call => call[0] === 'stop' && call[1] === 50));
  });
}
test('failed rollback verification must never save', async () => {
  const { io, calls } = fakeIO('monitor');
  io.verify = async (id, role) => {
    calls.push(['verify', id, role]);
    if (role === 'rollback') throw Error('rollback failed');
  };
  await assert.rejects(cutover(io, context), /rollback failed/);
  assert.ok(!calls.some(call => call[0] === 'save'));
});
test('stop error leaves a healthy original API alone', async () => {
  const { io, calls } = fakeIO();
  io.stop = async id => { calls.push(['stop', id]); if (id === 31) throw Error('stop failed'); };
  io.currentHealthy = async () => true;
  await assert.rejects(cutover(io, context), /stop failed/);
  assert.ok(!calls.some(call => ['start', 'save'].includes(call[0])));
});
test('stop error after original API actually stops still attempts rollback', async () => {
  const { io, calls } = fakeIO();
  io.stop = async id => { calls.push(['stop', id]); if (id === 31) throw Error('stop response failed'); };
  await assert.rejects(cutover(io, context), /verified rollback restored/);
  assert.ok(calls.some(call => call[0] === 'start' && call[1] === 'rollback'));
});
test('release verification rejects modified content, wrong SHA, missing shared and path traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-release-'));
  const source = {
    'server/server.js': 'startApiProcess();',
    'server/bootstrap/startApiProcess.js': 'module.exports = {};',
    'server/config/database.js': "mongoose.set('autoIndex', false); mongoose.set('autoCreate', false); ({autoIndex: false, autoCreate: false});",
    'shared/runtime.js': 'module.exports = true;'
  };
  const sha = 'a'.repeat(40);
  const files = [];
  try {
    for (const [filename, text] of Object.entries(source)) {
      fs.mkdirSync(path.dirname(path.join(dir, filename)), { recursive: true });
      fs.writeFileSync(path.join(dir, filename), text);
      files.push({ path: filename, hash: crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex') });
    }
    assert.equal(verifyFiles(dir, { sha, files }, sha), true);
    assert.throws(() => verifyFiles(dir, { sha, files }, 'b'.repeat(40)), /SHA mismatch/);
    assert.throws(() => verifyFiles(dir, { sha, files: files.slice(0, -1) }, sha), /Incomplete/);
    assert.throws(() => verifyFiles(dir, { sha, files: [...files, { path: '../escape' }] }, sha), /Unsafe/);
    fs.appendFileSync(path.join(dir, 'shared/runtime.js'), 'changed');
    assert.throws(() => verifyFiles(dir, { sha, files }, sha), /differs/);
    fs.writeFileSync(path.join(dir, 'shared/runtime.js'), source['shared/runtime.js']);
    const ddl = 'Review.syncIndexes();';
    fs.writeFileSync(path.join(dir, 'server/server.js'), ddl);
    const ddlFiles = files.map(file => file.path !== 'server/server.js' ? file : {
      ...file, hash: crypto.createHash('sha1').update(`blob ${ddl.length}\0${ddl}`).digest('hex')
    });
    assert.throws(() => verifyFiles(dir, { sha, files: ddlFiles }, sha), /Startup index/);
    for (const call of ['startSplitPaymentCollectionWorker();', 'startBookingConfirmationDeliveryWorkerIfEnabled();',
      'startCheckoutFinalizationWorker();', 'runAccommodationCheckoutHoldExpirySweep();']) {
      fs.writeFileSync(path.join(dir, 'server/server.js'), call);
      const workerFiles = files.map(file => file.path !== 'server/server.js' ? file : {
        ...file, hash: crypto.createHash('sha1').update(`blob ${call.length}\0${call}`).digest('hex')
      });
      assert.throws(() => verifyFiles(dir, { sha, files: workerFiles }, sha), /dedicated worker/);
    }
  } finally {
    for (const filename of Object.keys(source)) fs.unlinkSync(path.join(dir, filename));
    for (const filename of ['server/bootstrap', 'server/config', 'server', 'shared']) fs.rmdirSync(path.join(dir, filename));
    fs.rmdirSync(dir);
  }
});
test('probe startup runs index safety regression before launching any PM2 API', () => {
  const source = fs.readFileSync(path.join(__dirname, 'deploy-api-guarded.cjs'), 'utf8');
  const probe = source.slice(source.indexOf('async function startProbe'), source.indexOf('async function main'));
  assert.ok(probe.indexOf("['--test', 'server/scripts/apiStartupNoIndexDdl.test.cjs']") <
    probe.indexOf("spawnSync('pm2'"));
  assert.ok(probe.includes("env.API_HOST = '127.0.0.1'"));
  assert.ok(probe.includes("for (const flag of DISABLED_API_FLAGS) env[flag] = '0'"));
  assert.doesNotMatch(source, /pm2\(\['(?:restart|reload)'/);
});
test('HTTP gates are GET-only, validate DB health and require existing Ops auth', async () => {
  const original = global.fetch;
  const seen = [];
  global.fetch = async (url, options) => {
    assert.equal(options.method, undefined);
    seen.push(url);
    let body = { success: true };
    if (url.includes('/api/health')) body = { status: 'OK', database: 'connected' };
    if (url.includes('checkout-capabilities')) body = { success: true, contractVersion: 2, applicationRelease: 'a'.repeat(40) };
    if (url.includes('/api/availability')) body.data = { cabins: [] };
    if (url.includes('/api/ops/session')) body.data = { authenticated: true };
    if (url.includes('/api/ops/readiness/summary')) body.data = { readinessByModule: {} };
    return { ok: true, json: async () => body };
  };
  try {
    await assert.rejects(checkHttp(5001, null), /authorized Ops token/);
    await checkHttp(5001, 'test-token', 'a'.repeat(40));
    assert.equal(seen.length, 6);
    assert.ok(seen.every(url => !url.includes('/quote')));
    await assert.rejects(checkHttp(5001, 'test-token', 'b'.repeat(40)), /endpoint gate/);
  } finally {
    global.fetch = original;
  }
});

test('deploy links a fresh release and a rollback to the same uploads store', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-uploads-'));
  const shared = path.join(root, 'shared');
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, 'existing.jpg'), 'KEEP');
  const fresh = path.join(root, 'fresh');
  const rollback = path.join(root, 'rollback');
  fs.mkdirSync(path.join(fresh, 'server'), { recursive: true });
  fs.mkdirSync(path.join(rollback, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(rollback, 'uploads', 'existing.jpg'), 'KEEP');
  fs.writeFileSync(path.join(rollback, 'uploads', 'rollback-only.jpg'), 'ROLLBACK');
  const reports = linkSharedUploads([rollback, fresh], shared);
  assert.equal(reports.length, 2);
  assert.equal(fs.realpathSync(path.join(fresh, 'uploads')), fs.realpathSync(shared));
  assert.equal(fs.realpathSync(path.join(rollback, 'uploads')), fs.realpathSync(shared));
  assert.equal(fs.readFileSync(path.join(fresh, 'uploads', 'existing.jpg'), 'utf8'), 'KEEP');
  assert.equal(fs.readFileSync(path.join(shared, 'rollback-only.jpg'), 'utf8'), 'ROLLBACK');
  fs.writeFileSync(path.join(fresh, 'uploads', 'later.jpg'), 'LATER');
  assert.equal(fs.readFileSync(path.join(rollback, 'uploads', 'later.jpg'), 'utf8'), 'LATER');
});
