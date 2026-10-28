/**
 * Compiled checkout payment contract.
 *
 * The production Vite plugin replaces this module with one object literal
 * after import.meta.env substitution. Development and tests keep these calls
 * so the snapshot stays aligned with the flag modules.
 */
import { PRODUCTION_PAYMENT_CONTRACT_VERSION } from '@shared/payments/productionPaymentContract';
import { isCheckoutSessionV2Enabled } from './checkoutSessionV2Flags';
import {
  isFinalizeIntentPersistEnabled,
  isFinalizeIntentRequiredForPiEnabled
} from './finalizeIntentFlags';

export function readPaymentContractCompiled() {
  return {
    paymentContractVersion: PRODUCTION_PAYMENT_CONTRACT_VERSION,
    checkoutSessionV2: isCheckoutSessionV2Enabled(),
    finalizeIntentPersist: isFinalizeIntentPersistEnabled(),
    finalizeIntentRequiredForPi: isFinalizeIntentRequiredForPiEnabled(),
    frontendRelease:
      import.meta.env.VITE_FRONTEND_RELEASE ||
      import.meta.env.VITE_APP_RELEASE ||
      import.meta.env.VITE_RELEASE_VERSION ||
      null
  };
}
