import { getUaClass } from '../utils/inAppBrowser';
import { trackFunnelEvent, isFunnelAnalyticsConsented } from '../tracking/funnel';

const CLIENT_ERRORS_ENDPOINT = '/api/client-errors';

export const PAYMENT_RESILIENCE_EVENT_TYPES = Object.freeze([
  'payment_element_slow',
  'payment_element_load_error',
  'stripe_js_load_failed',
  'payment_element_escalated'
]);

const firedKeys = new Set();

function isFunnelTrackingEnabled() {
  return String(import.meta.env.VITE_FUNNEL_TRACKING_ENABLED || '').trim().toLowerCase() === 'true';
}

function buildDedupeKey(eventType, checkoutId) {
  return `${eventType}:${String(checkoutId || '').trim() || 'none'}`;
}

function sendClientErrorBeacon(payload) {
  // Always use fetch with credentials:'omit'. sendBeacon cannot omit cookies on
  // same-origin posts and would leak Stripe mid/sid into /api/client-errors.
  const body = JSON.stringify(payload);
  try {
    fetch(CLIENT_ERRORS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit'
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Fire payment resilience telemetry once per checkoutId+eventType.
 * Always posts to /api/client-errors; also mirrors to funnel when enabled+consented.
 */
export function trackPaymentResilienceEvent(eventType, fields = {}) {
  if (!PAYMENT_RESILIENCE_EVENT_TYPES.includes(eventType)) return;
  if (typeof window === 'undefined') return;

  const checkoutId =
    typeof fields.checkoutId === 'string' ? fields.checkoutId.trim() : '';
  const dedupeKey = buildDedupeKey(eventType, checkoutId);
  if (firedKeys.has(dedupeKey)) return;
  firedKeys.add(dedupeKey);

  const stripeAmountCents = Number(fields.stripeAmountCents);
  const priceShownCents = Number(fields.priceShownCents);
  const amountCents = Number.isFinite(stripeAmountCents)
    ? Math.round(stripeAmountCents)
    : Number.isFinite(priceShownCents)
      ? Math.round(priceShownCents)
      : null;

  const propertyKind =
    fields.propertyKind === 'valley' || fields.propertyKind === 'cabin'
      ? fields.propertyKind
      : null;

  const uaClass = getUaClass();

  const clientErrorPayload = {
    eventType,
    ...(checkoutId ? { checkoutId } : {}),
    ...(amountCents != null && amountCents >= 0 ? { stripeAmountCents: amountCents } : {}),
    uaClass,
    ...(propertyKind ? { propertyKind } : {})
  };

  sendClientErrorBeacon(clientErrorPayload);

  if (isFunnelTrackingEnabled() && isFunnelAnalyticsConsented()) {
    trackFunnelEvent(eventType, {
      ...(checkoutId ? { checkoutId } : {}),
      ...(amountCents != null && amountCents >= 0 ? { priceShownCents: amountCents } : {}),
      uaClass,
      ...(propertyKind ? { propertyKind } : {})
    });
  }
}

/** Test helper */
export function __resetPaymentResilienceTelemetryForTests() {
  firedKeys.clear();
}
