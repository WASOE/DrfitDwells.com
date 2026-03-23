import { useEffect, useState } from 'react';
import maintenanceApi from '../../services/maintenanceApi';

function ReasonDialog({ open, title, onCancel, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open, title]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-xl">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <textarea
          className="mt-3 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          rows={3}
          placeholder="Reason (min 8 characters, required for audit)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || reason.trim().length < 8}
            onClick={() => onConfirm(reason.trim())}
            className="px-3 py-1.5 text-sm rounded-lg bg-amber-700 text-white disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MaintenanceCabins() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [includeFixtures, setIncludeFixtures] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState({ open: false, mode: null, cabin: null });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await maintenanceApi.cabins({
        q,
        includeFixtures: includeFixtures ? '1' : '0',
        includeArchived: includeArchived ? '1' : '0',
        limit: 50
      });
      setData(resp.data?.data || null);
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [includeFixtures, includeArchived]);

  const runArchive = async (reason) => {
    if (!dialog.cabin) return;
    setBusy(true);
    try {
      await maintenanceApi.archiveCabin(dialog.cabin.id, reason);
      setDialog({ open: false, mode: null, cabin: null });
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || 'Archive failed');
    } finally {
      setBusy(false);
    }
  };

  const runDelete = async (reason) => {
    if (!dialog.cabin) return;
    setBusy(true);
    try {
      await maintenanceApi.deleteFixtureCabin(dialog.cabin.id, reason);
      setDialog({ open: false, mode: null, cabin: null });
      await load();
    } catch (e) {
      setError(e?.response?.data?.message || 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Maintenance · Cabins</h2>
        <p className="mt-1 text-xs text-slate-400 max-w-2xl">
          Default list hides fixtures and archived cabins. Enable toggles to browse intentionally. Archive is preferred;
          hard delete only applies to fixture-named cabins.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 items-start sm:items-center">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={includeFixtures}
            onChange={(e) => setIncludeFixtures(e.target.checked)}
          />
          Show fixture-named cabins
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived cabins
        </label>
        <div className="flex gap-2 w-full sm:w-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name / location"
            className="flex-1 sm:w-64 rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-sm text-slate-200"
          />
          <button
            type="button"
            onClick={() => load()}
            className="px-3 py-1.5 text-sm rounded-lg bg-slate-700 text-white"
          >
            Search
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-red-400">{error}</div> : null}

      {loading ? <div className="text-sm text-slate-500">Loading…</div> : null}

      <div className="rounded-xl border border-slate-700 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Flags</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {(data?.items || []).map((row) => (
              <tr key={row.id} className="text-slate-300">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 text-slate-500">{row.location}</td>
                <td className="px-3 py-2 text-xs">
                  {row.isFixtureName ? (
                    <span className="text-amber-400">fixture name</span>
                  ) : null}
                  {row.archivedAt ? <span className="ml-2 text-slate-500">archived</span> : null}
                  {!row.isActive ? <span className="ml-2 text-slate-500">inactive</span> : null}
                </td>
                <td className="px-3 py-2 text-right space-x-2">
                  <button
                    type="button"
                    className="text-xs text-amber-400 hover:underline"
                    onClick={() => setDialog({ open: true, mode: 'archive', cabin: row })}
                  >
                    Archive
                  </button>
                  {row.isFixtureName ? (
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:underline"
                      onClick={() => setDialog({ open: true, mode: 'delete', cabin: row })}
                    >
                      Delete fixture
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items?.length === 0 ? <div className="px-3 py-6 text-sm text-slate-500">No cabins match filters.</div> : null}
      </div>

      <ReasonDialog
        open={dialog.open && !!dialog.mode}
        title={dialog.mode === 'delete' ? 'Delete fixture cabin (hard delete)' : 'Archive cabin'}
        busy={busy}
        onCancel={() => setDialog({ open: false, mode: null, cabin: null })}
        onConfirm={(reason) => (dialog.mode === 'delete' ? runDelete(reason) : runArchive(reason))}
      />
    </div>
  );
}
