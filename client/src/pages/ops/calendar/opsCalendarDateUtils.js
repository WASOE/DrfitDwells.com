/** Pure UI date helpers. Server uses exclusive end + Europe/Sofia; month view must match Sofia civil days. */
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';

export const OPS_CALENDAR_TZ = 'Europe/Sofia';

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

/**
 * Sofia-local calendar day keys occupied by [startDate, endDate) block instants.
 * Matches server enumerateOccupiedDayKeysInWindow semantics when occupiedDayKeys is absent.
 */
export function occupiedDayKeysFromBlockSofia(block) {
  const start = new Date(block.startDate);
  const endEx = new Date(block.endDate);
  const startYmd = formatInTimeZone(start, OPS_CALENDAR_TZ, 'yyyy-MM-dd');
  const endBoundaryYmd = formatInTimeZone(endEx, OPS_CALENDAR_TZ, 'yyyy-MM-dd');
  let cur = toDate(`${startYmd} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
  const endBoundary = toDate(`${endBoundaryYmd} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
  const keys = [];
  while (cur.getTime() < endBoundary.getTime()) {
    keys.push(formatInTimeZone(cur, OPS_CALENDAR_TZ, 'yyyy-MM-dd'));
    cur = addDays(cur, 1);
  }
  return keys;
}

function resolveOccupiedKeys(block) {
  const fromApi = block?.render?.occupiedDayKeys;
  if (Array.isArray(fromApi) && fromApi.length > 0) return fromApi;
  return occupiedDayKeysFromBlockSofia(block);
}

/**
 * Monday-first grid: 6 rows × 7 days; each cell is a Sofia civil date.
 */
export function buildSofiaMonthGrid(year, monthIndex) {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const firstOfMonth = toDate(`${year}-${mm}-01 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
  const isoDow = Number(formatInTimeZone(firstOfMonth, OPS_CALENDAR_TZ, 'i'));
  const startPad = (isoDow + 6) % 7;
  const gridStart = addDays(firstOfMonth, -startPad);

  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const row = [];
    for (let i = 0; i < 7; i += 1) {
      const at = addDays(gridStart, w * 7 + i);
      row.push({
        at,
        ymd: formatInTimeZone(at, OPS_CALENDAR_TZ, 'yyyy-MM-dd'),
        dayOfMonth: Number(formatInTimeZone(at, OPS_CALENDAR_TZ, 'd'))
      });
    }
    weeks.push(row);
  }

  const monthStartYmd = `${year}-${mm}-01`;
  let ny = year;
  let nmi = monthIndex + 1;
  if (nmi > 11) {
    ny += 1;
    nmi = 0;
  }
  const monthEndExclusiveYmd = `${ny}-${String(nmi + 1).padStart(2, '0')}-01`;

  return { weeks, monthStartYmd, monthEndExclusiveYmd, firstOfMonthAt: firstOfMonth };
}

export function formatSofiaMonthTitle(year, monthIndex) {
  const mm = String(monthIndex + 1).padStart(2, '0');
  const mid = toDate(`${year}-${mm}-15 12:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
  return formatInTimeZone(mid, OPS_CALENDAR_TZ, 'LLLL yyyy');
}

export function sofiaNowYearMonth() {
  const ymd = formatInTimeZone(new Date(), OPS_CALENDAR_TZ, 'yyyy-MM-dd');
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7)) - 1;
  return { year: y, monthIndex: m };
}

export function addOneMonth(year, monthIndex, delta) {
  let m = monthIndex + delta;
  let y = year;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  return { year: y, monthIndex: m };
}

/**
 * Bar segments for one week row; placement uses Sofia YMD keys (API occupiedDayKeys or local fallback).
 */
export function computeWeekBarSegments(weekCells, blocks, cabinId) {
  const weekYmcs = weekCells.map((c) => c.ymd);
  const segs = [];

  for (const b of blocks) {
    if (String(b.cabinId) !== String(cabinId)) continue;
    if (b.status === 'tombstoned') continue;
    const keys = new Set(resolveOccupiedKeys(b));

    let i = 0;
    while (i < 7) {
      if (!keys.has(weekYmcs[i])) {
        i += 1;
        continue;
      }
      const start = i;
      while (i < 7 && keys.has(weekYmcs[i])) i += 1;
      const end = i;
      const span = end - start;
      segs.push({
        block: b,
        startOffset: start,
        endOffset: end,
        span,
        leftPct: (start / 7) * 100,
        widthPct: (span / 7) * 100,
        lane: 0
      });
    }
  }

  segs.sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const laneEnds = [];
  segs.forEach((s) => {
    let lane = 0;
    while (laneEnds[lane] != null && s.startOffset < laneEnds[lane]) {
      lane += 1;
    }
    s.lane = lane;
    laneEnds[lane] = s.endOffset;
  });
  const laneCount = laneEnds.length || 0;
  return { segs, laneCount: Math.max(1, laneCount) };
}

/** @deprecated Use buildSofiaMonthGrid for OPS month view */
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
