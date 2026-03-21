import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';

export default function OpsCommunicationOversight() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.communicationsOversight();
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load communication oversight');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading communication oversight...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No communication data.</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Communication oversight</h2>
        <p className="text-sm text-gray-500 mt-1">Email delivery evidence (read-only).</p>
        {data.degraded?.eventTrackingGapsPossible ? (
          <p className="text-sm text-amber-800 mt-2">Degraded: email tracking gaps may exist.</p>
        ) : null}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Failed events</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{data.summary?.failedEvents ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Total recent</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">{data.summary?.totalRecentEvents ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Gaps possible</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {data.degraded?.eventTrackingGapsPossible ? 'Yes' : 'No'}
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Recent email events</h3>
        <div className="mt-3 space-y-2">
          {(data.recent || []).map((evt) => (
            <div key={evt.eventId} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{evt.type || 'unknown'}</div>
                  <div className="text-xs text-gray-500 truncate">
                    to: {evt.recipient || '—'} · bookingId: {evt.bookingId || '—'}
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{String(evt.happenedAt).slice(0, 10)}</span>
              </div>
            </div>
          ))}
          {(data.recent || []).length === 0 ? <div className="text-sm text-gray-500">No recent events.</div> : null}
        </div>
      </section>
    </div>
  );
}
