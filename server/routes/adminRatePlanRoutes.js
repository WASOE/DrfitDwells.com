/**
 * Admin RatePlan management API (RP2).
 * Thin authenticated HTTP layer over ratePlanManagementService (RP1).
 * Does not modify pricing/quote/selection. Production activation remains blocked
 * pending controlled orphan-lock recovery.
 */
'use strict';

const express = require('express');
const { validateId } = require('../middleware/validateId');
const defaultMgmt = require('../services/ratePlanManagementService');

const LIST_FILTER_KEYS = Object.freeze(['status', 'type', 'code', 'limit']);
const LIST_LIMIT_DEFAULT = 200;
const LIST_LIMIT_MAX = 500;

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
  'inclusions',
  'accommodations'
]);

const FORBIDDEN_BODY_KEYS = Object.freeze([
  'status',
  'createdBy',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'retiredAt',
  'retiredBy',
  'ownerToken',
  '_id',
  'id',
  '__v',
  'createdAt',
  'updatedAt',
  'activationCommitted',
  'lockReleased',
  'operationalWarnings',
  'lockCleanupRequired',
  'revision'
]);

const CREATE_BODY_KEYS = BUSINESS_FIELD_KEYS;
const UPDATE_BODY_KEYS = Object.freeze([...BUSINESS_FIELD_KEYS, 'expectedRevision']);
const REVISION_ONLY_BODY_KEYS = Object.freeze(['expectedRevision']);
const CLONE_BODY_KEYS = Object.freeze([]);

/**
 * Exhaustive HTTP status mapping for every RP1 MANAGEMENT_ERROR_CODES value.
 */
function buildHttpStatusByManagementCode(MANAGEMENT_ERROR_CODES) {
  const map = Object.freeze({
    [MANAGEMENT_ERROR_CODES.INVALID_OPERATOR]: 400,
    [MANAGEMENT_ERROR_CODES.VALIDATION_FAILED]: 400,
    [MANAGEMENT_ERROR_CODES.ACCOMMODATION_NOT_FOUND]: 400,
    [MANAGEMENT_ERROR_CODES.ACCOMMODATION_INACTIVE]: 400,
    [MANAGEMENT_ERROR_CODES.ACCOMMODATION_ENTITY_MISMATCH]: 400,
    [MANAGEMENT_ERROR_CODES.CANCELLATION_POLICY_NOT_FOUND]: 400,
    [MANAGEMENT_ERROR_CODES.UNSUPPORTED_TYPE]: 400,
    [MANAGEMENT_ERROR_CODES.HARD_DELETE_FORBIDDEN]: 400,

    [MANAGEMENT_ERROR_CODES.NOT_FOUND]: 404,

    [MANAGEMENT_ERROR_CODES.STALE_REVISION]: 409,
    [MANAGEMENT_ERROR_CODES.DUPLICATE_VERSION]: 409,
    [MANAGEMENT_ERROR_CODES.SEASONAL_OVERLAP]: 409,
    [MANAGEMENT_ERROR_CODES.ACTIVATION_BUSY]: 409,
    [MANAGEMENT_ERROR_CODES.INVALID_STATUS_TRANSITION]: 409,
    [MANAGEMENT_ERROR_CODES.IMMUTABLE_PLAN]: 409,
    [MANAGEMENT_ERROR_CODES.IDENTITY_IMMUTABLE]: 409,

    [MANAGEMENT_ERROR_CODES.ACTIVATION_LOCK_UNCERTAIN]: 503,
    [MANAGEMENT_ERROR_CODES.LOCK_RELEASE_DENIED]: 503
  });

  for (const code of Object.values(MANAGEMENT_ERROR_CODES)) {
    if (map[code] == null) {
      throw new Error(`Incomplete RP2 error map: missing HTTP status for ${code}`);
    }
  }
  return map;
}

const SAFE_DETAIL_KEYS = Object.freeze([
  'id',
  'status',
  'code',
  'version',
  'errors',
  'conflicts',
  'expectedRevision',
  'actualRevision',
  'lockId',
  'lockCleanupRequired',
  'operationalWarnings',
  'concurrencyNote',
  'accommodationKey',
  'entityType',
  'inventoryMode',
  'allowed'
]);

