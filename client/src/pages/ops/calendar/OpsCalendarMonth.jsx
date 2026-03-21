import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import { BLOCK_BAR, CONFLICT_RING, SYNC_BADGE, legendItems } from './calendarVisualTokens';
import { addDaysUtc, buildMonthGrid, ymdUtc } from './opsCalendarDateUtils';
import CalendarBottomSheet from './CalendarBottomSheet';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function utcMidnight(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetweenUtc(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function blockExclusiveEndDate(block) {
  return new Date(block.endDate);
}

function blockStartDate(block) {
  return new Date(block.startDate);
}

function segmentsForWeek(weekDays, blocks, cabinId) {
  const weekStart = utcMidnight(weekDays[0]);
  const weekEndEx = addDaysUtc(weekStart, 7);
  const segs = [];
  for (const b of blocks) {
    if (String(b.cabinId) !== String(cabinId)) continue;
    if (b.status === 'tombstoned') continue;
    const bs = utcMidnight(blockStartDate(b));
    const bex = utcMidnight(blockExclusiveEndDate(b));
    const os = bs > weekStart ? bs : weekStart;
    const oe = bex < weekEndEx ? bex : weekEndEx;
    if (os >= oe) continue;
    const startOffset = daysBetweenUtc(weekStart, os);
    const span = daysBetweenUtc(os, oe);
    const endOffset = startOffset + span;
    segs.push({
      block: b,
      startOffset,
      endOffset,
      span,
      leftPct: (startOffset / 7) * 100,
      widthPct: (span / 7) * 100,
      lane: 0
    });
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

function extractMongoIdFromBlockId(id) {
  const s = String(id || '');
  if (s.startsWith('block:')) return s.slice('block:'.length);
  return null;
}

export default function OpsCalendarMonth() {
  const { cabinId } = useParams();
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getUTCMonth());
  const [data, setData] = useState(null);
  const [cabinLabel, setCabinLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [openBlockKey, setOpenBlockKey] = useState(null);
  const [sheetKind, setSheetKind] = useState(null); // add_manual | add_maintenance | edit_manual | edit_maintenance | remove
  const [sheetBlock, setSheetBlock] = useState(null);

  const { monthStart, monthEndExclusive, weeks } = useMemo(() => buildMonthGrid(year, monthIndex), [year, monthIndex]);

  const fromYmd = ymdUtc(monthStart);
  const toYmd = ymdUtc(monthEndExclusive);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [calRes, cabRes] = await Promise.all([
        opsReadAPI.calendar({ from: fromYmd, to: toYmd, cabinId }),
        opsReadAPI.cabinDetail(cabinId)
      ]);
      setData(calRes.data?.data || null);
      const name = cabRes.data?.data?.contentMedia?.name || cabRes.data?.data?.cabinId || cabinId;
      setCabinLabel(name);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  }, [cabinId, fromYmd, toYmd]);

  useEffect(() => {
    load();
  }, [load]);

  const blocks = data?.blocks || [];
  const todayYmd = data?.meta?.today;
  const sync = data?.syncIndicators?.syncStatus || 'stale';
  const syncCls = SYNC_BADGE[sync] || SYNC_BADGE.stale;
  const priceHint = data?.pricingHint;

  const openPanel = (kind) => {
    setActionError('');
    setSheetBlock(null);
    if (kind === 'manual') setSheetKind('add_manual');
    if (kind === 'maintenance') setSheetKind('add_maintenance');
    setFormStart(fromYmd);
    setFormEnd(ymdUtc(addDaysUtc(monthStart, 1)));
  };

  const closeSheet = () => {
    setSheetKind(null);
    setSheetBlock(null);
    setActionError('');
  };

  const submitBlock = async () => {
    setActionError('');
    try {
      if (sheetKind === 'add_manual') {
        await opsWriteAPI.createManualBlock({ cabinId, startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      } else if (sheetKind === 'add_maintenance') {
        await opsWriteAPI.createMaintenanceBlock({ cabinId, startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      } else if (sheetKind === 'edit_manual') {
        const id = extractMongoIdFromBlockId(sheetBlock?.id);
        await opsWriteAPI.editManualBlock(id, { startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      } else if (sheetKind === 'edit_maintenance') {
        const id = extractMongoIdFromBlockId(sheetBlock?.id);
        await opsWriteAPI.editMaintenanceBlock(id, { startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      }

      closeSheet();
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Action failed');
    }
  };

  const requestEditBlockDates = (b) => {
    const id = extractMongoIdFromBlockId(b?.id);
    if (!id) return;
    setActionError('');
    setOpenBlockKey(null);
    setSheetBlock(b);
    setFormStart(String(b.startDate).slice(0, 10));
    setFormEnd(String(b.endDate).slice(0, 10));
    if (b.blockType === 'manual_block') setSheetKind('edit_manual');
    if (b.blockType === 'maintenance') setSheetKind('edit_maintenance');
  };

  const requestRemoveBlock = (b) => {
    const id = extractMongoIdFromBlockId(b?.id);
    if (!id) return;
    setActionError('');
    setOpenBlockKey(null);
    setSheetBlock(b);
    setSheetKind('remove');
  };

  const removeBlock = async () => {
    const b = sheetBlock;
    const id = extractMongoIdFromBlockId(b?.id);
    if (!id) return;

    setActionError('');
    try {
      if (b?.blockType === 'manual_block') await opsWriteAPI.removeManualBlock(id, 'ops_calendar');
      if (b?.blockType === 'maintenance') await opsWriteAPI.removeMaintenanceBlock(id, 'ops_calendar');
      await load();
      closeSheet();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Remove failed');
    }
  };

  if (loading && !data) {
    return <div className="text-sm text-gray-500 py-8">Loading month…</div>;
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto px-1 sm:px-0 pb-28 md:pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <Link to="/ops/calendar" className="text-xs text-[#81887A] hover:underline">
            ← All properties
          </Link>
          <h1 className="text-lg font-semibold text-gray-900 truncate mt-1">{cabinLabel}</h1>
          <p className="text-xs text-gray-500 font-mono">
            {fromYmd} → {toYmd} <span className="text-gray-400">(exclusive end)</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              const d = new Date(Date.UTC(year, monthIndex - 1, 1));
              setYear(d.getUTCFullYear());
              setMonthIndex(d.getUTCMonth());
            }}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(Date.UTC(year, monthIndex + 1, 1));
              setYear(d.getUTCFullYear());
              setMonthIndex(d.getUTCMonth());
            }}
            className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white"
          >
            Next
          </button>
          <span className={`text-xs px-2 py-1 rounded-full border ${syncCls}`}>Sync {sync}</span>
        </div>
      </div>

      {priceHint?.nightPrice != null ? (
        <div className="text-xs text-gray-600">
          List night from cabin: <span className="font-semibold">{priceHint.nightPrice}</span> {priceHint.currency?.toUpperCase()}
        </div>
      ) : null}

      {error ? <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">{error}</div> : null}
      {actionError && !sheetKind ? <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2">{actionError}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => openPanel('manual')} className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-200">
          Add manual block
        </button>
        <button type="button" onClick={() => openPanel('maintenance')} className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-200">
          Add maintenance
        </button>
      </div>

      <CalendarBottomSheet
        open={
          sheetKind === 'add_manual' ||
          sheetKind === 'add_maintenance' ||
          sheetKind === 'edit_manual' ||
          sheetKind === 'edit_maintenance'
        }
        title={
          sheetKind === 'add_manual'
            ? 'New manual block'
            : sheetKind === 'add_maintenance'
              ? 'New maintenance block'
              : sheetKind === 'edit_manual'
                ? 'Edit manual block dates'
                : 'Edit maintenance block dates'
        }
        subtitle="Start is inclusive; end is exclusive."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={submitBlock} className="h-11 px-4 text-sm rounded-lg bg-gray-900 text-white font-semibold">
              Save
            </button>
            <button type="button" onClick={closeSheet} className="h-11 px-4 text-sm rounded-lg border border-gray-300 bg-white">
              Cancel
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-600 block">
            Start (inclusive)
            <input
              type="date"
              value={formStart}
              onChange={(e) => setFormStart(e.target.value)}
              className="mt-1 w-full border rounded-lg px-2 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600 block">
            End (exclusive)
            <input
              type="date"
              value={formEnd}
              onChange={(e) => setFormEnd(e.target.value)}
              className="mt-1 w-full border rounded-lg px-2 py-2 text-sm"
            />
          </label>
        </div>

        {actionError ? (
          <div className="mt-3 text-sm text-red-700 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
            {actionError}
          </div>
        ) : null}
      </CalendarBottomSheet>

      <CalendarBottomSheet
        open={sheetKind === 'remove'}
        title="Remove this block?"
        subtitle="This will tombstone/remove the selected manual or maintenance block."
        onClose={closeSheet}
        footer={
          <div className="flex gap-2">
            <button type="button" onClick={removeBlock} className="h-11 px-4 text-sm rounded-lg bg-red-700 text-white font-semibold">
              Remove
            </button>
            <button type="button" onClick={closeSheet} className="h-11 px-4 text-sm rounded-lg border border-gray-300 bg-white">
              Cancel
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-sm text-gray-800 font-medium">
            {sheetBlock?.blockType === 'manual_block'
              ? 'Manual block'
              : sheetBlock?.blockType === 'maintenance'
                ? 'Maintenance block'
                : 'Block'}
          </div>
          <div className="text-xs text-gray-500">
            {String(sheetBlock?.startDate || '').slice(0, 10)} → {String(sheetBlock?.endDate || '').slice(0, 10)} (end exclusive)
          </div>
          {actionError ? (
            <div className="text-sm text-red-700 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
              {actionError}
            </div>
          ) : null}
        </div>
      </CalendarBottomSheet>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-[10px] sm:text-xs font-medium text-gray-500 text-center py-2">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((weekDays, wi) => {
          const { segs, laneCount } = segmentsForWeek(weekDays, blocks, cabinId);
          const barAreaH = Math.min(12, laneCount) * 26 + 8;
          return (
            <div key={wi} className="border-b border-gray-100 last:border-b-0">
              <div className="grid grid-cols-7">
                {weekDays.map((day) => {
                  const inMonth = day >= monthStart && day < monthEndExclusive;
                  const ymd = ymdUtc(day);
                  const isToday = todayYmd && ymd === todayYmd;
                  return (
                    <div
                      key={ymd}
                      className={`min-h-[48px] sm:min-h-[56px] border-r border-gray-100 last:border-r-0 p-1 ${!inMonth ? 'bg-gray-50/80' : 'bg-white'} ${
                        isToday ? 'ring-1 ring-inset ring-amber-400 bg-amber-50/40' : ''
                      }`}
                    >
                      <div className={`text-xs sm:text-sm font-medium ${inMonth ? 'text-gray-900' : 'text-gray-300'}`}>{day.getUTCDate()}</div>
                    </div>
                  );
                })}
              </div>
              <div className="relative border-t border-gray-100 bg-gray-50/50 px-0.5" style={{ minHeight: barAreaH }}>
                {segs.map((s) => {
                  const b = s.block;
                  const bar = BLOCK_BAR[b.blockType] || 'bg-gray-500 text-white';
                  const ring = b.render?.conflictToken === 'hard' ? CONFLICT_RING.hard : b.render?.conflictToken === 'warning' ? CONFLICT_RING.warning : '';
                  const label = b.render?.labelShort || b.blockType;
                  const top = 4 + s.lane * 26;
                  const rowKey = `${wi}-${b.id}`;
                  const canAct = (b.blockType === 'manual_block' || b.blockType === 'maintenance') && extractMongoIdFromBlockId(b.id);
                  const menuOpen = openBlockKey === rowKey;

                  if (b.blockType === 'reservation') {
                    return (
                      <Link
                        key={rowKey}
                        to={`/ops/reservations/${b.sourceReference}`}
                        className={`absolute flex items-center px-1 rounded border text-[10px] sm:text-xs font-medium truncate shadow-sm ${bar} ${ring}`}
                        style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, top, height: 22 }}
                        title={label}
                      >
                        {label}
                      </Link>
                    );
                  }

                  return (
                    <Fragment key={rowKey}>
                      <button
                        type="button"
                        className={`absolute flex items-center px-1 rounded border text-[10px] sm:text-xs font-medium truncate shadow-sm text-left ${bar} ${ring}`}
                        style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, top, height: 22 }}
                        title={label}
                        onClick={() => setOpenBlockKey((k) => (k === rowKey ? null : rowKey))}
                      >
                        {label}
                      </button>
                      {menuOpen && canAct ? (
                        <div
                          className="absolute z-20 flex flex-col gap-1 bg-white border border-gray-200 shadow-lg rounded-lg p-2 text-xs"
                          style={{ left: `${s.leftPct}%`, top: top + 24, minWidth: 140 }}
                        >
                          <button
                            type="button"
                            className="text-left h-9 flex items-center px-2 rounded hover:bg-gray-50"
                            onClick={() => {
                              setOpenBlockKey(null);
                              requestEditBlockDates(b);
                            }}
                          >
                            Edit dates
                          </button>
                          <button
                            type="button"
                            className="text-left h-9 flex items-center px-2 rounded text-red-700 hover:bg-red-50"
                            onClick={() => {
                              setOpenBlockKey(null);
                              requestRemoveBlock(b);
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Legend</h3>
        <ul className="flex flex-wrap gap-2">
          {legendItems().map((x) => (
            <li key={x.key} className={`text-xs px-2 py-1 rounded border ${x.className}`}>
              {x.label}
            </li>
          ))}
        </ul>
        <p className="text-xs text-gray-500 mt-2">
          Conflicts: hard {data?.conflictMarkers?.hard?.length || 0}, warnings {data?.conflictMarkers?.warnings?.length || 0}
        </p>
      </div>
    </div>
  );
}
