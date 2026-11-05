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
  }), { status: 'online', dueCount: 0, overdueCount: 0, now });
  assert.match(staff.join(' '), /staff-scoped/);
});

test('PM2 online does not hide a parked worker, and an idle queue does not require a tick', () => {
  const parked = workerArrivalErrors({
    status: 'online',
    ARRIVAL_EMAIL_V2: '0',
    ARRIVAL_AUTOMATION_V2: '0',
    ARRIVAL_AUTOMATION_WORKER_MODE: '1',
    MESSAGE_SCHEDULER_WORKER_ENABLED: '0',
    MESSAGE_DISPATCHER_ENABLED: '0',
    MESSAGE_ORCHESTRATOR_ENABLED: '0',
    ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS: '1'
  }, { status: 'online', dueCount: 0, overdueCount: 0, now });
  assert.match(parked.join(' '), /parked while PM2 can still report online/);

  const idle = workerArrivalErrors(guestWorker(), {
    status: 'online',
    dueCount: 0,
    overdueCount: 0,
    now
  });
  assert.deepEqual(idle, []);
});

test('due or overdue guest jobs require a fresh scheduler tick', () => {
  const stale = workerArrivalErrors(guestWorker(), {
    status: 'online',
    dueCount: 2,
    overdueCount: 0,
    lastTickAt: '2026-11-05T05:00:00Z',
    now
  });
  assert.match(stale.join(' '), /not ticking/);

  const overdue = workerArrivalErrors(guestWorker(), {
    status: 'online',
    dueCount: 0,
    overdueCount: 3,
    lastTickAt: new Date(now).toISOString(),
    now
  });
  assert.match(overdue.join(' '), /Overdue arrival jobs/);

  const healthy = workerArrivalErrors(guestWorker(), {
    status: 'online',
    dueCount: 1,
    overdueCount: 0,
    lastTickAt: new Date(now - 60_000).toISOString(),
    now
  });
  assert.deepEqual(healthy, []);
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
  }), { status: 'online', now }).join(' '), /MESSAGE_ORCHESTRATOR_ENABLED/);
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
