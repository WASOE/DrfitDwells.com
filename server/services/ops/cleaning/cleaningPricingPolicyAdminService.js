const CleaningPricingPolicy = require('../../../models/CleaningPricingPolicy');
const {
  DEFAULT_CLEANING_POLICY_VERSION,
  defaultRulesForPropertyKind
} = require('../../../data/cleaning/defaultCleaningPricingPolicy');
const {
  CLEANING_TAG_VOCABULARY,
  sanitizeCleaningTags
} = require('../../../data/cleaning/cleaningTagVocabulary');
const { roundEUR } = require('./cleaningPricingService');
const { getInventoryTagUsageSet } = require('./cleaningInventoryTagsService');

const PROPERTY_KINDS = ['cabin', 'valley'];
const CURRENCY = 'EUR';
const DEFAULT_EFFECTIVE_FROM = new Date('2020-01-01T00:00:00.000Z');

const PAYOUT_RULE_TYPES = ['daily_fixed', 'per_event_fixed', 'tiered_per_event'];

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
  return slug || 'custom_rule';
}

function cloneSelector(selector) {
  const cleaningTags = Array.isArray(selector?.cleaningTags)
    ? selector.cleaningTags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  return { cleaningTags };
}

function cloneTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  return tiers.map((tier) => ({
    amountEUR: typeof tier?.amountEUR === 'number' ? tier.amountEUR : 0
  }));
}

/**
 * Lossless policy rule → admin DTO (same shape priceDay consumes).
 */
function policyRuleToDto(rule) {
  return {
    ruleKey: rule.ruleKey,
    label: rule.label,
    type: rule.type,
    enabled: rule.enabled !== false,
    amountType: rule.amountType === 'customer_charge' ? 'customer_charge' : 'cleaner_payout',
    amountEUR: typeof rule.amountEUR === 'number' ? rule.amountEUR : null,
    requiresCheckouts: Boolean(rule.requiresCheckouts),
    selector: cloneSelector(rule.selector),
    tiers: cloneTiers(rule.tiers)
  };
}

function buildRuleWarnings(rules, inventoryTagsUsed) {
  const warnings = [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const selectorTags = rule.selector?.cleaningTags || [];
    if (selectorTags.length === 0) continue;

    for (const tag of selectorTags) {
      if (!inventoryTagsUsed.has(tag)) {
        warnings.push({
          ruleKey: rule.ruleKey,
          type: 'tag_unused_on_inventory',
          tag,
          message: `Rule "${rule.label}" uses tag "${tag}" but no inventory is tagged with it yet.`
        });
      }
    }
  }

  return warnings;
}

function buildLocationDto(propertyKind, policy, inventoryTagsUsed) {
  const rules = policy
    ? (policy.rules || []).map(policyRuleToDto)
    : defaultRulesForPropertyKind(propertyKind).map(policyRuleToDto);

  const dto = {
    propertyKind,
    mode: policy ? 'policy' : 'needs_activation',
    needsActivation: !policy,
    policyId: policy ? String(policy._id) : null,
    version: policy?.version || null,
    isActive: Boolean(policy?.isActive),
    rules,
    warnings: buildRuleWarnings(rules, inventoryTagsUsed)
  };

  return dto;
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
  const inventoryTagsUsed = await getInventoryTagUsageSet();
  const result = {
    currency: CURRENCY,
    vocabulary: [...CLEANING_TAG_VOCABULARY]
  };

  for (const propertyKind of PROPERTY_KINDS) {
    const policy = await loadActivePolicy(propertyKind);
    result[propertyKind] = buildLocationDto(propertyKind, policy, inventoryTagsUsed);
  }

  return result;
}

function assignUniqueRuleKeys(rules) {
  const used = new Set();
  return rules.map((rule) => {
    let ruleKey = String(rule.ruleKey || '').trim();
    if (!ruleKey) {
      ruleKey = slugifyRuleKey(rule.label);
    }
    let candidate = ruleKey;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${ruleKey}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return { ...rule, ruleKey: candidate };
  });
}

