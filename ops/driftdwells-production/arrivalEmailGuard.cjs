'use strict';

/**
 * Pure checks for the guest-wide arrival email system.
 * PM2 "online" is not evidence that instructions are being sent.
 * These functions do not connect to a database or send email.
 */

const API_PRODUCTION_FLAGS = Object.freeze({
  ARRIVAL_EMAIL_V2: '1',
  ARRIVAL_AUTOMATION_V2: '1',
  MESSAGE_SCHEDULER_WORKER_ENABLED: '0',
  MESSAGE_DISPATCHER_ENABLED: '0',
  MESSAGE_ORCHESTRATOR_ENABLED: '0'
});

const WORKER_PRODUCTION_FLAGS = Object.freeze({
  ARRIVAL_EMAIL_V2: '1',
  ARRIVAL_AUTOMATION_V2: '1',
  ARRIVAL_AUTOMATION_WORKER_MODE: '1',
  MESSAGE_SCHEDULER_WORKER_ENABLED: '1',
  MESSAGE_DISPATCHER_ENABLED: '0',
  MESSAGE_ORCHESTRATOR_ENABLED: '0',
  ARRIVAL_AUTOMATION_WORKER_ALLOW_ALL_GUESTS: '1'
});

const CRITICAL_RELEASE_FILES = Object.freeze([
  'ecosystem.config.cjs',
  'ops/driftdwells-production/deploy-api-guarded.cjs',
  'ops/driftdwells-production/payment-contract-monitor.mjs',
  'server/config/stripeApiVersion.js',
  'server/routes/bookingRoutes.js',
  'server/scripts/runArrivalAutomationWorker.js',
  'server/scripts/runBookingConfirmationDeliveryWorker.js',
  'server/scripts/runCheckoutFinalizationWorker.js',
  'server/scripts/runPaidCheckoutReconciler.js',
  'server/scripts/runSplitPaymentCollectionWorker.js',
  'server/services/messaging/arrival/arrivalAutoDispatchAdapter.js',
  'server/services/messaging/arrival/arrivalAutomationScheduler.js',
  'server/services/messaging/arrival/arrivalEmailSendService.js',
  'server/services/messaging/arrival/arrivalWorkerClaimPolicy.js',
  'server/services/messaging/schedulerWorker.js'
]);

const TICK_STALE_MS = 5 * 60 * 1000;
const ARRIVAL_APP_NAME = 'driftdwells-arrival-automation-worker';
const ARRIVAL_RULE_KEYS = Object.freeze([
  'arrival_instructions_pre_arrival_cabin',
  'arrival_instructions_pre_arrival_valley'
]);
const HEALTH_COUNT_FIELDS = Object.freeze(['dueCount', 'overdueCount', 'failedCount']);

function flag(env, key) {
  return String(env?.[key] ?? '').trim();
}

function missingCriticalFiles(presentPaths) {
  const present = new Set(presentPaths || []);
  return CRITICAL_RELEASE_FILES.filter((file) => !present.has(file));
}

function apiArrivalErrors(env = {}) {
  const errors = [];
  for (const [key, expected] of Object.entries(API_PRODUCTION_FLAGS)) {
    if (flag(env, key) !== expected) {
      errors.push(`API ${key} must be ${expected} for guest arrival scheduling`);
    }
  }
  return errors;
}

function workerArrivalErrors(env = {}) {
  const errors = [];
  const status = String(env.status || '').trim();
  if (status && status !== 'online') errors.push('Arrival worker is not online');

  for (const [key, expected] of Object.entries(WORKER_PRODUCTION_FLAGS)) {
    if (flag(env, key) !== expected) {
      errors.push(`Arrival worker ${key} must be ${expected}`);
    }
  }
  if (flag(env, 'ARRIVAL_AUTOMATION_WORKER_EMAIL_ALLOWLIST')) {
    errors.push('Arrival worker is staff-scoped; guest-wide delivery requires an empty allowlist');
  }
  const parked = flag(env, 'ARRIVAL_EMAIL_V2') !== '1'
    || flag(env, 'ARRIVAL_AUTOMATION_V2') !== '1'
    || flag(env, 'MESSAGE_SCHEDULER_WORKER_ENABLED') !== '1';
  if (parked) {
    errors.push('Arrival worker is parked while PM2 can still report online');
  }
  if (flag(env, 'MESSAGE_DISPATCHER_ENABLED') === '1') {
    errors.push('Legacy MESSAGE_DISPATCHER_ENABLED must stay off');
  }
  if (flag(env, 'MESSAGE_ORCHESTRATOR_ENABLED') === '1') {
    errors.push('Legacy MESSAGE_ORCHESTRATOR_ENABLED must stay off');
  }
  return errors;
}

