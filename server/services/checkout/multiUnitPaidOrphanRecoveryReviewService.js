'use strict';

/**
 * Completion ManualReviewItem create/adopt + hold acquisition/transfer.
 * Binding: docs/architecture/multi-unit-cabin-type-capacity-and-paid-recovery-lock.md §11.4
 */

const mongoose = require('mongoose');
const ManualReviewItem = require('../../models/ManualReviewItem');
const CheckoutFinalizationJob = require('../../models/CheckoutFinalizationJob');
const {
  MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
  buildRecoveryOnlyManualReviewResolutionFilter
} = require('../ops/ingestion/manualReviewResolutionHoldFilter');
const {
  createSanitizedRecoveryError
} = require('./multiUnitPaidOrphanRecoveryErrors');
const {
  assertMultiUnitPaidOrphanRecoveryContext
} = require('./multiUnitPaidOrphanRecoveryCapability');

const COMPLETION_CATEGORY = 'multi_unit_paid_orphan_recovery_completion';
const COMPLETION_SOURCE = 'multi_unit_paid_orphan_recovery';

function buildCompletionRecoveryDedupeKey(recoveryExecutionId) {
  return `multi_unit_paid_orphan_completion:${String(recoveryExecutionId)}`;
}

function assertScope(expectedScope) {
  assertMultiUnitPaidOrphanRecoveryContext(expectedScope);
}

/**
 * Create or adopt the unique completion MRI for a recoveryExecutionId.
 * Does not use generic openManualReviewItem (weaker identity).
 */
async function ensureMultiUnitPaidOrphanCompletionReview({
  originalManualReviewItemId,
  recoveryExecutionId,
  finalizationJobId,
  checkoutId,
  checkoutSessionId,
  paymentId,
  paymentIntentId,
  bookingId = null,
  expectedScope
} = {}) {
  if (expectedScope) {
    assertScope(expectedScope);
  }

  const executionId = String(recoveryExecutionId || '');
  if (!executionId) {
    throw createSanitizedRecoveryError('RECOVERY_IDENTITY_MISMATCH', {
      reason: 'missing_recovery_execution_id'
    });
  }

  const recoveryDedupeKey = buildCompletionRecoveryDedupeKey(executionId);
  const now = new Date();

  const evidence = {
    recoveryExecutionId: executionId,
    finalizationJobId: String(finalizationJobId),
    checkoutId: String(checkoutId),
    checkoutSessionId: String(checkoutSessionId),
    paymentId: String(paymentId),
    paymentIntentId: String(paymentIntentId),
    originalManualReviewItemId: String(originalManualReviewItemId),
    bookingId: bookingId != null ? String(bookingId) : null,
    reason: 'premature_or_out_of_band_incident_review_resolution'
  };

  try {
    const created = await ManualReviewItem.create({
      category: COMPLETION_CATEGORY,
      severity: 'critical',
      status: 'open',
      entityType: 'CheckoutFinalizationJob',
      entityId: String(finalizationJobId),
      title: 'Multi-unit paid-orphan recovery completion review',
      details:
        'Controlled recovery-completion review created after premature out-of-band resolution of the original incident review.',
      provenance: {
        source: COMPLETION_SOURCE,
        sourceReference: executionId,
        detectedAt: now
      },
      evidence,
      recoveryDedupeKey,
      replacedManualReviewItemId: String(originalManualReviewItemId)
    });
    return { review: created.toObject ? created.toObject() : created, created: true };
  } catch (err) {
    if (!(err && (err.code === 11000 || err.code === '11000'))) {
      throw err;
    }
  }

  const adopted = await ManualReviewItem.findOne({ recoveryDedupeKey }).lean();
  if (!adopted) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'completion_mri_duplicate_key_without_document'
    });
  }

  const identityOk =
    adopted.recoveryDedupeKey === recoveryDedupeKey &&
    String(adopted.provenance?.sourceReference || '') === executionId &&
    adopted.provenance?.source === COMPLETION_SOURCE &&
    String(adopted.evidence?.checkoutId || '') === String(checkoutId) &&
    String(adopted.evidence?.paymentIntentId || '') === String(paymentIntentId) &&
    String(adopted.evidence?.finalizationJobId || '') === String(finalizationJobId);

  if (!identityOk) {
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'completion_mri_identity_conflict'
    });
  }

  return { review: adopted, created: false };
}

