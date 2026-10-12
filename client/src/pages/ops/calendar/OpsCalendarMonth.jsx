import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import { useOpsSession } from '../../../context/OpsSessionContext';
import {
  MANUAL_BLOCK_PURPOSES,
  MANUAL_RESERVATION_PURPOSE_OPTIONS
} from '../../../utils/manualReservationPurpose';
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
  blockBoundaryDateOnly,
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
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import { opsCx } from '../../../ops/primitives/opsCx';
import './OpsCalendar.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const ALL_UNITS_VALUE = '__all_units__';

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
  const navigate = useNavigate();
  const opsSession = useOpsSession();
  const initialYm = useMemo(() => sofiaNowYearMonth(), []);
  const [year, setYear] = useState(initialYm.year);
  const [monthIndex, setMonthIndex] = useState(initialYm.monthIndex);
  const [data, setData] = useState(null);
  const [cabinDetail, setCabinDetail] = useState(null);
  const [cabinLabel, setCabinLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formBlockReason, setFormBlockReason] = useState('');
  const [guestStayUnitId, setGuestStayUnitId] = useState('');
  const [openBlockKey, setOpenBlockKey] = useState(null);
  const [sheetKind, setSheetKind] = useState(null);
  const [sheetBlock, setSheetBlock] = useState(null);
  const [locationRemoveFlash, setLocationRemoveFlash] = useState('');
  const [writeBusy, setWriteBusy] = useState(false);
  const [formBlockPurpose, setFormBlockPurpose] = useState('owner_hold');
  const [conversionForm, setConversionForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    adults: '2',
    children: '0',
    manualReservationPurpose: 'comp_other',
    unitId: '',
    initialStatus: 'pending',
    sendGuestConfirmationEmail: false,
    acceptExternalHoldWarnings: false,
    reason: ''
  });

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
      const detail = cabRes.data?.data || null;
      setCabinDetail(detail);
      const name = detail?.contentMedia?.name || detail?.cabinId || cabinId;
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
  const isMultiUnit = cabinDetail?.kind === 'multi_unit_type';
  const activeUnits = (cabinDetail?.units || []).filter((unit) => unit.isActive !== false);
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
    setFormUnitId('');
    setFormBlockPurpose('owner_hold');
    setFormBlockReason('');
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
    const addingBlock = sheetKind === 'add_manual' || sheetKind === 'add_maintenance';
    if (addingBlock && isMultiUnit && !formUnitId) {
      setActionError('Choose one A-frame or explicitly choose all A-frame units.');
      return;
    }
    if (sheetKind === 'add_manual' && formBlockPurpose === 'other' && !formBlockReason.trim()) {
      setActionError('Add an operator note for an Other hold.');
      return;
    }
    setWriteBusy(true);
    try {
      const createPayload = {
        cabinId: renderCabinId,
        startDate: formStart,
        endDate: formEnd,
        reason: sheetKind === 'add_manual' ? null : 'ops_calendar',
        ...(sheetKind === 'add_manual'
          ? {
              manualBlockPurpose: formBlockPurpose,
              operatorNote: formBlockReason.trim() || undefined
            }
          : {}),
        targetScope: isMultiUnit
          ? formUnitId === ALL_UNITS_VALUE
            ? 'all_units'
            : 'unit'
          : 'single_cabin'
      };
      if (isMultiUnit && formUnitId !== ALL_UNITS_VALUE) createPayload.unitId = formUnitId;
      if (sheetKind === 'add_manual') {
        await opsWriteAPI.createManualBlock(createPayload);
      } else if (sheetKind === 'add_maintenance') {
        await opsWriteAPI.createMaintenanceBlock(createPayload);
      } else if (sheetKind === 'edit_manual') {
        const id = extractMongoIdFromBlockId(sheetBlock?.id);
        await opsWriteAPI.editManualBlock(id, {
          startDate: formStart,
          endDate: formEnd,
          ...(formBlockPurpose ? { manualBlockPurpose: formBlockPurpose } : {}),
          operatorNote: formBlockReason.trim() || null,
          reason: 'ops_calendar'
        });
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
    setFormStart(blockBoundaryDateOnly(b, 'start'));
    setFormEnd(blockBoundaryDateOnly(b, 'end'));
    setFormBlockPurpose(b.manualBlockPurpose || '');
    setFormBlockReason(b.operatorNote || '');
    setFormUnitId(b.unitId || ALL_UNITS_VALUE);
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

  const requestConvertBlock = (b) => {
    setOpenBlockKey(null);
    setActionError('');
    setSheetBlock(b);
    setConversionForm({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      adults: '2',
      children: '0',
      manualReservationPurpose: 'comp_other',
      unitId: '',
      initialStatus: 'pending',
      sendGuestConfirmationEmail: false,
      acceptExternalHoldWarnings: false,
      reason: ''
    });
    setSheetKind('convert_manual');
  };

  const convertBlock = async () => {
    const id = extractMongoIdFromBlockId(sheetBlock?.id);
    if (!id) return;
    setActionError('');
    if (isMultiUnit && !sheetBlock?.unitId && !conversionForm.unitId) {
      setActionError('Choose the physical unit for this parent-wide block.');
      return;
    }
    const adults = Number(conversionForm.adults);
    const children = Number(conversionForm.children);
    const firstName = conversionForm.firstName.trim();
    const lastName = conversionForm.lastName.trim();
    const email = conversionForm.email.trim();
    const phone = conversionForm.phone.trim();
    if (
      !firstName || firstName.length > 50 ||
      !lastName || lastName.length > 50 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !phone || phone.length > 40 ||
      !Number.isInteger(adults) || adults < 1 || adults > 10 ||
      !Number.isInteger(children) || children < 0 || children > 10
    ) {
      setActionError('Enter valid required guest details and guest counts (adults 1–10, children 0–10).');
      return;
    }
    setWriteBusy(true);
    try {
      const response = await opsWriteAPI.convertManualBlockToReservation(id, {
        guestInfo: {
          firstName,
          lastName,
          email,
          phone
        },
        adults,
        children,
        ...(isMultiUnit && !sheetBlock?.unitId ? { unitId: conversionForm.unitId } : {}),
        initialStatus: conversionForm.initialStatus,
        manualReservationPurpose: conversionForm.manualReservationPurpose,
        sendGuestConfirmationEmail: conversionForm.sendGuestConfirmationEmail,
        acceptExternalHoldWarnings: conversionForm.acceptExternalHoldWarnings,
        reason: conversionForm.reason.trim() || undefined
      });
      const reservationId = response.data?.data?.reservationId;
      if (!reservationId) throw new Error('Conversion response did not include a reservation');
      navigate(`/ops/reservations/${reservationId}`);
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Could not convert block');
    } finally {
      setWriteBusy(false);
    }
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
          ? 'Edit manual block'
          : 'Edit maintenance block dates';
  const canConvertManualBlock =
    opsSession?.actions?.includes('ops.reservation.manual_create') &&
    opsSession?.actions?.includes('ops.availability.manual_block.remove');
  const canCreateGuestStay = opsSession?.actions?.includes('ops.reservation.manual_create');

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
            {!loading && !isMultiUnit && canCreateGuestStay ? (
              <OpsButton
                variant="secondary"
                onClick={() =>
                  navigate(
                    `/ops/reservations?create=1&cabinId=${encodeURIComponent(renderCabinId)}`
                  )
                }
              >
                Add guest stay
              </OpsButton>
            ) : null}
            {!loading && isMultiUnit && canCreateGuestStay ? (
              <>
                <OpsSelect
                  label="Guest stay unit"
                  value={guestStayUnitId}
                  onChange={(event) => setGuestStayUnitId(event.target.value)}
                >
                  <option value="">Select an A-frame</option>
                  {activeUnits.map((unit) => (
                    <option key={unit.unitId} value={unit.unitId}>
                      {unit.displayName || unit.unitNumber}
                    </option>
                  ))}
                </OpsSelect>
                <OpsButton
                  variant="secondary"
                  disabled={!guestStayUnitId}
                  onClick={() => {
                    const selectedUnit = activeUnits.find((unit) => unit.unitId === guestStayUnitId);
                    const query = new URLSearchParams({
                      create: '1',
                      cabinId: renderCabinId,
                      cabinTypeId: cabinDetail?.cabinTypeId || '',
                      unitId: guestStayUnitId,
                      unitLabel: selectedUnit?.displayName || selectedUnit?.unitNumber || 'Selected A-frame'
                    });
                    navigate(`/ops/reservations?${query.toString()}`);
                  }}
                >
                  Add guest stay
                </OpsButton>
              </>
            ) : null}
          </div>
          <p className="ops-cal__hint">
            Guest stays create Bookings. Maintenance creates maintenance blocks. Owner, private, operational, and other holds remain non-guest manual blocks.
          </p>
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
          {sheetKind === 'add_manual' || sheetKind === 'edit_manual' ? (
            <>
              <OpsSelect
                id="calendar-manual-block-purpose"
                label={sheetKind === 'edit_manual' && !formBlockPurpose ? 'Block purpose (legacy, optional)' : 'Block purpose'}
                value={formBlockPurpose}
                onChange={(e) => setFormBlockPurpose(e.target.value)}
              >
                {sheetKind === 'edit_manual' && !formBlockPurpose ? <option value="">Legacy / unspecified</option> : null}
                {MANUAL_BLOCK_PURPOSES.map((purpose) => (
                  <option key={purpose.value} value={purpose.value}>
                    {purpose.label}
                  </option>
                ))}
              </OpsSelect>
              <OpsTextField
                label={formBlockPurpose === 'other' ? 'Operator note (required for Other)' : 'Operator note'}
                value={formBlockReason}
                onChange={(e) => setFormBlockReason(e.target.value)}
                disabled={writeBusy}
                maxLength={500}
                required={formBlockPurpose === 'other'}
                optional={formBlockPurpose !== 'other'}
              />
            </>
          ) : null}
          {(sheetKind === 'add_manual' || sheetKind === 'add_maintenance') && isMultiUnit ? (
            <OpsSelect
              id="calendar-block-unit"
              label="Apply to"
              value={formUnitId}
              onChange={(e) => setFormUnitId(e.target.value)}
              hint="All units is an explicit parent-wide block and affects every A-frame in this listing."
            >
              <option value="" disabled>
                Select an A-frame
              </option>
              {activeUnits.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.displayName || unit.unitNumber}
                </option>
              ))}
              <option value={ALL_UNITS_VALUE}>All A-frame units</option>
            </OpsSelect>
          ) : null}
          {(sheetKind === 'edit_manual' || sheetKind === 'edit_maintenance') && isMultiUnit ? (
            <p className="ops-cal__hint">
              Scope: {sheetBlock?.render?.unitLabel || 'All A-frame units'} (scope cannot be changed while editing dates)
            </p>
          ) : null}
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

        <CalendarBottomSheet
          open={sheetKind === 'convert_manual'}
          title="Convert block to guest reservation"
          subtitle="This creates a zero-price Booking and tombstones only this block. Guest confirmation email is opt-in."
          onClose={closeSheet}
          dismissible={!writeBusy}
          footer={
            <div className="ops-cal-footer-actions">
              <OpsButton onClick={convertBlock} loading={writeBusy} loadingLabel="Converting…">
                Create reservation
              </OpsButton>
              <OpsButton variant="secondary" onClick={closeSheet} disabled={writeBusy}>
                Cancel
              </OpsButton>
            </div>
          }
        >
          {isMultiUnit && !sheetBlock?.unitId ? (
            <OpsSelect
              label="Assign to physical unit"
              value={conversionForm.unitId}
              onChange={(e) => setConversionForm((form) => ({ ...form, unitId: e.target.value }))}
              disabled={writeBusy}
            >
              <option value="" disabled>
                Select an A-frame
              </option>
              {activeUnits.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.displayName || unit.unitNumber}
                </option>
              ))}
            </OpsSelect>
          ) : null}
          <section aria-label="Block conversion summary" className="ops-cal-sheet-stack">
            <h3 className="ops-cal-sheet-stack__title">Block being converted</h3>
            <p className="ops-cal-sheet-stack__meta">Accommodation: {cabinLabel || 'Selected accommodation'}</p>
            <p className="ops-cal-sheet-stack__meta">
              Unit: {sheetBlock?.unitId
                ? sheetBlock?.render?.unitLabel || 'Selected physical unit'
                : isMultiUnit ? 'All units' : 'Single accommodation'}
            </p>
            <p className="ops-cal-sheet-stack__meta">
              Check-in: {sheetBlock ? blockBoundaryDateOnly(sheetBlock, 'start') : '—'}
              {' · '}
              Check-out: {sheetBlock ? blockBoundaryDateOnly(sheetBlock, 'end') : '—'}
            </p>
            <p className="ops-cal-sheet-stack__meta">
              Existing purpose: {MANUAL_BLOCK_PURPOSES.find((purpose) => purpose.value === sheetBlock?.manualBlockPurpose)?.label || 'Legacy / unspecified'}
            </p>
            {sheetBlock?.operatorNote ? (
              <p className="ops-cal-sheet-stack__meta">Operator note: {sheetBlock.operatorNote}</p>
            ) : null}
          </section>
          <div className="ops-cal-form-grid">
            <OpsTextField
              label="First name (required)"
              value={conversionForm.firstName}
              onChange={(e) => setConversionForm((form) => ({ ...form, firstName: e.target.value }))}
              disabled={writeBusy}
              autoComplete="given-name"
              required
            />
            <OpsTextField
              label="Last name (required)"
              value={conversionForm.lastName}
              onChange={(e) => setConversionForm((form) => ({ ...form, lastName: e.target.value }))}
              disabled={writeBusy}
              autoComplete="family-name"
              required
            />
            <OpsTextField
              label="Email (required)"
              type="email"
              value={conversionForm.email}
              onChange={(e) => setConversionForm((form) => ({ ...form, email: e.target.value }))}
              disabled={writeBusy}
              autoComplete="email"
              required
            />
            <OpsTextField
              label="Phone (required)"
              type="tel"
              value={conversionForm.phone}
              onChange={(e) => setConversionForm((form) => ({ ...form, phone: e.target.value }))}
              disabled={writeBusy}
              autoComplete="tel"
              required
            />
            <OpsTextField
              label="Adults (required)"
              type="number"
              min="1"
              max="10"
              required
              value={conversionForm.adults}
              onChange={(e) => setConversionForm((form) => ({ ...form, adults: e.target.value }))}
              disabled={writeBusy}
            />
            <OpsTextField
              label="Children (required)"
              type="number"
              min="0"
              max="10"
              required
              value={conversionForm.children}
              onChange={(e) => setConversionForm((form) => ({ ...form, children: e.target.value }))}
              disabled={writeBusy}
            />
          </div>
          <OpsSelect
            label="Reservation purpose"
            value={conversionForm.manualReservationPurpose}
            onChange={(e) =>
              setConversionForm((form) => ({ ...form, manualReservationPurpose: e.target.value }))
            }
            disabled={writeBusy}
          >
            {MANUAL_RESERVATION_PURPOSE_OPTIONS.map((purpose) => (
              <option key={purpose.value} value={purpose.value}>
                {purpose.label}
              </option>
            ))}
          </OpsSelect>
          <OpsCheckbox
            label="Send guest confirmation email when this reservation is confirmed"
            checked={conversionForm.sendGuestConfirmationEmail}
            onChange={(e) =>
              setConversionForm((form) => ({
                ...form,
                sendGuestConfirmationEmail: e.target.checked
              }))
            }
            disabled={writeBusy}
          />
          <OpsSelect
            label="Initial reservation status"
            value={conversionForm.initialStatus}
            onChange={(e) => setConversionForm((form) => ({ ...form, initialStatus: e.target.value }))}
            disabled={writeBusy}
          >
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
          </OpsSelect>
          <OpsTextField
            label="Operational note"
            value={conversionForm.reason}
            onChange={(e) => setConversionForm((form) => ({ ...form, reason: e.target.value }))}
            disabled={writeBusy}
            optional
          />
          <OpsCheckbox
            label="Proceed when an external channel hold overlaps"
            checked={conversionForm.acceptExternalHoldWarnings}
            onChange={(e) =>
              setConversionForm((form) => ({
                ...form,
                acceptExternalHoldWarnings: e.target.checked
              }))
            }
            disabled={writeBusy}
          />
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
                                  {b.blockType === 'manual_block' &&
                                  !isLocationWide &&
                                  canConvertManualBlock ? (
                                    <button
                                      type="button"
                                      className="ops-cal-menu__item"
                                      onClick={() => requestConvertBlock(b)}
                                    >
                                      Convert to guest reservation
                                    </button>
                                  ) : null}
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
