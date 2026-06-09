/**
 * Checkout-driven cleaner payout rules per location.
 * Amounts and rule shapes are server-side only — never duplicate in React.
 */
const DEFAULT_CLEANING_POLICY_VERSION = '2026-06-checkout-payout-v1';

const CABIN_PAYOUT_RULES = [
  {
    ruleKey: 'transport',
    type: 'daily_fixed',
    label: 'Transport',
    amountEUR: 15,
    requiresCheckouts: true,
    amountType: 'cleaner_payout',
    selector: { cleaningTags: ['the-cabin'] },
    enabled: true
  },
  {
    ruleKey: 'cabin_clean',
    type: 'per_event_fixed',
    label: 'Cabin cleaning',
    amountEUR: 20,
    amountType: 'cleaner_payout',
    selector: { cleaningTags: ['the-cabin'] },
    enabled: true
  }
];

const VALLEY_PAYOUT_RULES = [
  {
    ruleKey: 'transport',
    type: 'daily_fixed',
    label: 'Transport',
    amountEUR: 8,
    requiresCheckouts: true,
    amountType: 'cleaner_payout',
    selector: {},
    enabled: true
  },
  {
    ruleKey: 'aframe_clean',
    type: 'tiered_per_event',
    label: 'A-frame cleaning',
    amountType: 'cleaner_payout',
    selector: { cleaningTags: ['a-frame'] },
    tiers: [{ amountEUR: 20 }, { amountEUR: 10 }],
    enabled: true
  },
  {
    ruleKey: 'lux_cabin',
    type: 'per_event_fixed',
    label: 'Lux cabin',
    amountEUR: 25,
    amountType: 'cleaner_payout',
    selector: { cleaningTags: ['lux-cabin'] },
    enabled: true
  },
  {
    ruleKey: 'house_full',
    type: 'per_event_fixed',
    label: 'House cleaning',
    amountEUR: 25,
    amountType: 'cleaner_payout',
    selector: { cleaningTags: ['stone-house'] },
    enabled: true
  },
  {
    ruleKey: 'laundry',
    type: 'per_event_fixed',
    label: 'Laundry',
    amountEUR: 2,
    amountType: 'cleaner_payout',
    selector: {},
    enabled: true
  }
];

function cloneRule(rule) {
  const copy = { ...rule };
  if (Array.isArray(rule.tiers)) {
    copy.tiers = rule.tiers.map((t) => ({ ...t }));
  }
  if (rule.selector) {
    copy.selector = { ...rule.selector };
    if (Array.isArray(rule.selector.cleaningTags)) {
      copy.selector.cleaningTags = [...rule.selector.cleaningTags];
    }
  }
  return copy;
}

function defaultRulesForPropertyKind(propertyKind) {
  const rules = propertyKind === 'valley' ? VALLEY_PAYOUT_RULES : CABIN_PAYOUT_RULES;
  return rules.map(cloneRule);
}

/** @deprecated Use defaultRulesForPropertyKind(propertyKind) */
function defaultCleaningPricingRules() {
  return defaultRulesForPropertyKind('cabin');
}

module.exports = {
  DEFAULT_CLEANING_POLICY_VERSION,
  CABIN_PAYOUT_RULES,
  VALLEY_PAYOUT_RULES,
  defaultRulesForPropertyKind,
  defaultCleaningPricingRules
};
