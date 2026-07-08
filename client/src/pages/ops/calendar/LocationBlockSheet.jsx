import { useEffect, useMemo, useState } from 'react';
import { addDays } from 'date-fns';
import { formatInTimeZone, toDate } from 'date-fns-tz';
import CalendarBottomSheet from './CalendarBottomSheet';
import { opsWriteAPI } from '../../../services/opsApi';
import { OPS_CALENDAR_TZ, sofiaNowYearMonth } from './opsCalendarDateUtils';

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
      setActionError(err?.response?.data?.message || 'Could not create location-wide block');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (!open) return null;

  const canSubmit = preview?.canBlock === true && !submitLoading && !previewLoading;

  return (
    <CalendarBottomSheet
      open={open}
      title="Location-wide block"
      subtitle={`Block every active property in ${locationLabel}. Checkout day is exclusive.`}
      onClose={onClose}
      footer={
        <div className="flex flex-col sm:flex-row gap-2 max-w-2xl mx-auto w-full">
          <button
            type="button"
            onClick={runPreview}
            disabled={previewLoading || !formStart || !formEnd}
            className="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            {previewLoading ? 'Checking…' : 'Check availability'}
          </button>
          <button
            type="button"
            onClick={submitLocationBlock}
            disabled={!canSubmit}
            className="flex-1 px-4 py-3 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {submitLoading ? 'Creating…' : 'Create location-wide block'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 max-w-2xl mx-auto">
        <div>
          <label htmlFor="location-block-key" className="block text-xs font-medium text-gray-700 mb-1">
            Location
          </label>
          <select
            id="location-block-key"
            value={locationKey}
            onChange={(e) => {
              setLocationKey(e.target.value);
              setPreview(null);
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {LOCATION_OPTIONS.map((opt) => (
              <option key={opt.locationKey} value={opt.locationKey}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="location-block-start" className="block text-xs font-medium text-gray-700 mb-1">
              Start (check-in)
            </label>
            <input
              id="location-block-start"
              type="date"
              value={formStart}
              onChange={(e) => {
                setFormStart(e.target.value);
                setPreview(null);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="location-block-end" className="block text-xs font-medium text-gray-700 mb-1">
              End (checkout, exclusive)
            </label>
            <input
              id="location-block-end"
              type="date"
              value={formEnd}
              onChange={(e) => {
                setFormEnd(e.target.value);
                setPreview(null);
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="location-block-reason" className="block text-xs font-medium text-gray-700 mb-1">
            Reason (optional)
          </label>
          <input
            id="location-block-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Private event, full buyout, retreat…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {actionError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>
        ) : null}

        {preview ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-semibold px-2 py-1 rounded-full ${
                  preview.canBlock
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {preview.canBlock ? 'Ready to block' : 'Cannot block location'}
              </span>
              <span className="text-xs text-gray-600">
                {preview.targetCount} propert{preview.targetCount === 1 ? 'y' : 'ies'} checked
              </span>
            </div>

            {!preview.canBlock && preview.conflicts?.length ? (
              <div className="space-y-2">
                <p className="text-sm text-gray-800">
                  One or more properties are not fully available for a location-wide block:
                </p>
                <ul className="space-y-2 max-h-48 overflow-y-auto">
                  {preview.conflicts.map((row) => (
                    <li key={row.targetKey} className="text-sm bg-white border border-gray-200 rounded-lg px-3 py-2">
                      <span className="font-medium text-gray-900">{row.label}</span>
                      <ul className="mt-1 text-xs text-gray-600 space-y-0.5">
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
              <p className="text-sm text-gray-700">
                All properties in {preview.locationLabel || locationLabel} are free for this range.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </CalendarBottomSheet>
  );
}
