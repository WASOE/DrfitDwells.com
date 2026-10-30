'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluate, readIncrement } = require('./monitor.cjs');

const requiredWorkers = [
  {
    name: 'driftdwells-confirmation-worker',
    exec: '/server/scripts/runBookingConfirmationDeliveryWorker.js'
  },
  {
    name: 'driftdwells-accommodation-hold-expiry-worker',
    exec: '/server/scripts/runAccommodationCheckoutHoldExpiryWorker.js'
  },
  {
    name: 'driftdwells-split-payment-collection-worker',
    exec: '/server/scripts/runSplitPaymentCollectionWorker.js'
  },
  {
    name: 'driftdwells-finalize-worker',
    exec: '/server/scripts/runCheckoutFinalizationWorker.js'
  },
  {
    name: 'driftdwells-paid-checkout-reconciler-9731d3e',
    exec: '/server/scripts/runPaidCheckoutReconciler.js'
  },
  {
    name: 'driftdwells-build-enquiry-email-worker',
    exec: '/server/scripts/runBuildEnquiryEmailWorker.js'
  }
];

const apps = [
  {
    name: 'driftdwells-production-a0a4d1a',
    pid: 100,
    pm2_env: {
      pm_id: 0,
      PORT: '5000',
      pm_exec_path: '/server/server.js',
      status: 'online',
      restart_time: 0
    }
  },
  ...requiredWorkers.map((worker, id) => ({
    name: worker.name,
    pid: 101 + id,
    pm2_env: {
      pm_id: id + 1,
      PORT: '5000',
      pm_exec_path: worker.exec,
      status: 'online',
      restart_time: 0
    }
  }))
];
const input = { apps, health: true, now: 60_000 };

test('healthy baseline with six workers does not alert on obsolete exact count', () => {
  const first = evaluate(input);
  assert.deepEqual(first.alerts, []);
  assert.deepEqual(evaluate({ ...input, now: 120_000, previous: first.state }).alerts, []);
});
test('restarts, disappeared workers, missing roles, duplicate APIs, and health failure alert', () => {
  const previous = evaluate(input).state;
  const changed = structuredClone(apps);
  changed[0].pm2_env.restart_time++;
  changed[0].pid++;
  changed.pop(); // remove optional build-enquiry worker; still healthy on roles
  const withoutOptional = evaluate({ ...input, apps: changed, previous, health: false });
  for (const alert of ['PM2_RESTART:0', 'PROCESS_DISAPPEARED:6', 'API_HEALTH_FAILED']) {
    assert.ok(withoutOptional.alerts.includes(alert), alert);
  }
  assert.ok(!withoutOptional.alerts.includes('DEDICATED_WORKER_COUNT'));
  assert.ok(!withoutOptional.alerts.some(alert => alert.startsWith('REQUIRED_WORKER_ROLE:')));

  const missingFinalize = structuredClone(apps).filter(app => app.name !== 'driftdwells-finalize-worker');
  const missing = evaluate({ ...input, apps: missingFinalize });
  assert.ok(missing.alerts.includes('REQUIRED_WORKER_ROLE:finalize'));

  assert.ok(evaluate({ ...input, apps: [...apps, apps[0]] }).alerts.includes('PRODUCTION_API_PROCESS_COUNT_OR_NAME'));
});
test('repeated errors and rapid growth alert; old events expire', () => {
  const filename = '/logs/api-error.log';
  const previous = evaluate({ ...input, logs: { [filename]: { ino: 1, size: 10, text: 'EADDRINUSE\n' } } }).state;
  const result = evaluate({
    ...input, now: 120_000, previous,
    logs: { [filename]: { ino: 1, size: 6 * 1024 * 1024, text: 'EADDRINUSE\n' + '"phase":"tick_failed"\n'.repeat(3) } }
  });
  for (const prefix of ['RAPID_ERROR_LOG_GROWTH', 'EADDRINUSE', 'RECONCILIATION_FAILURE']) {
    assert.ok(result.alerts.some(alert => alert.startsWith(prefix)));
  }
  const expired = evaluate({
    ...input, now: 500_000, previous: result.state,
    logs: { [filename]: { ino: 1, size: 6 * 1024 * 1024, text: '' } }
  });
  assert.deepEqual(expired.alerts, []);
});
test('incremental reader ignores historical data, handles copytruncate and bounds reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-monitor-'));
  const file = path.join(dir, 'error.log');
  try {
    fs.writeFileSync(file, 'historical EADDRINUSE\n');
    const initial = readIncrement(file);
    assert.equal(initial.text, '');
    fs.appendFileSync(file, 'new error\n');
    const updated = readIncrement(file, initial);
    assert.equal(updated.text, 'new error\n');
    fs.writeFileSync(file, '');
    assert.equal(readIncrement(file, updated).text, '');
    fs.writeFileSync(file, 'EADDRINUSE\n');
    assert.equal(readIncrement(file, updated).text, 'EADDRINUSE\n');
    fs.writeFileSync(file, '');
    const empty = readIncrement(file);
    fs.appendFileSync(file, 'x'.repeat(300_000));
    const bounded = readIncrement(file, empty);
    assert.equal(bounded.text.length, 256 * 1024);
    assert.equal(bounded.truncated, true);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
});
