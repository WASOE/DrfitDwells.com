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
import { BLOCK_BAR, CONFLICT_RING } from './calendarVisualTokens';
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
import {
  LOCATION_KEY_LABELS,
  blockDisplayLabel,
  blockRangeTitle,
  blockTooltip,
  getLocationBlockGroupId,
  isLocationWideManualBlock
} from './calendarBlockLabels';
import OpsPage from '../../../ops/primitives/OpsPage';
import OpsPageHeader from '../../../ops/primitives/OpsPageHeader';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import OpsConfirmDialog from '../../../ops/primitives/OpsConfirmDialog';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import { opsCx } from '../../../ops/primitives/opsCx';
import './OpsCalendar.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function extractMongoIdFromBlockId(id) {
  const s = String(id || '');
  if (s.startsWith('block:')) return s.slice('block:'.length);
  return null;
}

function syncStatusValue(sync) {
  if (sync === 'healthy' || sync === 'warning' || sync === 'failed' || sync === 'stale') return sync;
  return 'stale';
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
  const [writeBusy, setWriteBusy] = useState(false);

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
  const sync = syncStatusValue(data?.syncIndicators?.syncStatus || 'stale');
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
    if (writeBusy) return;
    setSheetKind(null);
    setSheetBlock(null);
    setActionError('');
  };

  const submitBlock = async () => {
    setActionError('');
    setWriteBusy(true);
    try {
      if (sheetKind === 'add_manual') {
        await opsWriteAPI.createManualBlock({ cabinId, startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      } else if (sheetKind === 'add_maintenance') {
        await opsWriteAPI.createMaintenanceBlock({
          cabinId,
          startDate: formStart,
          endDate: formEnd,
          reason: 'ops_calendar'
        });
      } else if (sheetKind === 'edit_manual') {
        const id = extractMongoIdFromBlockId(sheetBlock?.id);
        await opsWriteAPI.editManualBlock(id, { startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      } else if (sheetKind === 'edit_maintenance') {
        const id = extractMongoIdFromBlockId(sheetBlock?.id);
        await opsWriteAPI.editMaintenanceBlock(id, { startDate: formStart, endDate: formEnd, reason: 'ops_calendar' });
      }

      setSheetKind(null);
      setSheetBlock(null);
      setActionError('');
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Action failed');
    } finally {
      setWriteBusy(false);
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
    setWriteBusy(true);
    try {
      if (b?.blockType === 'manual_block') await opsWriteAPI.removeManualBlock(id, 'ops_calendar');
      if (b?.blockType === 'maintenance') await opsWriteAPI.removeMaintenanceBlock(id, 'ops_calendar');
      await load();
      setSheetKind(null);
      setSheetBlock(null);
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Remove failed');
    } finally {
      setWriteBusy(false);
    }
  };

  const removeLocationBlockGroup = async () => {
    const groupId = getLocationBlockGroupId(sheetBlock);
    if (!groupId) {
      setActionError('Cannot remove location-wide block: group id is missing.');
      return;
    }

    setActionError('');
    setWriteBusy(true);
    try {
      await opsWriteAPI.removeLocationBlockGroup(groupId, 'ops_calendar');
      setSheetKind(null);
      setSheetBlock(null);
      setLocationRemoveFlash('Location-wide block removed.');
      await load();
    } catch (err) {
      setActionError(err?.response?.data?.message || 'Remove failed');
    } finally {
      setWriteBusy(false);
    }
  };

  const formSheetOpen =
    sheetKind === 'add_manual' ||
    sheetKind === 'add_maintenance' ||
    sheetKind === 'edit_manual' ||
    sheetKind === 'edit_maintenance';

  const formTitle =
    sheetKind === 'add_manual'
      ? 'New manual block'
      : sheetKind === 'add_maintenance'
        ? 'New maintenance block'
        : sheetKind === 'edit_manual'
          ? 'Edit manual block dates'
          : 'Edit maintenance block dates';

  return (
    <OpsPage width="full">
      <div className="ops-cal">
        <OpsPageHeader
          back={{ to: '/ops/calendar', label: 'All properties' }}
          title={monthTitle}
          description={cabinLabel || '…'}
          meta={
            <div className="ops-cal__meta-row">
              <OpsStatus domain="sync" value={sync} />
              <OpsBadge>{OPS_CALENDAR_TZ}</OpsBadge>
              {hardN > 0 ? (
                <span className="ops-cal-chip ops-cal-chip--danger">
                  {hardN} conflict{hardN === 1 ? '' : 's'}
                </span>
              ) : null}
              {warnN > 0 ? (
                <span className="ops-cal-chip ops-cal-chip--warning">
                  {warnN} warning{warnN === 1 ? '' : 's'}
                </span>
              ) : null}
              {priceHint?.nightPrice != null ? (
                <p className="ops-cal__hint" title={rangeTooltip}>
                  List night:{' '}
                  <strong>
                    {priceHint.nightPrice} {priceHint.currency?.toUpperCase()}
                  </strong>
                </p>
              ) : (
                <span className="ops-cal__hint" title={rangeTooltip} />
              )}
            </div>
          }
          actions={
            <div className="ops-cal__toolbar-nav">
              <OpsButton variant="secondary" onClick={goPrevMonth} aria-label="Previous month">
                <ChevronLeft size={16} aria-hidden="true" />
                <span className="ops-cal__nav-label">Prev</span>
              </OpsButton>
              <OpsButton variant="secondary" onClick={goToday}>
                <CalendarIcon size={16} aria-hidden="true" />
                Today
              </OpsButton>
              <OpsButton variant="secondary" onClick={goNextMonth} aria-label="Next month">
                <span className="ops-cal__nav-label">Next</span>
                <ChevronRight size={16} aria-hidden="true" />
              </OpsButton>
            </div>
          }
        />

        {error ? <OpsBanner tone="danger" body={error} /> : null}
        {locationRemoveFlash ? <OpsBanner tone="success" body={locationRemoveFlash} /> : null}
        {actionError && !sheetKind ? <OpsBanner tone="danger" body={actionError} /> : null}

        <div className="ops-cal__toolbar">
          <div className="ops-cal__toolbar-actions">
            <OpsButton variant="secondary" onClick={() => openPanel('manual')}>
              Add manual block
            </OpsButton>
            <OpsButton variant="secondary" onClick={() => openPanel('maintenance')}>
              Add maintenance
            </OpsButton>
          </div>
          <OpsCalendarLegend ariaLabel="Month calendar block legend" className="ops-cal-legend--end" />
        </div>

        {loading && !data ? <OpsLoadingState label="Loading month" /> : null}

        <CalendarBottomSheet
          open={formSheetOpen}
          title={formTitle}
          subtitle="Start is inclusive; end is exclusive."
          onClose={closeSheet}
          dismissible={!writeBusy}
          footer={
            <div className="ops-cal-footer-actions">
              <OpsButton onClick={submitBlock} loading={writeBusy} loadingLabel="Saving…">
                Save
              </OpsButton>
              <OpsButton variant="secondary" onClick={closeSheet} disabled={writeBusy}>
                Cancel
              </OpsButton>
            </div>
          }
        >
          <div className="ops-cal-form-grid">
            <OpsTextField
              label="Start (inclusive)"
              type="date"
              value={formStart}
              onChange={(e) => setFormStart(e.target.value)}
            />
            <OpsTextField
              label="End (exclusive)"
              type="date"
              value={formEnd}
              onChange={(e) => setFormEnd(e.target.value)}
            />
          </div>
          {actionError ? <OpsInlineError>{actionError}</OpsInlineError> : null}
        </CalendarBottomSheet>

        <OpsConfirmDialog
          open={sheetKind === 'remove'}
          title="Remove this block?"
          body="This will tombstone/remove the selected manual or maintenance block."
          confirmLabel="Remove"
          cancelLabel="Cancel"
          tone="destructive"
          loading={writeBusy}
          onConfirm={removeBlock}
          onClose={closeSheet}
        >
          <div className="ops-cal-sheet-stack">
            <p className="ops-cal-sheet-stack__title">
              {sheetBlock?.blockType === 'manual_block'
                ? 'Manual block'
                : sheetBlock?.blockType === 'maintenance'
                  ? 'Maintenance block'
                  : 'Block'}
            </p>
            {sheetBlock?.render?.unitLabel ? (
              <p className="ops-cal-sheet-stack__meta">Unit: {sheetBlock.render.unitLabel}</p>
            ) : null}
            <p className="ops-cal-sheet-stack__meta">{blockRangeTitle(sheetBlock)}</p>
            {actionError ? <OpsInlineError>{actionError}</OpsInlineError> : null}
          </div>
        </OpsConfirmDialog>

        <OpsConfirmDialog
          open={sheetKind === 'remove_location_group'}
          title="Remove entire location block?"
          body="This removes the block from every property in this location."
          confirmLabel="Remove entire location block"
          cancelLabel="Cancel"
          tone="destructive"
          loading={writeBusy}
          onConfirm={removeLocationBlockGroup}
          onClose={closeSheet}
        >
          <div className="ops-cal-sheet-stack">
            <p className="ops-cal-sheet-stack__title">Location-wide block</p>
            <p className="ops-cal-sheet-stack__meta">{blockRangeTitle(sheetBlock)}</p>
            {sheetBlock?.locationKey ? (
              <p className="ops-cal-sheet-stack__meta">
                Location: {LOCATION_KEY_LABELS[sheetBlock.locationKey] || sheetBlock.locationKey}
              </p>
            ) : null}
            {actionError ? <OpsInlineError>{actionError}</OpsInlineError> : null}
          </div>
        </OpsConfirmDialog>

        {!loading || data ? (
          <div className="ops-cal-grid" data-testid="ops-cal-month-grid">
            <div className="ops-cal-grid__weekdays">
              {WEEKDAYS.map((d, i) => (
                <div key={d} className="ops-cal-grid__weekday">
                  <span className="ops-cal-grid__weekday-short">{WEEKDAYS_SHORT[i]}</span>
                  <span className="ops-cal-grid__weekday-full">{d}</span>
                </div>
              ))}
            </div>

            {weeks.map((weekCells, wi) => {
              const { segs, laneCount } = computeWeekBarSegments(weekCells, blocks, renderCabinId);
              const barAreaH = Math.min(12, laneCount) * 28 + 10;
              return (
                <div key={wi} className="ops-cal-grid__week">
                  <div className="ops-cal-grid__days">
                    {weekCells.map((cell) => {
                      const inMonth = cell.ymd >= monthStartYmd && cell.ymd < monthEndExclusiveYmd;
                      const isToday = todayYmd && cell.ymd === todayYmd;
                      return (
                        <div
                          key={cell.ymd}
                          className={opsCx('ops-cal-grid__day', !inMonth && 'ops-cal-grid__day--outside')}
                        >
                          <span
                            className={opsCx(
                              'ops-cal-grid__day-num',
                              isToday && 'ops-cal-grid__day-num--today',
                              !inMonth && 'ops-cal-grid__day-num--outside'
                            )}
                          >
                            {cell.dayOfMonth}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="ops-cal-grid__bars" style={{ minHeight: barAreaH }}>
                    {segs.map((s) => {
                      const b = s.block;
                      const bar = BLOCK_BAR[b.blockType] || 'ops-cal-bar ops-cal-bar--fallback';
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
                      const barStyle = {
                        left: `${s.leftPct}%`,
                        width: `${s.widthPct}%`,
                        top,
                        height: 24
                      };

                      if (b.blockType === 'reservation') {
                        return (
                          <Link
                            key={rowKey}
                            to={`/ops/reservations/${b.sourceReference}`}
                            className={opsCx('ops-cal-grid__bar', bar, ring)}
                            style={barStyle}
                            title={tip}
                            data-ops-cal-block={b.blockType}
                            data-ops-cal-unit={b.render?.unitLabel || ''}
                          >
                            {label}
                          </Link>
                        );
                      }

                      return (
                        <Fragment key={rowKey}>
                          <button
                            type="button"
                            className={opsCx('ops-cal-grid__bar', bar, ring)}
                            style={barStyle}
                            title={tip}
                            data-ops-cal-block={b.blockType}
                            data-ops-cal-unit={b.render?.unitLabel || ''}
                            onClick={() => setOpenBlockKey((k) => (k === rowKey ? null : rowKey))}
                          >
                            {label}
                          </button>
                          {menuOpen && canAct ? (
                            <div
                              className="ops-cal-menu"
                              style={{ left: `${s.leftPct}%`, top: top + 26 }}
                            >
                              {isLocationWide ? (
                                locationGroupId ? (
                                  <button
                                    type="button"
                                    className="ops-cal-menu__item ops-cal-menu__item--danger"
                                    onClick={() => requestRemoveLocationGroup(b)}
                                  >
                                    Remove entire location block
                                  </button>
                                ) : (
                                  <p className="ops-cal-menu__note">
                                    This location-wide block is missing a group id and cannot be removed as a
                                    group.
                                  </p>
                                )
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="ops-cal-menu__item"
                                    onClick={() => {
                                      setOpenBlockKey(null);
                                      requestEditBlockDates(b);
                                    }}
                                  >
                                    Edit dates
                                  </button>
                                  <button
                                    type="button"
                                    className="ops-cal-menu__item ops-cal-menu__item--danger"
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
        ) : null}
      </div>
    </OpsPage>
  );
}
