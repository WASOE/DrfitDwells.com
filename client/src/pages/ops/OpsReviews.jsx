import { useCallback, useEffect, useState } from 'react';
import { opsReadAPI, opsWriteAPI } from '../../services/opsApi';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'hidden', label: 'Hidden' }
];

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  } catch {
    return '—';
  }
}

export default function OpsReviews() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [rowAction, setRowAction] = useState(null);
  const [banner, setBanner] = useState({ type: '', message: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setBanner({ type: '', message: '' });
    try {
      const params = { page: 1, limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (searchQ.trim()) params.q = searchQ.trim();
      const resp = await opsReadAPI.reviews(params);
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load reviews');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchQ]);

  useEffect(() => {
    load();
  }, [load]);

  const applySearch = () => {
    setSearchQ(searchInput);
  };

  const handleModeration = async (reviewId, status) => {
    const key = `${reviewId}:${status}`;
    setRowAction(key);
    setBanner({ type: '', message: '' });
    try {
      await opsWriteAPI.updateReviewStatus(reviewId, status);
      setBanner({ type: 'success', message: `Review ${status === 'approved' ? 'approved' : 'hidden'}.` });
      await load();
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error ||
        (err?.response?.status === 403 ? 'Not allowed (cutover or permissions).' : null) ||
        'Update failed';
      setBanner({ type: 'error', message: msg });
    } finally {
      setRowAction(null);
    }
  };

  if (loading && !data) {
    return <div className="text-sm text-gray-500 max-w-5xl mx-auto px-4 py-6">Loading reviews...</div>;
  }

  return (
    <div className="space-y-4 pb-16 sm:pb-0 max-w-5xl mx-auto px-4 py-6 md:py-8">
      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6">
        <h2 className="text-lg md:text-xl font-semibold text-gray-900">Reviews moderation</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Approve or hide guest reviews. Same rules as admin reviews (cabins stats refresh after status
          changes).
        </p>
      </section>

      {error ? (
        <div className="text-sm text-red-600 rounded-xl border border-red-200 bg-red-50 p-3">{error}</div>
      ) : null}

      {banner.message ? (
        <div
          className={`text-sm rounded-xl border p-3 ${
            banner.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Moderation summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Approved</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.approved ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Pending</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.pending ?? 0}</div>
          </div>
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Hidden</div>
            <div className="text-xl font-semibold text-gray-900">{data?.moderationSummary?.hidden ?? 0}</div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1 w-full md:max-w-xs">
            <label htmlFor="ops-review-status" className="text-xs font-medium text-gray-600">
              Status
            </label>
            <select
              id="ops-review-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 w-full md:max-w-xl">
            <div className="space-y-1 flex-1 min-w-0">
              <label htmlFor="ops-review-q" className="text-xs font-medium text-gray-600">
                Search text
              </label>
              <input
                id="ops-review-q"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                placeholder="Matches review or reviewer name"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={applySearch}
              className="shrink-0 h-[42px] px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 bg-gray-50 hover:bg-gray-100"
            >
              Search
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {data?.pagination?.total != null ? `${data.pagination.total} review(s)` : null}
            {loading ? ' · Refreshing…' : null}
          </span>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="text-blue-700 hover:underline disabled:opacity-50"
          >
            Reload
          </button>
        </div>

        <h3 className="text-sm font-semibold text-gray-900">Reviews</h3>
        <div className="mt-3 space-y-3">
          {(data?.items || []).map((r) => (
            <div key={r.reviewId} className="border border-gray-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold text-gray-900">{r.reviewerDisplay}</div>
                  <div className="text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                    {r.cabinName ? <span className="font-medium text-gray-700">{r.cabinName}</span> : null}
                    <span>Source: {r.source ?? '—'}</span>
                    <span>Date: {formatDate(r.createdAtSource)}</span>
                  </div>
                  <p className="text-sm text-gray-800 mt-2 whitespace-pre-wrap break-words max-w-3xl">
                    {r.textExcerpt || '—'}
                  </p>
                </div>
                <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2 shrink-0">
                  <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">
                    ★ {r.rating ?? '—'}
                  </span>
                  <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-900 capitalize">
                    {r.status}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
                <button
                  type="button"
                  disabled={rowAction !== null || loading || r.status === 'approved'}
                  onClick={() => handleModeration(r.reviewId, 'approved')}
                  className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rowAction === `${r.reviewId}:approved` ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  disabled={rowAction !== null || loading || r.status === 'hidden'}
                  onClick={() => handleModeration(r.reviewId, 'hidden')}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-400 text-gray-800 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {rowAction === `${r.reviewId}:hidden` ? 'Hiding…' : 'Hide'}
                </button>
              </div>
            </div>
          ))}
          {(data?.items || []).length === 0 ? (
            <div className="text-sm text-gray-500">No reviews for this filter{searchQ ? ' / search' : ''}.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
