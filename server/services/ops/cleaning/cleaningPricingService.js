const CleaningSettings = require('../../../models/CleaningSettings');
const CleaningPayment = require('../../../models/CleaningPayment');
const CleaningDaySheet = require('../../../models/CleaningDaySheet');
const CleaningPricingPolicy = require('../../../models/CleaningPricingPolicy');
const { normalizeDateToSofiaDayStart } = require('../../../utils/dateTime');

function getCleaningSchedule(...args) {
  // Lazy require avoids circular dependency with cleaningReadModel.
  const { getCleaningSchedule: loadSchedule } = require('../readModels/cleaningReadModel');
  return loadSchedule(...args);
}

const CURRENCY = 'EUR';

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

function checkoutMatchesSelector(ev, selector) {
  if (!selector || typeof selector !== 'object') return true;

  const hasSelector =
    (Array.isArray(selector.cleaningTags) && selector.cleaningTags.length > 0) ||
    selector.cleaningCategory ||
    selector.cabinId ||
    selector.cabinTypeId;

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

function resolveInputValue(daySheet, inputKey, bookingId = null) {
  if (!inputKey) return null;

  if (bookingId && daySheet?.perCheckoutInputs?.length) {
    const row = daySheet.perCheckoutInputs.find(
      (p) => String(p.bookingId) === String(bookingId)
    );
    if (row?.inputs && Object.prototype.hasOwnProperty.call(row.inputs, inputKey)) {
      return row.inputs[inputKey];
    }
  }

  if (daySheet?.inputs && Object.prototype.hasOwnProperty.call(daySheet.inputs, inputKey)) {
    return daySheet.inputs[inputKey];
  }

  return null;
}

function coerceQuantity(value) {
  if (value === true) return 1;
  if (value === false || value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function coerceBoolean(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  return false;
}

function buildLineItem(partial) {
  return {
    ruleKey: partial.ruleKey ?? null,
    label: partial.label,
    category: partial.category ?? null,
    quantity: partial.quantity ?? 1,
    unitAmountEUR: partial.unitAmountEUR ?? null,
    amountEUR: roundEUR(partial.amountEUR),
    bookingId: partial.bookingId ?? null,
    cabinName: partial.cabinName ?? null,
    source: partial.source ?? 'policy'
  };
}

function mergeInputsForSnapshot(daySheet) {
  if (!daySheet) {
    return { inputs: {}, perCheckoutInputs: [] };
  }
  return {
    inputs: daySheet.inputs && typeof daySheet.inputs === 'object' ? { ...daySheet.inputs } : {},
    perCheckoutInputs: Array.isArray(daySheet.perCheckoutInputs)
      ? daySheet.perCheckoutInputs.map((p) => ({
          bookingId: String(p.bookingId),
          inputs: p.inputs && typeof p.inputs === 'object' ? { ...p.inputs } : {}
        }))
      : []
  };
}

/**
 * Derive desktop-editable field metadata from policy rules (server-owned prices).
 */
function buildEditableInputFields(policy) {
  if (!policy || !Array.isArray(policy.rules)) return [];

  return policy.rules
    .filter((rule) => rule.inputKey)
    .map((rule) => {
      if (rule.type === 'quantity') {
        return {
          inputKey: rule.inputKey,
          label: rule.label,
          type: 'quantity',
          unitAmountEUR:
            typeof rule.unitAmountEUR === 'number' ? rule.unitAmountEUR : null
        };
      }
      if (rule.type === 'optional_addon') {
        return {
          inputKey: rule.inputKey,
          label: rule.label,
          type: 'boolean',
          amountEUR: typeof rule.amountEUR === 'number' ? rule.amountEUR : null
        };
      }
      return null;
    })
    .filter(Boolean);
}

async function loadEditableInputFieldsForPayment(payment) {
  if (!payment?.pricingPolicyId) return [];
  const policy = await CleaningPricingPolicy.findById(payment.pricingPolicyId).lean();
  return buildEditableInputFields(policy);
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

async function loadDaySheet(sofiaStart, propertyKind) {
  return CleaningDaySheet.findOne({ date: sofiaStart, propertyKind }).lean();
}

/**
 * Legacy calculation when no active policy exists: baseFee + sum(cleaningFee).
 */
async function calculateLegacyLineItems(checkouts, propertyKind) {
  const settings = await CleaningSettings.findOne({ propertyKind }).lean();
  const baseFee =
    settings && typeof settings.baseFee === 'number' ? settings.baseFee : 0;

  const lineItems = [];

  if (baseFee > 0) {
    lineItems.push(
      buildLineItem({
        ruleKey: 'legacy_base_fee',
        label: 'Base fee',
        category: 'base',
        quantity: 1,
        unitAmountEUR: baseFee,
        amountEUR: baseFee,
        source: 'legacy'
      })
    );
  }

  for (const ev of checkouts) {
    if (typeof ev.cleaningFee !== 'number' || ev.cleaningFee <= 0) continue;
    lineItems.push(
      buildLineItem({
        ruleKey: 'legacy_property_fee',
        label: `Property cleaning — ${ev.cabinName}`,
        category: 'property',
        quantity: 1,
        unitAmountEUR: ev.cleaningFee,
        amountEUR: ev.cleaningFee,
        bookingId: ev.bookingId,
        cabinName: ev.cabinName,
        source: 'legacy'
      })
    );
  }

  return buildLegacyCalcResult({
    lineItems,
    totalAmountEUR: sumLineItems(lineItems),
    currency: CURRENCY,
    pricingPolicyId: null,
    pricingVersion: 'legacy',
    inputs: { inputs: {}, perCheckoutInputs: [] }
  });
}

function applyDailyFixedRule(rule, lineItems) {
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
      source: 'policy'
    })
  );
}

function applyQuantityRule(rule, daySheet, lineItems) {
  const qty = coerceQuantity(resolveInputValue(daySheet, rule.inputKey));
  if (qty <= 0) return;
  const unit = typeof rule.unitAmountEUR === 'number' ? rule.unitAmountEUR : 0;
  if (unit <= 0) return;
  lineItems.push(
    buildLineItem({
      ruleKey: rule.ruleKey,
      label: rule.label,
      category: 'quantity',
      quantity: qty,
      unitAmountEUR: unit,
      amountEUR: qty * unit,
      source: 'policy'
    })
  );
}

function applyPerEventFixedRule(rule, checkouts, lineItems) {
  const amount = typeof rule.amountEUR === 'number' ? rule.amountEUR : 0;
  if (amount <= 0) return;

  for (const ev of checkouts) {
    if (!checkoutMatchesSelector(ev, rule.selector)) continue;
    lineItems.push(
      buildLineItem({
        ruleKey: rule.ruleKey,
        label: rule.label,
        category: 'event',
        quantity: 1,
        unitAmountEUR: amount,
        amountEUR: amount,
        bookingId: ev.bookingId,
        cabinName: ev.cabinName,
        source: 'policy'
      })
    );
  }
}

function applyTieredPerEventRule(rule, checkouts, lineItems) {
  const tiers = Array.isArray(rule.tiers) ? rule.tiers : [];
  if (tiers.length === 0) return;

  const matching = checkouts
    .filter((ev) => checkoutMatchesSelector(ev, rule.selector))
    .sort((a, b) => String(a.bookingId).localeCompare(String(b.bookingId)));

  matching.forEach((ev, index) => {
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
        bookingId: ev.bookingId,
        cabinName: ev.cabinName,
        source: 'policy'
      })
    );
  });
}

