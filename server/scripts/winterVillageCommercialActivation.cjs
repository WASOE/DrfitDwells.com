#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
const RatePlan = require('../models/RatePlan');
const PaymentTermTemplate = require('../models/PaymentTermTemplate');
const CancellationPolicy = require('../models/CancellationPolicy');
const {
  WINTER_VILLAGE_FIXED_RATE_PLANS,
  WINTER_VILLAGE_SEASONAL_RATE_PLAN,
  PAYMENT_TERM_CODE,
  PAYMENT_TERM_VERSION,
  CANCELLATION_POLICY_CODE,
  CANCELLATION_POLICY_VERSION
} = require('../config/winterVillageCommercialCatalog');
const {
  validateAndNormalizePaymentTermTemplate
} = require('../services/paymentTermService');
const {
  validateAndNormalizeCancellationPolicy
} = require('../services/cancellationPolicyService');
const {
  validateAndNormalizeRatePlan
} = require('../services/ratePlanService');
const ratePlanManagement = require('../services/ratePlanManagementService');
const paymentTermManagement = require('../services/paymentTermManagementService');
const {
  resolveWinterVillageInventory,
  inventoryMappingIsUsable
} = require('../services/winterVillageInventoryResolver');

const ACTIVATION_CONFIRM = 'ACTIVATE_WINTER_VILLAGE_COMMERCIAL_V1';

function buildPaymentTermDefinition() {
  return {
    code: PAYMENT_TERM_CODE,
    internalName: '40% now / 60% 30 days before arrival',
    version: PAYMENT_TERM_VERSION,
    status: 'draft',
    currency: 'EUR',
    scheduleKind: 'percent_split',
    allowDateTransfer: false,
    legs: [
      {
        sequence: 1,
        amountType: 'percent_bps',
        amountValue: 4000,
        dueRule: 'checkout',
        dueOffsetDays: 0,
        cancellationTreatment: 'stay_credit'
      },
      {
        sequence: 2,
        amountType: 'remainder',
        amountValue: null,
        dueRule: 'days_before_arrival',
        dueOffsetDays: 30,
        cancellationTreatment: 'standard_policy'
      }
    ]
  };
}

function buildCancellationPolicyDefinition() {
  return {
    code: CANCELLATION_POLICY_CODE,
    internalName: 'Normal stay standard cancellation policy',
    version: CANCELLATION_POLICY_VERSION,
    status: 'active',
    policyType: 'normal_stay',
    correctionWindowHours: 0,
    correctionWindowMinDaysBeforeArrival: 0,
    refundTiers: [
      { minDaysBeforeArrival: 14, maxDaysBeforeArrival: null, refundPercent: 100 },
      { minDaysBeforeArrival: 7, maxDaysBeforeArrival: 13, refundPercent: 50 },
      { minDaysBeforeArrival: 0, maxDaysBeforeArrival: 6, refundPercent: 0 }
    ],
    noShowRefundPercent: 0,
    earlyDepartureRefundPercent: 0,
    dateTransferRules: {
      enabled: false,
      maxTransfers: 0,
      minDaysBeforeArrival: null,
      compatibleRatePlanCodes: [],
      subjectToAvailability: true,
      higherPriceDifferencePayable: true,
      replacementBecomesNonRefundable: true
    },
    nameTransferRules: {
      enabled: false,
      maxTransfers: 0,
      minDaysBeforeArrival: null,
      free: true,
      identityOnly: true
    },
    organizerCancellationRule: {
      allowFullRefundOrReplacement: true,
      requiresManualExecution: true,
      ordinaryWeatherNotAutomatic: true,
      statutoryExceptionManualReview: true
    },
    nonQualifyingCancellationReasons: [],
    travelInsuranceRecommendation: '',
    legalReviewStatus: 'approved',
    legalApprovalMetadata: { reviewedAt: null, reviewedBy: null, notes: null }
  };
}

function buildRatePlanDefinitions() {
  return [WINTER_VILLAGE_SEASONAL_RATE_PLAN, ...WINTER_VILLAGE_FIXED_RATE_PLANS];
}

function identity(row) {
  return `${String(row.code).trim().toLowerCase()}@v${Number(row.version)}`;
}

function comparable(value) {
  const normalized = { ...value };
  for (const key of [
    '_id',
    '__v',
    'id',
    'status',
    'createdAt',
    'updatedAt',
    'createdBy',
    'updatedBy',
    'activatedAt',
    'activatedBy',
    'retiredAt',
    'retiredBy'
  ]) {
    delete normalized[key];
  }
  return JSON.stringify(normalized);
}

function classify(existing, definition, normalize, { requireActive = false } = {}) {
  if (!existing) return { action: 'CREATE', identity: identity(definition) };
  const expected = normalize(definition);
  const actual = normalize(existing);
  if (!expected.ok || !actual.ok || comparable(expected.value) !== comparable(actual.value)) {
    return { action: 'MISMATCH / STOP', identity: identity(definition) };
  }
  if (requireActive && existing.status !== 'active') {
    return { action: 'MISMATCH / STOP', identity: identity(definition), reason: 'must already be active' };
  }
  return {
    action: existing.status === 'active' ? 'ALREADY MATCHES' : 'ACTIVATE MATCHING DRAFT',
    identity: identity(definition),
    id: String(existing._id || existing.id || '')
  };
}

