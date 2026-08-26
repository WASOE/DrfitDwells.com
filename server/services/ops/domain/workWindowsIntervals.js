/**
 * Work Windows interval math (planning overlay only).
 * Inventory night semantics remain [checkIn, checkOut) Sofia civil days — unchanged.
 */
'use strict';

const moment = require('moment-timezone');
const {
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  formatSofiaDateOnly
} = require('../../../utils/dateTime');

const STATES = Object.freeze({
  OCCUPIED: 'occupied',
  TURNAROUND: 'turnaround',
  FREE: 'free',
  BLOCKED: 'blocked'
});

const MAX_WORK_WINDOWS_EXCLUSIVE_DAYS = 92;
const BEST_WINDOWS_CAP = 10;

function parseSofiaWall(dateOnly, hm) {
  const m = moment.tz(`${dateOnly} ${hm}`, 'YYYY-MM-DD HH:mm', PROPERTY_TIMEZONE);
  if (!m.isValid()) {
    throw new Error(`Invalid Sofia wall time: ${dateOnly} ${hm}`);
  }
  return m;
}

/**
 * Guest practical occupancy: [checkIn @ 15:00, checkOut @ 11:00) Europe/Sofia.
 * @param {Date|string} checkIn
 * @param {Date|string} checkOut
 * @returns {{ startMs: number, endMs: number, startAt: Date, endAt: Date }|null}
 */
function guestPracticalInterval(checkIn, checkOut) {
  const inOnly = formatSofiaDateOnly(checkIn);
  const outOnly = formatSofiaDateOnly(checkOut);
  if (!inOnly || !outOnly || outOnly <= inOnly) return null;
  const start = parseSofiaWall(inOnly, CHECK_IN_TIME);
  const end = parseSofiaWall(outOnly, CHECK_OUT_TIME);
  if (!end.isAfter(start)) return null;
  return {
    startMs: start.valueOf(),
    endMs: end.valueOf(),
    startAt: start.toDate(),
    endAt: end.toDate()
  };
}

/**
 * Block / legacy night span as [startDate @ 00:00, endDate @ 00:00) Sofia.
 */
function blockPracticalInterval(startDate, endDate) {
  const startOnly = formatSofiaDateOnly(startDate);
  const endOnly = formatSofiaDateOnly(endDate);
  if (!startOnly || !endOnly || endOnly <= startOnly) return null;
  const start = moment.tz(startOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(endOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  if (!end.isAfter(start)) return null;
  return {
    startMs: start.valueOf(),
    endMs: end.valueOf(),
    startAt: start.toDate(),
    endAt: end.toDate()
  };
}

function clipInterval(interval, windowStartMs, windowEndMs) {
  if (!interval) return null;
  const startMs = Math.max(interval.startMs, windowStartMs);
  const endMs = Math.min(interval.endMs, windowEndMs);
  if (endMs <= startMs) return null;
  return {
    startMs,
    endMs,
    startAt: new Date(startMs),
    endAt: new Date(endMs)
  };
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out = [];
  let cur = { ...sorted[0], sources: [...(sorted[0].sources || [])] };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.startMs <= cur.endMs) {
      cur.endMs = Math.max(cur.endMs, next.endMs);
      cur.endAt = new Date(cur.endMs);
      cur.sources = [...(cur.sources || []), ...(next.sources || [])];
    } else {
      out.push(cur);
      cur = { ...next, sources: [...(next.sources || [])] };
    }
  }
  out.push(cur);
  return out;
}

function durationFields(startMs, endMs) {
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000));
  const durationHours = Math.round((durationMinutes / 60) * 10) / 10;
  return { durationMinutes, durationHours };
}

/**
 * Operator-facing duration from exact minutes (display only).
 * Examples: 18h · 1d 3h · 5d 4h · 7 days · 49 days
 */
function formatWorkDurationMinutes(durationMinutes) {
  const mins = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const totalHours = Math.floor(mins / 60);
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hoursPart = totalHours % 24;
  if (hoursPart === 0) return `${days} ${days === 1 ? 'day' : 'days'}`;
  return `${days}d ${hoursPart}h`;
}

function dateOnlyBounds(startMs, endMs) {
  return {
    startDateOnly: formatSofiaDateOnly(new Date(startMs)),
    endDateOnly: formatSofiaDateOnly(new Date(endMs))
  };
}

