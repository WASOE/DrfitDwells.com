'use strict';

const { openManualReviewItem } = require('./ingestion/manualReviewService');
const { notifyOpsPushPaymentFlowAlert } = require('./push/opsPushEventNotifications');
const { applicationRelease } = require('../checkout/paymentPreparationObservability');
const {
  PRODUCTION_PAYMENT_CONTRACT_VERSION
} = require('../../../shared/payments/productionPaymentContract.js');

const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD_COUNT = 3;
const MONITORED_CONFLICT_THRESHOLD = 3;
const EXPECTED_CUSTOMER_CONFLICT_THRESHOLD = 25;
const MAX_BUCKETS = 200;

const MONITORED_ROUTES = new Set([
  '/api/gift-vouchers/create-payment-intent',
  '/api/bookings/create-payment-intent',
  '/api/bookings/checkout-sessions/:checkoutId/finalize-intent'
]);

const IMMEDIATE_CONTRACT_CODES = new Set([
  'FINALIZE_INTENT_PERSIST_DISABLED',
  'PAYMENT_NOT_CONFIGURED',
  'PAYMENT_INTENT_INIT_FAILED',
  'FINALIZE_INTENT_REQUIRED',
  'stale_client_missing_finalize_support',
  'stale_client_missing_v2',
  'payment_contract_version_mismatch',
  'server_finalize_intent_persist_disabled',
  'server_finalize_intent_required_disabled'
]);

/**
 * Customer or session conflicts. Counted per route and code, but they do not
 * page at the monitored-failure threshold.
 */
const EXPECTED_CUSTOMER_CONFLICT_CODES = new Set([
  'INVALID_CHECKOUT_ID',
  'CHECKOUT_SESSION_NOT_FOUND',
  'CHECKOUT_SESSION_EXPIRED',
  'CHECKOUT_SESSION_SUPERSEDED',
  'COMMERCIAL_BOUNDARY_CHANGED',
  'CHECKOUT_SESSION_NOT_USABLE',
  'SUPERSEDED_PAYMENT_INTENT',
  'STALE_CLIENT_SECRET',
  'CHECKOUT_SESSION_CONCURRENCY_CONFLICT',
  'FINALIZE_INTENT_INVALID',
  'FINALIZE_INTENT_IMMUTABLE',
  'FINALIZE_INTENT_SESSION_VERSION_CONFLICT',
  'PURCHASE_REQUEST_CONFLICT',
  'PURCHASE_REQUEST_CLOSED'
]);

/** @type {Map<string, { count: number, firstAt: number, lastAt: number, lastThresholdAlertAt: number, lastImmediateAlertAt: number }>} */
const buckets = new Map();

let openManualReviewItemImpl = openManualReviewItem;
let notifyOpsPushPaymentFlowAlertImpl = notifyOpsPushPaymentFlowAlert;

function __setPaymentFlowMonitorDepsForTesting(overrides = {}) {
  if (typeof overrides.openManualReviewItem === 'function') {
    openManualReviewItemImpl = overrides.openManualReviewItem;
  }
  if (typeof overrides.notifyOpsPushPaymentFlowAlert === 'function') {
    notifyOpsPushPaymentFlowAlertImpl = overrides.notifyOpsPushPaymentFlowAlert;
  }
}

function __resetPaymentFlowMonitorDepsForTesting() {
  openManualReviewItemImpl = openManualReviewItem;
  notifyOpsPushPaymentFlowAlertImpl = notifyOpsPushPaymentFlowAlert;
}

function __resetPaymentFlowMonitorStateForTesting() {
  buckets.clear();
}

function shouldMonitorRoute(route) {
  return MONITORED_ROUTES.has(route);
}

