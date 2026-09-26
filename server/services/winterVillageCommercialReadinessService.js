'use strict';

const RatePlan = require('../models/RatePlan');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const CancellationPolicy = require('../models/CancellationPolicy');
const {
  WINTER_VILLAGE_PRODUCTS,
  WINTER_VILLAGE_FIXED_RATE_PLANS,
  PAYMENT_TERM_CODE,
  PAYMENT_TERM_VERSION,
  CANCELLATION_POLICY_CODE,
  CANCELLATION_POLICY_VERSION
} = require('../config/winterVillageCommercialCatalog');
const { validateAndNormalizeRatePlan } = require('./ratePlanService');
const { resolveWinterVillageInventory } = require('./winterVillageInventoryResolver');

const REQUIRED_RATE_PLAN_IDENTITIES = Object.freeze([
  {
    code: WINTER_VILLAGE_PRODUCTS.stay.ratePlanCode,
    version: WINTER_VILLAGE_PRODUCTS.stay.ratePlanVersion,
    type: 'seasonal_stay'
  },
  ...WINTER_VILLAGE_FIXED_RATE_PLANS.map((plan) => ({
    code: plan.code,
    version: plan.version,
    type: 'fixed_package'
  }))
]);

function identityKey(code, version) {
  return `${String(code || '').trim().toLowerCase()}@v${Number(version)}`;
}

function findByIdentity(rows, code, version) {
  const key = identityKey(code, version);
  return (Array.isArray(rows) ? rows : []).find(
    (row) => identityKey(row && row.code, row && row.version) === key
  ) || null;
}

function expectedFixedPlan(code, version) {
  return WINTER_VILLAGE_FIXED_RATE_PLANS.find(
    (plan) => plan.code === code && plan.version === version
  ) || null;
}

function compareFixedPlan(plan, expected) {
  if (!plan || !expected) return ['missing'];
  const errors = [];
  for (const field of [
    'type',
    'inventoryMode',
    'packageArrivalDate',
    'packageDepartureDate',
    'paymentTermCode',
    'paymentTermVersion',
    'cancellationPolicyCode',
    'cancellationPolicyVersion'
  ]) {
    if (String(plan[field] ?? '') !== String(expected[field] ?? '')) {
      errors.push(`${field} mismatch`);
    }
  }
  if (JSON.stringify(plan.accommodations || []) !== JSON.stringify(expected.accommodations || [])) {
    errors.push('accommodations/pricing mismatch');
  }
  return errors;
}

function expectedPaymentTermShape(term) {
  if (!term) return ['missing'];
  const errors = [];
  if (term.status !== 'active') errors.push(`status=${term.status}`);
  if (term.scheduleKind !== 'percent_split') errors.push('scheduleKind must be percent_split');
  const legs = Array.isArray(term.legs) ? term.legs : [];
  if (
    legs.length !== 2 ||
    legs[0].amountType !== 'percent_bps' ||
    legs[0].amountValue !== 4000 ||
    legs[0].dueRule !== 'checkout' ||
    legs[1].amountType !== 'remainder' ||
    legs[1].dueRule !== 'days_before_arrival' ||
    legs[1].dueOffsetDays !== 30
  ) {
    errors.push('legs must be 40% at checkout plus remainder 30 days before arrival');
  }
  return errors;
}