/**
 * Exclusive-end inventory nights freed by a practical free window.
 * Checkout day → next check-in day (Sofia). Null when zero nights (turnaround).
 */
function blockProposalForFree(startMs, endMs) {
  const startDate = formatSofiaDateOnly(new Date(startMs));
  const endDate = formatSofiaDateOnly(new Date(endMs));
  if (!startDate || !endDate || endDate <= startDate) return null;
  return { startDate, endDate };
}

function sameSofiaDay(startMs, endMs) {
  return formatSofiaDateOnly(new Date(startMs)) === formatSofiaDateOnly(new Date(endMs));
}

/**
 * Classify a gap in the guest timeline.
 * Same Sofia calendar day between two guest stays → turnaround; otherwise free.
 */
function classifyGuestGap(startMs, endMs, { betweenGuests = false } = {}) {
  if (endMs <= startMs) return null;
  if (betweenGuests && sameSofiaDay(startMs, endMs)) return STATES.TURNAROUND;
  return STATES.FREE;
}

function subtractBlockedFromGap(gapStart, gapEnd, blockedMerged) {
  /** @type {{ startMs: number, endMs: number, kind: 'free'|'turnaround'|'blocked', blockMeta?: object }[]} */
  const pieces = [];
  let cursor = gapStart;
  const overlapping = blockedMerged.filter((b) => b.startMs < gapEnd && b.endMs > gapStart);
  for (const b of overlapping) {
    const bStart = Math.max(b.startMs, gapStart);
    const bEnd = Math.min(b.endMs, gapEnd);
    if (bStart > cursor) {
      pieces.push({ startMs: cursor, endMs: bStart, kind: 'gap' });
    }
    if (bEnd > bStart) {
      pieces.push({
        startMs: bStart,
        endMs: bEnd,
        kind: 'blocked',
        blockMeta: b.meta || null,
        sources: b.sources || []
      });
    }
    cursor = Math.max(cursor, bEnd);
  }
  if (cursor < gapEnd) {
    pieces.push({ startMs: cursor, endMs: gapEnd, kind: 'gap' });
  }
  return pieces;
}

/**
 * Forward-looking start for free / turnaround / blocked / occupied display.
 * requestedRangeStart is Sofia midnight of `from`; nowMs is the snapshot instant.
 */
function resolveActionableStartMs(requestedRangeStartMs, nowMs) {
  const range = Number(requestedRangeStartMs);
  const now = Number(nowMs);
  if (!Number.isFinite(range)) return now;
  if (!Number.isFinite(now)) return range;
  return Math.max(range, now);
}

/**
 * Build timeline spans for one resource inside [windowStartMs, windowEndMs).
 *
 * Guest structure uses the full requested window so checkout→check-in gaps stay
 * detectable. Actionable output (occupied/free/turnaround/blocked) is clipped to
 * [actionableStartMs, windowEndMs) so past clock time is never offered as work time.
 *
 * Precedence: occupied (guest) > blocked > turnaround/free.
 * Blocks only paint into guest gaps — never replace guest occupancy.
 *
 * @param {object} opts
 * @param {{ startMs: number, endMs: number, source: object }[]} opts.guestIntervals
 * @param {{ startMs: number, endMs: number, meta: object, source: object }[]} opts.blockIntervals
 * @param {number} opts.windowStartMs — requested range start (usually Sofia midnight)
 * @param {number} opts.windowEndMs
 * @param {number} [opts.actionableStartMs] — max(windowStart, snapshot now); defaults to windowStart
 * @param {string} opts.resourceId
 */
