/**
 * RatePlan management service (RP1).
 *
 * Safe operator lifecycle for seasonal RatePlans: draft create/update, clone,
 * activate, retire. Does not change quote-selection or pricing algorithms.
 *
 * Seasonal activation is serialized with a fail-closed native MongoDB lock
 * (`rateplanactivationlocks` / `_id: seasonal-rateplan-activation`) via
 * insertOne uniqueness. No transactions, TTL, or lock stealing. Orphan locks
 * block future activations rather than risk overlapping actives. Quote
 * selection still fails closed on AMBIGUOUS_SEASONAL_RATE_PLAN.
 */
'use strict';

const crypto = require('crypto');

const {
  validateAndNormalizeRatePlan,
  RATE_PLAN_TYPES,
  RATE_PLAN_CURRENCIES,
  INVENTORY_MODES
} = require('./ratePlanService');

const RatePlanModel = require('../models/RatePlan');
const CabinModel = require('../models/Cabin');
const CabinTypeModel = require('../models/CabinType');
const CancellationPolicyModel = require('../models/CancellationPolicy');
const PaymentTermTemplateModel = require('../models/PaymentTermTemplate');
const {
  assertActivePaymentTermTemplate,
  PaymentTermError
} = require('./paymentTermService');

const ACTIVATION_LOCK_COLLECTION_NAME = 'rateplanactivationlocks';
const ACTIVATION_LOCK_ID = 'seasonal-rateplan-activation';

const MANAGEMENT_ERROR_CODES = Object.freeze({
  INVALID_OPERATOR: 'INVALID_OPERATOR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  ACCOMMODATION_NOT_FOUND: 'ACCOMMODATION_NOT_FOUND',
  ACCOMMODATION_INACTIVE: 'ACCOMMODATION_INACTIVE',
  ACCOMMODATION_ENTITY_MISMATCH: 'ACCOMMODATION_ENTITY_MISMATCH',
  CANCELLATION_POLICY_NOT_FOUND: 'CANCELLATION_POLICY_NOT_FOUND',
  PAYMENT_TERM_NOT_FOUND: 'PAYMENT_TERM_NOT_FOUND',
  PAYMENT_TERM_NOT_ACTIVE: 'PAYMENT_TERM_NOT_ACTIVE',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  IMMUTABLE_PLAN: 'IMMUTABLE_PLAN',
  IDENTITY_IMMUTABLE: 'IDENTITY_IMMUTABLE',
  NOT_FOUND: 'NOT_FOUND',
  STALE_REVISION: 'STALE_REVISION',
  DUPLICATE_VERSION: 'DUPLICATE_VERSION',
  SEASONAL_OVERLAP: 'SEASONAL_OVERLAP',
  ACTIVATION_BUSY: 'ACTIVATION_BUSY',
  ACTIVATION_LOCK_UNCERTAIN: 'ACTIVATION_LOCK_UNCERTAIN',
  LOCK_RELEASE_DENIED: 'LOCK_RELEASE_DENIED',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  HARD_DELETE_FORBIDDEN: 'HARD_DELETE_FORBIDDEN'
});

const OPERATIONAL_WARNING_CODES = Object.freeze({
  ACTIVATION_LOCK_RELEASE_FAILED: 'ACTIVATION_LOCK_RELEASE_FAILED'
});

class RatePlanManagementError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'RatePlanManagementError';
    this.code = code;
    this.details = details;
  }
}

const BUSINESS_FIELD_KEYS = Object.freeze([
  'code',
  'internalName',
  'version',
  'type',
  'currency',
  'arrivalWindowStart',
  'arrivalWindowEnd',
  'bookingWindowStart',
  'bookingWindowEnd',
  'minNights',
  'packageArrivalDate',
  'packageDepartureDate',
  'inventoryMode',
  'requiresFullPayment',
  'cancellationPolicyCode',
  'cancellationPolicyVersion',
  'paymentTermCode',
  'paymentTermVersion',
  'inclusions',
  'accommodations'
]);

const CLIENT_LIFECYCLE_KEYS = Object.freeze([
  'status',
  'createdBy',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'retiredAt',
  'retiredBy',
  '_id',
  'id',
  'createdAt',
  'updatedAt',
  '__v'
]);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function getDeps(deps = {}) {
  return {
    RatePlan: deps.RatePlan || RatePlanModel,
    Cabin: deps.Cabin || CabinModel,
    CabinType: deps.CabinType || CabinTypeModel,
    CancellationPolicy: deps.CancellationPolicy || CancellationPolicyModel,
    PaymentTermTemplate: deps.PaymentTermTemplate || PaymentTermTemplateModel,
    now: typeof deps.now === 'function' ? deps.now : () => new Date(),
    session: deps.session || null,
    activationLockCollection: deps.activationLockCollection || null
  };
}

