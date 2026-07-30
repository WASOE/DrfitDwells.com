/**
 * Client feature flags for Batch 2 finalizeIntent persistence.
 * Must align with server FINALIZE_INTENT_PERSIST / FINALIZE_INTENT_REQUIRED_FOR_PI.
 * Default OFF when unset (safe staged rollout).
 *
 * IMPORTANT: These are Vite compile-time env vars (`import.meta.env.VITE_*`).
 * Changing them requires a client rebuild and redeploy; restarting only the API
 * does not update the browser bundle. Keep VITE_* in lockstep with server flags
 * for the same release, otherwise persist/required mismatch fails closed
 * (persist 403 / FINALIZE_INTENT_REQUIRED) and must not charge without required persistence.
 */
import { parseBooleanFlag } from '@shared/env/parseBooleanFlag';

export function isFinalizeIntentPersistEnabled() {
  return parseBooleanFlag(import.meta.env.VITE_FINALIZE_INTENT_PERSIST);
}

export function isFinalizeIntentRequiredForPiEnabled() {
  return parseBooleanFlag(import.meta.env.VITE_FINALIZE_INTENT_REQUIRED_FOR_PI);
}
