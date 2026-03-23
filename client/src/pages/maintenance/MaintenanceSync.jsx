import { useEffect, useState } from 'react';
import maintenanceApi from '../../services/maintenanceApi';

export default function MaintenanceSync() {
  const [cabins, setCabins] = useState([]);
  const [cabinId, setCabinId] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await maintenanceApi.cabins({ limit: 200, includeArchived: '1', includeFixtures: '1' });
        if (!cancelled) setCabins(r.data?.data?.items || []);
      } catch {
        if (!cancelled) setMsg('Could not load cabin list');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const configure = async () => {
    setMsg('');
    if (!cabinId || !feedUrl.trim()) {
      setMsg('cabinId and feedUrl required');
      return;
    }
    setBusy(true);
    try {
      const r = await maintenanceApi.internalSyncConfigure({ cabinId, feedUrl: feedUrl.trim() });
      setMsg(JSON.stringify(r.data?.data || r.data, null, 2));
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Configure failed');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setMsg('');
    if (!cabinId) {
      setMsg('cabinId required');
      return;
    }
    setBusy(true);
    try {
      const body = { cabinId };
      if (feedUrl.trim()) body.feedUrl = feedUrl.trim();
      const r = await maintenanceApi.internalSyncRun(body);
      setMsg(JSON.stringify(r.data?.data || r.data, null, 2));
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Run failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Sync configuration &amp; manual run</h2>
        <p className="mt-1 text-xs text-slate-400">
          Uses the same internal sync endpoints as automation. OPS continues to show read-only sync health.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Cabin</label>
          <select
            value={cabinId}
            onChange={(e) => setCabinId(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          >
            <option value="">Select cabin</option>
            {cabins.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">iCal feed URL (Airbnb export)</label>
          <input
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            placeholder="https://..."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={configure}
            className="px-3 py-2 text-sm rounded-lg bg-slate-700 text-white disabled:opacity-50"
          >
            Save feed URL
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={run}
            className="px-3 py-2 text-sm rounded-lg bg-amber-800 text-white disabled:opacity-50"
          >
            Run sync now
          </button>
        </div>
      </div>

      {msg ? (
        <pre className="text-xs text-slate-400 whitespace-pre-wrap rounded-lg bg-slate-950 p-3 border border-slate-800 max-h-96 overflow-auto">
          {msg}
        </pre>
      ) : null}
    </div>
  );
}
