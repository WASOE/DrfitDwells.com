'use strict';

const { runSmtpHealthCheck, getSafeSmtpDiagnostics } = require('../email/smtpHealthService');

const globalKey = '__DDW_SMTP_HEALTH_SCHEDULER__';
const DEFAULT_INTERVAL_MINUTES = 360;
const DEFAULT_STARTUP_DELAY_MS = 5000;

let runCheckImpl = runSmtpHealthCheck;

function __setRunSmtpHealthCheckForTesting(fn) {
  runCheckImpl = typeof fn === 'function' ? fn : runSmtpHealthCheck;
}

function __resetRunSmtpHealthCheckForTesting() {
  runCheckImpl = runSmtpHealthCheck;
}

function state() {
  if (!global[globalKey]) {
    global[globalKey] = {
      timer: null,
      startupTimer: null,
      enabled: false,
      intervalMs: DEFAULT_INTERVAL_MINUTES * 60 * 1000,
      inProgress: false,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      certValidTo: null,
      certDaysRemaining: null,
      diagnostics: null
    };
  }
  return global[globalKey];
}

function getConfigFromEnv() {
  const enabled = String(process.env.SMTP_HEALTH_SCHEDULER_ENABLED || '').trim() === '1';
  const intervalMinutes =
    Number.parseInt(process.env.SMTP_HEALTH_INTERVAL_MINUTES || '', 10) || DEFAULT_INTERVAL_MINUTES;
  return {
    enabled,
    intervalMs: Math.max(60_000, intervalMinutes * 60 * 1000)
  };
}

function shouldStartScheduler() {
  if (process.env.NODE_ENV === 'test') return false;
  return getConfigFromEnv().enabled;
}

async function runCheckOnce() {
  const s = state();
  if (s.inProgress) {
    return { skipped: true, reason: 'in_progress' };
  }

  s.inProgress = true;
  s.lastRunAt = new Date();

  try {
    const result = await runCheckImpl();
    s.lastStatus = result.lastStatus;
    s.lastError = result.lastError;
    s.certValidTo = result.certificate?.validTo || null;
    s.certDaysRemaining = result.certificate?.daysRemaining ?? null;
    s.diagnostics = result.diagnostics || getSafeSmtpDiagnostics();
    return { skipped: false, result };
  } catch (err) {
    s.lastStatus = 'error';
    s.lastError = err?.message || String(err);
    throw err;
  } finally {
    s.inProgress = false;
  }
}

function startSmtpHealthSchedulerIfEnabled() {
  const config = getConfigFromEnv();
  const s = state();

  if (!shouldStartScheduler()) {
    s.enabled = false;
    return { started: false, reason: 'disabled' };
  }

  if (s.timer) {
    return { started: false, reason: 'already_running' };
  }

  s.enabled = true;
  s.intervalMs = config.intervalMs;

  s.startupTimer = setTimeout(() => {
    runCheckOnce().catch((err) => {
      console.error('[smtp-health] Initial check failed:', err?.message || err);
    });
  }, DEFAULT_STARTUP_DELAY_MS);
  if (s.startupTimer.unref) s.startupTimer.unref();

  s.timer = setInterval(() => {
    runCheckOnce().catch((err) => {
      console.error('[smtp-health] Scheduled check failed:', err?.message || err);
    });
  }, s.intervalMs);
  if (s.timer.unref) s.timer.unref();

  return { started: true, intervalMs: s.intervalMs };
}

function stopSmtpHealthSchedulerForTest() {
  const s = state();
  if (s.timer) clearInterval(s.timer);
  if (s.startupTimer) clearTimeout(s.startupTimer);
  s.timer = null;
  s.startupTimer = null;
  s.enabled = false;
  s.inProgress = false;
}

function getSmtpHealthSchedulerState() {
  const s = state();
  return {
    enabled: Boolean(s.enabled),
    intervalMs: s.intervalMs,
    inProgress: Boolean(s.inProgress),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastStatus: s.lastStatus,
    lastError: s.lastError,
    certValidTo: s.certValidTo,
    certDaysRemaining: s.certDaysRemaining,
    diagnostics: s.diagnostics
  };
}

module.exports = {
  startSmtpHealthSchedulerIfEnabled,
  stopSmtpHealthSchedulerForTest,
  getSmtpHealthSchedulerState,
  runCheckOnce,
  __setRunSmtpHealthCheckForTesting,
  __resetRunSmtpHealthCheckForTesting
};
