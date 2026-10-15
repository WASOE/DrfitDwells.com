'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluate, readIncrement } = require('./monitor.cjs');

const apps = Array.from({ length: 6 }, (_, id) => ({
  name: id ? `driftdwells-worker-${id}` : 'driftdwells-production-a0a4d1a',
  pid: 100 + id,
  pm2_env: {
    pm_id: id, PORT: '5000', pm_exec_path: id ? '/server/worker.js' : '/server/server.js',
    status: 'online', restart_time: 0
  }
}));
const input = { apps, health: true, now: 60_000 };

test('healthy baseline and unchanged processes do not alert', () => {
  const first = evaluate(input);
  assert.deepEqual(first.alerts, []);
  assert.deepEqual(evaluate({ ...input, now: 120_000, previous: first.state }).alerts, []);
});
test('restarts, disappeared workers, duplicate APIs, and health failure alert', () => {
  const previous = evaluate(input).state;
  const changed = structuredClone(apps);
  changed[0].pm2_env.restart_time++;
  changed[0].pid++;
  changed.pop();
  const result = evaluate({ ...input, apps: changed, previous, health: false });
  for (const alert of ['PM2_RESTART:0', 'PROCESS_DISAPPEARED:5', 'DEDICATED_WORKER_COUNT', 'API_HEALTH_FAILED']) {
    assert.ok(result.alerts.includes(alert));
  }
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
