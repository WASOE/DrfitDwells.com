/**
 * Client feature flag for CheckoutSession V2 (must align with server CHECKOUT_SESSION_V2).
 *
 * Strict finalize-intent builds imply V2 payment preparation: if the Vite finalize
 * flags are on but VITE_CHECKOUT_SESSION_V2 was omitted from the build env, treat V2
 * as enabled so guestInfo/legalAcceptance are still submitted.
 */
import {
  isFinalizeIntentPersistEnabled,
  isFinalizeIntentRequiredForPiEnabled
} from './finalizeIntentFlags';

function parseEnvFlag(raw) {
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes';
}

export function isCheckoutSessionV2FlagExplicitlyEnabled() {
  return parseEnvFlag(import.meta.env.VITE_CHECKOUT_SESSION_V2);
}

export function isCheckoutSessionV2Enabled() {
  if (isCheckoutSessionV2FlagExplicitlyEnabled()) {
    return true;
  }
  // Infer V2 when strict finalize flags are compiled into the bundle.
  return isFinalizeIntentPersistEnabled() || isFinalizeIntentRequiredForPiEnabled();
}
