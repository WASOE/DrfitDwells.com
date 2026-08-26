/**
 * Work Windows display helpers (presentation only — sorting uses durationMinutes).
 */
import { formatInTimeZone } from 'date-fns-tz';

/** @param {number} durationMinutes */
export function formatWorkDurationMinutes(durationMinutes) {
  const mins = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const totalHours = Math.floor(mins / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hoursPart = totalHours % 24;
  if (hoursPart === 0) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return `${days}d ${hoursPart}h`;
}

/**
 * Compact Sofia range for cards / tooltips.
 * Range-truncated free windows must not present query `to` as a real booking start.
 */
export function formatWorkWindowRange(startAt, endAt, timeZone, { continuesBeyondRange = false } = {}) {
  if (!startAt || !endAt || !timeZone) return '';
  const start = formatInTimeZone(new Date(startAt), timeZone, 'd MMM HH:mm');
  if (continuesBeyondRange) {
    const endDay = formatInTimeZone(new Date(endAt), timeZone, 'd MMM');
    return `${start} → at least ${endDay}`;
  }
  const end = formatInTimeZone(new Date(endAt), timeZone, 'd MMM HH:mm');
  return `${start} → ${end}`;
}
