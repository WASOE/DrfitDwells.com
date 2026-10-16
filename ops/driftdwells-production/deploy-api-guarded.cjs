#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

// Read by the API process itself at startup (server.js post-connect runtime).
const API_RUNTIME_FLAGS = [
  'OPS_ICAL_SYNC_SCHEDULER_ENABLED', 'MESSAGE_SCHEDULER_WORKER_ENABLED',
  'MESSAGE_DISPATCHER_ENABLED', 'OPS_PUSH_SCHEDULER_WORKER_ENABLED',
  'SMTP_HEALTH_SCHEDULER_ENABLED'
];
// Consumed only by the dedicated worker scripts; the shared .env enables them for those workers.
const DEDICATED_WORKER_FLAGS = [
  'BOOKING_CONFIRMATION_DELIVERY_WORKER_ENABLED', 'ACCOMMODATION_CHECKOUT_HOLD_EXPIRY_EXECUTE',
  'SPLIT_PAYMENT_COLLECTION_WORKER_ENABLED', 'FINALIZE_JOB_EXECUTE'
];
const DISABLED_API_FLAGS = [...API_RUNTIME_FLAGS, ...DEDICATED_WORKER_FLAGS];
const DEDICATED_WORKER_START =
  /\b(?:start|run)(?:SplitPaymentCollection|BookingConfirmationDelivery|CheckoutFinalization|AccommodationCheckoutHoldExpiry)\w*\s*\(/;
const fail = message => { throw new Error(message); };
const pm2 = args => execFileSync('pm2', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const getApps = () => JSON.parse(pm2(['jlist']));
const isApi = app => /\/server\.js$/.test(app.pm2_env.pm_exec_path || '');
const isWorker = app => app.name.startsWith('driftdwells') && !isApi(app);

function verifyFiles(root, manifest, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha) || manifest.sha !== expectedSha) fail('Release SHA mismatch');
  if (!manifest.files?.length || !manifest.files.some(file => file.path.startsWith('shared/'))) {
    fail('Incomplete release manifest');
  }
  for (const required of ['server/server.js', 'server/config/database.js', 'server/bootstrap/startApiProcess.js']) {
    if (!manifest.files.some(file => file.path === required)) fail('Startup files missing from manifest');
  }
  const seen = new Set();
  for (const file of manifest.files) {
    if (seen.has(file.path) || file.path.includes('\0') || path.isAbsolute(file.path) ||
        file.path.split('/').some(part => part === '..' || part === '.')) fail('Unsafe manifest path');
    seen.add(file.path);
    const filename = path.resolve(root, file.path);
    if (!filename.startsWith(path.resolve(root) + path.sep)) fail('Release path escapes root');
    if (!fs.lstatSync(filename).isFile() || fs.realpathSync(filename) !== filename) fail('Release file is not isolated');
    const contents = fs.readFileSync(filename);
    const hash = crypto.createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex');
    if (hash !== file.hash) fail(`Release file differs: ${file.path}`);
  }
  for (const filename of ['server/server.js', 'server/bootstrap/startApiProcess.js']) {
    const source = fs.readFileSync(path.join(root, filename), 'utf8');
    if (/\.(?:syncIndexes|createIndexes?|dropIndexes?|ensureIndexes|createCollection)\s*\(/.test(source)) {
      fail('Startup index or collection work detected');
    }
    if (DEDICATED_WORKER_START.test(source)) fail('API entrypoint starts a dedicated worker');
  }
  const database = fs.readFileSync(path.join(root, 'server/config/database.js'), 'utf8');
  for (const key of ['autoIndex', 'autoCreate']) {
    if (!database.includes(`mongoose.set('${key}', false)`) || !database.includes(`${key}: false`)) {
      fail('Automatic database schema work is not disabled');
    }
  }
  return true;
}

function verifyOwnershipRelease(root) {
  const booking = fs.readFileSync(path.join(root, 'server/models/Booking.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'server/services/stayChange/rebookStayChangeService.js'), 'utf8');
  const ownershipStart = service.indexOf('async function assertSourceOperationOwnership(sc) {');
  const ownershipEnd = service.indexOf('\nasync function ', ownershipStart + 1);
  const ownership = ownershipStart >= 0
    ? service.slice(ownershipStart, ownershipEnd < 0 ? undefined : ownershipEnd)
    : '';
  if (!/rebookSourceOwnerId\s*:/.test(booking) ||
      !ownership.includes('async function assertSourceOperationOwnership(sc)') ||
      !service.includes('await assertSourceOperationOwnership(sc);') ||
      !/const acquired = await Booking\.updateOne\(\s*\{\s*_id:\s*sc\.bookingId,\s*rebookSourceOwnerId:\s*null,/.test(ownership) ||
      !ownership.includes('if (!(acquired.matchedCount ?? acquired.n))') ||
      !ownership.includes('Another REBOOK acquired the source') ||
      !ownership.includes('$set: { rebookSourceOwnerId: sc._id }') ||
      !service.includes('assertRebookEnabled();')) {
    fail('REBOOK ownership CAS protocol is not present in candidate');
  }
}

function effectiveMongoUri(root, env) {
  const configuredUri = env.MONGODB_URI || env.MONGO_URI;
  if (configuredUri) return configuredUri;
  return require(path.join(root, 'server/config/dbDefaults')).DEFAULT_MONGO_URI;
}

async function countRebookOwnershipState(root, env) {
  const uri = effectiveMongoUri(root, env);
  const mongoose = require(path.join(root, 'server/node_modules/mongoose'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    return await readRebookOwnershipCounts(mongoose.connection);
  } finally {
    await mongoose.disconnect();
  }
}

async function readRebookOwnershipCounts(connection) {
  const [rebookChanges, sourceOwners] = await Promise.all([
    connection.collection('staychanges').countDocuments({ kind: 'rebook' }),
    connection.collection('bookings').countDocuments({
      rebookSourceOwnerId: { $exists: true, $ne: null }
    })
  ]);
  return { rebookChanges, sourceOwners };
}

function assertRebookEnablementReady(plan, prepared, counts) {
  if (plan.enableRebookOnCutover !== true) return;
  const { current, candidate, rollback } = prepared;
  if (current.sha !== candidate.sha || current.root !== candidate.root) {
    fail('REBOOK enablement may only restart the same ownership release');
  }
  if (current.app.pm2_env.REBOOK_ENABLED !== 'false' ||
      candidate.env.REBOOK_ENABLED !== 'false' ||
      rollback.env.REBOOK_ENABLED !== 'false') {
    fail('Current, candidate and rollback must all be explicitly gate-disabled before enablement');
  }
  verifyOwnershipRelease(candidate.root);
  if (counts.rebookChanges !== 0 || counts.sourceOwners !== 0) {
    fail('Historical REBOOK ownership state requires manual reconciliation before enablement');
  }
}

function rebookGateForStart(role, plan) {
  return role === 'candidate' && plan.enableRebookOnCutover === true ? 'true' : 'false';
}

function validateTopology({ apps, currentId, candidateId, rollbackId, listeners, environments }) {
  const selected = [currentId, candidateId, rollbackId];
  if (new Set(selected).size !== 3 || selected.some(id => !Number.isInteger(id) || id < 0)) {
    fail('Three distinct numeric API IDs are required');
  }
  const apis = apps.filter(isApi);
  if (apis.length !== 3 || apis.some(app => !selected.includes(app.pm2_env.pm_id))) {
    fail('Unexpected or duplicate API process');
  }
  const workers = apps.filter(isWorker);
  if (workers.length !== 5 || workers.some(app => app.pm2_env.status !== 'online') ||
      new Set(workers.map(app => app.pm2_env.pm_exec_path)).size !== 5) fail('Dedicated worker topology differs');
  for (const [id, port] of [[currentId, 5000], [candidateId, 5001], [rollbackId, 5002]]) {
    const app = apis.find(item => item.pm2_env.pm_id === id);
    const env = environments[id];
    if (app?.pm2_env.status !== 'online' || Number(env?.PORT) !== port ||
        env?.NODE_ENV !== 'production') fail('API status, port or environment mismatch');
    const bound = listeners[port];
    if (bound?.length !== 1 || bound[0].pid !== app.pid) fail('Conflicting or unverifiable listener');
    if (port !== 5000 && (env.API_HOST !== '127.0.0.1' || bound[0].host !== '127.0.0.1')) {
      fail('Candidate/rollback probe must be loopback-only');
    }
    // Probes and new production APIs force every flag off. The running API may inherit
    // dedicated-worker flags from the shared .env; verifyFiles proves its entrypoint never starts them.
    for (const flag of port === 5000 ? API_RUNTIME_FLAGS : DISABLED_API_FLAGS) {
      if (!['0', 'false'].includes(String(env[flag] ?? '0').toLowerCase())) fail(`API worker enabled: ${flag}`);
    }
    if (port === 5000 && !/^driftdwells-production-[a-f0-9]+$/.test(app.name)) fail('Production API name is not unique');
  }
  return workers.map(app => ({ id: app.pm2_env.pm_id, pid: app.pid, restarts: app.pm2_env.restart_time }));
}

async function cutover(io, context) {
  // Only numeric IDs are ever stopped/deleted; a new process is started from an
  // exact one-app configuration. Never restart a shared name or all processes.
  const { currentId, candidateId, rollbackId } = context;
  let newId = null;
  let oldStopped = false;
  let verified = false;
  try {
    await io.preflight();
    await io.checkpoint();
    await io.stop(candidateId);
    await io.stop(rollbackId);
    oldStopped = true;
    await io.stop(currentId);
    newId = await io.start('candidate');
    await io.verify(newId, 'candidate');
    await io.monitor(newId);
    await io.checkWorkers();
    verified = true;
    for (const id of [currentId, candidateId, rollbackId]) await io.remove(id);
    await io.save();
    return { productionId: newId, rolledBack: false };
  } catch (err) {
    if (verified) {
      err.message = 'Production verified; PM2 finalization failed; live API left running. ' + err.message;
      throw err;
    }
    if (newId !== null) await io.stop(newId);
    if (oldStopped && !(await io.currentHealthy())) {
      const restoredId = await io.start('rollback');
      await io.verify(restoredId, 'rollback');
      await io.checkWorkers();
      for (const id of [currentId, candidateId, rollbackId, newId].filter(id => id !== null)) {
        await io.remove(id);
      }
      // Never persist stopped conflicting APIs that could reappear on reboot.
      await io.save();
      err.message = 'Cutover failed; verified rollback restored. ' + err.message;
    }
    throw err;
  }
}

function listeners(port) {
  const lines = execFileSync('ss', ['-H', '-ltnp', `sport = :${port}`], { encoding: 'utf8' }).trim();
  if (!lines) return [];
  return lines.split('\n').map(line => {
    const match = line.match(/pid=(\d+)/g) || [];
    if (match.length !== 1) fail('Listener PID not visible or shared');
    return { pid: Number(match[0].slice(4)), host: line.split(/\s+/)[3].replace(/:\d+$/, '') };
  });
}

async function checkHttp(port, token, expectedSha = null) {
  if (!token) fail('Existing authorized Ops token required');
  const checkIn = new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10);
  const checkOut = new Date(Date.now() + 62 * 86400_000).toISOString().slice(0, 10);
  const urls = [
    ['/api/health', body => body.status === 'OK' && body.database === 'connected'],
    ['/api/bookings/config', body => body.success === true],
    ['/api/bookings/checkout-capabilities', body =>
      body.success === true && body.contractVersion === 2 &&
      (!expectedSha || body.applicationRelease === expectedSha)],
    [`/api/availability?checkIn=${checkIn}&checkOut=${checkOut}&adults=2&children=0`,
      body => body.success === true && Array.isArray(body.data?.cabins)],
    ['/api/ops/session', body => body.success === true && body.data?.authenticated === true],
    ['/api/ops/readiness/summary', body => body.success === true && Boolean(body.data?.readinessByModule)]
  ];
  for (const [url, valid] of urls) {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      headers: url.startsWith('/api/ops/') ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok || !valid(await response.json())) fail(`Read-only endpoint gate failed: ${url.split('?')[0]}`);
  }
}

async function startProbe(plan, role) {
  if (!['candidate', 'rollback'].includes(role)) fail('Probe role must be candidate or rollback');
  const item = plan[role];
  const root = fs.realpathSync(item.root);
  if (!root.startsWith('/home/illoc/releases/')) fail('Probe must use an isolated release');
  verifyFiles(root, JSON.parse(fs.readFileSync(item.manifest, 'utf8')), item.sha);
  const apps = getApps();
  const allowed = [plan.current.id, plan.candidate.id, plan.rollback.id].filter(Number.isInteger);
  if (apps.filter(isApi).some(app => !allowed.includes(app.pm2_env.pm_id))) fail('Unexpected API before probe launch');
  const current = apps.find(app => app.pm2_env.pm_id === plan.current.id);
  const live = listeners(5000);
  if (!current || current.pm2_env.status !== 'online' || live.length !== 1 || live[0].pid !== current.pid) {
    fail('Production listener baseline is unsafe');
  }
  if (apps.filter(isWorker).length !== 5 || apps.filter(isWorker).some(app => app.pm2_env.status !== 'online')) {
    fail('Worker baseline is unsafe');
  }
  const port = role === 'candidate' ? 5001 : 5002;
  if (listeners(port).length) fail('Probe port already in use');
  if (!process.env.OPS_VERIFY_TOKEN) fail('Existing authorized Ops token required');
  // This regression exercises mocked startup and legacy records only; it must
  // pass against the exact artifact before any API process is launched.
  execFileSync(process.execPath, ['--test', 'server/scripts/apiStartupNoIndexDdl.test.cjs'], {
    cwd: root, timeout: 30_000, stdio: 'pipe',
    env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/no_connection_expected', MONGO_URI: 'mongodb://127.0.0.1:1/no_connection_expected' }
  });
  const dotenv = require(path.join(root, 'server/node_modules/dotenv'));
  const env = dotenv.parse(fs.readFileSync(path.join(root, 'server/.env')));
  env.PORT = String(port);
  env.API_HOST = '127.0.0.1';
  env.NODE_ENV = 'production';
  env.APP_RELEASE = item.sha;
  for (const flag of DISABLED_API_FLAGS) env[flag] = '0';
  env.REBOOK_ENABLED = 'false';
  const name = `driftdwells-${role}-${item.sha.slice(0, 12)}${Date.now().toString(16)}`;
  const dir = `/home/illoc/.pm2/probe-${role}-${Date.now()}`;
  fs.mkdirSync(dir, { mode: 0o700 });
  const config = path.join(dir, 'probe.config.json');
  fs.writeFileSync(config, JSON.stringify({ apps: [{
    name, script: path.join(root, 'server/server.js'), cwd: path.join(root, 'server'),
    env, instances: 1, exec_mode: 'fork', autorestart: true, kill_timeout: 30000
  }] }), { mode: 0o600 });
  let id = null;
  try {
    const launched = spawnSync('pm2', ['start', config, '--only', name], { encoding: 'utf8' });
    const found = getApps().filter(app => app.name === name);
    if (found.length === 1) id = found[0].pm2_env.pm_id;
    if (launched.status !== 0 || id === null) fail('Probe launch failed');
    for (let retry = 0; retry < 20; retry++) {
      if (listeners(port).length) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const probe = getApps().find(app => app.pm2_env.pm_id === id);
    const bound = listeners(port);
    if (probe.pm2_env.restart_time !== 0 || bound.length !== 1 ||
        bound[0].pid !== probe.pid || bound[0].host !== '127.0.0.1') fail('Probe identity gate failed');
    await checkHttp(port, process.env.OPS_VERIFY_TOKEN, item.sha);
    const after = getApps();
    if (apps.some(app => {
      const now = after.find(value => value.pm2_env.pm_id === app.pm2_env.pm_id);
      return !now || now.pid !== app.pid || now.pm2_env.restart_time !== app.pm2_env.restart_time;
    })) fail('Existing processes changed while probing');
    return { role, id, sha: item.sha, port, cwd: probe.pm2_env.pm_cwd };
  } catch (err) {
    if (id !== null) {
      pm2(['stop', String(id)]);
      pm2(['delete', String(id)]);
    }
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 && !(args.length === 2 && ['--cutover', '--candidate', '--rollback'].includes(args[1]))) {
    fail('Usage: deploy-api-guarded.cjs <protected-plan.json> [--candidate|--rollback|--cutover]');
  }
  const planPath = path.resolve(args[0]);
  if (fs.statSync(planPath).mode & 0o077) fail('Deployment plan must be private (0600)');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (plan.enableRebookOnCutover !== undefined && typeof plan.enableRebookOnCutover !== 'boolean') {
    fail('enableRebookOnCutover must be a boolean');
  }
  if (['--candidate', '--rollback'].includes(args[1])) {
    console.log(JSON.stringify({ status: 'probe_verified', ...await startProbe(plan, args[1].slice(2)) }));
    return;
  }
  const context = { currentId: plan.current.id, candidateId: plan.candidate.id, rollbackId: plan.rollback.id };
  const initialApps = getApps();
  const prepared = {};
  for (const role of ['current', 'candidate', 'rollback']) {
    const item = plan[role];
    const root = fs.realpathSync(item.root);
    if (!root.startsWith('/home/illoc/releases/')) fail('Release is outside isolated releases');
    const manifest = JSON.parse(fs.readFileSync(item.manifest, 'utf8'));
    verifyFiles(root, manifest, item.sha);
    const app = initialApps.find(value => value.pm2_env.pm_id === item.id);
    if (!app || app.pm2_env.pm_cwd !== path.join(root, 'server') ||
        app.pm2_env.pm_exec_path !== path.join(root, 'server/server.js') ||
        fs.realpathSync(`/proc/${app.pid}/cwd`) !== path.join(root, 'server')) fail('Release cwd/script mismatch');
    const dotenv = require(path.join(root, 'server/node_modules/dotenv'));
    const env = dotenv.parse(fs.readFileSync(path.join(root, 'server/.env')));
    for (const [key, value] of Object.entries(app.pm2_env)) {
      if (/^[A-Z][A-Z0-9_]*$/.test(key) && typeof value === 'string' && value.trim()) env[key] = value;
    }
    prepared[role] = { root, app, env, sha: item.sha };
  }
  let baseline;
  const preflight = async () => {
    if (plan.enableRebookOnCutover) {
      const counts = await countRebookOwnershipState(prepared.candidate.root, prepared.candidate.env);
      assertRebookEnablementReady(plan, prepared, counts);
    }
    const environments = Object.fromEntries(Object.values(prepared).map(item => [item.app.pm2_env.pm_id, item.env]));
    baseline = validateTopology({
      ...context, apps: getApps(), environments,
      listeners: Object.fromEntries([5000, 5001, 5002].map(port => [port, listeners(port)]))
    });
    for (const port of [5000, 5001, 5002]) await checkHttp(port, process.env.OPS_VERIFY_TOKEN);
  };
  await preflight();
  if (!args.includes('--cutover')) {
    console.log(JSON.stringify({ status: 'preflight_passed', dryRun: true, ...context, candidateSha: plan.candidate.sha }));
    return;
  }
  const checkpoint = `/home/illoc/.pm2/deploy-${Date.now()}`;
  const checkWorkers = async () => {
    const apps = getApps();
    const workers = apps.filter(isWorker).map(app => ({
      id: app.pm2_env.pm_id, pid: app.pid, restarts: app.pm2_env.restart_time
    }));
    if (JSON.stringify(workers) !== JSON.stringify(baseline)) fail('Worker preservation gate failed');
  };
  const io = {
    preflight,
    checkpoint: async () => {
      fs.mkdirSync(checkpoint, { mode: 0o700 });
      fs.writeFileSync(path.join(checkpoint, 'pm2-before.json'), JSON.stringify(getApps()), { mode: 0o600 });
      fs.copyFileSync(planPath, path.join(checkpoint, 'plan.json'));
      fs.chmodSync(path.join(checkpoint, 'plan.json'), 0o600);
      for (const role of ['current', 'candidate', 'rollback']) {
        fs.copyFileSync(path.join(prepared[role].root, 'server/.env'), path.join(checkpoint, `${role}.env`));
        fs.chmodSync(path.join(checkpoint, `${role}.env`), 0o600);
      }
    },
    stop: async id => { pm2(['stop', String(id)]); },
    remove: async id => { pm2(['delete', String(id)]); },
    start: async role => {
      const item = prepared[role];
      if (listeners(5000).length) fail('Production port is not free before API start');
      const name = `driftdwells-production-${item.sha.slice(0, 12)}${Date.now().toString(16)}`;
      if (getApps().some(app => app.name === name)) fail('Production name already exists');
      const env = { ...item.env, PORT: '5000', API_HOST: '0.0.0.0', APP_RELEASE: item.sha };
      for (const flag of DISABLED_API_FLAGS) env[flag] = '0';
      env.REBOOK_ENABLED = rebookGateForStart(role, plan);
      const config = path.join(checkpoint, `${role}.config.json`);
      fs.writeFileSync(config, JSON.stringify({ apps: [{
        name, script: path.join(item.root, 'server/server.js'), cwd: path.join(item.root, 'server'),
        env, instances: 1, exec_mode: 'fork', autorestart: true, kill_timeout: 30000
      }] }), { mode: 0o600 });
      const start = spawnSync('pm2', ['start', config, '--only', name], { encoding: 'utf8' });
      const created = getApps().filter(app => app.name === name);
      if (start.status !== 0) {
        for (const app of created) pm2(['stop', String(app.pm2_env.pm_id)]);
        fail('PM2 start failed; any newly created process was stopped');
      }
      if (created.length !== 1) fail('New API process identity is ambiguous');
      return created[0].pm2_env.pm_id;
    },
    verify: async (id, role) => {
      for (let retry = 0; retry < 20; retry++) {
        if (listeners(5000).length) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const app = getApps().find(item => item.pm2_env.pm_id === id);
      const bound = listeners(5000);
      if (!app || app.pm2_env.status !== 'online' || app.pm2_env.restart_time !== 0 ||
          bound.length !== 1 || bound[0].pid !== app.pid ||
          fs.realpathSync(`/proc/${app.pid}/cwd`) !== path.join(prepared[role].root, 'server') ||
          app.pm2_env.APP_RELEASE !== prepared[role].sha) fail('Post-cutover identity/listener gate failed');
      const expectedGate = rebookGateForStart(role, plan);
      if (app.pm2_env.REBOOK_ENABLED !== expectedGate) {
        fail('Post-cutover REBOOK gate state mismatch');
      }
      if (fs.statSync(app.pm2_env.pm_err_log_path).size > 1024 * 1024) fail('New API error log exceeded 1 MiB');
      const errorLog = fs.readFileSync(app.pm2_env.pm_err_log_path, 'utf8');
      if (/EADDRINUSE|uncaughtException|unhandledRejection|MongoServerError|FATAL/i.test(errorLog)) {
        fail('New API has a critical startup/runtime error');
      }
      await checkHttp(5000, process.env.OPS_VERIFY_TOKEN, prepared[role].sha);
    },
    monitor: async id => {
      for (let i = 0; i < 12; i++) {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        await io.verify(id, 'candidate');
      }
    },
    checkWorkers,
    currentHealthy: async () => {
      const current = getApps().find(app => app.pm2_env.pm_id === context.currentId);
      const bound = listeners(5000);
      if (!current || current.pm2_env.status !== 'online' || bound.length !== 1 || bound[0].pid !== current.pid) return false;
      try {
        await checkHttp(5000, process.env.OPS_VERIFY_TOKEN);
        return true;
      } catch {
        return false;
      }
    },
    save: async () => {
      pm2(['save']);
      fs.chmodSync('/home/illoc/.pm2/dump.pm2', 0o600);
    }
  };
  const result = await cutover(io, context);
  console.log(JSON.stringify({ status: 'verified', ...result, sha: plan.candidate.sha, checkpoint }));
}

if (require.main === module) {
  main().catch(err => {
    console.error(JSON.stringify({ status: 'blocked', reason: err.message }));
    process.exitCode = 1;
  });
}
module.exports = {
  API_RUNTIME_FLAGS,
  DEDICATED_WORKER_FLAGS,
  DISABLED_API_FLAGS,
  verifyFiles,
  verifyOwnershipRelease,
  countRebookOwnershipState,
  effectiveMongoUri,
  readRebookOwnershipCounts,
  assertRebookEnablementReady,
  rebookGateForStart,
  validateTopology,
  cutover,
  checkHttp
};
