import { useEffect, useRef, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import {
  makeReallocateIdempotencyKey,
  mapReallocateErrorCode,
  interpretReallocateSuccessPayload
} from '../utils/opsReservationPermissions';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';
import OpsModal from '../../../ops/primitives/OpsModal';
import OpsStatus from '../../../ops/primitives/OpsStatus';
import OpsTextarea from '../../../ops/primitives/OpsTextarea';
import './MoveUnitDialog.css';

const SELECTABLE = new Set(['AVAILABLE', 'EXTERNAL_HOLD_WARNING']);

function unitLabel(c) {
  if (!c) return '—';
  if (c.displayName) return c.displayName;
  if (c.unitNumber) {
    return /^unit\b/i.test(String(c.unitNumber)) ? String(c.unitNumber) : `Unit ${c.unitNumber}`;
  }
  return c.unitId ? String(c.unitId).slice(-6) : '—';
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

  return (
    <OpsModal
      open={open}
      onClose={handleClose}
      title="Move Unit"
      description="Move this reservation to another physical unit of the same accommodation type. Dates, guests, and payment are unchanged."
      size="lg"
      mobileSheet
      dismissible={!busy}
      panelProps={{ className: 'ops-move-unit-modal' }}
      footer={
        <>
          <OpsButton variant="secondary" disabled={busy} onClick={handleClose}>
            Cancel
          </OpsButton>
          <OpsButton disabled={!canSubmit} loading={busy} loadingLabel="Moving…" onClick={handleSubmit}>
            Move unit
          </OpsButton>
        </>
      }
    >
      {sourceUnitLabel ? (
        <p className="ops-move-unit__current">
          Current unit: <strong>{sourceUnitLabel}</strong>
        </p>
      ) : null}

      {loading ? <OpsLoadingState label="Loading units" /> : null}
      {loadError ? <OpsBanner tone="danger" body={loadError} /> : null}

      {!loading && !loadError ? (
        <fieldset className="ops-move-unit__fieldset">
          <legend>Target unit</legend>
          <ul className="ops-move-unit__candidates">
            {candidates.map((candidate) => {
              const selectable = SELECTABLE.has(candidate.state);
              const checked = selectedUnitId === candidate.unitId;
              return (
                <li key={candidate.unitId}>
                  <label
                    className={`ops-move-unit__candidate${checked ? ' ops-move-unit__candidate--selected' : ''}${selectable ? '' : ' ops-move-unit__candidate--disabled'}`}
                  >
                    <input
                      type="radio"
                      name="moveUnitTarget"
                      disabled={!selectable || busy}
                      checked={checked}
                      onChange={() => selectTarget(candidate.unitId)}
                      value={candidate.unitId}
                    />
                    <span className="ops-move-unit__candidate-copy">
                      <span className="ops-move-unit__candidate-head">
                        <strong>{unitLabel(candidate)}</strong>
                        <OpsStatus domain="move_unit" value={candidate.state} />
                      </span>
                      {candidate.state === 'HARD_BLOCKED' && candidate.hardConflicts?.length ? (
                        <ul className="ops-move-unit__conflicts ops-move-unit__conflicts--danger">
                          {candidate.hardConflicts.map((conflict, index) => (
                            <li key={`${candidate.unitId}-h-${index}`}>{conflictLine(conflict)}</li>
                          ))}
                        </ul>
                      ) : null}
                      {candidate.state === 'EXTERNAL_HOLD_WARNING' && candidate.warnings?.length ? (
                        <ul className="ops-move-unit__conflicts ops-move-unit__conflicts--warning">
                          {candidate.warnings.map((warning, index) => (
                            <li key={`${candidate.unitId}-w-${index}`}>
                              {conflictLine(warning) || 'External channel hold'}
                            </li>
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
        <OpsCheckbox
          className="ops-move-unit__ack"
          label="I understand this unit overlaps an external channel hold for these dates and still want to move the reservation. This is not an internal inventory conflict override."
          checked={acceptExternal}
          disabled={busy}
          onChange={(e) => setAcceptExternal(e.target.checked)}
        />
      ) : null}

      <OpsTextarea
        id="moveUnitReason"
        label="Reason"
        optional
        rows={2}
        maxLength={500}
        value={reason}
        disabled={busy}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Optional ops note"
      />

      {submitError ? <OpsBanner tone="danger" body={submitError} /> : null}
    </OpsModal>
  );
}

export { unitLabel as moveUnitCandidateLabel, SELECTABLE as MOVE_UNIT_SELECTABLE_STATES };