function sanitizeDetails(details) {
  if (details == null || typeof details !== 'object') return undefined;
  const scrubbed = JSON.parse(
    JSON.stringify(details, (key, value) => {
      if (key && /token|password|secret|stack|owner/i.test(String(key))) return undefined;
      return value;
    })
  );
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
    return scrubbed;
  }
  const out = {};
  for (const key of SAFE_DETAIL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(scrubbed, key)) {
      out[key] = scrubbed[key];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function actorIdFromRequest(req) {
  const id = req.user && req.user.id != null ? String(req.user.id).trim() : '';
  return id || null;
}

function rejectUnknownKeys(body, allowedKeys) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const keys = Object.keys(body);
  const forbidden = keys.filter((k) => FORBIDDEN_BODY_KEYS.includes(k));
  if (forbidden.length) {
    return {
      ok: false,
      message: `Forbidden fields are not accepted: ${forbidden.join(', ')}`
    };
  }
  const unknown = keys.filter((k) => !allowedKeys.includes(k));
  if (unknown.length) {
    return {
      ok: false,
      message: `Unknown fields are not accepted: ${unknown.join(', ')}`
    };
  }
  return { ok: true };
}

function pickAllowlisted(body, allowedKeys) {
  const out = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(body, key) && key !== 'expectedRevision') {
      out[key] = body[key];
    }
  }
  return out;
}

/**
 * Accept only native nonnegative safe integers.
 * No Number()/parseInt coercion — strings, bools, null, arrays, -0 rejected.
 */
function parseExpectedRevision(body, { required }) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'expectedRevision')) {
    if (required) {
      return { ok: false, message: 'expectedRevision is required' };
    }
    return { ok: true, value: undefined };
  }
  const raw = body.expectedRevision;
  if (
    typeof raw !== 'number' ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    Object.is(raw, -0)
  ) {
    return {
      ok: false,
      message: 'expectedRevision must be a native non-negative safe integer'
    };
  }
  return { ok: true, value: raw };
}

function parseListFilters(query) {
  if (query == null || typeof query !== 'object') {
    return { ok: false, message: 'Invalid query' };
  }
  const unknown = Object.keys(query).filter((k) => !LIST_FILTER_KEYS.includes(k));
  if (unknown.length) {
    return {
      ok: false,
      message: `Unsupported query filters: ${unknown.join(', ')}`
    };
  }

  const filters = {};
  if (query.status != null && String(query.status).trim() !== '') {
    const status = String(query.status).trim();
    if (!['draft', 'active', 'retired'].includes(status)) {
      return { ok: false, message: 'status filter must be draft, active, or retired' };
    }
    filters.status = status;
  }
  if (query.type != null && String(query.type).trim() !== '') {
    const type = String(query.type).trim();
    if (!['seasonal_stay', 'fixed_package'].includes(type)) {
      return { ok: false, message: 'type filter must be seasonal_stay or fixed_package' };
    }
    filters.type = type;
  }
  if (query.code != null && String(query.code).trim() !== '') {
    filters.code = String(query.code).trim().toLowerCase();
  }

  let limit = LIST_LIMIT_DEFAULT;
  if (query.limit != null && String(query.limit).trim() !== '') {
    const n = Number(query.limit);
    if (!Number.isInteger(n) || n < 1 || n > LIST_LIMIT_MAX) {
      return {
        ok: false,
        message: `limit must be an integer between 1 and ${LIST_LIMIT_MAX}`
      };
    }
    limit = n;
  }

  return { ok: true, filters, limit };
}

/** Public RatePlan fields matching RP1 `toPublicPlan` contract. */
const PUBLIC_RATE_PLAN_KEYS = Object.freeze([
  'id',
  'revision',
  'code',
  'internalName',
  'version',
  'status',
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
  'inclusions',
  'accommodations',
  'createdBy',
  'updatedBy',
  'activatedAt',
  'activatedBy',
  'retiredAt',
  'retiredBy',
  'createdAt',
  'updatedAt'
]);

const PUBLIC_ACCOMMODATION_KEYS = Object.freeze([
  'accommodationKey',
  'entityType',
  'pricingMethod',
  'nightlyPerUnitAmount',
  'includedGuests',
  'additionalGuestNightlyAmount',
  'fixedPerUnitAmount',
  'adultPackageAmount',
  'childPackageAmount',
  'infantPackageAmount'
]);

/** Only this activation operational warning code may appear in HTTP responses. */
const ALLOWED_OPERATIONAL_WARNING_CODE = 'ACTIVATION_LOCK_RELEASE_FAILED';

function own(obj, key) {
  return obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function serializeInclusions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
  }
  return out;
}

function serializeAccommodationRow(row) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return null;
  const out = {};
  for (const key of PUBLIC_ACCOMMODATION_KEYS) {
    if (own(row, key)) {
      out[key] = row[key];
    }
  }
  return out;
}

function serializeAccommodations(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const row of value) {
    const serialized = serializeAccommodationRow(row);
    if (serialized) out.push(serialized);
  }
  return out;
}

/**
 * Explicit serializer for RP1 public RatePlan objects.
 * Own-property copies only — no unrestricted spread.
 */
