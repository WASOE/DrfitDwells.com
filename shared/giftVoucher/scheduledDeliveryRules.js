/**
 * Sofia-calendar scheduled delivery rules — shared by client validation and server API.
 */

export function sofiaDateIso(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date instanceof Date ? date : new Date(date));
}

export function addCalendarDaysIso(isoDate, days) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function addCalendarMonthsIso(isoDate, months) {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1 + months, d));
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(next.getUTCDate()).padStart(2, '0');
  return `${ny}-${nm}-${nd}`;
}

export function getScheduledDeliveryDateBounds(createdAt = new Date()) {
  const purchaseIso = sofiaDateIso(createdAt);
  return {
    minIso: addCalendarDaysIso(purchaseIso, 1),
    maxIso: addCalendarMonthsIso(purchaseIso, 11)
  };
}

/**
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
export function validateScheduledDeliveryDateIso(selectedIso, purchaseIso = sofiaDateIso()) {
  if (!selectedIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(selectedIso))) {
    return {
      ok: false,
      code: 'MISSING_SCHEDULED_DELIVERY_DATE',
      message: 'deliveryDate is required for scheduled delivery'
    };
  }
  const earliestIso = addCalendarDaysIso(purchaseIso, 1);
  if (selectedIso < earliestIso) {
    return {
      ok: false,
      code: 'INVALID_SCHEDULED_DELIVERY_DATE',
      message: 'Scheduled delivery date must be tomorrow or later'
    };
  }
  const latestIso = addCalendarMonthsIso(purchaseIso, 11);
  if (selectedIso > latestIso) {
    return {
      ok: false,
      code: 'INVALID_SCHEDULED_DELIVERY_DATE',
      message: 'Scheduled delivery date must be within 11 months of purchase'
    };
  }
  const projectedExpiryIso = addCalendarMonthsIso(purchaseIso, 12);
  if (selectedIso >= projectedExpiryIso) {
    return {
      ok: false,
      code: 'INVALID_SCHEDULED_DELIVERY_DATE',
      message: 'Scheduled delivery date must be before voucher expiry'
    };
  }
  return { ok: true };
}
