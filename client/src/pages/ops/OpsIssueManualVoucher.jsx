import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsWriteAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsSurface, { OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBanner from '../../ops/primitives/OpsBanner';

export default function OpsIssueManualVoucher({ onIssued }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '260', recipientName: '', recipientEmail: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const pendingRequest = useRef(null);
  const inFlight = useRef(false);

  const update = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!pendingRequest.current) {
      const amountCents = Math.round(Number(form.amount) * 100);
      if (!/^\d+(?:\.\d{1,2})?$/.test(form.amount) || !Number.isSafeInteger(amountCents) || amountCents < 1500) {
        setError('Enter a EUR amount of at least 15, with no more than two decimal places.');
        return;
      }
      if (!form.reason.trim()) {
        setError('An internal reason is required.');
        return;
      }
      pendingRequest.current = {
        amountCents,
        recipientName: form.recipientName,
        recipientEmail: form.recipientEmail,
        reason: form.reason,
        idempotencyKey: `ops_manual_${crypto.randomUUID()}`
      };
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await opsWriteAPI.issueManualGiftVoucher(pendingRequest.current);
      setResult(response.data.data);
      pendingRequest.current = null;
      onIssued();
    } catch (err) {
      // Validation/permission failures are definitive; uncertain failures must reuse the original request.
      if ([400, 403].includes(err?.response?.status)) pendingRequest.current = null;
      setError(err?.response?.data?.message || 'Issuance could not be confirmed. Retry the same request; do not issue another voucher.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!open) return <OpsButton onClick={() => setOpen(true)}>Issue Manual Voucher</OpsButton>;
  if (result) {
    return (
      <OpsSurface>
        <OpsSurfaceTitle>Manual voucher issued</OpsSurfaceTitle>
        <p>Code: <strong>{result.code}</strong></p>
        <p>Balance: {formatMoneyFromCents(result.balanceRemainingCents, result.currency)}</p>
        <p>Expires: {new Date(result.expiresAt).toLocaleDateString()}</p>
        <Link to={`/ops/gift-vouchers/${result.giftVoucherId}`}>View voucher / print card / send email</Link>
        <OpsButton variant="quiet" onClick={() => {
          setResult(null);
          setForm({ amount: '260', recipientName: '', recipientEmail: '', reason: '' });
          setOpen(false);
        }}>Done</OpsButton>
      </OpsSurface>
    );
  }
  const locked = busy || Boolean(pendingRequest.current);
  return (
    <OpsSurface>
      <OpsSurfaceTitle>Issue Manual Voucher</OpsSurfaceTitle>
      <p>Creates goodwill credit, not paid revenue. No payment is taken and no email is sent automatically.</p>
      {error ? <OpsBanner tone="danger" body={error} /> : null}
      <form onSubmit={submit}>
        <OpsTextField label="Amount (EUR)" type="number" min="15" step="0.01" required disabled={locked}
          value={form.amount} onChange={update('amount')} />
        <OpsTextField label="Recipient name" optional maxLength={200} disabled={locked}
          value={form.recipientName} onChange={update('recipientName')} />
        <OpsTextField label="Recipient email" type="email" optional maxLength={254} disabled={locked}
          value={form.recipientEmail} onChange={update('recipientEmail')} />
        <OpsTextField label="Internal reason" required maxLength={500} disabled={locked}
          hint="Required for the audit trail. Never shown on the guest card or email."
          value={form.reason} onChange={update('reason')} />
        <OpsButton type="submit" disabled={busy}>{busy ? 'Issuing...' : pendingRequest.current ? 'Retry same issuance' : 'Issue Manual Voucher'}</OpsButton>
        {!locked ? <OpsButton variant="quiet" onClick={() => setOpen(false)}>Cancel</OpsButton> : null}
      </form>
    </OpsSurface>
  );
}
