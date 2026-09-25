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

function dateOnly(value) {
  return value == null ? null : String(value).slice(0, 10);
}

function fixedPackageRangesOverlap(left, right) {
  const leftStart = dateOnly(left.packageArrivalDate);
  const leftEnd = dateOnly(left.packageDepartureDate);
  const rightStart = dateOnly(right.packageArrivalDate);
  const rightEnd = dateOnly(right.packageDepartureDate);
  return Boolean(
    leftStart &&
      leftEnd &&
      rightStart &&
      rightEnd &&
      leftStart < rightEnd &&
      rightStart < leftEnd
  );
}

function fixedPackageInventoryOverlaps(left, right) {
  const rightKeys = new Set(
    (Array.isArray(right.accommodations) ? right.accommodations : []).map(
      (row) => `${row.entityType}:${String(row.accommodationKey).toLowerCase()}`
    )
  );
  return (Array.isArray(left.accommodations) ? left.accommodations : []).some((row) =>
    rightKeys.has(`${row.entityType}:${String(row.accommodationKey).toLowerCase()}`)
  );
}

async function detectTransactionSupport(connection = mongoose.connection) {
  const hello = await connection.db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === 'isdbgrid');
}

function protectedPrerequisiteErrors(actions) {
  return actions
    .filter((row) =>
      ['split-40-60-30d@v1', 'normal-stay-standard@v1', 'winter-cabin-stay-2026-27@v2'].includes(
        row.identity
      ) && row.action !== 'ALREADY MATCHES'
    )
    .map((row) => `${row.identity}: must already match an active immutable prerequisite`);
}

async function buildActivationPlan({ loadInventory = resolveWinterVillageInventory, models = {} } = {}) {
  const RatePlanModel = models.RatePlan || RatePlan;
  const PaymentTermModel = models.PaymentTermTemplate || PaymentTermTemplate;
  const CancellationPolicyModel = models.CancellationPolicy || CancellationPolicy;
  const ratePlanDefinitions = buildRatePlanDefinitions();
  const fixedDefinitions = WINTER_VILLAGE_FIXED_RATE_PLANS;
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
  const activeFixedPlans = await RatePlanModel.find({
    status: 'active',
    type: 'fixed_package'
  }).lean();

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
  const conflictErrors = fixedDefinitions.flatMap((definition) =>
    activeFixedPlans
      .filter((existing) => identity(existing) !== identity(definition))
      .filter((existing) => fixedPackageRangesOverlap(existing, definition))
      .filter((existing) => fixedPackageInventoryOverlaps(existing, definition))
      .map(
        (existing) =>
          `${identity(definition)}: conflicts with active fixed package ${identity(existing)}`
      )
  );
  const errors = [
    ...(paymentValidation.ok ? [] : paymentValidation.errors),
    ...(cancellationValidation.ok ? [] : cancellationValidation.errors),
    ...ratePlanValidation.flatMap(({ identity: id, result }) =>
      result.ok ? [] : result.errors.map((error) => `${id}: ${error}`)
    ),
    ...Object.entries(inventoryResults)
      .filter(([, result]) => !result.usable)
      .map(([key]) => `${key}: inventory mapping is unresolved or not sellable`),
    ...protectedPrerequisiteErrors(actions),
    ...conflictErrors,
    ...actions.filter((row) => row.action === 'MISMATCH / STOP').map((row) => `${row.identity}: immutable content mismatch`)
  ];
  return { ok: errors.length === 0, errors, actions, inventory: inventoryResults };
}

