/**
 * Safe structured telemetry for accommodation payment-preparation failures.
 * Never logs PII, legal text, Stripe secrets, or request bodies.
 */
'use strict';

const crypto = require('crypto');

function mintPaymentPrepCorrelationId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pp_${crypto.randomBytes(16).toString('hex')}`;
}

function applicationRelease() {
  return (
    process.env.APP_RELEASE ||
    process.env.RELEASE_VERSION ||
    process.env.npm_package_version ||
    null
  );
}

/**
 * @param {object} fields
 */
function logPaymentPreparationFailure(fields = {}) {
  const payload = {
    event: 'payment_preparation_failed',
    correlationId: fields.correlationId || null,
    checkoutId: fields.checkoutId || null,
    flowVersion: fields.flowVersion || 'v2',
    endpoint: fields.endpoint || '/api/bookings/create-payment-intent',
    httpStatus: fields.httpStatus ?? null,
    code: fields.code || null,
    stage: fields.stage || null,
    sessionVersion: fields.sessionVersion ?? null,
    sessionStatus: fields.sessionStatus || null,
    finalizeIntentPresent: fields.finalizeIntentPresent === true,
    finalizeIntentHashPresent: fields.finalizeIntentHashPresent === true,
    canonicalPaymentIntentPresent: fields.canonicalPaymentIntentPresent === true,
    retryable: fields.retryable === true,
    applicationRelease: applicationRelease(),
    frontendRelease: fields.frontendRelease || null
  };
  try {
    console.warn(JSON.stringify(payload));
  } catch {
    console.warn('[payment_preparation_failed]', payload.code || 'unknown');
  }
}

function isRetryablePaymentPrepCode(code) {
  return (
    code === 'CHECKOUT_SESSION_CONCURRENCY_CONFLICT' ||
    code === 'FINALIZE_INTENT_REQUIRED' ||
    code === 'FINALIZE_INTENT_METADATA_SYNC_FAILED'
  );
}

module.exports = {
  mintPaymentPrepCorrelationId,
  logPaymentPreparationFailure,
  isRetryablePaymentPrepCode,
  applicationRelease
};
