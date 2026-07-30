/**
 * Client feature flag for CheckoutSession V2 (must align with server CHECKOUT_SESSION_V2).
 *
 * Explicit VITE_CHECKOUT_SESSION_V2 only. Finalize-intent Vite flags must not imply V2:
 * that hid misconfigured builds and made client behavior diverge from ops intent.
 * Payment preparation still attaches guestInfo/legalAcceptance whenever guest+legal
 * are ready (ConfirmBooking), independent of this flag.
 */
import { parseBooleanFlag } from '@shared/env/parseBooleanFlag';

export function isCheckoutSessionV2FlagExplicitlyEnabled() {
  return parseBooleanFlag(import.meta.env.VITE_CHECKOUT_SESSION_V2);
}

export function isCheckoutSessionV2Enabled() {
  return isCheckoutSessionV2FlagExplicitlyEnabled();
}
