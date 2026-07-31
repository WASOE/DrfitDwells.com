'use strict';

/**
 * Authoritative classification of emailService / lifecycle send outcomes
 * for booking-confirmation durable delivery.
 *
 * Production delivery is authoritative only when:
 *   success === true && method === 'sent'
 *
 * Pure functions — no DB or network side effects.
 */

function pickMethod(result) {
  if (!result || typeof result !== 'object') return null;
  if (typeof result.method === 'string' && result.method.trim()) {
    return result.method.trim();
  }
  const nested = result.sendResult;
  if (nested && typeof nested.method === 'string' && nested.method.trim()) {
    return nested.method.trim();
  }
  return null;
}

function pickSuccess(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.success === true) return true;
  if (result.sendResult && result.sendResult.success === true) return true;
  return false;
}

function pickMessageId(result) {
  if (!result || typeof result !== 'object') return null;
  const candidates = [
    result.messageId,
    result.providerMessageId,
    result.sendResult && result.sendResult.messageId,
    result.sendResult && result.sendResult.providerMessageId
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s.slice(0, 500);
  }
  return null;
}

function base(extra) {
  return {
    classification: 'unknown',
    authoritativeDelivered: false,
    retryable: false,
    ambiguous: false,
    method: null,
    providerMessageId: null,
    reason: 'unknown_result',
    ...extra
  };
}

/**
 * @param {object|null} result
 * @param {object} [context]
 * @param {boolean} [context.hasDefinitivePriorDelivery]
 */
function classifyEmailDeliveryResult(result, context = {}) {
  if (result == null || typeof result !== 'object') {
    return base({
      classification: 'unknown',
      retryable: true,
      reason: 'malformed_or_null_result'
    });
  }

  const method = pickMethod(result);
  const success = pickSuccess(result);
  const providerMessageId = pickMessageId(result);
  const hasPrior = context.hasDefinitivePriorDelivery === true;

  // Explicit ambiguous marker from callers / fixtures
  if (result.ambiguous === true || result.classification === 'ambiguous') {
    return base({
      classification: 'ambiguous',
      ambiguous: true,
      method,
      providerMessageId,
      reason: result.reason || 'ambiguous_outcome'
    });
  }

  if (method === 'logged') {
    return base({
      classification: 'logged_fallback',
      method: 'logged',
      providerMessageId: null,
      retryable: true,
      reason: 'development_logged_fallback_not_delivered'
    });
  }

  if (method === 'unavailable') {
    return base({
      classification: 'unavailable',
      method: 'unavailable',
      providerMessageId: null,
      retryable: true,
      reason: 'smtp_transport_unavailable'
    });
  }

  if (method === 'skipped-duplicate' || result.sendStatus === 'skipped') {
    if (hasPrior) {
      return base({
        classification: 'skipped_duplicate',
        method: method || 'skipped-duplicate',
        providerMessageId: null,
        authoritativeDelivered: false,
        retryable: false,
        reason: 'skipped_duplicate_adopt_prior_delivery',
        // Adoption signal for SM (not a new SMTP send)
        adoptPriorDelivery: true
      });
    }
    return base({
      classification: 'skipped_duplicate',
      method: method || 'skipped-duplicate',
      providerMessageId: null,
      retryable: true,
      reason: 'skipped_duplicate_without_prior_evidence'
    });
  }

  // Authoritative SMTP submit — method must be exactly 'sent'
  if (success === true && method === 'sent') {
    return base({
      classification: 'provider_sent',
      authoritativeDelivered: true,
      method: 'sent',
      providerMessageId,
      reason: 'provider_backed_smtp_submit'
    });
  }

  // Generic success without method:'sent' — fail closed
  if (success === true && method !== 'sent') {
    return base({
      classification: 'unknown',
      method,
      providerMessageId: null,
      retryable: true,
      reason: 'success_without_method_sent'
    });
  }

  if (method === 'failed' || success === false) {
    return base({
      classification: method === 'failed' ? 'smtp_rejected' : 'retryable_failure',
      method: method || 'failed',
      providerMessageId: null,
      retryable: true,
      reason:
        (result.error && String(result.error).slice(0, 200)) ||
        (result.sendResult && result.sendResult.error) ||
        'smtp_or_send_failure'
    });
  }

  return base({
    classification: 'unknown',
    method,
    retryable: true,
    reason: 'unrecognized_send_result'
  });
}

function isAuthoritativeConfirmationDelivery(classification) {
  return Boolean(classification && classification.authoritativeDelivered === true);
}

module.exports = {
  classifyEmailDeliveryResult,
  isAuthoritativeConfirmationDelivery,
  pickMethod,
  pickMessageId
};