function resolveActivationLockCollection(deps) {
  if (deps.activationLockCollection) {
    return deps.activationLockCollection;
  }
  const db = deps.RatePlan && deps.RatePlan.db;
  if (!db || typeof db.collection !== 'function') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'Seasonal activation lock collection is unavailable'
    );
  }
  return db.collection(ACTIVATION_LOCK_COLLECTION_NAME);
}

/**
 * Acquire the global seasonal activation lock.
 * Owner token is always server-generated; callers must never supply it.
 * Unacknowledged or uncertain insertOne outcomes are resolved by re-reading
 * the fixed lock document and proving exact owner-token match.
 * @returns {Promise<string>} ownerToken
 */
async function acquireSeasonalActivationLock(deps = {}) {
  const d = getDeps(deps);
  const col = resolveActivationLockCollection(d);
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const acquiredAt = d.now();

  let needsOwnershipVerify = false;
  try {
    const insertResult = await col.insertOne({
      _id: ACTIVATION_LOCK_ID,
      ownerToken,
      acquiredAt
    });
    if (!insertResult || insertResult.acknowledged === false) {
      needsOwnershipVerify = true;
    }
  } catch (_err) {
    // Duplicate key, network blip, or write-then-throw: never trust the throw alone.
    needsOwnershipVerify = true;
  }

  if (!needsOwnershipVerify) {
    return ownerToken;
  }

  let existing = null;
  try {
    existing = await col.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_readErr) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.ACTIVATION_LOCK_UNCERTAIN,
      'Seasonal activation lock ownership could not be confirmed',
      { lockId: ACTIVATION_LOCK_ID }
    );
  }

  if (existing && String(existing.ownerToken) === ownerToken) {
    return ownerToken;
  }
  if (existing) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY,
      'Another seasonal rate plan activation is in progress',
      { lockId: ACTIVATION_LOCK_ID }
    );
  }
  throw new RatePlanManagementError(
    MANAGEMENT_ERROR_CODES.ACTIVATION_LOCK_UNCERTAIN,
    'Seasonal activation lock ownership could not be confirmed',
    { lockId: ACTIVATION_LOCK_ID }
  );
}

/**
 * Release the lock only when `_id` and `ownerToken` both match.
 * Forged or foreign tokens are rejected (fail closed).
 * Direct API for operators/tests; activation uses attemptReleaseOwnedLock.
 */
async function releaseSeasonalActivationLock(ownerToken, deps = {}) {
  if (ownerToken == null || String(ownerToken).trim() === '') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.LOCK_RELEASE_DENIED,
      'Lock owner token is required'
    );
  }
  const d = getDeps(deps);
  const col = resolveActivationLockCollection(d);
  const result = await col.deleteOne({
    _id: ACTIVATION_LOCK_ID,
    ownerToken: String(ownerToken)
  });
  if (!result || Number(result.deletedCount) !== 1) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.LOCK_RELEASE_DENIED,
      'Activation lock release denied: owner token mismatch or lock absent',
      { lockId: ACTIVATION_LOCK_ID }
    );
  }
}

/**
 * Best-effort owned-lock release for the activation path.
 * Never throws raw DB errors. Never deletes a foreign-owner lock.
 * After an uncertain owned delete, verify the current lock document:
 * - absent → our lock is gone → released
 * - different ownerToken → our lock is gone → released
 * - our exact ownerToken → our lock remains → not released
 * - verification unreadable → fail closed → not released
 * @returns {Promise<{ released: boolean }>}
 */
async function attemptReleaseOwnedLock(ownerToken, deps) {
  const col = resolveActivationLockCollection(deps);
  const ours = String(ownerToken);
  try {
    const result = await col.deleteOne({
      _id: ACTIVATION_LOCK_ID,
      ownerToken: ours
    });
    if (result && Number(result.deletedCount) === 1) {
      return { released: true };
    }
  } catch (_err) {
    // fall through to verification
  }

  let existing = null;
  try {
    existing = await col.findOne({ _id: ACTIVATION_LOCK_ID });
  } catch (_readErr) {
    return { released: false };
  }

  if (!existing) {
    return { released: true };
  }
  if (String(existing.ownerToken) !== ours) {
    // Foreign owner holds the lock document — our owned lock is absent.
    return { released: true };
  }
  return { released: false };
}

