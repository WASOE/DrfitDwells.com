import { useMemo, useState } from 'react';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { addDays } from 'date-fns';
import { opsReadAPI } from '../../../services/opsApi';
import { OPS_CALENDAR_TZ, parseIsoDay, ymdUtc, addDaysUtc } from './opsCalendarDateUtils';
import { formatWorkDurationMinutes, formatWorkWindowRange } from './workWindowsFormat';
import OpsPage from '../../../ops/primitives/OpsPage';
import OpsPageHeader from '../../../ops/primitives/OpsPageHeader';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import './OpsWorkWindows.css';

const LOCATION_OPTIONS = [
  { value: 'valley', label: 'The Valley' },
  { value: 'cabin', label: 'The Cabin' }
];

/** Site-wide construction windows shown prominently before the timeline. */
const SITE_BEST_CAP = 3;

const SPAN_CLASS = {
  occupied: 'ops-ww-span--occupied',
  turnaround: 'ops-ww-span--turnaround',
  free: 'ops-ww-span--free',
  blocked: 'ops-ww-span--blocked'
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
    <li className={`ops-ww__best-row${siteWide ? ' ops-ww__best-row--site' : ''}`}>
      <div className="ops-ww__best-row-main">
        <div className="ops-ww__best-row-top">
          <p className="ops-ww__best-label">{w.label}</p>
          {siteWide ? <span className="ops-ww__site-badge">Site-wide</span> : null}
          <span className="ops-ww__free-pill">
            <span className="ops-ww__free-dot" aria-hidden />
            Free
          </span>
        </div>
        <p className="ops-ww__best-range">{range}</p>
      </div>
      <p className="ops-ww__best-dur">
        {dur}
        {rangeNote}
      </p>
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
    <OpsPage width="full">
      <div className="ops-ww">
        <OpsPageHeader
          title="Work windows"
          description="When a site or unit is free of guests — for construction, maintenance, and noisy work."
        />

        <div className="ops-ww__toolbar">
          <OpsSelect
            label="Location"
            value={locationKey}
            onChange={(e) => setLocationKey(e.target.value)}
          >
            {LOCATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </OpsSelect>
          <OpsTextField
            label="From"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <OpsTextField
            label="To"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="ops-ww__toolbar-action">
            <OpsButton
              variant="primary"
              onClick={checkAvailability}
              loading={loading}
              loadingLabel="Checking…"
            >
              Check availability
            </OpsButton>
          </div>
        </div>

        {data?.generatedAt ? (
          <p className="ops-ww__meta">
            Availability checked {formatCheckedAt(data.generatedAt)}
            <span className="ops-ww__meta-sep">
              {' '}
              · checkout {data.checkOutTime} → check-in {data.checkInTime} ({data.timezone})
            </span>
          </p>
        ) : (
          <p className="ops-ww__meta">
            Press Check availability for an on-demand snapshot. Nothing loads until you check.
          </p>
        )}

        {loading ? <OpsLoadingState label="Loading work windows…" /> : null}

        {error ? <OpsBanner tone="danger" title={error} /> : null}

        {!data && !loading && !error ? (
          <p className="ops-ww__empty">
            Choose a location and date range, then check availability.
          </p>
        ) : null}

        {data ? (
          <>
            <section className="ops-ww__section" aria-label="Best work windows">
              <h2 className="ops-ww__section-title">Best work windows</h2>
              {!locationBest.length && !unitBest.length ? (
                <p className="ops-ww__empty">
                  No multi-day free windows in this range
                  {data.resources?.some((r) => r.spans?.some((s) => s.state === 'free'))
                    ? ' (only short same-day turnarounds or partial gaps).'
                    : ' — every day has guest occupancy or a block.'}
                </p>
              ) : (
                <div className="ops-ww__section">
                  {locationBest.length ? (
                    <ul className="ops-ww__best-list">
                      {locationBest.map((w) => (
                        <BestWindowRow key={`${w.resourceId}-${w.startAt}`} w={w} siteWide />
                      ))}
                    </ul>
                  ) : (
                    <p className="ops-ww__empty">
                      No site-wide free window in this range — check individual units or the
                      timeline.
                    </p>
                  )}
                  {unitBest.length ? (
                    <details className="ops-ww__unit-details">
                      <summary className="ops-ww__unit-summary">
                        Individual unit windows ({unitBest.length})
                      </summary>
                      <ul className="ops-ww__unit-list">
                        {unitBest.map((w) => (
                          <BestWindowRow key={`${w.resourceId}-${w.startAt}`} w={w} />
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              )}
            </section>

            <section className="ops-ww__section" aria-label="Timeline">
              <div className="ops-ww__section-head">
                <h2 className="ops-ww__section-title">Timeline</h2>
                <div className="ops-ww__legend">
                  <span className="ops-ww__legend-item">
                    <span className="ops-ww__legend-swatch ops-ww__legend-swatch--free" /> Free
                  </span>
                  <span className="ops-ww__legend-item">
                    <span className="ops-ww__legend-swatch ops-ww__legend-swatch--turnaround" />{' '}
                    Turnaround
                  </span>
                  <span className="ops-ww__legend-item">
                    <span className="ops-ww__legend-swatch ops-ww__legend-swatch--occupied" />{' '}
                    Occupied
                  </span>
                  <span className="ops-ww__legend-item">
                    <span className="ops-ww__legend-swatch ops-ww__legend-swatch--blocked" /> Blocked
                  </span>
                </div>
              </div>

              <div className="ops-ww__timeline-shell">
                <div className="ops-ww__timeline-scroll">
                  <div
                    className="ops-ww__timeline-grid"
                    style={{
                      '--ops-ww-label-col': `${LABEL_COL_PX}px`,
                      '--ops-ww-day-col': `${DAY_COL_PX}px`,
                      '--ops-ww-timeline-width': `${timelineWidth}px`,
                      width: LABEL_COL_PX + timelineWidth
                    }}
                  >
                    <div className="ops-ww__label-col">
                      <div className="ops-ww__label-head">Resource</div>
                      {(data.resources || []).map((resource) => (
                        <div
                          key={resource.resourceId}
                          className={`ops-ww__label-row${
                            resource.kind === 'location' ? ' ops-ww__label-row--location' : ''
                          }`}
                          title={resource.label}
                          data-resource-id={resource.resourceId}
                          data-resource-label={resource.label}
                        >
                          <span className="ops-ww__label-text">
                            {resource.kind === 'location'
                              ? resource.label.toUpperCase()
                              : resource.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="ops-ww__days-col">
                      <div className="ops-ww__day-heads">
                        {dayKeys.map((dk) => {
                          const isToday = dk === todayKey;
                          return (
                            <div
                              key={dk}
                              className={`ops-ww__day-head${isToday ? ' ops-ww__day-head--today' : ''}`}
                              title={isToday ? `${dk} (today)` : dk}
                            >
                              <span
                                className={`ops-ww__day-weekday${
                                  isToday ? ' ops-ww__day-weekday--today' : ''
                                }`}
                              >
                                {formatDayWeekday(dk)}
                              </span>
                              <span
                                className={`ops-ww__day-num${isToday ? ' ops-ww__day-num--today' : ''}`}
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
                            className={`ops-ww__resource-row${
                              resource.kind === 'location' ? ' ops-ww__resource-row--location' : ''
                            }`}
                            data-resource-id={resource.resourceId}
                            data-resource-label={resource.label}
                          >
                            <div className="ops-ww__day-grid">
                              {dayKeys.map((dk) => (
                                <div
                                  key={dk}
                                  className={`ops-ww__day-cell${
                                    dk === todayKey ? ' ops-ww__day-cell--today' : ''
                                  }`}
                                />
                              ))}
                            </div>

                            {bars.map((span) => {
                              const { left, width, widthPct } = barGeometrySofia(span, dayKeys);
                              const showText = widthPct >= 2.2;
                              let barText = '';
                              if (span.state === 'free') {
                                barText = formatWorkDurationMinutes(span.durationMinutes);
                                if (span.continuesBeyondRange && widthPct >= 6) {
                                  barText = `${barText}+`;
                                }
                              } else if (span.state === 'occupied') {
                                barText = occupiedBarLabel(span);
                              } else {
                                barText = blockedBarLabel(span);
                              }
                              return (
                                <div
                                  key={span.spanId}
                                  title={spanTitle(span)}
                                  className={`ops-ww-span ${SPAN_CLASS[span.state] || SPAN_CLASS.blocked}`}
                                  data-span-state={span.state}
                                  style={{ left, width }}
                                >
                                  {showText && barText ? (
                                    <span className="ops-ww-span__text">{barText}</span>
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
                                  className={`ops-ww-span ${SPAN_CLASS.turnaround}`}
                                  data-span-state="turnaround"
                                  style={{ left, width: widthPct < 0.8 ? '3px' : width }}
                                >
                                  {widthPct >= 1.5 ? (
                                    <span className="ops-ww-span__text">TA</span>
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
                <p className="ops-ww__scroll-hint">
                  Swipe sideways to scroll days. Resource names stay fixed.
                </p>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </OpsPage>
  );
}
