import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsWriteAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsModal from '../../ops/primitives/OpsModal';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsBanner from '../../ops/primitives/OpsBanner';
import './OpsIssueManualVoucher.css';

const emptyForm = { amount: '260', recipientName: '', recipientEmail: '', reason: '' };

export default function OpsIssueManualVoucher({ open, onClose, onIssued }) {
  const formId = useId();
  const focusRef = useRef(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const pendingRequest = useRef(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (open) focusRef.current?.focus();
  }, [open, result]);

  const reset = () => {
    setForm(emptyForm);
    setResult(null);
    setError('');
  };
  const close = () => {
    if (inFlight.current || pendingRequest.current) return;
    reset();
    onClose();
  };
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

  const locked = busy || Boolean(pendingRequest.current);
  return (
    <OpsModal
      open={open}
      onClose={close}
      title={result ? 'Manual voucher issued' : 'Issue Manual Voucher'}
      description="Goodwill credit, not paid revenue. No payment is taken and no email is sent automatically."
      initialFocusRef={focusRef}
      dismissible={!locked}
      closeOnEscape
      showCloseButton={!locked}
      footer={result ? (
        <>
          <OpsButton variant="quiet" onClick={close}>Done</OpsButton>
          <OpsButton variant="secondary" onClick={reset}>Issue Another</OpsButton>
          <Link className="ops-button ops-button--primary" to={`/ops/gift-vouchers/${result.giftVoucherId}`}>
            View voucher / print / email
          </Link>
        </>
      ) : (
        <>
          {!locked ? <OpsButton variant="quiet" onClick={close}>Cancel</OpsButton> : null}
          <OpsButton type="submit" form={formId} disabled={busy}>
            {busy ? 'Issuing...' : pendingRequest.current ? 'Retry same issuance' : 'Issue Manual Voucher'}
          </OpsButton>
        </>
      )}
    >
      {result ? (
        <div className="ops-manual-voucher-result">
          <p ref={focusRef} tabIndex={-1} className="ops-manual-voucher-result__code">
            Code: <strong>{result.code}</strong>
          </p>
          <dl className="ops-manual-voucher-result__facts">
            <div><dt>Balance</dt><dd>{formatMoneyFromCents(result.balanceRemainingCents, result.currency)}</dd></div>
            <div><dt>Expires</dt><dd>{new Date(result.expiresAt).toLocaleDateString()}</dd></div>
          </dl>
          <p>Open the voucher to print a guest card or send the recipient email. The internal reason is never included.</p>
        </div>
      ) : (
        <form
          id={formId}
          className="ops-manual-voucher-form"
          aria-busy={busy}
          ref={(node) => { focusRef.current = node?.elements.namedItem('amount'); }}
          onSubmit={submit}
        >
          {error ? <OpsBanner tone="danger" body={error} /> : null}
          {locked ? (
            <OpsBanner
              tone="info"
              body={busy
                ? 'Confirming issuance. Keep this dialog open to avoid duplicate credit.'
                : 'Issuance is unconfirmed. Fields and dismissal are locked; retry the same issuance to safely confirm it.'}
            />
          ) : null}
          <OpsTextField className="ops-manual-voucher-form__full" name="amount"
            label="Amount (EUR)" type="number" min="15" step="0.01" required disabled={locked}
            hint="Voucher value in EUR. Minimum EUR 15."
            value={form.amount} onChange={update('amount')} />
          <OpsTextField label="Recipient name" optional maxLength={200} disabled={locked}
            value={form.recipientName} onChange={update('recipientName')} />
          <OpsTextField label="Recipient email" type="email" optional maxLength={254} disabled={locked}
            value={form.recipientEmail} onChange={update('recipientEmail')} />
          <OpsTextField className="ops-manual-voucher-form__full" label="Internal reason" required maxLength={500} disabled={locked}
            hint="Required for the audit trail. Never shown on the guest card or email."
            value={form.reason} onChange={update('reason')} />
        </form>
      )}
    </OpsModal>
  );
}