const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const PAYMENT_OBJECT_ID = /^(pi|ch|seti|pm|cus|card|tok|src|py|re|txn|po)_/i;
const SECRET_MARK = /client_secret|sk_live|sk_test|rk_live|rk_test|pk_live|pk_test|whsec_|@/i;
const SAFE_FIELD_PATH = /^[A-Za-z][A-Za-z0-9_.]{0,80}$/;
const LONG_DIGIT_RUN = /\d{4,}/;

function isAllowlistedCode(value) {
  return IMMEDIATE_CONTRACT_CODES.has(value) || EXPECTED_CUSTOMER_CONFLICT_CODES.has(value);
}

function safeErrorCode(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 80) return null;
  if (isAllowlistedCode(text)) return text;
  if (!SAFE_ERROR_CODE.test(text) || PAYMENT_OBJECT_ID.test(text) || SECRET_MARK.test(text)) return null;
  return text;
}

function safeFieldPath(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!SAFE_FIELD_PATH.test(text) || LONG_DIGIT_RUN.test(text) || SECRET_MARK.test(text)) return null;
  return text;
}

function redactUnsafeReason(value) {
  return safeErrorCode(value) || 'unclassified_error';
}

function genericStatusReason(statusCode) {
  const status = Number(statusCode);
  if (Number.isInteger(status) && status >= 400 && status <= 599) return `unclassified_http_${status}`;
  return 'unclassified_error';
}

function extractSafeErrorReason(body = {}, statusCode = null) {
  const code = safeErrorCode(body?.code) || safeErrorCode(body?.error?.code);
  if (code) return code;
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const path = safeFieldPath(first?.path || first?.param);
    return path ? `validation:${path}` : 'validation_error';
  }
  return genericStatusReason(statusCode);
}

function logMonitorFailure(event, fields) {
  console.error(JSON.stringify({
    source: 'payment-flow-monitor',
    event,
    route: fields.route || null,
    statusCode: Number.isInteger(fields.statusCode) ? fields.statusCode : null,
    errorReason: fields.errorReason || 'unclassified_error',
    recorded: false
  }));
}

function bucketKey(route, errorReason) {
  return `${route}::${errorReason}`;
}

function pruneBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastAt > WINDOW_MS) buckets.delete(key);
  }
  if (buckets.size <= MAX_BUCKETS) return;
  const oldest = [...buckets.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt);
  while (buckets.size > MAX_BUCKETS && oldest.length > 0) {
    buckets.delete(oldest.shift()[0]);
  }
}

function getOrResetBucket(key, now) {
  pruneBuckets(now);
  const existing = buckets.get(key);
  if (!existing || now - existing.firstAt > WINDOW_MS) {
    const fresh = {
      count: 0,
      firstAt: now,
      lastAt: now,
      lastThresholdAlertAt: 0,
      lastImmediateAlertAt: 0
    };
    buckets.set(key, fresh);
    return fresh;
  }
  return existing;
}

function classifyPaymentFailure(statusCode, errorReason) {
  if (IMMEDIATE_CONTRACT_CODES.has(errorReason)) return 'immediate';
  if (statusCode >= 500) return 'immediate';
  if (statusCode === 403 || statusCode === 409) {
    if (EXPECTED_CUSTOMER_CONFLICT_CODES.has(errorReason)) return 'expected_customer';
    return 'monitored_conflict';
  }
  if (statusCode === 400) return 'validation';
  return 'ignore';
}

function thresholdFor(classification) {
  if (classification === 'expected_customer') return EXPECTED_CUSTOMER_CONFLICT_THRESHOLD;
  if (classification === 'monitored_conflict') return MONITORED_CONFLICT_THRESHOLD;
  return THRESHOLD_COUNT;
}

