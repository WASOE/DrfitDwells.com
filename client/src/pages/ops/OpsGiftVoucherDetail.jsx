import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsTextField from '../../ops/primitives/OpsTextField';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsSurface, { OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import { opsCx } from '../../ops/primitives/opsCx';
import './OpsGiftVoucherDetail.css';

function makeIdempotencyKey() {
  return `ops_gv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const BACK = { to: '/ops/gift-vouchers', label: 'Gift vouchers' };

function Fact({ label, children, numeric = false }) {
  return (
    <div className={opsCx('ops-gv-detail__fact', numeric && 'ops-gv-detail__fact--numeric')}>
      <dt className="ops-gv-detail__fact-label">{label}</dt>
      <dd className="ops-gv-detail__fact-value">{children}</dd>
    </div>
  );
}

function DetailHeader({ title, voucher, actions }) {
  return (
    <OpsPageHeader
      back={BACK}
      title={title}
      meta={voucher ? <OpsStatus domain="voucher" value={voucher.status} /> : undefined}
      actions={actions}
    />
  );
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

  if (loading) {
    return (
      <OpsPage width="wide">
        <DetailHeader title="Gift voucher" />
        <OpsLoadingState label="Loading voucher detail..." />
      </OpsPage>
    );
  }

  if (error) {
    return (
      <OpsPage width="wide">
        <DetailHeader title="Gift voucher" />
        <OpsBanner tone="danger" title={error} />
      </OpsPage>
    );
  }

  if (!voucher) {
    return (
      <OpsPage width="wide">
        <DetailHeader title="Gift voucher" />
        <OpsEmptyState title="Voucher not found." />
      </OpsPage>
    );
  }

  const title = voucher.code || 'Code pending';

  return (
    <OpsPage width="wide">
      <div className="ops-gv-detail">
        <DetailHeader
          title={title}
          voucher={voucher}
          actions={
            <OpsButton
              variant="secondary"
              loading={busyAction === 'print'}
              loadingLabel="Opening print..."
              onClick={() =>
                runAction('print', async () => {
                  const resp = await opsReadAPI.printGiftVoucherCard(voucher.giftVoucherId);
                  const blob = new Blob([resp.data], { type: 'text/html;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank', 'noopener,noreferrer');
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                })
              }
            >
              Print card
            </OpsButton>
          }
        />

        <OpsSurface variant="plain" className="ops-gv-detail__section">
          <OpsSurfaceTitle className="ops-gv-detail__section-title">Voucher</OpsSurfaceTitle>
          <dl className="ops-gv-detail__facts">
            <Fact label="Code">{voucher.code || 'Pending'}</Fact>
            <Fact label="Expires">
              {voucher.expiresAt ? new Date(voucher.expiresAt).toLocaleString() : '—'}
            </Fact>
            <Fact label="Payment reference">{voucher.stripePaymentIntentId || '—'}</Fact>
            <Fact label="Attribution">{voucher.attribution?.referralCode || '—'}</Fact>
          </dl>
        </OpsSurface>

        <OpsSurface variant="plain" className="ops-gv-detail__section">
          <OpsSurfaceTitle className="ops-gv-detail__section-title">People</OpsSurfaceTitle>
          <dl className="ops-gv-detail__facts">
            <Fact label="Buyer">
              {voucher.buyerName || '—'} ({voucher.buyerEmail || '—'})
            </Fact>
            <Fact label="Recipient">
              {voucher.recipientName || '—'} ({voucher.recipientEmail || '—'})
            </Fact>
          </dl>
        </OpsSurface>

        <OpsSurface variant="plain" className="ops-gv-detail__section">
          <OpsSurfaceTitle className="ops-gv-detail__section-title">Delivery</OpsSurfaceTitle>
          <dl className="ops-gv-detail__facts">
            <Fact label="Delivery mode">{voucher.deliveryMode}</Fact>
            <Fact label="Delivery option">
              {voucher.deliveryOptionLabel || voucher.deliveryOption || '—'}
            </Fact>
            <Fact label="Card design">{voucher.cardTemplateLabel || '—'}</Fact>
            <Fact label="Occasion">{voucher.cardOccasion || '—'}</Fact>
            <Fact label="Card language">
              {voucher.cardLocale ? voucher.cardLocale.toUpperCase() : '—'}
            </Fact>
            <Fact label="Scheduled date">
              {voucher.deliveryDate ? new Date(voucher.deliveryDate).toLocaleDateString() : '—'}
            </Fact>
            <Fact label="Sent at">
              {voucher.sentAt ? new Date(voucher.sentAt).toLocaleString() : '—'}
            </Fact>
            <Fact label="Recipient card sent">{voucher.recipientCardSent ? 'Yes' : 'No'}</Fact>
            <Fact label="Download token">{voucher.hasCardAccessToken ? 'Active' : 'None'}</Fact>
            {voucher.deliveryMode === 'postal' && (voucher.physicalCardFeeCents || 0) > 0 ? (
              <Fact label="Physical card fee" numeric>
                {formatMoneyFromCents(voucher.physicalCardFeeCents, voucher.currency)}
              </Fact>
            ) : null}
          </dl>
          {voucher.deliveryMode === 'postal' && voucher.deliveryAddress ? (
            <div className="ops-gv-detail__address">
              <p className="ops-gv-detail__address-title">Delivery address</p>
              <p>{voucher.deliveryAddress.addressLine1 || ''}</p>
              {voucher.deliveryAddress.addressLine2 ? <p>{voucher.deliveryAddress.addressLine2}</p> : null}
              <p>
                {voucher.deliveryAddress.city || ''} {voucher.deliveryAddress.postalCode || ''}
              </p>
              <p>{voucher.deliveryAddress.country || ''}</p>
            </div>
          ) : null}
        </OpsSurface>

        <OpsSurface variant="plain" className="ops-gv-detail__section">
          <OpsSurfaceTitle className="ops-gv-detail__section-title">Value</OpsSurfaceTitle>
          <p className="ops-gv-detail__fact-label">Balance</p>
          <div className="ops-gv-detail__balance-track">
            <div className="ops-gv-detail__balance-fill" style={{ '--ops-gv-balance': `${balancePct}%` }} />
          </div>
          <p className="ops-gv-detail__balance-copy">
            {formatMoneyFromCents(voucher.balanceRemainingCents, voucher.currency)} /{' '}
            {formatMoneyFromCents(voucher.amountOriginalCents, voucher.currency)}
          </p>
        </OpsSurface>

        <OpsSurface variant="plain" className="ops-gv-detail__section">
          <OpsSurfaceTitle className="ops-gv-detail__section-title">Actions</OpsSurfaceTitle>
          {actionError ? <OpsInlineError>{actionError}</OpsInlineError> : null}
          <div className="ops-gv-detail__actions">
            <div className="ops-gv-detail__action">
              <p className="ops-gv-detail__action-title">Resend recipient voucher</p>
              <OpsTextField
                label="Override recipient email"
                hint={`Override recipient email (default: ${defaultRecipientEmail || 'none'})`}
                value={form.recipientOverride}
                onChange={(e) => setForm((s) => ({ ...s, recipientOverride: e.target.value }))}
              />
              <OpsTextField
                label="Note"
                optional
                value={form.note}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
              <OpsButton
                variant="secondary"
                loading={busyAction === 'resend'}
                loadingLabel="Sending..."
                onClick={() =>
                  runAction('resend', () =>
                    opsWriteAPI.resendGiftVoucher(voucher.giftVoucherId, {
                      idempotencyKey: makeIdempotencyKey(),
                      recipientOverride: form.recipientOverride || undefined,
                      note: form.note || undefined
                    })
                  )
                }
              >
                Resend
              </OpsButton>
            </div>

            <div className="ops-gv-detail__action">
              <p className="ops-gv-detail__action-title">Void voucher</p>
              <OpsTextField
                label="Reason"
                value={form.reason}
                onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
              />
              <OpsTextField
                label="Note"
                value={form.note}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
              <OpsButton
                variant="destructive"
                loading={busyAction === 'void'}
                loadingLabel="Voiding..."
                onClick={() =>
                  runAction('void', () =>
                    opsWriteAPI.voidGiftVoucher(voucher.giftVoucherId, {
                      idempotencyKey: makeIdempotencyKey(),
                      reason: form.reason,
                      note: form.note
                    })
                  )
                }
              >
                Void
              </OpsButton>
            </div>

            <div className="ops-gv-detail__action">
              <p className="ops-gv-detail__action-title">Extend expiry</p>
              <OpsTextField
                label="New expiry"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm((s) => ({ ...s, expiresAt: e.target.value }))}
              />
              <OpsTextField
                label="Reason"
                value={form.reason}
                onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
              />
              <OpsTextField
                label="Note"
                value={form.note}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
              <OpsButton
                variant="secondary"
                loading={busyAction === 'extend'}
                loadingLabel="Updating..."
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
              >
                Extend expiry
              </OpsButton>
            </div>

            <div className="ops-gv-detail__action">
              <p className="ops-gv-detail__action-title">Manual balance adjustment</p>
              <OpsTextField
                label="Delta cents"
                hint="Delta cents (+/-)"
                value={form.deltaCents}
                onChange={(e) => setForm((s) => ({ ...s, deltaCents: e.target.value }))}
              />
              <OpsTextField
                label="Reason"
                optional
                value={form.reason}
                onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))}
              />
              <OpsTextField
                label="Note"
                value={form.note}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
              <OpsButton
                variant="secondary"
                loading={busyAction === 'adjust'}
                loadingLabel="Adjusting..."
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
              >
                Adjust balance
              </OpsButton>
            </div>

            <div className="ops-gv-detail__action ops-gv-detail__action--wide">
              <p className="ops-gv-detail__action-title">Update recipient email before send</p>
              <OpsTextField
                label="Recipient email"
                value={form.recipientEmail}
                onChange={(e) => setForm((s) => ({ ...s, recipientEmail: e.target.value }))}
              />
              <OpsTextField
                label="Note"
                value={form.note}
                onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
              />
              <OpsButton
                variant="secondary"
                loading={busyAction === 'updateEmail'}
                loadingLabel="Updating..."
                onClick={() =>
                  runAction('updateEmail', () =>
                    opsWriteAPI.updateGiftVoucherRecipientEmail(voucher.giftVoucherId, {
                      idempotencyKey: makeIdempotencyKey(),
                      recipientEmail: form.recipientEmail,
                      note: form.note
                    })
                  )
                }
              >
                Update recipient email
              </OpsButton>
            </div>
          </div>
        </OpsSurface>

        <section className="ops-gv-detail__lifecycle">
          <OpsSurface as="div" variant="plain" className="ops-gv-detail__section">
            <OpsSurfaceTitle className="ops-gv-detail__section-title">Event timeline</OpsSurfaceTitle>
            <div className="ops-gv-detail__timeline">
              {(data?.events || []).map((event) => (
                <div key={event.giftVoucherEventId} className="ops-gv-detail__item">
                  <p className="ops-gv-detail__item-title">{event.type}</p>
                  <p className="ops-gv-detail__item-copy">
                    {event.note || '—'} · {event.actor}
                  </p>
                  <p className="ops-gv-detail__item-copy">{new Date(event.createdAt).toLocaleString()}</p>
                  {event.previousBalanceCents != null || event.newBalanceCents != null ? (
                    <p className="ops-gv-detail__item-copy ops-gv-detail__item-copy--numeric">
                      {formatMoneyFromCents(event.previousBalanceCents, voucher.currency)} →{' '}
                      {formatMoneyFromCents(event.newBalanceCents, voucher.currency)}
                      {event.deltaCents != null
                        ? ` (Δ ${formatMoneyFromCents(event.deltaCents, voucher.currency)})`
                        : null}
                    </p>
                  ) : null}
                </div>
              ))}
              {(data?.events || []).length === 0 ? <p className="ops-gv-detail__muted">No events.</p> : null}
            </div>
          </OpsSurface>

          <div className="ops-gv-detail__stack">
            <OpsSurface variant="plain" className="ops-gv-detail__section">
              <OpsSurfaceTitle className="ops-gv-detail__section-title">Redemptions</OpsSurfaceTitle>
              {(data?.redemptions || []).map((row) => (
                <div key={row.giftVoucherRedemptionId} className="ops-gv-detail__item">
                  <p className="ops-gv-detail__item-title ops-gv-detail__item-copy--numeric">
                    {row.status} · {formatMoneyFromCents(row.amountAppliedCents, voucher.currency)}
                  </p>
                  <p className="ops-gv-detail__item-copy">Booking: {row.bookingId || '—'}</p>
                </div>
              ))}
              {(data?.redemptions || []).length === 0 ? (
                <p className="ops-gv-detail__muted">No redemptions.</p>
              ) : null}
            </OpsSurface>
            <OpsSurface variant="plain" className="ops-gv-detail__section">
              <OpsSurfaceTitle className="ops-gv-detail__section-title">Manual review items</OpsSurfaceTitle>
              {(data?.manualReviewItems || []).map((item) => (
                <div key={item.manualReviewItemId} className="ops-gv-detail__item">
                  <p className="ops-gv-detail__item-title">{item.category}</p>
                  <p className="ops-gv-detail__item-copy">{item.title}</p>
                  <p className="ops-gv-detail__item-copy">
                    {item.status} · {item.severity}
                  </p>
                </div>
              ))}
              {(data?.manualReviewItems || []).length === 0 ? (
                <p className="ops-gv-detail__muted">No relevant manual review items.</p>
              ) : null}
            </OpsSurface>
          </div>
        </section>
      </div>
    </OpsPage>
  );
}
