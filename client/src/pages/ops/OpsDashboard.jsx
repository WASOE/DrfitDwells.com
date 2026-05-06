import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';

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

function alertTone(severity) {
  if (severity === 'critical') return 'border-rose-200 bg-rose-50 text-rose-800';
  if (severity === 'high') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}

function ReservationRow({ row }) {
  const paymentStatus = paymentStatusLabel(row.paymentStatus);
  return (
    <Link
      key={row.reservationId}
      to={row.href || `/ops/reservations/${row.reservationId}`}
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
        {row.datesLabel || `${row.checkInDateOnly || '—'} - ${row.checkOutDateOnly || '—'}`} · {row.guestsLabel || '—'}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <span className="text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50">{row.reservationStatus || row.statusLabel || 'unknown'}</span>
        <span className="text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50">{paymentStatus}</span>
        {row.statusLabel && row.statusLabel !== row.reservationStatus ? (
          <span className="text-xs px-2 py-0.5 rounded border border-sky-200 bg-sky-50 text-sky-700">{row.statusLabel}</span>
        ) : null}
      </div>
    </Link>
  );
}

function Lane({ title, total = 0, rows = [], emptyText }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <span className="text-xs text-gray-500">{total}</span>
      </div>
      {rows.length === 0 ? <p className="text-xs text-gray-500">{emptyText}</p> : rows.map((row) => <ReservationRow key={row.reservationId} row={row} />)}
      {total > rows.length ? <p className="text-xs text-gray-500">+{total - rows.length} more</p> : null}
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
  const d = data.dashboard || data?.data?.dashboard || {};
  const hasDashboardAlerts = Array.isArray(d.alerts);
  const criticalAlerts = hasDashboardAlerts
    ? d.alerts
    : Array.isArray(data.sections?.actionNeeded)
      ? data.sections.actionNeeded
      : [];

  return (
    <div className="space-y-5 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">OPS Dashboard</h2>
            <p className="text-sm text-gray-500">Who arrives, stays, leaves, and what needs attention.</p>
          </div>
          {d.health?.status === 'degraded' || d.health?.status === 'warning' || data.freshness?.degraded || data.freshness?.isStale ? (
            <span className="text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700">
              {d.health?.status === 'warning' ? 'Watch' : 'Degraded'}
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
          <Link to="/ops/payments" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Payments
          </Link>
          <Link to="/ops/sync" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Sync
          </Link>
          <Link to="/ops/communications/oversight" className="px-3 py-1.5 text-sm rounded border border-gray-200 hover:bg-gray-50">
            Comms
          </Link>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <h3 className="text-sm font-semibold text-gray-900">Critical alerts</h3>
        {criticalAlerts.length === 0 ? (
          <p className="text-sm text-gray-500">No critical alerts.</p>
        ) : (
          <div className="space-y-2">
            {criticalAlerts.map((alert) => (
              <Link
                key={alert.id}
                to={alert.href || '/ops/reservations'}
                className={`block border rounded-lg px-3 py-2 ${alertTone(alert.severity)}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold truncate">{alert.title}</p>
                  <span className="text-[11px] uppercase tracking-wide">{alert.severity || 'low'}</span>
                </div>
                <p className="text-xs mt-1 line-clamp-2">{alert.detail}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Lane
          title="Arriving today"
          total={d.today?.arriving?.total || 0}
          rows={d.today?.arriving?.rows || []}
          emptyText="No arrivals today."
        />
        <Lane
          title="Staying now"
          total={d.today?.staying?.total || 0}
          rows={d.today?.staying?.rows || []}
          emptyText="No in-house stays now."
        />
        <Lane
          title="Leaving today"
          total={d.today?.leaving?.total || 0}
          rows={d.today?.leaving?.rows || []}
          emptyText="No departures today."
        />
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Upcoming operations</h3>
          <span className="text-xs text-gray-500">Next 14 days: {d.upcoming?.next14DaysArrivalCount || 0}</span>
        </div>
        {(d.upcoming?.nextArrivals || []).length > 0 ? (
          <div className="space-y-2">
            {(d.upcoming?.nextArrivals || []).map((row) => (
              <ReservationRow key={row.reservationId} row={row} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">No upcoming arrivals.</p>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Business pulse</h3>
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 text-xs">
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Bookings MTD</p>
            <p className="text-sm font-semibold text-gray-900">{d.pulse?.bookingsMTD ?? 0}</p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Booking value MTD</p>
            <p className="text-sm font-semibold text-gray-900">€{Number(d.pulse?.bookingValueMTD || 0).toFixed(0)}</p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Paid active</p>
            <p className="text-sm font-semibold text-gray-900">{d.pulse?.activePaidCount ?? 0}</p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Open payment active</p>
            <p className="text-sm font-semibold text-gray-900">{d.pulse?.activeUnpaidCount ?? 0}</p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Cancellations MTD</p>
            <p className="text-sm font-semibold text-gray-900">{d.pulse?.cancellationsMTD ?? 0}</p>
          </div>
          <div className="rounded border border-gray-200 bg-gray-50 px-2 py-2">
            <p className="text-gray-500">Refunds MTD</p>
            <p className="text-sm font-semibold text-gray-900">{d.pulse?.refundsMTD ?? 0}</p>
          </div>
        </div>
      </section>

      <section className="text-xs text-gray-500 border-t border-gray-200 pt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span>
          Sync: <span className="text-gray-700">{d.health?.sync?.lastOutcome || 'unknown'}</span>
        </span>
        <span>
          Email failures (14d): <span className="text-gray-700">{d.health?.email?.recentFailuresCount ?? 0}</span>
        </span>
        <span>
          Manual review open: <span className="text-gray-700">{d.health?.manualReview?.openCount ?? 0}</span>
        </span>
        <span>
          Webhook last seen: <span className="text-gray-700">{d.health?.payments?.webhookLastSeenAt ? String(d.health.payments.webhookLastSeenAt).slice(0, 19) : '—'}</span>
        </span>
        <Link to={d.health?.sync?.href || '/ops/sync'} className="underline underline-offset-2 text-[#81887A] hover:text-[#707668]">
          Sync
        </Link>
        <Link to={d.health?.email?.href || '/ops/communications/oversight'} className="underline underline-offset-2 text-[#81887A] hover:text-[#707668]">
          Comms
        </Link>
        <Link to={d.health?.payments?.href || '/ops/payments'} className="underline underline-offset-2 text-[#81887A] hover:text-[#707668]">
          Payments
        </Link>
        <Link to={d.health?.manualReview?.href || '/ops/manual-review'} className="underline underline-offset-2 text-[#81887A] hover:text-[#707668]">
          Manual review
        </Link>
      </section>
    </div>
  );
}
