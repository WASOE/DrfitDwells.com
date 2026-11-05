'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  API_PRODUCTION_FLAGS,
  WORKER_PRODUCTION_FLAGS,
  CRITICAL_RELEASE_FILES,
  missingCriticalFiles,
  apiArrivalErrors,
  workerArrivalErrors,
  workerRuntimeHealthErrors,
  observeArrivalRuntimeHealth,
  arrivalQueueFilters,
  readArrivalQueueCounts,
  committedProductionErrors
} = require('./arrivalEmailGuard.cjs');

const repoRoot = path.resolve(__dirname, '../..');
const now = Date.parse('2026-11-05T06:00:00Z');

function guestWorker(overrides = {}) {
  return {
    status: 'online',
    ...WORKER_PRODUCTION_FLAGS,
    ...overrides
  };
}

test('committed production defaults keep guest-wide arrival enabled', () => {
  const ecosystem = require(path.join(repoRoot, 'ecosystem.config.cjs'));
  assert.deepEqual(committedProductionErrors(ecosystem), []);
  const app = ecosystem.apps.find((item) => item.name === 'driftdwells-arrival-automation-worker');
  assert.equal(app.env.ARRIVAL_EMAIL_V2, '0');
  assert.equal(app.env_production.ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS, '1');
  assert.equal(app.env_production.MESSAGE_DISPATCHER_ENABLED, '0');
  assert.equal(app.env_production.MESSAGE_ORCHESTRATOR_ENABLED, '0');
  assert.equal(Object.hasOwn(app.env_production, 'ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST'), false);
});

test('production defaults that park the worker or limit it to staff are refused', () => {
  const parked = committedProductionErrors({
    apps: [{
      name: 'driftdwells-arrival-automation-worker',
      env_production: {
        ...WORKER_PRODUCTION_FLAGS,
        ARRIVAL_EMAIL_V2: '0',
        ARRIVAL_AUTOMATION_V2: '0',
        MESSAGE_SCHEDULER_WORKER_ENABLED: '0'
      }
    }]
  });
  assert.match(parked.join(' '), /parked/);

  const staff = workerArrivalErrors(guestWorker({
    ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST: 'jose@driftdwells.com'
  }));
  assert.match(staff.join(' '), /staff-scoped/);
});

test('PM2 online does not hide a parked worker', () => {
  const parked = workerArrivalErrors({
    status: 'online',
    ARRIVAL_EMAIL_V2: '0',
    ARRIVAL_AUTOMATION_V2: '0',
    ARRIVAL_AUTOMATION_WORKER_MODE: '1',
    MESSAGE_SCHEDULER_WORKER_ENABLED: '0',
    MESSAGE_DISPATCHER_ENABLED: '0',
    MESSAGE_ORCHESTRATOR_ENABLED: '0',
    ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS: '1'
  });
  assert.match(parked.join(' '), /parked while PM2 can still report online/);
});

function observedHealth(overrides = {}) {
  return {
    running: true,
    dueCount: 0,
    overdueCount: 0,
    failedCount: 0,
    lastTickAt: new Date(now - 60_000).toISOString(),
    lastTickError: null,
    now,
    ...overrides
  };
}

test('missing scheduler evidence is not treated as an idle queue', () => {
  const idle = workerRuntimeHealthErrors(observedHealth(), now);
  assert.deepEqual(idle, []);

  const missing = workerRuntimeHealthErrors(undefined, now);
  assert.match(missing.join(' '), /missing data is not zero/);

  const impliedZero = workerRuntimeHealthErrors({
    running: true,
    lastTickAt: new Date(now - 60_000).toISOString(),
    lastTickError: null,
    now
  }, now);
  assert.match(impliedZero.join(' '), /missing dueCount/);
  assert.match(impliedZero.join(' '), /missing overdueCount/);
  assert.match(impliedZero.join(' '), /missing failedCount/);

  const stalled = workerRuntimeHealthErrors(observedHealth({
    lastTickAt: '2026-11-05T05:00:00Z'
  }), now);
  assert.match(stalled.join(' '), /not ticking/);
});

test('observed due, overdue, and failed jobs block a worker that is still online', () => {
  const overdue = workerRuntimeHealthErrors(observedHealth({
    dueCount: 3,
    overdueCount: 3
  }), now);
  assert.match(overdue.join(' '), /Overdue arrival jobs/);

  const failed = workerRuntimeHealthErrors(observedHealth({ failedCount: 1 }), now);
  assert.match(failed.join(' '), /Arrival jobs have failed/);

  const tickFailed = workerRuntimeHealthErrors(observedHealth({
    lastTickError: 'claim failed'
  }), now);
  assert.match(tickFailed.join(' '), /tick failed/);

  const healthyDue = workerRuntimeHealthErrors(observedHealth({ dueCount: 1 }), now);
  assert.deepEqual(healthyDue, []);
});

