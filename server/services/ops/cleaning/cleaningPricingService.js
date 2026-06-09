const CleaningPayment = require('../../../models/CleaningPayment');
const CleaningPricingPolicy = require('../../../models/CleaningPricingPolicy');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

function getCleaningSchedule(...args) {
  // Lazy require avoids circular dependency with cleaningReadModel.
  const { getCleaningSchedule: loadSchedule } = require('../readModels/cleaningReadModel');
  return loadSchedule(...args);
}

const CURRENCY = 'EUR';
const DEFAULT_AMOUNT_TYPE = 'cleaner_payout';

class NoActivePricingPolicyError extends Error {
  constructor(propertyKind) {
    super(`No active pricing policy for property kind: ${propertyKind}`);
    this.name = 'NoActivePricingPolicyError';
    this.code = 'NO_ACTIVE_PRICING_POLICY';
    this.status = 422;
    this.propertyKind = propertyKind;
  }
}

function roundEUR(amount) {
  return Math.round(amount * 100) / 100;
}

function sumLineItems(lineItems) {
  return roundEUR(lineItems.reduce((sum, item) => sum + (item.amountEUR || 0), 0));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
}

function resolveAmountType(value) {
  if (value === 'customer_charge') return 'customer_charge';
  return DEFAULT_AMOUNT_TYPE;
}

function selectorHasTargeting(selector) {
  if (!selector || typeof selector !== 'object') return false;
  return (
    (Array.isArray(selector.cleaningTags) && selector.cleaningTags.length > 0) ||
    Boolean(selector.cleaningCategory) ||
    Boolean(selector.cabinId) ||
    Boolean(selector.cabinTypeId)
  );
}

function checkoutMatchesSelector(ev, selector) {
  if (!selector || typeof selector !== 'object') return true;

  const hasSelector = selectorHasTargeting(selector);
  if (!hasSelector) return true;

  const evTags = normalizeTags(ev.cleaningTags);

  if (Array.isArray(selector.cleaningTags) && selector.cleaningTags.length > 0) {
    const wanted = normalizeTags(selector.cleaningTags);
    if (!wanted.some((t) => evTags.includes(t))) return false;
  }

  if (selector.cleaningCategory) {
    const cat = String(selector.cleaningCategory).trim().toLowerCase();
    if (ev.cleaningCategory !== cat && !evTags.includes(cat)) return false;
  }

  if (selector.cabinId) {
    const wanted = String(selector.cabinId);
    if (ev.cabinId && String(ev.cabinId) !== wanted) return false;
    if (!ev.cabinId) return false;
  }

  if (selector.cabinTypeId) {
    const wanted = String(selector.cabinTypeId);
    if (ev.cabinTypeId && String(ev.cabinTypeId) !== wanted) return false;
    if (!ev.cabinTypeId) return false;
  }

  return true;
}

/**
 * Normalize a schedule checkout DTO into pricing facts for rule selectors.
 * Tag-based selectors are preferred over cabinTypeId/cabinId selectors because
 * bookings attach via one ID shape only (cabinId XOR cabinTypeId); ID selectors
 * silently miss the other shape.
 */
function toPricingFacts(checkout) {
  return {
    propertyKind: checkout?.propertyKind ?? null,
    tags: normalizeTags(checkout?.cleaningTags),
    cabinTypeId: checkout?.cabinTypeId ? String(checkout.cabinTypeId) : null,
    cabinId: checkout?.cabinId ? String(checkout.cabinId) : null,
    bookingId: checkout?.bookingId ? String(checkout.bookingId) : null,
    cabinName: checkout?.cabinName ?? null,
    cleaningTags: normalizeTags(checkout?.cleaningTags)
  };
}

function factsFromCheckout(checkout) {
  const facts = toPricingFacts(checkout);
  return {
    ...facts,
    cleaningCategory: checkout?.cleaningCategory ?? null
  };
}

function buildLineItem(partial) {
  return {
    ruleKey: partial.ruleKey ?? null,
    label: partial.label,
    category: partial.category ?? null,
    quantity: partial.quantity ?? 1,
    unitAmountEUR: partial.unitAmountEUR ?? null,
    amountEUR: roundEUR(partial.amountEUR),
    amountType: resolveAmountType(partial.amountType),
    bookingId: partial.bookingId ?? null,
    cabinName: partial.cabinName ?? null,
    propertyKind: partial.propertyKind ?? null,
    source: partial.source ?? 'policy'
  };
}

