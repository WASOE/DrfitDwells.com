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

export function markCleaned(bookingId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${bookingId}/mark-cleaned`,
    { cleaningDate },
    { headers: authHeaders() }
  );
}

export function unmarkCleaned(bookingId, cleaningDate) {
  return api.post(
    `/ops/cleaning/records/${bookingId}/unmark-cleaned`,
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

export function updateDayInputs({ date, propertyKind, inputs, perCheckoutInputs }) {
  return api.put(
    '/ops/cleaning/day-inputs',
    { date, propertyKind, inputs, perCheckoutInputs },
    { headers: authHeaders() }
  );
}

export function getPricingPolicy() {
  return api.get('/ops/cleaning/pricing-policy', { headers: authHeaders() });
}

export function updatePricingPolicy(propertyKind, items) {
  return api.put(
    '/ops/cleaning/pricing-policy',
    { propertyKind, items },
    { headers: authHeaders() }
  );
}

export default {
  getCleaningSchedule,
  getCleaningPaymentSummary,
  markCleaned,
  unmarkCleaned,
  markPaid,
  unmarkPaid,
  updateDayInputs,
  getPricingPolicy,
  updatePricingPolicy
};
