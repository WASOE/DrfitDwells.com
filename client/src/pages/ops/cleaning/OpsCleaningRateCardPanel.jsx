import { CLEANING_TAG_LABELS, CLEANING_TAG_VOCABULARY } from '../../../constants/cleaningTagVocabulary';
import OpsBadge from '../../../ops/primitives/OpsBadge';
import OpsButton from '../../../ops/primitives/OpsButton';
import OpsCheckbox from '../../../ops/primitives/OpsCheckbox';
import OpsInlineError from '../../../ops/primitives/OpsInlineError';
import OpsSelect from '../../../ops/primitives/OpsSelect';
import OpsTextField from '../../../ops/primitives/OpsTextField';

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
      <OpsBadge tone="info">
        Policy active
        {location.version ? ` · ${location.version}` : ''}
      </OpsBadge>
    );
  }

  return <OpsBadge tone="neutral">Not saved yet — saving activates policy</OpsBadge>;
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
  const disabled = !canWrite || saving;

  return (
    <div className="ops-cleaning-settings-rule" data-testid={`rule-${propertyKind}-${index}`}>
      <div className="ops-cleaning-settings-rule__toolbar">
        <OpsCheckbox
          label="Enabled"
          checked={Boolean(rule.enabled)}
          disabled={disabled}
          onChange={(e) => onChange(index, 'enabled', e.target.checked)}
          data-testid={`enabled-${propertyKind}-${index}`}
        />
        {canWrite ? (
          <OpsButton
            variant="quiet"
            size="compact"
            disabled={saving}
            onClick={() => onRemove(index)}
            data-testid={`remove-${propertyKind}-${index}`}
          >
            Remove
          </OpsButton>
        ) : null}
      </div>

      <div className="ops-cleaning-settings-rule__fields">
        <OpsTextField
          label="Label"
          value={rule.label}
          disabled={disabled}
          onChange={(e) => onChange(index, 'label', e.target.value)}
          data-testid={`label-${propertyKind}-${index}`}
        />
        <OpsSelect
          label="Rule type"
          value={rule.type}
          disabled={disabled}
          onChange={(e) => onChange(index, 'type', e.target.value)}
          data-testid={`type-${propertyKind}-${index}`}
        >
          {RULE_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </OpsSelect>
      </div>

      {isTrip ? (
        <OpsCheckbox
          label="Only when at least one checkout exists"
          checked={Boolean(rule.requiresCheckouts)}
          disabled={disabled}
          onChange={(e) => onChange(index, 'requiresCheckouts', e.target.checked)}
          data-testid={`requires-checkouts-${propertyKind}-${index}`}
        />
      ) : null}

      <div>
        <p className="ops-cleaning-settings-field-label">Matching tags</p>
        <p className="ops-cleaning-settings-note">
          Leave all unchecked for rules that apply to every checkout (e.g. laundry, cabin clean).
        </p>
        <div className="ops-cleaning-settings-tag-group">
          {CLEANING_TAG_VOCABULARY.map((tag) => (
            <OpsCheckbox
              key={tag}
              label={CLEANING_TAG_LABELS[tag] || tag}
              checked={selectedTags.includes(tag)}
              disabled={disabled}
              onChange={() =>
                onChange(index, 'selector', {
                  cleaningTags: toggleTag(selectedTags, tag)
                })
              }
              data-testid={`rule-tag-${propertyKind}-${index}-${tag}`}
            />
          ))}
        </div>
      </div>

      {isTiered ? (
        <div className="ops-cleaning-settings-tiers">
          {(rule.tiers || []).map((tier, tierIndex) => (
            <OpsTextField
              key={tierIndex}
              label={`Tier ${tierIndex + 1} (EUR)`}
              type="number"
              min="0"
              step="0.01"
              value={tier.amountEUR}
              disabled={disabled}
              onChange={(e) => onChange(index, 'tierAmount', { tierIndex, value: e.target.value })}
              data-testid={`tier-${propertyKind}-${index}-${tierIndex}`}
            />
          ))}
        </div>
      ) : (
        <div className="ops-cleaning-settings-rule__amount">
          <OpsTextField
            label="Amount (EUR)"
            type="number"
            min="0"
            step="0.01"
            value={rule.amountEUR ?? 0}
            disabled={disabled}
            onChange={(e) => onChange(index, 'amountEUR', e.target.value)}
            data-testid={`amount-${propertyKind}-${index}`}
          />
        </div>
      )}

      {warningsForRule?.length ? (
        <ul className="ops-cleaning-settings-warnings">
          {warningsForRule.map((warning) => (
            <li key={`${warning.ruleKey}-${warning.tag}`}>{warning.message}</li>
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
    <section
      className="ops-cleaning-settings-surface"
      aria-labelledby={`ops-cleaning-rate-${locationMeta.propertyKind}`}
    >
      <div className="ops-cleaning-settings-surface__head">
        <div>
          <h2
            id={`ops-cleaning-rate-${locationMeta.propertyKind}`}
            className="ops-cleaning-settings-surface__title"
          >
            {locationMeta.label} payout policy
          </h2>
          <p className="ops-cleaning-settings-surface__desc">
            Rules saved here are exactly what the payout engine runs — no manual day-sheet counts.
          </p>
        </div>
        {locationState ? <ModeBadge location={locationState} /> : null}
      </div>

      <div className="ops-cleaning-settings-rules">
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
          <div className="ops-cleaning-settings-actions">
            <OpsButton
              variant="secondary"
              size="compact"
              disabled={saving}
              onClick={() => onAddRule(locationMeta.propertyKind)}
              data-testid={`add-rule-${locationMeta.propertyKind}`}
            >
              Add rule
            </OpsButton>
          </div>
          <div className="ops-cleaning-settings-actions">
            <OpsButton
              loading={saving}
              loadingLabel="Saving…"
              onClick={() => onSave(locationMeta.propertyKind)}
              data-testid={`save-rules-${locationMeta.propertyKind}`}
            >
              {`Save ${locationMeta.label} rules`}
            </OpsButton>
            {feedback?.type === 'success' ? (
              <p className="ops-cleaning-settings-success">{feedback.text}</p>
            ) : null}
            {feedback?.type === 'error' ? <OpsInlineError>{feedback.text}</OpsInlineError> : null}
          </div>
        </>
      ) : (
        <p className="ops-cleaning-settings-readonly">Read-only. Contact an admin to change rules.</p>
      )}
    </section>
  );
}

export { cloneRules, newEmptyRule, parseAmount, RULE_TYPE_OPTIONS };