function attachLockCleanupWarning(err) {
  const details =
    err && err.details && typeof err.details === 'object' && !Array.isArray(err.details)
      ? { ...err.details }
      : {};
  details.lockCleanupRequired = true;
  const prior = Array.isArray(details.operationalWarnings) ? details.operationalWarnings : [];
  if (!prior.some((w) => w && w.code === OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED)) {
    details.operationalWarnings = [
      ...prior,
      { code: OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED }
    ];
  } else {
    details.operationalWarnings = prior;
  }
  err.details = details;
  return err;
}

function buildActivationSuccessResult(plan, { lockReleased, usedLock }) {
  const warnings = [];
  if (usedLock && !lockReleased) {
    warnings.push({ code: OPERATIONAL_WARNING_CODES.ACTIVATION_LOCK_RELEASE_FAILED });
  }
  return {
    ...plan,
    activationCommitted: true,
    lockReleased: usedLock ? lockReleased : true,
    operationalWarnings: warnings
  };
}

function normalizeOperator(operatorId) {
  if (operatorId == null) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_OPERATOR,
      'Operator identity is required'
    );
  }
  const id = String(operatorId).trim();
  if (!id) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_OPERATOR,
      'Operator identity is required'
    );
  }
  if (id.length > 160) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_OPERATOR,
      'Operator identity is too long'
    );
  }
  return id;
}

function stripClientLifecycle(input) {
  if (!input || typeof input !== 'object') return {};
  const out = { ...input };
  for (const key of CLIENT_LIFECYCLE_KEYS) {
    delete out[key];
  }
  return out;
}

function dateOnlyToUtcDate(dateOnly) {
  if (dateOnly == null || dateOnly === '') return null;
  if (dateOnly instanceof Date) {
    if (Number.isNaN(dateOnly.getTime())) return null;
    return new Date(
      Date.UTC(dateOnly.getUTCFullYear(), dateOnly.getUTCMonth(), dateOnly.getUTCDate())
    );
  }
  const s = String(dateOnly).trim().slice(0, 10);
  if (!DATE_ONLY_RE.test(s)) return null;
  const [yy, mm, dd] = s.split('-').map(Number);
  return new Date(Date.UTC(yy, mm - 1, dd));
}

function toDateOnlyString(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && DATE_ONLY_RE.test(value.slice(0, 10))) {
    return value.slice(0, 10);
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

function compareDateOnly(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Inclusive calendar-night windows overlap when they share any night.
 * Adjacent seasons (end then next start = end+1 day) do not overlap.
 */
function inclusiveDateWindowsOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return compareDateOnly(startA, endB) <= 0 && compareDateOnly(startB, endA) <= 0;
}

function planToPlain(plan) {
  if (!plan) return null;
  if (typeof plan.toObject === 'function') {
    return plan.toObject({ depopulate: true });
  }
  return { ...plan };
}

function persistableFromNormalized(normalized) {
  const out = {};
  for (const key of BUSINESS_FIELD_KEYS) {
    if (!(key in normalized)) continue;
    const value = normalized[key];
    if (
      key === 'arrivalWindowStart' ||
      key === 'arrivalWindowEnd' ||
      key === 'bookingWindowStart' ||
      key === 'bookingWindowEnd' ||
      key === 'packageArrivalDate' ||
      key === 'packageDepartureDate'
    ) {
      out[key] = dateOnlyToUtcDate(value);
    } else if (key === 'accommodations') {
      out[key] = (value || []).map((row) => ({ ...row }));
    } else if (key === 'inclusions') {
      out[key] = Array.isArray(value) ? [...value] : [];
    } else {
      out[key] = value;
    }
  }
  return out;
}

function toPublicPlan(doc) {
  const plain = planToPlain(doc);
  if (!plain) return null;
  const revisionRaw = plain.__v != null ? plain.__v : doc && doc.__v;
  return {
    id: plain._id != null ? String(plain._id) : null,
    revision: revisionRaw != null ? Number(revisionRaw) : 0,
    code: plain.code,
    internalName: plain.internalName,
    version: plain.version,
    status: plain.status,
    type: plain.type,
    currency: plain.currency,
    arrivalWindowStart: toDateOnlyString(plain.arrivalWindowStart),
    arrivalWindowEnd: toDateOnlyString(plain.arrivalWindowEnd),
    bookingWindowStart: toDateOnlyString(plain.bookingWindowStart),
    bookingWindowEnd: toDateOnlyString(plain.bookingWindowEnd),
    minNights: plain.minNights,
    packageArrivalDate: toDateOnlyString(plain.packageArrivalDate),
    packageDepartureDate: toDateOnlyString(plain.packageDepartureDate),
    inventoryMode: plain.inventoryMode,
    requiresFullPayment: plain.requiresFullPayment === true,
    cancellationPolicyCode: plain.cancellationPolicyCode,
    cancellationPolicyVersion: plain.cancellationPolicyVersion,
    paymentTermCode: plain.paymentTermCode ?? null,
    paymentTermVersion:
      plain.paymentTermVersion != null ? Number(plain.paymentTermVersion) : null,
    inclusions: Array.isArray(plain.inclusions) ? [...plain.inclusions] : [],
    accommodations: Array.isArray(plain.accommodations)
      ? plain.accommodations.map((row) => ({ ...row }))
      : [],
    createdBy: plain.createdBy ?? null,
    updatedBy: plain.updatedBy ?? null,
    activatedAt: plain.activatedAt ? new Date(plain.activatedAt).toISOString() : null,
    activatedBy: plain.activatedBy ?? null,
    retiredAt: plain.retiredAt ? new Date(plain.retiredAt).toISOString() : null,
    retiredBy: plain.retiredBy ?? null,
    createdAt: plain.createdAt ? new Date(plain.createdAt).toISOString() : null,
    updatedAt: plain.updatedAt ? new Date(plain.updatedAt).toISOString() : null
  };
}

function assertNormalizedSeasonalDraft(normalized) {
  if (!normalized.ok) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'Rate plan validation failed',
      { errors: normalized.errors }
    );
  }
  const value = normalized.value;
  if (value.type !== 'seasonal_stay') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.UNSUPPORTED_TYPE,
      'RP1 management create/update accepts seasonal_stay only'
    );
  }
  if (!RATE_PLAN_CURRENCIES.includes(value.currency)) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'Unsupported currency'
    );
  }
  if (value.inventoryMode !== 'shared') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'seasonal_stay inventoryMode must be shared',
      { inventoryMode: value.inventoryMode, allowed: INVENTORY_MODES }
    );
  }
  if (!value.arrivalWindowStart || !value.arrivalWindowEnd) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'seasonal_stay requires a valid arrival window'
    );
  }
  return value;
}

