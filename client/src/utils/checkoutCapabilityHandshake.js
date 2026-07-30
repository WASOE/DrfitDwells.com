/**
 * Release handshake: compare compiled client checkout flags with live API capabilities.
 * Advisory only — never force-reload (that caused customer-visible instability).
 */
import { isCheckoutSessionV2Enabled } from './checkoutSessionV2Flags';
import {
  isFinalizeIntentPersistEnabled,
  isFinalizeIntentRequiredForPiEnabled
} from './finalizeIntentFlags';

export function getClientCheckoutCapabilitySnapshot() {
  return {
    checkoutSessionV2: isCheckoutSessionV2Enabled(),
    finalizeIntentPersist: isFinalizeIntentPersistEnabled(),
    finalizeIntentRequiredForPi: isFinalizeIntentRequiredForPiEnabled(),
    frontendRelease: import.meta.env.VITE_APP_RELEASE || import.meta.env.VITE_RELEASE_VERSION || null
  };
}

/**
 * Returns { ok, reason, shouldReload }.
 * shouldReload is always false — callers must not auto-reload the tab.
 */
export function evaluateCheckoutCapabilityCompatibility(serverCaps, clientCaps = getClientCheckoutCapabilitySnapshot()) {
  if (!serverCaps || typeof serverCaps !== 'object') {
    return { ok: true, reason: 'capabilities_unavailable', shouldReload: false };
  }
  if (serverCaps.requiresFinalizeIntentPayload || serverCaps.finalizeIntentRequiredForPi) {
    if (!clientCaps.checkoutSessionV2 && !clientCaps.finalizeIntentRequiredForPi && !clientCaps.finalizeIntentPersist) {
      return {
        ok: false,
        reason: 'stale_client_missing_finalize_support',
        shouldReload: false
      };
    }
  }
  if (serverCaps.checkoutSessionV2 && !clientCaps.checkoutSessionV2) {
    return {
      ok: false,
      reason: 'stale_client_missing_v2',
      shouldReload: false
    };
  }
  return { ok: true, reason: null, shouldReload: false };
}
