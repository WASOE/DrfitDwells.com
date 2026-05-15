'use strict';

/**
 * OPS writes for guest message automation (Batch 10B1).
 *
 * Does not import dispatcher, providers, outbound mail stack, orchestrator, or scheduler.
 */

const mongoose = require('mongoose');
const ScheduledMessageJob = require('../../../models/ScheduledMessageJob');
const MessageAutomationRule = require('../../../models/MessageAutomationRule');
const { requirePermission, ACTIONS } = require('../../permissionService');
const { appendAuditEvent } = require('../../auditWriter');

function createHttpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function jobToDto(job) {
  if (!job) return null;
  return {
    jobId: String(job._id),
    ruleKey: job.ruleKey,
    scheduledFor: job.scheduledFor,
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError || null,
    audience: job.audience,
    propertyKind: job.propertyKind,
    cancelReason: job.cancelReason || null,
    cancelActor: job.cancelActor || null,
    bookingId: job.bookingId ? String(job.bookingId) : null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null
  };
}

/**
 * Cancel a scheduled job from OPS. Atomic transition scheduled → cancelled only.
 *
 * @param {object} params
 * @param {string} params.jobId
 * @param {string|null} params.expectedBookingId — required when the job has a bookingId (prevents cross-booking cancel by id guess).
 * @param {string|null} params.reason — optional; defaults to ops_cancelled
 * @param {object} params.ctx — { req, user, route }
 */
async function cancelScheduledMessageJobFromOps({ jobId, expectedBookingId, reason, ctx = {} }) {
  requirePermission({ role: ctx.user?.role, action: ACTIONS.OPS_MESSAGING_CANCEL_JOB });

  if (!mongoose.isValidObjectId(jobId)) {
    throw createHttpError(400, 'Invalid job id');
  }
  const oid = new mongoose.Types.ObjectId(jobId);

  const before = await ScheduledMessageJob.findById(oid).lean();
  if (!before) {
    throw createHttpError(404, 'Job not found');
  }

  if (before.bookingId) {
    if (!expectedBookingId || !mongoose.isValidObjectId(expectedBookingId)) {
      throw createHttpError(400, 'bookingId is required to cancel a booking-scoped job');
    }
    if (String(before.bookingId) !== String(expectedBookingId)) {
      throw createHttpError(403, 'Job does not belong to this reservation');
    }
  }

  if (before.status === 'cancelled') {
    return { job: jobToDto(before), idempotent: true, audited: false };
  }

  if (before.status !== 'scheduled') {
    throw createHttpError(
      409,
      `Cannot cancel job in status "${before.status}". Only scheduled jobs can be cancelled from OPS.`,
      { errorType: 'invalid_job_status', jobStatus: before.status }
    );
  }

  const cancelReason = (reason && String(reason).trim()) || 'ops_cancelled';
  const cancelActor = ctx.user?.email || ctx.user?.id || 'ops_user';

  const updated = await ScheduledMessageJob.findOneAndUpdate(
    { _id: oid, status: 'scheduled' },
    {
      $set: {
        status: 'cancelled',
        cancelReason,
        cancelActor,
        claimedBy: null,
        claimedAt: null,
        visibilityTimeoutAt: null
      }
    },
    { new: true }
  ).lean();

  if (!updated) {
    const again = await ScheduledMessageJob.findById(oid).lean();
    if (again?.status === 'cancelled') {
      return { job: jobToDto(again), idempotent: true, audited: false };
    }
    throw createHttpError(
      409,
      'Job could not be cancelled (it may have been claimed or processed). Try refreshing.',
      { errorType: 'cancel_race' }
    );
  }

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || ctx.user?.email || 'admin',
      entityType: 'ScheduledMessageJob',
      entityId: String(updated._id),
      action: 'guest_message_job_cancel',
      beforeSnapshot: {
        status: before.status,
        ruleKey: before.ruleKey,
        bookingId: before.bookingId ? String(before.bookingId) : null,
        scheduledFor: before.scheduledFor
      },
      afterSnapshot: {
        status: updated.status,
        cancelReason: updated.cancelReason,
        cancelActor: updated.cancelActor
      },
      metadata: {
        namespace: 'ops_messaging',
        route: ctx.route || null
      },
      reason: cancelReason,
      sourceContext: { route: ctx.route || null, namespace: 'ops' }
    },
    { req: ctx.req }
  );

  return { job: jobToDto(updated), idempotent: false, audited: true };
}

