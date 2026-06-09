import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOpsSession } from '../../../context/OpsSessionContext';
import { getPricingPolicy, updatePricingPolicy } from '../../../services/cleaningApi';
import OpsCleaningInventoryTagsPanel from './OpsCleaningInventoryTagsPanel';
import OpsCleaningRateCardPanel, {
  cloneRules,
  newEmptyRule,
  parseAmount
} from './OpsCleaningRateCardPanel';

const LOCATIONS = [
  { propertyKind: 'cabin', label: 'The Cabin' },
  { propertyKind: 'valley', label: 'The Valley' }
];

export default function OpsCleaningSettings() {
  const session = useOpsSession();
  const canWrite = (session?.actions || []).includes('ops.cleaning.settings_write');

  const [locationMeta, setLocationMeta] = useState({ cabin: null, valley: null });
  const [cabinRules, setCabinRules] = useState([]);
  const [valleyRules, setValleyRules] = useState([]);
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
      setCabinRules(cloneRules(data.cabin?.rules));
      setValleyRules(cloneRules(data.valley?.rules));
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Failed to load cleaning settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const getRulesSetter = (propertyKind) =>
    propertyKind === 'valley' ? setValleyRules : setCabinRules;

  const handleRuleChange = (propertyKind, index, field, value) => {
    const setter = getRulesSetter(propertyKind);
    setter((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        if (field === 'type') {
          const next = { ...rule, type: value };
          if (value === 'daily_fixed') {
            next.requiresCheckouts = true;
            next.tiers = [];
          } else if (value === 'tiered_per_event') {
            next.tiers =
              rule.tiers?.length >= 2
                ? rule.tiers
                : [{ amountEUR: rule.amountEUR || 0 }, { amountEUR: 0 }];
          } else {
            next.requiresCheckouts = false;
          }
          return next;
        }
        if (field === 'selector') {
          return { ...rule, selector: value };
        }
        if (field === 'tierAmount') {
          const tiers = [...(rule.tiers || [])];
          const parsed = parseAmount(value.value);
          tiers[value.tierIndex] = { amountEUR: parsed != null ? parsed : 0 };
          return { ...rule, tiers };
        }
        if (field === 'amountEUR') {
          const parsed = parseAmount(value);
          return { ...rule, amountEUR: parsed != null ? parsed : value };
        }
        if (field === 'enabled' || field === 'requiresCheckouts') {
          return { ...rule, [field]: Boolean(value) };
        }
        return { ...rule, [field]: value };
      })
    );
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleAddRule = (propertyKind) => {
    const setter = getRulesSetter(propertyKind);
    setter((prev) => [...prev, newEmptyRule()]);
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleRemoveRule = (propertyKind, index) => {
    const setter = getRulesSetter(propertyKind);
    setter((prev) => prev.filter((_, i) => i !== index));
    setFeedback((prev) => ({ ...prev, [propertyKind]: null }));
  };

  const handleSave = async (propertyKind) => {
    const rules = propertyKind === 'valley' ? valleyRules : cabinRules;

    const resolveAmount = (value) => {
      const parsed = parseAmount(value);
      if (parsed != null) return parsed;
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    };

    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules[i];
      if (rule.enabled === false) continue;
      if (!String(rule.label || '').trim()) {
        setFeedback((prev) => ({
          ...prev,
          [propertyKind]: { type: 'error', text: `Rule ${i + 1}: label is required.` }
        }));
        return;
      }
      if (rule.type === 'tiered_per_event') {
        const tags = rule.selector?.cleaningTags || [];
        if (tags.length === 0) {
          setFeedback((prev) => ({
            ...prev,
            [propertyKind]: { type: 'error', text: `Rule ${i + 1}: tiered rules need at least one tag.` }
          }));
          return;
        }
      }
    }

    const payload = rules.map((rule) => ({
      ruleKey: rule.ruleKey || '',
      label: String(rule.label || '').trim(),
      type: rule.type,
      enabled: rule.enabled !== false,
      amountType: 'cleaner_payout',
      amountEUR: rule.type === 'tiered_per_event' ? null : resolveAmount(rule.amountEUR),
      requiresCheckouts: rule.type === 'daily_fixed' ? Boolean(rule.requiresCheckouts) : false,
      selector: { cleaningTags: [...(rule.selector?.cleaningTags || [])] },
      tiers:
        rule.type === 'tiered_per_event'
          ? (rule.tiers || []).map((tier) => ({
              amountEUR: resolveAmount(tier.amountEUR)
            }))
          : []
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
        setCabinRules(cloneRules(updated?.rules));
      } else {
        setValleyRules(cloneRules(updated?.rules));
      }

      setFeedback((prev) => ({
        ...prev,
        [propertyKind]: { type: 'success', text: 'Rules saved.' }
      }));
    } catch (err) {
      setFeedback((prev) => ({
        ...prev,
        [propertyKind]: {
          type: 'error',
          text: err?.response?.data?.message || 'Failed to save rules.'
        }
      }));
    } finally {
      setSavingKind(null);
    }
  };

  const rulesByKind = { cabin: cabinRules, valley: valleyRules };

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 pb-20 md:py-8">
      <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
        <h2 className="text-lg font-semibold text-gray-900 md:text-xl">Cleaning payout settings</h2>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Tag inventory and edit checkout-linked payout rules. Saved rules drive automatic pricing — no manual
          day-sheet counts.
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
        <p className="text-sm text-gray-400">Loading settings…</p>
      ) : (
        <div className="space-y-4">
          <OpsCleaningInventoryTagsPanel canWrite={canWrite} />

          {LOCATIONS.map((loc) => (
            <OpsCleaningRateCardPanel
              key={loc.propertyKind}
              locationMeta={loc}
              locationState={locationMeta[loc.propertyKind]}
              rules={rulesByKind[loc.propertyKind] || []}
              canWrite={canWrite}
              saving={savingKind === loc.propertyKind}
              feedback={feedback[loc.propertyKind]}
              onRuleChange={(index, field, value) =>
                handleRuleChange(loc.propertyKind, index, field, value)
              }
              onAddRule={handleAddRule}
              onRemoveRule={(index) => handleRemoveRule(loc.propertyKind, index)}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
    </div>
  );
}