test('health logs and queue counts are the only runtime evidence', async () => {
  const filters = arrivalQueueFilters(now);
  assert.equal(filters.due.status, 'scheduled');
  assert.equal(filters.failed.status, 'failed');
  assert.ok(filters.overdue.scheduledFor.$lte < filters.due.scheduledFor.$lte);

  const calls = [];
  const connection = {
    collection(name) {
      return {
        countDocuments: async filter => {
          calls.push([name, filter.status]);
          if (filter.status === 'failed') return 0;
          return 0;
        }
      };
    }
  };
  assert.deepEqual(await readArrivalQueueCounts(connection, now), {
    dueCount: 0,
    overdueCount: 0,
    failedCount: 0
  });
  assert.deepEqual(calls.map(call => call[0]), [
    'scheduledmessagejobs',
    'scheduledmessagejobs',
    'scheduledmessagejobs'
  ]);
  const blank = { collection() { return { countDocuments: async () => undefined }; } };
  await assert.rejects(readArrivalQueueCounts(blank, now), /not observed/);

  const line = (tick) => JSON.stringify({
    source: 'arrival-automation-worker',
    phase: 'health',
    running: true,
    lastTickAt: tick,
    lastTickError: null
  });
  const logText = [
    'parked process stayed online',
    line('2026-11-05T04:00:00.000Z'),
    line(new Date(now - 30_000).toISOString())
  ].join('\n');
  const observed = observeArrivalRuntimeHealth({
    logText,
    counts: { dueCount: 0, overdueCount: 0, failedCount: 0 },
    now
  });
  assert.equal(observed.lastTickAt, new Date(now - 30_000).toISOString());
  assert.deepEqual(workerRuntimeHealthErrors(observed, now), []);

  const noTick = observeArrivalRuntimeHealth({
    logText: 'pm2 online\n',
    counts: { dueCount: 0, overdueCount: 0, failedCount: 0 },
    now
  });
  assert.match(workerRuntimeHealthErrors(noTick, now).join(' '), /no tick evidence/);

  const noCounts = observeArrivalRuntimeHealth({ logText, now });
  assert.match(workerRuntimeHealthErrors(noCounts, now).join(' '), /missing dueCount/);
});

test('API scheduling stays on and legacy workers stay off', () => {
  assert.deepEqual(apiArrivalErrors(API_PRODUCTION_FLAGS), []);
  assert.match(apiArrivalErrors({
    ...API_PRODUCTION_FLAGS,
    ARRIVAL_AUTOMATION_V2: '0'
  }).join(' '), /ARRIVAL_AUTOMATION_V2/);
  assert.match(apiArrivalErrors({
    ...API_PRODUCTION_FLAGS,
    MESSAGE_SCHEDULER_WORKER_ENABLED: '1'
  }).join(' '), /MESSAGE_SCHEDULER_WORKER_ENABLED/);
  assert.match(apiArrivalErrors({
    ...API_PRODUCTION_FLAGS,
    MESSAGE_DISPATCHER_ENABLED: '1'
  }).join(' '), /MESSAGE_DISPATCHER_ENABLED/);
  assert.match(workerArrivalErrors(guestWorker({
    MESSAGE_ORCHESTRATOR_ENABLED: '1'
  })).join(' '), /MESSAGE_ORCHESTRATOR_ENABLED/);
});

test('a release that drops arrival, booking, or payment files is refused', () => {
  assert.deepEqual(missingCriticalFiles(CRITICAL_RELEASE_FILES), []);
  for (const file of CRITICAL_RELEASE_FILES) {
    assert.equal(fs.existsSync(path.join(repoRoot, file)), true, file);
  }
  const deleted = CRITICAL_RELEASE_FILES.filter((file) => ![
    'server/scripts/runArrivalAutomationWorker.js',
    'ops/driftdwells-production/deploy-api-guarded.cjs',
    'server/config/stripeApiVersion.js',
    'server/routes/bookingRoutes.js'
  ].includes(file));
  const missing = missingCriticalFiles(deleted);
  assert.ok(missing.includes('server/scripts/runArrivalAutomationWorker.js'));
  assert.ok(missing.includes('ops/driftdwells-production/deploy-api-guarded.cjs'));
  assert.ok(missing.includes('server/config/stripeApiVersion.js'));
  assert.ok(missing.includes('server/routes/bookingRoutes.js'));
});
