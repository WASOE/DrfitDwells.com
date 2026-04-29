import api from './api';

function authHeaders() {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function decodeRoleFromToken() {
  try {
    const token = localStorage.getItem('adminToken');
    if (!token) return 'admin';
    const parts = token.split('.');
    const payload = parts[1];
    if (!payload) return 'admin';
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded.role === 'operator' ? 'operator' : 'admin';
  } catch {
    return 'admin';
  }
}

const opsReadAPI = {
  dashboard: () => api.get('/ops/dashboard', { headers: authHeaders() }),
  calendar: (params) => api.get('/ops/calendar', { params, headers: authHeaders() }),
  reservations: (params) => api.get('/ops/reservations', { params, headers: authHeaders() }),
  reservationsExport: (params) => api.get('/ops/reservations/export', { params, headers: authHeaders() }),
  reservationDetail: (id) => api.get(`/ops/reservations/${id}`, { headers: authHeaders() }),
  reservationEmailEvents: (id, params) =>
    api.get(`/ops/reservations/${id}/email-events`, { params, headers: authHeaders() }),
  health: () => api.get('/ops/health/readiness', { headers: authHeaders() }),
  cabins: (params) => api.get('/ops/cabins', { params, headers: authHeaders() }),
  cabinDetail: (id) => api.get(`/ops/cabins/${id}`, { headers: authHeaders() }),
  sync: (params) => api.get('/ops/sync', { params, headers: authHeaders() }),
  paymentsSummary: () => api.get('/ops/payments/summary', { headers: authHeaders() }),
  paymentsLedger: (params) => api.get('/ops/payments/ledger', { params, headers: authHeaders() }),
  payoutsList: (params) => api.get('/ops/payments/payouts', { params, headers: authHeaders() }),
  payoutDetail: (id) => api.get(`/ops/payments/payouts/${id}`, { headers: authHeaders() }),
  payoutReconciliationSummary: () => api.get('/ops/payments/payouts/reconciliation-summary', { headers: authHeaders() }),
  reviews: (params) => api.get('/ops/reviews', { params, headers: authHeaders() }),
  communicationsOversight: () => api.get('/ops/communications/oversight', { headers: authHeaders() }),
  manualReview: (params) => api.get('/ops/manual-review', { params, headers: authHeaders() }),
  readinessSummary: () => api.get('/ops/readiness/summary', { headers: authHeaders() }),
  readinessModules: () => api.get('/ops/readiness/modules', { headers: authHeaders() }),
  readinessOverlap: () => api.get('/ops/readiness/overlap', { headers: authHeaders() }),
  readinessParityMismatches: () => api.get('/ops/readiness/parity-mismatches', { headers: authHeaders() }),
  readinessQa: () => api.get('/ops/readiness/qa', { headers: authHeaders() })
};

const opsWriteAPI = {
  confirmReservation: (id) => api.post(`/ops/reservations/${id}/actions/confirm`, {}, { headers: authHeaders() }),
  checkInReservation: (id) => api.post(`/ops/reservations/${id}/actions/check-in`, {}, { headers: authHeaders() }),
  completeReservation: (id) => api.post(`/ops/reservations/${id}/actions/complete`, {}, { headers: authHeaders() }),
  cancelReservation: (id, reason) => api.post(`/ops/reservations/${id}/actions/cancel`, { reason }, { headers: authHeaders() }),
  reassignReservation: (id, payload) => api.post(`/ops/reservations/${id}/actions/reassign`, payload, { headers: authHeaders() }),
  editReservationDates: (id, payload) => api.post(`/ops/reservations/${id}/actions/edit-dates`, payload, { headers: authHeaders() }),
  editGuestContact: (id, payload) => api.post(`/ops/reservations/${id}/actions/edit-guest-contact`, payload, { headers: authHeaders() }),
  addReservationNote: (id, content) => api.post(`/ops/reservations/${id}/actions/add-note`, { content }, { headers: authHeaders() }),
  previewBookingLifecycleEmail: (id, body) =>
    api.post(`/ops/reservations/${id}/email-actions/preview`, body, { headers: authHeaders() }),
  resendBookingLifecycleEmail: (id, body) =>
    api.post(`/ops/reservations/${id}/email-actions/resend`, body, { headers: authHeaders() }),
  sendArrivalInstructions: (id) =>
    api.post(`/ops/communications/reservations/${id}/actions/send-arrival-instructions`, {}, { headers: authHeaders() }),
  resendArrivalInstructions: (id) =>
    api.post(`/ops/communications/reservations/${id}/actions/resend-arrival-instructions`, {}, { headers: authHeaders() }),
  markArrivalCompleted: (id) =>
    api.post(`/ops/communications/reservations/${id}/actions/mark-arrival-completed`, {}, { headers: authHeaders() }),
  createManualBlock: (payload) => api.post('/ops/availability/manual-blocks', payload, { headers: authHeaders() }),
  editManualBlock: (blockId, payload) =>
    api.post(`/ops/availability/manual-blocks/${blockId}/edit`, payload, { headers: authHeaders() }),
  removeManualBlock: (blockId, reason) =>
    api.post(`/ops/availability/manual-blocks/${blockId}/remove`, { reason }, { headers: authHeaders() }),
  createMaintenanceBlock: (payload) =>
    api.post('/ops/availability/maintenance-blocks', payload, { headers: authHeaders() }),
  editMaintenanceBlock: (blockId, payload) =>
    api.post(`/ops/availability/maintenance-blocks/${blockId}/edit`, payload, { headers: authHeaders() }),
  removeMaintenanceBlock: (blockId, reason) =>
    api.post(`/ops/availability/maintenance-blocks/${blockId}/remove`, { reason }, { headers: authHeaders() }),
  createManualReservation: (payload) =>
    api.post('/ops/reservations/manual', payload, { headers: authHeaders() }),
  uploadCabinImage: (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/ops/cabins/${id}/images`, fd, {
      headers: { ...authHeaders(), 'Content-Type': 'multipart/form-data' }
    });
  },
  reorderCabinImages: (id, order) =>
    api.patch(`/ops/cabins/${id}/images/reorder`, { order }, { headers: authHeaders() }),
  updateCabinImage: (id, imageId, payload) =>
    api.patch(`/ops/cabins/${id}/images/${imageId}`, payload, { headers: authHeaders() }),
  patchUnitChannelLabel: (unitId, airbnbListingLabel) =>
    api.patch(`/ops/cabins/units/${unitId}`, { airbnbListingLabel }, { headers: authHeaders() })
};

export { opsReadAPI, opsWriteAPI, decodeRoleFromToken };
