'use strict';

/**
 * Incident-scoped AsyncLocalStorage recovery capability.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md §1.2–1.5
 *
 * Private brand Symbol and ALS instance are NEVER exported.
 */

const { AsyncLocalStorage } = require('async_hooks');
const {
  createSanitizedRecoveryError
} = require('./multiUnitPaidOrphanRecoveryErrors');

const BRAND = Symbol('multiUnitPaidOrphanRecoveryCapability');
const recoveryContext = new AsyncLocalStorage();

const SCHEMA_VERSION = 'multi-unit-paid-orphan-recovery-context/v1';
const OBJECT_ID_RE = /^[a-f0-9]{24}$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/**
 * Privileged operation → mandatory expectedScope fields.
 * Every listed field must be present, valid, and match the ALS store
 * (bookingId matches options.authoritativeBookingId — not stored in ALS).
 */
const OPERATION_REQUIRED_FIELDS = Object.freeze({
  commercial_stay_bypass: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'cabinTypeId',
    'evidenceDigest'
  ]),
  exact_unit_injection: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'cabinTypeId',
    'expectedTargetUnitId',
    'evidenceDigest'
  ]),
  payment_link_review_suppression: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentId',
    'paymentIntentId',
    'manualReviewItemId',
    'evidenceDigest'
  ]),
  recovery_job_lease: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'recoveryExecutionId',
    'evidenceDigest'
  ]),
  recovery_job_transition: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'recoveryExecutionId',
    'evidenceDigest'
  ]),
  completion_review_create_or_adopt: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentId',
    'paymentIntentId',
    'finalizationJobId',
    'manualReviewItemId',
    'recoveryExecutionId',
    'evidenceDigest'
  ]),
  active_review_update: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'recoveryExecutionId',
    'evidenceDigest'
  ]),
  confirmation_queue_transition: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'recoveryExecutionId',
    'evidenceDigest',
    'bookingId'
  ]),
  recovery_review_resolution: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentId',
    'paymentIntentId',
    'finalizationJobId',
    'manualReviewItemId',
    'recoveryExecutionId',
    'evidenceDigest',
    'bookingId'
  ]),
  mri_hold_acquire: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'manualReviewItemId',
    'recoveryExecutionId',
    'evidenceDigest'
  ]),
  mri_hold_transfer: Object.freeze([
    'checkoutId',
    'checkoutSessionId',
    'paymentIntentId',
    'finalizationJobId',
    'manualReviewItemId',
    'recoveryExecutionId',
    'evidenceDigest'
  ])
});

function canonicalizeObjectId(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return null;
  if (typeof value === 'object') {
    const ctorName = value.constructor && value.constructor.name;
    const isObjectId =
      value._bsontype === 'ObjectId' ||
      ctorName === 'ObjectId' ||
      (typeof value.toHexString === 'function' && typeof value.toString === 'function');
    if (!isObjectId) return null;
    const hex =
      typeof value.toHexString === 'function'
        ? value.toHexString()
        : String(value);
    const s = String(hex).trim().toLowerCase();
    return OBJECT_ID_RE.test(s) ? s : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim().toLowerCase();
  if (!OBJECT_ID_RE.test(s)) return null;
  return s;
}

function requireExactNonEmptyString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  if (value.length === 0) return null;
  return value;
}

function canonicalizeEvidenceDigest(value) {
  if (value == null || typeof value !== 'string') return null;
  const s = value.toLowerCase();
  if (!SHA256_HEX_RE.test(s)) return null;
  return s;
}

function canonicalizeScope(scope) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'invalid_scope_shape'
    });
  }

  const recoveryMode = scope.recoveryMode;
  if (recoveryMode !== 'initial' && recoveryMode !== 'resume') {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'invalid_recovery_mode'
    });
  }

  const recoveryExecutionId = requireExactNonEmptyString(scope.recoveryExecutionId);
  const checkoutId = requireExactNonEmptyString(scope.checkoutId);
  const paymentIntentId = requireExactNonEmptyString(scope.paymentIntentId);
  const checkoutSessionId = canonicalizeObjectId(scope.checkoutSessionId);
  const paymentId = canonicalizeObjectId(scope.paymentId);
  const finalizationJobId = canonicalizeObjectId(scope.finalizationJobId);
  const manualReviewItemId = canonicalizeObjectId(scope.manualReviewItemId);
  const cabinTypeId = canonicalizeObjectId(scope.cabinTypeId);
  const expectedTargetUnitId = canonicalizeObjectId(scope.expectedTargetUnitId);
  const evidenceDigest = canonicalizeEvidenceDigest(scope.evidenceDigest);

  if (
    !recoveryExecutionId ||
    !checkoutId ||
    !paymentIntentId ||
    !checkoutSessionId ||
    !paymentId ||
    !finalizationJobId ||
    !manualReviewItemId ||
    !cabinTypeId ||
    !expectedTargetUnitId ||
    !evidenceDigest
  ) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'missing_or_malformed_identity'
    });
  }

  return {
    recoveryMode,
    recoveryExecutionId,
    checkoutId,
    checkoutSessionId,
    paymentIntentId,
    paymentId,
    finalizationJobId,
    manualReviewItemId,
    cabinTypeId,
    expectedTargetUnitId,
    evidenceDigest
  };
}

