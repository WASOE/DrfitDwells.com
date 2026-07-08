import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import {
  BLOCK_DOT,
  CONFLICT_RING,
  PREVIEW_DOT_CONFLICT,
  PREVIEW_DOT_EMPTY,
  PREVIEW_DOT_SIZE,
  PREVIEW_DOT_WARNING,
  SYNC_BADGE
} from './calendarVisualTokens';
import { eachDayKeyInRange, parseIsoDay } from './opsCalendarDateUtils';
import LocationBlockSheet from './LocationBlockSheet';
import OpsCalendarLegend from './OpsCalendarLegend';
import CalendarBottomSheet from './CalendarBottomSheet';

function dayStripCells(fromIso, toIso) {
  const a = parseIsoDay(fromIso);
  const b = parseIsoDay(toIso);
  if (!a || !b) return [];
  return eachDayKeyInRange(a, b);
}

function formatStripDayLabel(dayKey) {
  const d = parseIsoDay(dayKey);
  if (!d) return '';
  const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return weekdays[d.getUTCDay()];
}

function cellToneForDay(dayKey, blocks) {
  let hard = false;
  let warn = false;
  const types = new Set();
  for (const b of blocks) {
    const keys = b.render?.occupiedDayKeys || [];
    if (!keys.includes(dayKey)) continue;
    if (b.render?.conflictToken === 'hard') hard = true;
    if (b.render?.conflictToken === 'warning') warn = true;
    types.add(b.blockType);
  }
  if (hard) return { dot: PREVIEW_DOT_CONFLICT, ring: CONFLICT_RING.hard };
  if (warn) return { dot: PREVIEW_DOT_WARNING, ring: CONFLICT_RING.warning };
  if (types.has('maintenance')) return { dot: BLOCK_DOT.maintenance, ring: '' };
  if (types.has('reservation')) return { dot: BLOCK_DOT.reservation, ring: '' };
  if (types.has('manual_block')) return { dot: BLOCK_DOT.manual_block, ring: '' };
  if (types.has('external_hold')) return { dot: BLOCK_DOT.external_hold, ring: '' };
  return { dot: PREVIEW_DOT_EMPTY, ring: '' };
}

function initialsFromName(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
  const out = `${a}${b}`.toUpperCase();
  return out || '—';
}

function conflictAccentClass(hardN, warnN) {
  if (hardN > 0) return 'border-l-red-500';
  if (warnN > 0) return 'border-l-amber-400';
  return 'border-l-transparent';
}

/** Stable id for calendar routes (single cabin or multi-unit type from ops cabins list). */
function propertyRouteId(cabinLike) {
  return cabinLike.cabinId || cabinLike.cabinTypeId || '';
}

function formatGroupDateRange(startIso, endIso) {
  const s = String(startIso || '').slice(0, 10);
  const e = String(endIso || '').slice(0, 10);
  return `${s} → ${e} (exclusive end)`;
}

