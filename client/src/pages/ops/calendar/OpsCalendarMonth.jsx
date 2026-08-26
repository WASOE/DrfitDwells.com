import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import {
  OPS_CALENDAR_BASE_PATH,
  OPS_WORK_WINDOWS_PATH,
  isOpsCalendarCabinIdParam,
  isOpsCalendarReservedSegment
} from '../../../layouts/ops/opsCalendarRoutes';
import { BLOCK_BAR, CONFLICT_RING, SYNC_BADGE } from './calendarVisualTokens';
import {
  OPS_CALENDAR_TZ,
  addOneMonth,
  buildSofiaMonthGrid,
  computeWeekBarSegments,
  formatSofiaMonthTitle,
  sofiaNowYearMonth
} from './opsCalendarDateUtils';
import CalendarBottomSheet from './CalendarBottomSheet';
import OpsCalendarLegend from './OpsCalendarLegend';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const navBtnCls =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400 transition-colors';

const LOCATION_KEY_LABELS = {
  valley: 'The Valley',
  cabin: 'The Cabin'
};

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

function getLocationBlockGroupId(block) {
  const id = block?.locationBlockGroupId;
  if (!id) return null;
  const trimmed = String(id).trim();
  return trimmed || null;
}

function isLocationWideManualBlock(block) {
  if (block?.blockType !== 'manual_block') return false;
  if (block.isLocationWideBlock) return true;
  return Boolean(getLocationBlockGroupId(block));
}

function blockDisplayLabel(block) {
  if (isLocationWideManualBlock(block)) return 'Location-wide';
  return block.render?.labelShort || block.blockType;
}

