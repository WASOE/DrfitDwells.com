/**
 * Release handshake: compare compiled client checkout flags with live API capabilities.
 * Stale-client reasons set shouldReload so callers can attempt a one-shot SW/cache recovery.
 * Server-side mismatches never request a reload (refresh cannot fix API config).
 */
import { readPaymentContractCompiled } from './paymentContractCompiled';

export function getClientCheckoutCapabilitySnapshot() {
  const compiled = readPaymentContractCompiled();
  return {
    checkoutSessionV2: compiled.checkoutSessionV2,
    finalizeIntentPersist: compiled.finalizeIntentPersist,
    finalizeIntentRequiredForPi: compiled.finalizeIntentRequiredForPi,
    frontendRelease: compiled.frontendRelease,
    paymentContractVersion: compiled.paymentContractVersion
  };
}

/**
 * Returns { ok, reason, shouldReload }.
 * shouldReload is true only for stale_client_* (self-healable via SW/cache update).
 */
export function evaluateCheckoutCapabilityCompatibility(
  serverCaps,
  clientCaps = getClientCheckoutCapabilitySnapshot()
) {
  if (!serverCaps || typeof serverCaps !== 'object') {
    return { ok: true, reason: 'capabilities_unavailable', shouldReload: false };
  }
  if (
    serverCaps.paymentContractVersion &&
    clientCaps.paymentContractVersion &&
    serverCaps.paymentContractVersion !== clientCaps.paymentContractVersion
  ) {
    return {
      ok: false,
      reason: 'payment_contract_version_mismatch',
      shouldReload: false
    };
  }
  if (clientCaps.finalizeIntentPersist && serverCaps.finalizeIntentPersist === false) {
    return {
      ok: false,
      reason: 'server_finalize_intent_persist_disabled',
      shouldReload: false
    };
  }
  if (clientCaps.finalizeIntentRequiredForPi && serverCaps.finalizeIntentRequiredForPi === false) {
    return {
      ok: false,
      reason: 'server_finalize_intent_required_disabled',
      shouldReload: false
    };
  }
  if (serverCaps.requiresFinalizeIntentPayload || serverCaps.finalizeIntentRequiredForPi) {
    if (
      !clientCaps.checkoutSessionV2 &&
      !clientCaps.finalizeIntentRequiredForPi &&
      !clientCaps.finalizeIntentPersist
    ) {
      return {
        ok: false,
        reason: 'stale_client_missing_finalize_support',
        shouldReload: true
      };
    }
  }
  if (serverCaps.checkoutSessionV2 && !clientCaps.checkoutSessionV2) {
    return {
      ok: false,
      reason: 'stale_client_missing_v2',
      shouldReload: true
    };
  }
  return { ok: true, reason: null, shouldReload: false };
}

export function customerMessageForCheckoutCapability(compat) {
  if (!compat || compat.ok) return null;
  if (
    compat.reason === 'server_finalize_intent_persist_disabled' ||
    compat.reason === 'server_finalize_intent_required_disabled' ||
    compat.reason === 'payment_contract_version_mismatch'
  ) {
    return 'Checkout is temporarily unavailable. Please try again shortly.';
  }
  return 'This page is out of date for secure checkout. Please refresh once, then try again.';
}
