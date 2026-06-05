import { useEffect, useState } from 'react';
import api from '../../../services/api';

const LOCATIONS = [
  { propertyKind: 'cabin', label: 'The Cabin' },
  { propertyKind: 'valley', label: 'The Valley' }
];

export default function OpsCleaningSettings() {
  const [fees, setFees] = useState({ cabin: '', valley: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingKind, setSavingKind] = useState(null);
  const [feedback, setFeedback] = useState({ cabin: null, valley: null });

  const loadSettings = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await api.get('/ops/cleaning/settings');
      const data = res.data?.data || {};
      setFees({
        cabin: data.cabin != null ? String(data.cabin) : '0',
        valley: data.valley != null ? String(data.valley) : '0'
      });
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Failed to load cleaning settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (propertyKind) => {
    setSavingKind(propertyKind);
    setFeedback((p) => ({ ...p, [propertyKind]: null }));
    const baseFee = Number(fees[propertyKind]);
    if (!Number.isFinite(baseFee) || baseFee < 0) {
      setFeedback((p) => ({ ...p, [propertyKind]: { type: 'error', text: 'Enter a number ≥ 0.' } }));
      setSavingKind(null);
      return;
    }
    try {
      const res = await api.post('/ops/cleaning/settings', { propertyKind, baseFee });
      const data = res.data?.data || {};
      setFees({
        cabin: data.cabin != null ? String(data.cabin) : fees.cabin,
        valley: data.valley != null ? String(data.valley) : fees.valley
      });
      setFeedback((p) => ({ ...p, [propertyKind]: { type: 'success', text: 'Saved.' } }));
    } catch (err) {
      setFeedback((p) => ({
        ...p,
        [propertyKind]: { type: 'error', text: err?.response?.data?.message || 'Failed to save.' }
      }));
    } finally {
      setSavingKind(null);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto pb-20">
      <h2 className="text-lg md:text-xl font-semibold text-gray-900">Cleaning Settings</h2>
      <p className="mt-1 text-sm text-gray-500">
        Daily base cleaning fee per location, added on top of individual cabin cleaning fees.
      </p>

      {loadError ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="mt-6 text-sm text-gray-400">Loading settings…</p>
      ) : (
        <div className="mt-5 space-y-4">
          {LOCATIONS.map(({ propertyKind, label }) => {
            const fb = feedback[propertyKind];
            const busy = savingKind === propertyKind;
            return (
              <section
                key={propertyKind}
                className="bg-white border border-gray-200 rounded-xl p-4 md:p-5"
              >
                <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
                <label className="mt-3 block">
                  <span className="block text-xs text-gray-600 mb-1">Base Fee (BGN)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={fees[propertyKind]}
                    onChange={(e) => setFees((p) => ({ ...p, [propertyKind]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-sm"
                  />
                </label>
                <div className="mt-4 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSave(propertyKind)}
                    disabled={busy}
                    className="text-xs px-3 py-2 rounded-lg bg-[#81887A] text-white disabled:opacity-50"
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  {fb ? (
                    <span
                      className={`text-xs ${fb.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}
                    >
                      {fb.text}
                    </span>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
