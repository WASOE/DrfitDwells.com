/**
 * Client feature flag for CheckoutSession V2 (must align with server CHECKOUT_SESSION_V2).
 */
export function isCheckoutSessionV2Enabled() {
  const raw = import.meta.env.VITE_CHECKOUT_SESSION_V2;
  if (typeof raw !== 'string') {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}
