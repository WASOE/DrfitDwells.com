/**
 * Default OPS cleaning pricing rules (physical zones/tasks).
 * Amounts are server-side only — never duplicate in React.
 */
const DEFAULT_CLEANING_POLICY_VERSION = '2026-06-default';

const PRICING_RULE_CATALOG = [
  {
    ruleKey: 'transport',
    type: 'optional_addon',
    label: 'Fuel / transport per visit',
    amountEUR: 8,
    inputKey: 'transport',
    selector: {}
  },
  {
    ruleKey: 'aframe_small',
    type: 'quantity',
    label: 'A-frame small only',
    unitAmountEUR: 10,
    inputKey: 'aframeSmallOnlyCount',
    selector: {}
  },
  {
    ruleKey: 'aframe_full',
    type: 'quantity',
    label: 'A-frame + 1st floor + toilets',
    unitAmountEUR: 20,
    inputKey: 'aframeFullCount',
    selector: {}
  },
  {
    ruleKey: 'lux_cabin',
    type: 'optional_addon',
    label: 'Lux cabin / big bungalow',
    amountEUR: 25,
    inputKey: 'luxCabinClean',
    selector: {}
  },
  {
    ruleKey: 'house_full',
    type: 'optional_addon',
    label: 'House 1st + 2nd floor + toilets',
    amountEUR: 25,
    inputKey: 'houseFullClean',
    selector: {}
  },
  {
    ruleKey: 'deep_cleaning',
    type: 'optional_addon',
    label: 'Deep/general cleaning',
    amountEUR: 150,
    inputKey: 'deepCleaning',
    selector: {}
  },
  {
    ruleKey: 'laundry',
    type: 'quantity',
    label: 'Laundry',
    unitAmountEUR: 2,
    inputKey: 'laundryCount',
    selector: {}
  }
];

const ALLOWED_RULE_KEYS = PRICING_RULE_CATALOG.map((rule) => rule.ruleKey);

function cloneCatalogRule(rule) {
  return {
    ...rule,
    selector: rule.selector ? { ...rule.selector } : {}
  };
}

function defaultCleaningPricingRules() {
  return PRICING_RULE_CATALOG.map(cloneCatalogRule);
}

module.exports = {
  DEFAULT_CLEANING_POLICY_VERSION,
  PRICING_RULE_CATALOG,
  ALLOWED_RULE_KEYS,
  defaultCleaningPricingRules
};