function normalizeStoredLineItem(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    amountType: resolveAmountType(item.amountType)
  };
}

function ruleAmountType(rule) {
  return resolveAmountType(rule?.amountType);
}

function applyDailyFixedRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds) {
  const matching = selectorHasTargeting(rule.selector)
    ? checkouts.filter((checkout) =>
        checkoutMatchesSelector(factsFromCheckout(checkout), rule.selector)
      )
    : checkouts;

  if (rule.requiresCheckouts && matching.length === 0) return;

  const amount = typeof rule.amountEUR === 'number' ? rule.amountEUR : 0;
  if (amount <= 0) return;

  lineItems.push(
    buildLineItem({
      ruleKey: rule.ruleKey,
      label: rule.label,
      category: 'daily',
      quantity: 1,
      unitAmountEUR: amount,
      amountEUR: amount,
      amountType: ruleAmountType(rule),
      propertyKind,
      source: 'policy'
    })
  );

  if (selectorHasTargeting(rule.selector)) {
    for (const checkout of matching) {
      const facts = factsFromCheckout(checkout);
      if (facts.bookingId) taggedBookingIds.add(facts.bookingId);
    }
  }
}

function applyPerEventFixedRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds) {
  const amount = typeof rule.amountEUR === 'number' ? rule.amountEUR : 0;
  if (amount <= 0) return;

  const isTagged = selectorHasTargeting(rule.selector);

  for (const checkout of checkouts) {
    const facts = factsFromCheckout(checkout);
    if (!checkoutMatchesSelector(facts, rule.selector)) continue;

    lineItems.push(
      buildLineItem({
        ruleKey: rule.ruleKey,
        label: rule.label,
        category: 'event',
        quantity: 1,
        unitAmountEUR: amount,
        amountEUR: amount,
        amountType: ruleAmountType(rule),
        bookingId: facts.bookingId,
        cabinName: facts.cabinName,
        propertyKind,
        source: 'policy'
      })
    );

    if (isTagged && facts.bookingId) {
      taggedBookingIds.add(facts.bookingId);
    }
  }
}

function applyTieredPerEventRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds) {
  const tiers = Array.isArray(rule.tiers) ? rule.tiers : [];
  if (tiers.length === 0) return;

  const matching = checkouts
    .map((checkout) => factsFromCheckout(checkout))
    .filter((facts) => checkoutMatchesSelector(facts, rule.selector))
    .sort((a, b) => String(a.bookingId).localeCompare(String(b.bookingId)));

  matching.forEach((facts, index) => {
    const tier = index === 0 ? tiers[0] : tiers[1] || tiers[0];
    const amount = typeof tier?.amountEUR === 'number' ? tier.amountEUR : 0;
    if (amount <= 0) return;

    lineItems.push(
      buildLineItem({
        ruleKey: rule.ruleKey,
        label: index === 0 ? rule.label : `${rule.label} (additional)`,
        category: 'tiered',
        quantity: 1,
        unitAmountEUR: amount,
        amountEUR: amount,
        amountType: ruleAmountType(rule),
        bookingId: facts.bookingId,
        cabinName: facts.cabinName,
        propertyKind,
        source: 'policy'
      })
    );

    if (facts.bookingId) {
      taggedBookingIds.add(facts.bookingId);
    }
  });
}

function computeUnmatchedCheckouts(checkouts, taggedBookingIds, rules) {
  const hasTaggedRules = (Array.isArray(rules) ? rules : []).some(
    (rule) => rule.enabled !== false && selectorHasTargeting(rule.selector)
  );

  if (!hasTaggedRules) {
    return [];
  }

  return checkouts
    .map((checkout) => toPricingFacts(checkout))
    .filter((facts) => facts.bookingId && !taggedBookingIds.has(facts.bookingId))
    .map((facts) => ({
      bookingId: facts.bookingId,
      cabinName: facts.cabinName
    }));
}

/**
 * Pure checkout-driven payout pricing. No DB reads. No day-sheet inputs.
 * Handles daily_fixed, per_event_fixed, and tiered_per_event only.
 */
