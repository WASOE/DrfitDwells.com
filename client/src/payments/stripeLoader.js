import { loadStripe } from '@stripe/stripe-js';

const ATTEMPT_TIMEOUT_MS = 11000;
/** Delays before retries 2–4 (1 initial + 3 retries). */
const BACKOFF_MS = [1000, 3000, 8000];
const MAX_ATTEMPTS = 1 + BACKOFF_MS.length;

let state = {
  pk: null,
  status: 'idle',
  stripe: null,
  promise: null,
  error: null,
  generation: 0
};

const listeners = new Set();

function emit() {
  const snapshot = getStripeLoaderSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      /* ignore subscriber errors */
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('stripe_load_timeout'));
    }, ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function resolvePublishableKey(pk) {
  const key = typeof pk === 'string' ? pk.trim() : '';
  if (key) return key;
  const fromEnv = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
  return fromEnv || null;
}

export function getStripeLoaderSnapshot() {
  return {
    status: state.status,
    stripe: state.stripe,
    error: state.error,
    stripePromise: state.promise
  };
}

export function subscribeStripeLoader(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function runLoad(pk, generation) {
  let resolveOuter;
  const outerPromise = new Promise((resolve) => {
    resolveOuter = resolve;
  });

  state = {
    ...state,
    pk,
    status: 'loading',
    stripe: null,
    error: null,
    promise: outerPromise
  };
  emit();

  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (generation !== state.generation) {
      return null;
    }
    if (attempt > 0) {
      await sleep(BACKOFF_MS[attempt - 1]);
      if (generation !== state.generation) {
        return null;
      }
    }

    try {
      const stripe = await withTimeout(loadStripe(pk), ATTEMPT_TIMEOUT_MS);
      if (generation !== state.generation) {
        return null;
      }
      if (!stripe) {
        throw new Error('stripe_load_null');
      }
      state = {
        ...state,
        status: 'ready',
        stripe,
        error: null,
        promise: Promise.resolve(stripe)
      };
      resolveOuter(stripe);
      emit();
      return stripe;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err || 'stripe_load_failed'));
    }
  }

  if (generation !== state.generation) {
    return null;
  }

  state = {
    ...state,
    status: 'failed',
    stripe: null,
    error: lastError || new Error('stripe_load_failed'),
    promise: Promise.resolve(null)
  };
  resolveOuter(null);
  emit();
  return null;
}

/**
 * Start or reuse Stripe.js load (singleton per publishable key).
 */
export function ensureStripeLoaded(publishableKey) {
  const pk = resolvePublishableKey(publishableKey);
  if (!pk) {
    state = {
      ...state,
      pk: null,
      status: 'failed',
      stripe: null,
      error: new Error('missing_publishable_key'),
      promise: Promise.resolve(null)
    };
    emit();
    return getStripeLoaderSnapshot();
  }

  if (state.pk === pk && (state.status === 'loading' || state.status === 'ready')) {
    return getStripeLoaderSnapshot();
  }

  if (state.pk === pk && state.status === 'failed') {
    return getStripeLoaderSnapshot();
  }

  state.generation += 1;
  const generation = state.generation;
  void runLoad(pk, generation);
  return getStripeLoaderSnapshot();
}

/**
 * Clear cache and re-run the full timeout + backoff schedule.
 */
export function retryStripeLoad(publishableKey) {
  const nextGeneration = state.generation + 1;
  state = {
    pk: null,
    status: 'idle',
    stripe: null,
    promise: null,
    error: null,
    generation: nextGeneration
  };
  emit();
  return ensureStripeLoaded(publishableKey);
}

export function getStripePromise() {
  if (!state.promise) {
    ensureStripeLoaded();
  }
  return state.promise || Promise.resolve(null);
}

/** Test helper — reset singleton between unit tests. */
export function __resetStripeLoaderForTests() {
  state = {
    pk: null,
    status: 'idle',
    stripe: null,
    promise: null,
    error: null,
    generation: 0
  };
  listeners.clear();
}

export const STRIPE_LOADER_ATTEMPT_TIMEOUT_MS = ATTEMPT_TIMEOUT_MS;
export const STRIPE_LOADER_BACKOFF_MS = BACKOFF_MS;
export const STRIPE_LOADER_MAX_ATTEMPTS = MAX_ATTEMPTS;
