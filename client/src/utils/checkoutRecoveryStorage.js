/**
 * Durable client state for post-payment recovery (refresh / return safe).
 * Stores no Stripe secrets and no guest PII beyond optional email for success page.
 */

const PREFIX = 'dd_checkout_recovery_';

export function recoveryStorageKey(checkoutId) {
  return `${PREFIX}${String(checkoutId || '').trim()}`;
}

export function readCheckoutRecoveryState(checkoutId) {
  if (typeof sessionStorage === 'undefined') return null;
  const id = String(checkoutId || '').trim();
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(recoveryStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      checkoutId: id,
      paymentMayHaveSucceeded: parsed.paymentMayHaveSucceeded === true,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
      guestEmail:
        typeof parsed.guestEmail === 'string' ? parsed.guestEmail.trim().toLowerCase() : ''
    };
  } catch {
    return null;
  }
}

export function writeCheckoutRecoveryState(checkoutId, patch = {}) {
  if (typeof sessionStorage === 'undefined') return;
  const id = String(checkoutId || '').trim();
  if (!id) return;
  const prev = readCheckoutRecoveryState(id) || {};
  const next = {
    checkoutId: id,
    paymentMayHaveSucceeded:
      patch.paymentMayHaveSucceeded != null
        ? Boolean(patch.paymentMayHaveSucceeded)
        : prev.paymentMayHaveSucceeded === true,
    startedAt: patch.startedAt || prev.startedAt || new Date().toISOString(),
    guestEmail:
      patch.guestEmail != null
        ? String(patch.guestEmail).trim().toLowerCase()
        : prev.guestEmail || ''
  };
  try {
    sessionStorage.setItem(recoveryStorageKey(id), JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

export function clearCheckoutRecoveryState(checkoutId) {
  if (typeof sessionStorage === 'undefined') return;
  const id = String(checkoutId || '').trim();
  if (!id) return;
  try {
    sessionStorage.removeItem(recoveryStorageKey(id));
  } catch {
    /* ignore */
  }
}
