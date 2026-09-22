import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsButton from '../../ops/primitives/OpsButton';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsInlineError from '../../ops/primitives/OpsInlineError';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import './OpsPayments.css';

const PROPERTY_TIME_ZONE = 'Europe/Sofia';
const EVIDENCE_LIMIT = 20;

function formatWebhookLastSeen(value) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: PROPERTY_TIME_ZONE,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    }).format(date);
  } catch {
    return String(value);
  }
}

function formatLedgerAmount(amount, currency) {
  const num = Number(amount);
  const code = String(currency || '').trim().toUpperCase();
  if (!Number.isFinite(num) && !code) return '—';
  if (!Number.isFinite(num)) return `— ${code}`.trim();
  if (!code) return String(num);
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${code}`;
  }
}

function observabilityCopy(summary) {
  const obs = summary?.observability;
  if (!obs) return 'Webhook evidence: unknown';
  const seen = formatWebhookLastSeen(obs.webhookLastSeenAt);
  return `Webhook last seen: ${seen} · open reconciliation items: ${obs.openReconciliationItems ?? 0}`;
}

export default function OpsPayments() {
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const [selectedPayoutId, setSelectedPayoutId] = useState(null);
  const [selectedPayout, setSelectedPayout] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, l, p, r] = await Promise.all([
        opsReadAPI.paymentsSummary(),
        opsReadAPI.paymentsLedger({ page: 1, limit: 20 }),
        opsReadAPI.payoutsList({ page: 1, limit: 20 }),
        opsReadAPI.payoutReconciliationSummary()
      ]);
      setSummary(s.data?.data || null);
      setLedger(l.data?.data?.items || []);
      setPayouts(p.data?.data?.items || []);
      setReconciliation(r.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load payments module');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadPayoutDetail = async (id) => {
    setSelectedPayoutId(id);
    setDetailError('');
    setDetailLoading(true);
    try {
      const detail = await opsReadAPI.payoutDetail(id);
      setSelectedPayout(detail.data?.data || null);
    } catch (err) {
      setDetailError(err?.response?.data?.message || 'Failed to load payout detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const failedDisputed = (summary?.totals?.failed ?? 0) + (summary?.totals?.disputed ?? 0);
  const showDetailPanel = Boolean(selectedPayout || detailLoading || detailError);

  return (
    <OpsPage width="wide" className="ops-payments-page">
      <OpsPageHeader
        title="Payments and payouts"
        meta={
          loading ? null : <p className="ops-payments-obs">{observabilityCopy(summary)}</p>
        }
      />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {loading ? (
        <OpsLoadingState label="Loading payments" />
      ) : error ? null : (
        <>
          <OpsSurface className="ops-payments-surface" aria-labelledby="ops-payments-summary">
            <OpsSurfaceHeader className="ops-payments-surface__head">
              <OpsSurfaceTitle id="ops-payments-summary" className="ops-payments-surface__title">
                Payment summary
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            <OpsMetricGroup>
              <OpsMetric label="Total payments" value={summary?.totals?.total ?? 0} />
              <OpsMetric label="Failed/disputed" value={failedDisputed} />
              <OpsMetric label="Unlinked payments" value={summary?.totals?.unlinked ?? 0} />
              <OpsMetric label="Unlinked payouts" value={reconciliation?.manualReview?.openUnlinkedPayouts ?? 0} />
            </OpsMetricGroup>
          </OpsSurface>

          <OpsSurface className="ops-payments-surface" aria-labelledby="ops-payments-recon">
            <OpsSurfaceHeader className="ops-payments-surface__head">
              <OpsSurfaceTitle id="ops-payments-recon" className="ops-payments-surface__title">
                Reconciliation summary
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            <OpsMetricGroup>
              <OpsMetric label="Total payouts" value={reconciliation?.totals?.totalPayouts ?? 0} />
              <OpsMetric
                label="With reservation reference"
                value={reconciliation?.totals?.withReservationReference ?? 0}
              />
              <OpsMetric label="Incomplete linkage" value={reconciliation?.totals?.incompleteLinkage ?? 0} />
            </OpsMetricGroup>
          </OpsSurface>

          <OpsSurface className="ops-payments-surface" aria-labelledby="ops-payments-recent">
            <OpsSurfaceHeader className="ops-payments-surface__head">
              <OpsSurfaceTitle id="ops-payments-recent" className="ops-payments-surface__title">
                Recent payments
              </OpsSurfaceTitle>
              <p className="ops-payments-cap">Latest {EVIDENCE_LIMIT}</p>
            </OpsSurfaceHeader>
            {ledger.length ? (
              <div className="ops-payments-list" role="list">
                {ledger.map((item) => (
                  <article key={item.paymentId} className="ops-payments-row" role="listitem">
                    <div className="ops-payments-row__head">
                      <p className="ops-payments-ref">{item.providerReference}</p>
                      <p className="ops-payments-amount">{formatLedgerAmount(item.amount, item.currency)}</p>
                    </div>
                    <div className="ops-payments-row__meta">
                      <OpsStatus domain="payment" value={item.status} />
                      <p className="ops-payments-linkage">{item.linkageState}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <OpsEmptyState className="ops-payments-empty" title="No payment evidence yet." />
            )}
          </OpsSurface>

          <OpsSurface className="ops-payments-surface" aria-labelledby="ops-payments-payouts">
            <OpsSurfaceHeader className="ops-payments-surface__head">
              <OpsSurfaceTitle id="ops-payments-payouts" className="ops-payments-surface__title">
                Recent payouts
              </OpsSurfaceTitle>
              <p className="ops-payments-cap">Latest {EVIDENCE_LIMIT}</p>
            </OpsSurfaceHeader>
            {payouts.length ? (
              <div className="ops-payments-list">
                {payouts.map((item) => {
                  const selected = selectedPayoutId === item.payoutId;
                  return (
                    <OpsButton
                      key={item.payoutId}
                      type="button"
                      variant="quiet"
                      className="ops-payments-payout"
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => loadPayoutDetail(item.payoutId)}
                    >
                      <div className="ops-payments-payout__head">
                        <p className="ops-payments-ref">{item.providerReference}</p>
                        <p className="ops-payments-amount">{formatLedgerAmount(item.amount, item.currency)}</p>
                      </div>
                      <p className="ops-payments-payout-status">{item.status}</p>
                    </OpsButton>
                  );
                })}
              </div>
            ) : (
              <OpsEmptyState className="ops-payments-empty" title="No payout evidence yet." />
            )}
          </OpsSurface>

          {showDetailPanel ? (
            <OpsSurface className="ops-payments-surface" aria-labelledby="ops-payments-detail">
              <OpsSurfaceHeader className="ops-payments-surface__head">
                <OpsSurfaceTitle id="ops-payments-detail" className="ops-payments-surface__title">
                  Payout detail
                </OpsSurfaceTitle>
              </OpsSurfaceHeader>
              {detailError ? <OpsInlineError>{detailError}</OpsInlineError> : null}
              {detailLoading ? <OpsLoadingState label="Loading payout detail" /> : null}
              {selectedPayout ? (
                <div className="ops-payments-detail">
                  <p className="ops-payments-detail__row">Status: {selectedPayout.payout?.status}</p>
                  <p className="ops-payments-detail__row">
                    Amount: {formatLedgerAmount(selectedPayout.payout?.amount, selectedPayout.payout?.currency)}
                  </p>
                  <p className="ops-payments-detail__row">Linkage: {selectedPayout.reconciliation?.linkageState}</p>
                  {selectedPayout.degraded?.linkageIncomplete ? (
                    <OpsBanner
                      tone="warning"
                      body="Degraded: payout is not linked to a reservation yet."
                    />
                  ) : null}
                </div>
              ) : null}
            </OpsSurface>
          ) : null}
        </>
      )}
    </OpsPage>
  );
}
