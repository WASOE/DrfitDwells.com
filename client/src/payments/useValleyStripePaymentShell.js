import { useCallback, useEffect, useMemo } from 'react';
import { useStripeLoader } from './useStripeLoader';
import { useStripeElementsGuard } from './useStripeElementsGuard';
import { trackPaymentResilienceEvent } from '../tracking/paymentResilienceTelemetry';
import { isInAppBrowser } from '../utils/inAppBrowser';

const stripePk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/**
 * Shared Stripe shell for cabin-parity recovery on Valley checkout surfaces.
 */
export function useValleyStripePaymentShell({
  active = false,
  checkoutId = null,
  stripeAmountCents = null
} = {}) {
  const { status: stripeLoadStatus, stripePromise, retry: retryStripeJs } = useStripeLoader(stripePk);

  const elementsGuardActive = Boolean(active) && stripeLoadStatus !== 'failed';
  const {
    ready: paymentElementReady,
    loadError: paymentElementLoadError,
    slowHint: stripeSlowHint,
    escalated: paymentElementEscalated,
    terminal: paymentElementTerminal,
    elementsRemountKey,
    onReady: handlePaymentElementReady,
    onLoadError: handlePaymentElementLoadErrorRaw,
    retryElements
  } = useStripeElementsGuard({ active: elementsGuardActive });

  const telemetryFields = useMemo(
    () => ({
      checkoutId: checkoutId || undefined,
      stripeAmountCents: stripeAmountCents ?? undefined,
      propertyKind: 'valley'
    }),
    [checkoutId, stripeAmountCents]
  );

  const handlePaymentElementLoadError = useCallback(
    (event) => {
      handlePaymentElementLoadErrorRaw(event);
      trackPaymentResilienceEvent('payment_element_load_error', telemetryFields);
    },
    [handlePaymentElementLoadErrorRaw, telemetryFields]
  );

  useEffect(() => {
    if (!stripeSlowHint || paymentElementReady || paymentElementLoadError) return;
    trackPaymentResilienceEvent('payment_element_slow', telemetryFields);
  }, [stripeSlowHint, paymentElementReady, paymentElementLoadError, telemetryFields]);

  useEffect(() => {
    if (!paymentElementEscalated || paymentElementReady || paymentElementLoadError) return;
    trackPaymentResilienceEvent('payment_element_escalated', telemetryFields);
  }, [paymentElementEscalated, paymentElementReady, paymentElementLoadError, telemetryFields]);

  useEffect(() => {
    if (stripeLoadStatus !== 'failed' || !active) return;
    trackPaymentResilienceEvent('stripe_js_load_failed', telemetryFields);
  }, [stripeLoadStatus, active, telemetryFields]);

  const handlePaymentRecoveryRetry = useCallback(() => {
    if (stripeLoadStatus === 'failed') {
      retryStripeJs();
      return;
    }
    retryElements();
  }, [stripeLoadStatus, retryStripeJs, retryElements]);

  const inAppBrowser = useMemo(() => isInAppBrowser(), []);

  return {
    stripeLoadStatus,
    stripePromise,
    paymentElementReady,
    paymentElementLoadError,
    stripeSlowHint,
    paymentElementTerminal,
    elementsRemountKey,
    handlePaymentElementReady,
    handlePaymentElementLoadError,
    handlePaymentRecoveryRetry,
    inAppBrowser,
    showTerminalRecovery: stripeLoadStatus === 'failed' || paymentElementTerminal
  };
}