async function assertAccommodationIdentities(accommodations, deps) {
  const { Cabin, CabinType, session } = deps;
  for (const row of accommodations) {
    const key = String(row.accommodationKey || '')
      .trim()
      .toLowerCase();
    const entityType = row.entityType;
    const query = { slug: key };
    const opts = session ? { session } : {};

    if (entityType === 'cabin') {
      const cabin = await Cabin.findOne(query, null, opts).lean();
      if (!cabin) {
        throw new RatePlanManagementError(
          MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND,
          `No cabin found for slug "${key}"`,
          { accommodationKey: key, entityType }
        );
      }
      if (cabin.isActive !== true) {
        throw new RatePlanManagementError(
          MANAGEMENT_ERROR_CODES.ACCOMMODATION_INACTIVE,
          `Cabin "${key}" is not active`,
          { accommodationKey: key, entityType }
        );
      }
    } else if (entityType === 'cabinType') {
      const cabinType = await CabinType.findOne(query, null, opts).lean();
      if (!cabinType) {
        throw new RatePlanManagementError(
          MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND,
          `No cabinType found for slug "${key}"`,
          { accommodationKey: key, entityType }
        );
      }
      if (cabinType.isActive !== true) {
        throw new RatePlanManagementError(
          MANAGEMENT_ERROR_CODES.ACCOMMODATION_INACTIVE,
          `CabinType "${key}" is not active`,
          { accommodationKey: key, entityType }
        );
      }
    } else {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.ACCOMMODATION_ENTITY_MISMATCH,
        `Unsupported entityType "${entityType}"`,
        { accommodationKey: key, entityType }
      );
    }
  }
}

async function assertCancellationPolicyExists(code, version, deps) {
  const { CancellationPolicy, session } = deps;
  const wantedCode = String(code || '')
    .trim()
    .toLowerCase();
  const wantedVersion = Number(version);
  const opts = session ? { session } : {};
  const policy = await CancellationPolicy.findOne(
    { code: wantedCode, version: wantedVersion },
    null,
    opts
  ).lean();
  if (!policy) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.CANCELLATION_POLICY_NOT_FOUND,
      `Cancellation policy ${wantedCode}@v${wantedVersion} was not found`,
      { cancellationPolicyCode: wantedCode, cancellationPolicyVersion: wantedVersion }
    );
  }
  return policy;
}

/**
 * NEW activation may only attach a currently active payment-term template.
 * Absence is allowed (full-payment default). Historical pinned versions remain
 * resolvable via paymentTermService.resolvePaymentTermTemplate regardless of status.
 */
