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
    cachedPromise = loadStripe(key);
  }
  return cachedPromise;
}
