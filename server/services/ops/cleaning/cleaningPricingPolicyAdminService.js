const CleaningPricingPolicy = require('../../../models/CleaningPricingPolicy');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  ALLOWED_RULE_KEYS,
  defaultCleaningPricingRules
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

function ruleToSettingsDto(rule) {
  if (rule.type === 'quantity') {
    return {
      ruleKey: rule.ruleKey,
      label: rule.label,
      valueType: 'unit',
      unitAmountEUR:
        typeof rule.unitAmountEUR === 'number' ? rule.unitAmountEUR : null
    };
  }

  return {
    ruleKey: rule.ruleKey,
    label: rule.label,
    valueType: 'amount',
    amountEUR: typeof rule.amountEUR === 'number' ? rule.amountEUR : null
  };
}

function buildLegacyDto(propertyKind) {
  return {
    mode: 'legacy',
    needsActivation: true,
    propertyKind,
    policyId: null,
    version: null,
    isActive: false,
    rules: defaultCleaningPricingRules().map(ruleToSettingsDto)
  };
}

function buildPolicyDto(policy) {
  return {
    mode: 'policy',
    needsActivation: false,
    propertyKind: policy.propertyKind,
    policyId: String(policy._id),
    version: policy.version,
    isActive: Boolean(policy.isActive),
    rules: (policy.rules || []).map(ruleToSettingsDto)
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
    result[propertyKind] = policy ? buildPolicyDto(policy) : buildLegacyDto(propertyKind);
  }

  return result;
}

function normalizeRuleDocument(rule) {
  if (!rule) return rule;
  if (typeof rule.toObject === 'function') return rule.toObject();
  return rule;
}

function validateAmounts(amounts) {
  if (!amounts || typeof amounts !== 'object' || Array.isArray(amounts)) {
    throw createHttpError(400, 'amounts must be an object.');
  }

  for (const ruleKey of ALLOWED_RULE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(amounts, ruleKey)) {
      throw createHttpError(400, `Missing required rule key: ${ruleKey}.`);
    }
  }

  for (const key of Object.keys(amounts)) {
    if (!ALLOWED_RULE_KEYS.includes(key)) {
      throw createHttpError(400, `Unknown rule key: ${key}.`);
    }
    const value = Number(amounts[key]);
    if (!Number.isFinite(value) || value < 0) {
      throw createHttpError(400, `Invalid amount for ${key}: must be a number >= 0.`);
    }
  }

  return amounts;
}

function applyAmountsToRules(baseRules, amounts) {
  const catalogByKey = new Map(defaultCleaningPricingRules().map((rule) => [rule.ruleKey, rule]));

  return baseRules.map((rawRule) => {
    const rule = normalizeRuleDocument(rawRule);
    const catalogRule = catalogByKey.get(rule.ruleKey);
    if (!catalogRule) {
      return { ...rule };
    }

    const amount = roundEUR(Number(amounts[rule.ruleKey]));

    return {
      ruleKey: catalogRule.ruleKey,
      type: catalogRule.type,
      label: catalogRule.label,
      inputKey: catalogRule.inputKey,
      selector: catalogRule.selector ? { ...catalogRule.selector } : {},
      ...(catalogRule.type === 'quantity'
        ? { unitAmountEUR: amount, amountEUR: null }
        : { amountEUR: amount, unitAmountEUR: null })
    };
  });
}

async function updatePricingPolicyAmounts({ propertyKind, amounts }) {
  validateAmounts(amounts);

  let policy = await CleaningPricingPolicy.findOne({
    propertyKind,
    isActive: true
  }).sort({ effectiveFrom: -1, updatedAt: -1 });

  const baseRules = policy
    ? policy.rules.map(normalizeRuleDocument)
    : defaultCleaningPricingRules();
  const updatedRules = applyAmountsToRules(baseRules, amounts);

  if (!policy) {
    policy = await CleaningPricingPolicy.create({
      propertyKind,
      version: DEFAULT_CLEANING_POLICY_VERSION,
      isActive: true,
      effectiveFrom: DEFAULT_EFFECTIVE_FROM,
      currency: CURRENCY,
      rules: updatedRules
    });
  } else {
    policy.currency = CURRENCY;
    policy.rules = updatedRules;
    policy.isActive = true;
    await policy.save();
  }

  return getPricingPolicySettings();
}

module.exports = {
  CURRENCY,
  PROPERTY_KINDS,
  getPricingPolicySettings,
  updatePricingPolicyAmounts,
  loadActivePolicy,
  buildPolicyDto,
  buildLegacyDto,
  validateAmounts
};
