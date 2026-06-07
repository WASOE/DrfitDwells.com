import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOpsSession } from '../../../context/OpsSessionContext';
import { getPricingPolicy, updatePricingPolicy } from '../../../services/cleaningApi';

const LOCATIONS = [
  { propertyKind: 'cabin', label: 'The Cabin' },
  { propertyKind: 'valley', label: 'The Valley' }
];

function amountsFromRules(rules = []) {
  const amounts = {};
  rules.forEach((rule) => {
    amounts[rule.ruleKey] =
      rule.valueType === 'unit'
        ? String(rule.unitAmountEUR ?? '')
        : String(rule.amountEUR ?? '');
  });
  return amounts;
}

function parseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function ModeBadge({ location }) {
  if (location.mode === 'policy') {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
        Policy active
        {location.version ? ` · ${location.version}` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
      Legacy mode — saving these rates activates policy
    </span>
  );
}

function LocationRatesSection({
  locationMeta,
  locationData,
  draftAmounts,
  canWrite,
  saving,
  feedback,
  onAmountChange,
  onSave
}) {
  const rules = locationData?.rules || [];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{locationMeta.label}</h3>
          <p className="mt-1 text-sm text-gray-500">Cleaning payout rates for this location.</p>
        </div>
        {locationData ? <ModeBadge location={locationData} /> : null}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-2 pr-4">Task</th>
              <th className="pb-2 text-right">Rate (EUR)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rules.map((rule) => (
              <tr key={rule.ruleKey}>
                <td className="py-3 pr-4 align-top text-gray-900">{rule.label}</td>
                <td className="py-3 text-right align-top">
                  <div className="inline-flex items-center gap-1">
                    <span className="text-xs text-gray-500">€</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draftAmounts[rule.ruleKey] ?? ''}
                      disabled={!canWrite || saving}
                      onChange={(e) => onAmountChange(locationMeta.propertyKind, rule.ruleKey, e.target.value)}
                      className="w-28 rounded-md border border-gray-200 px-2.5 py-2 text-right text-sm tabular-nums disabled:bg-gray-50 disabled:text-gray-600"
                      data-testid={`rate-${locationMeta.propertyKind}-${rule.ruleKey}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSave(locationMeta.propertyKind)}
            disabled={saving}
            className="rounded-lg bg-[#81887A] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            data-testid={`save-rates-${locationMeta.propertyKind}`}
          >
            {saving ? 'Saving…' : `Save ${locationMeta.label}`}
          </button>
          {feedback ? (
            <span
              className={`text-sm ${feedback.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {feedback.text}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-gray-500">Read-only. Contact an admin to change rates.</p>
      )}
    </section>
  );
}

export default function OpsCleaningSettings() {
  const session = useOpsSession();
  const canWrite = (session?.actions || []).includes('ops.cleaning.settings_write');

  const [policyData, setPolicyData] = useState(null);
  const [drafts, setDrafts] = useState({ cabin: {}, valley: {} });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [savingKind, setSavingKind] = useState(null);
  const [feedback, setFeedback] = useState({ cabin: null, valley: null });

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await getPricingPolicy();
      const data = res.data?.data || {};
      setPolicyData(data);
      setDrafts({
        cabin: amountsFromRules(data.cabin?.rules),
        valley: amountsFromRules(data.valley?.rules)
      });
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Failed to load cleaning payment rates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleAmountChange = (propertyKind, ruleKey, value) => {
    setDrafts((prev) => ({
      ...prev,
      [propertyKind]: { ...prev[propertyKind], [ruleKey]: value }
    }));
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleSave = async (propertyKind) => {
    const locationData = policyData?.[propertyKind];
    const rules = locationData?.rules || [];
    const amounts = {};

    for (const rule of rules) {
      const parsed = parseAmount(drafts[propertyKind]?.[rule.ruleKey]);
      if (parsed == null) {
        setFeedback((prev) => ({
          ...prev,
          [propertyKind]: { type: 'error', text: `Enter a valid amount for ${rule.label}.` }
        }));
        return;
      }
      amounts[rule.ruleKey] = parsed;
    }

    setSavingKind(propertyKind);
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));

    try {
      const res = await updatePricingPolicy(propertyKind, amounts);
      const data = res.data?.data || {};
      setPolicyData(data);
      setDrafts({
        cabin: amountsFromRules(data.cabin?.rules),
        valley: amountsFromRules(data.valley?.rules)
      });
      setFeedback((prev) => ({
        ...prev,
        [propertyKind]: { type: 'success', text: 'Rates saved.' }
      }));
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [propertyKind]: {
          type: 'error',
          text: err?.response?.data?.message || 'Failed to save rates.'
        }
      }));
    } finally {
      setSavingKind(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 pb-20 md:py-8">
      <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 md:text-xl">Cleaning payment rates</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          These rates calculate cleaning payouts on the cleaning calendar. Paid days keep their saved snapshot even
          if rates change later.
        </p>
        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-500">Currency: EUR only</p>
        <p className="mt-2 text-sm text-gray-500">
          <Link to="/ops/cleaning" className="font-medium text-[#81887A] hover:underline">
            Open cleaning calendar
          </Link>
        </p>
      </section>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-400">Loading payment rates…</p>
      ) : (
        <div className="space-y-4">
          {LOCATIONS.map((loc) => (
            <LocationRatesSection
              key={loc.propertyKind}
              locationMeta={loc}
              locationData={policyData?.[loc.propertyKind]}
              draftAmounts={drafts[loc.propertyKind] || {}}
              canWrite={canWrite}
              saving={savingKind === loc.propertyKind}
              feedback={feedback[loc.propertyKind]}
              onAmountChange={handleAmountChange}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
