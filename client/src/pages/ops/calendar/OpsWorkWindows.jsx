import { useMemo, useState } from 'react';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { addDays } from 'date-fns';
import { opsReadAPI } from '../../../services/opsApi';
import { OPS_CALENDAR_TZ, parseIsoDay, ymdUtc, addDaysUtc } from './opsCalendarDateUtils';
import { formatWorkDurationMinutes, formatWorkWindowRange } from './workWindowsFormat';

const LOCATION_OPTIONS = [
  { value: 'valley', label: 'The Valley' },
  { value: 'cabin', label: 'The Cabin' }
];

/** Site-wide construction windows shown prominently before the timeline. */
const SITE_BEST_CAP = 3;

/** Planner-local only — do not share with calendarVisualTokens. */
const SPAN_STYLES = {
  occupied: 'bg-red-500/90 border border-red-800 text-white',
  turnaround: 'bg-amber-400 border border-amber-700 text-amber-950',
  free: 'bg-emerald-500/90 border border-emerald-800 text-white',
  blocked: 'bg-gray-700/95 border border-gray-950 text-white border-dashed'
};

const DAY_COL_PX = 36;
const LABEL_COL_PX = 148;

function sofiaTodayYmd() {
  return formatInTimeZone(new Date(), OPS_CALENDAR_TZ, 'yyyy-MM-dd');
}

function defaultToYmd(fromYmd, exclusiveDays = 60) {
  const start = parseIsoDay(fromYmd);
  if (!start) return fromYmd;
  return ymdUtc(addDaysUtc(start, exclusiveDays));
}

function formatCheckedAt(iso) {
  if (!iso) return '';
  return formatInTimeZone(new Date(iso), OPS_CALENDAR_TZ, 'd MMM yyyy, HH:mm');
}

function formatDayHeader(dayKey) {
  const d = parseIsoDay(dayKey);
  if (!d) return '';
  return formatInTimeZone(d, 'UTC', 'd');
}

function formatDayWeekday(dayKey) {
  const d = parseIsoDay(dayKey);
  if (!d) return '';
  return formatInTimeZone(d, 'UTC', 'EEEEE');
}

function formatSofiaRange(startAt, endAt, continuesBeyondRange = false) {
  return formatWorkWindowRange(startAt, endAt, OPS_CALENDAR_TZ, { continuesBeyondRange });
}

function spanTitle(span) {
  const src = span.source || {};
  let origin = '';
  if (span.state === 'occupied') {
    const status = src.status ? String(src.status) : 'booking';
    const pretty =
      status === 'pending'
        ? 'Pending booking'
        : status === 'confirmed'
          ? 'Confirmed booking'
          : status === 'in_house'
            ? 'In-house booking'
            : `${status.charAt(0).toUpperCase()}${status.slice(1)} booking`;
    const guest = src.guestLabel ? ` · ${src.guestLabel}` : '';
    origin = `${pretty}${guest}`;
  } else if (span.state === 'blocked') {
    const map = {
      maintenance: 'Maintenance',
      manual_block: 'Manual block',
      external_hold: 'Channel hold',
      checkout_hold: 'Checkout hold',
      legacy_blocked_date: 'Blocked date',
      reservation: 'Reservation block'
    };
    origin = map[span.blockSubtype || src.blockType] || 'Blocked';
  } else if (span.state === 'turnaround') {
    origin = 'Turnaround (not a full work window)';
  } else if (span.continuesBeyondRange) {
    origin = 'Free work window (continues past checked range)';
  } else {
    origin = 'Free work window';
  }
  const range = formatSofiaRange(span.startAt, span.endAt, Boolean(span.continuesBeyondRange));
  const dur = formatWorkDurationMinutes(span.durationMinutes);
  return `${origin}: ${range} · ${dur}`;
}

/** On-bar text for occupied — Pending / In house only; Confirmed is color + tooltip. */
function occupiedBarLabel(span) {
  const status = span.source?.status;
  if (status === 'pending') return 'Pending';
  if (status === 'in_house') return 'In house';
  return '';
}

function blockedBarLabel(span) {
  const map = {
    maintenance: 'Maint.',
    manual_block: 'Manual',
    external_hold: 'Hold',
    checkout_hold: 'Hold',
    legacy_blocked_date: 'Blocked',
    reservation: 'Res.'
  };
  return map[span.blockSubtype] || 'Blocked';
}

/**
 * Position bars on Sofia civil-day columns (not UTC midnight).
 * Ensures 11:00 / 15:00 / "now" boundaries are partial-day, not full cells.
 */
function barGeometrySofia(span, dayKeys) {
  if (!dayKeys.length) return { left: 0, width: 0, leftPct: 0, widthPct: 0 };
  const rangeStart = toDate(`${dayKeys[0]} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
  const last = dayKeys[dayKeys.length - 1];
  const rangeEnd = addDays(toDate(`${last} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ }), 1);
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return { left: 0, width: 0, leftPct: 0, widthPct: 0 };

  const startMs = Math.max(new Date(span.startAt).getTime(), rangeStart.getTime());
  const endMs = Math.min(new Date(span.endAt).getTime(), rangeEnd.getTime());
  if (endMs <= startMs) return { left: 0, width: 0, leftPct: 0, widthPct: 0 };

  const leftPct = ((startMs - rangeStart.getTime()) / totalMs) * 100;
  const widthPct = ((endMs - startMs) / totalMs) * 100;
  return {
    left: `${leftPct}%`,
    width: `${Math.max(widthPct, 0.35)}%`,
    leftPct,
    widthPct
  };
}

