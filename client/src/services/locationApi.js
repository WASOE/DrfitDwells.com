import api from './api';

/** Thrown when location availability cannot be loaded (incl. 422 inventory gaps). */
export class LocationAvailabilityError extends Error {
  constructor(message, { status = null, code = null, details = null } = {}) {
    super(message);
    this.name = 'LocationAvailabilityError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isLocationAvailabilityInventoryGapsError(err) {
  return err instanceof LocationAvailabilityError && err.code === 'inventory_gaps';
}

export const locationInventoryAPI = {
  getInventory: (locationKeyOrSlug = 'the-valley') =>
    api.get(`/public/location-inventory/${locationKeyOrSlug}`)
};

export const locationAvailabilityAPI = {
  getAvailability: async (locationKeyOrSlug, { from, to }) => {
    try {
      const res = await api.get(`/public/location-availability/${locationKeyOrSlug}`, {
        params: { from, to }
      });
      return res.data;
    } catch (err) {
      const status = err?.response?.status ?? null;
      const message =
        err?.response?.data?.message ||
        err?.message ||
        'Could not load location availability';
      const details = err?.response?.data?.details ?? null;
      if (status === 422) {
        throw new LocationAvailabilityError(message, {
          status,
          code: 'inventory_gaps',
          details
        });
      }
      throw new LocationAvailabilityError(message, { status, details });
    }
  }
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
