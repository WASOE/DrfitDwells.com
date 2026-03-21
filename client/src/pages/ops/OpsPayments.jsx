import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';

export default function OpsPayments() {
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [reconciliation, setReconciliation] = useState(null);
  const [selectedPayout, setSelectedPayout] = useState(null);
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
    try {
      const detail = await opsReadAPI.payoutDetail(id);
      setSelectedPayout(detail.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load payout detail');
    }
  };

  if (loading) return <div className="text-sm text-gray-500">Loading payments...</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Payments and payouts</h2>
        {summary?.observability ? (
          <p className="text-xs text-gray-500 mt-1">
            Webhook last seen:{' '}
            {summary.observability.webhookLastSeenAt ? String(summary.observability.webhookLastSeenAt) : 'unknown'} | open reconciliation items:{' '}
            {summary.observability.openReconciliationItems ?? 0}
          </p>
        ) : (
          <p className="text-xs text-gray-500 mt-1">Webhook evidence: unknown</p>
        )}
        {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Total payments</p>
          <p className="text-2xl font-semibold text-gray-900">{summary?.totals?.total ?? 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Failed/disputed</p>
          <p className="text-2xl font-semibold text-gray-900">
            {(summary?.totals?.failed ?? 0) + (summary?.totals?.disputed ?? 0)}
          </p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Unlinked payments</p>
          <p className="text-2xl font-semibold text-gray-900">{summary?.totals?.unlinked ?? 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 uppercase">Unlinked payouts</p>
          <p className="text-2xl font-semibold text-gray-900">{reconciliation?.manualReview?.openUnlinkedPayouts ?? 0}</p>
        </div>
      </section>

      {reconciliation ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Reconciliation summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-xs text-gray-500">Total payouts</div>
              <div className="text-lg font-semibold text-gray-900">{reconciliation.totals?.totalPayouts ?? 0}</div>
            </div>
            <div className="border border-gray-200 rounded-lg p-3">
              <div className="text-xs text-gray-500">With reservation reference</div>
              <div className="text-lg font-semibold text-gray-900">{reconciliation.totals?.withReservationReference ?? 0}</div>
            </div>
            <div className="border border-red-200 rounded-lg p-3">
              <div className="text-xs text-red-700">Incomplete linkage</div>
              <div className="text-lg font-semibold text-red-800">{reconciliation.totals?.incompleteLinkage ?? 0}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Payment ledger</h3>
        <div className="space-y-2">
          {ledger.map((item) => (
            <div key={item.paymentId} className="border border-gray-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="text-sm font-medium text-gray-900">{item.providerReference}</div>
              <div className="text-xs text-gray-600">{item.amount} {item.currency}</div>
              <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{item.status}</span>
              <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{item.linkageState}</span>
            </div>
          ))}
          {ledger.length === 0 ? <p className="text-sm text-gray-500">No payment evidence yet.</p> : null}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Payouts</h3>
        <div className="space-y-2">
          {payouts.map((item) => (
            <button
              key={item.payoutId}
              onClick={() => loadPayoutDetail(item.payoutId)}
              className="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-gray-50"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-900">{item.providerReference}</span>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{item.status}</span>
                <span className="text-xs text-gray-600">{item.amount} {item.currency}</span>
              </div>
            </button>
          ))}
          {payouts.length === 0 ? <p className="text-sm text-gray-500">No payout evidence yet.</p> : null}
        </div>
      </section>

      {selectedPayout ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Payout detail</h3>
          <p className="text-sm text-gray-700 mt-2">Status: {selectedPayout.payout?.status}</p>
          <p className="text-sm text-gray-700">Amount: {selectedPayout.payout?.amount} {selectedPayout.payout?.currency}</p>
          <p className="text-sm text-gray-700">Linkage: {selectedPayout.reconciliation?.linkageState}</p>
          {selectedPayout.degraded?.linkageIncomplete ? (
            <p className="text-sm text-amber-700 mt-1">Degraded: payout is not linked to a reservation yet.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