async function activateOneFixedRatePlan(
  definition,
  { operatorId, models = {}, session = null, management = ratePlanManagement } = {}
) {
  const RatePlanModel = models.RatePlan || RatePlan;
  const existingQuery = RatePlanModel.findOne({
    code: definition.code,
    version: definition.version
  });
  const existing = await (session ? existingQuery.session(session) : existingQuery).lean();
  if (existing) {
    const action = classify(existing, definition, validateAndNormalizeRatePlan);
    if (action.action === 'ALREADY MATCHES') return action;
    if (action.action !== 'ACTIVATE MATCHING DRAFT' || existing.status !== 'draft') {
      throw new Error(`${action.identity}: immutable content mismatch or invalid existing status`);
    }
    const expected = validateAndNormalizeRatePlan(definition);
    const actual = validateAndNormalizeRatePlan(existing);
    if (!expected.ok || !actual.ok || comparable(expected.value) !== comparable(actual.value)) {
      throw new Error(`${identity(definition)}: persisted draft fingerprint mismatch`);
    }
    const activated = await management.activateRatePlan(
      existing._id,
      { operatorId },
      { ...models, RatePlan: RatePlanModel, session }
    );
    const activeQuery = RatePlanModel.findById(existing._id);
    const persistedActive = await (session ? activeQuery.session(session) : activeQuery).lean();
    const activeValidation = validateAndNormalizeRatePlan(persistedActive);
    if (
      !persistedActive ||
      persistedActive.status !== 'active' ||
      !activeValidation.ok ||
      comparable(activeValidation.value) !== comparable(expected.value)
    ) {
      throw new Error(`${identity(definition)}: activation did not produce an active record`);
    }
    return { action: 'ACTIVATE MATCHING DRAFT', identity: identity(definition), id: String(existing._id) };
  }

  const draft = await management.createRatePlanDraft(
    definition,
    { operatorId },
    { ...models, RatePlan: RatePlanModel, session }
  );
  const draftQuery = RatePlanModel.findById(draft.id || draft._id);
  const persistedDraft = await (session ? draftQuery.session(session) : draftQuery).lean();
  const expected = validateAndNormalizeRatePlan(definition);
  const actual = validateAndNormalizeRatePlan(persistedDraft);
  if (!expected.ok || !actual.ok || comparable(expected.value) !== comparable(actual.value)) {
    throw new Error(`${identity(definition)}: persisted draft fingerprint mismatch`);
  }
  const activated = await management.activateRatePlan(
    draft.id || draft._id,
    { operatorId },
    { ...models, RatePlan: RatePlanModel, session }
  );
  const activeQuery = RatePlanModel.findById(draft.id || draft._id);
  const persistedActive = await (session ? activeQuery.session(session) : activeQuery).lean();
  const activeValidation = validateAndNormalizeRatePlan(persistedActive);
  if (
    !persistedActive ||
    persistedActive.status !== 'active' ||
    !activeValidation.ok ||
    comparable(activeValidation.value) !== comparable(expected.value)
  ) {
    throw new Error(`${identity(definition)}: active record verification failed`);
  }
  return { action: 'CREATE', identity: identity(definition), id: String(activated.id || activated._id) };
}

async function executeStandaloneActivation(
  ratePlanDefinitions,
  { operatorId, models = {}, management = ratePlanManagement, session = null } = {}
) {
  const written = [];
  const succeeded = [];
  for (let index = 0; index < ratePlanDefinitions.length; index += 1) {
    const definition = ratePlanDefinitions[index];
    try {
      const result = await activateOneFixedRatePlan({ ...definition }, {
        operatorId,
        models,
        management,
        session
      });
      succeeded.push(result.identity);
      if (result.action === 'CREATE' || result.action === 'ACTIVATE MATCHING DRAFT') {
        written.push(result.identity);
      }
    } catch (error) {
      const RatePlanModel = models.RatePlan || RatePlan;
      const persistedQuery = RatePlanModel.findOne({
        code: definition.code,
        version: definition.version
      });
      const persisted = await (session ? persistedQuery.session(session) : persistedQuery).lean();
      const persistedAction = persisted && classify(persisted, definition, validateAndNormalizeRatePlan);
      if (persistedAction?.action === 'ALREADY MATCHES') {
        succeeded.push(persistedAction.identity);
        written.push(persistedAction.identity);
      }
      return {
        ok: false,
        error: error.message,
        succeeded,
        failed: persistedAction?.action === 'ALREADY MATCHES'
          ? identity(ratePlanDefinitions[index + 1] || definition)
          : identity(definition),
        written,
        writes: written.length
      };
    }
  }
  return { ok: true, succeeded, written, writes: written.length };
}

async function executeTransactionalActivation(
  ratePlanDefinitions,
  { operatorId, models = {}, management = ratePlanManagement } = {}
) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await executeStandaloneActivation(ratePlanDefinitions, {
        operatorId,
        models,
        session,
        management
      });
      if (!result.ok) throw new Error(result.error);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function executeActivation({ dryRun = true, operatorId, deps = {} } = {}) {
  const plan = await buildActivationPlan(deps);
  const transactionSupported =
    deps.transactionSupported != null
      ? Boolean(deps.transactionSupported)
      : await (deps.detectTransactionSupport || detectTransactionSupport)();
  const mode = transactionSupported ? 'transaction' : 'standalone_resumable';
  if (dryRun || !plan.ok) return { ...plan, mode, dryRun: true, writes: 0 };
  if (process.env.WINTER_VILLAGE_ACTIVATION_CONFIRM !== ACTIVATION_CONFIRM) {
    throw new Error(`Set WINTER_VILLAGE_ACTIVATION_CONFIRM=${ACTIVATION_CONFIRM} to permit activation`);
  }
  if (!operatorId) throw new Error('operatorId is required for activation');

  const ratePlans = WINTER_VILLAGE_FIXED_RATE_PLANS;
  const result =
    mode === 'transaction'
      ? await executeTransactionalActivation(ratePlans, {
          operatorId,
          models: deps.models,
          management: deps.management
        })
      : await executeStandaloneActivation(ratePlans, {
          operatorId,
          models: deps.models,
          management: deps.management
        });
  return { ...plan, ...result, mode, dryRun: false };
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