function arrivalQueueFilters(nowMs = Date.now()) {
  const now = new Date(nowMs);
  const overdueBefore = new Date(nowMs - TICK_STALE_MS);
  const scope = {
    ruleKey: { $in: [...ARRIVAL_RULE_KEYS] },
    'payloadSnapshot.arrivalAutomationV2': true
  };
  return {
    due: { ...scope, status: 'scheduled', scheduledFor: { $lte: now } },
    overdue: { ...scope, status: 'scheduled', scheduledFor: { $lte: overdueBefore } },
    failed: { ...scope, status: 'failed' }
  };
}

function parseLatestArrivalHealthLog(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let found = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.includes('"phase"')) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row && row.source === 'arrival-automation-worker' && row.phase === 'health') found = row;
    } catch {
      // Ignore ordinary log lines. Absence of a health record stays a failure.
    }
  }
  return found;
}

function observeArrivalRuntimeHealth({ logText, counts, now = Date.now() } = {}) {
  const log = parseLatestArrivalHealthLog(logText);
  if (!log) {
    return {
      evidenceError: 'Arrival scheduler health log has no tick evidence; missing data is not zero',
      now
    };
  }
  return {
    running: log.running,
    lastTickAt: log.lastTickAt,
    lastTickError: Object.hasOwn(log, 'lastTickError') ? log.lastTickError : undefined,
    dueCount: counts?.dueCount,
    overdueCount: counts?.overdueCount,
    failedCount: counts?.failedCount,
    now
  };
}

async function readArrivalQueueCounts(connection, now = Date.now()) {
  if (!connection || typeof connection.collection !== 'function') {
    throw new Error('Arrival queue counts were not observed');
  }
  const filters = arrivalQueueFilters(now);
  const names = ['due', 'overdue', 'failed'];
  const values = await Promise.all(names.map(async (name) => {
    const count = await connection.collection('scheduledmessagejobs').countDocuments(filters[name]);
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      throw new Error(`Arrival ${name} count was not observed`);
    }
    return count;
  }));
  return { dueCount: values[0], overdueCount: values[1], failedCount: values[2] };
}

function workerRuntimeHealthErrors(health, now = Date.now()) {
  if (!health || typeof health !== 'object') {
    return ['Arrival runtime health was not collected; missing data is not zero'];
  }
  if (health.evidenceError) return [String(health.evidenceError)];
  const errors = [];
  const observedAt = Number(health.now || now);
  for (const key of [...HEALTH_COUNT_FIELDS, 'lastTickAt', 'lastTickError']) {
    if (!Object.hasOwn(health, key) || health[key] === undefined) {
      errors.push(`Arrival health is missing ${key}; missing data is not zero`);
    }
  }
  if (errors.length) return errors;
  for (const key of HEALTH_COUNT_FIELDS) {
    if (typeof health[key] !== 'number' || !Number.isFinite(health[key]) || health[key] < 0) {
      errors.push(`Arrival health ${key} must be an observed count`);
    }
  }
  if (health.running !== true) {
    errors.push('Arrival scheduler is not running; PM2 online is not a tick');
  }
  const tick = Date.parse(health.lastTickAt || '');
  if (!Number.isFinite(tick) || observedAt - tick > TICK_STALE_MS || tick > observedAt + 60_000) {
    errors.push('Arrival scheduler is not ticking');
  }
  if (health.lastTickError) errors.push('Arrival scheduler tick failed');
  if (health.overdueCount > 0) errors.push('Overdue arrival jobs are past the grace period');
  if (health.failedCount > 0) errors.push('Arrival jobs have failed');
  return errors;
}

function committedProductionErrors(ecosystem) {
  const app = (ecosystem?.apps || []).find((item) => item.name === ARRIVAL_APP_NAME);
  if (!app) return ['PM2 production config has no dedicated arrival worker'];
  return workerArrivalErrors({ ...(app.env_production || {}), status: 'online' });
}

module.exports = {
  API_PRODUCTION_FLAGS,
  WORKER_PRODUCTION_FLAGS,
  CRITICAL_RELEASE_FILES,
  TICK_STALE_MS,
  ARRIVAL_APP_NAME,
  missingCriticalFiles,
  apiArrivalErrors,
  workerArrivalErrors,
  arrivalQueueFilters,
  parseLatestArrivalHealthLog,
  observeArrivalRuntimeHealth,
  readArrivalQueueCounts,
  workerRuntimeHealthErrors,
  committedProductionErrors
};
