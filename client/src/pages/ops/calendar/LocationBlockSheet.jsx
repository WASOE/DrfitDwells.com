import { useEffect, useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import CalendarBottomSheet from './CalendarBottomSheet';
import { opsWriteAPI } from '../../../services/opsApi';
import { OPS_CALENDAR_TZ, sofiaNowYearMonth } from './opsCalendarDateUtils';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import './OpsCalendar.css';

const LOCATION_OPTIONS = [
  { locationKey: 'valley', label: 'The Valley' },
  { locationKey: 'cabin', label: 'The Cabin' }
];

function conflictSummaryLabel(conflict) {
  if (conflict.kind === 'reservation') {
    const guest = conflict.guestLabel ? ` (${conflict.guestLabel})` : '';
    return `Reservation${guest}`;
  }
  if (conflict.kind === 'legacy_blocked_date') return 'Legacy blocked date';
  if (conflict.kind === 'availability_block') {
    if (conflict.blockType === 'external_hold') return 'Channel hold';
    if (conflict.blockType === 'maintenance') return 'Maintenance block';
    if (conflict.blockType === 'manual_block') return 'Manual block';
    return conflict.blockType || 'Block';
  }
  return conflict.kind || 'Conflict';
}

export default function LocationBlockSheet({ open, onClose, onSuccess }) {
  const initialYm = useMemo(() => sofiaNowYearMonth(), []);
  const [locationKey, setLocationKey] = useState('valley');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!open) return;
    const { year, monthIndex } = initialYm;
    const monthStart = formatInTimeZone(new Date(year, monthIndex, 1), OPS_CALENDAR_TZ, 'yyyy-MM-dd');
    setFormStart(monthStart);
    const t0 = toDate(`${monthStart} 00:00:00.000`, { timeZone: OPS_CALENDAR_TZ });
    setFormEnd(formatInTimeZone(addDays(t0, 3), OPS_CALENDAR_TZ, 'yyyy-MM-dd'));
    setLocationKey('valley');
    setReason('');
    setPreview(null);
    setActionError('');
  }, [open, initialYm]);

  const locationLabel = LOCATION_OPTIONS.find((o) => o.locationKey === locationKey)?.label || locationKey;

  const runPreview = async () => {
    setActionError('');
    setPreviewLoading(true);
    try {
      const res = await opsWriteAPI.previewLocationBlock({
        locationKey,
        startDate: formStart,
        endDate: formEnd
      });
      setPreview(res.data?.data || null);
    } catch (err) {
      setPreview(null);
      setActionError(err?.response?.data?.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const submitLocationBlock = async () => {
    setActionError('');
    setSubmitLoading(true);
    try {
      const res = await opsWriteAPI.createLocationBlock({
        locationKey,
        startDate: formStart,
        endDate: formEnd,
        blockType: 'manual_block',
        reason: reason.trim() || 'ops_location_block'
      });
      onSuccess?.(res.data?.data || null);
      onClose?.();
    } catch (err) {
      const details = err?.response?.data?.details;
      if (details?.conflicts?.length) {
        setPreview(details);
      }
      setActionError(err?.response?.data?.message || 'Could not block entire location');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (!open) return null;

  const canSubmit = preview?.canBlock === true && !submitLoading && !previewLoading;

  return (
    <CalendarBottomSheet
      open={open}
      title="Block entire location"
      subtitle="Use this for weddings, retreats, private events, or full-location buyouts. The system checks all cabins and units before blocking."
      onClose={onClose}
      dismissible={!submitLoading}
      footer={
        <div className="ops-cal-footer-actions">
          <OpsButton
            variant="secondary"
            onClick={runPreview}
            disabled={previewLoading || !formStart || !formEnd}
            loading={previewLoading}
            loadingLabel="Checking…"
          >
            Check dates
          </OpsButton>
          <OpsButton onClick={submitLocationBlock} disabled={!canSubmit} loading={submitLoading} loadingLabel="Blocking…">
            Block entire location
          </OpsButton>
        </div>
      }
    >
      <OpsSelect
        id="location-block-key"
        label="Location"
        value={locationKey}
        onChange={(e) => {
          setLocationKey(e.target.value);
          setPreview(null);
        }}
      >
        {LOCATION_OPTIONS.map((opt) => (
          <option key={opt.locationKey} value={opt.locationKey}>
            {opt.label}
          </option>
        ))}
      </OpsSelect>

      <div className="ops-cal-form-grid">
        <OpsTextField
          id="location-block-start"
          label="Start (check-in)"
          type="date"
          value={formStart}
          onChange={(e) => {
            setFormStart(e.target.value);
            setPreview(null);
          }}
        />
        <OpsTextField
          id="location-block-end"
          label="End (checkout, exclusive)"
          type="date"
          value={formEnd}
          onChange={(e) => {
            setFormEnd(e.target.value);
            setPreview(null);
          }}
        />
      </div>

      <OpsTextField
        id="location-block-reason"
        label="Reason"
        optional
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Private event, full buyout, retreat…"
      />

      {actionError ? <OpsBanner tone="danger" body={actionError} /> : null}

      {preview ? (
        <div className="ops-cal-preview">
          <div className="ops-cal__meta-row">
            <OpsBadge tone={preview.canBlock ? 'neutral' : 'info'}>
              {preview.canBlock ? 'Ready to block' : 'Some properties are already booked or blocked'}
            </OpsBadge>
            <span className="ops-cal__hint">
              {preview.targetCount} propert{preview.targetCount === 1 ? 'y' : 'ies'} checked
            </span>
          </div>

          {!preview.canBlock && preview.conflicts?.length ? (
            <div className="ops-cal-sheet-stack">
              <p className="ops-cal-sheet-stack__title">
                Some properties are already booked or blocked for these dates:
              </p>
              <ul className="ops-cal-preview__conflicts">
                {preview.conflicts.map((row) => (
                  <li key={row.targetKey} className="ops-cal-preview__conflict">
                    <strong>{row.label}</strong>
                    <ul className="ops-cal-preview__conflict-list">
                      {(row.hardConflicts || []).map((c, idx) => (
                        <li key={`${row.targetKey}-${idx}`}>{conflictSummaryLabel(c)}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.canBlock ? (
            <p className="ops-cal__hint">
              All properties in {preview.locationLabel || locationLabel} are free for this range.
            </p>
          ) : null}
        </div>
      ) : null}
    </CalendarBottomSheet>
  );
}
