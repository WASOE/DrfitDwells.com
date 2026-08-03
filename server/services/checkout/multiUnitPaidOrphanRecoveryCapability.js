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

function requireExactNonEmptyString(value, fieldName) {
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

  const recoveryExecutionId = requireExactNonEmptyString(
    scope.recoveryExecutionId,
    'recoveryExecutionId'
  );
  const checkoutId = requireExactNonEmptyString(scope.checkoutId, 'checkoutId');
  const paymentIntentId = requireExactNonEmptyString(
    scope.paymentIntentId,
    'paymentIntentId'
  );
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

function compareScalarExact(a, b) {
  if (a == null || b == null) return false;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a === b;
}

function compareObjectIdField(storeValue, expectedRaw) {
  const expected = canonicalizeObjectId(expectedRaw);
  if (!expected || !storeValue) return false;
  return storeValue === expected;
}

/**
 * Binding equality: ObjectIds → lowercase hex; provider IDs / checkoutId exact;
 * evidenceDigest lowercase SHA-256; missing/null/array/object fail closed.
 */
function matchesIncidentScope(store, expectedScope) {
  if (!store || store.brand !== BRAND) return false;
  if (!expectedScope || typeof expectedScope !== 'object' || Array.isArray(expectedScope)) {
    return false;
  }

  const checks = [
    ['recoveryExecutionId', () =>
      compareScalarExact(
        store.recoveryExecutionId,
        requireExactNonEmptyString(expectedScope.recoveryExecutionId)
      )],
    ['checkoutId', () =>
      compareScalarExact(
        store.checkoutId,
        requireExactNonEmptyString(expectedScope.checkoutId)
      )],
    ['paymentIntentId', () =>
      compareScalarExact(
        store.paymentIntentId,
        requireExactNonEmptyString(expectedScope.paymentIntentId)
      )],
    ['checkoutSessionId', () =>
      compareObjectIdField(store.checkoutSessionId, expectedScope.checkoutSessionId)],
    ['paymentId', () => compareObjectIdField(store.paymentId, expectedScope.paymentId)],
    ['finalizationJobId', () =>
      compareObjectIdField(store.finalizationJobId, expectedScope.finalizationJobId)],
    ['manualReviewItemId', () =>
      compareObjectIdField(store.manualReviewItemId, expectedScope.manualReviewItemId)],
    ['cabinTypeId', () => compareObjectIdField(store.cabinTypeId, expectedScope.cabinTypeId)],
    ['expectedTargetUnitId', () =>
      compareObjectIdField(store.expectedTargetUnitId, expectedScope.expectedTargetUnitId)],
    ['evidenceDigest', () =>
      compareScalarExact(
        store.evidenceDigest,
        canonicalizeEvidenceDigest(expectedScope.evidenceDigest)
      )]
  ];

  // Only compare fields present on expectedScope (subset allowed for seam-specific checks),
  // but privileged callers must pass a complete expectedScope per architecture.
  // Presence of any invalid/mismatched provided field fails closed.
  let compared = 0;
  for (const [field, fn] of checks) {
    if (expectedScope[field] === undefined) continue;
    compared += 1;
    if (!fn()) return false;
  }
  if (compared === 0) return false;

  if (expectedScope.recoveryMode !== undefined) {
    if (
      expectedScope.recoveryMode !== 'initial' &&
      expectedScope.recoveryMode !== 'resume'
    ) {
      return false;
    }
    if (store.recoveryMode !== expectedScope.recoveryMode) return false;
  }

  if (expectedScope.bookingId !== undefined) {
    const expectedBookingId = canonicalizeObjectId(expectedScope.bookingId);
    if (!expectedBookingId) return false;
    // bookingId is post-create identity; store does not hold it — callers compare after assert of other fields
    // via explicit argument checks. Require canonical form only here when provided alongside store match.
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
  if (!expectedScope) return true; // presence-only diagnostic — MUST NOT authorize privileged mutations
  return matchesIncidentScope(store, expectedScope);
}

function assertMultiUnitPaidOrphanRecoveryContext(expectedScope) {
  const store = getMultiUnitPaidOrphanRecoveryContext();
  if (!store || store.brand !== BRAND) {
    throw createSanitizedRecoveryError('MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED');
  }
  if (!expectedScope || !matchesIncidentScope(store, expectedScope)) {
    throw createSanitizedRecoveryError('RECOVERY_SCOPE_MISMATCH');
  }
  return store;
}

/**
 * Exit ALS for explicitly non-privileged scheduling only.
 * Must not call recovery-sensitive functions inside the callback.
 */
function exitMultiUnitPaidOrphanRecoveryContext(callback) {
  return recoveryContext.exit(callback);
}

module.exports = {
  runInMultiUnitPaidOrphanRecoveryContext,
  getMultiUnitPaidOrphanRecoveryContext,
  isMultiUnitPaidOrphanRecoveryContext,
  assertMultiUnitPaidOrphanRecoveryContext,
  exitMultiUnitPaidOrphanRecoveryContext,
  // Test/helpers: pure compare without exposing BRAND
  matchesIncidentScopeForTests: matchesIncidentScope,
  canonicalizeObjectIdForTests: canonicalizeObjectId
};
