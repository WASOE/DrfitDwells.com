import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  ensureStripeLoaded,
  getStripeLoaderSnapshot,
  retryStripeLoad,
  subscribeStripeLoader
} from './stripeLoader';

function subscribe(callback) {
  return subscribeStripeLoader(callback);
}

function getSnapshot() {
  return getStripeLoaderSnapshot();
}

/**
 * React binding for the singleton Stripe.js loader.
 */
export function useStripeLoader(publishableKey) {
  useEffect(() => {
    ensureStripeLoaded(publishableKey);
  }, [publishableKey]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const retry = useCallback(() => {
    return retryStripeLoad(publishableKey);
  }, [publishableKey]);

  return {
    status: snapshot.status,
    stripe: snapshot.stripe,
    error: snapshot.error,
    stripePromise: snapshot.stripePromise,
    retry
  };
}
