/**
 * Batch 9 — Customer-facing checkout recovery UX flag.
 * Must align with server CHECKOUT_RECOVERY_UX.
 * Default OFF when unset.
 */

function parseEnvFlag(raw) {
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'on' ||
    normalized === 'yes'
  );
}

export function isCheckoutRecoveryUxEnabled() {
  return parseEnvFlag(import.meta.env.VITE_CHECKOUT_RECOVERY_UX);
}