export default function OpsCalendarIndex() {
  const [preview, setPreview] = useState(null);
  const [cabinsExtra, setCabinsExtra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [locationBlockOpen, setLocationBlockOpen] = useState(false);
  const [locationBlockFlash, setLocationBlockFlash] = useState('');
  const [removeGroup, setRemoveGroup] = useState(null);
  const [removeError, setRemoveError] = useState('');
  const [removeLoading, setRemoveLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [calRes, cabRes] = await Promise.all([
        opsReadAPI.calendar({ indexPreview: '1', previewDays: 14 }),
        opsReadAPI.cabins({ page: 1, limit: 100 })
      ]);
      setPreview(calRes.data?.data || null);
      setCabinsExtra(cabRes.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load calendar index');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stripKeys = useMemo(() => {
    const from = preview?.request?.from;
    const to = preview?.request?.to;
    if (!from || !to) return [];
    return dayStripCells(from, to);
  }, [preview]);

  const mergedRows = useMemo(() => {
    const byId = new Map();
    (preview?.previewByCabin || []).forEach((row) => {
      byId.set(row.cabinId, row);
    });
    const items = cabinsExtra?.items || [];
    const rows = items.map((c) => {
      const routeId = propertyRouteId(c);
      const p = byId.get(routeId) || byId.get(c.cabinId) || byId.get(c.cabinTypeId);
      return { cabin: c, preview: p || null };
    });
    const seen = new Set(rows.map((r) => propertyRouteId(r.cabin)).filter(Boolean));
    (preview?.previewByCabin || []).forEach((p) => {
      if (seen.has(p.cabinId)) return;
      rows.push({
        cabin: {
          cabinId: p.cabinId,
          name: p.listing?.name || `Cabin ${p.cabinId}`,
          location: '',
          isActive: p.listing?.isActive !== false,
          operational: {},
          content: { imageUrl: p.listing?.imageUrl || null, imagesCount: 0, descriptionPresent: false }
        },
        preview: p
      });
    });
    return rows;
  }, [preview, cabinsExtra]);

  const previewDays = preview?.request?.previewDays || 14;
  const timezone = preview?.meta?.propertyTimezone || 'Europe/Sofia';
  const activeLocationBlockGroups = preview?.activeLocationBlockGroups || [];

  const openRemoveGroup = (group) => {
    if (!group?.locationBlockGroupId) return;
    setRemoveError('');
    setRemoveGroup(group);
  };

  const closeRemoveGroup = () => {
    setRemoveGroup(null);
    setRemoveError('');
  };

  const confirmRemoveGroup = async () => {
    const groupId = removeGroup?.locationBlockGroupId;
    if (!groupId) {
      setRemoveError('Cannot remove location-wide block: group id is missing.');
      return;
    }

    setRemoveLoading(true);
    setRemoveError('');
    try {
      await opsWriteAPI.removeLocationBlockGroup(groupId, 'ops_calendar_index');
      closeRemoveGroup();
      setLocationBlockFlash('Location-wide block removed from all properties in this group.');
      await load();
    } catch (err) {
      setRemoveError(err?.response?.data?.message || 'Remove failed');
    } finally {
      setRemoveLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="w-full max-w-lg mx-auto pb-24 lg:max-w-none lg:mx-0">
        <p className="py-8 text-center text-sm text-gray-400">Loading properties…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto pb-24 md:pb-10 lg:max-w-none lg:mx-0 lg:pb-8">
      <div className="space-y-3 lg:max-w-7xl lg:mx-auto">
        <section className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm text-left">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">Calendar</h1>
              <span className="text-xs text-gray-500">
                Next {previewDays} nights · {timezone}
                {preview?.meta?.today ? (
                  <> · Today <span className="font-medium text-gray-700">{preview.meta.today}</span></>
                ) : null}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLocationBlockOpen(true)}
              className="shrink-0 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:border-gray-400 hover:bg-gray-50 transition-colors"
            >
              Block location
            </button>
          </div>

          <div className="mt-2 border-t border-gray-100 pt-2">
            <OpsCalendarLegend />
          </div>
        </section>

        {locationBlockFlash ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {locationBlockFlash}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
        ) : null}

        {activeLocationBlockGroups.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Active location blocks</h2>
            <ul className="space-y-2">
              {activeLocationBlockGroups.map((group) => {
                const label = group.locationLabel || group.locationKey || 'Location';
                const count = group.targetCount ?? 0;
                return (
                  <li
                    key={group.locationBlockGroupId}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm border-l-4 border-l-amber-500"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Location-wide
                          </span>
                          <span className="text-xs text-gray-500">
                            {formatGroupDateRange(group.startDate, group.endDate)} · {count} propert{count === 1 ? 'y' : 'ies'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openRemoveGroup(group)}
                        className="shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:border-red-200 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <ul className="space-y-2">
          {mergedRows.length === 0 ? (
            <li className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
              No properties found.
            </li>
          ) : null}
          {mergedRows.map(({ cabin, preview: pr }) => {
            const routeId = propertyRouteId(cabin);
            const rowKey = routeId || `row-${cabin.name}`;
            const blocks = pr?.blocks || [];
            const sync = pr?.syncIndicators?.syncStatus || 'stale';
            const syncCls = SYNC_BADGE[sync] || SYNC_BADGE.stale;
            const img = cabin.content?.imageUrl || pr?.listing?.imageUrl;
            const hardN = pr?.summary?.hardConflictCount ?? pr?.conflictMarkers?.hard?.length ?? 0;
            const warnN = pr?.summary?.warningCount ?? pr?.conflictMarkers?.warnings?.length ?? 0;
            const accentCls = conflictAccentClass(hardN, warnN);

            return (
              <li key={rowKey}>
                <Link
                  to={routeId ? `/ops/calendar/${routeId}` : '#'}
                  className={`group block rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm border-l-4 min-w-0 text-left transition-all ${accentCls} ${
                    routeId
                      ? 'hover:border-gray-300 hover:shadow-md'
                      : 'opacity-60 pointer-events-none'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      <div className="h-11 w-11 overflow-hidden rounded-lg border border-gray-100 bg-gray-100 sm:h-12 sm:w-12">
                        {img ? (
                          <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gray-50 text-xs font-semibold text-gray-700">
                            {initialsFromName(cabin.name)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                          <h2 className="truncate text-sm font-semibold leading-snug text-gray-900 group-hover:text-gray-950">
                            {cabin.name}
                          </h2>
                          <span className="truncate text-xs text-gray-500">{cabin.location || '—'}</span>
                        </div>
                        {routeId ? (
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500" />
                        ) : null}
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {cabin.kind === 'multi_unit_type' ? (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-800">
                            Multi-unit
                          </span>
                        ) : null}
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                            cabin.isActive !== false
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {cabin.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${syncCls}`}
                        >
                          Sync {sync}
                        </span>
                        {hardN > 0 ? (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                            {hardN} conflict{hardN === 1 ? '' : 's'}
                          </span>
                        ) : null}
                        {warnN > 0 ? (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            {warnN} warning{warnN === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {stripKeys.length > 0 ? (
                      <div className="hidden shrink-0 items-center gap-1 border-l border-gray-100 pl-3 lg:flex" title={`Next ${previewDays} nights`}>
                        {stripKeys.map((dk) => {
                          const { dot, ring } = cellToneForDay(dk, blocks);
                          const isToday = dk === preview?.meta?.today;
                          return (
                            <span
                              key={dk}
                              title={dk}
                              className={`flex h-4 w-4 items-center justify-center rounded-full ${
                                isToday ? 'ring-2 ring-gray-900 ring-offset-1' : ''
                              }`}
                            >
                              <span className={`${PREVIEW_DOT_SIZE} rounded-full ${dot} ${ring}`} />
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {stripKeys.length > 0 ? (
                    <div className="mt-2 border-t border-gray-100 pt-2 lg:hidden">
                      <div className="overflow-x-auto -mx-1 px-1">
                        <div className="flex min-w-max gap-1">
                          {stripKeys.map((dk) => {
                            const { dot, ring } = cellToneForDay(dk, blocks);
                            const isToday = dk === preview?.meta?.today;
                            return (
                              <div key={dk} title={dk} className="flex w-5 shrink-0 flex-col items-center gap-0.5">
                                <span className="text-[9px] font-medium text-gray-400">{formatStripDayLabel(dk)}</span>
                                <span
                                  className={`flex h-4 w-4 items-center justify-center rounded-full ${
                                    isToday ? 'ring-2 ring-gray-900 ring-offset-1' : ''
                                  }`}
                                >
                                  <span className={`${PREVIEW_DOT_SIZE} rounded-full ${dot} ${ring}`} />
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>

        <LocationBlockSheet
          open={locationBlockOpen}
          onClose={() => setLocationBlockOpen(false)}
          onSuccess={(data) => {
            setLocationBlockFlash(`Entire location blocked for ${data?.targetCount || 0} properties.`);
            load();
          }}
        />

        <CalendarBottomSheet
          open={Boolean(removeGroup)}
          title="Remove entire location block?"
          subtitle="This removes the location-wide block from every property/unit included in this group. Existing reservations, external holds, maintenance blocks, and separate manual blocks remain unchanged."
          onClose={closeRemoveGroup}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirmRemoveGroup}
                disabled={removeLoading}
                className="h-11 flex-1 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50 sm:flex-none"
              >
                {removeLoading ? 'Removing…' : 'Remove entire location block'}
              </button>
              <button
                type="button"
                onClick={closeRemoveGroup}
                disabled={removeLoading}
                className="h-11 flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 disabled:opacity-50 sm:flex-none"
              >
                Cancel
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-800">
              {removeGroup?.locationLabel || removeGroup?.locationKey || 'Location-wide block'}
            </div>
            <div className="text-xs text-gray-500">
              {formatGroupDateRange(removeGroup?.startDate, removeGroup?.endDate)}
            </div>
            {removeGroup?.targetCount != null ? (
              <div className="text-xs text-gray-600">
                {removeGroup.targetCount} propert{removeGroup.targetCount === 1 ? 'y' : 'ies'} in this group
              </div>
            ) : null}
            {removeError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {removeError}
              </div>
            ) : null}
          </div>
        </CalendarBottomSheet>
      </div>
    </div>
  );
}
