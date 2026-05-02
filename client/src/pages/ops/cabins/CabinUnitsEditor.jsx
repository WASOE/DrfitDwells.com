import { useEffect, useMemo, useRef, useState } from 'react';
import { opsWriteAPI } from '../../../services/opsApi';

function UnitAirbnbIcsRow({ unit: u, onReload }) {
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(u.displayName || '');
  const [adminNotes, setAdminNotes] = useState(u.adminNotes || '');
  const [isActive, setIsActive] = useState(u.isActive !== false);
  const [label, setLabel] = useState(u.airbnbListingLabel || '');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const hintTimeoutRef = useRef(null);

  useEffect(() => {
    setDisplayName(u.displayName || '');
    setAdminNotes(u.adminNotes || '');
    setIsActive(u.isActive !== false);
    setLabel(u.airbnbListingLabel || '');
  }, [u.unitId, u.displayName, u.adminNotes, u.isActive, u.airbnbListingLabel]);

  useEffect(
    () => () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
        hintTimeoutRef.current = null;
      }
    },
    []
  );

  const fullUrl = useMemo(() => {
    if (u.icsExportUrl) return u.icsExportUrl;
    if (typeof window !== 'undefined' && u.icsExportPath) {
      return `${window.location.origin}${u.icsExportPath}`;
    }
    return u.icsExportPath || '';
  }, [u.icsExportPath, u.icsExportUrl]);

  const copy = async () => {
    if (!u.isActive || !fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setHint('Copied');
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = setTimeout(() => {
        setHint('');
        hintTimeoutRef.current = null;
      }, 2000);
    } catch {
      setHint('Copy failed');
    }
  };

  const saveUnit = async () => {
    setHint('');
    setBusy(true);
    try {
      await opsWriteAPI.patchUnitChannelLabel(u.unitId, {
        displayName,
        adminNotes,
        isActive,
        airbnbListingLabel: label
      });
      await onReload();
      setIsEditing(false);
      setHint('Saved');
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = setTimeout(() => {
        setHint('');
        hintTimeoutRef.current = null;
      }, 2000);
    } catch (err) {
      setHint(err?.response?.data?.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setHint('');
    setDisplayName(u.displayName || '');
    setAdminNotes(u.adminNotes || '');
    setIsActive(u.isActive !== false);
    setLabel(u.airbnbListingLabel || '');
  };

  return (
    <tr className="border-b border-gray-100 align-top">
      <td className="py-2.5 pr-3 font-mono text-xs whitespace-nowrap">{u.unitNumber}</td>
      <td className="py-2.5 pr-3">
        {isEditing ? (
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={100}
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            placeholder="Display name"
          />
        ) : (
          u.displayName || '—'
        )}
      </td>
      <td className="py-2.5 pr-3">
        {isEditing ? (
          <div className="space-y-1">
            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded border-gray-300"
              />
              Active
            </label>
            <p className="text-[11px] text-amber-700">
              Inactive units are excluded from assignment and availability.
            </p>
          </div>
        ) : (
          (u.isActive ? 'Yes' : 'No')
        )}
      </td>
      <td className="py-2.5 pr-3">{u.blockedDatesCount ?? 0}</td>
      <td className="py-2.5 pr-3">
        <div className="flex flex-col gap-2 max-w-[260px]">
          {isEditing ? (
            <>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Airbnb listing name / id"
                className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                maxLength={200}
              />
              <textarea
                value={adminNotes}
                onChange={(e) => setAdminNotes(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Internal notes for operators"
                className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveUnit}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={busy}
                  className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-700 break-words">
                Label: {u.airbnbListingLabel || '—'}
              </p>
              <p className="text-xs text-gray-500 break-words">
                Notes: {u.adminNotes || '—'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(true);
                  setHint('');
                }}
                className="text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 w-fit"
              >
                Edit unit
              </button>
            </>
          )}
        </div>
      </td>
      <td className="py-2.5">
        {u.isActive ? (
          <div className="space-y-1.5 max-w-md">
            <p className="text-[11px] font-mono text-gray-700 break-all leading-snug">{fullUrl}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copy}
                disabled={busy}
                className="text-xs px-3 py-1.5 rounded-lg bg-[#81887A] text-white hover:opacity-90"
              >
                Copy ICS URL
              </button>
              {hint ? <span className="text-xs text-gray-500">{hint}</span> : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-400">No export (inactive unit)</span>
        )}
      </td>
    </tr>
  );
}

export default function CabinUnitsEditor({ units, onReload }) {
  if (!Array.isArray(units)) return null;

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-4 md:p-5 overflow-x-auto">
      <h3 className="text-sm font-semibold text-gray-900">Units &amp; Airbnb calendar export</h3>
      <p className="text-xs text-gray-500 mt-1 max-w-2xl">
        One Airbnb listing imports one <span className="font-mono">.ics</span> URL per physical unit. Paste only the
        URL for the unit that matches that listing. Set <span className="font-medium">PUBLIC_SITE_ORIGIN</span> on the
        server for absolute URLs in copy; otherwise the app origin is used.
      </p>
      <p className="text-xs text-gray-500 mt-1">{units.length} unit(s) in database.</p>
      <table className="mt-3 w-full text-sm text-left min-w-[720px]">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
            <th className="py-2 pr-3 text-left">Unit</th>
            <th className="py-2 pr-3 text-left">Display</th>
            <th className="py-2 pr-3 text-left">Active</th>
            <th className="py-2 pr-3 text-left">Blocked</th>
            <th className="py-2 pr-3 text-left min-w-[140px]">Airbnb listing label</th>
            <th className="py-2 text-left min-w-[220px]">ICS URL for Airbnb</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <UnitAirbnbIcsRow key={u.unitId} unit={u} onReload={onReload} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
