import { useCallback, useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

let cachedKey;
let cachedPromise;

export function getStripePromise() {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !/^pk_(live|test)_[A-Za-z0-9]+$/.test(key)) {
    return null;
  }
  if (key !== cachedKey) {
    cachedKey = key;
    try {
      cachedPromise = normalizeStripeLoad(loadStripe(key));
    } catch (error) {
      cachedPromise = normalizeStripeLoad(Promise.reject(error));
    }
  }
  return cachedPromise;
}

// Keeps a rejected Stripe.js load from surfacing as an unhandled rejection while
// still rejecting for every consumer that awaits the returned promise.
function normalizeStripeLoad(promise) {
  const settled = Promise.resolve(promise);
  settled.catch(() => {});
  return settled;
}

// Clears the memoized loader so a retry can re-attempt loading Stripe.js.
export function resetStripePromise() {
  cachedKey = undefined;
  cachedPromise = undefined;
}

export const STRIPE_STATUS = {
  UNAVAILABLE: 'unavailable',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error'
};

export function useStripeAvailability() {
  const [stripePromise, setStripePromise] = useState(() => getStripePromise());
  const [status, setStatus] = useState(() =>
    getStripePromiseInitialStatus(stripePromise)
  );

  useEffect(() => {
    if (!stripePromise) {
      setStatus(STRIPE_STATUS.UNAVAILABLE);
      return undefined;
    }
    let active = true;
    setStatus(STRIPE_STATUS.LOADING);
    Promise.resolve(stripePromise).then(
      (client) => {
        if (!active) return;
        setStatus(client ? STRIPE_STATUS.READY : STRIPE_STATUS.ERROR);
      },
      (error) => {
        console.error('Stripe client initialization failed:', error);
        if (active) setStatus(STRIPE_STATUS.ERROR);
      }
    );
    return () => {
      active = false;
    };
  }, [stripePromise]);

  const retry = useCallback(() => {
    resetStripePromise();
    setStripePromise(() => getStripePromise());
  }, []);

  const unavailable =
    status === STRIPE_STATUS.UNAVAILABLE || status === STRIPE_STATUS.ERROR;

  return {
    stripePromise: unavailable ? null : stripePromise,
    status,
    unavailable,
    ready: status === STRIPE_STATUS.READY,
    retry
  };
}

function getStripePromiseInitialStatus(promise) {
  return promise ? STRIPE_STATUS.LOADING : STRIPE_STATUS.UNAVAILABLE;
}