function applyOptionalAddonRule(rule, daySheet, checkouts, lineItems) {
  const amount = typeof rule.amountEUR === 'number' ? rule.amountEUR : 0;
  if (amount <= 0 || !rule.inputKey) return;

  const dayEnabled = coerceBoolean(resolveInputValue(daySheet, rule.inputKey));
  if (dayEnabled) {
    lineItems.push(
      buildLineItem({
        ruleKey: rule.ruleKey,
        label: rule.label,
        category: 'addon',
        quantity: 1,
        unitAmountEUR: amount,
        amountEUR: amount,
        source: 'policy'
      })
    );
    return;
  }

  for (const ev of checkouts) {
    const perCheckout = resolveInputValue(daySheet, rule.inputKey, ev.bookingId);
    if (!coerceBoolean(perCheckout)) continue;
    lineItems.push(
      buildLineItem({
        ruleKey: rule.ruleKey,
        label: rule.label,
        category: 'addon',
        quantity: 1,
        unitAmountEUR: amount,
        amountEUR: amount,
        bookingId: ev.bookingId,
        cabinName: ev.cabinName,
        source: 'policy'
      })
    );
  }
}

/**
 * Calculate line items from an active pricing policy.
 */
function calculatePolicyLineItems(checkouts, policy, daySheet) {
  const lineItems = [];
  const rules = Array.isArray(policy.rules) ? policy.rules : [];

  for (const rule of rules) {
    switch (rule.type) {
      case 'daily_fixed':
        applyDailyFixedRule(rule, lineItems);
        break;
      case 'quantity':
        applyQuantityRule(rule, daySheet, lineItems);
        break;
      case 'per_event_fixed':
        applyPerEventFixedRule(rule, checkouts, lineItems);
        break;
      case 'tiered_per_event':
        applyTieredPerEventRule(rule, checkouts, lineItems);
        break;
      case 'optional_addon':
        applyOptionalAddonRule(rule, daySheet, checkouts, lineItems);
        break;
      default:
        break;
    }
  }

  return {
    lineItems,
    totalAmountEUR: sumLineItems(lineItems),
    currency: policy.currency || CURRENCY,
    pricingPolicyId: policy._id,
    pricingVersion: policy.version,
    inputs: mergeInputsForSnapshot(daySheet),
    editableInputFields: buildEditableInputFields(policy)
  };
}