async function acquireManualReviewResolutionHold({
  manualReviewItemId,
  recoveryExecutionId,
  finalizationJobId,
  checkoutId,
  paymentIntentId,
  expectedScope,
  now = new Date()
} = {}) {
  assertScope(expectedScope);

  const at = now instanceof Date ? now : new Date(now);
  const hold = {
    kind: MULTI_UNIT_PAID_ORPHAN_HOLD_KIND,
    recoveryExecutionId: String(recoveryExecutionId),
    finalizationJobId: String(finalizationJobId),
    checkoutId: String(checkoutId),
    paymentIntentId: String(paymentIntentId),
    heldAt: at,
    status: 'active',
    releasedAt: null,
    transferredToManualReviewItemId: null,
    transferredAt: null
  };

  // Idempotent same execution: already held by us
  const existing = await ManualReviewItem.findById(manualReviewItemId).lean();
  if (!existing) {
    throw createSanitizedRecoveryError('RECOVERY_IDENTITY_MISMATCH', {
      reason: 'manual_review_not_found'
    });
  }

  if (
    existing.resolutionHold?.status === 'active' &&
    existing.resolutionHold?.recoveryExecutionId === String(recoveryExecutionId) &&
    existing.resolutionHold?.kind === MULTI_UNIT_PAID_ORPHAN_HOLD_KIND
  ) {
    return { review: existing, acquired: false, alreadyHeld: true };
  }

  if (
    existing.resolutionHold?.status === 'active' &&
    existing.resolutionHold?.recoveryExecutionId !== String(recoveryExecutionId)
  ) {
    throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT', {
      reason: 'foreign_active_hold'
    });
  }

  if (existing.status === 'resolved') {
    throw createSanitizedRecoveryError('RECOVERY_REVIEW_RESOLVED_PREMATURELY', {
      reason: 'incident_review_already_resolved'
    });
  }

  const updated = await ManualReviewItem.findOneAndUpdate(
    {
      _id: manualReviewItemId,
      status: 'open',
      $or: [
        { 'resolutionHold.status': { $exists: false } },
        { 'resolutionHold.status': null },
        { 'resolutionHold.status': 'released' },
        {
          'resolutionHold.status': 'active',
          'resolutionHold.recoveryExecutionId': String(recoveryExecutionId)
        }
      ]
    },
    { $set: { resolutionHold: hold, updatedAt: at } },
    { new: true }
  );

  if (!updated) {
    const current = await ManualReviewItem.findById(manualReviewItemId).lean();
    if (current?.status === 'resolved') {
      throw createSanitizedRecoveryError('RECOVERY_REVIEW_RESOLVED_PREMATURELY');
    }
    if (
      current?.resolutionHold?.status === 'active' &&
      current.resolutionHold.recoveryExecutionId !== String(recoveryExecutionId)
    ) {
      throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT');
    }
    throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT', {
      reason: 'hold_acquire_zero_match'
    });
  }

  return {
    review: updated.toObject ? updated.toObject() : updated,
    acquired: true,
    alreadyHeld: false
  };
}

/**
 * Hold transfer: completion hold first, then release/transfer original.
 */