async function assertPaymentTermActiveIfPresent(code, version, deps) {
  if (code == null || version == null) return null;
  try {
    return await assertActivePaymentTermTemplate(code, version, {
      PaymentTermTemplate: deps.PaymentTermTemplate,
      session: deps.session
    });
  } catch (err) {
    if (err instanceof PaymentTermError) {
      const mapped =
        err.code === 'PAYMENT_TERM_NOT_ACTIVE'
          ? MANAGEMENT_ERROR_CODES.PAYMENT_TERM_NOT_ACTIVE
          : MANAGEMENT_ERROR_CODES.PAYMENT_TERM_NOT_FOUND;
      throw new RatePlanManagementError(mapped, err.message, err.details);
    }
    throw err;
  }
}

function windowFromPlanPlain(plain) {
  return {
    start: toDateOnlyString(plain.arrivalWindowStart),
    end: toDateOnlyString(plain.arrivalWindowEnd)
  };
}

/**
 * Find active seasonal conflicts for the candidate plan's accommodations.
 * Same code+version (self) is ignored. Draft/retired ignored.
 */
async function findSeasonalActivationConflicts(candidate, deps) {
  const { RatePlan, session } = deps;
  if (candidate.type !== 'seasonal_stay') return [];

  const opts = session ? { session } : {};
  const actives = await RatePlan.find(
    { status: 'active', type: 'seasonal_stay' },
    null,
    opts
  ).lean();

  const candWindow = windowFromPlanPlain(candidate);
  const conflicts = [];

  for (const active of actives) {
    if (active.code === candidate.code && Number(active.version) === Number(candidate.version)) {
      continue;
    }
    const activeWindow = windowFromPlanPlain(active);
    if (!inclusiveDateWindowsOverlap(candWindow.start, candWindow.end, activeWindow.start, activeWindow.end)) {
      continue;
    }
    const activeRows = Array.isArray(active.accommodations) ? active.accommodations : [];
    const candRows = Array.isArray(candidate.accommodations) ? candidate.accommodations : [];
    for (const crow of candRows) {
      for (const arow of activeRows) {
        if (
          crow.entityType === arow.entityType &&
          String(crow.accommodationKey).toLowerCase() === String(arow.accommodationKey).toLowerCase()
        ) {
          conflicts.push({
            code: active.code,
            version: active.version,
            entityType: crow.entityType,
            accommodationKey: String(crow.accommodationKey).toLowerCase(),
            conflictingWindow: {
              arrivalWindowStart: activeWindow.start,
              arrivalWindowEnd: activeWindow.end
            }
          });
        }
      }
    }
  }

  return conflicts;
}

async function validateBusinessPayloadForPersist(rawInput, { forceType } = {}, deps) {
  const cleaned = stripClientLifecycle(rawInput);
  if (forceType) cleaned.type = forceType;

  const normalized = validateAndNormalizeRatePlan(cleaned);
  const value = assertNormalizedSeasonalDraft(normalized);

  await assertAccommodationIdentities(value.accommodations, deps);
  await assertCancellationPolicyExists(
    value.cancellationPolicyCode,
    value.cancellationPolicyVersion,
    deps
  );

  return value;
}

function withQuerySession(query, session) {
  if (session) return query.session(session);
  return query;
}

async function listRatePlans(filters = {}, deps = {}) {
  const d = getDeps(deps);
  const query = {};
  if (filters.status) query.status = String(filters.status);
  if (filters.type) query.type = String(filters.type);
  if (filters.code) query.code = String(filters.code).trim().toLowerCase();

  const docs = await withQuerySession(
    d.RatePlan.find(query).sort({ code: 1, version: -1 }),
    d.session
  ).lean();

  return docs.map((doc) => toPublicPlan(doc));
}

async function createRatePlanDraft(input, { operatorId } = {}, deps = {}) {
  const d = getDeps(deps);
  const operator = normalizeOperator(operatorId);
  const value = await validateBusinessPayloadForPersist(input, { forceType: 'seasonal_stay' }, d);

  const now = d.now();
  const docPayload = {
    ...persistableFromNormalized(value),
    status: 'draft',
    createdBy: operator,
    updatedBy: operator,
    activatedAt: null,
    activatedBy: null,
    retiredAt: null,
    retiredBy: null
  };

  try {
    let doc;
    if (d.session) {
      const created = await d.RatePlan.create([docPayload], { session: d.session });
      doc = created[0];
    } else {
      doc = await d.RatePlan.create(docPayload);
    }
    return toPublicPlan(doc);
  } catch (err) {
    if (err && err.code === 11000) {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.DUPLICATE_VERSION,
        `Rate plan ${value.code}@v${value.version} already exists`,
        { code: value.code, version: value.version }
      );
    }
    throw err;
  }
}