function suggestedAction({ classification, errorReason, route }) {
  if (IMMEDIATE_CONTRACT_CODES.has(errorReason)) {
    return 'Compare /api/bookings/checkout-capabilities with the release manifest. Restore CHECKOUT_SESSION_V2, FINALIZE_INTENT_PERSIST, and FINALIZE_INTENT_REQUIRED_FOR_PI together before taking more payments.';
  }
  if (classification === 'immediate') {
    return 'Check server logs and payment provider status immediately.';
  }
  if (classification === 'expected_customer') {
    return 'Review repeated customer or session conflicts. Do not treat a single conflict as a contract outage.';
  }
  if (String(errorReason).startsWith('validation:')) {
    return 'Review validation error pattern; may indicate a frontend/backend payload mismatch.';
  }
  return `Investigate repeated checkout failures on ${route}.`;
}

function buildDetails({
  route,
  statusCode,
  errorReason,
  count,
  windowMinutes,
  immediate,
  suggested,
  release,
  paymentContractVersion
}) {
  return [
    `Route: ${route}`,
    `Status: ${statusCode}`,
    `Reason: ${errorReason}`,
    `Count: ${count}`,
    `Window: ${windowMinutes} minutes`,
    immediate ? 'Severity: immediate' : 'Severity: threshold',
    `Application release: ${release || 'unknown'}`,
    `Payment contract: ${paymentContractVersion}`,
    `Suggested action: ${suggested}`
  ].join('\n');
}

async function fireAlert({
  route,
  statusCode,
  errorReason,
  count,
  windowMs = WINDOW_MS,
  immediate = false,
  classification = immediate ? 'immediate' : 'threshold',
  entityType = null,
  entityId = null
}) {
  const windowMinutes = Math.round(windowMs / 60000);
  const suggested = suggestedAction({ classification, errorReason, route });
  const contractIncident = IMMEDIATE_CONTRACT_CODES.has(errorReason);
  const title = immediate ? 'Payment flow error' : 'Payment flow warning';
  const category = contractIncident
    ? 'payment_flow_contract_incident'
    : immediate
      ? 'payment_flow_server_error'
      : classification === 'expected_customer'
        ? 'payment_flow_customer_conflict'
        : 'payment_flow_threshold_warning';
  const severity = immediate ? 'high' : classification === 'expected_customer' ? 'low' : 'medium';
  const sourceReference = `${route}::${errorReason}`;
  const release = applicationRelease();

  try {
    await openManualReviewItemImpl({
      category,
      severity,
      entityType,
      entityId: entityId ? String(entityId) : null,
      title,
      details: buildDetails({
        route,
        statusCode,
        errorReason,
        count,
        windowMinutes,
        immediate,
        suggested,
        release,
        paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION
      }),
      provenance: {
        source: 'payment_flow_monitor',
        sourceReference
      },
      evidence: {
        route,
        statusCode,
        errorCode: errorReason,
        errorReason,
        count,
        windowMinutes,
        immediate,
        applicationRelease: release || null,
        paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION
      }
    });
  } catch {
    logMonitorFailure('manual_review_record_failed', { route, statusCode, errorReason });
    return {
      alerted: false,
      recorded: false,
      immediate,
      classification,
      pushDelivery: null
    };
  }

  let pushDelivery = null;
  try {
    pushDelivery = await notifyOpsPushPaymentFlowAlertImpl({
      route,
      statusCode,
      errorReason,
      count,
      windowMinutes,
      immediate,
      suggestedAction: suggested,
      applicationRelease: release || null,
      paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION,
      dedupeKey: immediate
        ? `payment_flow_immediate:${sourceReference}`
        : `payment_flow_threshold:${sourceReference}:${classification}`
    });
  } catch {
    pushDelivery = {
      error: true,
      skipped: false,
      deliveryOutcome: 'provider_failure'
    };
  }

  return { alerted: true, recorded: true, immediate, classification, pushDelivery };
}

async function dispatchAlert(bucket, timestampField, inFlightField, alert) {
  if (bucket[inFlightField]) {
    return { alerted: false, recorded: false, pending: true, classification: alert.classification };
  }
  if (bucket[timestampField] && Date.now() - bucket[timestampField] < WINDOW_MS) {
    return { alerted: false, deduped: true, recorded: true, classification: alert.classification };
  }
  bucket[inFlightField] = true;
  try {
    const result = await fireAlert(alert);
    if (result.recorded) bucket[timestampField] = Date.now();
    return result;
  } finally {
    bucket[inFlightField] = false;
  }
}

