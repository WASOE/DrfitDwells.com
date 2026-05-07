import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

function makeIdempotencyKey() {
  return `ops_gv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function OpsGiftVoucherDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [form, setForm] = useState({
    note: '',
    reason: '',
    recipientOverride: '',
    expiresAt: '',
    deltaCents: '',
    recipientEmail: ''
  });

  const voucher = data?.voucher || null;
  const defaultRecipientEmail = voucher?.recipientEmail || '';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.giftVoucherDetail(id);
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load gift voucher detail');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  const balancePct = useMemo(() => {
    if (!voucher?.amountOriginalCents) return 0;
    return Math.max(0, Math.min(100, Math.round((voucher.balanceRemainingCents / voucher.amountOriginalCents) * 100)));
  }, [voucher]);

  const runAction = async (actionName, fn) => {
    setActionError('');
    setBusyAction(actionName);
    try {
      await fn();
      await load();
      setForm((prev) => ({ ...prev, note: '', reason: '' }));
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Action failed');
    } finally {
      setBusyAction('');
    }
  };

  if (loading) return <div className="text-sm text-gray-500">Loading voucher detail...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!voucher) return <div className="text-sm text-gray-500">Voucher not found.</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Gift voucher detail</h2>
          <Link to="/ops/gift-vouchers" className="text-sm text-[#81887A] hover:underline">
            Back to list
          </Link>
        </div>
        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-gray-500">Code</p>
            <p className="font-medium text-gray-900">{voucher.code || 'Pending'}</p>
          </div>
          <div>
            <p className="text-gray-500">Status</p>
            <p className="font-medium text-gray-900">{voucher.status}</p>
          </div>
          <div>
            <p className="text-gray-500">Buyer</p>
            <p className="font-medium text-gray-900">{voucher.buyerName || '—'} ({voucher.buyerEmail || '—'})</p>
          </div>
          <div>
            <p className="text-gray-500">Recipient</p>
            <p className="font-medium text-gray-900">{voucher.recipientName || '—'} ({voucher.recipientEmail || '—'})</p>
          </div>
          <div>
            <p className="text-gray-500">Delivery mode</p>
            <p className="font-medium text-gray-900">{voucher.deliveryMode}</p>
          </div>
          <div>
            <p className="text-gray-500">Payment reference</p>
            <p className="font-medium text-gray-900">{voucher.stripePaymentIntentId || '—'}</p>
          </div>
          <div>
            <p className="text-gray-500">Expires</p>
            <p className="font-medium text-gray-900">{voucher.expiresAt ? new Date(voucher.expiresAt).toLocaleString() : '—'}</p>
          </div>
          <div>
            <p className="text-gray-500">Attribution</p>
            <p className="font-medium text-gray-900">{voucher.attribution?.referralCode || '—'}</p>
          </div>
        </div>
        {voucher.deliveryMode === 'postal' && voucher.deliveryAddress ? (
          <div className="mt-3 text-sm text-gray-700 border border-gray-200 rounded-lg p-3">
            <p className="font-semibold text-gray-900">Delivery address</p>
            <p>{voucher.deliveryAddress.addressLine1 || ''}</p>
            {voucher.deliveryAddress.addressLine2 ? <p>{voucher.deliveryAddress.addressLine2}</p> : null}
            <p>{voucher.deliveryAddress.city || ''} {voucher.deliveryAddress.postalCode || ''}</p>
            <p>{voucher.deliveryAddress.country || ''}</p>
          </div>
        ) : null}
        <div className="mt-3">
          <p className="text-xs text-gray-500">Balance</p>
          <div className="w-full h-2 rounded bg-gray-100 overflow-hidden">
            <div className="h-full bg-[#81887A]" style={{ width: `${balancePct}%` }} />
          </div>
          <p className="text-xs text-gray-700 mt-1">
            {voucher.balanceRemainingCents}/{voucher.amountOriginalCents} {voucher.currency}
          </p>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Actions</h3>
        {actionError ? <div className="text-sm text-red-600">{actionError}</div> : null}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-gray-900">Resend recipient voucher</p>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder={`Override recipient email (default: ${defaultRecipientEmail || 'none'})`}
              value={form.recipientOverride}
              onChange={(e) => setForm((s) => ({ ...s, recipientOverride: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
            <button
              type="button"
              disabled={busyAction === 'resend'}
              onClick={() =>
                runAction('resend', () =>
                  opsWriteAPI.resendGiftVoucher(voucher.giftVoucherId, {
                    idempotencyKey: makeIdempotencyKey(),
                    recipientOverride: form.recipientOverride || undefined,
                    note: form.note || undefined
                  })
                )
              }
              className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {busyAction === 'resend' ? 'Sending...' : 'Resend'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-gray-900">Void voucher</p>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Reason"
              value={form.reason}
              onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Note"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
            <button
              type="button"
              disabled={busyAction === 'void'}
              onClick={() =>
                runAction('void', () =>
                  opsWriteAPI.voidGiftVoucher(voucher.giftVoucherId, {
                    idempotencyKey: makeIdempotencyKey(),
                    reason: form.reason,
                    note: form.note
                  })
                )
              }
              className="px-3 py-2 text-sm rounded-lg bg-red-600 text-white disabled:opacity-50"
            >
              {busyAction === 'void' ? 'Voiding...' : 'Void'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-gray-900">Extend expiry</p>
            <input
              type="datetime-local"
              className="w-full px-3 py-2 text-sm border rounded-lg"
              value={form.expiresAt}
              onChange={(e) => setForm((s) => ({ ...s, expiresAt: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Reason"
              value={form.reason}
              onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Note"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
            <button
              type="button"
              disabled={busyAction === 'extend'}
              onClick={() =>
                runAction('extend', () =>
                  opsWriteAPI.extendGiftVoucherExpiry(voucher.giftVoucherId, {
                    idempotencyKey: makeIdempotencyKey(),
                    expiresAt: form.expiresAt,
                    reason: form.reason,
                    note: form.note
                  })
                )
              }
              className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {busyAction === 'extend' ? 'Updating...' : 'Extend expiry'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-gray-900">Manual balance adjustment</p>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Delta cents (+/-)"
              value={form.deltaCents}
              onChange={(e) => setForm((s) => ({ ...s, deltaCents: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Reason (optional)"
              value={form.reason}
              onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Note"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
            <button
              type="button"
              disabled={busyAction === 'adjust'}
              onClick={() =>
                runAction('adjust', () =>
                  opsWriteAPI.adjustGiftVoucherBalance(voucher.giftVoucherId, {
                    idempotencyKey: makeIdempotencyKey(),
                    deltaCents: Number(form.deltaCents),
                    reason: form.reason || undefined,
                    note: form.note
                  })
                )
              }
              className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {busyAction === 'adjust' ? 'Adjusting...' : 'Adjust balance'}
            </button>
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2 lg:col-span-2">
            <p className="text-sm font-medium text-gray-900">Update recipient email before send</p>
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Recipient email"
              value={form.recipientEmail}
              onChange={(e) => setForm((s) => ({ ...s, recipientEmail: e.target.value }))}
            />
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg"
              placeholder="Note"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
            <button
              type="button"
              disabled={busyAction === 'updateEmail'}
              onClick={() =>
                runAction('updateEmail', () =>
                  opsWriteAPI.updateGiftVoucherRecipientEmail(voucher.giftVoucherId, {
                    idempotencyKey: makeIdempotencyKey(),
                    recipientEmail: form.recipientEmail,
                    note: form.note
                  })
                )
              }
              className="px-3 py-2 text-sm rounded-lg bg-[#81887A] text-white disabled:opacity-50"
            >
              {busyAction === 'updateEmail' ? 'Updating...' : 'Update recipient email'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 xl:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900">Event timeline</h3>
          <div className="mt-2 space-y-2 max-h-[420px] overflow-y-auto">
            {(data?.events || []).map((event) => (
              <div key={event.giftVoucherEventId} className="border border-gray-200 rounded-lg p-3 text-xs">
                <p className="font-semibold text-gray-900">{event.type}</p>
                <p className="text-gray-600">{event.note || '—'} · {event.actor}</p>
                <p className="text-gray-500">{new Date(event.createdAt).toLocaleString()}</p>
                {(event.previousBalanceCents != null || event.newBalanceCents != null) ? (
                  <p className="text-gray-500">
                    {event.previousBalanceCents} → {event.newBalanceCents} (delta {event.deltaCents})
                  </p>
                ) : null}
              </div>
            ))}
            {(data?.events || []).length === 0 ? <p className="text-sm text-gray-500">No events.</p> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900">Redemptions</h3>
            <div className="mt-2 space-y-2">
              {(data?.redemptions || []).map((row) => (
                <div key={row.giftVoucherRedemptionId} className="border border-gray-200 rounded-lg p-2 text-xs">
                  <p className="font-medium text-gray-900">{row.status} · {row.amountAppliedCents} cents</p>
                  <p className="text-gray-500">Booking: {row.bookingId || '—'}</p>
                </div>
              ))}
              {(data?.redemptions || []).length === 0 ? <p className="text-sm text-gray-500">No redemptions.</p> : null}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-gray-900">Manual review items</h3>
            <div className="mt-2 space-y-2">
              {(data?.manualReviewItems || []).map((item) => (
                <div key={item.manualReviewItemId} className="border border-gray-200 rounded-lg p-2 text-xs">
                  <p className="font-medium text-gray-900">{item.category}</p>
                  <p className="text-gray-600">{item.title}</p>
                  <p className="text-gray-500">{item.status} · {item.severity}</p>
                </div>
              ))}
              {(data?.manualReviewItems || []).length === 0 ? (
                <p className="text-sm text-gray-500">No relevant manual review items.</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
