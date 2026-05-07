import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

export default function OpsGiftVouchers() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      search: searchParams.get('search') || '',
      status: searchParams.get('status') || '',
      deliveryMode: searchParams.get('deliveryMode') || ''
    }),
    [searchParams]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''));
        const resp = await opsReadAPI.giftVouchers(params);
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load gift vouchers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, String(value));
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const resetFilters = () => setSearchParams(new URLSearchParams());

  if (loading) return <div className="text-sm text-gray-500">Loading gift vouchers...</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Gift vouchers</h2>
        <p className="text-sm text-gray-500 mt-1">Search and manage voucher lifecycle operations.</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <input
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search code, buyer, recipient, email"
            className="px-3 py-2 text-sm border rounded-lg sm:col-span-2 lg:col-span-2"
          />
          <select
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className="px-3 py-2 text-sm border rounded-lg"
          >
            <option value="">All status</option>
            <option value="pending_payment">Pending payment</option>
            <option value="active">Active</option>
            <option value="partially_redeemed">Partially redeemed</option>
            <option value="redeemed">Redeemed</option>
            <option value="expired">Expired</option>
            <option value="voided">Voided</option>
            <option value="refunded">Refunded</option>
          </select>
          <select
            value={filters.deliveryMode}
            onChange={(e) => updateFilter('deliveryMode', e.target.value)}
            className="px-3 py-2 text-sm border rounded-lg"
          >
            <option value="">All delivery modes</option>
            <option value="email">Email</option>
            <option value="postal">Postal</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-gray-600 hover:text-gray-900 underline underline-offset-2"
          >
            Reset filters
          </button>
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </section>

      <section className="space-y-2">
        {(data?.items || []).map((row) => (
          <Link
            key={row.giftVoucherId}
            to={`/ops/gift-vouchers/${row.giftVoucherId}`}
            className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-gray-50"
          >
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {row.code || 'Code pending'} · {row.status}
                </p>
                <p className="text-xs text-gray-500 truncate">
                  {row.buyerName || 'Unknown buyer'} ({row.buyerEmail || '—'}) → {row.recipientName || 'Unknown recipient'} ({row.recipientEmail || '—'})
                </p>
              </div>
              <div className="text-xs text-gray-600 flex items-center gap-2">
                <span className="px-2 py-1 border border-gray-200 rounded bg-gray-50">{row.deliveryMode}</span>
                <span className="px-2 py-1 border border-gray-200 rounded bg-gray-50">
                  Balance {row.balanceRemainingCents}/{row.amountOriginalCents} {row.currency}
                </span>
              </div>
            </div>
          </Link>
        ))}
        {(data?.items || []).length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-600">
            No gift vouchers match the current filters.
          </div>
        ) : null}
      </section>

      {data?.pagination?.totalPages > 1 ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateFilter('page', Math.max(1, Number(data.pagination.page) - 1))}
            disabled={Number(data.pagination.page) <= 1}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </span>
          <button
            type="button"
            onClick={() => updateFilter('page', Number(data.pagination.page) + 1)}
            disabled={Number(data.pagination.page) >= Number(data.pagination.totalPages)}
            className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}
