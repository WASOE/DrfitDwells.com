import { useState } from 'react';
import maintenanceApi from '../../services/maintenanceApi';

export default function MaintenanceCleanup() {
  const [previewFc, setPreviewFc] = useState(null);
  const [previewUnsafe, setPreviewUnsafe] = useState(null);
  const [previewIcs, setPreviewIcs] = useState(null);
  const [previewStale, setPreviewStale] = useState(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (kind) => {
    setMsg('');
    setBusy(true);
    try {
      if (kind === 'fc') {
        const r = await maintenanceApi.previewFixtureContamination();
        setPreviewFc(r.data?.data || null);
      }
      if (kind === 'unsafe') {
        const r = await maintenanceApi.previewUnsafeBlocking();
        setPreviewUnsafe(r.data?.data || null);
      }
      if (kind === 'ics') {
        const r = await maintenanceApi.previewIcsExclusion();
        setPreviewIcs(r.data?.data || null);
      }
      if (kind === 'stale') {
        const r = await maintenanceApi.previewStaleBlocks();
        setPreviewStale(r.data?.data || null);
      }
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const applyFc = async () => {
    setMsg('');
    if (reason.trim().length < 8) {
      setMsg('Enter a reason (min 8 characters).');
      return;
    }
    setBusy(true);
    try {
      const r = await maintenanceApi.applyFixtureContamination(reason.trim());
      setMsg(`Applied: ${JSON.stringify(r.data?.data)}`);
      await load('fc');
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Apply failed');
    } finally {
      setBusy(false);
    }
  };

  const applyStale = async () => {
    setMsg('');
    if (reason.trim().length < 8) {
      setMsg('Enter a reason (min 8 characters).');
      return;
    }
    setBusy(true);
    try {
      const r = await maintenanceApi.applyStaleReservationBlocks(reason.trim());
      setMsg(`Tombstoned: ${JSON.stringify(r.data?.data)}`);
      await load('stale');
    } catch (e) {
      setMsg(e?.response?.data?.message || 'Apply failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-white">Cleanup tools</h2>
        <p className="mt-1 text-xs text-slate-400">
          Server-side previews match CLI maintenance scripts. Executes are audited and require a reason.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
        <label className="block text-xs text-slate-400">Reason for any apply action (audit trail)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-200"
          placeholder="Min 8 characters"
        />
      </div>

      {msg ? <div className="text-sm text-amber-200/90 whitespace-pre-wrap">{msg}</div> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white">Fixture contamination</h3>
        <p className="text-xs text-slate-500">
          Matches fixture cabin names and test/fixture bookings. Apply deactivates cabins, clears related blocks/sync state,
          and cancels/archives matching bookings.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => load('fc')}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={applyFc}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-900/80 text-amber-100 border border-amber-800"
          >
            Execute archive batch
          </button>
        </div>
        {previewFc ? (
          <pre className="text-[11px] text-slate-400 overflow-x-auto max-h-48 rounded-lg bg-slate-950 p-3 border border-slate-800">
            {JSON.stringify(previewFc, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white">Unsafe blocking (export safety)</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => load('unsafe')}
          className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white"
        >
          Preview
        </button>
        {previewUnsafe ? (
          <pre className="text-[11px] text-slate-400 overflow-x-auto max-h-48 rounded-lg bg-slate-950 p-3 border border-slate-800">
            {JSON.stringify(previewUnsafe, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white">ICS exclusion preview</h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => load('ics')}
          className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white"
        >
          Preview
        </button>
        {previewIcs ? (
          <pre className="text-[11px] text-slate-400 overflow-x-auto max-h-48 rounded-lg bg-slate-950 p-3 border border-slate-800">
            {JSON.stringify(previewIcs, null, 2)}
          </pre>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white">Stale reservation blocks</h3>
        <p className="text-xs text-slate-500">Active reservation blocks whose booking is completed/cancelled/missing.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => load('stale')}
            className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 text-white"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={applyStale}
            className="px-3 py-1.5 text-xs rounded-lg bg-amber-900/80 text-amber-100 border border-amber-800"
          >
            Tombstone stale blocks
          </button>
        </div>
        {previewStale ? (
          <pre className="text-[11px] text-slate-400 overflow-x-auto max-h-48 rounded-lg bg-slate-950 p-3 border border-slate-800">
            {JSON.stringify(previewStale, null, 2)}
          </pre>
        ) : null}
      </section>
    </div>
  );
}