function blockTooltip(block) {
  const dates = blockRangeTitle(block);
  if (isLocationWideManualBlock(block)) {
    const locLabel = LOCATION_KEY_LABELS[block.locationKey] || block.locationKey;
    const locPart = locLabel ? ` (${locLabel})` : '';
    return `Location-wide block${locPart} — blocks entire location — ${dates}`;
  }
  return `${blockDisplayLabel(block)} — ${dates}`;
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
  const [locationRemoveFlash, setLocationRemoveFlash] = useState('');

  const cabinIdOk = isOpsCalendarCabinIdParam(cabinId);
  const reservedSegment = isOpsCalendarReservedSegment(cabinId);

  const { weeks, monthStartYmd, monthEndExclusiveYmd } = useMemo(
    () => buildSofiaMonthGrid(year, monthIndex),
    [year, monthIndex]
  );

  const monthTitle = useMemo(() => formatSofiaMonthTitle(year, monthIndex), [year, monthIndex]);
  const rangeTooltip = `${monthStartYmd} → ${monthEndExclusiveYmd} (checkout day exclusive)`;

  const load = useCallback(async () => {
    if (!cabinIdOk || reservedSegment) {
      setLoading(false);
      return;
    }
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
  }, [cabinId, cabinIdOk, reservedSegment, monthStartYmd, monthEndExclusiveYmd]);

  useEffect(() => {
    load();
  }, [load]);

  if (reservedSegment) {
    return <Navigate to={OPS_WORK_WINDOWS_PATH} replace />;
  }
  if (!cabinIdOk) {
    return <Navigate to={OPS_CALENDAR_BASE_PATH} replace />;
  }

  const blocks = data?.blocks || [];
  const renderCabinId = data?.calendarScope?.renderCabinId ?? cabinId;
  const todayYmd = data?.meta?.today;
  const sync = data?.syncIndicators?.syncStatus || 'stale';
  const syncCls = SYNC_BADGE[sync] || SYNC_BADGE.stale;
  const priceHint = data?.pricingHint;
  const hardN = data?.conflictMarkers?.hard?.length || 0;
  const warnN = data?.conflictMarkers?.warnings?.length || 0;

  const goToday = () => {
    const { year: y, monthIndex: m } = sofiaNowYearMonth();
    setYear(y);
    setMonthIndex(m);
  };

  const goPrevMonth = () => {
    const n = addOneMonth(year, monthIndex, -1);
    setYear(n.year);
    setMonthIndex(n.monthIndex);
  };

  const goNextMonth = () => {
    const n = addOneMonth(year, monthIndex, 1);
    setYear(n.year);
    setMonthIndex(n.monthIndex);
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
    if (isLocationWideManualBlock(b)) return;
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
    if (isLocationWideManualBlock(b)) return;
    const id = extractMongoIdFromBlockId(b?.id);
    if (!id) return;
    setActionError('');
    setOpenBlockKey(null);
    setSheetBlock(b);
    setSheetKind('remove');
  };

  const requestRemoveLocationGroup = (b) => {
    const groupId = getLocationBlockGroupId(b);
    if (!groupId) {
      setOpenBlockKey(null);
      setActionError('Cannot remove location-wide block: group id is missing.');
      return;
    }
    setActionError('');
    setOpenBlockKey(null);
    setSheetBlock(b);
    setSheetKind('remove_location_group');
  };

  const removeBlock = async () => {
    const b = sheetBlock;
    if (isLocationWideManualBlock(b)) return;
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

  const removeLocationBlockGroup = async () => {
    const groupId = getLocationBlockGroupId(sheetBlock);
    if (!groupId) {
      setActionError('Cannot remove location-wide block: group id is missing.');
      return;
    }

    setActionError('');
    try {
      await opsWriteAPI.removeLocationBlockGroup(groupId, 'ops_calendar');
      closeSheet();
      setLocationRemoveFlash('Location-wide block removed.');
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Remove failed');
    }
  };

  if (loading && !data) {
    return (
      <div className="w-full max-w-lg mx-auto pb-24 lg:max-w-none lg:mx-0">
        <p className="py-12 text-center text-sm text-gray-400">Loading month…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg mx-auto pb-24 md:pb-10 lg:max-w-none lg:mx-0 lg:pb-8 text-left">
      <div className="space-y-4 lg:max-w-7xl lg:mx-auto">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <Link
            to="/ops/calendar"
            className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
          >
            <ChevronLeft className="h-4 w-4 shrink-0" />
            All properties
          </Link>

          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h1
                className="text-2xl font-semibold text-gray-900"
                style={{ fontFamily: 'Playfair Display, serif' }}
                title={rangeTooltip}
              >
                {monthTitle}
              </h1>
              <p className="mt-1 text-base font-bold text-gray-900 leading-snug">{cabinLabel}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${syncCls}`}
                >
                  Sync {sync}
                </span>
                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                  {OPS_CALENDAR_TZ}
                </span>
                {hardN > 0 ? (
                  <span className="rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
                    {hardN} conflict{hardN === 1 ? '' : 's'}
                  </span>
                ) : null}
                {warnN > 0 ? (
                  <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                    {warnN} warning{warnN === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
              {priceHint?.nightPrice != null ? (
                <p className="mt-2 text-sm text-gray-600">
                  List night:{' '}
                  <span className="font-semibold text-gray-900">
                    {priceHint.nightPrice} {priceHint.currency?.toUpperCase()}
                  </span>
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={goPrevMonth} className={navBtnCls} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4 text-gray-500" />
                <span className="hidden sm:inline">Prev</span>
              </button>
              <button type="button" onClick={goToday} className={navBtnCls}>
                <CalendarIcon className="h-4 w-4 text-gray-500" />
                <span>Today</span>
              </button>
              <button type="button" onClick={goNextMonth} className={navBtnCls} aria-label="Next month">
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
          ) : null}
          {locationRemoveFlash ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {locationRemoveFlash}
            </div>
          ) : null}
          {actionError && !sheetKind ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{actionError}</div>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openPanel('manual')}
                className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400 sm:w-auto"
              >
                Add manual block
              </button>
              <button
                type="button"
                onClick={() => openPanel('maintenance')}
                className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:border-gray-400 sm:w-auto"
              >
                Add maintenance
              </button>
            </div>
            <OpsCalendarLegend ariaLabel="Month calendar block legend" className="sm:justify-end" />
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
              <button
                type="button"
                onClick={submitBlock}
                className="h-11 flex-1 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white hover:bg-gray-800 sm:flex-none"
              >
                Save
              </button>
              <button
                type="button"
                onClick={closeSheet}
                className="h-11 flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 sm:flex-none"
              >
                Cancel
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-gray-600">
              Start (inclusive)
              <input
                type="date"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-gray-600">
              End (exclusive)
              <input
                type="date"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>

          {actionError ? (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
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
              <button
                type="button"
                onClick={removeBlock}
                className="h-11 flex-1 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 sm:flex-none"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={closeSheet}
                className="h-11 flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 sm:flex-none"
              >
                Cancel
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-800">
              {sheetBlock?.blockType === 'manual_block'
                ? 'Manual block'
                : sheetBlock?.blockType === 'maintenance'
                  ? 'Maintenance block'
                  : 'Block'}
            </div>
            <div className="text-xs text-gray-500">{blockRangeTitle(sheetBlock)}</div>
            {actionError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {actionError}
              </div>
            ) : null}
          </div>
        </CalendarBottomSheet>

        <CalendarBottomSheet
          open={sheetKind === 'remove_location_group'}
          title="Remove entire location block?"
          subtitle="This removes the block from every property in this location."
          onClose={closeSheet}
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={removeLocationBlockGroup}
                className="h-11 flex-1 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white hover:bg-red-800 sm:flex-none"
              >
                Remove entire location block
              </button>
              <button
                type="button"
                onClick={closeSheet}
                className="h-11 flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 sm:flex-none"
              >
                Cancel
              </button>
            </div>
          }
        >
          <div className="space-y-2">
            <div className="text-sm font-medium text-gray-800">Location-wide block</div>
            <div className="text-xs text-gray-500">{blockRangeTitle(sheetBlock)}</div>
            {sheetBlock?.locationKey ? (
              <div className="text-xs text-gray-600">
                Location: {LOCATION_KEY_LABELS[sheetBlock.locationKey] || sheetBlock.locationKey}
              </div>
            ) : null}
            {actionError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {actionError}
              </div>
            ) : null}
          </div>
        </CalendarBottomSheet>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="grid grid-cols-7 gap-px border-b border-gray-100 bg-white px-1 pt-3 pb-2">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="text-center text-[10px] font-medium text-gray-400 sm:text-xs">
                <span className="sm:hidden">{WEEKDAYS_SHORT[i]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
          </div>

          {weeks.map((weekCells, wi) => {
            const { segs, laneCount } = computeWeekBarSegments(weekCells, blocks, renderCabinId);
            const barAreaH = Math.min(12, laneCount) * 28 + 10;
            return (
              <div key={wi} className="border-b border-gray-100 last:border-b-0">
                <div className="grid grid-cols-7">
                  {weekCells.map((cell) => {
                    const inMonth = cell.ymd >= monthStartYmd && cell.ymd < monthEndExclusiveYmd;
                    const isToday = todayYmd && cell.ymd === todayYmd;
                    return (
                      <div
                        key={cell.ymd}
                        className={`flex min-h-[48px] items-start justify-center px-0.5 py-1.5 sm:min-h-[56px] ${
                          !inMonth ? 'bg-gray-50/80' : 'bg-white'
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold tabular-nums sm:h-9 sm:w-9 sm:text-sm ${
                            isToday
                              ? 'border-2 border-gray-900 text-gray-900'
                              : inMonth
                                ? 'text-gray-800'
                                : 'text-gray-300'
                          }`}
                        >
                          {cell.dayOfMonth}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div
                  className="relative border-t border-gray-100 bg-gray-50/50 px-0.5 py-1"
                  style={{ minHeight: barAreaH }}
                >
                  {segs.map((s) => {
                    const b = s.block;
                    const bar = BLOCK_BAR[b.blockType] || 'bg-gray-500 text-white';
                    const ring =
                      b.render?.conflictToken === 'hard'
                        ? CONFLICT_RING.hard
                        : b.render?.conflictToken === 'warning'
                          ? CONFLICT_RING.warning
                          : '';
                    const label = blockDisplayLabel(b);
                    const top = 5 + s.lane * 28;
                    const rowKey = `${wi}-${b.id}`;
                    const isLocationWide = isLocationWideManualBlock(b);
                    const locationGroupId = getLocationBlockGroupId(b);
                    const canAct =
                      (b.blockType === 'manual_block' || b.blockType === 'maintenance') &&
                      extractMongoIdFromBlockId(b.id);
                    const menuOpen = openBlockKey === rowKey;
                    const tip = blockTooltip(b);

                    if (b.blockType === 'reservation') {
                      return (
                        <Link
                          key={rowKey}
                          to={`/ops/reservations/${b.sourceReference}`}
                          className={`absolute flex items-center rounded border px-1 text-[10px] font-medium truncate shadow-sm sm:text-xs ${bar} ${ring}`}
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
                          className={`absolute flex items-center rounded border px-1 text-[10px] font-medium truncate shadow-sm text-left sm:text-xs ${bar} ${ring}`}
                          style={{ left: `${s.leftPct}%`, width: `${s.widthPct}%`, top, height: 24 }}
                          title={tip}
                          onClick={() => setOpenBlockKey((k) => (k === rowKey ? null : rowKey))}
                        >
                          {label}
                        </button>
                        {menuOpen && canAct ? (
                          <div
                            className="absolute z-20 flex min-w-[180px] max-w-[min(240px,calc(100vw-2rem))] flex-col gap-1 rounded-xl border border-gray-200 bg-white p-2 text-xs shadow-lg"
                            style={{ left: `${s.leftPct}%`, top: top + 26 }}
                          >
                            {isLocationWide ? (
                              locationGroupId ? (
                                <button
                                  type="button"
                                  className="flex min-h-9 items-center rounded-lg px-2 text-left text-red-700 hover:bg-red-50"
                                  onClick={() => requestRemoveLocationGroup(b)}
                                >
                                  Remove entire location block
                                </button>
                              ) : (
                                <p className="px-2 py-1.5 text-amber-800 leading-snug">
                                  This location-wide block is missing a group id and cannot be removed as a group.
                                </p>
                              )
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="flex h-9 items-center rounded-lg px-2 text-left hover:bg-gray-50"
                                  onClick={() => {
                                    setOpenBlockKey(null);
                                    requestEditBlockDates(b);
                                  }}
                                >
                                  Edit dates
                                </button>
                                <button
                                  type="button"
                                  className="flex h-9 items-center rounded-lg px-2 text-left text-red-700 hover:bg-red-50"
                                  onClick={() => {
                                    setOpenBlockKey(null);
                                    requestRemoveBlock(b);
                                  }}
                                >
                                  Remove
                                </button>
                              </>
                            )}
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
    </div>
  );
}
