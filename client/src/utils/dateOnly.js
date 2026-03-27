const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/**
 * Converts a Date to local civil date string: YYYY-MM-DD.
 * Never uses UTC conversion.
 */
export function formatDateOnlyLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

/**
 * Parses YYYY-MM-DD into a local Date at local midnight.
 * Returns null for invalid values.
 */
export function parseDateOnlyLocal(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const str = String(value).trim();
  const match = DATE_ONLY_RE.exec(str);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  // Reject rollover dates (e.g. 2026-02-31).
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

/**
 * Compares two date-only values.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareDateOnly(a, b) {
  const left = parseDateOnlyLocal(a);
  const right = parseDateOnlyLocal(b);
  if (!left || !right) return 0;
  if (left.getTime() < right.getTime()) return -1;
  if (left.getTime() > right.getTime()) return 1;
  return 0;
}

/**
 * Adds days to a date-only value and returns local YYYY-MM-DD.
 */
export function addDaysDateOnly(value, days) {
  const base = parseDateOnlyLocal(value);
  if (!base || !Number.isFinite(days)) return '';
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days));
  return formatDateOnlyLocal(next);
}

/**
 * Calendar day difference between date-only values.
 * Equivalent to checkout - checkin nights for civil dates.
 */
export function daysBetweenDateOnly(start, end) {
  const left = parseDateOnlyLocal(start);
  const right = parseDateOnlyLocal(end);
  if (!left || !right) return 0;
  const utcLeft = Date.UTC(left.getFullYear(), left.getMonth(), left.getDate());
  const utcRight = Date.UTC(right.getFullYear(), right.getMonth(), right.getDate());
  return Math.round((utcRight - utcLeft) / 86400000);
}

