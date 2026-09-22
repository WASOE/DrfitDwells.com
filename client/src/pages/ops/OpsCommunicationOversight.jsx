import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import OpsSurface, { OpsSurfaceHeader, OpsSurfaceTitle } from '../../ops/primitives/OpsSurface';
import './OpsCommunicationOversight.css';

function workerLabel(delivery) {
  if (delivery?.workerRunning) return 'Running';
  if (delivery?.workerEnabled) return 'Enabled (not running)';
  return 'Disabled';
}

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function isFailedEvent(evt) {
  const type = String(evt?.type || '').toLowerCase();
  return type.includes('fail') || type.includes('bounce') || type.includes('error');
}

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

  const recent = data?.recent || [];
  const failedAmbiguous =
    (data?.summary?.confirmationFailed ?? 0) + (data?.summary?.confirmationAmbiguous ?? 0);

  return (
    <OpsPage width="wide" className="ops-comms-page">
      <OpsPageHeader title="Communications" description="Email delivery evidence (read-only)." />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {loading ? (
        <OpsLoadingState label="Loading communication oversight" />
      ) : error ? null : !data ? (
        <OpsEmptyState title="No communication data." />
      ) : (
        <>
          {data.degraded?.eventTrackingGapsPossible ? (
            <OpsBanner tone="warning" body="Degraded: email tracking gaps may exist." />
          ) : null}
          {data.degraded?.overdueConfirmationBacklog ? (
            <OpsBanner
              tone="warning"
              body="Unhealthy: overdue booking confirmation states are waiting for the confirmation worker."
            />
          ) : null}

          <OpsSurface className="ops-comms-surface" aria-labelledby="ops-comms-delivery">
            <OpsSurfaceHeader className="ops-comms-surface__head">
              <OpsSurfaceTitle id="ops-comms-delivery" className="ops-comms-surface__title">
                Delivery overview
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            <OpsMetricGroup>
              <OpsMetric label="Failed events" value={data.summary?.failedEvents ?? 0} />
              <OpsMetric label="Total recent" value={data.summary?.totalRecentEvents ?? 0} />
              <OpsMetric label="Gaps possible" value={yesNo(data.degraded?.eventTrackingGapsPossible)} />
            </OpsMetricGroup>
          </OpsSurface>

          <OpsSurface className="ops-comms-surface" aria-labelledby="ops-comms-confirmation">
            <OpsSurfaceHeader className="ops-comms-surface__head">
              <OpsSurfaceTitle id="ops-comms-confirmation" className="ops-comms-surface__title">
                Booking confirmation delivery
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            <p className="ops-comms-note">
              SMTP credentials alone do not mean confirmations are draining. Overdue pending rows require the
              confirmation worker.
            </p>
            <OpsMetricGroup>
              <OpsMetric label="SMTP configured" value={yesNo(data.confirmationDelivery?.smtpConfigured)} />
              <OpsMetric label="Worker" value={workerLabel(data.confirmationDelivery)} />
              <OpsMetric label="Overdue pending" value={data.summary?.confirmationPendingDue ?? 0} />
              <OpsMetric label="Failed / ambiguous" value={failedAmbiguous} />
            </OpsMetricGroup>
            <p className="ops-comms-health">
              Health: {data.confirmationDelivery?.deliveryHealth || 'unknown'}
              {data.confirmationDelivery?.worker?.workerId
                ? ` · workerId ${data.confirmationDelivery.worker.workerId}`
                : ''}
            </p>
          </OpsSurface>

          <OpsSurface className="ops-comms-surface" aria-labelledby="ops-comms-events">
            <OpsSurfaceHeader className="ops-comms-surface__head">
              <OpsSurfaceTitle id="ops-comms-events" className="ops-comms-surface__title">
                Recent email events
              </OpsSurfaceTitle>
            </OpsSurfaceHeader>
            {recent.length ? (
              <div className="ops-comms-list" role="list">
                {recent.map((evt) => (
                  <article
                    key={evt.eventId}
                    className={`ops-comms-event${isFailedEvent(evt) ? ' ops-comms-event--failed' : ''}`}
                    role="listitem"
                  >
                    <p className="ops-comms-event__title">{evt.type || 'unknown'}</p>
                    <p className="ops-comms-event__meta">
                      to: {evt.recipient || '—'} · bookingId: {evt.bookingId || '—'}
                    </p>
                    <p className="ops-comms-event__time">{String(evt.happenedAt).slice(0, 10)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <OpsEmptyState className="ops-comms-empty" title="No recent events." />
            )}
          </OpsSurface>
        </>
      )}
    </OpsPage>
  );
}
