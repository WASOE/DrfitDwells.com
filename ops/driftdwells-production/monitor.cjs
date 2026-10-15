#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WINDOW_MS = 5 * 60_000;
const MAX_TAIL_BYTES = 256 * 1024;
const ERROR_GROWTH_PER_MINUTE = 5 * 1024 * 1024;

function evaluate({ apps, previous = {}, logs = {}, health, now = Date.now() }) {
  const alerts = [];
  const state = { at: now, processes: {}, logs: {} };
  const active = apps.filter(app => app.pm2_env.status === 'online');
  const apis = active.filter(app =>
    /\/server\.js$/.test(app.pm2_env.pm_exec_path || '') && Number(app.pm2_env.PORT) === 5000);
  if (apis.length !== 1 || !/^driftdwells-production-[a-f0-9]+$/.test(apis[0]?.name || '')) {
    alerts.push('PRODUCTION_API_PROCESS_COUNT_OR_NAME');
  }
  const workers = active.filter(app => /worker|reconciler/.test(app.name));
  if (workers.length !== 5) alerts.push('DEDICATED_WORKER_COUNT');
  if (!health) alerts.push('API_HEALTH_FAILED');

  for (const app of apps) {
    const id = String(app.pm2_env.pm_id);
    const current = { pid: app.pid, restarts: app.pm2_env.restart_time, status: app.pm2_env.status };
    const old = previous.processes?.[id];
    if (old && (current.restarts !== old.restarts || (old.pid && current.pid !== old.pid))) {
      alerts.push(`PM2_RESTART:${id}`);
    }
    if (current.status !== 'online') alerts.push(`PROCESS_NOT_ONLINE:${id}`);
    state.processes[id] = current;
  }
  for (const id of Object.keys(previous.processes || {})) {
    if (!state.processes[id]) alerts.push(`PROCESS_DISAPPEARED:${id}`);
  }
  for (const [filename, log] of Object.entries(logs)) {
    const old = previous.logs?.[filename];
    const elapsed = Math.max(1, now - (previous.at || now - 60_000));
    const growth = old && old.ino === log.ino ? Math.max(0, log.size - old.size) : 0;
    if (filename.includes('error') && growth * 60_000 / elapsed >= ERROR_GROWTH_PER_MINUTE) {
      alerts.push(`RAPID_ERROR_LOG_GROWTH:${path.basename(filename)}`);
    }
    const events = (old?.events || []).filter(event => now - event.at <= WINDOW_MS);
    const lines = log.text.split('\n');
    for (const line of lines) {
      if (/EADDRINUSE/.test(line)) events.push({ at: now, type: 'EADDRINUSE' });
      if (/paid_booking_finalization_failure|RECONCILE_REPAIR_FAILED|"phase"\s*:\s*"tick_failed"/.test(line)) {
        events.push({ at: now, type: 'RECONCILIATION_FAILURE' });
      }
    }
    for (const [type, threshold] of [['EADDRINUSE', 2], ['RECONCILIATION_FAILURE', 3]]) {
      if (events.filter(event => event.type === type).length >= threshold) {
        alerts.push(`${type}:${path.basename(filename)}`);
      }
    }
    if (log.truncated) alerts.push(`LOG_SCAN_LIMIT:${path.basename(filename)}`);
    state.logs[filename] = { ino: log.ino, size: log.size, events: events.slice(-500) };
  }
  return { alerts, state };
}

function readIncrement(filename, previous) {
  const stat = fs.statSync(filename);
  const continued = previous?.ino === stat.ino && stat.size >= previous.size;
  const start = previous ? (continued ? previous.size : 0) : stat.size;
  const bytes = stat.size - start;
  const length = Math.min(bytes, MAX_TAIL_BYTES);
  const fd = fs.openSync(filename, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, stat.size - length);
    return { ino: stat.ino, size: stat.size, text: buffer.subarray(0, read).toString(), truncated: bytes > length };
  } finally {
    fs.closeSync(fd);
  }
}

async function main() {
  const stateDir = process.env.STATE_DIRECTORY || '/home/illoc/.local/state/driftdwells-monitor';
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stateFile = path.join(stateDir, 'state.json');
  const previous = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const apps = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 10_000 }))
    .filter(app => app.name.startsWith('driftdwells'));
  const filenames = new Set(['/home/illoc/.pm2/pm2.log']);
  for (const app of apps) {
    filenames.add(app.pm2_env.pm_err_log_path);
    filenames.add(app.pm2_env.pm_out_log_path);
  }
  const logs = {};
  for (const filename of filenames) {
    if (filename) logs[filename] = readIncrement(filename, previous.logs?.[filename]);
  }
  let health = false;
  try {
    const response = await fetch('http://127.0.0.1:5000/api/health', { signal: AbortSignal.timeout(5000) });
    const body = await response.json();
    health = response.ok && body.status === 'OK' && body.database === 'connected';
  } catch {
    health = false;
  }
  const result = evaluate({ apps, previous, logs, health });
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(result.state), { mode: 0o600 });
  fs.renameSync(stateFile + '.tmp', stateFile);
  const report = JSON.stringify({
    source: 'driftdwells-monitor', at: new Date(result.state.at).toISOString(),
    status: result.alerts.length ? 'alert' : 'healthy', alerts: result.alerts,
    processCount: apps.length
  });
  if (result.alerts.length) {
    console.error(report);
    process.exitCode = 1;
  } else {
    console.log(report);
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ source: 'driftdwells-monitor', status: 'alert', alerts: ['MONITOR_EXECUTION_FAILED'] }));
    process.exitCode = 1;
  });
}

module.exports = { evaluate, readIncrement };
