import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';
import OpsPage from '../../ops/primitives/OpsPage';
import OpsPageHeader from '../../ops/primitives/OpsPageHeader';
import OpsStatus from '../../ops/primitives/OpsStatus';
import OpsBanner from '../../ops/primitives/OpsBanner';
import OpsLoadingState from '../../ops/primitives/OpsLoadingState';
import OpsEmptyState from '../../ops/primitives/OpsEmptyState';
import OpsMetric, { OpsMetricGroup } from '../../ops/primitives/OpsMetric';
import './OpsSyncCenter.css';

function syncRowStatusValue(row) {
  if (row.lastSyncOutcome === 'failed') return 'failed';
  if (row.stale) return 'stale';
  return row.syncStatus || 'stale';
}

function formatLastSyncedAt(value) {
  return value ? String(value).slice(0, 10) : 'n/a';
}

export default function OpsSyncCenter() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const resp = await opsReadAPI.sync({});
        if (cancelled) return;
        setData(resp.data?.data || null);
      } catch (err) {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load sync center');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const healthRows = data?.healthByCabinChannel || [];
  const recentEvents = data?.recentEvents || [];
  const staleCount = healthRows.filter((row) => row.stale).length;
  const failedCount = healthRows.filter((row) => row.lastSyncOutcome === 'failed').length;
  const totalUnresolved = healthRows.reduce((acc, row) => acc + (row.unresolvedAnomalies || 0), 0);
  const duplicateImportCount = recentEvents.filter((event) => event.anomalyType === 'sync_duplicate_import').length;

  return (
    <OpsPage width="default" className="ops-sync-page">
      <OpsPageHeader title="Sync" description="External holds and sync health (real evidence)." />

      {error ? <OpsBanner tone="danger" body={error} /> : null}

      {loading ? (
        <OpsLoadingState label="Loading sync center" />
      ) : error ? null : !data ? (
        <OpsEmptyState title="No sync data." />
      ) : (
        <>
          <section className="ops-sync-section" aria-labelledby="ops-sync-anomalies">
            <h2 id="ops-sync-anomalies" className="ops-sync-section__title">
              Anomalies & manual review
            </h2>
            <OpsMetricGroup>
              <OpsMetric label="Stale pairs" value={staleCount} />
              <OpsMetric label="Failed pairs" value={failedCount} />
              <OpsMetric label="Unresolved anomalies" value={totalUnresolved} />
            </OpsMetricGroup>
            <p className="ops-sync-note">
              Open sync-related manual reviews: {data.aggregates?.unresolvedSyncManualReviews ?? 0} · duplicate-import anomalies in recent events: {duplicateImportCount}
            </p>
          </section>

          <section className="ops-sync-section" aria-labelledby="ops-sync-health">
            <h2 id="ops-sync-health" className="ops-sync-section__title">
              Health by cabin + channel
            </h2>
            {healthRows.length ? (
              <div className="ops-sync-list" role="list">
                {healthRows.map((row) => {
                  const rowKey = `${row.cabinId}:${row.channel}:${row.unitId || ''}`;
                  return (
                    <article key={rowKey} className="ops-sync-row" role="listitem">
                      <div className="ops-sync-row__head">
                        <p className="ops-sync-row__title">Cabin {row.cabinId}</p>
                        <span className="ops-sync-row__status">
                          <OpsStatus domain="sync" value={syncRowStatusValue(row)} />
                        </span>
                      </div>
                      <p className="ops-sync-row__meta">
                        {row.channel}
                        {row.unitId ? (
                          <>
                            {' '}
                            · unit <span className="ops-sync-row__id">{row.unitId}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="ops-sync-row__time">lastSyncedAt: {formatLastSyncedAt(row.lastSyncedAt)}</p>
                    </article>
                  );
                })}
              </div>
            ) : (
              <OpsEmptyState title="No health rows yet." />
            )}
          </section>

          <section className="ops-sync-section" aria-labelledby="ops-sync-events">
            <h2 id="ops-sync-events" className="ops-sync-section__title">
              Recent sync events
            </h2>
            {recentEvents.length ? (
              <div className="ops-sync-list" role="list">
                {recentEvents.map((event) => (
                  <article key={event.eventId} className="ops-sync-event" role="listitem">
                    <p className="ops-sync-event__title">
                      {event.cabinId} · {event.channel}
                    </p>
                    <p className="ops-sync-event__meta">
                      outcome: {event.outcome} · at {String(event.runAt).slice(0, 19)}
                    </p>
                    {event.anomalyType ? (
                      <p className="ops-sync-event__anomaly">anomaly: {event.anomalyType}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <OpsEmptyState title="No recent sync events." />
            )}
          </section>
        </>
      )}
    </OpsPage>
  );
}
