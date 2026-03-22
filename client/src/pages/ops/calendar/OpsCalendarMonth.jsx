import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import { BLOCK_BAR, CONFLICT_RING, SYNC_BADGE, legendItems } from './calendarVisualTokens';
import {
  OPS_CALENDAR_TZ,
  addOneMonth,
  buildSofiaMonthGrid,
  computeWeekBarSegments,
  formatSofiaMonthTitle,
  sofiaNowYearMonth
} from './opsCalendarDateUtils';
import CalendarBottomSheet from './CalendarBottomSheet';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function extractMongoIdFromBlockId(id) {
  const s = String(id || '');
  if (s.startsWith('block:')) return s.slice('block:'.length);
  return null;
}

function blockRangeTitle(b) {
  const s = String(b?.startDate || '').slice(0, 10);
  const e = String(b?.endDate || '').slice(0, 10);
  return `${s} → ${e} (exclusive end)`;
}

export default function OpsCalendarMonth() {
  const { cabinId } = useParams();
  const initialYm = useMemo(() => sofiaNowYearMonth(), []);
  const [year, setYear] = useState(initialYm.year);
  const [monthIndex, setMonthIndex] = useState(initialYm.monthIndex);
  const [data, setData] = useState(null);
  const [cabinLabel, setCabinLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [openBlockKey, setOpenBlockKey] = useState(null);
  const [sheetKind, setSheetKind] = useState(null);
  const [sheetBlock, setSheetBlock] = useState(null);

  const { weeks, monthStartYmd, monthEndExclusiveYmd } = useMemo(
    () => buildSofiaMonthGrid(year, monthIndex),
    [year, monthIndex]
  );

  const monthTitle = useMemo(() => formatSofiaMonthTitle(year, monthIndex), [year, monthIndex]);
  const rangeTooltip = `${monthStartYmd} → ${monthEndExclusiveYmd} (checkout day exclusive)`;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [calRes, cabRes] = await Promise.all([
        opsReadAPI.calendar({ from: monthStartYmd, to: monthEndExclusiveYmd, cabinId }),
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
  }, [cabinId, monthStartYmd, monthEndExclusiveYmd]);

  useEffect(() => {
    load();
  }, [load]);

  const blocks = data?.blocks || [];
  const todayYmd = data?.meta?.today;
  const sync = data?.syncIndicators?.syncStatus || 'stale';
  const syncCls = SYNC_BADGE[sync] || SYNC_BADGE.stale;
  const priceHint = data?.pricingHint;

  const goToday = () => {
    const { year: y, monthIndex: m } = sofiaNowYearMonth();
    setYear(y);
    setMonthIndex(m);
  };

  const openPanel = (kind) => {
    setActionError('');
    setSheetBlock(null);
    if (kind === 'manual') setSheetKind('add_manual');
    if (kind === 'maintenance') setSheetKind('add_maintenance');
    setFormStart(monthStartYmd);
    const t0 = toDate(`${monthStartYmd} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
    setFormEnd(formatInTimeZone(addDays(t0, 1), OPS_CALENDAR_TZ, 'yyyy-MM-dd'));
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
    <div className="space-y-4 w-full max-w-7xl mx-auto pb-28 md:pb-10 text-left">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <Link to="/ops/calendar" className="text-sm text-[#81887A] hover:underline inline-block">
              ← All properties
            </Link>
            <h1
              className="text-2xl md:text-3xl font-semibold text-gray-900 tracking-tight"
              title={rangeTooltip}
            >
              {monthTitle}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
              <span className="font-medium text-gray-800">{cabinLabel}</span>
              <span className={`text-xs px-2.5 py-0.5 rounded-full border ${syncCls}`}>Sync: {sync}</span>
              <span className="text-xs text-gray-500">{OPS_CALENDAR_TZ}</span>
            </div>
            {priceHint?.nightPrice != null ? (
              <p className="text-sm text-gray-600 pt-1">
                List night from cabin: <span className="font-semibold">{priceHint.nightPrice}</span>{' '}
                {priceHint.currency?.toUpperCase()}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                const n = addOneMonth(year, monthIndex, -1);
                setYear(n.year);
                setMonthIndex(n.monthIndex);
              }}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={goToday}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 font-medium"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                const n = addOneMonth(year, monthIndex, 1);
                setYear(n.year);
                setMonthIndex(n.monthIndex);
              }}
              className="px-3 py-2 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>

        {error ? <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2 mt-4">{error}</div> : null}
        {actionError && !sheetKind ? (
          <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg px-3 py-2 mt-3">{actionError}</div>
        ) : null}

        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
          <button
            type="button"
            onClick={() => openPanel('manual')}
            className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 hover:bg-gray-50"
          >
            Add manual block
          </button>
          <button
            type="button"
            onClick={() => openPanel('maintenance')}
            className="px-3 py-2 text-sm rounded-lg bg-white border border-gray-200 hover:bg-gray-50"
          >
            Add maintenance
          </button>
        </div>
      </section>

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
          <div className="text-xs text-gray-500">{blockRangeTitle(sheetBlock)}</div>
          {actionError ? (
            <div className="text-sm text-red-700 border border-red-200 bg-red-50 rounded-lg px-3 py-2">
              {actionError}
            </div>
          ) : null}
        </div>
      </CalendarBottomSheet>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="px-3 py-2.5 border-b border-gray-200 bg-gray-50/90">
          <p className="text-[11px] sm:text-xs font-medium text-gray-600 mb-2">Legend</p>
          <ul className="flex flex-wrap gap-1.5 sm:gap-2">
            {legendItems().map((x) => (
              <li key={x.key} className={`text-[10px] sm:text-xs px-2 py-0.5 sm:py-1 rounded border ${x.className}`}>
                {x.label}
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-gray-500 mt-2">
            Conflicts: hard {data?.conflictMarkers?.hard?.length || 0}, warnings {data?.conflictMarkers?.warnings?.length || 0}
          </p>
        </div>

        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-200/90">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-[10px] sm:text-xs font-semibold text-gray-700 text-center py-2.5">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((weekCells, wi) => {
          const { segs, laneCount } = computeWeekBarSegments(weekCells, blocks, cabinId);
          const barAreaH = Math.min(12, laneCount) * 28 + 10;
          return (
            <div key={wi} className="border-b border-gray-100 last:border-b-0">
              <div className="grid grid-cols-7 divide-x divide-gray-100">
                {weekCells.map((cell) => {
                  const inMonth = cell.ymd >= monthStartYmd && cell.ymd < monthEndExclusiveYmd;
                  const isToday = todayYmd && cell.ymd === todayYmd;
                  return (
                    <div
                      key={cell.ymd}
                      className={`min-h-[52px] sm:min-h-[60px] p-1.5 ${
                        !inMonth ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-900'
                      } ${isToday ? 'ring-2 ring-inset ring-[#81887A]/50 bg-[#f4f6f2]' : ''}`}
                    >
                      <div
                        className={`text-xs sm:text-sm font-semibold tabular-nums ${inMonth ? 'text-gray-900' : 'text-gray-300'}`}
                      >
                        {cell.dayOfMonth}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="relative border-t border-gray-100 bg-gray-50/60 px-0.5 py-1" style={{ minHeight: barAreaH }}>
                {segs.map((s) => {
                  const b = s.block;
                  const bar = BLOCK_BAR[b.blockType] || 'bg-gray-500 text-white';
                  const ring = b.render?.conflictToken === 'hard' ? CONFLICT_RING.hard : b.render?.conflictToken === 'warning' ? CONFLICT_RING.warning : '';
                  const label = b.render?.labelShort || b.blockType;
                  const top = 5 + s.lane * 28;
                  const rowKey = `${wi}-${b.id}`;
                  const canAct = (b.blockType === 'manual_block' || b.blockType === 'maintenance') && extractMongoIdFromBlockId(b.id);
                  const menuOpen = openBlockKey === rowKey;
                  const tip = `${label} — ${blockRangeTitle(b)}`;

                  if (b.blockType === 'reservation') {
                    return (
                      <Link
                        key={rowKey}
                        to={`/ops/reservations/${b.sourceReference}`}
                        className={`absolute flex items-center px-1 rounded border text-[10px] sm:text-xs font-medium truncate shadow-sm ${bar} ${ring}`}
                        style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, top, height: 24 }}
                        title={tip}
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
                        style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, top, height: 24 }}
                        title={tip}
                        onClick={() => setOpenBlockKey((k) => (k === rowKey ? null : rowKey))}
                      >
                        {label}
                      </button>
                      {menuOpen && canAct ? (
                        <div
                          className="absolute z-20 flex flex-col gap-1 bg-white border border-gray-200 shadow-lg rounded-lg p-2 text-xs"
                          style={{ left: `${s.leftPct}%`, top: top + 26, minWidth: 140 }}
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
    </div>
  );
}
