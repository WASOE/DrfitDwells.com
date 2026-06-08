const CleaningPricingPolicy = require('../../../models/CleaningPricingPolicy');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  KNOWN_INPUT_KEYS,
  defaultItemsForPropertyKind,
  itemToPolicyRule
} = require('../../../data/cleaning/defaultCleaningPricingPolicy');
const { roundEUR } = require('./cleaningPricingService');

const PROPERTY_KINDS = ['cabin', 'valley'];
const CURRENCY = 'EUR';
const DEFAULT_EFFECTIVE_FROM = new Date('2020-01-01T00:00:00.000Z');

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function slugifyRuleKey(label) {
  const slug = String(label || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
  return slug || 'custom_item';
}

function ruleKeyToInputKey(ruleKey, itemType) {
  if (KNOWN_INPUT_KEYS[ruleKey]) {
    return KNOWN_INPUT_KEYS[ruleKey];
  }
  const camel = ruleKey.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  return itemType === 'quantity' ? `${camel}Count` : camel;
}

function policyRuleToItem(rule) {
  const enabled = rule.enabled !== false;

  if (rule.type === 'quantity') {
    return {
      ruleKey: rule.ruleKey,
      label: rule.label,
      type: 'quantity',
      amountEUR: typeof rule.unitAmountEUR === 'number' ? rule.unitAmountEUR : 0,
      enabled
    };
  }

  return {
    ruleKey: rule.ruleKey,
    label: rule.label,
    type: 'fixed',
    amountEUR: typeof rule.amountEUR === 'number' ? rule.amountEUR : 0,
    enabled
  };
}

function buildLocationDto(propertyKind, policy) {
  if (!policy) {
    return {
      mode: 'legacy',
      needsActivation: true,
      propertyKind,
      policyId: null,
      version: null,
      isActive: false,
      items: defaultItemsForPropertyKind(propertyKind)
    };
  }

  return {
    mode: 'policy',
    needsActivation: false,
    propertyKind,
    policyId: String(policy._id),
    version: policy.version,
    isActive: Boolean(policy.isActive),
    items: (policy.rules || []).map(policyRuleToItem)
  };
}

async function loadActivePolicy(propertyKind) {
  const policies = await CleaningPricingPolicy.find({
    propertyKind,
    isActive: true
  })
    .sort({ effectiveFrom: -1, updatedAt: -1 })
    .lean();

  return policies[0] || null;
}

async function getPricingPolicySettings() {
  const result = { currency: CURRENCY };

  for (const propertyKind of PROPERTY_KINDS) {
    const policy = await loadActivePolicy(propertyKind);
    result[propertyKind] = buildLocationDto(propertyKind, policy);
  }

  return result;
}

function assignUniqueRuleKeys(items) {
  const used = new Set();
  return items.map((item) => {
    let ruleKey = String(item.ruleKey || '').trim();
    if (!ruleKey) {
      ruleKey = slugifyRuleKey(item.label);
    }
    let candidate = ruleKey;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${ruleKey}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { ...item, ruleKey: candidate };
  });
}

function validateItems(items) {
  if (!Array.isArray(items)) {
    throw createHttpError(400, 'items must be an array.');
  }

  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      throw createHttpError(400, `items[${index}] must be an object.`);
    }
    if (item.type !== 'fixed' && item.type !== 'quantity') {
      throw createHttpError(400, `items[${index}].type must be "fixed" or "quantity".`);
    }
    const amount = Number(item.amountEUR);
    if (!Number.isFinite(amount) || amount < 0) {
      throw createHttpError(400, `items[${index}].amountEUR must be a number >= 0.`);
    }
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') {
      throw createHttpError(400, `items[${index}].enabled must be a boolean.`);
    }
    const label = String(item.label || '').trim();
    if (item.enabled !== false && !label) {
      throw createHttpError(400, `items[${index}].label is required for enabled items.`);
    }
  });

  return items;
}

function itemsToPolicyRules(items) {
  const normalized = assignUniqueRuleKeys(items);

  return normalized.map((item) => {
    const label = String(item.label || '').trim() || item.ruleKey;
    const inputKey = ruleKeyToInputKey(item.ruleKey, item.type);
    return itemToPolicyRule(
      {
        ruleKey: item.ruleKey,
        label,
        type: item.type,
        amountEUR: roundEUR(Number(item.amountEUR)),
        enabled: item.enabled !== false
      },
      inputKey
    );
  });
}

async function updatePricingPolicyItems({ propertyKind, items }) {
  validateItems(items);
  const rules = itemsToPolicyRules(items);

  let policy = await CleaningPricingPolicy.findOne({
    propertyKind,
    isActive: true
  }).sort({ effectiveFrom: -1, updatedAt: -1 });

  if (!policy) {
    policy = await CleaningPricingPolicy.create({
      propertyKind,
      version: DEFAULT_CLEANING_POLICY_VERSION,
      isActive: true,
      effectiveFrom: DEFAULT_EFFECTIVE_FROM,
      currency: CURRENCY,
      rules
    });
  } else {
    policy.currency = CURRENCY;
    policy.rules = rules;
    policy.isActive = true;
    await policy.save();
  }

  return getPricingPolicySettings();
}

module.exports = {
  CURRENCY,
  PROPERTY_KINDS,
  getPricingPolicySettings,
  updatePricingPolicyItems,
  loadActivePolicy,
  buildLocationDto,
  validateItems,
  itemsToPolicyRules,
  policyRuleToItem,
  slugifyRuleKey,
  ruleKeyToInputKey
};
