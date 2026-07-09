import api from './api';

export const locationInventoryAPI = {
  getInventory: (locationKeyOrSlug = 'the-valley') =>
    api.get(`/public/location-inventory/${locationKeyOrSlug}`)
};

export const locationQuoteAPI = {
  quoteTheValley: (data) => api.post('/public/location-quotes/the-valley', data)
};

export const locationCheckoutAPI = {
  createPaymentIntent: (data) => api.post('/public/location-checkout/create-payment-intent', data),
  finalize: (data) => api.post('/public/location-checkout/finalize', data)
};

/** Map finalize / checkout 409s to hold-expiry UX (not raw API errors). */
export function isLocationHoldExpiredError(err) {
  const status = err?.response?.status;
  const message = String(err?.response?.data?.message || err?.message || '');
  return status === 409 && /holds have expired|hold expired|restart checkout/i.test(message);
}
