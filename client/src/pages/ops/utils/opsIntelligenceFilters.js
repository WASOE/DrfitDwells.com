export const PROPERTY_KIND_OPTIONS = [
  { value: 'cabin', label: 'The Cabin' },
  { value: 'valley', label: 'The Valley' }
];

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function currentMonthDateRange() {
  const now = new Date();
  const from = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${lastDay.getFullYear()}-${pad2(lastDay.getMonth() + 1)}-${pad2(lastDay.getDate())}`;
  return { from, to };
}

export function formatPercent(rate) {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

export function humanizeEventType(eventType) {
  return String(eventType || '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