function validateRules(rules) {
  if (!Array.isArray(rules)) {
    throw createHttpError(400, 'rules must be an array.');
  }

  rules.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object') {
      throw createHttpError(400, `rules[${index}] must be an object.`);
    }

    if (!PAYOUT_RULE_TYPES.includes(rule.type)) {
      throw createHttpError(
        400,
        `rules[${index}].type must be one of: ${PAYOUT_RULE_TYPES.join(', ')}.`
      );
    }

    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      throw createHttpError(400, `rules[${index}].enabled must be a boolean.`);
    }

    const label = String(rule.label || '').trim();
    if (rule.enabled !== false && !label) {
      throw createHttpError(400, `rules[${index}].label is required for enabled rules.`);
    }

    if (String(rule.ruleKey || '').toLowerCase().includes('deep_clean')) {
      throw createHttpError(400, 'Deep cleaning auto rules are not supported.');
    }

    const selectorTags = Array.isArray(rule.selector?.cleaningTags)
      ? rule.selector.cleaningTags
      : [];
    const { tags: sanitizedTags, rejected } = sanitizeCleaningTags(selectorTags);
    if (rejected.length > 0) {
      throw createHttpError(
        400,
        `rules[${index}].selector.cleaningTags contains unknown tags: ${rejected.join(', ')}.`
      );
    }

    if (rule.type === 'tiered_per_event') {
      if (sanitizedTags.length === 0) {
        throw createHttpError(
          400,
          `rules[${index}] tiered_per_event requires at least one selector tag.`
        );
      }
      const tiers = Array.isArray(rule.tiers) ? rule.tiers : [];
      if (tiers.length < 2) {
        throw createHttpError(400, `rules[${index}] tiered_per_event requires at least two tiers.`);
      }
      tiers.forEach((tier, tierIndex) => {
        const amount = Number(tier?.amountEUR);
        if (!Number.isFinite(amount) || amount < 0) {
          throw createHttpError(
            400,
            `rules[${index}].tiers[${tierIndex}].amountEUR must be a number >= 0.`
          );
        }
      });
    }

    if (rule.type === 'daily_fixed' || rule.type === 'per_event_fixed') {
      const amount = Number(rule.amountEUR);
      if (rule.enabled !== false && (!Number.isFinite(amount) || amount < 0)) {
        throw createHttpError(400, `rules[${index}].amountEUR must be a number >= 0.`);
      }
    }

    if (rule.requiresCheckouts && rule.type !== 'daily_fixed') {
      throw createHttpError(
        400,
        `rules[${index}].requiresCheckouts is only valid for daily_fixed rules.`
      );
    }
  });

  return rules;
}

function dtoToPolicyRule(rule) {
  const enabled = rule.enabled !== false;
  const selector = cloneSelector(rule.selector);
  const { tags: sanitizedTags } = sanitizeCleaningTags(selector.cleaningTags);

  const stored = {
    ruleKey: rule.ruleKey,
    type: rule.type,
    label: String(rule.label || '').trim() || rule.ruleKey,
    enabled,
    amountType: rule.amountType === 'customer_charge' ? 'customer_charge' : 'cleaner_payout',
    selector: { cleaningTags: sanitizedTags },
    requiresCheckouts: rule.type === 'daily_fixed' ? Boolean(rule.requiresCheckouts) : false
  };

  if (rule.type === 'tiered_per_event') {
    stored.amountEUR = null;
    stored.unitAmountEUR = null;
    stored.tiers = cloneTiers(rule.tiers).map((tier) => ({
      amountEUR: roundEUR(Number(tier.amountEUR))
    }));
  } else {
    stored.amountEUR = roundEUR(Number(rule.amountEUR));
    stored.unitAmountEUR = null;
    stored.tiers = undefined;
  }

  return stored;
}

function rulesToStoredPolicyRules(rules) {
  const normalized = assignUniqueRuleKeys(rules);
  return normalized.map(dtoToPolicyRule);
}

async function updatePricingPolicyRules({ propertyKind, rules }) {
  validateRules(rules);
  const storedRules = rulesToStoredPolicyRules(rules);

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
      rules: storedRules
    });
  } else {
    policy.currency = CURRENCY;
    policy.rules = storedRules;
    policy.isActive = true;
    await policy.save();
  }

  return getPricingPolicySettings();
}

/** @deprecated Lossy path removed — use policyRuleToDto / updatePricingPolicyRules. */
function policyRuleToItem() {
  throw new Error('policyRuleToItem is deprecated; use policyRuleToDto.');
}

/** @deprecated Lossy path removed — use validateRules / rulesToStoredPolicyRules. */
function validateItems() {
  throw new Error('validateItems is deprecated; use validateRules.');
}

/** @deprecated Lossy path removed — use rulesToStoredPolicyRules. */
function itemsToPolicyRules() {
  throw new Error('itemsToPolicyRules is deprecated; use rulesToStoredPolicyRules.');
}

module.exports = {
  CURRENCY,
  PROPERTY_KINDS,
  PAYOUT_RULE_TYPES,
  CLEANING_TAG_VOCABULARY,
  getPricingPolicySettings,
  updatePricingPolicyRules,
  loadActivePolicy,
  buildLocationDto,
  validateRules,
  rulesToStoredPolicyRules,
  policyRuleToDto,
  dtoToPolicyRule,
  policyRuleToItem,
  validateItems,
  itemsToPolicyRules,
  slugifyRuleKey,
  buildRuleWarnings
};
