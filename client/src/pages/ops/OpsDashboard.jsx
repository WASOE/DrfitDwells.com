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
  if (lower.includes('payment attention') || lower.includes('cancelled + paid') || lower.includes('failed/disputed')) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (lower.includes('refund') || lower.includes('pending verification') || lower.includes('unlinked')) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (lower.includes('arriving')) return 'border-sky-200 bg-sky-50 text-sky-700';
  if (lower.includes('currently staying')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (lower.includes('cancelled') || lower.includes('unpaid')) return 'border-rose-200 bg-rose-50 text-rose-700';
  if (lower.includes('paid') || lower.includes('refunded')) return 'border-violet-200 bg-violet-50 text-violet-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function ReservationRow({ row }) {
  return (
    <Link
      key={row.reservationId}
      to={row.detailPath || `/ops/reservations/${row.reservationId}`}
      className="block border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{row.guestName || 'Guest'}</p>
          <p className="text-xs text-gray-500 truncate">{row.accommodationDisplayName || 'Unknown'}</p>
        </div>
        <p className="text-[11px] text-gray-500 font-mono">#{String(row.reservationId || '').slice(-8)}</p>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        {row.checkInDateOnly || '—'} - {row.checkOutDateOnly || '—'} · {row.adults ?? 0}A
        {(row.children ?? 0) > 0 ? ` ${(row.children ?? 0)}C` : ''}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50">{row.reservationStatus || 'unknown'}</span>
        <span className="text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50">{paymentStatusLabel(row.paymentStatus)}</span>
        {(row.badges || [])
          .filter((badge) => /attention|refund|failed|unlinked|unpaid|cancelled \+ paid|pending verification/i.test(badge))
          .map((badge) => (
            <span key={badge} className={`text-xs px-2 py-0.5 rounded border ${badgeToneClass(badge)}`}>
              {badge}
            </span>
          ))}
      </div>
    </Link>
  );
}

function MiniColumn({ title, rows = [], emptyText }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? <p className="text-xs text-gray-500">{emptyText}</p> : rows.map((row) => <ReservationRow key={row.reservationId} row={row} />)}
    </div>
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
            <h2 className="text-lg font-semibold text-gray-900">Today</h2>
            <p className="text-sm text-gray-500">Who arrives, stays, leaves, and what needs attention.</p>
          </div>
          {data.freshness?.degraded || data.freshness?.isStale ? (
            <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700">
              Degraded
            </span>
          ) : (
            <span className="text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700">Healthy</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/ops/reservations" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Reservations
          </Link>
          <Link to="/ops/calendar" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Calendar
          </Link>
          <Link to="/ops/sync" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Sync
          </Link>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Needs attention</h3>
        {(data.sections?.actionNeeded || []).length === 0 ? (
          <p className="text-sm text-gray-500">No action needed.</p>
        ) : (
          <div className="space-y-2">
            {(data.sections?.actionNeeded || []).map((row) => (
              <ReservationRow key={row.reservationId} row={row} />
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <MiniColumn
          title="Arriving today"
          rows={data.sections?.arrivalsToday || []}
          emptyText="No arrivals today."
        />
        <MiniColumn
          title="Staying now"
          rows={data.sections?.inHouse || []}
          emptyText="No in-house stays now."
        />
        <MiniColumn
          title="Leaving today"
          rows={data.sections?.checkingOutToday || []}
          emptyText="No departures today."
        />
      </section>

      {(data.sections?.upcoming7Days || []).length > 0 ? (
        <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Upcoming 7 days</h3>
            <span className="text-xs text-gray-500">{(data.sections?.upcoming7Days || []).length}</span>
          </div>
          <div className="space-y-2">
            {(data.sections?.upcoming7Days || []).map((row) => (
              <ReservationRow key={row.reservationId} row={row} />
            ))}
          </div>
        </section>
      ) : (
        <p className="text-sm text-gray-500">No upcoming arrivals in the next 7 days.</p>
      )}

      <section className="text-xs text-gray-500 border-t border-gray-200 pt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {secondaryMetricKeys.map((m) => (
          <span key={m.key}>
            {m.label}: <span className="text-gray-700">{data.aggregates?.[m.key] ?? 0}</span>
          </span>
        ))}
        {Number(data.aggregates?.syncWarnings || 0) > 0 ? (
          <Link to="/ops/sync" className="underline underline-offset-2 text-[#81887A] hover:text-[#707668]">
            Review sync warnings
          </Link>
        ) : null}
      </section>
    </div>
  );
}