const DISABLE_WARNING =
  'Existing scheduled jobs are not deleted when disabling a rule.';

/**
 * OPS-only: set `enabled` on a MessageAutomationRule that is in `mode: 'shadow'`.
 * Does not accept mode or any other fields (Batch 10B2).
 *
 * @param {object} params
 * @param {string} params.ruleKey
 * @param {object} params.body — { enabled: boolean, reason?: string } only
 * @param {object} params.ctx — { req, user, route }
 */
async function setShadowAutomationRuleEnabledFromOps({ ruleKey, body, ctx = {} }) {
  requirePermission({ role: ctx.user?.role, action: ACTIONS.OPS_MESSAGING_SHADOW_RULE_ENABLE });

  const rk = ruleKey != null ? String(ruleKey).trim() : '';
  if (!rk) {
    throw createHttpError(400, 'Invalid rule key');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createHttpError(400, 'JSON body required');
  }
  const keys = Object.keys(body);
  for (const k of keys) {
    if (k !== 'enabled' && k !== 'reason') {
      throw createHttpError(400, `Unsupported field: ${k}`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'enabled')) {
    throw createHttpError(400, 'enabled is required');
  }
  if (typeof body.enabled !== 'boolean') {
    throw createHttpError(400, 'enabled must be a boolean');
  }
  const enabledTarget = body.enabled;
  const reason =
    body.reason != null && String(body.reason).trim() !== '' ? String(body.reason).trim() : null;

  const before = await MessageAutomationRule.findOne({ ruleKey: rk }).lean();
  if (!before) {
    throw createHttpError(404, 'Rule not found');
  }
  if (before.mode !== 'shadow') {
    throw createHttpError(
      409,
      'Only shadow-mode rules can be toggled from OPS in this release.',
      { errorType: 'rule_mode_not_shadow', ruleMode: before.mode }
    );
  }

  const warnings = enabledTarget === false ? [DISABLE_WARNING] : [];

  if (before.enabled === enabledTarget) {
    return {
      rule: { ruleKey: rk, enabled: before.enabled, mode: before.mode },
      idempotent: true,
      audited: false,
      warnings
    };
  }

  const updated = await MessageAutomationRule.findOneAndUpdate(
    { ruleKey: rk, mode: 'shadow' },
    { $set: { enabled: enabledTarget } },
    { new: true }
  ).lean();

  if (!updated) {
    throw createHttpError(
      409,
      'Rule could not be updated (it may no longer be in shadow mode).',
      { errorType: 'rule_update_race' }
    );
  }

  await appendAuditEvent(
    {
      actorType: 'user',
      actorId: ctx.user?.id || ctx.user?.email || 'admin',
      entityType: 'MessageAutomationRule',
      entityId: rk,
      action: 'guest_message_shadow_rule_set_enabled',
      beforeSnapshot: { ruleKey: rk, enabled: before.enabled, mode: before.mode },
      afterSnapshot: { ruleKey: rk, enabled: updated.enabled, mode: updated.mode },
      metadata: {
        namespace: 'ops_messaging',
        route: ctx.route || null
      },
      reason,
      sourceContext: { route: ctx.route || null, namespace: 'ops' }
    },
    { req: ctx.req }
  );

  return {
    rule: { ruleKey: rk, enabled: updated.enabled, mode: updated.mode },
    idempotent: false,
    audited: true,
    warnings
  };
}

module.exports = {
  cancelScheduledMessageJobFromOps,
  setShadowAutomationRuleEnabledFromOps,
  jobToDto
};