async function buildActivationPlan({ loadInventory = resolveWinterVillageInventory, models = {} } = {}) {
  const RatePlanModel = models.RatePlan || RatePlan;
  const PaymentTermModel = models.PaymentTermTemplate || PaymentTermTemplate;
  const CancellationPolicyModel = models.CancellationPolicy || CancellationPolicy;
  const ratePlanDefinitions = buildRatePlanDefinitions();
  const paymentTerm = buildPaymentTermDefinition();
  const cancellationPolicy = buildCancellationPolicyDefinition();
  const [existingPlans, existingPaymentTerms, existingPolicies, inventory] = await Promise.all([
    RatePlanModel.find({
      $or: ratePlanDefinitions.map((row) => ({ code: row.code, version: row.version }))
    }).lean(),
    PaymentTermModel.find({ code: PAYMENT_TERM_CODE, version: PAYMENT_TERM_VERSION }).lean(),
    CancellationPolicyModel.find({
      code: CANCELLATION_POLICY_CODE,
      version: CANCELLATION_POLICY_VERSION
    }).lean(),
    loadInventory()
  ]);

  const paymentValidation = validateAndNormalizePaymentTermTemplate(paymentTerm);
  const cancellationValidation = validateAndNormalizeCancellationPolicy(cancellationPolicy);
  const ratePlanValidation = ratePlanDefinitions.map((row) => ({
    identity: identity(row),
    result: validateAndNormalizeRatePlan(row)
  }));
  const inventoryResults = Object.fromEntries(
    Object.entries(inventory).map(([key, mapping]) => [
      key,
      { entityType: mapping.entityType, entityId: mapping.entityId, usable: inventoryMappingIsUsable(mapping) }
    ])
  );
  const actions = [
    classify(existingPaymentTerms[0], paymentTerm, validateAndNormalizePaymentTermTemplate),
    classify(existingPolicies[0], cancellationPolicy, validateAndNormalizeCancellationPolicy, { requireActive: true }),
    ...ratePlanDefinitions.map((definition) =>
      classify(existingPlans.find((row) => identity(row) === identity(definition)), definition, validateAndNormalizeRatePlan)
    )
  ];
  const errors = [
    ...(paymentValidation.ok ? [] : paymentValidation.errors),
    ...(cancellationValidation.ok ? [] : cancellationValidation.errors),
    ...ratePlanValidation.flatMap(({ identity: id, result }) =>
      result.ok ? [] : result.errors.map((error) => `${id}: ${error}`)
    ),
    ...Object.entries(inventoryResults)
      .filter(([, result]) => !result.usable)
      .map(([key]) => `${key}: inventory mapping is unresolved or not sellable`),
    ...actions.filter((row) => row.action === 'MISMATCH / STOP').map((row) => `${row.identity}: immutable content mismatch`)
  ];
  return { ok: errors.length === 0, errors, actions, inventory: inventoryResults };
}

async function executeActivation({ dryRun = true, operatorId, deps = {} } = {}) {
  const plan = await buildActivationPlan(deps);
  if (dryRun || !plan.ok) return { ...plan, dryRun: true, writes: 0 };
  if (process.env.WINTER_VILLAGE_ACTIVATION_CONFIRM !== ACTIVATION_CONFIRM) {
    throw new Error(`Set WINTER_VILLAGE_ACTIVATION_CONFIRM=${ACTIVATION_CONFIRM} to permit activation`);
  }
  if (!operatorId) throw new Error('operatorId is required for activation');

  const writes = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const payment = buildPaymentTermDefinition();
      const policy = buildCancellationPolicyDefinition();
      const ratePlans = buildRatePlanDefinitions();
      const existingPayment = await PaymentTermTemplate.findOne({
        code: payment.code,
        version: payment.version
      }).session(session);
      let paymentDoc = existingPayment;
      if (!paymentDoc) {
        paymentDoc = await paymentTermManagement.createDraftPaymentTermTemplate({
          input: payment,
          operator: operatorId,
          session
        });
        await paymentTermManagement.activatePaymentTermTemplate({
          id: paymentDoc.id,
          operator: operatorId,
          session
        });
        writes.push(identity(payment));
      } else if (paymentDoc.status !== 'active') {
        await paymentTermManagement.activatePaymentTermTemplate({
          id: paymentDoc._id,
          operator: operatorId,
          session
        });
        writes.push(`activate ${identity(payment)}`);
      }

      const existingPolicy = await CancellationPolicy.findOne({
        code: policy.code,
        version: policy.version
      }).session(session);
      if (existingPolicy && existingPolicy.status !== 'active') {
        throw new Error(`${identity(policy)} exists but is not active; refusing to mutate an immutable policy`);
      }
      if (!existingPolicy) {
        const normalized = validateAndNormalizeCancellationPolicy(policy);
        if (!normalized.ok) throw new Error(normalized.errors.join('; '));
        await CancellationPolicy.create([normalized.value], { session });
        writes.push(identity(policy));
      }

      for (const definition of ratePlans) {
        const existing = await RatePlan.findOne({
          code: definition.code,
          version: definition.version
        }).session(session);
        if (existing && existing.status === 'active') continue;
        const draft =
          existing ||
          (await ratePlanManagement.createRatePlanDraft(
            definition,
            { operatorId },
            { session }
          ));
        await ratePlanManagement.activateRatePlan(
          draft.id || draft._id,
          { operatorId },
          { session }
        );
        writes.push(identity(definition));
      }
    });
  } finally {
    await session.endSession();
  }
  return { ...plan, dryRun: false, writes: writes.length, written: writes };
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = !argv.includes('--activate');
  const operatorId = argv.find((arg) => arg.startsWith('--operator='))?.slice('--operator='.length);
  const { loadServerEnv } = require('../config/loadServerEnv');
  loadServerEnv();
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI or MONGO_URI is required');
  await mongoose.connect(uri, { readPreference: 'primaryPreferred' });
  try {
    const result = await executeActivation({ dryRun, operatorId });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ACTIVATION_CONFIRM,
  buildPaymentTermDefinition,
  buildCancellationPolicyDefinition,
  buildRatePlanDefinitions,
  classify,
  buildActivationPlan,
  executeActivation
};
