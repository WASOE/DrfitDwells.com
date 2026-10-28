/**
 * Production process and payment-contract monitor.
 * Validates named PM2 roles, API health, and live checkout capabilities.
 * Never prints process environments or request bodies.
 */
import {
  PRODUCTION_PAYMENT_CONTRACT_VERSION,
  evaluateLiveProductionCapabilities
} from '../../shared/payments/productionPaymentContract.js';
import { resolveTimeoutMs, strictJsonGet } from '../../scripts/lib/strictJsonGet.mjs';

export const ALERT_CODES = Object.freeze({
  PROCESS_ROLE_MISSING: 'PROCESS_ROLE_MISSING',
  PROCESS_ROLE_NOT_ONLINE: 'PROCESS_ROLE_NOT_ONLINE',
  API_HEALTH_FAILED: 'API_HEALTH_FAILED',
  PAYMENT_CONTRACT_MISMATCH: 'PAYMENT_CONTRACT_MISMATCH'
});

export const DEFAULT_REQUIRED_ROLES = Object.freeze([
  'driftdwells',
  'driftdwells-confirmation-worker'
]);

export function summarizeProcesses(list) {
  if (!Array.isArray(list)) return [];
  const summarized = [];
  for (const proc of list) {
    if (!proc || typeof proc !== 'object') continue;
    const name = typeof proc.name === 'string' ? proc.name : proc.pm2_env?.name;
    const status = proc.pm2_env?.status || proc.status || null;
    if (typeof name !== 'string' || !name.trim()) continue;
    summarized.push({ name: name.trim(), status: status ? String(status) : null });
  }
  return summarized;
}

export function evaluateProcessRoles(processes, requiredRoles = DEFAULT_REQUIRED_ROLES) {
  const summarized = summarizeProcesses(processes);
  const byName = new Map(summarized.map((proc) => [proc.name, proc.status]));
  const alerts = [];
  for (const role of requiredRoles) {
    if (!byName.has(role)) {
      alerts.push({ code: ALERT_CODES.PROCESS_ROLE_MISSING, role, status: null });
      continue;
    }
    if (byName.get(role) !== 'online') {
      alerts.push({
        code: ALERT_CODES.PROCESS_ROLE_NOT_ONLINE,
        role,
        status: byName.get(role)
      });
    }
  }
  return {
    ok: alerts.length === 0,
    alerts,
    observedRoles: summarized.map((proc) => proc.name)
  };
}

export async function evaluateApiHealthAndContract({
  baseUrl,
  timeoutMs = 5000,
  fetchImpl
} = {}) {
  const timeout = resolveTimeoutMs(timeoutMs);
  const alerts = [];
  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(root)) {
    alerts.push({ code: ALERT_CODES.API_HEALTH_FAILED, reason: 'invalid_base_url' });
    return { ok: false, alerts, paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION };
  }

  let healthRes;
  let capsRes;
  try {
    healthRes = await strictJsonGet(`${root}/api/health`, { timeoutMs: timeout, fetchImpl });
  } catch (err) {
    alerts.push({
      code: ALERT_CODES.API_HEALTH_FAILED,
      reason: err?.code === 'TIMEOUT' ? 'timeout' : 'request_failed'
    });
    return { ok: false, alerts, paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION };
  }

  const healthStatus = healthRes.body?.status ?? null;
  if (!healthRes.ok || healthStatus !== 'OK') {
    alerts.push({
      code: ALERT_CODES.API_HEALTH_FAILED,
      reason: 'unhealthy',
      status: healthRes.status
    });
  }

  try {
    capsRes = await strictJsonGet(`${root}/api/bookings/checkout-capabilities`, {
      timeoutMs: timeout,
      fetchImpl
    });
  } catch (err) {
    alerts.push({
      code: ALERT_CODES.PAYMENT_CONTRACT_MISMATCH,
      reason: err?.code === 'TIMEOUT' ? 'timeout' : 'request_failed'
    });
    return { ok: alerts.length === 0, alerts, paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION };
  }

  if (!capsRes.ok || !capsRes.body || typeof capsRes.body !== 'object') {
    alerts.push({
      code: ALERT_CODES.PAYMENT_CONTRACT_MISMATCH,
      reason: 'capabilities_unavailable',
      status: capsRes.status
    });
  } else {
    const contract = evaluateLiveProductionCapabilities({
      paymentContractVersion: capsRes.body.paymentContractVersion ?? null,
      checkoutSessionV2: capsRes.body.checkoutSessionV2 === true,
      finalizeIntentPersist: capsRes.body.finalizeIntentPersist === true,
      finalizeIntentRequiredForPi: capsRes.body.finalizeIntentRequiredForPi === true
    });
    if (!contract.ok) {
      alerts.push({
        code: ALERT_CODES.PAYMENT_CONTRACT_MISMATCH,
        reason: 'incompatible',
        mismatches: contract.mismatches
      });
    }
  }

  return {
    ok: alerts.length === 0,
    alerts,
    paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION
  };
}

export async function runPaymentContractMonitor({
  baseUrl,
  processes,
  requiredRoles = DEFAULT_REQUIRED_ROLES,
  timeoutMs = 5000,
  fetchImpl
} = {}) {
  const processResult = evaluateProcessRoles(processes, requiredRoles);
  const apiResult = await evaluateApiHealthAndContract({ baseUrl, timeoutMs, fetchImpl });
  const alerts = [...processResult.alerts, ...apiResult.alerts];
  return {
    ok: alerts.length === 0,
    alertCodes: [...new Set(alerts.map((alert) => alert.code))],
    alerts,
    observedRoles: processResult.observedRoles,
    paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION
  };
}
