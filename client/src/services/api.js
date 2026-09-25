import axios from 'axios';
import { getFunnelIdentityPayload } from '../tracking/funnel';

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const isDev = import.meta.env.DEV;

api.interceptors.request.use(
  (config) => {
    if (isDev) console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    const u = config.url || '';
    if (
      u.startsWith('/admin/') ||
      u.startsWith('/maintenance/') ||
      u.startsWith('/internal/') ||
      u.startsWith('/ops/')
    ) {
      const token = localStorage.getItem('adminToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    if (isDev) console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    if (isDev) console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    if (isDev) console.error('API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

export const availabilityAPI = {
  search: (params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/availability?${queryParams}`);
  },
  suggestions: (params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/availability/suggestions?${queryParams}`);
  },
  checkCabinType: (slug, params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/availability/cabin-type/${slug}?${queryParams}`);
  }
};

export const cabinAPI = {
  getById: (id, params) => api.get(`/cabins/${id}`, { params }),
  getBySlug: (slug, params) => api.get(`/cabins/by-slug/${slug}`, { params }),
  getAll: (params) => api.get('/cabins', { params })
};

export const stayAPI = {
  resolve: (slug) => api.get(`/stays/${slug}`)
};

export const cabinTypeAPI = {
  getBySlug: (slug, params) => api.get(`/cabin-types/${slug}`, { params }),
  getAll: (params) => api.get('/cabin-types', { params })
};

export const publicGuideAPI = {
  getValleyStayGuideBySlug: (staySlug) => api.get(`/public/guides/the-valley/stays/${staySlug}`)
};

export const unitAPI = {
  getByCabinType: (cabinTypeId) => api.get(`/units/by-type/${cabinTypeId}`),
  getById: (id) => api.get(`/units/${id}`)
};

export const bookingAPI = {
  create: (bookingData) => api.post('/bookings', { ...bookingData, ...getFunnelIdentityPayload() }),
  getConfig: () => api.get('/bookings/config'),
  quote: (data) => api.post('/bookings/quote', { ...data, ...getFunnelIdentityPayload() }),
  createPaymentIntent: (data) => api.post('/bookings/create-payment-intent', data),
  getCheckoutCapabilities: () => api.get('/bookings/checkout-capabilities'),
  persistFinalizeIntent: (checkoutId, data) =>
    api.put(
      `/bookings/checkout-sessions/${encodeURIComponent(String(checkoutId ?? '').trim())}/finalize-intent`,
      data
    ),
  setPaymentChoice: (checkoutId, data) =>
    api.put(
      `/bookings/checkout-sessions/${encodeURIComponent(String(checkoutId ?? '').trim())}/payment-choice`,
      data
    ),
  getCheckoutSession: async (checkoutId) => {
    const id = String(checkoutId ?? '').trim();
    const res = await api.get(`/bookings/checkout-sessions/${encodeURIComponent(id)}`);
    return {
      success: res.data?.success === true,
      checkoutSession: res.data?.checkoutSession ?? null
    };
  },
  /** Batch 9 — public post-payment recovery status (read-only). */
  getCheckoutRecoveryStatus: async (checkoutId, { signal } = {}) => {
    const id = String(checkoutId ?? '').trim();
    const res = await api.get(`/bookings/checkout-sessions/${encodeURIComponent(id)}/status`, {
      signal
    });
    return {
      success: res.data?.success === true,
      checkoutId: res.data?.checkoutId ?? id,
      status: res.data?.status ?? null,
      paymentReceived: res.data?.paymentReceived === true,
      bookingId: res.data?.bookingId ?? null,
      bookingReference: res.data?.bookingReference ?? null,
      updatedAt: res.data?.updatedAt ?? null,
      canRetryPayment: res.data?.canRetryPayment === true
    };
  },
  getById: (id, email) => {
    const params = {};
    if (email) params.email = email;
    return api.get(`/bookings/${id}`, { params });
  },
  getConfirmation: (id, email) => {
    const params = {};
    if (email) params.email = email;
    return api.get(`/bookings/${id}/confirmation`, { params });
  },
  getRefundStatus: (paymentIntentId, email) =>
    api.get('/bookings/refund-status', { params: { paymentIntentId, email } }),
  submitAddOnRequest: (id, addOnData) => api.post(`/bookings/${id}/addon-request`, addOnData),
  /** Guest-verified purchase payload for browser tags; Meta CAPI retries if not yet sent (primary send on booking confirm). */
  postPurchaseTracking: (id, email) =>
    api.post(`/bookings/${id}/purchase-tracking`, { email })
};

export const giftVoucherAPI = {
  getConfig: () => api.get('/gift-vouchers/config'),
  quote: (data) => api.post('/gift-vouchers/quote', data),
  createPaymentIntent: (data) => api.post('/gift-vouchers/create-payment-intent', data)
};

export const promoAdminAPI = {
  list: () => api.get('/admin/promo-codes'),
  create: (data) => api.post('/admin/promo-codes', data),
  update: (id, data) => api.patch(`/admin/promo-codes/${id}`, data)
};

/** RP2 RatePlan management API (ops UI). Uses admin JWT via interceptor. */
export const ratePlanAdminAPI = {
  list: (params = {}) => api.get('/admin/rate-plans', { params }),
  create: (data) => api.post('/admin/rate-plans', data),
  update: (id, data) => api.patch(`/admin/rate-plans/${id}`, data),
  clone: (id) => api.post(`/admin/rate-plans/${id}/clone`, {}),
  activate: (id, data) => api.post(`/admin/rate-plans/${id}/activate`, data),
  retire: (id, data) => api.post(`/admin/rate-plans/${id}/retire`, data)
};

/** OPS Packages API. Uses the same RatePlan lifecycle under a package-specific route. */
export const packageAdminAPI = {
  list: (params = {}) => api.get('/admin/packages', { params: { ...params, type: 'fixed_package' } }),
  create: (data) => api.post('/admin/packages', { ...data, type: 'fixed_package' }),
  update: (id, data) => api.patch(`/admin/packages/${id}`, { ...data, type: 'fixed_package' }),
  clone: (id) => api.post(`/admin/packages/${id}/clone`, {}),
  activate: (id, data) => api.post(`/admin/packages/${id}/activate`, data),
  retire: (id, data) => api.post(`/admin/packages/${id}/retire`, data)
};

export const pricingOverridesAPI = {
  calendar: (params) => api.get('/ops/pricing-overrides', { params }),
  saveRange: (data) => api.put('/ops/pricing-overrides/range', data),
  clearRange: (data) => api.delete('/ops/pricing-overrides/range', { data })
};

/** SP7 PaymentTermTemplate management API. */
export const paymentTermAdminAPI = {
  list: (params = {}) => api.get('/admin/payment-terms', { params }),
  get: (id) => api.get(`/admin/payment-terms/${id}`),
  create: (data) => api.post('/admin/payment-terms', data),
  update: (id, data) => api.patch(`/admin/payment-terms/${id}`, data),
  clone: (id) => api.post(`/admin/payment-terms/${id}/clone`, {}),
  activate: (id, data = {}) => api.post(`/admin/payment-terms/${id}/activate`, data),
  retire: (id, data = {}) => api.post(`/admin/payment-terms/${id}/retire`, data)
};

export const reviewAPI = {
  getByCabinId: (cabinId, params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/cabins/${cabinId}/reviews?${queryParams}`);
  },
  list: (params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/admin/reviews?${queryParams}`);
  },
  getById: (id) => api.get(`/admin/reviews/${id}`),
  create: (reviewData) => api.post('/admin/reviews', reviewData),
  update: (id, reviewData) => api.patch(`/admin/reviews/${id}`, reviewData),
  bulkAction: (actionData) => api.post('/admin/reviews/bulk', actionData),
  recalcStats: (cabinId) => api.post(`/admin/reviews/recalc/${cabinId}`)
};

export const healthCheck = () => api.get('/health');

export default api;