function buildResourceSpans({
  guestIntervals,
  blockIntervals,
  windowStartMs,
  windowEndMs,
  actionableStartMs = windowStartMs,
  resourceId
}) {
  const actionableStart = Math.min(
    Math.max(Number(actionableStartMs) || windowStartMs, windowStartMs),
    windowEndMs
  );

  const guestsClipped = [];
  for (const g of guestIntervals) {
    const clipped = clipInterval(g, windowStartMs, windowEndMs);
    if (!clipped) continue;
    guestsClipped.push({
      ...clipped,
      sources: [g.source]
    });
  }
  const guestsMerged = mergeIntervals(guestsClipped);

  const blocksClipped = [];
  for (const b of blockIntervals) {
    const clipped = clipInterval(b, windowStartMs, windowEndMs);
    if (!clipped) continue;
    blocksClipped.push({
      ...clipped,
      meta: b.meta,
      sources: [b.source]
    });
  }
  const blocksMerged = mergeIntervals(blocksClipped).map((row) => ({
    ...row,
    meta: row.sources?.[0] ? blockMetaFromSource(row.sources[0]) : row.meta
  }));

  /** @type {object[]} */
  const spans = [];
  let seq = 0;
  const nextId = (state) => `${resourceId}:${state}:${seq++}`;

  function pushSpan(state, startMs, endMs, extra = {}) {
    if (endMs <= startMs) return;
    const dates = dateOnlyBounds(startMs, endMs);
    const dur = durationFields(startMs, endMs);
    // Free/turnaround ending exactly at query `to` is truncated — not a known guest arrival.
    const continuesBeyondRange =
      (state === STATES.FREE || state === STATES.TURNAROUND) && endMs >= windowEndMs;
    spans.push({
      spanId: nextId(state),
      state,
      startAt: new Date(startMs).toISOString(),
      endAt: new Date(endMs).toISOString(),
      ...dates,
      ...dur,
      continuesBeyondRange: Boolean(continuesBeyondRange),
      blockSubtype: null,
      blockProposal: null,
      ...extra
    });
  }

  // Occupied from guests — clip to actionable start (past occupancy is not actionable)
  for (const g of guestsMerged) {
    const out = clipInterval(g, actionableStart, windowEndMs);
    if (!out) continue;
    const primary = g.sources?.[0] || { type: 'booking' };
    pushSpan(STATES.OCCUPIED, out.startMs, out.endMs, {
      source: primary,
      sources: g.sources
    });
  }

  // Gaps between guests (full window structure), overlay blocks, then clip to actionable start.
  // Classification uses the pre-clip gap (betweenGuests) so a 11:00→15:00 turnaround clipped
  // at 13:00 remains turnaround.
  for (let i = 0; i < guestsMerged.length + 1; i += 1) {
    const gapStart = i === 0 ? windowStartMs : guestsMerged[i - 1].endMs;
    const gapEnd = i === guestsMerged.length ? windowEndMs : guestsMerged[i].startMs;
    if (gapEnd <= gapStart) continue;

    const betweenGuests = i > 0 && i < guestsMerged.length;
    // Classify from the unclipped guest gap so remnants keep turnaround semantics.
    const gapState =
      classifyGuestGap(gapStart, gapEnd, { betweenGuests }) || STATES.FREE;
    const pieces = subtractBlockedFromGap(gapStart, gapEnd, blocksMerged);

    for (const piece of pieces) {
      const clippedStart = Math.max(piece.startMs, actionableStart);
      const clippedEnd = piece.endMs;
      if (clippedEnd <= clippedStart) continue;

      if (piece.kind === 'blocked') {
        const src = piece.sources?.[0] || {
          type: 'availability_block',
          blockType: piece.blockMeta?.blockSubtype || 'manual_block'
        };
        pushSpan(STATES.BLOCKED, clippedStart, clippedEnd, {
          blockSubtype: src.blockType || piece.blockMeta?.blockSubtype || null,
          source: src
        });
        continue;
      }

      const state = gapState;
      const proposal = state === STATES.FREE ? blockProposalForFree(clippedStart, clippedEnd) : null;
      pushSpan(state, clippedStart, clippedEnd, {
        blockProposal: proposal,
        source: { type: 'derived' }
      });
    }
  }

  // Blocks entirely inside occupied regions are skipped — guest occupancy wins.

  spans.sort((a, b) => new Date(a.startAt) - new Date(b.startAt) || new Date(a.endAt) - new Date(b.endAt));
  return spans;
}

function blockMetaFromSource(source) {
  if (!source) return null;
  return { blockSubtype: source.blockType || null };
}

/**
 * @param {object[]} resources — each with spans
 */