async function recordPaymentFlowOutcome({ route, statusCode, body = {} }) {
  try {
    if (!shouldMonitorRoute(route) || statusCode < 400) {
      return { alerted: false };
    }

    const errorReason = extractSafeErrorReason(body, statusCode);
    const classification = classifyPaymentFailure(statusCode, errorReason);
    if (classification === 'ignore') {
      return { alerted: false, classification };
    }

    const key = bucketKey(route, errorReason);
    const now = Date.now();
    const bucket = getOrResetBucket(key, now);
    bucket.count += 1;
    bucket.lastAt = now;

    if (classification === 'immediate') {
      return await dispatchAlert(bucket, 'lastImmediateAlertAt', 'immediateInFlight', {
        route,
        statusCode,
        errorReason,
        count: bucket.count,
        immediate: true,
        classification
      });
    }

    const threshold = thresholdFor(classification);
    if (bucket.count < threshold) {
      return { alerted: false, classification };
    }
    return await dispatchAlert(bucket, 'lastThresholdAlertAt', 'thresholdInFlight', {
      route,
      statusCode,
      errorReason,
      count: bucket.count,
      immediate: false,
      classification
    });
  } catch {
    logMonitorFailure('payment_flow_monitor_failed', {
      route,
      statusCode,
      errorReason: 'unclassified_error'
    });
    return { alerted: false, recorded: false, error: 'monitor_failed' };
  }
}

function attachPaymentFlowMonitor(res, route) {
  if (!shouldMonitorRoute(route)) {
    return;
  }

  const originalJson = res.json.bind(res);
  let pendingStatus = res.statusCode || 200;
  const originalStatus = res.status.bind(res);

  res.status = function statusWithMonitor(code) {
    pendingStatus = code;
    return originalStatus(code);
  };

  res.json = function jsonWithMonitor(body) {
    if (pendingStatus >= 400) {
      recordPaymentFlowOutcome({ route, statusCode: pendingStatus, body }).catch(() => {
        logMonitorFailure('payment_flow_monitor_unhandled', {
          route,
          statusCode: pendingStatus,
          errorReason: 'unclassified_error'
        });
      });
    }
    return originalJson(body);
  };
}

async function notifyGiftVoucherWebhookActivationFailure({
  code,
  eventId,
  giftVoucherId = null
}) {
  const route = '/stripe/webhook/gift-voucher-activation';
  const errorReason = safeErrorCode(code) || 'ACTIVATION_FAILED';
  const key = bucketKey(route, errorReason);
  const now = Date.now();
  const bucket = getOrResetBucket(key, now);
  bucket.count += 1;
  bucket.lastAt = now;
  return dispatchAlert(bucket, 'lastImmediateAlertAt', 'immediateInFlight', {
    route,
    statusCode: 500,
    errorReason,
    count: bucket.count,
    immediate: true,
    entityType: 'GiftVoucher',
    entityId: giftVoucherId,
    windowMs: WINDOW_MS
  });
}

module.exports = {
  WINDOW_MS,
  THRESHOLD_COUNT,
  MONITORED_CONFLICT_THRESHOLD,
  EXPECTED_CUSTOMER_CONFLICT_THRESHOLD,
  MONITORED_ROUTES,
  IMMEDIATE_CONTRACT_CODES,
  EXPECTED_CUSTOMER_CONFLICT_CODES,
  extractSafeErrorReason,
  classifyPaymentFailure,
  recordPaymentFlowOutcome,
  attachPaymentFlowMonitor,
  notifyGiftVoucherWebhookActivationFailure,
  __setPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorStateForTesting
};
