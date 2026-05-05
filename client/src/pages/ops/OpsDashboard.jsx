import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

const secondaryMetricKeys = [
  { key: 'failedEmails', label: 'Failed emails' },
  { key: 'upcomingPayouts', label: 'Upcoming payouts' },
  { key: 'syncWarnings', label: 'Sync warnings' },
  { key: 'pendingActions', label: 'Manual review open' }
];

function paymentStatusLabel(status) {
  const labels = {
    paid: 'paid',
    partial: 'partial',
    failed: 'failed',
    disputed: 'disputed',
    refunded: 'refunded',
    unpaid: 'unpaid',
    pending_verification: 'pending verification',
    manual_not_required: 'manual / not required',
    unlinked_payment: 'unlinked payment',
    unknown: 'unknown'
  };
  return labels[status] || 'unknown';
}

function badgeToneClass(label) {
  const lower = String(label || '').toLowerCase();
  if (lower.includes('payment attention') || lower.includes('cancelled + paid')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (lower.includes('refund')) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (lower.includes('arriving')) return 'border-sky-200 bg-sky-50 text-sky-700';
  if (lower.includes('currently staying')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (lower.includes('cancelled')) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (lower.includes('paid') || lower.includes('refunded')) return 'border-violet-200 bg-violet-50 text-violet-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function ReservationSection({ title, rows = [], emptyText }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 text-gray-700">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link
              key={row.reservationId}
              to={row.detailPath || `/ops/reservations/${row.reservationId}`}
              className="block border border-gray-200 rounded-lg p-3 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{row.guestName || 'Guest'}</p>
                  <p className="text-xs text-gray-500 truncate">{row.guestEmail || 'No guest email'}</p>
                </div>
                <p className="text-[11px] text-gray-500 font-mono">#{String(row.reservationId || '').slice(-8)}</p>
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-gray-600">
                <p>
                  <span className="text-gray-500">Accommodation:</span> <span className="text-gray-700">{row.accommodationDisplayName || 'Unknown'}</span>
                </p>
                <p>
                  <span className="text-gray-500">Dates:</span> <span className="text-gray-700">{row.checkInDateOnly || '—'} - {row.checkOutDateOnly || '—'}</span>
                </p>
                <p>
                  <span className="text-gray-500">Guests:</span>{' '}
                  <span className="text-gray-700">{row.adults ?? 0}A{(row.children ?? 0) > 0 ? ` ${(row.children ?? 0)}C` : ''}</span>
                </p>
                <p>
                  <span className="text-gray-500">Source:</span> <span className="text-gray-700">{row.source || '—'}</span>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{row.reservationStatus || 'unknown'}</span>
                <span className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50">{paymentStatusLabel(row.paymentStatus)}</span>
                {(row.badges || []).map((badge) => (
                  <span key={badge} className={`text-xs px-2 py-1 rounded border ${badgeToneClass(badge)}`}>
                    {badge}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

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
            <p className="text-sm text-gray-500">Who arrives, stays, leaves, and needs attention.</p>
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

      <section className="grid grid-cols-2 lg:grid-cols-6 gap-2">
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Action needed</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.actionNeeded ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Arrivals today</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.arrivalsToday ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">In house</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.inHouse ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Checking out today</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.departuresToday ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Upcoming 7 days</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.upcoming7Days ?? 0}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500">Cancelled / refund pending</div>
          <div className="mt-1 text-xl font-semibold text-gray-900">{data.aggregates?.cancelledRefundPending ?? 0}</div>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Health & context</h3>
            <p className="text-sm text-gray-600 mt-1">In-house guests: {data.occupancySnapshot?.value?.inHouse ?? 0}</p>
            <p className="text-xs text-gray-500 mt-1">Last sync: {data.sync?.lastSyncAt ? String(data.sync.lastSyncAt).slice(0, 19) : '—'}</p>
          </div>
          <div>
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
            <Link to="/ops/sync" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
              Sync
            </Link>
          </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <ReservationSection
          title="Action needed"
          rows={data.sections?.actionNeeded || []}
          emptyText="No action needed."
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <ReservationSection
          title="Arrivals today"
          rows={data.sections?.arrivalsToday || []}
          emptyText="No arrivals today."
        />
        <ReservationSection
          title="In house"
          rows={data.sections?.inHouse || []}
          emptyText="No in-house stays."
        />
        <ReservationSection
          title="Checking out today"
          rows={data.sections?.checkingOutToday || []}
          emptyText="No check-outs today."
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <ReservationSection
          title="Upcoming 7 days"
          rows={data.sections?.upcoming7Days || []}
          emptyText="No upcoming arrivals in the next 7 days."
        />
        <ReservationSection
          title="Cancelled / refund pending"
          rows={data.sections?.cancelledRefundPending || []}
          emptyText="No cancelled reservations need refund follow-up."
        />
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {secondaryMetricKeys.map((m) => (
          <div key={m.key} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{m.label}</div>
            <div className="mt-1 text-lg font-semibold text-gray-700">{data.aggregates?.[m.key] ?? 0}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
