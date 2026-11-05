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

function workerArrivalErrors(env = {}, health = {}) {
  const errors = [];
  const status = String(health.status || env.status || '').trim();
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

  const dueCount = Number(health.dueCount || 0);
  const overdueCount = Number(health.overdueCount || 0);
  const now = Number(health.now || Date.now());
  if (overdueCount > 0) {
    errors.push('Overdue arrival jobs are past the grace period');
  }
  if (dueCount > 0 || overdueCount > 0) {
    const tick = Date.parse(health.lastTickAt || '');
    if (!Number.isFinite(tick) || now - tick > TICK_STALE_MS) {
      errors.push('Arrival scheduler is not ticking while guest jobs are due');
    }
  }
  return errors;
}

function committedProductionErrors(ecosystem) {
  const app = (ecosystem?.apps || []).find((item) => item.name === ARRIVAL_APP_NAME);
  if (!app) return ['PM2 production config has no dedicated arrival worker'];
  const production = app.env_production || {};
  return workerArrivalErrors({ ...production, status: 'online' }, {
    status: 'online',
    dueCount: 0,
    overdueCount: 0
  });
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
  committedProductionErrors
};
