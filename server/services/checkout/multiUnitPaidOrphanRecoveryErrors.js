'use strict';

/**
 * S0 multi-unit paid-orphan recovery error taxonomy.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md §13
 *
 * No guest data. No automatic refund behavior.
 */

const RECOVERY_ERROR_CATALOG = Object.freeze({
  MULTI_UNIT_PAID_ORPHAN_RECOVERY_CONTEXT_REQUIRED: {
    summary: 'Recovery context required for privileged mutation',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'keep',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_SCOPE_MISMATCH: {
    summary: 'Recovery incident scope mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'keep',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_DIGEST_MISMATCH: {
    summary: 'Dry-run evidence digest mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_DIGEST_EXPIRED: {
    summary: 'Dry-run evidence digest expired',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_INTENT_MISMATCH: {
    summary: 'Operator intent phrase mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_INTENT_NOT_CONFIRMED: {
    summary: 'Operator commercial intent not confirmed',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_ALLOWLIST_MISMATCH: {
    summary: 'Allowlist identity mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_EXECUTION_ID_CONFLICT: {
    summary: 'Recovery execution id conflict',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'contested',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_LEASE_CONFLICT: {
    summary: 'Recovery lease contested',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'none',
    leaseEffect: 'contested',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_JOB_LEASE_CONFLICT: {
    summary: 'Recovery job lease contested',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'none',
    leaseEffect: 'contested',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_LEASE_EXPIRED: {
    summary: 'Recovery lease expired; reclaim via resume',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'none',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_RESUME_PHASE_MISMATCH: {
    summary: 'Resume phase mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'keep',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_MRI_HOLD_CONFLICT: {
    summary: 'Manual review resolution hold conflict',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'keep_or_fail',
    reviewHoldEffect: 'contested',
    permanent: true
  },
  RECOVERY_REVIEW_RESOLVED_PREMATURELY: {
    summary: 'Manual review resolved prematurely; completion review required',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'keep_incomplete',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'completion_mri',
    permanent: false
  },
  RECOVERY_HOSTILE_STATE_DRIFT: {
    summary: 'Hostile or contradictory recovery state drift',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'failed_or_keep',
    leaseEffect: 'keep_or_fail',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_CONFIRMATION_STATE_INVALID: {
    summary: 'Confirmation delivery evidence invalid for phase transition',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'keep_incomplete',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_CONFIRMATION_ENQUEUE_FAILED: {
    summary: 'Confirmation ensure/queue phase failed',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'keep_incomplete',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_ALREADY_COMPLETE: {
    summary: 'Recovery already complete',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'complete',
    leaseEffect: 'none',
    reviewHoldEffect: 'already_released',
    permanent: false
  },
  RECOVERY_UNIT_UNAVAILABLE: {
    summary: 'Target unit unavailable for exact-unit recovery',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'failed_or_abort',
    leaseEffect: 'fail',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_TARGET_UNIT_UNAVAILABLE: {
    summary: 'Target unit unavailable for exact-unit recovery',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'failed_or_abort',
    leaseEffect: 'fail',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_IDENTITY_MISMATCH: {
    summary: 'Incident identity mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_PARTIAL_STATE: {
    summary: 'Partial recovery state requires resume',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'keep_incomplete',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_PARTIAL_LINKAGE: {
    summary: 'Partial Booking/Payment/session linkage',
    retryable: true,
    resumable: true,
    recoveryStatusEffect: 'keep_incomplete',
    leaseEffect: 'reclaimable',
    reviewHoldEffect: 'keep',
    permanent: false
  },
  RECOVERY_GUEST_IDENTITY_MISMATCH: {
    summary: 'Guest identity proof mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_FINGERPRINT_MISMATCH: {
    summary: 'Commercial stay fingerprint corroboration mismatch',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_PAYMENT_NOT_PAID: {
    summary: 'Payment is not paid',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_PAYMENT_ALREADY_LINKED_ELSEWHERE: {
    summary: 'Payment linked to a foreign Booking',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'failed_or_abort',
    leaseEffect: 'fail',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_EXISTING_BOOKING_CONFLICT: {
    summary: 'Unexpected existing Booking conflict',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'failed_or_abort',
    leaseEffect: 'fail',
    reviewHoldEffect: 'keep',
    permanent: true
  },
  RECOVERY_FLAG_DISABLED: {
    summary: 'MULTI_UNIT_PAID_ORPHAN_RECOVERY is disabled',
    retryable: false,
    resumable: false,
    recoveryStatusEffect: 'none',
    leaseEffect: 'none',
    reviewHoldEffect: 'keep',
    permanent: true
  }
});

class MultiUnitPaidOrphanRecoveryError extends Error {
  constructor(code, safeDetails = null) {
    const entry = RECOVERY_ERROR_CATALOG[code] || {
      summary: 'Recovery aborted',
      retryable: false,
      resumable: false,
      recoveryStatusEffect: 'none',
      leaseEffect: 'none',
      reviewHoldEffect: 'keep',
      permanent: true
    };
    super(entry.summary);
    this.name = 'MultiUnitPaidOrphanRecoveryError';
    this.code = code;
    this.summary = entry.summary;
    this.retryable = entry.retryable === true;
    this.resumable = entry.resumable === true;
    this.recoveryStatusEffect = entry.recoveryStatusEffect;
    this.leaseEffect = entry.leaseEffect;
    this.reviewHoldEffect = entry.reviewHoldEffect;
    this.permanent = entry.permanent === true;
    this.safeDetails = sanitizeSafeDetails(safeDetails);
    this.refundRecommended = false;
  }

  toJSON() {
    return {
      code: this.code,
      summary: this.summary,
      retryable: this.retryable,
      resumable: this.resumable,
      permanent: this.permanent,
      refundRecommended: false,
      safeDetails: this.safeDetails
    };
  }
}

const FORBIDDEN_SAFE_DETAIL_KEYS = new Set([
  'email',
  'guestEmail',
  'phone',
  'address',
  'ip',
  'clientSecret',
  'secret',
  'mongoUri',
  'password',
  'token',
  'alsStore',
  'store'
]);

function sanitizeSafeDetails(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { note: 'omitted_non_object_details' };
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_SAFE_DETAIL_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      out[key] = value;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else {
      out[key] = '[omitted]';
    }
  }
  return out;
}

function createSanitizedRecoveryError(code, safeDetails = null) {
  return new MultiUnitPaidOrphanRecoveryError(code, safeDetails);
}

function getRecoveryErrorCatalogEntry(code) {
  return RECOVERY_ERROR_CATALOG[code] || null;
}

module.exports = {
  RECOVERY_ERROR_CATALOG,
  MultiUnitPaidOrphanRecoveryError,
  createSanitizedRecoveryError,
  getRecoveryErrorCatalogEntry,
  sanitizeSafeDetails
};