async function loadPlanByIdOrThrow(id, deps) {
  const { RatePlan, session } = deps;
  const doc = await withQuerySession(RatePlan.findById(id), session);
  if (!doc) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.NOT_FOUND,
      'Rate plan not found',
      { id: String(id) }
    );
  }
  return doc;
}

async function updateRatePlanDraft(id, patch, { operatorId, expectedRevision } = {}, deps = {}) {
  const d = getDeps(deps);
  const operator = normalizeOperator(operatorId);
  const doc = await loadPlanByIdOrThrow(id, d);

  if (doc.status !== 'draft') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.IMMUTABLE_PLAN,
      `Only draft rate plans may be edited (status=${doc.status})`,
      { id: String(id), status: doc.status }
    );
  }

  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.STALE_REVISION,
      'Rate plan was modified by another operator; reload and retry',
      { id: String(id), expectedRevision: Number(expectedRevision), actualRevision: Number(doc.__v) }
    );
  }

  const cleanedPatch = stripClientLifecycle(patch || {});
  if (cleanedPatch.code != null && String(cleanedPatch.code).trim().toLowerCase() !== doc.code) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.IDENTITY_IMMUTABLE,
      'code cannot be changed; clone as next version instead'
    );
  }
  if (cleanedPatch.version != null && Number(cleanedPatch.version) !== Number(doc.version)) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.IDENTITY_IMMUTABLE,
      'version cannot be changed; clone as next version instead'
    );
  }

  const currentPlain = planToPlain(doc);
  const mergedInput = {
    code: doc.code,
    version: doc.version,
    internalName: currentPlain.internalName,
    type: currentPlain.type,
    currency: currentPlain.currency,
    arrivalWindowStart: toDateOnlyString(currentPlain.arrivalWindowStart),
    arrivalWindowEnd: toDateOnlyString(currentPlain.arrivalWindowEnd),
    bookingWindowStart: toDateOnlyString(currentPlain.bookingWindowStart),
    bookingWindowEnd: toDateOnlyString(currentPlain.bookingWindowEnd),
    minNights: currentPlain.minNights,
    packageArrivalDate: toDateOnlyString(currentPlain.packageArrivalDate),
    packageDepartureDate: toDateOnlyString(currentPlain.packageDepartureDate),
    inventoryMode: currentPlain.inventoryMode,
    requiresFullPayment: currentPlain.requiresFullPayment,
    cancellationPolicyCode: currentPlain.cancellationPolicyCode,
    cancellationPolicyVersion: currentPlain.cancellationPolicyVersion,
    paymentTermCode: currentPlain.paymentTermCode ?? null,
    paymentTermVersion:
      currentPlain.paymentTermVersion != null ? Number(currentPlain.paymentTermVersion) : null,
    inclusions: currentPlain.inclusions,
    accommodations: currentPlain.accommodations,
    ...cleanedPatch,
    code: doc.code,
    version: doc.version,
    type: 'seasonal_stay'
  };

  const value = await validateBusinessPayloadForPersist(mergedInput, { forceType: 'seasonal_stay' }, d);
  const persistable = persistableFromNormalized(value);

  // Explicit allowlisted field assignment — never Object.assign / $set of raw patch.
  for (const key of BUSINESS_FIELD_KEYS) {
    if (key === 'code' || key === 'version') continue;
    doc[key] = persistable[key];
  }
  doc.status = 'draft';
  doc.updatedBy = operator;
  doc.activatedAt = null;
  doc.activatedBy = null;
  doc.retiredAt = null;
  doc.retiredBy = null;
  // Mongoose 8 does not auto-bump __v unless optimisticConcurrency is on;
  // increment() engages the document version key for optimistic concurrency.
  doc.increment();

  try {
    await doc.save(d.session ? { session: d.session } : undefined);
  } catch (err) {
    if (err && err.name === 'VersionError') {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.STALE_REVISION,
        'Rate plan was modified by another operator; reload and retry',
        { id: String(id) }
      );
    }
    throw err;
  }

  return toPublicPlan(doc);
}