async function transferRecoveryHoldToCompletionReview({
  originalManualReviewItemId,
  completionManualReviewItemId,
  recoveryExecutionId,
  finalizationJobId,
  checkoutId,
  paymentIntentId,
  expectedScope,
  now = new Date()
} = {}) {
  assertScope(expectedScope);
  const at = now instanceof Date ? now : new Date(now);

  await acquireManualReviewResolutionHold({
    manualReviewItemId: completionManualReviewItemId,
    recoveryExecutionId,
    finalizationJobId,
    checkoutId,
    paymentIntentId,
    expectedScope,
    now: at
  });

  const completion = await ManualReviewItem.findById(completionManualReviewItemId).lean();
  if (
    !completion ||
    completion.resolutionHold?.status !== 'active' ||
    completion.resolutionHold?.recoveryExecutionId !== String(recoveryExecutionId)
  ) {
    throw createSanitizedRecoveryError('RECOVERY_MRI_HOLD_CONFLICT', {
      reason: 'completion_hold_unverified'
    });
  }

  await ManualReviewItem.findOneAndUpdate(
    {
      _id: originalManualReviewItemId,
      'resolutionHold.recoveryExecutionId': String(recoveryExecutionId),
      'resolutionHold.status': 'active'
    },
    {
      $set: {
        'resolutionHold.status': 'released',
        'resolutionHold.releasedAt': at,
        'resolutionHold.transferredToManualReviewItemId': String(completionManualReviewItemId),
        'resolutionHold.transferredAt': at,
        updatedAt: at
      }
    }
  );

  await CheckoutFinalizationJob.findOneAndUpdate(
    {
      _id: finalizationJobId,
      recoveryExecutionId: String(recoveryExecutionId)
    },
    {
      $set: {
        activeRecoveryReviewItemId: completionManualReviewItemId
      }
    }
  );

  return {
    activeRecoveryReviewItemId: String(completionManualReviewItemId),
    originalHoldReleased: true
  };
}

/**
 * Recovery-only atomic resolve of the active held review.
 */
async function resolveActiveRecoveryHeldManualReview({
  manualReviewItemId,
  recoveryExecutionId,
  checkoutId,
  paymentIntentId,
  finalizationJobId,
  resolvedBy,
  note,
  expectedScope,
  now = new Date()
} = {}) {
  assertScope(expectedScope);
  const at = now instanceof Date ? now : new Date(now);

  const filter = buildRecoveryOnlyManualReviewResolutionFilter({
    manualReviewItemId,
    recoveryExecutionId,
    checkoutId,
    paymentIntentId,
    finalizationJobId
  });

  const updated = await ManualReviewItem.findOneAndUpdate(
    filter,
    {
      $set: {
        status: 'resolved',
        resolution: {
          resolvedAt: at,
          resolvedBy: String(resolvedBy || 'multi_unit_paid_orphan_recovery'),
          note: String(note || 'Resolved by controlled multi-unit paid-orphan recovery').slice(
            0,
            500
          )
        },
        'resolutionHold.status': 'released',
        'resolutionHold.releasedAt': at,
        updatedAt: at
      }
    },
    { new: true }
  );

  if (!updated) {
    const current = await ManualReviewItem.findById(manualReviewItemId).lean();
    if (
      current?.status === 'resolved' &&
      current.resolution?.resolvedBy &&
      String(current.resolution.resolvedBy).includes('multi_unit_paid_orphan_recovery') &&
      current.resolutionHold?.recoveryExecutionId === String(recoveryExecutionId)
    ) {
      return { status: 'already_resolved', review: current };
    }
    throw createSanitizedRecoveryError('RECOVERY_HOSTILE_STATE_DRIFT', {
      reason: 'recovery_resolve_zero_match',
      reviewStatus: current?.status || null,
      holdStatus: current?.resolutionHold?.status || null
    });
  }

  return {
    status: 'resolved',
    review: updated.toObject ? updated.toObject() : updated
  };
}

module.exports = {
  COMPLETION_CATEGORY,
  COMPLETION_SOURCE,
  buildCompletionRecoveryDedupeKey,
  ensureMultiUnitPaidOrphanCompletionReview,
  acquireManualReviewResolutionHold,
  transferRecoveryHoldToCompletionReview,
  resolveActiveRecoveryHeldManualReview
};
