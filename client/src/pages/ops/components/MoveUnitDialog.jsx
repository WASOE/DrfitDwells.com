import { useEffect, useRef, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import {
  makeReallocateIdempotencyKey,
  mapReallocateErrorCode,
  interpretReallocateSuccessPayload
} from '../utils/opsReservationPermissions';

const SELECTABLE = new Set(['AVAILABLE', 'EXTERNAL_HOLD_WARNING']);

function unitLabel(c) {
  if (!c) return '—';
  if (c.displayName) return c.displayName;
  if (c.unitNumber) {
    return /^unit\b/i.test(String(c.unitNumber)) ? String(c.unitNumber) : `Unit ${c.unitNumber}`;
  }
  return c.unitId ? String(c.unitId).slice(-6) : '—';
}

function stateBadgeClass(state) {
  if (state === 'AVAILABLE') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (state === 'EXTERNAL_HOLD_WARNING') return 'bg-amber-50 text-amber-900 border-amber-200';
  if (state === 'HARD_BLOCKED') return 'bg-red-50 text-red-800 border-red-200';
  if (state === 'CURRENT') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-gray-50 text-gray-600 border-gray-200';
}

function stateLabel(state) {
  if (state === 'AVAILABLE') return 'Available';
  if (state === 'EXTERNAL_HOLD_WARNING') return 'External hold';
  if (state === 'HARD_BLOCKED') return 'Blocked';
  if (state === 'CURRENT') return 'Current';
  if (state === 'INACTIVE') return 'Inactive';
  return state;
}

function conflictLine(c) {
  if (!c) return null;
  const bits = [];
  if (c.blockType === 'external_hold') bits.push('Channel hold');
  else if (c.kind === 'reservation') bits.push('Reservation');
  else if (c.kind === 'legacy_blocked_date') bits.push('Legacy blocked date');
  else if (c.blockType) bits.push(String(c.blockType));
  else if (c.kind) bits.push(String(c.kind));
  if (c.startDate && c.endDate) bits.push(`${c.startDate} → ${c.endDate}`);
  else if (c.startDate) bits.push(String(c.startDate));
  if (c.reservationId) bits.push(`#${String(c.reservationId).slice(-6)}`);
  return bits.join(' · ') || null;
}

/**
 * R3 Move Unit dialog — unit-only REALLOCATE against live R1 API.
 */
export default function MoveUnitDialog({
  reservationId,
  sourceUnitLabel,
  open,
  onClose,
  onSuccess
}) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [reason, setReason] = useState('');
  const [acceptExternal, setAcceptExternal] = useState(false);
  const idempotencyKeyRef = useRef(null);
  const busyRef = useRef(false);

  const mintKey = () => {
    idempotencyKeyRef.current = makeReallocateIdempotencyKey();
  };

  const loadCandidates = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const resp = await opsReadAPI.reallocateCandidates(reservationId);
      const list = resp.data?.data?.candidates || [];
      setCandidates(list);
    } catch (err) {
      const code = err?.response?.data?.details?.code;
      const mapped = mapReallocateErrorCode(code);
      setLoadError(mapped || err?.response?.data?.message || 'Failed to load unit candidates');
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    mintKey();
    busyRef.current = false;
    setBusy(false);
    setSelectedUnitId('');
    setReason('');
    setAcceptExternal(false);
    setSubmitError('');
    setLoadError('');
    loadCandidates();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-only mint
  }, [open, reservationId]);

  const selected = candidates.find((c) => c.unitId === selectedUnitId) || null;
  const needsAck = selected?.state === 'EXTERNAL_HOLD_WARNING';
  const canSubmit =
    Boolean(selected) &&
    SELECTABLE.has(selected.state) &&
    (!needsAck || acceptExternal) &&
    !busy &&
    !loading;

  const selectTarget = (unitId) => {
    const next = candidates.find((c) => c.unitId === unitId);
    if (!next || !SELECTABLE.has(next.state)) return;
    if (unitId !== selectedUnitId) {
      if (selectedUnitId) mintKey();
      setAcceptExternal(false);
      setSubmitError('');
    }
    setSelectedUnitId(unitId);
  };

  const handleClose = () => {
    if (busyRef.current) return;
    onClose?.();
  };

  const handleSubmit = async () => {
    if (!canSubmit || !selected || !idempotencyKeyRef.current) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSubmitError('');
    const key = idempotencyKeyRef.current;
    try {
      const resp = await opsWriteAPI.reallocateReservation(reservationId, {
        targetUnitId: selected.unitId,
        idempotencyKey: key,
        reason: reason.trim() || undefined,
        acceptExternalHoldWarnings: needsAck ? true : false
      });
      const payload = resp?.data?.data || resp?.data || {};
      const interpreted = interpretReallocateSuccessPayload(payload);

      if (interpreted.kind === 'completed') {
        const fromLabel = sourceUnitLabel || 'previous unit';
        const toLabel = unitLabel(selected);
        onSuccess?.({ fromLabel, toLabel });
        onClose?.();
        return;
      }

      if (interpreted.kind === 'noop') {
        onSuccess?.({ refresh: true, noop: true });
        onClose?.();
        return;
      }

      if (interpreted.kind === 'needs_reconciliation') {
        setSubmitError(interpreted.message);
        onSuccess?.({ refresh: true, reconciliation: true });
        return;
      }

      setSubmitError(interpreted.message);
      await loadCandidates();
    } catch (err) {
      const details = err?.response?.data?.details || {};
      const code = details.code || null;
      const mapped = mapReallocateErrorCode(code);
      const message =
        mapped || err?.response?.data?.message || 'Move failed. Try again or refresh.';

      if (
        code === 'HARD_CONFLICTS' ||
        code === 'UNIT_NOT_FOUND_OR_INACTIVE' ||
        code === 'UNIT_CABIN_TYPE_MISMATCH'
      ) {
        await loadCandidates();
        setSelectedUnitId('');
        setAcceptExternal(false);
      }
      if (
        code === 'CAS_FAILED' ||
        code === 'CAS_LOST_OTHER_UNIT' ||
        code === 'BOOKING_CAS_FAILED'
      ) {
        await loadCandidates();
      }
      if (
        code === 'BLOCK_SYNC_FAILED' ||
        code === 'SOURCE_RELEASE_FAILED' ||
        details.status === 'needs_reconciliation'
      ) {
        onSuccess?.({ refresh: true, reconciliation: true });
      }
      if (
        code === 'STATUS_NOT_ELIGIBLE' ||
        code === 'SINGLE_CABIN_NOT_REALLOCATE' ||
        code === 'CABIN_TYPE_REQUIRED' ||
        code === 'UNIT_ALLOCATION_REQUIRED' ||
        code === 'MALFORMED_INVENTORY_IDENTITY' ||
        code === 'COMMERCIAL_PRODUCT_INVALID'
      ) {
        onSuccess?.({ closeOnly: true, refresh: true, code });
        onClose?.();
        setSubmitError(message);
        busyRef.current = false;
        setBusy(false);
        return;
      }
      if (code === 'EXTERNAL_HOLD_ACK_REQUIRED') {
        setAcceptExternal(false);
        await loadCandidates();
      }
      setSubmitError(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="move-unit-title">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Close Move Unit"
        disabled={busy}
        onClick={handleClose}
      />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-xl border border-gray-200 shadow-lg p-4 sm:p-5 space-y-4">
        <div>
          <h3 id="move-unit-title" className="text-sm font-semibold text-gray-900">
            Move Unit
          </h3>
          <p className="mt-1 text-xs text-gray-500 max-w-md">
            Move this reservation to another physical unit of the same accommodation type. Dates,
            guests, and payment are unchanged.
          </p>
          {sourceUnitLabel ? (
            <p className="mt-2 text-sm text-gray-700">
              Current unit: <span className="font-medium">{sourceUnitLabel}</span>
            </p>
          ) : null}
        </div>

        {loading ? <p className="text-sm text-gray-500">Loading units…</p> : null}
        {loadError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
        ) : null}

        {!loading && !loadError ? (
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-gray-500 mb-1">Target unit</legend>
            <ul className="space-y-2">
              {candidates.map((c) => {
                const selectable = SELECTABLE.has(c.state);
                const checked = selectedUnitId === c.unitId;
                return (
                  <li key={c.unitId}>
                    <label
                      className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${
                        selectable ? 'border-gray-200 hover:bg-gray-50 cursor-pointer' : 'border-gray-100 bg-gray-50 opacity-80'
                      } ${checked ? 'ring-1 ring-[#81887A] border-[#81887A]' : ''}`}
                    >
                      <input
                        type="radio"
                        name="moveUnitTarget"
                        className="mt-1"
                        disabled={!selectable || busy}
                        checked={checked}
                        onChange={() => selectTarget(c.unitId)}
                        value={c.unitId}
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{unitLabel(c)}</span>
                          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${stateBadgeClass(c.state)}`}>
                            {stateLabel(c.state)}
                          </span>
                        </span>
                        {c.state === 'HARD_BLOCKED' && c.hardConflicts?.length ? (
                          <ul className="mt-1 text-xs text-red-700 space-y-0.5">
                            {c.hardConflicts.map((h, idx) => (
                              <li key={`${c.unitId}-h-${idx}`}>{conflictLine(h)}</li>
                            ))}
                          </ul>
                        ) : null}
                        {c.state === 'EXTERNAL_HOLD_WARNING' && c.warnings?.length ? (
                          <ul className="mt-1 text-xs text-amber-800 space-y-0.5">
                            {c.warnings.map((w, idx) => (
                              <li key={`${c.unitId}-w-${idx}`}>{conflictLine(w) || 'External channel hold'}</li>
                            ))}
                          </ul>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {needsAck ? (
          <label className="flex items-start gap-2 text-xs text-amber-950 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acceptExternal}
              disabled={busy}
              onChange={(e) => setAcceptExternal(e.target.checked)}
            />
            <span>
              I understand this unit overlaps an external channel hold for these dates and still want
              to move the reservation. This is not an internal inventory conflict override.
            </span>
          </label>
        ) : null}

        <div>
          <label htmlFor="moveUnitReason" className="block text-xs font-medium text-gray-500 mb-1">
            Reason (optional)
          </label>
          <textarea
            id="moveUnitReason"
            rows={2}
            maxLength={500}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg max-w-lg"
            placeholder="Optional ops note"
          />
        </div>

        {submitError ? (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{submitError}</div>
        ) : null}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={handleClose}
            className="w-full sm:w-auto px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full sm:w-auto px-4 py-2 text-sm font-medium rounded-lg bg-[#81887A] text-white hover:bg-[#707668] disabled:opacity-50"
          >
            {busy ? 'Moving…' : 'Move unit'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { unitLabel as moveUnitCandidateLabel, SELECTABLE as MOVE_UNIT_SELECTABLE_STATES };