async function cloneRatePlanAsNextDraftVersion(id, { operatorId } = {}, deps = {}) {
  const d = getDeps(deps);
  const operator = normalizeOperator(operatorId);
  const source = await loadPlanByIdOrThrow(id, d);
  const plain = planToPlain(source);

  const maxDoc = await withQuerySession(
    d.RatePlan.findOne({ code: source.code }).sort({ version: -1 }).select({ version: 1 }),
    d.session
  ).lean();
  const nextVersion = (maxDoc && maxDoc.version != null ? Number(maxDoc.version) : Number(source.version)) + 1;

  const cloneInput = {
    code: plain.code,
    internalName: plain.internalName,
    version: nextVersion,
    type: plain.type,
    currency: plain.currency,
    arrivalWindowStart: toDateOnlyString(plain.arrivalWindowStart),
    arrivalWindowEnd: toDateOnlyString(plain.arrivalWindowEnd),
    bookingWindowStart: toDateOnlyString(plain.bookingWindowStart),
    bookingWindowEnd: toDateOnlyString(plain.bookingWindowEnd),
    minNights: plain.minNights,
    packageArrivalDate: toDateOnlyString(plain.packageArrivalDate),
    packageDepartureDate: toDateOnlyString(plain.packageDepartureDate),
    inventoryMode: plain.inventoryMode,
    requiresFullPayment: plain.requiresFullPayment,
    cancellationPolicyCode: plain.cancellationPolicyCode,
    cancellationPolicyVersion: plain.cancellationPolicyVersion,
    paymentTermCode: plain.paymentTermCode ?? null,
    paymentTermVersion:
      plain.paymentTermVersion != null ? Number(plain.paymentTermVersion) : null,
    inclusions: plain.inclusions,
    accommodations: plain.accommodations
  };

  // Clone may copy fixed_package configuration; validate via core validator then enforce identities.
  const cleaned = stripClientLifecycle(cloneInput);
  const normalized = validateAndNormalizeRatePlan(cleaned);
  if (!normalized.ok) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'Cloned rate plan validation failed',
      { errors: normalized.errors }
    );
  }
  const value = normalized.value;
  if (value.type === 'seasonal_stay' && value.inventoryMode !== 'shared') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'seasonal_stay inventoryMode must be shared'
    );
  }
  await assertAccommodationIdentities(value.accommodations, d);
  await assertCancellationPolicyExists(value.cancellationPolicyCode, value.cancellationPolicyVersion, d);

  const docPayload = {
    ...persistableFromNormalized(value),
    status: 'draft',
    createdBy: operator,
    updatedBy: operator,
    activatedAt: null,
    activatedBy: null,
    retiredAt: null,
    retiredBy: null
  };

  try {
    let doc;
    if (d.session) {
      const created = await d.RatePlan.create([docPayload], { session: d.session });
      doc = created[0];
    } else {
      doc = await d.RatePlan.create(docPayload);
    }
    return toPublicPlan(doc);
  } catch (err) {
    if (err && err.code === 11000) {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.DUPLICATE_VERSION,
        `Rate plan ${value.code}@v${value.version} already exists`,
        { code: value.code, version: value.version }
      );
    }
    throw err;
  }
}