function buildLegacyCalcResult(calcPartial) {
  return {
    ...calcPartial,
    editableInputFields: []
  };
}

async function buildPaidSnapshotResponse(payment, cabinCount) {
  const editableInputFields = await loadEditableInputFieldsForPayment(payment);
  return {
    date: payment.date.toISOString(),
    propertyKind: payment.propertyKind,
    currency: payment.currency || CURRENCY,
    totalAmount: payment.totalAmount,
    paidAmount: payment.paidAmount || 0,
    status: payment.status,
    lineItems: payment.lineItems || [],
    inputs: payment.inputsSnapshot || { inputs: {}, perCheckoutInputs: [] },
    editableInputFields,
    canEditInputs: false,
    isSnapshot: true,
    pricingPolicyId: payment.pricingPolicyId ? String(payment.pricingPolicyId) : null,
    pricingVersion: payment.pricingVersion || null,
    calculatedAt: payment.calculatedAt ? payment.calculatedAt.toISOString() : null,
    cabinCount,
    cleaningPaymentId: String(payment._id)
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
      inputs: { inputs: {}, perCheckoutInputs: [] },
      editableInputFields: [],
      canEditInputs: false,
      isSnapshot: false,
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

  const daySheet = await loadDaySheet(sofiaStart, propertyKind);
  const policy = await loadActivePolicy(propertyKind, sofiaStart);

  const calc = policy
    ? calculatePolicyLineItems(checkouts, policy, daySheet)
    : await calculateLegacyLineItems(checkouts, propertyKind);

  return {
    date: sofiaStart.toISOString(),
    propertyKind,
    currency: calc.currency,
    totalAmount: calc.totalAmountEUR,
    paidAmount: payment?.paidAmount || 0,
    status: payment?.status || 'pending',
    lineItems: calc.lineItems,
    inputs: calc.inputs,
    editableInputFields: calc.editableInputFields || [],
    canEditInputs: true,
    isSnapshot: false,
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
  const daySheet = await loadDaySheet(sofiaStart, propertyKind);
  const policy = await loadActivePolicy(propertyKind, sofiaStart);

  const calc = policy
    ? calculatePolicyLineItems(checkouts, policy, daySheet)
    : await calculateLegacyLineItems(checkouts, propertyKind);

  return {
    ...calc,
    calculatedAt: new Date()
  };
}

module.exports = {
  CURRENCY,
  calculateCleaningPaymentSummary,
  calculateForMarkPaid,
  calculateLegacyLineItems,
  calculatePolicyLineItems,
  loadActivePolicy,
  loadDaySheet,
  checkoutMatchesSelector,
  resolveInputValue,
  buildEditableInputFields,
  loadEditableInputFieldsForPayment,
  sumLineItems,
  roundEUR
};
