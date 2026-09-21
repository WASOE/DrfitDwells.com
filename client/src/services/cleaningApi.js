import api from './api';

function authHeaders() {
  const token = localStorage.getItem('adminToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildParams({ date, propertyKind }) {
  const params = { date };
  if (propertyKind) params.propertyKind = propertyKind;
  return params;
}

export function getCleaningSchedule({ date, propertyKind }) {
  return api.get('/ops/cleaning/schedule', {
    params: buildParams({ date, propertyKind }),
    headers: authHeaders()
  });
}

export function getCleaningPaymentSummary({ date, propertyKind }) {
  return api.get('/ops/cleaning/payment-summary', {
    params: buildParams({ date, propertyKind }),
    headers: authHeaders()
  });
}

export function getCleaningPayoutSummary({ date }) {
  return api.get('/ops/cleaning/payout-summary', {
    params: { date },
    headers: authHeaders()
  });
}

export function markCleaned(taskId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${encodeURIComponent(taskId)}/mark-cleaned`,
    { cleaningDate },
    { headers: authHeaders() }
  );
}

export function unmarkCleaned(taskId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${encodeURIComponent(taskId)}/unmark-cleaned`,
    { cleaningDate },
    { headers: authHeaders() }
  );
}

export function markTaskPaid(taskId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${encodeURIComponent(taskId)}/mark-task-paid`,
    { cleaningDate },
    { headers: authHeaders() }
  );
}

export function unmarkTaskPaid(taskId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${encodeURIComponent(taskId)}/unmark-task-paid`,
    { cleaningDate },
    { headers: authHeaders() }
  );
}

export function markPaid({ date, propertyKind }) {
  return api.post(
    '/ops/cleaning/payments/mark-paid',
    { date, propertyKind },
    { headers: authHeaders() }
  );
}

export function unmarkPaid({ date, propertyKind }) {
  return api.post(
    '/ops/cleaning/payments/unmark-paid',
    { date, propertyKind },
    { headers: authHeaders() }
  );
}

export function getPricingPolicy() {
  return api.get('/ops/cleaning/pricing-policy', { headers: authHeaders() });
}

export function updatePricingPolicy(propertyKind, rules) {
  return api.put(
    '/ops/cleaning/pricing-policy',
    { propertyKind, rules },
    { headers: authHeaders() }
  );
}

export function getCleaningInventoryTags(propertyKind = null) {
  const params = propertyKind ? { propertyKind } : {};
  return api.get('/ops/cleaning/inventory-tags', { params, headers: authHeaders() });
}

export function updateCabinCleaningTags(cabinId, cleaningTags) {
  return api.patch(
    `/ops/cleaning/inventory-tags/cabin/${cabinId}`,
    { cleaningTags },
    { headers: authHeaders() }
  );
}

export function updateCabinTypeCleaningTags(cabinTypeId, cleaningTags) {
  return api.patch(
    `/ops/cleaning/inventory-tags/cabin-type/${cabinTypeId}`,
    { cleaningTags },
    { headers: authHeaders() }
  );
}

export default {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  markCleaned,
  unmarkCleaned,
  markTaskPaid,
  unmarkTaskPaid,
  markPaid,
  unmarkPaid,
  getPricingPolicy,
  updatePricingPolicy,
  getCleaningInventoryTags,
  updateCabinCleaningTags,
  updateCabinTypeCleaningTags
};