async function activateRatePlanUnderLock(id, { operatorId, expectedRevision } = {}, deps) {
  const operator = normalizeOperator(operatorId);
  const doc = await loadPlanByIdOrThrow(id, deps);

  if (doc.status !== 'draft') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Only draft rate plans may be activated (status=${doc.status})`,
      { id: String(id), status: doc.status }
    );
  }

  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.STALE_REVISION,
      'Rate plan was modified by another operator; reload and retry',
      { id: String(id), expectedRevision: Number(expectedRevision), actualRevision: Number(doc.__v) }
    );
  }

  const plain = planToPlain(doc);
  const forValidation = {
    ...plain,
    arrivalWindowStart: toDateOnlyString(plain.arrivalWindowStart),
    arrivalWindowEnd: toDateOnlyString(plain.arrivalWindowEnd),
    bookingWindowStart: toDateOnlyString(plain.bookingWindowStart),
    bookingWindowEnd: toDateOnlyString(plain.bookingWindowEnd),
    packageArrivalDate: toDateOnlyString(plain.packageArrivalDate),
    packageDepartureDate: toDateOnlyString(plain.packageDepartureDate)
  };

  const normalized = validateAndNormalizeRatePlan(forValidation);
  if (!normalized.ok) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'Cannot activate invalid rate plan',
      { errors: normalized.errors }
    );
  }
  const value = normalized.value;
  if (value.type === 'seasonal_stay' && value.inventoryMode !== 'shared') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.VALIDATION_FAILED,
      'seasonal_stay inventoryMode must be shared'
    );
  }

  await assertAccommodationIdentities(value.accommodations, deps);
  await assertCancellationPolicyExists(value.cancellationPolicyCode, value.cancellationPolicyVersion, deps);
  await assertPaymentTermActiveIfPresent(
    value.paymentTermCode,
    value.paymentTermVersion,
    deps
  );

  if (value.type === 'seasonal_stay') {
    const conflicts = await findSeasonalActivationConflicts(value, deps);
    if (conflicts.length > 0) {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP,
        'Activation would create an ambiguous overlapping active seasonal rate plan',
        {
          conflicts,
          concurrencyNote:
            'Seasonal activation is serialized by a fail-closed global lock; overlap checks run only while holding that lock. Quote selection still fails closed on AMBIGUOUS_SEASONAL_RATE_PLAN.'
        }
      );
    }
  }

  const now = deps.now();
  doc.status = 'active';
  doc.updatedBy = operator;
  doc.activatedAt = now;
  doc.activatedBy = operator;
  doc.retiredAt = null;
  doc.retiredBy = null;
  doc.increment();

  try {
    await doc.save(deps.session ? { session: deps.session } : undefined);
  } catch (err) {
    if (err && err.name === 'VersionError') {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.STALE_REVISION,
        'Rate plan was modified by another operator; reload and retry',
        { id: String(id) }
      );
    }
    throw err;
  }

  return toPublicPlan(doc);
}

async function activateRatePlan(id, { operatorId, expectedRevision } = {}, deps = {}) {
  const d = getDeps(deps);
  // Caller-supplied ownerToken is ignored; lock ownership is always server-side.
  const preliminary = await loadPlanByIdOrThrow(id, d);

  if (preliminary.status !== 'draft') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Only draft rate plans may be activated (status=${preliminary.status})`,
      { id: String(id), status: preliminary.status }
    );
  }

  const needsSeasonalLock = preliminary.type === 'seasonal_stay';
  let ownerToken = null;

  if (needsSeasonalLock) {
    // Acquire before any conflict check or mutation.
    ownerToken = await acquireSeasonalActivationLock(d);
  }

  let activationError = null;
  let activatedPlan = null;
  try {
    activatedPlan = await activateRatePlanUnderLock(id, { operatorId, expectedRevision }, d);
  } catch (err) {
    activationError = err;
  }

  let lockReleased = true;
  if (ownerToken) {
    const releaseOutcome = await attemptReleaseOwnedLock(ownerToken, d);
    lockReleased = releaseOutcome.released === true;
  }

  if (activationError) {
    if (ownerToken && !lockReleased) {
      attachLockCleanupWarning(activationError);
    }
    throw activationError;
  }

  // Do not claim success unless the RatePlan is confirmed active in storage.
  const confirmedDoc = await loadPlanByIdOrThrow(id, d);
  if (confirmedDoc.status !== 'active') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION,
      'Activation did not commit to active status',
      { id: String(id), status: confirmedDoc.status }
    );
  }

  return buildActivationSuccessResult(toPublicPlan(confirmedDoc), {
    lockReleased,
    usedLock: Boolean(ownerToken)
  });
}

async function retireRatePlan(id, { operatorId, expectedRevision } = {}, deps = {}) {
  const d = getDeps(deps);
  const operator = normalizeOperator(operatorId);
  const doc = await loadPlanByIdOrThrow(id, d);

  if (doc.status !== 'active') {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION,
      `Only active rate plans may be retired (status=${doc.status})`,
      { id: String(id), status: doc.status }
    );
  }

  if (expectedRevision != null && Number(doc.__v) !== Number(expectedRevision)) {
    throw new RatePlanManagementError(
      MANAGEMENT_ERROR_CODES.STALE_REVISION,
      'Rate plan was modified by another operator; reload and retry',
      { id: String(id), expectedRevision: Number(expectedRevision), actualRevision: Number(doc.__v) }
    );
  }

  const now = d.now();
  doc.status = 'retired';
  doc.updatedBy = operator;
  doc.retiredAt = now;
  doc.retiredBy = operator;
  doc.increment();

  try {
    await doc.save(d.session ? { session: d.session } : undefined);
  } catch (err) {
    if (err && err.name === 'VersionError') {
      throw new RatePlanManagementError(
        MANAGEMENT_ERROR_CODES.STALE_REVISION,
        'Rate plan was modified by another operator; reload and retry',
        { id: String(id) }
      );
    }
    throw err;
  }

  return toPublicPlan(doc);
}

module.exports = {
  RatePlanManagementError,
  MANAGEMENT_ERROR_CODES,
  OPERATIONAL_WARNING_CODES,
  BUSINESS_FIELD_KEYS,
  ACTIVATION_LOCK_COLLECTION_NAME,
  ACTIVATION_LOCK_ID,
  inclusiveDateWindowsOverlap,
  acquireSeasonalActivationLock,
  releaseSeasonalActivationLock,
  attemptReleaseOwnedLock,
  listRatePlans,
  createRatePlanDraft,
  updateRatePlanDraft,
  cloneRatePlanAsNextDraftVersion,
  activateRatePlan,
  retireRatePlan
};
