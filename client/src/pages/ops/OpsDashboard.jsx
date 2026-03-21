import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

const metricKeys = [
  { key: 'arrivalsToday', label: 'Arrivals today' },
  { key: 'departuresToday', label: 'Departures today' },
  { key: 'inHouse', label: 'In house' },
  { key: 'pendingActions', label: 'Pending actions' },
  { key: 'failedPayments', label: 'Failed payments' },
  { key: 'failedEmails', label: 'Failed emails' },
  { key: 'upcomingPayouts', label: 'Upcoming payouts' },
  { key: 'syncWarnings', label: 'Sync warnings' }
];

export default function OpsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.dashboard();
        if (!cancelled) setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load dashboard');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading dashboard...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No dashboard data.</div>;

  return (
    <div className="space-y-5 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Today&apos;s operations</h2>
            <p className="text-sm text-gray-500">Real-time operator summary</p>
          </div>
          {data.freshness?.degraded || data.freshness?.isStale ? (
            <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700">
              Degraded
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">Healthy</span>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {metricKeys.map((m) => (
          <div key={m.key} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{m.label}</div>
            <div className="mt-1 text-2xl font-semibold text-gray-900">{data.aggregates?.[m.key] ?? 0}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Occupancy snapshot</h3>
          <p className="text-sm text-gray-600 mt-1">In-house guests: {data.occupancySnapshot?.value?.inHouse ?? 0}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-900">Quick actions</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Link to="/ops/reservations" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Reservations
            </Link>
            <Link to="/ops/calendar" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Calendar
            </Link>
            <Link to="/ops/cabins" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Cabins
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
