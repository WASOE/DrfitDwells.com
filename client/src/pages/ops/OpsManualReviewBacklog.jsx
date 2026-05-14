import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

function isMongoObjectIdString(value) {
  return typeof value === 'string' && /^[0-9a-fA-F]{24}$/.test(value);
}

/** For comms_* categories, link to OPS reservation when booking id is known. */
function resolveCommsReservationHref(item) {
  if (!item?.category || !String(item.category).startsWith('comms_')) return null;
  const fromEvidence = item.evidence?.bookingId;
  if (isMongoObjectIdString(fromEvidence)) return `/ops/reservations/${fromEvidence}`;
  if (item.entityType === 'booking' && isMongoObjectIdString(item.entityId)) {
    return `/ops/reservations/${item.entityId}`;
  }
  return null;
}

export default function OpsManualReviewBacklog() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.manualReview({ page: 1, limit: 50, status: 'open' });
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load manual review backlog');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-sm text-gray-500">Loading manual review backlog...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No manual review backlog data.</div>;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Manual review backlog</h2>
        <p className="text-sm text-gray-500 mt-1">Open operational items (read-only).</p>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Open items</h3>
        <div className="text-sm text-gray-600">
          {data.items?.length ? `${data.items.length} item(s)` : 'No open items'}
        </div>

        <div className="space-y-2">
          {(data.items || []).map((item) => {
            const reservationHref = resolveCommsReservationHref(item);
            return (
            <div key={item.manualReviewItemId} className="border border-gray-200 rounded-xl p-3">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{item.title || 'Untitled'}</div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    Category: {item.category || '—'} · Severity: {item.severity || '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 truncate">
                    Target: {item.entityType || '—'} · {item.entityId || '—'}
                  </div>
                  {reservationHref ? (
                    <div className="mt-2">
                      <Link
                        to={reservationHref}
                        className="text-xs text-[#81887A] underline underline-offset-2 font-medium"
                      >
                        Open reservation (guest message automation)
                      </Link>
                    </div>
                  ) : null}
                </div>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 self-start">
                  {item.status}
                </span>
              </div>

              {item.details ? <div className="text-sm text-gray-700 mt-2">{item.details}</div> : null}

              {item.provenance ? (
                <div className="text-xs text-gray-500 mt-2">
                  Provenance: {item.provenance.source || '—'} {item.provenance.sourceReference ? `(${item.provenance.sourceReference})` : ''}
                </div>
              ) : null}
            </div>
            );
          })}
          {(data.items || []).length === 0 ? (
            <div className="text-sm text-gray-500">Nothing to review right now.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

