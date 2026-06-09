import { CLEANING_TAG_LABELS, CLEANING_TAG_VOCABULARY } from '../../../constants/cleaningTagVocabulary';

const RULE_TYPE_OPTIONS = [
  { value: 'daily_fixed', label: 'Per cleaning trip' },
  { value: 'per_event_fixed', label: 'Per checkout' },
  { value: 'tiered_per_event', label: 'Tiered per checkout' }
];

function parseAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toggleTag(currentTags, tag) {
  const set = new Set(currentTags || []);
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  return [...set];
}

function newEmptyRule() {
  return {
    ruleKey: '',
    label: '',
    type: 'per_event_fixed',
    enabled: true,
    amountType: 'cleaner_payout',
    amountEUR: 0,
    requiresCheckouts: false,
    selector: { cleaningTags: [] },
    tiers: [{ amountEUR: 0 }, { amountEUR: 0 }]
  };
}

function cloneRules(rules = []) {
  return rules.map((rule) => ({
    ...rule,
    selector: { cleaningTags: [...(rule.selector?.cleaningTags || [])] },
    tiers: (rule.tiers || []).map((tier) => ({ amountEUR: tier.amountEUR }))
  }));
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
      Not saved yet — saving activates policy
    </span>
  );
}

function RuleEditorRow({
  rule,
  index,
  propertyKind,
  canWrite,
  saving,
  onChange,
  onRemove,
  warningsForRule
}) {
  const isTiered = rule.type === 'tiered_per_event';
  const isTrip = rule.type === 'daily_fixed';
  const selectedTags = rule.selector?.cleaningTags || [];

  return (
    <div
      className="rounded-xl border border-gray-200 bg-gray-50/60 p-4"
      data-testid={`rule-${propertyKind}-${index}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(rule.enabled)}
            disabled={!canWrite || saving}
            onChange={(e) => onChange(index, 'enabled', e.target.checked)}
            data-testid={`enabled-${propertyKind}-${index}`}
          />
          <span className="font-medium text-gray-800">Enabled</span>
        </label>
        {canWrite ? (
          <button
            type="button"
            onClick={() => onRemove(index)}
            disabled={saving}
            className="ml-auto text-xs font-medium text-red-600 hover:text-red-800"
            data-testid={`remove-${propertyKind}-${index}`}
          >
            Remove
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Label</span>
          <input
            type="text"
            value={rule.label}
            disabled={!canWrite || saving}
            onChange={(e) => onChange(index, 'label', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 px-2.5 py-2 text-sm disabled:bg-gray-100"
            data-testid={`label-${propertyKind}-${index}`}
          />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Rule type</span>
          <select
            value={rule.type}
            disabled={!canWrite || saving}
            onChange={(e) => onChange(index, 'type', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-2 text-sm disabled:bg-gray-100"
            data-testid={`type-${propertyKind}-${index}`}
          >
            {RULE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {isTrip ? (
        <label className="mt-3 inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(rule.requiresCheckouts)}
            disabled={!canWrite || saving}
            onChange={(e) => onChange(index, 'requiresCheckouts', e.target.checked)}
            data-testid={`requires-checkouts-${propertyKind}-${index}`}
          />
          <span>Only when at least one checkout exists</span>
        </label>
      ) : null}

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Matching tags</p>
        <p className="mt-0.5 text-xs text-gray-500">
          Leave all unchecked for rules that apply to every checkout (e.g. laundry, cabin clean).
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {CLEANING_TAG_VOCABULARY.map((tag) => (
            <label
              key={tag}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                !canWrite || saving ? 'opacity-60' : 'cursor-pointer'
              } ${selectedTags.includes(tag) ? 'border-[#81887A] bg-white' : 'border-gray-200 bg-white'}`}
            >
              <input
                type="checkbox"
                checked={selectedTags.includes(tag)}
                disabled={!canWrite || saving}
                onChange={() =>
                  onChange(index, 'selector', {
                    cleaningTags: toggleTag(selectedTags, tag)
                  })
                }
                data-testid={`rule-tag-${propertyKind}-${index}-${tag}`}
              />
              <span>{CLEANING_TAG_LABELS[tag] || tag}</span>
            </label>
          ))}
        </div>
      </div>

      {isTiered ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(rule.tiers || []).map((tier, tierIndex) => (
            <label key={tierIndex} className="block text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Tier {tierIndex + 1} (EUR)
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={tier.amountEUR}
                disabled={!canWrite || saving}
                onChange={(e) => onChange(index, 'tierAmount', { tierIndex, value: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-200 px-2 py-2 text-sm tabular-nums disabled:bg-gray-100"
                data-testid={`tier-${propertyKind}-${index}-${tierIndex}`}
              />
            </label>
          ))}
        </div>
      ) : (
        <label className="mt-3 block max-w-xs text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Amount (EUR)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rule.amountEUR ?? 0}
            disabled={!canWrite || saving}
            onChange={(e) => onChange(index, 'amountEUR', e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-200 px-2 py-2 text-sm tabular-nums disabled:bg-gray-100"
            data-testid={`amount-${propertyKind}-${index}`}
          />
        </label>
      )}

      {warningsForRule?.length ? (
        <ul className="mt-3 space-y-1 text-xs text-amber-800">
          {warningsForRule.map((warning) => (
            <li key={`${warning.ruleKey}-${warning.tag}`}>⚠ {warning.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function OpsCleaningRateCardPanel({
  locationMeta,
  locationState,
  rules,
  canWrite,
  saving,
  feedback,
  onRuleChange,
  onAddRule,
  onRemoveRule,
  onSave
}) {
  const warningsByRuleKey = (locationState?.warnings || []).reduce((acc, warning) => {
    if (!acc[warning.ruleKey]) acc[warning.ruleKey] = [];
    acc[warning.ruleKey].push(warning);
    return acc;
  }, {});

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-gray-900 md:text-lg">{locationMeta.label} rate card</h3>
          <p className="mt-1 text-sm text-gray-500">
            Rules saved here are exactly what the payout engine runs — no manual day-sheet counts.
          </p>
        </div>
        {locationState ? <ModeBadge location={locationState} /> : null}
      </div>

      <div className="mt-5 max-w-4xl space-y-4">
        {rules.map((rule, index) => (
          <RuleEditorRow
            key={`${locationMeta.propertyKind}-${rule.ruleKey || 'new'}-${index}`}
            rule={rule}
            index={index}
            propertyKind={locationMeta.propertyKind}
            canWrite={canWrite}
            saving={saving}
            onChange={onRuleChange}
            onRemove={onRemoveRule}
            warningsForRule={warningsByRuleKey[rule.ruleKey]}
          />
        ))}
      </div>

      {canWrite ? (
        <>
          <button
            type="button"
            onClick={() => onAddRule(locationMeta.propertyKind)}
            disabled={saving}
            className="mt-4 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:border-gray-400 disabled:opacity-50"
            data-testid={`add-rule-${locationMeta.propertyKind}`}
          >
            + Add rule
          </button>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSave(locationMeta.propertyKind)}
              disabled={saving}
              className="rounded-lg bg-[#81887A] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              data-testid={`save-rules-${locationMeta.propertyKind}`}
            >
              {saving ? 'Saving…' : `Save ${locationMeta.label} rules`}
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
        <p className="mt-4 text-sm text-gray-500">Read-only. Contact an admin to change rules.</p>
      )}
    </section>
  );
}

export { cloneRules, newEmptyRule, parseAmount, RULE_TYPE_OPTIONS };
