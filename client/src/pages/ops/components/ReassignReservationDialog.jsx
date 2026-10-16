import { useEffect, useRef, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../../services/opsApi';
import { formatMoneyFromCents } from '../../../utils/formatMoney';
import OpsModal from '../../../ops/primitives/OpsModal';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsTextField from '../../../ops/primitives/OpsTextField';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsBanner from '../../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../../ops/primitives/OpsLoadingState';

export function reassignmentError(error) {
  const payload = error?.response?.data;
  const code = payload?.details?.code;
  const messages = {
    REBOOK_DISABLED: 'Reassignment is temporarily disabled. No change was made.',
    HARD_CONFLICTS: 'This destination is no longer available. Refresh before starting another change.',
    TARGET_CAPACITY: 'This destination cannot accommodate the reservation guests.',
    SOURCE_OWNERSHIP_CONFLICT: 'Another change owns this reservation. Review its history before retrying.',
    NEEDS_RECONCILIATION: 'This change needs reconciliation. Do not start another reassignment; contact an administrator.',
    PAYMENT_EVIDENCE_AMBIGUOUS: 'Financial evidence cannot be verified. Reassignment is blocked.',
    DOWNGRADE_UNSUPPORTED: 'A cheaper destination is not supported.',
    EXTERNAL_HOLD_ACK_REQUIRED: 'An external hold requires explicit acknowledgement.',
    UPGRADE_WAIVER_REQUIRED: 'The destination price changed. Refresh and review the complimentary upgrade amount.',
    STAY_CHANGE_IDEMPOTENCY_INDEX_MISSING: 'Reassignment is unavailable: the required inventory configuration needs administrator review.'
  };
  if (error?.response?.status === 403) return 'You do not have permission to reassign reservations.';
  return messages[code] || payload?.message || 'The result is uncertain. Retry only this same change or contact an administrator.';
}

export default function ReassignReservationDialog({ open, reservationId, sourceLabel, onClose, onSuccess }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [ackHold, setAckHold] = useState(false);
  const [ackUpgrade, setAckUpgrade] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const intent = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setPreview(null);
    setError('');
    setSearch('');
    setSelectedId('');
    setAckHold(false);
    setAckUpgrade(false);
    setConfirmed(false);
    setAttempted(false);
    intent.current = null;
    opsReadAPI.rebookCandidates(reservationId).then(response => {
      if (active) setPreview(response.data.data);
    }).catch(err => {
      if (active) setError(reassignmentError(err));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [open, reservationId]);

  const selected = preview?.candidates.find(candidate => candidate.id === selectedId);
  const options = (preview?.candidates || []).filter(candidate =>
    candidate.id === selectedId || candidate.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())
  );
  const canSubmit = !loading && !busy && selected && confirmed &&
    (!selected.externalHoldWarning || ackHold) && (!selected.differenceCents || ackUpgrade);
  const close = () => { if (!busyRef.current) onClose(); };
  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    if (!intent.current) {
      intent.current = {
        idempotencyKey: `ops_rebook_${crypto.randomUUID()}`,
        ...(selected.targetCabinId
          ? { targetCabinId: selected.targetCabinId }
          : { targetCabinTypeId: selected.targetCabinTypeId, targetUnitId: selected.targetUnitId }),
        waiveUpgradeCents: selected.differenceCents,
        acceptExternalHoldWarnings: Boolean(selected.externalHoldWarning && ackHold),
        reason: 'ops_reassign'
      };
    }
    setAttempted(true);
    try {
      const response = await opsWriteAPI.rebookReservation(reservationId, intent.current);
      const result = response.data?.data;
      if (result?.status !== 'completed' || !result.targetBookingId) {
        setError('Reassignment has not completed. Do not start another change; review the reservation with an administrator.');
        return;
      }
      await onSuccess({ ...result, destinationLabel: selected.label });
      onClose();
    } catch (err) {
      setError(reassignmentError(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <OpsModal
      open={open}
      onClose={close}
      dismissible={!busy}
      title="Reassign reservation"
      description="Choose another accommodation for the same guests and dates. Original financial records are retained. No guest notification is sent."
      mobileSheet
      footer={<>
        <OpsButton variant="secondary" disabled={busy} onClick={close}>Cancel</OpsButton>
        <OpsButton disabled={!canSubmit} loading={busy} onClick={submit}>
          {attempted ? 'Retry same reassignment' : 'Confirm reassignment'}
        </OpsButton>
      </>}
    >
      <div className="ops-rd-modal-stack">
        <p>Current accommodation: <strong>{sourceLabel}</strong></p>
        {loading ? <OpsLoadingState label="Checking destinations for these dates" /> : null}
        {preview ? <>
          <p>Reservation dates: <strong>{preview.checkInDateOnly} to {preview.checkOutDateOnly}</strong></p>
          <p>{preview.adults} adults, {preview.children} children. Contractual price: {formatMoneyFromCents(preview.contractualTotalCents)}.
            {' '}Verified transferable value: {formatMoneyFromCents(preview.transferableValueCents)}.</p>
          <OpsTextField label="Search accommodations" type="search" value={search}
            disabled={busy || attempted} onChange={event => setSearch(event.target.value)} />
          <OpsSelect label="Destination accommodation" value={selectedId} disabled={busy || attempted}
            onChange={event => {
              setSelectedId(event.target.value);
              setAckHold(false); setAckUpgrade(false); setConfirmed(false);
            }}>
            <option value="">Select an available accommodation</option>
            {options.map(candidate => <option key={candidate.id} value={candidate.id}>
              {candidate.label} - {formatMoneyFromCents(candidate.canonicalTargetQuoteCents)}
            </option>)}
          </OpsSelect>
          {!preview.candidates.length ? <p>No eligible available destinations for these dates, guests and supported settlement options.</p> : null}
          {selected ? <>
            <p>Selected destination: <strong>{selected.label}</strong>. Capacity: {selected.capacity}.
              {' '}Canonical price: {formatMoneyFromCents(selected.canonicalTargetQuoteCents)}.
              {' '}Price difference: {formatMoneyFromCents(selected.differenceCents)}.</p>
            {selected.differenceCents > 0 ? <OpsCheckbox
              label={`Approve a full complimentary upgrade of ${formatMoneyFromCents(selected.differenceCents)}. No additional payment will be collected.`}
              checked={ackUpgrade} disabled={busy || attempted} onChange={event => setAckUpgrade(event.target.checked)} /> : null}
            {selected.externalHoldWarning ? <OpsCheckbox
              label="I acknowledge the external channel hold for these dates. This does not override internal inventory conflicts."
              checked={ackHold} disabled={busy || attempted} onChange={event => setAckHold(event.target.checked)} /> : null}
            <OpsCheckbox label={`Confirm reassignment to ${selected.label} for ${preview.checkInDateOnly} to ${preview.checkOutDateOnly}.`}
              checked={confirmed} disabled={busy || attempted} onChange={event => setConfirmed(event.target.checked)} />
            <p>Availability and price are checked again on confirmation. The original reservation will link to its replacement.</p>
          </> : null}
        </> : null}
        {error ? <OpsBanner tone="danger" body={error} /> : null}
      </div>
    </OpsModal>
  );
}
