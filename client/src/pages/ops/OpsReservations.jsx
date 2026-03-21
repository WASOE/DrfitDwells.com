import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

export default function OpsReservations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [cabins, setCabins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const filters = useMemo(
    () => ({
      page: searchParams.get('page') || 1,
      limit: searchParams.get('limit') || 20,
      status: searchParams.get('status') || '',
      cabinId: searchParams.get('cabinId') || '',
      source: searchParams.get('source') || '',
      paymentStatus: searchParams.get('paymentStatus') || '',
      arrivalStatus: searchParams.get('arrivalStatus') || '',
      dateFrom: searchParams.get('dateFrom') || '',
      dateTo: searchParams.get('dateTo') || '',
      search: searchParams.get('search') || ''
    }),
    [searchParams]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [resp, cabinsResp] = await Promise.all([
          opsReadAPI.reservations(Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== ''))),
          opsReadAPI.cabins()
        ]);
        if (!cancelled) {
          setData(resp.data?.data || null);
          setCabins(cabinsResp.data?.data?.items || []);
        }
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load reservations');
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

  if (loading) return <div className="text-sm text-gray-500">Loading reservations...</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Reservations workspace</h2>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="in_house">In house</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select value={filters.cabinId} onChange={(e) => updateFilter('cabinId', e.target.value)} className="px-3 py-2 text-sm border rounded-lg">
            <option value="">All cabins</option>
            {cabins.map((c) => (
              <option key={c.cabinId} value={c.cabinId}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={filters.paymentStatus}
            onChange={(e) => updateFilter('paymentStatus', e.target.value)}
            className="px-3 py-2 text-sm border rounded-lg"
          >
            <option value="">All payment status</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
          </select>
          <input
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder="Search guest/email"
            className="px-3 py-2 text-sm border rounded-lg"
          />
        </div>
        {error ? <div className="mt-2 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="space-y-2">
        {(data?.items || []).map((row) => (
          <Link key={row.reservationId} to={`/ops/reservations/${row.reservationId}`} className="block bg-white border border-gray-200 rounded-xl p-4 hover:bg-gray-50">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  {row.guestSummary?.firstName} {row.guestSummary?.lastName}
                </p>
                <p className="text-xs text-gray-500 truncate">{row.guestSummary?.email}</p>
              </div>
              <div className="text-xs text-gray-600">
                {String(row.dateRange?.startDate || '').slice(0, 10)} - {String(row.dateRange?.endDate || '').slice(0, 10)}
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{row.reservationStatus || 'unknown'}</span>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{row.paymentStatus || 'payment unknown'}</span>
                {row.conflict?.hasConflict ? (
                  <span className="text-xs px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700">Conflict</span>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
        {data?.items?.length === 0 ? <div className="text-sm text-gray-500">No reservations for current filters.</div> : null}
      </div>
    </div>
  );
}
