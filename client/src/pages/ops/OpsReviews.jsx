import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';

export default function OpsReviews() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.reviews();
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load reviews');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading reviews...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No reviews data.</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Reviews moderation</h2>
        <p className="text-sm text-gray-500 mt-1">Operational visibility (read-only).</p>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Moderation summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Approved</div>
            <div className="text-xl font-semibold text-gray-900">{data.moderationSummary?.approved ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Pending</div>
            <div className="text-xl font-semibold text-gray-900">{data.moderationSummary?.pending ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Hidden</div>
            <div className="text-xl font-semibold text-gray-900">{data.moderationSummary?.hidden ?? 0}</div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Recent reviews</h3>
        <div className="mt-3 space-y-2">
          {(data.items || []).map((r) => (
            <div key={r.reviewId} className="border border-gray-200 rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">Review {r.reviewId}</div>
                  <div className="text-xs text-gray-500 truncate">Status: {r.status}</div>
                </div>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">
                  Rating: {r.rating ?? '—'}
                </span>
              </div>
            </div>
          ))}
          {(data.items || []).length === 0 ? <div className="text-sm text-gray-500">No reviews.</div> : null}
        </div>
      </section>
    </div>
  );
}
