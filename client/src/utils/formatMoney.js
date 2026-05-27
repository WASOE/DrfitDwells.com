function normalizeDisplayCurrency(currency) {
  const code = String(currency || 'EUR').trim().toUpperCase();
  return code || 'EUR';
}

export function formatMoney(amount, currency = 'EUR') {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizeDisplayCurrency(currency),
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${normalizeDisplayCurrency(currency)}`;
  }
}

export function formatMoneyFromCents(cents, currency = 'EUR') {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '—';
  return formatMoney(n / 100, currency);
}