function serializePublicRatePlan(plan) {
  if (plan == null || typeof plan !== 'object' || Array.isArray(plan)) {
    return null;
  }
  const out = {};
  for (const key of PUBLIC_RATE_PLAN_KEYS) {
    if (!own(plan, key)) continue;
    if (key === 'inclusions') {
      out[key] = serializeInclusions(plan[key]);
    } else if (key === 'accommodations') {
      out[key] = serializeAccommodations(plan[key]);
    } else {
      out[key] = plan[key];
    }
  }
  return out;
}

/**
 * Rebuild operational warnings as code-only.
 * Only ACTIVATION_LOCK_RELEASE_FAILED is allowed. Never copy message/stack/token/URI/etc.
 */
function serializeOperationalWarning(warning) {
  if (warning == null || typeof warning !== 'object' || Array.isArray(warning)) {
    return null;
  }
  if (!own(warning, 'code')) return null;
  if (warning.code !== ALLOWED_OPERATIONAL_WARNING_CODE) return null;
  return { code: ALLOWED_OPERATIONAL_WARNING_CODE };
}

function serializeOperationalWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  const out = [];
  for (const warning of warnings) {
    const serialized = serializeOperationalWarning(warning);
    if (serialized) out.push(serialized);
  }
  return out;
}

/**
 * Serialize activation success without rest-spreading arbitrary service fields.
 * Committed activation with lockReleased:false still surfaces as success metadata.
 */
function serializeActivationResult(result) {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) {
    return {
      ratePlan: null,
      activationCommitted: false,
      lockReleased: false,
      operationalWarnings: []
    };
  }
  return {
    ratePlan: serializePublicRatePlan(result),
    activationCommitted: own(result, 'activationCommitted')
      ? result.activationCommitted === true
      : false,
    lockReleased: own(result, 'lockReleased') ? result.lockReleased === true : false,
    operationalWarnings: serializeOperationalWarnings(
      own(result, 'operationalWarnings') ? result.operationalWarnings : []
    )
  };
}