function auditWinterVillageCommercialData({
  ratePlans,
  paymentTerms,
  cancellationPolicies,
  inventory
} = {}) {
  const ratePlanResults = REQUIRED_RATE_PLAN_IDENTITIES.map((required) => {
    const plan = findByIdentity(ratePlans, required.code, required.version);
    const expected = expectedFixedPlan(required.code, required.version);
    const errors = [];
    if (!plan) {
      errors.push('missing');
    } else {
      if (plan.status !== 'active') errors.push(`status=${plan.status}`);
      if (plan.type !== required.type) errors.push(`type=${plan.type}`);
      if (expected) errors.push(...compareFixedPlan(plan, expected));
    }
    return {
      identity: identityKey(required.code, required.version),
      exists: !!plan,
      active: plan?.status === 'active',
      type: plan?.type || required.type,
      dates: plan
        ? {
            checkIn: plan.packageArrivalDate || plan.arrivalWindowStart || null,
            checkOut: plan.packageDepartureDate || plan.arrivalWindowEnd || null
          }
        : null,
      inventoryMode: plan?.inventoryMode || null,
      accommodations: plan?.accommodations || [],
      errors: [...new Set(errors)]
    };
  });

  const paymentTerm = findByIdentity(
    paymentTerms,
    PAYMENT_TERM_CODE,
    PAYMENT_TERM_VERSION
  );
  const cancellationPolicy = findByIdentity(
    cancellationPolicies,
    CANCELLATION_POLICY_CODE,
    CANCELLATION_POLICY_VERSION
  );
  const paymentTermErrors = expectedPaymentTermShape(paymentTerm);
  const cancellationErrors = !cancellationPolicy
    ? ['missing']
    : cancellationPolicy.status !== 'active'
      ? [`status=${cancellationPolicy.status}`]
      : [];

  const inventoryResults = ['a-frame', 'lux-cabin', 'stone-house'].map((key) => {
    const row = inventory?.[key] || null;
    const resources = Array.isArray(row?.resources) ? row.resources : [];
    const sellable = resources.filter(
      (resource) =>
        resource &&
        resource.isActive !== false &&
        !resource.archivedAt &&
        !['disabled', 'maintenance', 'retired'].includes(resource.salesStatus)
    );
    return {
      accommodationKey: key,
      entityType: row?.entityType || null,
      resourceIds: sellable.map((resource) => String(resource._id || resource.id || resource.slug || '')),
      activeCount: sellable.length,
      errors: row && sellable.length ? [] : ['no active physical inventory mapping']
    };
  });

  const errors = [
    ...ratePlanResults.flatMap((result) =>
      result.errors.map((error) => `${result.identity}: ${error}`)
    ),
    ...paymentTermErrors.map((error) => `${PAYMENT_TERM_CODE}@v${PAYMENT_TERM_VERSION}: ${error}`),
    ...cancellationErrors.map(
      (error) => `${CANCELLATION_POLICY_CODE}@v${CANCELLATION_POLICY_VERSION}: ${error}`
    ),
    ...inventoryResults.flatMap((result) =>
      result.errors.map((error) => `${result.accommodationKey}: ${error}`)
    )
  ];

  return {
    ok: errors.length === 0,
    errors,
    ratePlans: ratePlanResults,
    paymentTerm: {
      identity: identityKey(PAYMENT_TERM_CODE, PAYMENT_TERM_VERSION),
      exists: !!paymentTerm,
      active: paymentTerm?.status === 'active',
      errors: paymentTermErrors
    },
    cancellationPolicy: {
      identity: identityKey(CANCELLATION_POLICY_CODE, CANCELLATION_POLICY_VERSION),
      exists: !!cancellationPolicy,
      active: cancellationPolicy?.status === 'active',
      policyType: cancellationPolicy?.policyType || null,
      refundTiers: cancellationPolicy?.refundTiers || [],
      errors: cancellationErrors
    },
    inventory: inventoryResults
  };
}

async function loadWinterVillageCommercialReadiness() {
  const [ratePlans, paymentTerms, cancellationPolicies, inventory] = await Promise.all([
      RatePlan.find({
        $or: REQUIRED_RATE_PLAN_IDENTITIES.map(({ code, version }) => ({ code, version }))
      }).lean(),
      PaymentTermTemplate.find({ code: PAYMENT_TERM_CODE, version: PAYMENT_TERM_VERSION }).lean(),
      CancellationPolicy.find({
        code: CANCELLATION_POLICY_CODE,
        version: CANCELLATION_POLICY_VERSION
      }).lean(),
      resolveWinterVillageInventory()
    ]);
  return auditWinterVillageCommercialData({
    ratePlans,
    paymentTerms,
    cancellationPolicies,
    inventory
  });
}

module.exports = {
  REQUIRED_RATE_PLAN_IDENTITIES,
  auditWinterVillageCommercialData,
  loadWinterVillageCommercialReadiness,
  expectedPaymentTermShape,
  compareFixedPlan,
  validateAndNormalizeRatePlan
};
