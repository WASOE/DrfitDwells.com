import { useEffect, useState } from 'react';
import { opsReadAPI } from '../../services/opsApi';

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

  if (loading) return <div className="text-sm text-gray-500">Loading sync center...</div>;
  if (error) return <div className="text-sm text-red-600">{error}</div>;
  if (!data) return <div className="text-sm text-gray-500">No sync data.</div>;

  const staleCount = data.healthByCabinChannel?.filter((r) => r.stale).length || 0;
  const failedCount = data.healthByCabinChannel?.filter((r) => r.lastSyncOutcome === 'failed').length || 0;
  const totalUnresolved = data.healthByCabinChannel?.reduce((acc, r) => acc + (r.unresolvedAnomalies || 0), 0) || 0;
  const duplicateImportCount =
    data.recentEvents?.filter((e) => e.anomalyType === 'sync_duplicate_import').length || 0;

  return (
    <div className="space-y-4 pb-16 sm:pb-0">
      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-lg font-semibold text-gray-900">Sync Center</h2>
        <div className="mt-2 text-sm text-gray-500">
          External holds and sync health (real evidence).
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Health by cabin + channel</h3>
        {data.healthByCabinChannel?.length ? (
          <div className="divide-y divide-gray-100">
            {data.healthByCabinChannel.map((row) => {
              const isStale = row.stale;
              const statusColor = row.lastSyncOutcome === 'failed' ? 'text-red-700 bg-red-50 border-red-200' : isStale ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
              return (
                <div key={`${row.cabinId}:${row.channel}`} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">Cabin {row.cabinId}</div>
                    <div className="text-xs text-gray-500">{row.channel}</div>
                  </div>
                  <div className="ml-auto">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs border ${statusColor}`}>
                      {row.syncStatus || 'stale'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 sm:ml-auto">
                    lastSyncedAt: {row.lastSyncedAt ? String(row.lastSyncedAt).slice(0, 10) : 'n/a'}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-gray-500">No health rows yet.</div>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Recent sync events</h3>
        <div className="mt-3 divide-y divide-gray-100">
          {data.recentEvents?.length ? (
            data.recentEvents.map((e) => (
              <div key={e.eventId} className="py-2.5">
                <div className="text-sm text-gray-900">{e.cabinId} · {e.channel}</div>
                <div className="text-xs text-gray-500">
                  outcome: {e.outcome} · at {String(e.runAt).slice(0, 19)}
                </div>
                {e.anomalyType ? (
                  <div className="mt-1 text-xs">
                    <span className="inline-flex px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-800">
                      anomaly: {e.anomalyType}
                    </span>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-500">No recent sync events.</div>
          )}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-gray-900">Anomalies & manual review</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
          <div className="border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">Stale pairs</div>
            <div className="mt-1 text-lg font-semibold text-gray-900">{staleCount}</div>
          </div>
          <div className="border border-red-200 rounded-xl p-3">
            <div className="text-xs text-red-700">Failed pairs</div>
            <div className="mt-1 text-lg font-semibold text-red-800">{failedCount}</div>
          </div>
          <div className="border border-amber-200 rounded-xl p-3">
            <div className="text-xs text-amber-800">Unresolved anomalies</div>
            <div className="mt-1 text-lg font-semibold text-amber-900">{totalUnresolved}</div>
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          Open sync-related manual reviews: {data.aggregates?.unresolvedSyncManualReviews ?? 0} · duplicate-import anomalies in recent events: {duplicateImportCount}
        </p>
      </section>
    </div>
  );
}
