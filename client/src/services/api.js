import axios from 'axios';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging and adding auth token for admin routes
api.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    // Add admin token for admin routes
    if (config.url?.startsWith('/admin/')) {
      const token = localStorage.getItem('adminToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('API Response Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// API endpoints
export const availabilityAPI = {
  // Search for available cabins
  search: (params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/availability?${queryParams}`);
  },
  // Check pooled availability for a cabin type (A-frames)
  checkCabinType: (slug, params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/availability/cabin-type/${slug}?${queryParams}`);
  }
};

export const cabinAPI = {
  // Get cabin details
  getById: (id) => api.get(`/cabins/${id}`),
  // Get all cabins
  getAll: () => api.get('/cabins')
};

export const cabinTypeAPI = {
  // Get cabin type by slug
  getBySlug: (slug) => api.get(`/cabin-types/${slug}`),
  // Get all cabin types
  getAll: () => api.get('/cabin-types')
};

export const unitAPI = {
  // Get units by cabin type ID
  getByCabinType: (cabinTypeId) => api.get(`/units/by-type/${cabinTypeId}`),
  // Get unit by ID
  getById: (id) => api.get(`/units/${id}`)
};

export const bookingAPI = {
  // Create new booking (supports both cabinId and cabinTypeId)
  create: (bookingData) => api.post('/bookings', bookingData),
  // Get booking details
  getById: (id) => api.get(`/bookings/${id}`),
  // Submit add-on request (Jeep/ATV/Horse/Guide)
  submitAddOnRequest: (id, addOnData) => api.post(`/bookings/${id}/addon-request`, addOnData)
};

export const reviewAPI = {
  // Public: Get cabin reviews
  getByCabinId: (cabinId, params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/cabins/${cabinId}/reviews?${queryParams}`);
  },
  // Admin: List reviews
  list: (params) => {
    const queryParams = new URLSearchParams(params).toString();
    return api.get(`/admin/reviews?${queryParams}`);
  },
  // Admin: Get single review
  getById: (id) => api.get(`/admin/reviews/${id}`),
  // Admin: Create review
  create: (reviewData) => api.post('/admin/reviews', reviewData),
  // Admin: Update review
  update: (id, reviewData) => api.patch(`/admin/reviews/${id}`, reviewData),
  // Admin: Bulk actions
  bulkAction: (actionData) => api.post('/admin/reviews/bulk', actionData),
  // Admin: Recalculate cabin stats
  recalcStats: (cabinId) => api.post(`/admin/reviews/recalc/${cabinId}`)
};

// Health check
export const healthCheck = () => api.get('/health');

export default api;
