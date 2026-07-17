import { useCallback, useEffect, useRef, useState } from 'react';

const SLOW_HINT_MS = 9000;
const ESCALATE_MS = 15000;

/**
 * PaymentElement readiness / slow / error / remount recovery.
 * Does not create PaymentIntents — remount keeps the same clientSecret.
 */
export function useStripeElementsGuard({ active = false } = {}) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [elementsRemountKey, setElementsRemountKey] = useState(0);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setReady(false);
      setLoadError(false);
      setSlowHint(false);
      setEscalated(false);
      return undefined;
    }

    generationRef.current += 1;
    const generation = generationRef.current;
    setReady(false);
    setLoadError(false);
    setSlowHint(false);
    setEscalated(false);

    const slowTimer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      setSlowHint(true);
    }, SLOW_HINT_MS);

    const escalateTimer = window.setTimeout(() => {
      if (generation !== generationRef.current) return;
      setEscalated(true);
    }, ESCALATE_MS);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(escalateTimer);
    };
  }, [active, elementsRemountKey]);

  const onReady = useCallback(() => {
    setReady(true);
    setLoadError(false);
    setSlowHint(false);
    setEscalated(false);
  }, []);

  const onLoadError = useCallback(() => {
    setLoadError(true);
    setSlowHint(false);
    setEscalated(true);
  }, []);

  const retryElements = useCallback(() => {
    setElementsRemountKey((key) => key + 1);
  }, []);

  const terminal = Boolean(loadError || escalated);

  return {
    ready,
    loadError,
    slowHint,
    escalated,
    terminal,
    elementsRemountKey,
    onReady,
    onLoadError,
    retryElements
  };
}

export const STRIPE_ELEMENTS_SLOW_HINT_MS = SLOW_HINT_MS;
export const STRIPE_ELEMENTS_ESCALATE_MS = ESCALATE_MS;
