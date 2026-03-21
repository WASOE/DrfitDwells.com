/** Pure UI date helpers (no business rules). Server sends exclusive end dates. */

export function parseIsoDay(iso) {
  if (!iso) return null;
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDaysUtc(date, n) {
  const x = new Date(date.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

export function ymdUtc(d) {
  return d.toISOString().slice(0, 10);
}

export function eachDayKeyInRange(startInclusive, endExclusive) {
  const keys = [];
  let cur = new Date(startInclusive.getTime());
  const end = new Date(endExclusive.getTime());
  while (cur < end) {
    keys.push(ymdUtc(cur));
    cur = addDaysUtc(cur, 1);
  }
  return keys;
}

/** Monday-first grid: 6 rows × 7 days covering the month. */
export function buildMonthGrid(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const gridStart = addDaysUtc(first, -startPad);
  const weeks = [];
  let cursor = new Date(gridStart.getTime());
  for (let w = 0; w < 6; w += 1) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(new Date(cursor.getTime()));
      cursor = addDaysUtc(cursor, 1);
    }
    weeks.push(week);
  }
  return { monthStart: first, monthEndExclusive: next, weeks };
}
