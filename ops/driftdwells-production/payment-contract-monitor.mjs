#!/usr/bin/env node
/**
 * Read-only production monitor for named PM2 roles, API health, and the
 * Checkout V2 payment contract. Does not install or modify systemd units.
 *
 *   node ops/driftdwells-production/payment-contract-monitor.mjs \
 *     --base-url http://127.0.0.1:5000 \
 *     --process-snapshot /path/to/pm2-names.json \
 *     --timeout-ms 5000
 *
 * Without --process-snapshot the command reads `pm2 jlist` and keeps only
 * process name and status. Environment blocks from PM2 are discarded.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_REQUIRED_ROLES,
  runPaymentContractMonitor,
  summarizeProcesses
} from './paymentContractMonitorLib.mjs';

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.PAYMENT_MONITOR_BASE_URL || 'http://127.0.0.1:5000',
    processSnapshot: '',
    timeoutMs: 5000,
    requiredRoles: []
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg.startsWith('--base-url=')) out.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--process-snapshot=')) {
      out.processSnapshot = arg.slice('--process-snapshot='.length);
    } else if (arg.startsWith('--timeout-ms=')) out.timeoutMs = arg.slice('--timeout-ms='.length);
    else if (arg.startsWith('--require-role=')) out.requiredRoles.push(arg.slice('--require-role='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node ops/driftdwells-production/payment-contract-monitor.mjs [options]

Options:
  --base-url=<url>              API origin (default http://127.0.0.1:5000)
  --process-snapshot=<file>     JSON process list (tests or offline checks)
  --require-role=<name>         Required PM2 process name (repeatable)
  --timeout-ms=<ms>             Per-request timeout, capped at 10000
  --help

Default required roles: ${DEFAULT_REQUIRED_ROLES.join(', ')}
Extra PM2 processes are ignored. Missing required roles fail with PROCESS_ROLE_MISSING.
Health failures use API_HEALTH_FAILED. Contract failures use PAYMENT_CONTRACT_MISMATCH.
`);
}

function readPm2Jlist(timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      'pm2',
      ['jlist'],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error('pm2 jlist failed'));
          return;
        }
        try {
          resolve(summarizeProcesses(JSON.parse(stdout)));
        } catch {
          reject(new Error('pm2 jlist was not valid json'));
        }
      }
    );
  });
}

async function loadProcesses(args) {
  if (args.processSnapshot) {
    const raw = JSON.parse(fs.readFileSync(args.processSnapshot, 'utf8'));
    return summarizeProcesses(raw);
  }
  return readPm2Jlist(Number(args.timeoutMs) || 5000);
}

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }));
    return 1;
  }
  if (args.help) {
    printHelp();
    return 0;
  }
  let processes;
  try {
    processes = await loadProcesses(args);
  } catch {
    console.log(
      JSON.stringify({
        ok: false,
        alertCodes: ['PROCESS_ROLE_MISSING'],
        alerts: [{ code: 'PROCESS_ROLE_MISSING', role: '*', status: null, reason: 'process_list_unavailable' }],
        observedRoles: []
      })
    );
    return 2;
  }
  const report = await runPaymentContractMonitor({
    baseUrl: args.baseUrl,
    processes,
    requiredRoles: args.requiredRoles.length > 0 ? args.requiredRoles : DEFAULT_REQUIRED_ROLES,
    timeoutMs: args.timeoutMs
  });
  console.log(JSON.stringify(report));
  return report.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch(() => {
      console.error(JSON.stringify({ ok: false, error: 'monitor_failed' }));
      process.exit(1);
    });
}
