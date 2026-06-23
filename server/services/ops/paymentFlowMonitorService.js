'use strict';

const { openManualReviewItem } = require('./ingestion/manualReviewService');
const { notifyOpsPushPaymentFlowAlert } = require('./push/opsPushEventNotifications');

const WINDOW_MS = 10 * 60 * 1000;
const THRESHOLD_COUNT = 3;

const MONITORED_ROUTES = new Set([
  '/api/gift-vouchers/create-payment-intent',
  '/api/bookings/create-payment-intent'
]);

const IMMEDIATE_STATUS_CODES = new Set([500, 502, 503]);
const IMMEDIATE_ERROR_CODES = new Set([
  'PAYMENT_INTENT_INIT_FAILED',
  'PAYMENT_NOT_CONFIGURED'
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

function extractSafeErrorReason(body = {}) {
  if (body?.code) {
    return String(body.code);
  }
  if (body?.error?.code) {
    return String(body.error.code);
  }
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const msg = String(first?.msg || first?.message || 'validation_error').slice(0, 120);
    const path = first?.path || first?.param;
    if (path) {
      return `validation:${path}:${msg}`;
    }
    return `validation:${msg}`;
  }
  if (body?.message) {
    return String(body.message).slice(0, 120);
  }
  return 'unknown_error';
}

function bucketKey(route, errorReason) {
  return `${route}::${errorReason}`;
}

function getOrResetBucket(key, now) {
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

function isImmediateAlert(statusCode, body) {
  if (statusCode >= 500) {
    return true;
  }
  if (IMMEDIATE_STATUS_CODES.has(statusCode) && body?.code && IMMEDIATE_ERROR_CODES.has(body.code)) {
    return true;
  }
  return false;
}

function suggestedAction({ immediate, errorReason, route }) {
  if (errorReason === 'PAYMENT_INTENT_INIT_FAILED' || errorReason === 'PAYMENT_NOT_CONFIGURED') {
    return 'Verify Stripe API keys, webhook configuration, and payment intent creation.';
  }
  if (immediate) {
    return 'Check server logs and payment provider status immediately.';
  }
  if (String(errorReason).startsWith('validation:')) {
    return 'Review validation error pattern; may indicate a frontend/backend payload mismatch.';
  }
  return `Investigate repeated checkout failures on ${route}.`;
}

function buildDetails({ route, statusCode, errorReason, count, windowMinutes, immediate, suggested }) {
  return [
    `Route: ${route}`,
    `Status: ${statusCode}`,
    `Reason: ${errorReason}`,
    `Count: ${count}`,
    `Window: ${windowMinutes} minutes`,
    immediate ? 'Severity: immediate' : 'Severity: threshold',
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
  entityType = null,
  entityId = null
}) {
  const windowMinutes = Math.round(windowMs / 60000);
  const suggested = suggestedAction({ immediate, errorReason, route });
  const title = immediate ? 'Payment flow error' : 'Payment flow warning';
  const category = immediate ? 'payment_flow_server_error' : 'payment_flow_threshold_warning';
  const severity = immediate ? 'high' : 'medium';
  const sourceReference = `${route}::${errorReason}`;

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
      suggested
    }),
    provenance: {
      source: 'payment_flow_monitor',
      sourceReference
    },
    evidence: {
      route,
      statusCode,
      errorReason,
      count,
      windowMinutes,
      immediate
    }
  });

  await notifyOpsPushPaymentFlowAlertImpl({
    route,
    statusCode,
    errorReason,
    count,
    windowMinutes,
    immediate,
    suggestedAction: suggested,
    dedupeKey: immediate
      ? `payment_flow_immediate:${sourceReference}`
      : `payment_flow_threshold:${sourceReference}`
  });

  return { alerted: true, immediate };
}

async function recordPaymentFlowOutcome({ route, statusCode, body = {} }) {
  if (!shouldMonitorRoute(route) || statusCode < 400) {
    return { alerted: false };
  }

  const errorReason = extractSafeErrorReason(body);
  const key = bucketKey(route, errorReason);
  const now = Date.now();
  const bucket = getOrResetBucket(key, now);
  bucket.count += 1;
  bucket.lastAt = now;

  if (isImmediateAlert(statusCode, body)) {
    if (bucket.lastImmediateAlertAt && now - bucket.lastImmediateAlertAt < WINDOW_MS) {
      return { alerted: false, deduped: true };
    }
    bucket.lastImmediateAlertAt = now;
    return fireAlert({
      route,
      statusCode,
      errorReason,
      count: bucket.count,
      immediate: true
    });
  }

  if (statusCode === 400) {
    if (bucket.count < THRESHOLD_COUNT) {
      return { alerted: false };
    }
    if (bucket.lastThresholdAlertAt && now - bucket.lastThresholdAlertAt < WINDOW_MS) {
      return { alerted: false, deduped: true };
    }
    bucket.lastThresholdAlertAt = now;
    return fireAlert({
      route,
      statusCode,
      errorReason,
      count: bucket.count,
      immediate: false
    });
  }

  return { alerted: false };
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
      void recordPaymentFlowOutcome({ route, statusCode: pendingStatus, body });
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
  const errorReason = code ? String(code) : 'ACTIVATION_FAILED';
  const key = bucketKey(route, errorReason);
  const now = Date.now();
  const bucket = getOrResetBucket(key, now);
  if (bucket.lastImmediateAlertAt && now - bucket.lastImmediateAlertAt < WINDOW_MS) {
    return { alerted: false, deduped: true };
  }
  bucket.lastImmediateAlertAt = now;
  bucket.count += 1;
  bucket.lastAt = now;

  return fireAlert({
    route,
    statusCode: 500,
    errorReason,
    count: 1,
    immediate: true,
    entityType: 'GiftVoucher',
    entityId: giftVoucherId,
    windowMs: WINDOW_MS
  });
}

module.exports = {
  WINDOW_MS,
  THRESHOLD_COUNT,
  MONITORED_ROUTES,
  extractSafeErrorReason,
  recordPaymentFlowOutcome,
  attachPaymentFlowMonitor,
  notifyGiftVoucherWebhookActivationFailure,
  __setPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorDepsForTesting,
  __resetPaymentFlowMonitorStateForTesting
};
