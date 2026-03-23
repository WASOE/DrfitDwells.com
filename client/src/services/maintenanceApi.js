import api from './api';

function authHeaders() {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const maintenanceApi = {
  session: () => api.get('/maintenance/session', { headers: authHeaders() }),
  cabins: (params) => api.get('/maintenance/cabins', { params, headers: authHeaders() }),
  reservations: (params) => api.get('/maintenance/reservations', { params, headers: authHeaders() }),
  archiveCabin: (id, reason) =>
    api.post(`/maintenance/cabins/${id}/archive`, { reason }, { headers: authHeaders() }),
  deleteFixtureCabin: (id, reason) =>
    api.post(`/maintenance/cabins/${id}/delete-fixture`, { reason }, { headers: authHeaders() }),
  archiveReservation: (id, reason) =>
    api.post(`/maintenance/reservations/${id}/archive`, { reason }, { headers: authHeaders() }),
  deleteFixtureReservation: (id, reason) =>
    api.post(`/maintenance/reservations/${id}/delete-fixture`, { reason }, { headers: authHeaders() }),
  previewFixtureContamination: () =>
    api.get('/maintenance/cleanup/preview/fixture-contamination', { headers: authHeaders() }),
  previewUnsafeBlocking: () =>
    api.get('/maintenance/cleanup/preview/unsafe-blocking', { headers: authHeaders() }),
  previewIcsExclusion: () =>
    api.get('/maintenance/cleanup/preview/ics-exclusion', { headers: authHeaders() }),
  previewStaleBlocks: () =>
    api.get('/maintenance/cleanup/preview/stale-reservation-blocks', { headers: authHeaders() }),
  applyFixtureContamination: (reason) =>
    api.post('/maintenance/cleanup/fixture-contamination', { reason }, { headers: authHeaders() }),
  applyStaleReservationBlocks: (reason) =>
    api.post('/maintenance/cleanup/stale-reservation-blocks', { reason }, { headers: authHeaders() }),
  /** Internal sync (same as ops tooling; admin-only on server). */
  internalSyncConfigure: (body) =>
    api.post('/internal/sync/airbnb-ical/configure', body, { headers: authHeaders() }),
  internalSyncRun: (body) => api.post('/internal/sync/airbnb-ical/run', body, { headers: authHeaders() })
};

export default maintenanceApi;
