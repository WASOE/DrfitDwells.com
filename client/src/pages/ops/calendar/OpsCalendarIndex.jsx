import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../../services/opsApi';
import { BLOCK_DOT, CONFLICT_RING, SYNC_BADGE } from './calendarVisualTokens';
import { eachDayKeyInRange, parseIsoDay } from './opsCalendarDateUtils';

function dayStripCells(fromIso, toIso) {
  const a = parseIsoDay(fromIso);
  const b = parseIsoDay(toIso);
  if (!a || !b) return [];
  return eachDayKeyInRange(a, b);
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
  if (hard) return { dot: 'bg-red-500', ring: CONFLICT_RING.hard };
  if (warn) return { dot: 'bg-amber-400', ring: CONFLICT_RING.warning };
  if (types.has('maintenance')) return { dot: BLOCK_DOT.maintenance, ring: '' };
  if (types.has('reservation')) return { dot: BLOCK_DOT.reservation, ring: '' };
  if (types.has('manual_block')) return { dot: BLOCK_DOT.manual_block, ring: '' };
  if (types.has('external_hold')) return { dot: BLOCK_DOT.external_hold, ring: '' };
  return { dot: 'bg-gray-100', ring: '' };
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

export default function OpsCalendarIndex() {
  const [preview, setPreview] = useState(null);
  const [cabinsExtra, setCabinsExtra] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      const p = byId.get(c.cabinId);
      return { cabin: c, preview: p || null };
    });
    const seen = new Set(rows.map((r) => r.cabin.cabinId));
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

  if (loading) {
    return <div className="text-sm text-gray-500 py-8">Loading properties…</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto px-1 sm:px-0 pb-20 md:pb-8">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-600">
          Pick a property for the operational month view. Preview shows the next {preview?.request?.previewDays || 14} nights ({preview?.meta?.propertyTimezone || 'Europe/Sofia'}).
        </p>
        {preview?.meta?.today ? (
          <p className="text-xs text-gray-500">
            Today: <span className="font-mono">{preview.meta.today}</span>
          </p>
        ) : null}
      </header>

      {error ? <div className="text-sm text-red-600 rounded-lg border border-red-200 bg-red-50 px-3 py-2">{error}</div> : null}

      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wide text-gray-500">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-600" /> Res.
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500" /> Manual
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-gray-800" /> Maint.
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-violet-500" /> Ext.
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500" /> Conflict
        </span>
      </div>

      <ul className="space-y-3">
        {mergedRows.length === 0 ? (
          <li className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">No properties found.</li>
        ) : null}
        {mergedRows.map(({ cabin, preview: pr }) => {
          const blocks = pr?.blocks || [];
          const sync = pr?.syncIndicators?.syncStatus || 'stale';
          const syncCls = SYNC_BADGE[sync] || SYNC_BADGE.stale;
          const img = cabin.content?.imageUrl || pr?.listing?.imageUrl;
          const hardN =
            pr?.summary?.hardConflictCount ??
            pr?.conflictMarkers?.hard?.length ??
            0;
          const warnN =
            pr?.summary?.warningCount ??
            pr?.conflictMarkers?.warnings?.length ??
            0;

          return (
            <li key={cabin.cabinId}>
              <Link
                to={`/ops/calendar/${cabin.cabinId}`}
                className="flex gap-3 sm:gap-4 bg-white border border-gray-200 rounded-xl p-3 sm:p-4 hover:border-gray-300 hover:shadow-sm transition-shadow min-w-0"
              >
                <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg bg-gray-100 overflow-hidden border border-gray-100">
                  {img ? (
                    <img src={img} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs font-semibold text-gray-700 bg-gray-50">
                      {initialsFromName(cabin.name)}
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 truncate">{cabin.name}</div>
                      <div className="text-xs text-gray-500 truncate">{cabin.location || '—'}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          cabin.isActive !== false ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-gray-100 text-gray-600 border-gray-200'
                        }`}
                      >
                        {cabin.isActive !== false ? 'Active' : 'Inactive'}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${syncCls}`}>Sync: {sync}</span>
                    </div>
                  </div>

                  <div className="overflow-x-auto -mx-1 px-1">
                    <div className="flex gap-0.5 min-w-max py-1">
                      {stripKeys.map((dk) => {
                        const { dot, ring } = cellToneForDay(dk, blocks);
                        const isToday = dk === preview?.meta?.today;
                        return (
                          <div
                            key={dk}
                            title={dk}
                            className={`w-2.5 h-6 rounded-sm flex items-end justify-center pb-0.5 shrink-0 ${isToday ? 'outline outline-2 outline-amber-400 outline-offset-1' : ''}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${dot} ${ring}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {pr?.summary?.hasConflict ? (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {hardN > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-800 font-medium">
                          Hard {hardN}
                        </span>
                      ) : null}
                      {warnN > 0 ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-900 font-medium">
                          Warn {warnN}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
