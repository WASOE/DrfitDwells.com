'use strict';

/**
 * Shared ManualReview resolution filters with atomic hold exclusion.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md §11.3
 */

const MULTI_UNIT_PAID_ORPHAN_HOLD_KIND = 'multi_unit_paid_orphan_recovery';

/** Ordinary writers: active hold cannot match. */
const ORDINARY_NO_ACTIVE_HOLD = Object.freeze({
  'resolutionHold.status': { $ne: 'active' }
});

/**
 * Build ordinary resolution filter fragment (merge into writer query).
 * Always includes status open + no active hold in the SAME write filter.
 */
function buildOrdinaryManualReviewResolutionHoldExclusion() {
  return { ...ORDINARY_NO_ACTIVE_HOLD };
}

/**
 * Single-item ordinary resolve filter.
 */
function buildOrdinaryManualReviewResolutionFilter({
  manualReviewItemId,
  expectedStatus = 'open'
} = {}) {
  if (!manualReviewItemId) {
    throw new Error('manualReviewItemId is required');
  }
  return {
    _id: manualReviewItemId,
    status: expectedStatus,
    ...buildOrdinaryManualReviewResolutionHoldExclusion()
  };
}

/**
 * Merge hold exclusion into an existing open-status query (updateMany / findOneAndUpdate).
 * Mutates a shallow copy — does not authorize via prior read.
 */
function withOrdinaryManualReviewHoldExclusion(query = {}) {
  return {
    ...query,
    ...buildOrdinaryManualReviewResolutionHoldExclusion()
  };
}

/**
 * Recovery-only final resolution filter (ManualReviewItem side).
 * Job phase must be asserted separately / in the same recovery transition.
 */
function buildRecoveryOnlyManualReviewResolutionFilter({
  manualReviewItemId,
  recoveryExecutionId,
  checkoutId = null,
  paymentIntentId = null,
  finalizationJobId = null
} = {}) {
  if (!manualReviewItemId || !recoveryExecutionId) {
    throw new Error('manualReviewItemId and recoveryExecutionId are required');
  }
  const filter = {
    _id: manualReviewItemId,
    status: 'open',
    'resolutionHold.kind': MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
    'resolutionHold.status': 'active',
    'resolutionHold.recoveryExecutionId': String(recoveryExecutionId)
  };
  if (checkoutId != null) {
    filter['resolutionHold.checkoutId'] = String(checkoutId);
  }
  if (paymentIntentId != null) {
    filter['resolutionHold.paymentIntentId'] = String(paymentIntentId);
  }
  if (finalizationJobId != null) {
    filter['resolutionHold.finalizationJobId'] = String(finalizationJobId);
  }
  return filter;
}

function isActiveResolutionHold(item) {
  return item?.resolutionHold?.status === 'active';
}

/**
 * Classify zero-match ordinary resolve after reread.
 * @returns {'held'|'already_resolved'|'not_open'|'not_found'|'mismatch'}
 */
function classifyOrdinaryResolutionZeroMatch(item) {
  if (!item) return 'not_found';
  if (isActiveResolutionHold(item) && item.status === 'open') return 'held';
  if (item.status === 'resolved') return 'already_resolved';
  if (item.status !== 'open') return 'not_open';
  return 'mismatch';
}

module.exports = {
  MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
  ORDINARY_NO_ACTIVE_HOLD,
  buildOrdinaryManualReviewResolutionHoldExclusion,
  buildOrdinaryManualReviewResolutionFilter,
  withOrdinaryManualReviewHoldExclusion,
  buildRecoveryOnlyManualReviewResolutionFilter,
  isActiveResolutionHold,
  classifyOrdinaryResolutionZeroMatch
};
