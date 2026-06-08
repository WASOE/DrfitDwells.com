import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOpsSession } from '../../../context/OpsSessionContext';
import { getPricingPolicy, updatePricingPolicy } from '../../../services/cleaningApi';

const LOCATIONS = [
  { propertyKind: 'cabin', label: 'The Cabin' },
  { propertyKind: 'valley', label: 'The Valley' }
];

function newEmptyItem() {
  return { ruleKey: '', label: '', type: 'fixed', amountEUR: 0, enabled: true };
}

function cloneItems(items = []) {
  return items.map((item) => ({ ...item }));
}

function parseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function ModeBadge({ location }) {
  if (location?.mode === 'policy') {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
        Policy active
        {location.version ? ` · ${location.version}` : ''}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
      Legacy mode — saving activates policy
    </span>
  );
}

function LocationItemsPanel({
  locationMeta,
  locationMetaState,
  items,
  canWrite,
  saving,
  feedback,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onSave
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{locationMeta.label}</h3>
          <p className="mt-1 text-sm text-gray-500">Independent payout items for this location.</p>
        </div>
        {locationMetaState ? <ModeBadge location={locationMetaState} /> : null}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <th className="pb-2 pr-2 w-10">On</th>
              <th className="pb-2 pr-3">Label</th>
              <th className="pb-2 pr-3 w-32">Type</th>
              <th className="pb-2 pr-3 w-28 text-right">Rate (EUR)</th>
              {canWrite ? <th className="pb-2 w-16" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item, index) => (
              <tr key={`${locationMeta.propertyKind}-${item.ruleKey || 'new'}-${index}`}>
                <td className="py-2.5 pr-2 align-top">
                  <input
                    type="checkbox"
                    checked={Boolean(item.enabled)}
                    disabled={!canWrite || saving}
                    onChange={(e) =>
                      onItemChange(locationMeta.propertyKind, index, 'enabled', e.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300"
                    data-testid={`enabled-${locationMeta.propertyKind}-${index}`}
                  />
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <input
                    type="text"
                    value={item.label}
                    disabled={!canWrite || saving}
                    onChange={(e) =>
                      onItemChange(locationMeta.propertyKind, index, 'label', e.target.value)
                    }
                    placeholder="Task label"
                    className="w-full min-w-[10rem] max-w-md rounded-md border border-gray-200 px-2.5 py-2 text-sm disabled:bg-gray-50"
                    data-testid={`label-${locationMeta.propertyKind}-${index}`}
                  />
                </td>
                <td className="py-2.5 pr-3 align-top">
                  <select
                    value={item.type}
                    disabled={!canWrite || saving}
                    onChange={(e) =>
                      onItemChange(locationMeta.propertyKind, index, 'type', e.target.value)
                    }
                    className="w-full rounded-md border border-gray-200 px-2 py-2 text-sm disabled:bg-gray-50"
                    data-testid={`type-${locationMeta.propertyKind}-${index}`}
                  >
                    <option value="fixed">Fixed</option>
                    <option value="quantity">Quantity</option>
                  </select>
                </td>
                <td className="py-2.5 pr-3 align-top text-right">
                  <div className="inline-flex items-center gap-1">
                    <span className="text-xs text-gray-500">€</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.amountEUR}
                      disabled={!canWrite || saving}
                      onChange={(e) =>
                        onItemChange(locationMeta.propertyKind, index, 'amountEUR', e.target.value)
                      }
                      className="w-24 rounded-md border border-gray-200 px-2 py-2 text-right text-sm tabular-nums disabled:bg-gray-50"
                      data-testid={`amount-${locationMeta.propertyKind}-${index}`}
                    />
                  </div>
                </td>
                {canWrite ? (
                  <td className="py-2.5 align-top text-right">
                    <button
                      type="button"
                      onClick={() => onRemoveItem(locationMeta.propertyKind, index)}
                      disabled={saving}
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      data-testid={`remove-${locationMeta.propertyKind}-${index}`}
                    >
                      Remove
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite ? (
        <>
          <button
            type="button"
            onClick={() => onAddItem(locationMeta.propertyKind)}
            disabled={saving}
            className="mt-4 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-gray-400 disabled:opacity-50"
            data-testid={`add-item-${locationMeta.propertyKind}`}
          >
            + Add item
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-500">Read-only. Contact an admin to change rates.</p>
      )}
    </section>
  );
}

export default function OpsCleaningSettings() {
  const session = useOpsSession();
  const canWrite = (session?.actions || []).includes('ops.cleaning.settings_write');

  const [locationMeta, setLocationMeta] = useState({ cabin: null, valley: null });
  const [cabinItems, setCabinItems] = useState([]);
  const [valleyItems, setValleyItems] = useState([]);
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
      setLocationMeta({
        cabin: data.cabin || null,
        valley: data.valley || null
      });
      setCabinItems(cloneItems(data.cabin?.items));
      setValleyItems(cloneItems(data.valley?.items));
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Failed to load cleaning payment rates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const getItemsSetter = (propertyKind) => (propertyKind === 'valley' ? setValleyItems : setCabinItems);

  const handleItemChange = (propertyKind, index, field, value) => {
    const setter = getItemsSetter(propertyKind);
    setter((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        if (field === 'amountEUR') {
          const parsed = parseAmount(value);
          return { ...item, amountEUR: parsed != null ? parsed : value };
        }
        if (field === 'enabled') {
          return { ...item, enabled: Boolean(value) };
        }
        return { ...item, [field]: value };
      })
    );
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleAddItem = (propertyKind) => {
    const setter = getItemsSetter(propertyKind);
    setter((prev) => [...prev, newEmptyItem()]);
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleRemoveItem = (propertyKind, index) => {
    const setter = getItemsSetter(propertyKind);
    setter((prev) => prev.filter((_, i) => i !== index));
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleSave = async (propertyKind) => {
    const items = propertyKind === 'valley' ? valleyItems : cabinItems;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.enabled === false) continue;
      if (!String(item.label || '').trim()) {
        setFeedback((prev) => ({
          ...prev,
          [propertyKind]: { type: 'error', text: `Row ${i + 1}: label is required for enabled items.` }
        }));
        return;
      }
      const amount = parseAmount(item.amountEUR);
      if (amount == null) {
        setFeedback((prev) => ({
          ...prev,
          [propertyKind]: { type: 'error', text: `Row ${i + 1}: enter a valid EUR amount.` }
        }));
        return;
      }
    }

    const payload = items.map((item) => ({
      ruleKey: item.ruleKey || '',
      label: String(item.label || '').trim(),
      type: item.type === 'quantity' ? 'quantity' : 'fixed',
      amountEUR: parseAmount(item.amountEUR) ?? 0,
      enabled: item.enabled !== false
    }));

    setSavingKind(propertyKind);
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));

    try {
      const res = await updatePricingPolicy(propertyKind, payload);
      const data = res.data?.data || {};
      const updated = data[propertyKind];

      setLocationMeta((prev) => ({
        ...prev,
        [propertyKind]: updated || prev[propertyKind]
      }));

      if (propertyKind === 'cabin') {
        setCabinItems(cloneItems(updated?.items));
      } else {
        setValleyItems(cloneItems(updated?.items));
      }

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

  const itemsByKind = { cabin: cabinItems, valley: valleyItems };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 pb-20 md:py-8">
      <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 md:text-xl">Cleaning payment rates</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Configure payout items independently for each location. Paid days keep their saved snapshot even if
          rates change later.
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
            <LocationItemsPanel
              key={loc.propertyKind}
              locationMeta={loc}
              locationMetaState={locationMeta[loc.propertyKind]}
              items={itemsByKind[loc.propertyKind] || []}
              canWrite={canWrite}
              saving={savingKind === loc.propertyKind}
              feedback={feedback[loc.propertyKind]}
              onItemChange={handleItemChange}
              onAddItem={handleAddItem}
              onRemoveItem={handleRemoveItem}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
