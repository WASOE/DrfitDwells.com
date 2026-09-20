import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { opsReadAPI } from '../../services/opsApi';
import { formatMoneyFromCents } from '../../utils/formatMoney';
import ManualReviewResolveAction from '../../components/ops/ManualReviewResolveAction';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBadge from '../../ops/primitives/OpsBadge';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import { resolveOpsStatus } from '../../ops/status/opsStatusRegistry';
import './OpsDashboard.css';

const COMMS_HREF = '/ops/communications';
const SEVERITY_LABELS = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

function paymentOpsValue(status) {
  if (!status) return 'unknown';
  if (status === 'unlinked_payment') return 'unlinked';
  return status;
}

function last8Id(reservationId) {
  return `#${String(reservationId || '').slice(-8)}`;
}

function humanSeverity(severity) {
  const key = String(severity || 'low').toLowerCase();
  return SEVERITY_LABELS[key] || 'Low';
}

function arrivingLaterDays(row) {
  const label = String(row?.statusLabel || '');
  const match = label.match(/^Arrives in (\d+) days?$/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isFinite(days) && days > 1 ? days : null;
}

function arrivingTimingValue(row) {
  const label = String(row?.statusLabel || '');
  const match = label.match(/^Arrives in (\d+) days?$/i);
  if (!match) return null;
  const days = Number(match[1]);
  if (!Number.isFinite(days)) return null;
  if (days === 0) return 'arriving_today';
  if (days === 1) return 'arriving_tomorrow';
  return null;
}

function ArrivingLaterStatus({ days }) {
  const entry = resolveOpsStatus('reservation', 'arriving_later');
  return (
    <span
      className={`ops-status ops-status--${entry.family || 'info'} ops-status--${entry.loudness || 'quiet'}`}
      data-ops-status-key={entry.key}
    >
      Arriving in {days} days
    </span>
  );
}

function alertStatusProps(alert) {
  const type = alert?.type;
  const severity = String(alert?.severity || '').toLowerCase();
  const detail = String(alert?.detail || '').toLowerCase();

  if (type === 'payment_failed') {
    return { domain: 'payment', value: detail.includes('disputed') ? 'disputed' : 'failed' };
  }
  if (type === 'payment_unlinked' || type === 'payment_link_audit') {
    return { domain: 'payment', value: 'unlinked' };
  }
  if (type === 'payment_pending_verification') {
    return { domain: 'payment', value: 'pending_verification' };
  }
  if (type === 'unpaid_upcoming') {
    return { domain: 'payment', value: 'unpaid' };
  }
  if (type === 'refund_follow_up') {
    return { domain: 'reservation', value: 'refund_pending' };
  }
  if (type === 'sync_issue') {
    return { domain: 'sync', value: severity === 'high' || severity === 'critical' ? 'failed' : 'warning' };
  }
  if (type === 'manual_review') {
    if (severity === 'critical') return { domain: 'manual_review', value: 'critical' };
    if (severity === 'high') return { domain: 'manual_review', value: 'high' };
    return { domain: 'manual_review', value: 'open' };
  }
  return null;
}

function syncStatusValue(outcome) {
  if (outcome === 'failed') return 'failed';
  if (outcome === 'warning') return 'warning';
  if (outcome === 'success') return 'healthy';
  return null;
}

function formatGrossBooked(value) {
  return `€${Number(value ?? 0).toFixed(0)}`;
}

function formatWebhookLastSeen(value) {
  if (!value) return '—';
  return String(value).slice(0, 19);
}

function pageHealthState(dashboard, freshness) {
  const attention =
    dashboard?.health?.status === 'degraded' ||
    dashboard?.health?.status === 'warning' ||
    freshness?.degraded ||
    freshness?.isStale;
  if (!attention) return { kind: 'healthy', label: 'Healthy' };
  return {
    kind: 'attention',
    label: dashboard?.health?.status === 'warning' ? 'Watch' : 'Degraded'
  };
}

function ReservationRow({ row }) {
  const laterDays = arrivingLaterDays(row);
  const timingValue = arrivingTimingValue(row);
  const showStatusLabel =
    Boolean(row.statusLabel) &&
    row.statusLabel !== row.reservationStatus &&
    laterDays == null &&
    timingValue == null;

  if (row.kind === 'external_hold') {
    return (
      <div className="ops-dashboard-row" data-ops-dashboard-row="hold">
        <div className="ops-dashboard-row__top">
          <div className="ops-dashboard-row__identity">
            <p className="ops-dashboard-row__guest">{row.guestName || 'Airbnb hold'}</p>
            <p className="ops-dashboard-row__cabin">{row.accommodationDisplayName || 'Unknown'}</p>
          </div>
          <OpsBadge>Airbnb</OpsBadge>
        </div>
        <p className="ops-dashboard-row__meta">
          {row.datesLabel || `${row.checkInDateOnly || '—'} - ${row.checkOutDateOnly || '—'}`}
        </p>
        {row.statusLabel ? (
          <div className="ops-dashboard-row__status">
            <OpsBadge>{row.statusLabel}</OpsBadge>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      to={row.href || `/ops/reservations/${row.reservationId}`}
      className="ops-dashboard-row"
      data-ops-dashboard-row="reservation"
    >
      <div className="ops-dashboard-row__top">
        <div className="ops-dashboard-row__identity">
          <p className="ops-dashboard-row__guest">{row.guestName || 'Guest'}</p>
          <p className="ops-dashboard-row__cabin">{row.accommodationDisplayName || 'Unknown'}</p>
        </div>
        <p className="ops-dashboard-row__id">{last8Id(row.reservationId)}</p>
      </div>
      <p className="ops-dashboard-row__meta">
        {row.datesLabel || `${row.checkInDateOnly || '—'} - ${row.checkOutDateOnly || '—'}`} · {row.guestsLabel || '—'}
      </p>
      <div className="ops-dashboard-row__status">
        <OpsStatus domain="reservation" value={row.reservationStatus || 'unknown'} />
        <OpsStatus domain="payment" value={paymentOpsValue(row.paymentStatus)} />
        {laterDays != null ? <ArrivingLaterStatus days={laterDays} /> : null}
        {timingValue ? <OpsStatus domain="reservation" value={timingValue} /> : null}
        {showStatusLabel ? <OpsBadge>{row.statusLabel}</OpsBadge> : null}
      </div>
    </Link>
  );
}

function Lane({ title, total = 0, rows = [], emptyText, testId }) {
  return (
    <div className="ops-dashboard-lane" data-testid={testId}>
      <div className="ops-dashboard-lane__head">
        <h3 className="ops-dashboard-lane__title">{title}</h3>
        <p className="ops-dashboard-lane__count">{total}</p>
      </div>
      {rows.length === 0 ? (
        <p className="ops-dashboard-empty">{emptyText}</p>
      ) : (
        <div className="ops-dashboard-rows">
          {rows.map((row) => (
            <ReservationRow key={row.reservationId || row.href || row.guestName} row={row} />
          ))}
        </div>
      )}
      {total > rows.length ? <p className="ops-dashboard-lane__more">+{total - rows.length} more</p> : null}
    </div>
  );
}

function AlertRow({ alert, onResolved }) {
  const status = alertStatusProps(alert);
  return (
    <div className="ops-dashboard-alert" data-testid="ops-dashboard-alert">
      <div className="ops-dashboard-alert__main">
        <Link to={alert.href || '/ops/reservations'} className="ops-dashboard-alert__copy">
          <p className="ops-dashboard-alert__title">{alert.title}</p>
          {alert.detail ? <p className="ops-dashboard-alert__detail">{alert.detail}</p> : null}
        </Link>
        <div className="ops-dashboard-alert__marks">
          <OpsBadge>{humanSeverity(alert.severity)}</OpsBadge>
          {status ? <OpsStatus domain={status.domain} value={status.value} /> : null}
        </div>
      </div>
      {alert.type === 'manual_review' && alert.manualReviewItemId ? (
        <div className="ops-dashboard-alert__action">
          <ManualReviewResolveAction manualReviewItemId={alert.manualReviewItemId} onResolved={onResolved} />
        </div>
      ) : null}
    </div>
  );
}

function DashboardHeader({ health }) {
  return (
    <OpsPageHeader
      title="Dashboard"
      description="Who arrives, stays, leaves, and what needs attention."
      meta={
        health?.kind === 'healthy' ? (
          <OpsBadge>{health.label}</OpsBadge>
        ) : null
      }
    />
  );
}

function QuickLinks() {
  return (
    <nav className="ops-dashboard-links" aria-label="Dashboard shortcuts">
      <Link className="ops-dashboard-links__link" to="/ops/reservations">
        Reservations
      </Link>
      <Link className="ops-dashboard-links__link" to="/ops/calendar">
        Calendar
      </Link>
      <Link className="ops-dashboard-links__link" to="/ops/payments">
        Payments
      </Link>
      <Link className="ops-dashboard-links__link" to="/ops/sync">
        Sync
      </Link>
      <Link className="ops-dashboard-links__link" to={COMMS_HREF}>
        Comms
      </Link>
    </nav>
  );
}

export default function OpsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await opsReadAPI.dashboard();
      setData(resp.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const d = data?.dashboard || data?.data?.dashboard || {};
  const health = !loading && !error && data ? pageHealthState(d, data.freshness) : null;
  const hasDashboardAlerts = Array.isArray(d.alerts);
  const criticalAlerts = hasDashboardAlerts
    ? d.alerts
    : Array.isArray(data?.sections?.actionNeeded)
      ? data.sections.actionNeeded
      : [];
  const syncValue = syncStatusValue(d.health?.sync?.lastOutcome);

  return (
    <OpsPage width="wide" className="ops-dashboard">
      <DashboardHeader health={health} />
      {health?.kind === 'attention' ? <OpsBanner tone="warning" title={health.label} /> : null}
      <QuickLinks />

      {loading ? (
        <OpsLoadingState label="Loading dashboard" />
      ) : error ? (
        <OpsBanner tone="danger" title={error} />
      ) : !data ? (
        <p className="ops-dashboard-missing">No dashboard data.</p>
      ) : (
        <>
          <section className="ops-dashboard-surface" data-testid="ops-dashboard-alerts">
            <h2 className="ops-dashboard-surface__title">Critical alerts</h2>
            {criticalAlerts.length === 0 ? (
              <p className="ops-dashboard-empty">No critical alerts.</p>
            ) : (
              <div className="ops-dashboard-alerts">
                {criticalAlerts.map((alert) => (
                  <AlertRow key={alert.id} alert={alert} onResolved={() => load()} />
                ))}
              </div>
            )}
          </section>

          <section className="ops-dashboard-surface" data-testid="ops-dashboard-today">
            <h2 className="ops-dashboard-surface__title">Today operations</h2>
            <div className="ops-dashboard-lanes">
              <Lane
                title="Arriving today"
                total={d.today?.arriving?.total || 0}
                rows={d.today?.arriving?.rows || []}
                emptyText="No arrivals today."
                testId="ops-dashboard-lane-arriving"
              />
              <Lane
                title="Staying now"
                total={d.today?.staying?.total || 0}
                rows={d.today?.staying?.rows || []}
                emptyText="No guests staying now."
                testId="ops-dashboard-lane-staying"
              />
              <Lane
                title="Leaving today"
                total={d.today?.leaving?.total || 0}
                rows={d.today?.leaving?.rows || []}
                emptyText="No departures today."
                testId="ops-dashboard-lane-leaving"
              />
            </div>
          </section>

          <section className="ops-dashboard-surface" data-testid="ops-dashboard-upcoming">
            <div className="ops-dashboard-surface__head">
              <h2 className="ops-dashboard-surface__title">Upcoming operations</h2>
              <p className="ops-dashboard-surface__meta">
                Next 14 days: {d.upcoming?.next14DaysArrivalCount || 0}
              </p>
            </div>
            {(d.upcoming?.nextArrivals || []).length > 0 ? (
              <div className="ops-dashboard-rows">
                {(d.upcoming?.nextArrivals || []).map((row) => (
                  <ReservationRow key={row.reservationId || row.href || row.guestName} row={row} />
                ))}
              </div>
            ) : (
              <p className="ops-dashboard-empty">No upcoming arrivals.</p>
            )}
          </section>

          <section className="ops-dashboard-surface" data-testid="ops-dashboard-pulse-stay">
            <h2 className="ops-dashboard-surface__title">Stay/business pulse</h2>
            <OpsMetricGroup>
              <OpsMetric label="Bookings MTD" value={d.pulse?.bookingsMTD ?? 0} />
              <OpsMetric
                label="Gross booked MTD"
                value={formatGrossBooked(d.pulse?.grossBookedMTD ?? d.pulse?.bookingValueMTD ?? 0)}
              />
              <OpsMetric label="Paid active stays" value={d.pulse?.activePaidCount ?? 0} />
              <OpsMetric label="Open payment active stays" value={d.pulse?.activeUnpaidCount ?? 0} />
              <OpsMetric label="Cancellations MTD" value={d.pulse?.cancellationsMTD ?? 0} />
              <OpsMetric label="Refunds MTD" value={d.pulse?.refundsMTD ?? 0} />
            </OpsMetricGroup>
          </section>

          <section className="ops-dashboard-surface" data-testid="ops-dashboard-pulse-cash">
            <h2 className="ops-dashboard-surface__title">Gift vouchers &amp; cash</h2>
            <OpsMetricGroup>
              <OpsMetric
                label="Gift voucher sales MTD"
                value={formatMoneyFromCents(d.pulse?.giftVouchers?.salesMTDCents ?? 0)}
              />
              <OpsMetric
                label="Voucher cash collected MTD"
                value={formatMoneyFromCents(d.pulse?.giftVouchers?.cashCollectedMTDCents ?? 0)}
              />
              <OpsMetric
                label="Physical card fees MTD"
                value={formatMoneyFromCents(d.pulse?.giftVouchers?.physicalCardFeesMTDCents ?? 0)}
              />
              <OpsMetric
                label="Voucher liability outstanding"
                value={formatMoneyFromCents(d.pulse?.giftVouchers?.liabilityOutstandingCents ?? 0)}
              />
              <OpsMetric
                label="Voucher redemptions MTD"
                value={formatMoneyFromCents(d.pulse?.giftVouchers?.redemptionsMTDCents ?? 0)}
              />
              <OpsMetric
                label="Total cash collected MTD"
                value={formatMoneyFromCents(d.pulse?.cashCollected?.totalCashCollectedMTDCents ?? 0)}
              />
            </OpsMetricGroup>
            <p className="ops-dashboard-note">
              Gift voucher sales are prepaid credit. Gross booked stays and cash collected are shown separately.
            </p>
          </section>

          <section className="ops-dashboard-surface" data-testid="ops-dashboard-health">
            <h2 className="ops-dashboard-surface__title">Health summary</h2>
            <div className="ops-dashboard-health">
              <div className="ops-dashboard-health__facts">
                <p className="ops-dashboard-health__fact">
                  <span className="ops-dashboard-health__label">Sync last outcome</span>
                  {syncValue ? (
                    <OpsStatus domain="sync" value={syncValue} />
                  ) : (
                    <span className="ops-dashboard-health__value">Unknown</span>
                  )}
                </p>
                <p className="ops-dashboard-health__fact">
                  <span className="ops-dashboard-health__label">Email failures (14d)</span>
                  <span className="ops-dashboard-health__value">{d.health?.email?.recentFailuresCount ?? 0}</span>
                </p>
                <p className="ops-dashboard-health__fact">
                  <span className="ops-dashboard-health__label">Manual review open</span>
                  <span className="ops-dashboard-health__value">{d.health?.manualReview?.openCount ?? 0}</span>
                </p>
                <p className="ops-dashboard-health__fact">
                  <span className="ops-dashboard-health__label">Webhook last seen</span>
                  <span className="ops-dashboard-health__value">
                    {formatWebhookLastSeen(d.health?.payments?.webhookLastSeenAt)}
                  </span>
                </p>
              </div>
              <div className="ops-dashboard-health__links">
                <Link className="ops-dashboard-health__link" to={d.health?.sync?.href || '/ops/sync'}>
                  Sync
                </Link>
                <Link className="ops-dashboard-health__link" to={d.health?.email?.href || COMMS_HREF}>
                  Comms
                </Link>
                <Link className="ops-dashboard-health__link" to={d.health?.payments?.href || '/ops/payments'}>
                  Payments
                </Link>
                <Link className="ops-dashboard-health__link" to={d.health?.manualReview?.href || '/ops/manual-review'}>
                  Manual review
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </OpsPage>
  );
}
