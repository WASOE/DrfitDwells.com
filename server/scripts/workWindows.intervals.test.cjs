/**
 * Work Windows interval/domain unit tests.
 * Run: node --test server/scripts/workWindows.intervals.test.cjs
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const moment = require('moment-timezone');

const {
  PROPERTY_TIMEZONE,
  CHECK_IN_TIME,
  CHECK_OUT_TIME,
  guestPracticalInterval,
  blockPracticalInterval,
  buildResourceSpans,
  buildBestWindows,
  blockProposalForFree,
  planningWindowBounds,
  resolveActionableStartMs,
  STATES
} = require('../services/ops/domain/workWindowsIntervals');

function sofiaDay(ymd) {
  return moment.tz(ymd, 'YYYY-MM-DD', PROPERTY_TIMEZONE).startOf('day').toDate();
}

function sofiaWall(ymd, hm) {
  return moment.tz(`${ymd} ${hm}`, 'YYYY-MM-DD HH:mm', PROPERTY_TIMEZONE);
}

function bookingSource(status = 'confirmed') {
  return { type: 'booking', bookingId: 'b1', status, guestLabel: 'T. Guest' };
}

function spansAt(resourceOpts) {
  return buildResourceSpans(resourceOpts);
}

test('back-to-back bookings produce same-day turnaround 11:00→15:00', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-29');
  const a = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-27'));
  const b = guestPracticalInterval(sofiaDay('2026-08-27'), sofiaDay('2026-08-28'));
  const spans = buildResourceSpans({
    guestIntervals: [
      { ...a, source: bookingSource('confirmed') },
      { ...b, source: bookingSource('pending') }
    ],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'unit:1'
  });

  const turn = spans.filter((s) => s.state === STATES.TURNAROUND);
  assert.equal(turn.length, 1);
  assert.equal(turn[0].durationMinutes, 240);
  assert.equal(turn[0].startDateOnly, '2026-08-27');
  assert.equal(turn[0].endDateOnly, '2026-08-27');
  assert.equal(turn[0].blockProposal, null);

  const occupied = spans.filter((s) => s.state === STATES.OCCUPIED);
  assert.ok(occupied.some((s) => s.source.status === 'confirmed'));
  assert.ok(occupied.some((s) => s.source.status === 'pending'));
});

test('multi-day gap yields free practical window and duration ~76h', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-02');
  const a = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-27'));
  const b = guestPracticalInterval(sofiaDay('2026-08-30'), sofiaDay('2026-08-31'));
  const spans = buildResourceSpans({
    guestIntervals: [
      { ...a, source: bookingSource() },
      { ...b, source: bookingSource() }
    ],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'location:valley'
  });

  const free = spans.filter((s) => s.state === STATES.FREE);
  const gap = free.find((s) => s.startDateOnly === '2026-08-27' && s.endDateOnly === '2026-08-30');
  assert.ok(gap, 'expected free Aug 27→30');
  assert.equal(gap.durationMinutes, 76 * 60);
  assert.equal(gap.durationHours, 76);
  assert.equal(gap.continuesBeyondRange, false);
  assert.deepEqual(gap.blockProposal, { startDate: '2026-08-27', endDate: '2026-08-30' });
});

test('overlapping bookings merge into one occupied span', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-01');
  const a = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-29'));
  const b = guestPracticalInterval(sofiaDay('2026-08-28'), sofiaDay('2026-08-31'));
  const spans = buildResourceSpans({
    guestIntervals: [
      { ...a, source: bookingSource('confirmed') },
      { ...b, source: bookingSource('in_house') }
    ],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'cabin:1'
  });
  const occupied = spans.filter((s) => s.state === STATES.OCCUPIED);
  assert.equal(occupied.length, 1);
  assert.equal(occupied[0].startDateOnly, '2026-08-26');
  assert.equal(occupied[0].endDateOnly, '2026-08-31');
});

test('block overlays free correctly', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-05');
  const block = blockPracticalInterval(sofiaDay('2026-08-28'), sofiaDay('2026-08-30'));
  const spans = buildResourceSpans({
    guestIntervals: [],
    blockIntervals: [
      {
        ...block,
        meta: { blockSubtype: 'maintenance' },
        source: { type: 'availability_block', blockType: 'maintenance', blockId: 'blk1' }
      }
    ],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'unit:2'
  });
  const blocked = spans.filter((s) => s.state === STATES.BLOCKED);
  assert.ok(blocked.length >= 1);
  assert.equal(blocked[0].blockSubtype, 'maintenance');
  const free = spans.filter((s) => s.state === STATES.FREE);
  assert.ok(free.every((s) => s.endAt <= blocked[0].startAt || s.startAt >= blocked[0].endAt));
});

test('expired checkout hold ignored; active checkout hold blocked', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-01');
  const range = blockPracticalInterval(sofiaDay('2026-08-27'), sofiaDay('2026-08-29'));

  // Interval module does not filter expiry — read model does. Here we only add active holds.
  const spansActive = buildResourceSpans({
    guestIntervals: [],
    blockIntervals: [
      {
        ...range,
        meta: { blockSubtype: 'checkout_hold' },
        source: { type: 'availability_block', blockType: 'checkout_hold', blockId: 'h1' }
      }
    ],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'r1'
  });
  assert.ok(spansActive.some((s) => s.state === STATES.BLOCKED && s.blockSubtype === 'checkout_hold'));

  const spansNone = buildResourceSpans({
    guestIntervals: [],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'r1'
  });
  assert.ok(spansNone.every((s) => s.state !== STATES.BLOCKED));
  assert.ok(spansNone.some((s) => s.state === STATES.FREE));
});

test('Sofia DST duration uses wall times (spring forward week)', () => {
  // Europe/Sofia DST spring 2026: last Sunday of March = 2026-03-29
  const start = moment.tz('2026-03-28 11:00', 'YYYY-MM-DD HH:mm', PROPERTY_TIMEZONE);
  const end = moment.tz('2026-03-30 15:00', 'YYYY-MM-DD HH:mm', PROPERTY_TIMEZONE);
  const minutes = Math.round((end.valueOf() - start.valueOf()) / 60000);
  // 2 days 4 hours wall clock, but one less clock hour across spring forward → 52h wall? 
  // 28 11:00 → 30 15:00 = 52 hours of wall labels but actual elapsed is 51h due to DST.
  assert.equal(minutes, 51 * 60);

  const proposal = blockProposalForFree(start.valueOf(), end.valueOf());
  assert.deepEqual(proposal, { startDate: '2026-03-28', endDate: '2026-03-30' });
});

test('zero bookings → single free spanning window', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-30');
  const spans = buildResourceSpans({
    guestIntervals: [],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'location:valley'
  });
  assert.equal(spans.length, 1);
  assert.equal(spans[0].state, STATES.FREE);
  assert.equal(spans[0].startDateOnly, '2026-08-26');
  assert.equal(spans[0].endDateOnly, '2026-08-30');
  assert.equal(spans[0].continuesBeyondRange, true);
});

test('free span ending at query to is range-truncated; natural free end is not', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-10');
  // Guest leaves Aug 28 11:00 — free until range end Sep 10 00:00 (no next booking)
  const a = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-28'));
  const openEnd = buildResourceSpans({
    guestIntervals: [{ ...a, source: bookingSource() }],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'location:valley'
  });
  const openFree = openEnd.find(
    (s) => s.state === STATES.FREE && moment.tz(s.endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD') === '2026-09-10'
  );
  assert.ok(openFree);
  assert.equal(openFree.continuesBeyondRange, true);
  assert.equal(moment.tz(openFree.endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-09-10 00:00');
  assert.equal(
    openEnd.find((s) => s.state === STATES.FREE && s.startDateOnly === '2026-08-26')?.continuesBeyondRange,
    false
  );
  // Same first stay, but next guest arrives Aug 31 — free ends at check-in, not range end
  const b = guestPracticalInterval(sofiaDay('2026-08-31'), sofiaDay('2026-09-02'));
  const closed = buildResourceSpans({
    guestIntervals: [
      { ...a, source: bookingSource() },
      { ...b, source: bookingSource() }
    ],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'location:valley'
  });
  const closedFree = closed.find(
    (s) =>
      s.state === STATES.FREE &&
      moment.tz(s.startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm') === '2026-08-28 11:00'
  );
  assert.ok(closedFree);
  assert.equal(closedFree.continuesBeyondRange, false);
  assert.equal(moment.tz(closedFree.endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-31 15:00');

  const best = buildBestWindows([
    { resourceId: 'location:valley', kind: 'location', label: 'The Valley', spans: openEnd }
  ]);
  assert.equal(best[0].continuesBeyondRange, true);
});

test('booking status metadata preserved on occupied spans', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-29');
  const a = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-28'));
  const spans = buildResourceSpans({
    guestIntervals: [{ ...a, source: bookingSource('pending') }],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'cabin:x'
  });
  const occ = spans.find((s) => s.state === STATES.OCCUPIED);
  assert.equal(occ.source.status, 'pending');
  assert.equal(occ.source.bookingId, 'b1');
  assert.equal(occ.source.guestLabel, 'T. Guest');
});

test('bestWindows excludes turnaround and sorts by duration', () => {
  const resources = [
    {
      resourceId: 'location:valley',
      kind: 'location',
      label: 'The Valley',
      spans: [
        {
          state: 'turnaround',
          startAt: '2026-08-27T08:00:00.000Z',
          endAt: '2026-08-27T12:00:00.000Z',
          startDateOnly: '2026-08-27',
          endDateOnly: '2026-08-27',
          durationMinutes: 240,
          durationHours: 4,
          blockProposal: null
        },
        {
          state: 'free',
          startAt: '2026-08-27T08:00:00.000Z',
          endAt: '2026-08-30T12:00:00.000Z',
          startDateOnly: '2026-08-27',
          endDateOnly: '2026-08-30',
          durationMinutes: 4560,
          durationHours: 76,
          blockProposal: { startDate: '2026-08-27', endDate: '2026-08-30' }
        }
      ]
    }
  ];
  const best = buildBestWindows(resources);
  assert.equal(best.length, 1);
  assert.equal(best[0].durationHours, 76);
  assert.equal(best[0].kind, 'location');
});

test('guest practical interval uses CHECK_IN/OUT constants', () => {
  const iv = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-27'));
  const start = moment.tz(iv.startAt, PROPERTY_TIMEZONE);
  const end = moment.tz(iv.endAt, PROPERTY_TIMEZONE);
  assert.equal(start.format('HH:mm'), CHECK_IN_TIME);
  assert.equal(end.format('HH:mm'), CHECK_OUT_TIME);
});

test('current time 16:00 on free day → free starts at 16:00 not midnight', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-28');
  const now = sofiaWall('2026-08-26', '16:00');
  const next = guestPracticalInterval(sofiaDay('2026-08-27'), sofiaDay('2026-08-28'));
  const spans = spansAt({
    guestIntervals: [{ ...next, source: bookingSource() }],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    actionableStartMs: resolveActionableStartMs(window.windowStartMs, now.valueOf()),
    resourceId: 'location:valley'
  });
  const free = spans.find((s) => s.state === STATES.FREE);
  assert.ok(free);
  assert.equal(moment.tz(free.startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 16:00');
  assert.equal(moment.tz(free.endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-27 15:00');
  assert.equal(free.durationMinutes, 23 * 60);
  assert.equal(free.durationHours, 23);
});

test('current time before today checkout → occupied until checkout', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-28');
  const now = sofiaWall('2026-08-26', '10:00');
  const stay = guestPracticalInterval(sofiaDay('2026-08-25'), sofiaDay('2026-08-26'));
  const spans = spansAt({
    guestIntervals: [{ ...stay, source: bookingSource() }],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    actionableStartMs: resolveActionableStartMs(window.windowStartMs, now.valueOf()),
    resourceId: 'cabin:1'
  });
  const occ = spans.find((s) => s.state === STATES.OCCUPIED);
  assert.ok(occ);
  assert.equal(moment.tz(occ.startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 10:00');
  assert.equal(moment.tz(occ.endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 11:00');
});

test('current time inside 11→15 turnaround → turnaround clipped to now', () => {
  const window = planningWindowBounds('2026-08-26', '2026-08-29');
  const now = sofiaWall('2026-08-26', '13:00');
  const a = guestPracticalInterval(sofiaDay('2026-08-25'), sofiaDay('2026-08-26'));
  const b = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-27'));
  const spans = spansAt({
    guestIntervals: [
      { ...a, source: bookingSource() },
      { ...b, source: bookingSource() }
    ],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    actionableStartMs: resolveActionableStartMs(window.windowStartMs, now.valueOf()),
    resourceId: 'unit:1'
  });
  const turn = spans.filter((s) => s.state === STATES.TURNAROUND);
  assert.equal(turn.length, 1);
  assert.equal(moment.tz(turn[0].startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 13:00');
  assert.equal(moment.tz(turn[0].endAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 15:00');
  assert.equal(turn[0].durationMinutes, 120);
});

test('past portion does not inflate free / bestWindows duration', () => {
  const window = planningWindowBounds('2026-08-20', '2026-08-28');
  const now = sofiaWall('2026-08-26', '16:00');
  const spans = spansAt({
    guestIntervals: [],
    blockIntervals: [],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    actionableStartMs: resolveActionableStartMs(window.windowStartMs, now.valueOf()),
    resourceId: 'location:valley'
  });
  const free = spans.find((s) => s.state === STATES.FREE);
  assert.ok(free);
  assert.equal(moment.tz(free.startAt, PROPERTY_TIMEZONE).format('YYYY-MM-DD HH:mm'), '2026-08-26 16:00');
  // Must not count Aug 20 00:00 → Aug 26 16:00 as free work time
  assert.ok(free.durationMinutes < 6 * 24 * 60);
  const best = buildBestWindows([
    { resourceId: 'location:valley', kind: 'location', label: 'The Valley', spans }
  ]);
  assert.equal(best[0].durationMinutes, free.durationMinutes);
  assert.equal(best[0].startAt, free.startAt);
});

test('guest occupancy wins over overlapping block', () => {
  const window = planningWindowBounds('2026-08-26', '2026-09-01');
  const guest = guestPracticalInterval(sofiaDay('2026-08-26'), sofiaDay('2026-08-29'));
  const block = blockPracticalInterval(sofiaDay('2026-08-27'), sofiaDay('2026-08-28'));
  const spans = spansAt({
    guestIntervals: [{ ...guest, source: bookingSource('confirmed') }],
    blockIntervals: [
      {
        ...block,
        meta: { blockSubtype: 'maintenance' },
        source: { type: 'availability_block', blockType: 'maintenance', blockId: 'm1' }
      }
    ],
    windowStartMs: window.windowStartMs,
    windowEndMs: window.windowEndMs,
    resourceId: 'unit:x'
  });
  const mid = sofiaWall('2026-08-27', '12:00').valueOf();
  const covering = spans.filter(
    (s) => new Date(s.startAt).getTime() <= mid && new Date(s.endAt).getTime() > mid
  );
  assert.equal(covering.length, 1);
  assert.equal(covering[0].state, STATES.OCCUPIED);
  const blockedOverlap = spans.filter((s) => {
    if (s.state !== STATES.BLOCKED) return false;
    return new Date(s.startAt).getTime() < guest.endMs && new Date(s.endAt).getTime() > guest.startMs;
  });
  assert.equal(blockedOverlap.length, 0);
});

test('resolveActionableStartMs takes max of range start and now', () => {
  const range = sofiaWall('2026-08-26', '00:00').valueOf();
  const now = sofiaWall('2026-08-26', '16:00').valueOf();
  assert.equal(resolveActionableStartMs(range, now), now);
  assert.equal(resolveActionableStartMs(now, range), now);
});

test('formatWorkDurationMinutes is operator-facing (no decimals)', () => {
  const { formatWorkDurationMinutes } = require('../services/ops/domain/workWindowsIntervals');
  assert.equal(formatWorkDurationMinutes(18 * 60), '18h');
  assert.equal(formatWorkDurationMinutes(27 * 60), '1d 3h');
  assert.equal(formatWorkDurationMinutes(124 * 60), '5d 4h');
  assert.equal(formatWorkDurationMinutes(168 * 60), '7 days');
  assert.equal(formatWorkDurationMinutes(1176 * 60), '49 days');
  assert.equal(formatWorkDurationMinutes(1176.3 * 60), '49 days');
});
