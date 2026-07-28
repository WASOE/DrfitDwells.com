/**
 * Polling helpers for Batch 9 checkout recovery status.
 * Pure timing / decision logic — easy to unit test.
 */

export const RECOVERY_INITIAL_INTERVAL_MS = 2000;
export const RECOVERY_DELAYED_THRESHOLD_MS = 60_000;
export const RECOVERY_DELAYED_INTERVAL_MS = 8000;
export const RECOVERY_HIDDEN_INTERVAL_MS = 20_000;
export const RECOVERY_MAX_INTERVAL_MS = 15_000;

export const TERMINAL_RECOVERY_STATUSES = new Set([
  'confirmed',
  'needs_review',
  'payment_failed'
]);

export function isTerminalRecoveryStatus(status) {
  return TERMINAL_RECOVERY_STATUSES.has(String(status || ''));
}

export function computeNextPollIntervalMs({
  elapsedMs = 0,
  consecutiveErrors = 0,
  documentHidden = false
} = {}) {
  if (documentHidden) return RECOVERY_HIDDEN_INTERVAL_MS;
  if (elapsedMs >= RECOVERY_DELAYED_THRESHOLD_MS) {
    return RECOVERY_DELAYED_INTERVAL_MS;
  }
  if (consecutiveErrors <= 0) return RECOVERY_INITIAL_INTERVAL_MS;
  const backoff = RECOVERY_INITIAL_INTERVAL_MS * Math.pow(2, Math.min(3, consecutiveErrors));
  return Math.min(RECOVERY_MAX_INTERVAL_MS, backoff);
}

export function shouldShowDelayedCopy(elapsedMs) {
  return Number(elapsedMs) >= RECOVERY_DELAYED_THRESHOLD_MS;
}