function fieldMatchesStore(store, field, expectedRaw) {
  switch (field) {
    case 'recoveryExecutionId':
    case 'checkoutId':
    case 'paymentIntentId':
      return (
        requireExactNonEmptyString(expectedRaw) != null &&
        store[field] === requireExactNonEmptyString(expectedRaw)
      );
    case 'evidenceDigest':
      return (
        canonicalizeEvidenceDigest(expectedRaw) != null &&
        store.evidenceDigest === canonicalizeEvidenceDigest(expectedRaw)
      );
    case 'checkoutSessionId':
    case 'paymentId':
    case 'finalizationJobId':
    case 'manualReviewItemId':
    case 'cabinTypeId':
    case 'expectedTargetUnitId': {
      const expected = canonicalizeObjectId(expectedRaw);
      return expected != null && store[field] === expected;
    }
    case 'bookingId':
      // Compared against authoritativeBookingId in options, not ALS.
      return canonicalizeObjectId(expectedRaw) != null;
    case 'recoveryMode':
      return expectedRaw === 'initial' || expectedRaw === 'resume'
        ? store.recoveryMode === expectedRaw
        : false;
    default:
      return false;
  }
}

/**
 * Privileged match: every operation-required field must be present and match.
 * Unknown / missing operation → fail closed.
 */
function matchesOperationScope(store, expectedScope, operation, options = {}) {
  if (!store || store.brand !== BRAND) return false;
  if (!expectedScope || typeof expectedScope !== 'object' || Array.isArray(expectedScope)) {
    return false;
  }
  const required = OPERATION_REQUIRED_FIELDS[operation];
  if (!required) return false;

  for (const field of required) {
    if (expectedScope[field] === undefined || expectedScope[field] === null) {
      return false;
    }
    if (field === 'bookingId') {
      const expectedBookingId = canonicalizeObjectId(expectedScope.bookingId);
      const authoritative = canonicalizeObjectId(options.authoritativeBookingId);
      if (!expectedBookingId || !authoritative) return false;
      if (expectedBookingId !== authoritative) return false;
      continue;
    }
    if (!fieldMatchesStore(store, field, expectedScope[field])) {
      return false;
    }
  }
  return true;
}

function runInMultiUnitPaidOrphanRecoveryContext(scope, callback) {
  if (typeof callback !== 'function') {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'callback_required'
    });
  }
  const canonical = canonicalizeScope(scope);
  const store = Object.freeze({
    brand: BRAND,
    schemaVersion: SCHEMA_VERSION,
    ...canonical
  });
  return recoveryContext.run(store, callback);
}

function getMultiUnitPaidOrphanRecoveryContext() {
  const store = recoveryContext.getStore();
  if (!store || store.brand !== BRAND) return null;
  return store;
}

function isMultiUnitPaidOrphanRecoveryContext(expectedScope) {
  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (!store) return false;
  if (!expectedScope) return true; // presence-only — MUST NOT authorize privileged mutations
  // Diagnostic full-store equality without operation — still non-authorizing for privilege.
  const keys = [
    'recoveryExecutionId',
    'checkoutId',
    'paymentIntentId',
    'checkoutSessionId',
    'paymentId',
    'finalizationJobId',
    'manualReviewItemId',
    'cabinTypeId',
    'expectedTargetUnitId',
    'evidenceDigest'
  ];
  for (const key of keys) {
    if (expectedScope[key] === undefined) continue;
    if (!fieldMatchesStore(store, key, expectedScope[key])) return false;
  }
  return true;
}

/**
 * Privileged assert. Requires { operation } and operation-complete expectedScope.
 * options.authoritativeBookingId required when operation lists bookingId.
 */
function assertMultiUnitPaidOrphanRecoveryContext(expectedScope, options = {}) {
  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (!store || store.brand !== BRAND) {
    throw createSanitizedRecoveryError('MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
  }
  const operation = options && options.operation;
  if (!operation || !OPERATION_REQUIRED_FIELDS[operation]) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'unknown_or_missing_operation'
    });
  }
  if (!expectedScope || !matchesOperationScope(store, expectedScope, operation, options)) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH', {
      reason: 'operation_scope_mismatch',
      operation
    });
  }
  return store;
}

function exitMultiUnitPaidOrphanRecoveryContext(callback) {
  return recoveryContext.exit(callback);
}

function getRequiredFieldsForOperation(operation) {
  return OPERATION_REQUIRED_FIELDS[operation]
    ? OPERATION_REQUIRED_FIELDS[operation].slice()
    : null;
}

module.exports = {
  runInMultiUnitPaidOrphanRecoveryContext,
  getMultiUnitPaidOrphanRecoveryContext,
  isMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext,
  exitMultiUnitPaidOrphanRecoveryContext,
  OPERATION_REQUIRED_FIELDS,
  getRequiredFieldsForOperation
};