function priceDay(checkouts, policy) {
  const lineItems = [];
  const taggedBookingIds = new Set();
  const propertyKind = policy?.propertyKind ?? null;
  const rules = (Array.isArray(policy?.rules) ? policy.rules : []).filter(
    (rule) => rule.enabled !== false
  );

  for (const rule of rules) {
    switch (rule.type) {
      case 'daily_fixed':
        applyDailyFixedRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds);
        break;
      case 'per_event_fixed':
        applyPerEventFixedRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds);
        break;
      case 'tiered_per_event':
        applyTieredPerEventRule(rule, checkouts, lineItems, propertyKind, taggedBookingIds);
        break;
      default:
        break;
    }
  }

  const unmatchedCheckouts = computeUnmatchedCheckouts(checkouts, taggedBookingIds, rules);

  return {
    lineItems,
    totalAmountEUR: sumLineItems(lineItems),
    unmatchedCheckouts
  };
}

/**
 * Load the active pricing policy for a property kind on a given date.
 */
async function loadActivePolicy(propertyKind, sofiaStart) {
  const policies = await CleaningPricingPolicy.find({
    propertyKind,
    isActive: true,
    effectiveFrom: { $lte: sofiaStart }
  })
    .sort({ effectiveFrom: -1, updatedAt: -1 })
    .lean();

  return policies[0] || null;
}

function buildPolicyCalcResult(checkouts, policy) {
  const priced = priceDay(checkouts, policy);
  return {
    lineItems: priced.lineItems,
    totalAmountEUR: priced.totalAmountEUR,
    unmatchedCheckouts: priced.unmatchedCheckouts,
    currency: policy.currency || CURRENCY,
    pricingPolicyId: policy._id,
    pricingVersion: policy.version
  };
}

/**
 * @deprecated Payout path uses priceDay; daySheet is ignored for amounts.
 */
function calculatePolicyLineItems(checkouts, policy, _daySheet = null) {
  return buildPolicyCalcResult(checkouts, policy);
}

function tagLineItemsWithPropertyKind(lineItems, propertyKind) {
  return (lineItems || []).map((item) =>
    normalizeStoredLineItem({
      ...item,
      propertyKind: item?.propertyKind || propertyKind
    })
  );
}

async function buildPaidSnapshotResponse(payment, cabinCount) {
  return {
    date: payment.date.toISOString(),
    propertyKind: payment.propertyKind,
    currency: payment.currency || CURRENCY,
    totalAmount: payment.totalAmount,
    paidAmount: payment.paidAmount || 0,
    status: payment.status,
    lineItems: tagLineItemsWithPropertyKind(payment.lineItems, payment.propertyKind),
    isSnapshot: true,
    noPolicy: false,
    unmatchedCheckouts: [],
    pricingPolicyId: payment.pricingPolicyId ? String(payment.pricingPolicyId) : null,
    pricingVersion: payment.pricingVersion || null,
    calculatedAt: payment.calculatedAt ? payment.calculatedAt.toISOString() : null,
    cabinCount,
    cleaningPaymentId: String(payment._id)
  };
}

function buildNoPolicySummary({ sofiaStart, propertyKind, payment, checkouts }) {
  return {
    date: sofiaStart.toISOString(),
    propertyKind,
    currency: CURRENCY,
    totalAmount: 0,
    paidAmount: payment?.paidAmount || 0,
    status: payment?.status || 'pending',
    lineItems: [],
    isSnapshot: false,
    noPolicy: true,
    noPolicyMessage: `No active pricing policy for ${propertyKind}`,
    unmatchedCheckouts: [],
    pricingPolicyId: null,
    pricingVersion: null,
    calculatedAt: null,
    cabinCount: checkouts.length,
    cleaningPaymentId: payment ? String(payment._id) : null
  };
}

/**
 * Calculate or return frozen payment summary for a cleaning day.
 */