function clientRangeError(from, to) {
  if (!from || !to) return 'Choose both From and To dates.';
  if (to <= from) return 'To must be after From.';
  const start = parseIsoDay(from);
  const end = parseIsoDay(to);
  if (!start || !end) return 'Use YYYY-MM-DD dates.';
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (days > 92) return 'Range cannot exceed 92 days. Narrow From/To and try again.';
  return null;
}

function BestWindowRow({ w, siteWide = false }) {
  const range = formatSofiaRange(w.startAt, w.endAt, Boolean(w.continuesBeyondRange));
  const dur = formatWorkDurationMinutes(w.durationMinutes);
  const rangeNote = w.continuesBeyondRange ? ' · through end of checked range' : '';

  return (
    <li
      className={`border border-gray-200 rounded-lg px-3 py-2 bg-white ${
        siteWide ? 'border-l-4 border-l-emerald-500' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{w.label}</p>
            {siteWide ? (
              <span className="text-xs px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 shrink-0">
                Site-wide
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              Free
            </span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{range}</p>
        </div>
        <p className="text-xs tabular-nums text-gray-500 shrink-0 pt-0.5">
          {dur}
          {rangeNote}
        </p>
      </div>
    </li>
  );
}

export default function OpsWorkWindows() {
  const [locationKey, setLocationKey] = useState('valley');
  const [from, setFrom] = useState(() => sofiaTodayYmd());
  const [to, setTo] = useState(() => defaultToYmd(sofiaTodayYmd(), 60));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const todayKey = sofiaTodayYmd();

  async function checkAvailability() {
    const localErr = clientRangeError(from, to);
    if (localErr) {
      setError(localErr);
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await opsReadAPI.workWindows({ locationKey, from, to });
      setData(res.data?.data || res.data);
    } catch (err) {
      const message =
        err?.response?.data?.message || err?.message || 'Failed to load work windows';
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const dayKeys = data?.dayKeys || [];
  const timelineWidth = dayKeys.length * DAY_COL_PX;

  const locationBest = useMemo(() => {
    const rows = (data?.bestWindows || []).filter((w) => w.kind === 'location');
    return rows.slice(0, SITE_BEST_CAP);
  }, [data]);
  const unitBest = useMemo(
    () => (data?.bestWindows || []).filter((w) => w.kind !== 'location'),
    [data]
  );

  return (
    <div className="space-y-4 pb-16 sm:pb-0 overflow-x-hidden">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Work Windows</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          When a site or unit is free of guests — for construction, maintenance, and noisy work.
        </p>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">Location</span>
            <select
              value={locationKey}
              onChange={(e) => setLocationKey(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            >
              {LOCATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block text-xs text-gray-500 mb-1">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={checkAvailability}
              disabled={loading}
              className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-60"
            >
              {loading ? 'Checking…' : 'Check availability'}
            </button>
          </div>
        </div>

        {data?.generatedAt ? (
          <p className="mt-2 text-xs text-gray-500">
            Availability checked {formatCheckedAt(data.generatedAt)}
            <span className="text-gray-400">
              {' '}
              · checkout {data.checkOutTime} → check-in {data.checkInTime} ({data.timezone})
            </span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-gray-500">
            Press Check availability for an on-demand snapshot. Nothing loads until you check.
          </p>
        )}
      </section>

      {loading ? <div className="text-sm text-gray-500">Loading work windows…</div> : null}

      {error ? <div className="text-sm text-red-600">{error}</div> : null}

      {!data && !loading && !error ? (
        <p className="text-sm text-gray-500">
          Choose a location and date range, then check availability.
        </p>
      ) : null}

      {data ? (
        <>
          <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
            <h3 className="text-sm font-semibold text-gray-900">Best work windows</h3>
            {!locationBest.length && !unitBest.length ? (
              <p className="text-sm text-gray-500">
                No multi-day free windows in this range
                {data.resources?.some((r) => r.spans?.some((s) => s.state === 'free'))
                  ? ' (only short same-day turnarounds or partial gaps).'
                  : ' — every day has guest occupancy or a block.'}
              </p>
            ) : (
              <div className="space-y-2">
                {locationBest.length ? (
                  <ul className="space-y-2">
                    {locationBest.map((w) => (
                      <BestWindowRow key={`${w.resourceId}-${w.startAt}`} w={w} siteWide />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">
                    No site-wide free window in this range — check individual units or the timeline.
                  </p>
                )}
                {unitBest.length ? (
                  <details className="border border-gray-200 rounded-lg">
                    <summary className="cursor-pointer select-none px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg">
                      Individual unit windows ({unitBest.length})
                    </summary>
                    <ul className="px-3 pb-2 space-y-2">
                      {unitBest.map((w) => (
                        <BestWindowRow key={`${w.resourceId}-${w.startAt}`} w={w} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Timeline</h3>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-emerald-500 border border-emerald-800" /> Free
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-amber-400 border border-amber-700" /> Turnaround
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-red-500 border border-red-800" /> Occupied
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-gray-700 border border-dashed border-gray-950" />{' '}
                  Blocked
                </span>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto overscroll-x-contain">
                <div
                  className="flex"
                  style={{ width: LABEL_COL_PX + timelineWidth, minWidth: '100%' }}
                >
                  <div
                    className="sticky left-0 z-20 shrink-0 border-r border-gray-200 bg-white shadow-[2px_0_6px_rgba(0,0,0,0.06)]"
                    style={{ width: LABEL_COL_PX }}
                  >
                    <div className="h-11 border-b border-gray-100 px-2.5 flex items-end pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Resource
                    </div>
                    {(data.resources || []).map((resource) => (
                      <div
                        key={resource.resourceId}
                        className={`h-11 px-2.5 flex items-center border-b border-gray-100 text-xs ${
                          resource.kind === 'location'
                            ? 'font-semibold text-gray-900 bg-slate-100'
                            : 'text-gray-700 bg-white'
                        }`}
                        title={resource.label}
                      >
                        <span className="truncate leading-tight">
                          {resource.kind === 'location' ? resource.label.toUpperCase() : resource.label}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="relative shrink-0" style={{ width: timelineWidth }}>
                    <div
                      className="sticky top-0 z-10 h-11 border-b border-gray-100 bg-white flex"
                      style={{ width: timelineWidth }}
                    >
                      {dayKeys.map((dk) => {
                        const isToday = dk === todayKey;
                        return (
                          <div
                            key={dk}
                            className={`shrink-0 border-r border-gray-50 flex flex-col items-center justify-end pb-1 ${
                              isToday ? 'bg-sky-50' : ''
                            }`}
                            style={{ width: DAY_COL_PX }}
                            title={isToday ? `${dk} (today)` : dk}
                          >
                            <span
                              className={`text-[9px] ${isToday ? 'text-sky-700 font-semibold' : 'text-gray-400'}`}
                            >
                              {formatDayWeekday(dk)}
                            </span>
                            <span
                              className={`text-[10px] font-medium ${
                                isToday ? 'text-sky-900' : 'text-gray-600'
                              }`}
                            >
                              {formatDayHeader(dk)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {(data.resources || []).map((resource) => {
                      const bars = (resource.spans || []).filter((s) => s.state !== 'turnaround');
                      const turnarounds = (resource.spans || []).filter(
                        (s) => s.state === 'turnaround'
                      );
                      return (
                        <div
                          key={resource.resourceId}
                          className={`relative h-11 border-b border-gray-100 ${
                            resource.kind === 'location' ? 'bg-slate-50/80' : 'bg-white'
                          }`}
                          style={{ width: timelineWidth }}
                        >
                          <div className="absolute inset-0 flex pointer-events-none">
                            {dayKeys.map((dk) => (
                              <div
                                key={dk}
                                className={`shrink-0 border-r h-full ${
                                  dk === todayKey
                                    ? 'border-sky-100 bg-sky-50/40'
                                    : 'border-gray-50/90'
                                }`}
                                style={{ width: DAY_COL_PX }}
                              />
                            ))}
                          </div>

                          {bars.map((span) => {
                            const { left, width, widthPct } = barGeometrySofia(span, dayKeys);
                            const showText = widthPct >= 2.2;
                            let barText = '';
                            if (span.state === 'free') {
                              barText = formatWorkDurationMinutes(span.durationMinutes);
                              if (span.continuesBeyondRange && widthPct >= 6) barText = `${barText}+`;
                            } else if (span.state === 'occupied') {
                              barText = occupiedBarLabel(span);
                            } else {
                              barText = blockedBarLabel(span);
                            }
                            return (
                              <div
                                key={span.spanId}
                                title={spanTitle(span)}
                                className={`absolute top-1.5 bottom-1.5 rounded-sm px-0.5 flex items-center overflow-hidden ${
                                  SPAN_STYLES[span.state] || SPAN_STYLES.blocked
                                }`}
                                style={{ left, width }}
                              >
                                {showText && barText ? (
                                  <span className="truncate text-[9px] font-semibold leading-none px-0.5">
                                    {barText}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })}

                          {turnarounds.map((span) => {
                            const { left, width, widthPct } = barGeometrySofia(span, dayKeys);
                            return (
                              <div
                                key={span.spanId}
                                title={spanTitle(span)}
                                className={`absolute top-1 bottom-1 z-[1] rounded-sm ${SPAN_STYLES.turnaround} flex items-center justify-center overflow-hidden`}
                                style={{ left, width: widthPct < 0.8 ? '3px' : width }}
                              >
                                {widthPct >= 1.5 ? (
                                  <span className="text-[8px] font-bold leading-none">TA</span>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <p className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 sm:hidden">
                Swipe sideways to scroll days. Resource names stay fixed.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
