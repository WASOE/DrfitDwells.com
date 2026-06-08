/**
 * Default OPS cleaning pricing rules per location.
 * Amounts and rule shapes are server-side only — never duplicate in React.
 */
const DEFAULT_CLEANING_POLICY_VERSION = '2026-06-default';

/** Stable inputKey map for known rule keys (day-sheet + calendar compatibility). */
const KNOWN_INPUT_KEYS = {
  transport: 'transport',
  aframe_small: 'aframeSmallOnlyCount',
  aframe_full: 'aframeFullCount',
  lux_cabin: 'luxCabinClean',
  house_full: 'houseFullClean',
  deep_cleaning: 'deepCleaning',
  laundry: 'laundryCount'
};

const CABIN_DEFAULT_ITEMS = [
  {
    ruleKey: 'transport',
    label: 'Fuel / transport per visit',
    type: 'fixed',
    amountEUR: 8,
    enabled: true
  },
  {
    ruleKey: 'lux_cabin',
    label: 'Lux cabin / big bungalow',
    type: 'fixed',
    amountEUR: 25,
    enabled: true
  },
  {
    ruleKey: 'house_full',
    label: 'House 1st + 2nd floor + toilets',
    type: 'fixed',
    amountEUR: 25,
    enabled: true
  },
  {
    ruleKey: 'deep_cleaning',
    label: 'Deep/general cleaning',
    type: 'fixed',
    amountEUR: 150,
    enabled: true
  },
  {
    ruleKey: 'laundry',
    label: 'Laundry',
    type: 'quantity',
    amountEUR: 2,
    enabled: true
  }
];

const VALLEY_DEFAULT_ITEMS = [
  {
    ruleKey: 'transport',
    label: 'Fuel / transport per visit',
    type: 'fixed',
    amountEUR: 8,
    enabled: true
  },
  {
    ruleKey: 'aframe_small',
    label: 'A-frame small only',
    type: 'quantity',
    amountEUR: 10,
    enabled: true
  },
  {
    ruleKey: 'aframe_full',
    label: 'A-frame + 1st floor + toilets',
    type: 'quantity',
    amountEUR: 20,
    enabled: true
  },
  {
    ruleKey: 'deep_cleaning',
    label: 'Deep/general cleaning',
    type: 'fixed',
    amountEUR: 150,
    enabled: true
  },
  {
    ruleKey: 'laundry',
    label: 'Laundry',
    type: 'quantity',
    amountEUR: 2,
    enabled: true
  }
];

function cloneItem(item) {
  return { ...item };
}

function defaultItemsForPropertyKind(propertyKind) {
  if (propertyKind === 'valley') {
    return VALLEY_DEFAULT_ITEMS.map(cloneItem);
  }
  return CABIN_DEFAULT_ITEMS.map(cloneItem);
}

function itemToPolicyRule(item, inputKey) {
  const enabled = item.enabled !== false;
  const amount = typeof item.amountEUR === 'number' ? item.amountEUR : 0;

  if (item.type === 'quantity') {
    return {
      ruleKey: item.ruleKey,
      type: 'quantity',
      label: item.label,
      unitAmountEUR: amount,
      amountEUR: null,
      inputKey,
      selector: {},
      enabled
    };
  }

  return {
    ruleKey: item.ruleKey,
    type: 'optional_addon',
    label: item.label,
    amountEUR: amount,
    unitAmountEUR: null,
    inputKey,
    selector: {},
    enabled
  };
}

function defaultRulesForPropertyKind(propertyKind) {
  return defaultItemsForPropertyKind(propertyKind).map((item) =>
    itemToPolicyRule(item, KNOWN_INPUT_KEYS[item.ruleKey] || item.ruleKey)
  );
}

/** @deprecated Use defaultRulesForPropertyKind(propertyKind) */
function defaultCleaningPricingRules() {
  return defaultRulesForPropertyKind('cabin');
}

module.exports = {
  DEFAULT_CLEANING_POLICY_VERSION,
  KNOWN_INPUT_KEYS,
  CABIN_DEFAULT_ITEMS,
  VALLEY_DEFAULT_ITEMS,
  defaultItemsForPropertyKind,
  defaultRulesForPropertyKind,
  defaultCleaningPricingRules,
  itemToPolicyRule
};