async function calculateCleaningPaymentSummary({ date, propertyKind }) {
  if (!propertyKind) {
    return {
      date: normalizeDateToSofiaDayStart(date).toISOString(),
      propertyKind: null,
      currency: CURRENCY,
      totalAmount: 0,
      paidAmount: 0,
      status: 'pending',
      lineItems: [],
      isSnapshot: false,
      noPolicy: false,
      unmatchedCheckouts: [],
      pricingPolicyId: null,
      pricingVersion: null,
      calculatedAt: null,
      cabinCount: 0,
      cleaningPaymentId: null
    };
  }

  const sofiaStart = normalizeDateToSofiaDayStart(date);
  const { checkouts } = await getCleaningSchedule({ date, propertyKind });

  const payment = await CleaningPayment.findOne({ date: sofiaStart, propertyKind }).lean();

  if (payment && payment.status === 'paid') {
    return buildPaidSnapshotResponse(payment, checkouts.length);
  }

  const policy = await loadActivePolicy(propertyKind, sofiaStart);

  if (!policy) {
    return buildNoPolicySummary({ sofiaStart, propertyKind, payment, checkouts });
  }

  const calc = buildPolicyCalcResult(checkouts, policy);

  return {
    date: sofiaStart.toISOString(),
    propertyKind,
    currency: calc.currency,
    totalAmount: calc.totalAmountEUR,
    paidAmount: payment?.paidAmount || 0,
    status: payment?.status || 'pending',
    lineItems: calc.lineItems,
    isSnapshot: false,
    noPolicy: false,
    unmatchedCheckouts: calc.unmatchedCheckouts,
    pricingPolicyId: calc.pricingPolicyId ? String(calc.pricingPolicyId) : null,
    pricingVersion: calc.pricingVersion,
    calculatedAt: new Date().toISOString(),
    cabinCount: checkouts.length,
    cleaningPaymentId: payment ? String(payment._id) : null
  };
}

/**
 * Run a fresh calculation for mark-paid (always live, never from stale snapshot).
 */
async function calculateForMarkPaid({ date, propertyKind }) {
  const sofiaStart = normalizeDateToSofiaDayStart(date);
  const { checkouts } = await getCleaningSchedule({ date, propertyKind });
  const policy = await loadActivePolicy(propertyKind, sofiaStart);

  if (!policy) {
    throw new NoActivePricingPolicyError(propertyKind);
  }

  const calc = buildPolicyCalcResult(checkouts, policy);

  return {
    ...calc,
    calculatedAt: new Date()
  };
}

const GLOBAL_PROPERTY_KINDS = ['cabin', 'valley'];

/**
 * Combined cleaner payout across Cabin + Valley for one day.
 * Reuses per-zone calculateCleaningPaymentSummary (same pricing path as operators).
 */
async function calculateGlobalPayoutSummary({ date }) {
  const sofiaStart = normalizeDateToSofiaDayStart(date);
  const zoneSummaries = await Promise.all(
    GLOBAL_PROPERTY_KINDS.map((propertyKind) =>
      calculateCleaningPaymentSummary({ date, propertyKind })
    )
  );

  let totalAmount = 0;
  let paidAmount = 0;
  let checkoutCount = 0;
  const lineItems = [];
  const zones = {};
  const noPolicyZones = [];

  for (const summary of zoneSummaries) {
    const kind = summary.propertyKind;
    totalAmount += summary.totalAmount || 0;
    paidAmount += summary.paidAmount || 0;
    checkoutCount += summary.cabinCount || 0;
    lineItems.push(...tagLineItemsWithPropertyKind(summary.lineItems, kind));

    zones[kind] = {
      propertyKind: kind,
      totalAmount: summary.totalAmount || 0,
      paidAmount: summary.paidAmount || 0,
      noPolicy: Boolean(summary.noPolicy),
      noPolicyMessage: summary.noPolicyMessage || null,
      checkoutCount: summary.cabinCount || 0,
      status: summary.status || 'pending'
    };

    if (summary.noPolicy) {
      noPolicyZones.push(kind);
    }
  }

  const statuses = zoneSummaries.map((s) => s.status || 'pending');
  const status = statuses.every((s) => s === 'paid') ? 'paid' : 'pending';

  return {
    date: sofiaStart.toISOString(),
    currency: CURRENCY,
    totalAmount: roundEUR(totalAmount),
    paidAmount: roundEUR(paidAmount),
    status,
    lineItems,
    checkoutCount,
    noPolicyZones,
    zones,
    readOnly: true
  };
}

module.exports = {
  CURRENCY,
  DEFAULT_AMOUNT_TYPE,
  NoActivePricingPolicyError,
  calculateCleaningPaymentSummary,
  calculateGlobalPayoutSummary,
  calculateForMarkPaid,
  GLOBAL_PROPERTY_KINDS,
  calculatePolicyLineItems,
  priceDay,
  toPricingFacts,
  loadActivePolicy,
  checkoutMatchesSelector,
  selectorHasTargeting,
  normalizeStoredLineItem,
  sumLineItems,
  roundEUR
};