function createAdminRatePlanRouter(deps = {}) {
  const mgmt = deps.ratePlanManagementService || defaultMgmt;
  const {
    RatePlanManagementError,
    MANAGEMENT_ERROR_CODES,
    listRatePlans,
    createRatePlanDraft,
    updateRatePlanDraft,
    cloneRatePlanAsNextDraftVersion,
    activateRatePlan,
    retireRatePlan
  } = mgmt;

  const httpStatusByCode = buildHttpStatusByManagementCode(MANAGEMENT_ERROR_CODES);
  const router = express.Router();

  function handleManagementError(res, error) {
    if (error && error.name === 'RatePlanManagementError' && error.code) {
      const status = httpStatusByCode[error.code] || 500;
      const payload = {
        success: false,
        message: typeof error.message === 'string' ? error.message : 'Request failed',
        code: error.code
      };
      const details = sanitizeDetails(error.details);
      if (details !== undefined) payload.details = details;
      return res.status(status).json(payload);
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }

  // GET /api/admin/rate-plans
  router.get('/', async (req, res) => {
    try {
      const parsed = parseListFilters(req.query || {});
      if (!parsed.ok) {
        return res.status(400).json({ success: false, message: parsed.message });
      }
      const plans = await listRatePlans(parsed.filters);
      const bounded = Array.isArray(plans) ? plans.slice(0, parsed.limit) : [];
      const ratePlans = bounded
        .map((plan) => serializePublicRatePlan(plan))
        .filter((plan) => plan != null);
      return res.json({
        success: true,
        data: {
          ratePlans,
          count: ratePlans.length,
          truncated: Array.isArray(plans) && plans.length > bounded.length
        }
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // POST /api/admin/rate-plans — create draft
  router.post('/', async (req, res) => {
    try {
      const gate = rejectUnknownKeys(req.body, CREATE_BODY_KEYS);
      if (!gate.ok) {
        return res.status(400).json({ success: false, message: gate.message });
      }
      const operatorId = actorIdFromRequest(req);
      if (!operatorId) {
        return res.status(401).json({ success: false, message: 'Authenticated actor identity is required' });
      }
      const input = pickAllowlisted(req.body, CREATE_BODY_KEYS);
      const plan = await createRatePlanDraft(input, { operatorId });
      return res.status(201).json({
        success: true,
        data: { ratePlan: serializePublicRatePlan(plan) }
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // PATCH /api/admin/rate-plans/:id — update draft
  router.patch('/:id', validateId('id'), async (req, res) => {
    try {
      const gate = rejectUnknownKeys(req.body, UPDATE_BODY_KEYS);
      if (!gate.ok) {
        return res.status(400).json({ success: false, message: gate.message });
      }
      const rev = parseExpectedRevision(req.body, { required: true });
      if (!rev.ok) {
        return res.status(400).json({ success: false, message: rev.message });
      }
      const operatorId = actorIdFromRequest(req);
      if (!operatorId) {
        return res.status(401).json({ success: false, message: 'Authenticated actor identity is required' });
      }
      const patch = pickAllowlisted(req.body, BUSINESS_FIELD_KEYS);
      const plan = await updateRatePlanDraft(req.params.id, patch, {
        operatorId,
        expectedRevision: rev.value
      });
      return res.json({
        success: true,
        data: { ratePlan: serializePublicRatePlan(plan) }
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // POST /api/admin/rate-plans/:id/clone
  router.post('/:id/clone', validateId('id'), async (req, res) => {
    try {
      const body = req.body == null || (typeof req.body === 'object' && !Array.isArray(req.body) && Object.keys(req.body).length === 0)
        ? {}
        : req.body;
      const gate = rejectUnknownKeys(body, CLONE_BODY_KEYS);
      if (!gate.ok) {
        return res.status(400).json({ success: false, message: gate.message });
      }
      const operatorId = actorIdFromRequest(req);
      if (!operatorId) {
        return res.status(401).json({ success: false, message: 'Authenticated actor identity is required' });
      }
      const plan = await cloneRatePlanAsNextDraftVersion(req.params.id, { operatorId });
      return res.status(201).json({
        success: true,
        data: { ratePlan: serializePublicRatePlan(plan) }
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // POST /api/admin/rate-plans/:id/activate
  router.post('/:id/activate', validateId('id'), async (req, res) => {
    try {
      const gate = rejectUnknownKeys(req.body || {}, REVISION_ONLY_BODY_KEYS);
      if (!gate.ok) {
        return res.status(400).json({ success: false, message: gate.message });
      }
      const rev = parseExpectedRevision(req.body || {}, { required: true });
      if (!rev.ok) {
        return res.status(400).json({ success: false, message: rev.message });
      }
      const operatorId = actorIdFromRequest(req);
      if (!operatorId) {
        return res.status(401).json({ success: false, message: 'Authenticated actor identity is required' });
      }
      const result = await activateRatePlan(req.params.id, {
        operatorId,
        expectedRevision: rev.value
      });
      const serialized = serializeActivationResult(result);
      // Committed activation with lockReleased:false still returns 200 with safe warnings.
      return res.status(200).json({
        success: true,
        data: serialized
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // POST /api/admin/rate-plans/:id/retire
  router.post('/:id/retire', validateId('id'), async (req, res) => {
    try {
      const gate = rejectUnknownKeys(req.body || {}, REVISION_ONLY_BODY_KEYS);
      if (!gate.ok) {
        return res.status(400).json({ success: false, message: gate.message });
      }
      const rev = parseExpectedRevision(req.body || {}, { required: true });
      if (!rev.ok) {
        return res.status(400).json({ success: false, message: rev.message });
      }
      const operatorId = actorIdFromRequest(req);
      if (!operatorId) {
        return res.status(401).json({ success: false, message: 'Authenticated actor identity is required' });
      }
      const plan = await retireRatePlan(req.params.id, {
        operatorId,
        expectedRevision: rev.value
      });
      return res.json({
        success: true,
        data: { ratePlan: serializePublicRatePlan(plan) }
      });
    } catch (error) {
      return handleManagementError(res, error);
    }
  });

  // Explicitly refuse DELETE — no hard-delete capability.
  router.delete(['/', '/:id'], (_req, res) => {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed',
      code: 'HARD_DELETE_FORBIDDEN'
    });
  });

  return router;
}

const defaultRouter = createAdminRatePlanRouter();
module.exports = defaultRouter;
module.exports.createAdminRatePlanRouter = createAdminRatePlanRouter;
module.exports.LIST_FILTER_KEYS = LIST_FILTER_KEYS;
module.exports.CREATE_BODY_KEYS = CREATE_BODY_KEYS;
module.exports.UPDATE_BODY_KEYS = UPDATE_BODY_KEYS;
module.exports.FORBIDDEN_BODY_KEYS = FORBIDDEN_BODY_KEYS;
module.exports.PUBLIC_RATE_PLAN_KEYS = PUBLIC_RATE_PLAN_KEYS;
module.exports.PUBLIC_ACCOMMODATION_KEYS = PUBLIC_ACCOMMODATION_KEYS;
module.exports.ALLOWED_OPERATIONAL_WARNING_CODE = ALLOWED_OPERATIONAL_WARNING_CODE;
module.exports.parseExpectedRevision = parseExpectedRevision;
module.exports.serializePublicRatePlan = serializePublicRatePlan;
module.exports.serializeActivationResult = serializeActivationResult;
module.exports.serializeOperationalWarning = serializeOperationalWarning;
module.exports.buildHttpStatusByManagementCode = buildHttpStatusByManagementCode;