function buildBestWindows(resources, { cap = BEST_WINDOWS_CAP, siteCap = 3 } = {}) {
  const locationRows = [];
  const unitRows = [];
  for (const resource of resources) {
    for (const span of resource.spans || []) {
      if (span.state !== STATES.FREE) continue;
      const row = {
        resourceId: resource.resourceId,
        kind: resource.kind,
        label: resource.label,
        state: STATES.FREE,
        startAt: span.startAt,
        endAt: span.endAt,
        startDateOnly: span.startDateOnly,
        endDateOnly: span.endDateOnly,
        durationMinutes: span.durationMinutes,
        durationHours: span.durationHours,
        continuesBeyondRange: Boolean(span.continuesBeyondRange),
        displayLabel: formatBestWindowLabel(resource.label, span),
        blockProposal: span.blockProposal || null,
        prominent: resource.kind === 'location'
      };
      if (resource.kind === 'location') locationRows.push(row);
      else unitRows.push(row);
    }
  }
  const byDurationThenStart = (a, b) => {
    if (b.durationMinutes !== a.durationMinutes) return b.durationMinutes - a.durationMinutes;
    return String(a.startAt).localeCompare(String(b.startAt));
  };
  locationRows.sort(byDurationThenStart);
  unitRows.sort(byDurationThenStart);

  // Site-wide construction windows first (cap), then unit windows to fill remaining slots.
  const site = locationRows.slice(0, siteCap);
  const remaining = Math.max(0, cap - site.length);
  return [...site, ...unitRows.slice(0, remaining)];
}

function formatBestWindowLabel(label, span) {
  const start = moment.tz(span.startAt, PROPERTY_TIMEZONE);
  const end = moment.tz(span.endAt, PROPERTY_TIMEZONE);
  const startFmt = start.format('D MMM HH:mm');
  const range = span.continuesBeyondRange
    ? `${startFmt} → at least ${end.format('D MMM')}`
    : `${startFmt} → ${end.format('D MMM HH:mm')}`;
  const dur = formatWorkDurationMinutes(span.durationMinutes);
  return `${label} · ${range} · ${dur}`;
}

function buildDayKeys(fromDateOnly, toDateOnly) {
  const keys = [];
  let cursor = moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  while (cursor.isBefore(end)) {
    keys.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.clone().add(1, 'day');
  }
  return keys;
}

function planningWindowBounds(fromDateOnly, toDateOnly) {
  const start = moment.tz(fromDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  const end = moment.tz(toDateOnly, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day');
  return {
    windowStartMs: start.valueOf(),
    windowEndMs: end.valueOf(),
    startDate: start.toDate(),
    endDate: end.toDate()
  };
}

/**
 * @param {number} windowStartMs
 * @param {number} windowEndMs
 * @param {Date|number|string} nowInput
 */
function resolvePlanningActionableBounds(windowStartMs, windowEndMs, nowInput) {
  const nowMs = nowInput instanceof Date ? nowInput.getTime() : new Date(nowInput).getTime();
  const actionableStartMs = resolveActionableStartMs(windowStartMs, nowMs);
  return {
    nowMs,
    actionableStartMs,
    /** True when the requested range has already fully elapsed. */
    rangeFullyPast: actionableStartMs >= windowEndMs
  };
}

function guestLabelFromBooking(booking) {
  const g = booking?.guestInfo || {};
  const first = String(g.firstName || '').trim();
  const last = String(g.lastName || '').trim();
  if (last) return `${first ? `${first[0]}. ` : ''}${last}`.trim();
  return first || null;
}

function legacyBlockedDateSpans(blockedDates) {
  const spans = [];
  const arr = Array.isArray(blockedDates) ? blockedDates : [];
  for (const blockedDate of arr) {
    const nightStart = moment.tz(blockedDate, PROPERTY_TIMEZONE).startOf('day');
    if (!nightStart.isValid()) continue;
    const nightEnd = nightStart.clone().add(1, 'day');
    spans.push({
      startDate: nightStart.toDate(),
      endDate: nightEnd.toDate()
    });
  }
  return spans;
}

module.exports = {
  STATES,
  MAX_WORK_WINDOWS_EXCLUSIVE_DAYS,
  BEST_WINDOWS_CAP,
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  guestPracticalInterval,
  blockPracticalInterval,
  clipInterval,
  mergeIntervals,
  buildResourceSpans,
  buildBestWindows,
  buildDayKeys,
  planningWindowBounds,
  resolveActionableStartMs,
  resolvePlanningActionableBounds,
  blockProposalForFree,
  guestLabelFromBooking,
  legacyBlockedDateSpans,
  formatBestWindowLabel,
  formatWorkDurationMinutes,
  durationFields,
  parseSofiaWall
};
